/**
 * 当日成本与"说不出口"读数（P2 成本可见的共用内核）。
 *
 * 为什么要有这一份（2026-11-06 第三方评审 P2 + 主人："哪些功能有用吗"）：
 * 今天她 3210 次调用、517.5M 输入 token、随后被 402 停了 7.5 小时，
 * 而主人在页面上能读到的只有两种说法：「今天做了 226 件小事」和「她很安静」——
 * **累、设计如此、没钱了，三种完全不同的状态在观察面上一模一样**。
 * 这一份只读 `data/usage.jsonl`（宿主落盘的计费账），把它们分开：
 *
 *   · 付费了几次 / 多少 token / 单次平均与撞上限的比例（成本）
 *   · 402·429·412 各几次、最后一次 402 是什么时候（没钱了）
 *   · 由此判出的"她能不能说话"：不是体力，也不是性格，是上游把门关了
 *
 * 口径写死在返回值里（`dayBasis`），面板与脚本报数必须一起带出去，
 * 免得又出现"我 814 次、你 841 次"那种两个数都对、问的不是同一件事的情况。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface CostToday {
  day: string
  dayBasis: 'utc' | 'local'
  calls: number
  paid: number
  failed: number
  inputTokens: number
  outputTokens: number
  avgInputPerPaid: number
  /** 单次 input ≥ 95% 模型上限的调用数（上限按 MiMo 实测 1,048,570） */
  atCeiling: number
  ceiling: number
  statusCounts: Record<string, number>
  last402At: string
  /** 连续 402/429 且距今多久——用来区分"她不想说"和"说不出口" */
  stalledMinutes: number | null
  /**
   * 每笔行动摊到几次模型调用（2026-11-14 新增，第三方复核的验收指标）。
   * 11-06 实测 226 笔 / 3237 次 = 14.3；11-13 是 4 笔 / 14 次 = 3.5。
   * 目标 ≤ 3。这是"一件事被拆成几轮"的直接读数——比单次 token 更能说明烧钱的单位。
   * `actions` 为 0（今天没行动）时为 null：不拿"没行动"去算一个好看的比例。
   */
  callsPerAction: number | null
  /** 今天记了几笔行动（行动账的条数，不是 life.json 的汇总） */
  actions: number
  verdict: 'ok' | 'stalled-auth' | 'throttled' | 'quiet'
  file: string
  note: string
}

const CEILING = 1048570

function dayKey(iso: string, basis: 'utc' | 'local'): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return basis === 'utc'
    ? iso.slice(0, 10)
    : new Date(d.getTime() + (0 - d.getTimezoneOffset()) * 60_000).toISOString().slice(0, 10)
}

export function readCostToday(opts: { dataDir: string; basis?: 'utc' | 'local'; now?: number }): CostToday {
  const basis = opts.basis ?? 'utc'
  const file = path.join(opts.dataDir, 'usage.jsonl')
  const now = opts.now ?? Date.now()
  const empty: CostToday = {
    day: new Date(now).toISOString().slice(0, 10), dayBasis: basis,
    calls: 0, paid: 0, failed: 0, inputTokens: 0, outputTokens: 0, avgInputPerPaid: 0,
    atCeiling: 0, ceiling: CEILING, statusCounts: {}, last402At: '', stalledMinutes: null,
    callsPerAction: null, actions: 0,
    verdict: 'quiet', file,
    note: fs.existsSync(file) ? '今天的账读到了，但一条调用都没有（她没开口）' : `还没有计费账：${file} 不存在`,
  }
  if (!fs.existsSync(file)) return empty

  const today = dayKey(new Date(now).toISOString(), basis)
  let calls = 0, paid = 0, failed = 0, inputTokens = 0, outputTokens = 0, atCeiling = 0
  let last402Ms = 0, lastErrMs = 0, lastPaidMs = 0
  const statusCounts: Record<string, number> = {}

  // 文件可能有半行（进程被杀），逐行 try-parse，不整块 require
  const raw = fs.readFileSync(file, 'utf8')
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    let rec: any
    try { rec = JSON.parse(line) } catch { continue }
    const a = rec?.attempt
    const started = String(a?.startedAt ?? '')
    if (!started || dayKey(started, basis) !== today) continue
    calls += 1
    const input = Number(a?.meters?.input ?? 0)
    const status = a?.status == null ? null : String(a.status)
    if (status) statusCounts[status] = (statusCounts[status] ?? 0) + 1
    if (input > 0) {
      paid += 1
      inputTokens += input
      outputTokens += Number(a?.meters?.output ?? 0)
      // 2026-11-14 补：`lastPaidMs` 声明了却从没赋值，于是 `recentlyPaid` 永远为 false、
      // `recoveredSinceFail` 也永远为 false —— verdict 从来不可能判成 'ok'，
      // "上游恢复"只能靠 quiet 猜（正是这次被假冒恢复坑到的那处）。按时间取最大。
      lastPaidMs = Math.max(lastPaidMs, Date.parse(started) || 0)
      if (input >= CEILING * 0.95) atCeiling += 1
    } else {
      failed += 1
      lastErrMs = Math.max(lastErrMs, Date.parse(started) || 0)
      if (status === '402') last402Ms = Math.max(last402Ms, Date.parse(started) || 0)
    }
  }

  /**
   * 三种状态要能分开，这是 P2 的全部意义：
   *   · 近 15 分钟还在失败 → 通道关着（402=没钱 / 其它=被限），**不是她不想说**
   *   · 近 15 分钟有成功调用 → 通道开着、她确实在说话
   *   · 两边都没有 → `quiet`（这一阵子谁都没动），不能报成 `ok` 让人读成"她选择沉默"
   */
  const stalledMinutes = lastErrMs > 0 ? Math.max(0, Math.round((now - lastErrMs) / 60_000)) : null
  const freshMs = 15 * 60_000
  const recentlyFailed = stalledMinutes !== null && now - lastErrMs <= freshMs
  const recentlyPaid = lastPaidMs > 0 && now - lastPaidMs <= freshMs
  /**
   * 2026-11-14 修一个会自己骗自己的判定（实测踩到，见 docs/evidence/402-stoploss-2026-11-14.md）：
   *
   * 402 之后**不会立刻有新行落盘**——失败记录要等下一次调用才写。于是：
   *   23:53 402 → 之后 15 分钟窗口一过 → `recentlyFailed=false`、`recentlyPaid=false`
   *   → verdict 退回 `quiet` → 心跳退避**清零**（"上游恢复"）→ 下一拍又撞 402。
   * 线上日志实证：`00:08:30 上游恢复，心跳退避清零` 之后 3 秒就是 `00:08:33 402`。
   *
   * 所以 `quiet` 不能无条件等于"通道开着"。只有**最后一次失败之后确实来了一次成功**，
   * 才算恢复；否则保持 stalled（继续按退避节奏试，而不是回到 30 秒一拍）。
   * 这条和"15 分钟新鲜度"是两件事：新鲜度决定"现在是不是又在失败"，这条决定"恢复没恢复"。
   */
  const recoveredSinceFail = lastPaidMs > 0 && lastPaidMs > lastErrMs
  const stillDown = lastErrMs > 0 && !recoveredSinceFail
  const verdict: CostToday['verdict'] =
    // ① 失败之后已经有成功调用 → 通道确实恢复了（这一条必须排最前：
    //    否则"402 后又成功"仍会因为 last402Ms===lastErrMs 被误判成还在停摆）
    recoveredSinceFail
      ? 'ok'
      // ② 失败之后还没有任何成功 → 通道仍然关着，不管是刚失败（recentlyFailed）还是已经过了一阵（stillDown）
      : lastErrMs > 0
        ? (last402Ms === lastErrMs && last402Ms > 0 ? 'stalled-auth' : 'throttled')
        : recentlyPaid
          ? 'ok'
          : 'quiet'

  /**
   * 每笔行动摊到几次调用（第三方复核 2026-11-14 定的唯一验收数）。
   * 行动数从 `actions.ndjson` 读当日条数——**不用 life.json 的 actionsToday**，
   * 因为那个是汇总、且以前有对不上账的前科；验收要看凭据。
   */
  let actions = 0
  try {
    const af = path.join(opts.dataDir, 'persona', 'actions.ndjson')
    const fallback = path.join(opts.dataDir, 'actions.ndjson')
    const target = fs.existsSync(af) ? af : fallback
    if (fs.existsSync(target)) {
      for (const line of fs.readFileSync(target, 'utf8').split('\n')) {
        if (!line.trim()) continue
        try {
          const r = JSON.parse(line)
          const at = Number(r?.at ?? 0)
          if (at > 0 && dayKey(new Date(at).toISOString(), basis) === today) actions += 1
        } catch { /* 半行跳过 */ }
      }
    }
  } catch { /* 读不到行动账就报 null，不编一个数 */ }
  const callsPerAction = actions > 0 ? Number((calls / actions).toFixed(2)) : null

  return {
    day: today, dayBasis: basis, calls, paid, failed, inputTokens, outputTokens,
    avgInputPerPaid: paid ? Math.round(inputTokens / paid) : 0,
    atCeiling, ceiling: CEILING, statusCounts,
    last402At: last402Ms ? new Date(last402Ms).toISOString() : '',
    stalledMinutes, callsPerAction, actions, verdict, file,
    note: '',
  }
}

/** 面板与脚本文案共用的那一行话：把"钱"和"说不出口"分开说，别让人又读成性格。 */
export function costSummary(c: CostToday): string {
  const m = (n: number) => `${(n / 1e6).toFixed(1)}M`
  const head = `今天 ${c.calls} 次调用（付费 ${c.paid} · 失败 ${c.failed}）· 输入 ${m(c.inputTokens)} · 单次均 ${c.avgInputPerPaid.toLocaleString('en-US')}，其中 ${c.atCeiling} 次顶到 ${c.ceiling.toLocaleString('en-US')} 上限`
  /**
   * 「每笔行动几次调用」放在最前——这是烧钱的单位（第三方 2026-11-14 定的唯一验收数）。
   * 11-06 是 14.3、11-13 是 3.5，目标 ≤ 3；>3 就明说超了，别藏在后面。
   * 今天没行动时写 null 的理由，不拿 0 去伪装一个漂亮比例。
   */
  const burn = c.actions > 0
    ? `｜**每笔行动 ${c.callsPerAction} 次调用**${(c.callsPerAction ?? 0) > 3 ? '（超 3，一件事被拆太碎）' : ''}（今天 ${c.actions} 笔）`
    : '｜今天还没有行动，算不出每笔调用数'
  const tail = c.verdict === 'stalled-auth'
    ? `｜**说不出口**：额度被拒（402），最后一次 ${c.stalledMinutes} 分钟前，这不是她不想说`
    : c.verdict === 'throttled'
      ? `｜通道受限（429/其它），最后一次失败 ${c.stalledMinutes} 分钟前`
      : c.verdict === 'ok'
        ? '｜通道开着，她说的话都计费了'
        // quiet 有两种，措辞必须分开：改判之后"近 15 分钟没动静"不等于"今天没调用"。
        // 把今天有账的日子说成"她没开口"，就是我刚修掉的那类错读。
        : c.calls > 0
          ? `｜近 15 分钟没有新调用（今天累计 ${c.calls} 次，其中付费 ${c.paid} 次）`
          : '｜今天一次都没调用（账上是空的）'
  return `${burn}${head}${tail}（日界口径：${c.dayBasis}）`
}

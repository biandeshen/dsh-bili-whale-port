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
  const verdict: CostToday['verdict'] = recentlyFailed
    ? (last402Ms === lastErrMs ? 'stalled-auth' : 'throttled')
    : recentlyPaid
      ? 'ok'
      : 'quiet'

  return {
    day: today, dayBasis: basis, calls, paid, failed, inputTokens, outputTokens,
    avgInputPerPaid: paid ? Math.round(inputTokens / paid) : 0,
    atCeiling, ceiling: CEILING, statusCounts,
    last402At: last402Ms ? new Date(last402Ms).toISOString() : '',
    stalledMinutes, verdict, file,
    note: '',
  }
}

/** 面板与脚本文案共用的那一行话：把"钱"和"说不出口"分开说，别让人又读成性格。 */
export function costSummary(c: CostToday): string {
  const m = (n: number) => `${(n / 1e6).toFixed(1)}M`
  const head = `今天 ${c.calls} 次调用（付费 ${c.paid} · 失败 ${c.failed}）· 输入 ${m(c.inputTokens)} · 单次均 ${c.avgInputPerPaid.toLocaleString('en-US')}，其中 ${c.atCeiling} 次顶到 ${c.ceiling.toLocaleString('en-US')} 上限`
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
  return `${head}${tail}（日界口径：${c.dayBasis}）`
}

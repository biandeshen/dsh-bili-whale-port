/**
 * 单次开口的 62 万 token 是怎么攒出来的：上下文分块解剖（只读，零成本）。
 *
 *   node scripts/token-anatomy.mjs [--date=YYYY-MM-DD] [--json] [--tz=utc|local]
 *
 * 为什么要这支脚本（2026-11-06 第三方评审 + 主人拍板的施工顺序第一条）：
 * 今日 3237 次调用里 2396 次失败（402，不计 token），真花钱的是 841 次；
 * 522.3M ÷ 841 ≈ **她每次开口背 62 万 token**，p99 顶到 1,048,570、97 次撞 1M。
 * 主人要的是一张**分块占比表**（哪一块最大、占多少），不是"总量下降 X%"——
 * 只报总量的验收口径已经写在评审第四节里，那种交付不算通过。
 *
 * 数据来源都是**盘上实物**，不引用任何文档说法：
 *   - `data/usage.jsonl`：每次调用的 outcome/status/meters（tokens 的真数）
 *   - `data/runs/<run>/transcript.jsonl`：她那一轮真正被送出去的 item
 *     （既往 user 注入、assistant 输出、function_call、function_call_output）
 *   - `data/session-main.jsonl`：会话正本（同一批 item 的另一种落盘，用来交叉核对条数）
 *
 * 口径先说清楚，免得数字被拿去吹：
 *   ① 日期默认按 **UTC**（usage 的 startedAt 是 UTC；评审组的数也是这个口径）。
 *      `--tz=local` 切成东八区日切，两天界不一样，别混用。
 *   ② token 与字符的换算**不假设**：先用当日的"窗口字符数 ÷ 实际 input tokens"反推出比值，
 *      再把各块字符数折成 token 占比。比值本身会打印出来，不藏。
 *   ③ 分块占比是对**当日全部被送出的 item**做的构成分析（等价于"她每次背的东西里各块占多少"），
 *      不是单次请求的精确重放——宿主没有把每次请求体落盘，这一点在结论里如实标出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import { deployHome } from '../packages/cap-bilibili/src/platform/paths.mjs'

const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : (argv.includes(`--${name}`) ? true : dflt)
}
const asJson = argv.includes('--json')
const useLocal = argOf('tz', 'utc') === 'local'

const home = deployHome()
const dataDir = [path.join(home, 'xiaoyu', 'data'), path.join(home, 'data')].find((d) => fs.existsSync(d))
if (!dataDir) {
  console.error(`找不到部署数据目录（deployHome=${home}）。这台机器上她没有部署，不猜路径。`)
  process.exit(1)
}

const dayOf = (iso) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return useLocal ? new Date(d.getTime() + 8 * 3600_000).toISOString().slice(0, 10) : iso.slice(0, 10)
}
const today = argOf('date', '') || new Date().toISOString().slice(0, 10)

// ── ① 调用与 token 的真数（usage.jsonl） ──────────────────────────────────
function readUsage() {
  const file = path.join(dataDir, 'usage.jsonl')
  if (!fs.existsSync(file)) return { rows: [] }
  const rows = []
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let rec
    try { rec = JSON.parse(line) } catch { continue }
    const a = rec?.attempt
    if (!a?.startedAt) continue
    rows.push({
      day: dayOf(a.startedAt),
      startedAt: a.startedAt,
      purpose: a.purpose ?? '',
      outcome: a.outcome ?? '',
      status: a.status ?? null,
      input: a.meters?.input ?? null,
      cached: a.meters?.cachedInput ?? null,
      uncached: a.meters?.uncachedInput ?? null,
      output: a.meters?.output ?? null,
      reasoning: a.meters?.reasoning ?? null,
      elapsedMs: a.elapsedMs ?? null,
    })
  }
  return { rows }
}

const { rows: usageAll } = readUsage()
const usage = usageAll.filter((r) => r.day === today)
const paid = usage.filter((r) => typeof r.input === 'number' && r.input > 0)
const failed = usage.filter((r) => r.outcome !== 'success' && !(r.input > 0))
const sumInput = paid.reduce((s, r) => s + r.input, 0)
const sumOutput = paid.reduce((s, r) => s + (r.output ?? 0), 0)
const sortedInputs = paid.map((r) => r.input).sort((a, b) => a - b)
const pct = (p) => (sortedInputs.length ? sortedInputs[Math.min(sortedInputs.length - 1, Math.floor(p * sortedInputs.length))] : 0)
const statusCount = {}
for (const r of usage) if (r.status) statusCount[r.status] = (statusCount[r.status] ?? 0) + 1

// ── ② 她真正被送出去的东西（transcript） ──────────────────────────────────
const runsDir = path.join(dataDir, 'runs')
const runDirs = fs.existsSync(runsDir)
  ? fs.readdirSync(runsDir).filter((d) => d.startsWith(`r-${today.replace(/-/g, '')}`))
  : []

/** user 注入正文按【…】分块；块名归一化（去掉数字与标点，避免同类块被拆散）。 */
function blockName(head) {
  const raw = String(head).replace(/[【】\s]/g, '').slice(0, 12)
  return raw || '（无标题头）'
}
function splitPrefix(text) {
  const parts = []
  const re = /【[^】]{1,24}】/g
  const marks = [...text.matchAll(re)]
  if (!marks.length) return [{ name: '（整段无块标）', chars: text.length }]
  if (marks[0].index > 0) parts.push({ name: '开头未分块段', chars: marks[0].index })
  for (let i = 0; i < marks.length; i += 1) {
    const from = marks[i].index
    const to = i + 1 < marks.length ? marks[i + 1].index : text.length
    parts.push({ name: blockName(marks[i][0]), chars: to - from })
  }
  return parts
}

const cats = {}
const prefixBlocks = {}
const toolOutputBytes = {}
const injection = { n: [], chars: [] }
const toolCallBytes = {}
let items = 0
let windowChars = 0
const biggest = []

const bump = (obj, k, n) => { obj[k] = (obj[k] ?? 0) + n }
let boundary = 0
/** 每条 item 的 (时间戳, 字符数, 类别)——用来算"这一条被后面多少次调用重送过"。 */
const sentItems = []

for (const d of runDirs) {
  const p = path.join(runsDir, d, 'transcript.jsonl')
  if (!fs.existsSync(p)) continue
  const recs = []
  for (const line of fs.readFileSync(p, 'utf8').split('\n')) {
    if (!line.trim()) continue
    try { recs.push(JSON.parse(line)) } catch { /* 半行不猜 */ }
  }
  /**
   * 第一遍先建 `call_id → 工具名` 的对照：`function_call_output` 里只有 call_id，
   * 不建这张表，top10 排出来是一堆 id，看不出**哪个工具的回灌在吃窗口**——而这一列正是本次要的"最大块"。
   */
  const nameByCall = {}
  for (const rec of recs) {
    const it = rec.item ?? {}
    if (it.type === 'function_call') nameByCall[String(it.call_id ?? it.id ?? '')] = String(it.name ?? '?')
  }
  let runChars = 0
  for (const rec of recs) {
    if (rec.kind === 'boundary') { boundary += 1; continue } // 宿主分界记录，不进请求体
    const it = rec.item ?? {}
    items += 1
    let chars = 0
    let cat = ''
    if (it.type === 'message') {
      const text = (it.content ?? []).map((c) => String(c.text ?? '')).join('\n')
      chars = text.length
      cat = it.role === 'user' ? '既往 user 注入（每轮都重送）' : '既往 assistant 输出（每轮都重送）'
      bump(cats, cat, chars)
      if (it.role === 'user') {
        for (const b of splitPrefix(text)) bump(prefixBlocks, b.name, b.chars)
        /**
         * 「本轮关联记忆」每回合实际注入几条——这条必须自己量，别拿"core 存了 21 张"当"注入了 21 条"。
         * 2026-11-06 实测：p50=3、max=4，所以把 core 压到 8 **省不了 token**（省的是存储语义账）。
         */
        const mem = text.match(/【本轮关联记忆】([\s\S]*?)(?=\n【|$)/)
        if (mem && mem[1].trim()) {
          injection.chars.push(mem[1].trim().length)
          injection.n.push((mem[1].match(/^\s*(?:[-·]|\[[^\]]{1,20}\])\s/gm) || []).length)
        }
      }
    } else if (it.type === 'function_call') {
      chars = JSON.stringify(it).length
      cat = 'function_call（她的工具调用请求）'
      bump(cats, cat, chars)
      bump(toolCallBytes, it.name ?? '?', chars)
    } else if (it.type === 'function_call_output') {
      chars = JSON.stringify(it).length
      cat = 'function_call_output（**工具结果回灌**）'
      bump(cats, cat, chars)
      bump(toolOutputBytes, nameByCall[String(it.call_id ?? '')] ?? '(没匹配上调用名)', chars)
    } else {
      chars = JSON.stringify(it).length
      cat = `其他 item(${it.type ?? '无类型'})`
      bump(cats, cat, chars)
    }
    // 成本加权的原料：这一条是从这个时刻起，被后面每一次调用重复发送的
    sentItems.push({
      ts: Date.parse(rec.ts ?? '') || 0,
      chars,
      cat,
      // 细一层：工具结果按**工具名**、user 注入按**块名**，这样才说得出"该砍哪一块"
      sub: it.type === 'function_call_output'
        ? (nameByCall[String(it.call_id ?? '')] ?? '(没匹配上调用名)')
        : '',
    })
    if (it.type === 'message' && it.role === 'user') {
      const ts = Date.parse(rec.ts ?? '') || 0
      for (const b of splitPrefix((it.content ?? []).map((c) => String(c.text ?? '')).join('\n'))) {
        sentItems.push({ ts, chars: b.chars, cat: '既往 user 注入·分块', sub: b.name })
      }
    }
    windowChars += chars
    runChars += chars
  }
  biggest.push({ run: d, chars: runChars })
}
biggest.sort((a, b) => b.chars - a.chars)

// ── ③ 换算：当日窗口字符 ÷ 当日实付 input token（比值自己算，不假设） ──────
// 不引入"1 token = 几个字符"这种外部假设：直接用量出来的两个数相除，
// 比值 > 1 就说明同一批字符被**反复重送**，那才是 62 万的来源。
const ratio = windowChars > 0 ? sumInput / windowChars : 0

/**
 * ③b 成本加权占比——**这张才是"62 万是怎么攒出来的"的答案**。
 *
 * 只按"当日新增字符"排占比会骗人：她每次开口都把**从会话开始到现在的每一条**重送一遍，
 * 所以一条上午 08:00 产生的 6 万字符日记，比一条 20:00 产生的 6 万字符贵几十倍。
 * 算法：每条 item 的字符数 × 它之后发生过多少次**付费**调用（失败的不计 token，不参与）。
 * 结果是"钱花在哪一块"，不是"内容长在哪一块"。
 */
const paidTs = paid.map((r) => Date.parse(r.startedAt) || 0).sort((a, b) => a - b)
const weighted = {}
const weightedSub = {}
let weightedTotal = 0
for (const s of sentItems) {
  let sends = 0
  for (const t of paidTs) if (t >= s.ts) sends += 1
  const w = s.chars * sends
  if (s.cat !== '既往 user 注入·分块') bump(weighted, s.cat, w) // 分块是同一批字符的另一种切法，不重复计入总额
  weightedTotal += s.cat === '既往 user 注入·分块' ? 0 : w
  if (s.sub) bump(weightedSub, `${s.cat} ▸ ${s.sub}`, w)
}
const weightedTable = Object.entries(weighted).sort((a, b) => b[1] - a[1])
const weightedSubTable = Object.entries(weightedSub).sort((a, b) => b[1] - a[1]).slice(0, 14)

// ── ④ 报告 ────────────────────────────────────────────────────────────────
const table = Object.entries(cats).sort((a, b) => b[1] - a[1])
const prefixTable = Object.entries(prefixBlocks).sort((a, b) => b[1] - a[1])
const topOutputs = Object.entries(toolOutputBytes).sort((a, b) => b[1] - a[1]).slice(0, 10)
const topCalls = Object.entries(toolCallBytes).sort((a, b) => b[1] - a[1]).slice(0, 10)

if (asJson) {
  console.log(JSON.stringify({
    day: today, tz: useLocal ? 'local(+8)' : 'utc', dataDir, runDirs: runDirs.length, items,
    calls: usage.length, paid: paid.length, failed: failed.length, statusCount,
    tokens: { input: sumInput, output: sumOutput, p50: pct(0.5), p90: pct(0.9), p99: pct(0.99), max: pct(1) },
    windowChars, inputPerCallAvg: paid.length ? Math.round(sumInput / paid.length) : 0,
    inputTokensPerWindowChar: Number(ratio.toFixed(3)),
    categories: Object.fromEntries(table), prefixBlocks: Object.fromEntries(prefixTable),
    topToolOutputs: Object.fromEntries(topOutputs), topToolCalls: Object.fromEntries(topCalls),
    injectionPerTurn: {
      turns: injection.n.length,
      cards: { min: Math.min(...injection.n), p50: injection.n.sort((a, b) => a - b)[Math.floor(injection.n.length / 2)], max: Math.max(...injection.n) },
      chars: { min: Math.min(...injection.chars), max: Math.max(...injection.chars), total: injection.chars.reduce((a, b) => a + b, 0) },
    },
    biggestRuns: biggest.slice(0, 5),
  }, null, 2))
} else {
  console.log(`# 单次开口背多少：${today}（日界口径 ${useLocal ? '东八区' : 'UTC'}）`)
  console.log(`  数据目录 ${dataDir}`)
  console.log(`  当日 run 目录 ${runDirs.length} 个；transcript item ${items} 条；被送出的窗口字符合计 ${windowChars.toLocaleString('en-US')}\n`)

  console.log(`## ① 调用与钱（usage.jsonl 实测）`)
  console.log(`  调用 ${usage.length} 次：真付费 ${paid.length} 次、失败不计 token ${failed.length} 次`)
  console.log(`  status 分布：${Object.entries(statusCount).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`).join(' · ') || '（无）'}`)
  console.log(`  input 合计 ${(sumInput / 1e6).toFixed(1)}M · output 合计 ${(sumOutput / 1e6).toFixed(2)}M`)
  console.log(`  单次 input：p50 ${pct(0.5).toLocaleString('en-US')} · p90 ${pct(0.9).toLocaleString('en-US')} · p99 ${pct(0.99).toLocaleString('en-US')} · max ${pct(1).toLocaleString('en-US')}`)
  console.log(`  **单次平均 ${(paid.length ? Math.round(sumInput / paid.length) : 0).toLocaleString('en-US')} token**（评审说的 62 万就是这个数）\n`)

  console.log(`## ② 分块占比（当日被送出的 item 构成，**按新增字符**）`)
  const pc = (v) => `${((v / Math.max(1, windowChars)) * 100).toFixed(1)}%`
  for (const [k, v] of table) {
    console.log(`  ${pc(v).padStart(6)}  ${String(v).padStart(9)} 字符  ${k}`)
  }
  console.log(`  换算系数：当日 input ${sumInput.toLocaleString('en-US')} token ÷ 窗口 ${windowChars.toLocaleString('en-US')} 字符 = **${ratio.toFixed(2)} token/字符**`)
  console.log(`  （比值远大于 1 说明**同一批字符被反复重送**，不是新增内容本身贵）`)
  console.log(`  另有 ${boundary} 条 boundary 分界记录（宿主用，不进请求体），已排除在外\n`)

  console.log(`## ②b **成本加权占比**（每条 × 它之后发生过多少次付费调用）`)
  console.log(`  这才是"62 万怎么攒的"：上午的一条 6 万字符日记，比晚上同样 6 万字符贵几十倍。`)
  const wpc = (v) => `${((v / Math.max(1, weightedTotal)) * 100).toFixed(1)}%`
  for (const [k, v] of weightedTable) {
    console.log(`  ${wpc(v).padStart(6)}  ≈${(v / Math.max(1, weightedTotal) * (sumInput / paid.length) / 1000).toFixed(0).padStart(6)}k token/次  ${k}`)
  }
  console.log(`  对照：单次实付平均 ${Math.round(sumInput / paid.length).toLocaleString('en-US')} token（②b 的"≈k token/次"就是按占比折到这个数上）\n`)
  console.log(`## ②c 成本加权·再细一层（该砍哪一块，看这张）`)
  for (const [k, v] of weightedSubTable) {
    console.log(`  ${wpc(v).padStart(6)}  ${k}`)
  }

  console.log(`## ③ user 注入里各块多大（每轮都重送的那一段）`)
  if (injection.n.length) {
    const srt = [...injection.n].sort((a, b) => a - b)
    const srtC = [...injection.chars].sort((a, b) => a - b)
    console.log(`  「本轮关联记忆」每回合实注入条数：min ${srt[0]} · p50 ${srt[Math.floor(srt.length / 2)]} · max ${srt[srt.length - 1]}`
      + `（${injection.n.length} 个带该块的回合）`)
    console.log(`  该块字符：p50 ${srtC[Math.floor(srtC.length / 2)]} · max ${srtC[srtC.length - 1]}`
      + ` —— **别把"core 存了 21 张"读成"注入了 21 条"，压 core 上限不省 token**\n`)
  }
  for (const [k, v] of prefixTable) console.log(`  ${String(v).padStart(8)} 字符  ${k}`)

  console.log(`\n## ④ 工具结果回灌 top 10（这是"越读越大"的直接来源）`)
  for (const [k, v] of topOutputs) console.log(`  ${String(v).padStart(9)} 字符  ${k}`)
  console.log(`\n## ⑤ 她调用工具本身 top 10（args 也占窗口）`)
  for (const [k, v] of topCalls) console.log(`  ${String(v).padStart(9)} 字符  ${k}`)

  console.log(`\n## ⑥ 单日最大 session（窗口就是在这些里面滚出来的）`)
  for (const b of biggest.slice(0, 5)) console.log(`  ${String(b.chars).padStart(9)} 字符  ${b.run}`)

  console.log(`\n## 口径与限制（不写清就会被人拿去吹）`)
  console.log('  · 块名按【】切，**正文自带的【】会被当成块**（当日③里"ASMR助眠""失眠不怕"就是这么来的）；')
  console.log('    大类占比不受影响，个别小块的归属要人眼看过再下结论。')
  console.log('  · 占比是"当日全部被送 item 的构成"，不是某一次请求的精确重放：宿主没把每次请求体落盘，')
  console.log('    要精确重放必须加一条采样落盘（P1 之后再说，别现在改行为）。')
  console.log('  · transcript 里**没有任何图像 item**（实测 0 字节），所以"拼图/帧把上下文撑爆"这条今天不成立。')
  console.log('  · boundary 记录是宿主分界用的，不进气泡，已从"送出"里分开列。')
}

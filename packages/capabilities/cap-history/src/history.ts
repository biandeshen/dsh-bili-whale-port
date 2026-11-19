/**
 * 读 `data/runs/<run>/transcript.jsonl` —— 往回翻页与检索。
 *
 * **为什么这是能力包而不是底座的补丁**（2026-11-20 迁出宿主）：
 * 这段读取原本写在宿主的 `src/core/transcript.ts` 里（119 个提交中的 228 行）。
 * 那意味着我们的功能住在别人的代码里——换底座就得重写一遍，升级上游就冲突。
 * 现在它只吃一个 `dataDir` 参数：任何底座只要告诉她"数据在哪"，这段就能跑。
 *
 * 读的是什么：`session-main.jsonl` 在交接/清空/前缀重载时被**整体替换**
 * （写 tmp 再 rename），所以它不是账本；控制台上看到的也只是内存里那一份当前 session。
 * 真正"一条都不丢"的是各 run 的 transcript.jsonl——只追加、跨 run 全局递增、从不剪枝。
 *
 * 游标是 `run目录名#文件内行号`：run 名 `r-YYYYMMDD-HHMMSS-xxxx` 按字典序即时间序，
 * 所以"更早"就是键更小，翻页稳定、不依赖时间戳精度（同一毫秒也能分先后）。
 * 从最新的 run 往回扫，攒够 limit+1 条就停：不为了算总数把几年的盘都读一遍。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

export type TranscriptBoundary =
  | 'handoff'
  | 'clear'
  | 'prefix-reload'
  | 'ephemeral-drop'
  | 'orphan-result-drop'

/** 一条对话项。字段形状照抄宿主写入时的形状，本包只读不写。 */
export interface TranscriptItemRecord {
  kind: 'item'
  ts: string
  run: string
  sess?: string
  round?: number
  /** session 里的下标（append 时刻） */
  index: number
  item: {
    type: string
    role?: string
    name?: string
    arguments?: string
    [k: string]: unknown
  }
  context?: unknown
}

export interface TranscriptBoundaryRecord {
  kind: 'boundary'
  ts: string
  run: string
  sess?: string
  round?: number
  event: TranscriptBoundary
  data: Record<string, unknown>
}

export type TranscriptRecord = TranscriptItemRecord | TranscriptBoundaryRecord

export interface TranscriptPage {
  /** 旧→新，前端可直接前插。 */
  records: TranscriptRecord[]
  /** 本页最旧一条的键；下一次作为 `before` 传回来就是"再往前翻"。 */
  cursor: string | null
  hasMore: boolean
  scannedRuns: number
}

const keyOf = (run: string, seq: number): string => `${run}#${String(seq).padStart(8, '0')}`

/** 往回翻一页。`dataDir` 是底座的部署数据目录（历史在它下面的 `runs/`）。 */
export function readTranscriptHistory(
  dataDir: string,
  opts: { before?: string | null; limit?: number } = {},
): TranscriptPage {
  const wanted = Math.round(Number(opts.limit))
  // 0/负数/NaN 一律回落默认，而不是"给 1 条"或"给 0 条"：调用方传坏值不该看到空页。
  const limit = Math.max(1, Math.min(500, Number.isFinite(wanted) && wanted > 0 ? wanted : 120))
  const before = typeof opts.before === 'string' && opts.before ? opts.before : null
  const root = join(dataDir, 'runs')
  let runs: string[] = []
  try {
    runs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return { records: [], cursor: null, hasMore: false, scannedRuns: 0 }
  }
  const picked: { key: string; rec: TranscriptRecord }[] = []
  let scannedRuns = 0
  let overflow = false
  let cursorAt = 0

  outer: for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    const file = join(root, run, 'transcript.jsonl')
    if (!existsSync(file)) continue
    scannedRuns++
    let lines: string[] = []
    try {
      lines = readFileSync(file, 'utf8').split('\n')
    } catch {
      continue // 读不动的 run 跳过，但别让整页失败
    }
    for (let seq = lines.length - 1; seq >= 0; seq--) {
      const line = lines[seq]
      if (!line || !line.trim()) continue
      let rec: TranscriptRecord
      try {
        rec = JSON.parse(line) as TranscriptRecord
      } catch {
        continue // 半行/坏行不能把整页带走
      }
      const key = keyOf(run, seq)
      if (before && key >= before) continue
      picked.push({ key, rec })
      if (picked.length > limit) {
        overflow = true
        break outer
      }
    }
    cursorAt = i
  }

  const page = overflow ? picked.slice(0, limit) : picked
  const hasMore = overflow || (picked.length > 0 && cursorAt > 0)
  const ordered = page.slice().reverse()
  return {
    records: ordered.map((p) => p.rec),
    cursor: ordered.length ? ordered[0].key : null,
    hasMore,
    scannedRuns,
  }
}

// ── 检索：跨 run、按日期、按关键词 ──────────────────────────────────────────

export interface TranscriptSearchOptions {
  /** `YYYY-MM-DD`；给了就只扫这一天的 run。 */
  date?: string | null
  /** 不区分大小写的子串；空/缺省 = 不限（只按日期与游标翻页）。 */
  query?: string | null
  /** 角色/类型过滤：只看她说的话、只看主人的话，或只看工具调用。 */
  role?: 'user' | 'assistant' | 'tool' | null
  /** 从哪条更早的键接着往前找（上一次返回的 cursor）。 */
  before?: string | null
  limit?: number
}

export interface TranscriptHit {
  key: string
  run: string
  ts: string
  role: 'user' | 'assistant' | 'tool' | 'reasoning' | 'other'
  /** 命中所在的整段文字，按关键词前后截一段。 */
  excerpt: string
  /** 工具调用/回执的名字，其它角色为 null。 */
  tool?: string | null
}

export interface TranscriptSearchPage {
  hits: TranscriptHit[]
  cursor: string | null
  hasMore: boolean
  scannedRuns: number
  /** 目标日期内实际存在的 run 数（给了 date 才有意义）。 */
  matchingRuns: number
}

/** `r-20261101-125921-dc5f` → `2026-11-01`；认不出形状的 run 返回 null。 */
export function runDate(run: string): string | null {
  const m = /^r-(\d{4})(\d{2})(\d{2})-/.exec(run)
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null
}

function roleOf(rec: TranscriptRecord): TranscriptHit['role'] {
  if (rec.kind === 'boundary') return 'other'
  const item = rec.item
  if (item.type === 'message') return item.role === 'assistant' ? 'assistant' : 'user'
  if (item.type === 'function_call' || item.type === 'function_call_output') return 'tool'
  if (item.type === 'reasoning') return 'reasoning'
  return 'other'
}

/** 把一条记录压成可检索的文字。工具调用拼上参数，边界记录拼上事件与数据。 */
function textOfRecord(rec: TranscriptRecord): string {
  if (rec.kind === 'boundary') return `${rec.event} ${JSON.stringify(rec.data ?? {})}`
  const item = rec.item
  if (item.type === 'function_call') return `${item.name ?? ''} ${item.arguments ?? ''}`
  if (typeof item.text === 'string') return item.text
  if (Array.isArray(item.content)) {
    return (item.content as Array<{ text?: string }>).map((c) => c?.text ?? '').join(' ')
  }
  return JSON.stringify(item)
}

/** 命中位置前后各留一点上下文，别把整段 12k 的工具回执塞进检索结果。 */
function excerptOf(text: string, query: string | null, span = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!query) return flat.slice(0, span * 2)
  const at = flat.toLowerCase().indexOf(query.toLowerCase())
  if (at < 0) return flat.slice(0, span)
  const from = Math.max(0, at - span)
  return `${from > 0 ? '…' : ''}${flat.slice(from, at + query.length + span)}${at + query.length + span < flat.length ? '…' : ''}`
    .trim()
}

export function searchTranscript(dataDir: string, opts: TranscriptSearchOptions = {}): TranscriptSearchPage {
  const want = Math.round(Number(opts.limit))
  const limit = Math.max(1, Math.min(200, Number.isFinite(want) && want > 0 ? want : 40))
  const query = typeof opts.query === 'string' && opts.query.trim() ? opts.query.trim() : null
  const date = typeof opts.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : null
  const role = opts.role ?? null
  const before = typeof opts.before === 'string' && opts.before ? opts.before : null
  const root = join(dataDir, 'runs')

  let runs: string[] = []
  try {
    runs = readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()
  } catch {
    return { hits: [], cursor: null, hasMore: false, scannedRuns: 0, matchingRuns: 0 }
  }
  if (date) runs = runs.filter((run) => runDate(run) === date)

  const hits: TranscriptHit[] = []
  let scannedRuns = 0
  let overflow = false
  let cursorAt = 0

  outer: for (let i = runs.length - 1; i >= 0; i--) {
    const run = runs[i]
    const file = join(root, run, 'transcript.jsonl')
    if (!existsSync(file)) continue
    scannedRuns++
    let lines: string[]
    try {
      lines = readFileSync(file, 'utf8').split('\n')
    } catch {
      continue
    }
    for (let seq = lines.length - 1; seq >= 0; seq--) {
      const line = lines[seq]
      if (!line || !line.trim()) continue
      let rec: TranscriptRecord
      try {
        rec = JSON.parse(line) as TranscriptRecord
      } catch {
        continue
      }
      const key = keyOf(run, seq)
      if (before && key >= before) continue
      const recRole = roleOf(rec)
      if (role && recRole !== role) continue
      const body = textOfRecord(rec)
      if (query && !body.toLowerCase().includes(query.toLowerCase())) continue
      hits.push({
        key, run, ts: rec.ts, role: recRole,
        excerpt: excerptOf(body, query),
        tool: rec.kind === 'item' && rec.item.type === 'function_call' ? (rec.item.name ?? null) : null,
      })
      if (hits.length > limit) { overflow = true; break outer }
    }
    cursorAt = i
  }

  const page = overflow ? hits.slice(0, limit) : hits
  return {
    hits: page,
    cursor: page.length ? page[page.length - 1].key : null,
    hasMore: overflow || (hits.length > 0 && cursorAt > 0),
    scannedRuns,
    matchingRuns: runs.length,
  }
}

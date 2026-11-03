/**
 * M4: 确定性记忆召回。
 *
 * 不用向量/embedding：不可复现、要外部依赖、也解释不了"为什么想起这条"。
 * 只用 4 个可解释信号，权重固定：
 *   - 关键词重叠 0.40（CJK 双字 + 拉丁词；按记忆集合内的 df 做 idf，越常见的词越不值钱）
 *   - 鲜活度     0.30
 *   - 情绪相近   0.15（记忆形成时的 valence 与当下 mood 的距离）
 *   - 新鲜度     0.15（30 天线性归零，与 memorySalience 一致）
 *
 * 另外给"意外槽"：从没被回想过的旧记忆里，按 hash(id + seed) 取固定条数。
 * 同一份状态 + 同一个 seed → 永远同一批结果；测试可以断言，线上可以复现。
 */
import type { Memory } from './types.ts'

export interface RecallContext {
  /** 当前情境文本（日记片段、因果描述等） */
  text?: string
  /** 额外的情境词（动作成因、活动名等） */
  terms?: string[]
  /** 当下 mood（-1..1），缺省 0 */
  mood?: number
  /** 意外槽的排序种子（建议传逻辑日，保证一天内稳定） */
  seed?: string
  /** 不参与召回的 id（例如刚引用过的） */
  excludeIds?: string[]
}

export interface RecallOptions extends RecallContext {
  now?: number
  /** 常规槽条数 */
  k?: number
  /** 意外槽条数（默认 2） */
  surprises?: number
}

export interface RecalledMemory {
  id: string
  content: string
  sender: 'player' | 'npc'
  createdAt: Date
  accessCount: number
  flashbulb: boolean
  score: number
  slot: 'core' | 'surprise'
  why: string[]
}

const DAY_MS = 86400_000

const round = (n: number) => Math.round(n * 1000) / 1000

/** 时间/功能词不参与关键词打分：它们几乎每条记忆都有，匹配上也不说明"有关"。 */
const STOP = new Set([
  '今天', '昨天', '明天', '现在', '刚才', '最近', '一个', '一些', '一下', '我们', '你们', '他们',
  '什么', '怎么', '觉得', '时候', '有点', '还是', '就是', '这个', '那个', '然后', '因为', '所以',
  '但是', '而且', '已经', '自己', '没有', '还有', '可以', '应该',
])

/** CJK 双字 + 拉丁/数字词；拉丁词要 ≥3 位，避免 "a" 之类的噪声。 */
export function tokensOf(text: string): string[] {
  const out: string[] = []
  const s = String(text ?? '').toLowerCase()
  for (const m of s.matchAll(/[\u4e00-\u9fff]{2,}/g)) {
    const run = m[0]
    for (let i = 0; i + 1 < run.length; i += 1) out.push(run.slice(i, i + 2))
  }
  for (const m of s.matchAll(/[a-z0-9_]{3,}/g)) out.push(m[0])
  return out
}

function msOf(d: Date | string | number): number {
  if (d instanceof Date) return d.getTime()
  const t = Date.parse(String(d))
  return Number.isFinite(t) ? t : NaN
}

/** FNV-1a：稳定、无依赖；只用来给意外槽排序。 */
function hash32(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function whyOf(m: Memory, parts: { kw: number; vivid: number; emo: number; days: number }): string[] {
  const why: string[] = []
  if (parts.kw > 0) why.push(`和眼下的事有关（${Math.round(parts.kw * 100)}%）`)
  if (m.flashbulb) why.push('刻在心里')
  if (parts.vivid >= 0.7) why.push(`鲜活 ${parts.vivid.toFixed(2)}`)
  if (parts.emo >= 0.9) why.push('当时的心情和现在接近')
  why.push(`${Math.max(0, Math.floor(parts.days))} 天前`)
  return why
}

/**
 * 召回一批记忆。纯函数：相同入参（含 now）必得相同顺序。
 */
export function recallMemories(memories: Memory[], opts: RecallOptions = {}): RecalledMemory[] {
  const now = opts.now ?? Date.now()
  const k = Math.max(0, Math.min(8, opts.k ?? 3))
  const surprises = Math.max(0, Math.min(4, opts.surprises ?? 2))
  const exclude = new Set(opts.excludeIds ?? [])
  const mood = Number.isFinite(opts.mood) ? Number(opts.mood) : 0
  const seed = String(opts.seed ?? '')

  // 作废过的记忆（#55）不再被想起：她写错的那条撤掉之后，不能还在下一轮浮上来。
  const pool = (memories ?? []).filter((m) => m && m.id && !exclude.has(m.id) && m.voided !== true)
  if (!pool.length || (k === 0 && surprises === 0)) return []

  // 1) 查询词：文本 + 额外词，去重；时间/功能词剔除
  const queryTokens = [...new Set([
    ...tokensOf(opts.text ?? ''),
    ...(opts.terms ?? []).flatMap((t) => tokensOf(t)),
  ])].filter((t) => !STOP.has(t))
  const querySet = new Set(queryTokens)

  // 2) 每个记忆的词表 + 整个集合的 df（用于 idf）
  const tokenSets = pool.map((m) => new Set(tokensOf(m.content)))
  const df = new Map<string, number>()
  for (const set of tokenSets) {
    for (const tok of set) if (querySet.has(tok)) df.set(tok, (df.get(tok) ?? 0) + 1)
  }
  const idf = (tok: string) => Math.log((pool.length + 1) / ((df.get(tok) ?? 0) + 1)) + 1
  // 归一化用"最值钱的那个词"：一句话里只提到一个具体意象（雨声），也该算强相关；
  // 用总和归一化会让长句里的单点命中被稀释成噪声。
  const maxIdf = queryTokens.reduce((m, tok) => Math.max(m, idf(tok)), 0)

  // 3) 打分
  const scored = pool.map((m, i) => {
    const created = msOf(m.createdAt)
    const days = Number.isFinite(created) ? Math.max(0, (now - created) / DAY_MS) : 999
    const vivid = Math.max(0, Math.min(1, Number(m.vividness ?? 0)))
    const valence = Number.isFinite(m.emotion?.valence) ? Number(m.emotion!.valence) : 0
    const emo = Math.max(0, 1 - Math.abs(valence - mood) / 2)
    const recency = Math.max(0, 1 - days / 30)
    let kw = 0
    if (maxIdf > 0) {
      let hit = 0
      for (const tok of querySet) if (tokenSets[i].has(tok)) hit += idf(tok)
      kw = Math.min(1, hit / maxIdf)
    }
    const score = 0.40 * kw + 0.30 * vivid + 0.15 * emo + 0.15 * recency
    return { m, days, vivid, emo, kw, score, accessCount: Number(m.accessCount ?? 0) }
  })

  // 4) 常规槽：分数降序，同分按 id 升序（稳定）
  const core = [...scored]
    .sort((a, b) => b.score - a.score || a.m.id.localeCompare(b.m.id))
    .slice(0, k)
    .map((s) => toRecalled(s, 'core', whyOf(s.m, s)))

  // 5) 意外槽：只在"至少 7 天、从没被想起过"的旧事里挑，按 hash(id + seed) 固定。
  //    不拿最近的事凑数——那叫主槽，不叫意外。
  const used = new Set(core.map((c) => c.id))
  const candidates = scored
    .filter((s) => !used.has(s.m.id) && s.days >= 7 && s.accessCount === 0 && !s.m.flashbulb)
    .sort((a, b) => (a.accessCount - b.accessCount)
      || (hash32(a.m.id + seed) - hash32(b.m.id + seed))
      || a.m.id.localeCompare(b.m.id))
  const surprise = candidates.slice(0, surprises).map((s) => {
    const why = whyOf(s.m, s)
    why.push(s.accessCount === 0 ? '一直没被想起' : '好久没想了')
    return toRecalled(s, 'surprise', why)
  })

  return [...core, ...surprise]
}

function toRecalled(
  s: { m: Memory; score: number },
  slot: 'core' | 'surprise',
  why: string[],
): RecalledMemory {
  return {
    id: s.m.id,
    content: String(s.m.content ?? ''),
    sender: s.m.sender === 'player' ? 'player' : 'npc',
    createdAt: s.m.createdAt instanceof Date ? s.m.createdAt : new Date(s.m.createdAt),
    accessCount: Number(s.m.accessCount ?? 0),
    flashbulb: s.m.flashbulb === true,
    score: round(s.score),
    slot,
    why,
  }
}

/** 近 N 天看过/聊过的 BV 与 UP：选片避重、文案回扣都用它。 */
export function watchedFromMemories(
  memories: Memory[],
  now = Date.now(),
  days = 7,
): { bvs: string[]; ups: string[]; upCounts: Record<string, number> } {
  const cut = now - days * DAY_MS
  const bvs = new Set<string>()
  const upCounts: Record<string, number> = {}
  for (const m of memories ?? []) {
    const t = msOf(m.createdAt)
    if (!Number.isFinite(t) || t < cut) continue
    const content = String(m.content ?? '')
    for (const bv of content.matchAll(/\bBV[0-9A-Za-z]{8,}\b/g)) bvs.add(bv[0])
    const up = content.match(/（([^）]{1,40})）\s*——/) ?? content.match(/\(([^)]{1,40})\)\s*——/)
    if (up) {
      const name = up[1].trim()
      // 同 UP 第几条：她 10-30 立的规矩是"第 N 条不深读"，光给名单数不出 N
      upCounts[name] = (upCounts[name] ?? 0) + 1
    }
  }
  return { bvs: [...bvs], ups: Object.keys(upCounts), upCounts }
}

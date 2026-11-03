/**
 * 判断卡（judgment.jsonl）与意见箱（feedback.jsonl）宿主无关实现。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dayKey } from '../../persona-core/src/rhythm.ts'

export const SCOPES = ['feed', 'draft', 'dm', 'any'] as const
export const STANCES = ['prefer', 'avoid', 'noise'] as const
export type JudgmentScope = (typeof SCOPES)[number]
export type JudgmentStance = (typeof STANCES)[number]
export type JudgmentVerdict = 'keep' | 'drop' | 'unclear'

const STOP_WORDS = new Set([
  '这个', '那个', '什么', '自己', '可以', '就是', '一个', '一天', '今天', '昨天', '现在', '其实',
  '不是', '没有', '一下', '一点', '这么', '那么', '还是', '因为', '所以', '但是', '如果', '这样', '那样',
])

export function normalizeTokens(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[·、,，\s]+/)
  const out: string[] = []
  for (const item of list) {
    const t = String(item ?? '').trim()
    if (!t || [...t].length < 2 || [...t].length > 12) continue
    if (STOP_WORDS.has(t)) continue
    if (/[的吗呢吧啊呀嘛了哦哈]$/.test(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out.slice(0, 6)
}

function readJsonl(file: string): any[] {
  try {
    return fs.readFileSync(file, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch {
    return []
  }
}

function appendJsonl(file: string, entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(entry) + '\n', 'utf8')
}

export interface JudgmentItem {
  id: string
  at: string
  day: string
  scope: JudgmentScope
  stance: JudgmentStance
  verdict: JudgmentVerdict
  tokens: string[]
  reason: string
  bvid: string
  status: 'proposed' | 'adopted' | 'rejected' | 'retired'
  adoptedAt: string | null
  rejectedWhy: string | null
  ownerNote: string | null
}

export function listJudgments(
  file: string,
  opts: { status?: string; verdict?: JudgmentVerdict; query?: string; limit?: number } = {},
): {
  ok: true
  proposed: number
  adopted: number
  rejected: number
  total: number
  items: JudgmentItem[]
} {
  const entries = readJsonl(file)
  const adopted = new Map<string, any>()
  const rejected = new Map<string, any>()
  const overrides = new Map<string, { verdict?: JudgmentVerdict; note?: string; status?: string }>()
  for (const e of entries) {
    if (e.kind === 'judgment-adopted') adopted.set(String(e.id), e)
    if (e.kind === 'judgment-rejected') rejected.set(String(e.id), e)
    if (e.kind === 'judgment-owner-upsert') overrides.set(String(e.id), e)
  }

  const baseItems: JudgmentItem[] = entries
    .filter((e) => e.kind === 'judgment')
    .map((e) => {
      const id = String(e.id)
      const ov = overrides.get(id)
      const stance: JudgmentStance = STANCES.includes(e.stance) ? e.stance : 'prefer'
      const defaultVerdict: JudgmentVerdict =
        e.verdict === 'keep' || e.verdict === 'drop' || e.verdict === 'unclear'
          ? e.verdict
          : stance === 'prefer' ? 'keep' : stance === 'avoid' ? 'drop' : 'unclear'
      const verdict = ov?.verdict ?? defaultVerdict
      const state: JudgmentItem['status'] =
        ov?.status === 'adopted' || adopted.has(id)
          ? 'adopted'
          : ov?.status === 'rejected' || rejected.has(id)
          ? 'rejected'
          : 'proposed'
      return {
        id,
        at: String(e.at ?? ''),
        day: String(e.day ?? ''),
        scope: SCOPES.includes(e.scope) ? e.scope : 'feed',
        stance,
        verdict,
        tokens: normalizeTokens(e.tokens),
        reason: String(ov?.note ?? e.reason ?? '').slice(0, 200),
        bvid: typeof e.bvid === 'string' ? e.bvid : '',
        status: state,
        adoptedAt: adopted.get(id)?.at ?? null,
        rejectedWhy: rejected.has(id) ? String(rejected.get(id)?.why ?? '') : null,
        ownerNote: ov?.note ?? null,
      }
    })

  // 包含主人直接新增（不在原 judgment 里的）条目
  for (const [id, ov] of overrides.entries()) {
    if (!baseItems.some((x) => x.id === id)) {
      baseItems.push({
        id,
        at: new Date().toISOString(),
        day: dayKey(Date.now()),
        scope: 'feed',
        stance: ov.verdict === 'keep' ? 'prefer' : ov.verdict === 'drop' ? 'avoid' : 'noise',
        verdict: ov.verdict ?? 'unclear',
        tokens: normalizeTokens(ov.note ?? id),
        reason: String(ov.note ?? ''),
        bvid: '',
        status: 'adopted',
        adoptedAt: new Date().toISOString(),
        rejectedWhy: null,
        ownerNote: ov.note ?? null,
      })
    }
  }

  const q = opts.query?.trim().toLowerCase() ?? ''
  const filtered = baseItems.filter((x) => {
    if (opts.status && opts.status !== 'all' && x.status !== opts.status) return false
    if (opts.verdict && x.verdict !== opts.verdict) return false
    if (q && !x.reason.toLowerCase().includes(q) && !x.bvid.toLowerCase().includes(q) && !x.tokens.some((t) => t.toLowerCase().includes(q))) {
      return false
    }
    return true
  })
  const limit = opts.limit ?? 50
  return {
    ok: true,
    proposed: baseItems.filter((x) => x.status === 'proposed').length,
    adopted: baseItems.filter((x) => x.status === 'adopted').length,
    rejected: baseItems.filter((x) => x.status === 'rejected').length,
    total: baseItems.length,
    items: filtered.slice(-limit).reverse(),
  }
}

export function appendJudgment(
  input: {
    scope?: string
    stance?: string
    verdict?: JudgmentVerdict
    tokens?: string[] | string
    reason: string
    bvid?: string
  },
  file: string,
): { ok: true; id: string; at: string; tokens: string[]; stance: JudgmentStance; scope: JudgmentScope } | { ok: false; error: string } {
  const scope = String(input?.scope ?? 'feed') as JudgmentScope
  if (!SCOPES.includes(scope)) return { ok: false, error: `scope 只能是 ${SCOPES.join(' / ')}` }
  const stance = String(input?.stance ?? (input?.verdict === 'drop' ? 'avoid' : 'prefer')) as JudgmentStance
  if (!STANCES.includes(stance)) return { ok: false, error: `stance 只能是 ${STANCES.join(' / ')}` }
  const tokens = normalizeTokens(input?.tokens)
  if (!tokens.length) return { ok: false, error: 'tokens 至少要有一个 2–12 字的词（停用词不算）' }
  const reason = String(input?.reason ?? '').trim()
  if (reason.length < 6) return { ok: false, error: '理由太短（≥6 字）' }
  if (reason.length > 200) return { ok: false, error: '理由太长（>200 字）' }
  const id = 'j-' + crypto.randomBytes(3).toString('hex')
  const at = new Date().toISOString()
  appendJsonl(file, {
    id,
    kind: 'judgment',
    at,
    atMs: Date.now(),
    day: dayKey(Date.now()),
    scope,
    stance,
    verdict: input.verdict ?? (stance === 'prefer' ? 'keep' : stance === 'avoid' ? 'drop' : 'unclear'),
    tokens,
    reason,
    ...(input.bvid ? { bvid: input.bvid.trim() } : {}),
    status: 'proposed',
  })
  return { ok: true, id, at, tokens, stance, scope }
}

export function upsertJudgmentByOwner(
  file: string,
  input: { id?: string; verdict: JudgmentVerdict; note: string; status?: 'adopted' | 'rejected' | 'proposed' },
): { ok: true; id: string; verdict: JudgmentVerdict; note: string } | { ok: false; error: string } {
  if (input.verdict !== 'keep' && input.verdict !== 'drop' && input.verdict !== 'unclear') {
    return { ok: false, error: 'verdict 只能是 keep / drop / unclear' }
  }
  const id = input.id?.trim() || 'j-' + crypto.randomBytes(3).toString('hex')
  const note = String(input.note ?? '').trim()
  appendJsonl(file, {
    kind: 'judgment-owner-upsert',
    id,
    verdict: input.verdict,
    note,
    status: input.status ?? 'adopted',
    at: new Date().toISOString(),
    atMs: Date.now(),
    by: 'owner',
  })
  return { ok: true, id, verdict: input.verdict, note }
}

export interface FeedbackItem {
  id: string
  at: string
  day: string
  issue: string
  severity: 'low' | 'high'
  selfHandled: boolean
  note: string
  resolved: boolean
  resolvedBy: string | null
  ownerReply: string | null
  convertedRule: { kind: string; value: string } | null
}

export function listFeedback(
  file: string,
  opts: { status?: 'open' | 'resolved' | 'all'; limit?: number } = {},
): { ok: true; openCount: number; total: number; items: FeedbackItem[] } {
  const entries = readJsonl(file)
  const resolvedMap = new Map<string, any>()
  const replyMap = new Map<string, { ownerReply?: string; convertedRule?: { kind: string; value: string } }>()
  for (const e of entries) {
    if (e.kind === 'feedback-resolved') resolvedMap.set(String(e.id), e)
    if (e.kind === 'feedback-owner-reply') replyMap.set(String(e.id), e)
  }
  const items: FeedbackItem[] = entries
    .filter((e) => e.kind === 'feedback')
    .map((e) => {
      const id = String(e.id)
      const res = resolvedMap.get(id)
      const rep = replyMap.get(id)
      return {
        id,
        at: String(e.at ?? ''),
        day: String(e.day ?? ''),
        issue: String(e.issue ?? '').slice(0, 200),
        severity: e.severity === 'high' ? 'high' : 'low',
        selfHandled: Boolean(e.selfHandled),
        note: String(e.note ?? '').slice(0, 300),
        resolved: Boolean(res),
        resolvedBy: res ? String(res.resolvedBy ?? 'owner') : null,
        ownerReply: rep?.ownerReply ?? null,
        convertedRule: rep?.convertedRule ?? null,
      }
    })
  const openCount = items.filter((x) => !x.resolved).length
  const status = opts.status ?? 'open'
  const filtered =
    status === 'all'
      ? items
      : status === 'resolved'
      ? items.filter((x) => x.resolved)
      : items.filter((x) => !x.resolved)
  const limit = opts.limit ?? 50
  return {
    ok: true,
    openCount,
    total: items.length,
    items: filtered.slice(-limit).reverse(),
  }
}

export function appendFeedback(
  input: { issue: string; severity?: 'low' | 'high'; selfHandled?: boolean; note?: string },
  file: string,
): { ok: true; id: string; at: string } | { ok: false; error: string } {
  const text = String(input?.issue ?? '').trim()
  if (!text) return { ok: false, error: 'issue 是空的' }
  if (text.length > 500) return { ok: false, error: 'issue 太长（>500 字）' }
  const id = 'f-' + crypto.randomBytes(3).toString('hex')
  const at = new Date().toISOString()
  appendJsonl(file, {
    id,
    kind: 'feedback',
    at,
    atMs: Date.now(),
    day: dayKey(Date.now()),
    issue: text,
    severity: input.severity === 'high' ? 'high' : 'low',
    selfHandled: Boolean(input.selfHandled),
    note: String(input.note ?? '').slice(0, 300),
  })
  return { ok: true, id, at }
}

export function replyFeedbackByOwner(
  file: string,
  input: {
    id: string
    ownerReply?: string
    resolve?: boolean
    convertRule?: { kind: 'dislike' | 'keyword' | 'exemptUp'; value: string }
  },
  onConvertRule?: (rule: { kind: 'dislike' | 'keyword' | 'exemptUp'; value: string }) => void,
): { ok: true; id: string; resolved: boolean; ownerReply: string | null } | { ok: false; error: string } {
  const target = String(input?.id ?? '').trim()
  if (!target) return { ok: false, error: '缺 id' }
  const all = listFeedback(file, { status: 'all', limit: Number.MAX_SAFE_INTEGER }).items
  if (!all.some((x) => x.id === target)) {
    return { ok: false, error: `找不到意见箱条目: ${target}` }
  }
  const ownerReply = input.ownerReply?.trim() || undefined
  if (ownerReply || input.convertRule) {
    appendJsonl(file, {
      kind: 'feedback-owner-reply',
      id: target,
      at: new Date().toISOString(),
      atMs: Date.now(),
      ...(ownerReply ? { ownerReply } : {}),
      ...(input.convertRule ? { convertedRule: input.convertRule } : {}),
    })
  }
  if (input.convertRule && onConvertRule) {
    onConvertRule(input.convertRule)
  }
  const shouldResolve = input.resolve !== false
  if (shouldResolve) {
    appendJsonl(file, {
      kind: 'feedback-resolved',
      id: target,
      at: new Date().toISOString(),
      atMs: Date.now(),
      resolvedBy: 'owner',
    })
  }
  return { ok: true, id: target, resolved: shouldResolve, ownerReply: ownerReply ?? null }
}

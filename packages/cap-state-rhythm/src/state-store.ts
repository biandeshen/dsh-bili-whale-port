/**
 * 状态与场值存储（原子写 + .bak 恢复 + 预设效果 + 看片三值结论 + 主人直接滑块干预）。
 * 100% 宿主无关，只依赖 @xiaoyu/persona-core 与 node:fs。
 */
import fs from 'node:fs'
import path from 'node:path'
import { EffectBus } from '../../persona-core/src/effect-bus.ts'
import type { AtomicFields, CausalEvent, Memory } from '../../persona-core/src/types.ts'
import { clamp, DEFAULT_ATOMIC_FIELDS } from '../../persona-core/src/types.ts'
import { recordFieldChangeL0 } from '../../persona-core/src/causal-chain.ts'
import { decayMemory, calculateEncodingStrength, recallMemory, voidMemories } from '../../persona-core/src/memory.ts'
import { recallMemories, watchedFromMemories } from '../../persona-core/src/retrieval.ts'
import { simulateOfflineTime } from '../../persona-core/src/decay.ts'
import { createInitialState, deriveNPCState } from '../../persona-core/src/npc-state-machine.ts'
import { readMood } from '../../persona-core/src/emotion.ts'
import type { MoodLabel } from '../../persona-core/src/emotion.ts'
import { applyBudgets, emptyBudget, type BudgetLedger } from '../../persona-core/src/budget.ts'

export { readMood }
export type { MoodLabel }

export interface PersonaState {
  fields: AtomicFields
  chain: CausalEvent[]
  memories: Memory[]
  npcState: ReturnType<typeof createInitialState>
  budget: BudgetLedger
  emotionHistory: AtomicFields[]
  lastAppliedAt: string
}

export interface PresetEffect {
  field: keyof AtomicFields
  delta: number
  source: string
  priority: number
}

export const PRESETS: Record<string, { effects: PresetEffect[]; description: string; layer?: 'L0' }> = {
  watchedVideo: {
    description: '看完一条',
    effects: [
      { field: 'curiosity', delta: +0.03, source: 'watched', priority: 5 },
      { field: 'stimulation', delta: +0.12, source: 'watched', priority: 5 },
      { field: 'mood', delta: +0.05, source: 'watched', priority: 4 },
      { field: 'energy', delta: -0.02, source: 'watched', priority: 3 },
    ],
  },
  inbound: {
    description: '主人来信了',
    effects: [
      { field: 'mood', delta: +0.06, source: 'inbound', priority: 9 },
      { field: 'connection', delta: +0.07, source: 'inbound', priority: 9 },
      { field: 'social', delta: +0.02, source: 'inbound', priority: 5 },
    ],
  },
  masterReplied: {
    description: '主人回我了',
    effects: [
      { field: 'mood', delta: +0.08, source: 'master-reply', priority: 9 },
      { field: 'connection', delta: +0.10, source: 'master-reply', priority: 9 },
      { field: 'social', delta: +0.03, source: 'master-reply', priority: 5 },
    ],
  },
  masterSilentDay: {
    description: '主人一整天没说话',
    effects: [
      { field: 'connection', delta: -0.05, source: 'silence', priority: 8 },
      { field: 'mood', delta: -0.03, source: 'silence', priority: 8 },
    ],
  },
  draftApproved: {
    description: '草稿被主人放行',
    effects: [
      { field: 'mood', delta: +0.05, source: 'draft-ok', priority: 7 },
      { field: 'creativity', delta: +0.03, source: 'draft-ok', priority: 5 },
    ],
  },
  draftRejected: {
    description: '草稿被主人拒绝',
    effects: [
      { field: 'mood', delta: -0.04, source: 'draft-no', priority: 7 },
      { field: 'creativity', delta: -0.02, source: 'draft-no', priority: 5 },
    ],
  },
  trafficPaused: {
    description: '撞到平台风控，暂停了',
    effects: [
      { field: 'energy', delta: -0.03, source: 'risk', priority: 9 },
      { field: 'mood', delta: -0.02, source: 'risk', priority: 9 },
    ],
  },
}

export type WatchVerdict = 'keep' | 'drop' | 'unclear'

export const WATCH_VERDICTS: Record<WatchVerdict, {
  label: string; source: string; description: string; effects: PresetEffect[]
}> = {
  keep: {
    label: '收', source: 'watchedKeep', description: '看完一条，收了',
    effects: PRESETS.watchedVideo.effects,
  },
  drop: {
    label: '不收', source: 'watchedDrop', description: '看完一条，没收',
    effects: [{ field: 'energy', delta: -0.02, source: 'watched', priority: 3 }],
  },
  unclear: {
    label: '无从判断', source: 'watchedUnclear', description: '看完一条，没判断出来',
    effects: [{ field: 'energy', delta: -0.02, source: 'watched', priority: 3 }],
  },
}

export const WATCH_VERDICT_IDS = Object.keys(WATCH_VERDICTS) as WatchVerdict[]

export function emptyState(): PersonaState {
  return {
    fields: { ...DEFAULT_ATOMIC_FIELDS },
    chain: [],
    memories: [],
    npcState: createInitialState(),
    budget: emptyBudget(),
    emotionHistory: [],
    lastAppliedAt: new Date().toISOString(),
  }
}

const STATE_SCHEMA_VERSION = 5
const HISTORY_LIMIT = 200
const EMOTION_HISTORY_LIMIT = 24

function normalizeState(raw: any): PersonaState {
  if (!raw || typeof raw !== 'object' || !raw.fields || typeof raw.fields !== 'object' || !raw.npcState) {
    throw new Error('state shape invalid')
  }
  const version = Number(raw.schemaVersion ?? 1)
  if (!Number.isInteger(version) || version < 1 || version > STATE_SCHEMA_VERSION) {
    throw new Error('state schema unsupported: ' + String(raw.schemaVersion))
  }
  const ns = raw.npcState ?? {}
  const spent: Record<string, number> = {}
  if (raw.budget?.spent && typeof raw.budget.spent === 'object') {
    for (const [k, v] of Object.entries(raw.budget.spent)) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) spent[String(k)] = n
    }
  }
  const isVector = (v: any) => v && typeof v === 'object'
    && (Object.keys(DEFAULT_ATOMIC_FIELDS) as Array<keyof AtomicFields>).every((k) => Number.isFinite(Number(v[k])))
  const emotionHistory: AtomicFields[] = Array.isArray(raw.emotionHistory)
    ? raw.emotionHistory.filter(isVector).map((v: any) => {
        const out = { ...DEFAULT_ATOMIC_FIELDS }
        for (const k of Object.keys(DEFAULT_ATOMIC_FIELDS) as Array<keyof AtomicFields>) out[k] = Number(v[k])
        return out
      }).slice(-EMOTION_HISTORY_LIMIT)
    : []
  return {
    fields: { ...DEFAULT_ATOMIC_FIELDS, ...raw.fields },
    chain: (raw.chain ?? []).map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) })),
    memories: (raw.memories ?? []).map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) })),
    npcState: {
      current: ns.current ?? 'unjudged',
      connectionBelowThresholdSince: ns.connectionBelowThresholdSince ?? null,
      lastUserMessageAt: ns.lastUserMessageAt ?? null,
      bond: { level: Number.isFinite(ns.bond?.level) ? ns.bond.level : 0.2 },
      bondAtColdWarStart: ns.bondAtColdWarStart ?? null,
    },
    budget: { day: typeof raw.budget?.day === 'string' ? raw.budget.day : '', spent },
    emotionHistory,
    lastAppliedAt: raw.lastAppliedAt ?? new Date().toISOString(),
  }
}

export function loadState(file: string): PersonaState {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    if (fs.existsSync(file)) {
      const corrupt = file + '.corrupt-' + Date.now()
      try { fs.renameSync(file, corrupt) } catch {}
      try {
        const fromBak = normalizeState(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')))
        return fromBak
      } catch {}
    }
    return emptyState()
  }
}

export function saveState(file: string, s: PersonaState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const chain = s.chain.slice(-HISTORY_LIMIT)
  const kept = new Set(chain.map((e) => e.id))
  const trimmed = chain.map((e) => (e.triggerId && !kept.has(e.triggerId) ? { ...e, triggerId: undefined } : e))
  const slim = {
    schemaVersion: STATE_SCHEMA_VERSION,
    fields: s.fields,
    chain: trimmed,
    memories: s.memories.slice(-HISTORY_LIMIT),
    npcState: s.npcState,
    budget: s.budget,
    emotionHistory: (s.emotionHistory ?? []).slice(-EMOTION_HISTORY_LIMIT),
    lastAppliedAt: s.lastAppliedAt,
  }
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(slim, null, 2))
  try { fs.copyFileSync(file, file + '.bak') } catch {}
  fs.renameSync(tmp, file)
}

export function applyEffects(
  s: PersonaState,
  effects: PresetEffect[],
  description: string,
  opts: { now?: number; source?: string; userJustMessaged?: boolean } = {},
): PersonaState {
  const now = opts.now ?? Date.now()
  const source = opts.source ?? 'custom'
  const elapsedMs = Math.max(0, now - Date.parse(s.lastAppliedAt))
  const days = elapsedMs / 86400_000
  const memories = days > 0 ? s.memories.map((m) => decayMemory(m, days)) : s.memories

  const chain = [...s.chain]
  const before = { ...s.fields }
  const decayed = simulateOfflineTime(before, elapsedMs)
  for (const f of Object.keys(decayed) as (keyof AtomicFields)[]) {
    const ev = recordFieldChangeL0('xiaoyu', f, before[f], decayed[f], '时间流逝（自然衰减）', chain)
    if (ev) ev.source = 'decay'
  }

  const budgeted = applyBudgets(effects, s.budget, now)
  const bus = new EffectBus()
  bus.collectAll(budgeted.effects.map((e) => ({ ...e })))
  const after = bus.apply(decayed, bus.resolve())

  for (const f of Object.keys(after) as (keyof AtomicFields)[]) {
    const ev = recordFieldChangeL0('xiaoyu', f, decayed[f], after[f], description, chain)
    if (ev) ev.source = source
  }

  const npcState = deriveNPCState(after, s.npcState, now, opts.userJustMessaged === true).newState
  const prevApplied = Date.parse(s.lastAppliedAt)
  const stamp = Number.isFinite(prevApplied) ? Math.max(now, prevApplied) : now
  const emotionHistory = [...(s.emotionHistory ?? []), { ...after }].slice(-EMOTION_HISTORY_LIMIT)
  return { fields: after, chain, memories, npcState, budget: budgeted.ledger, emotionHistory, lastAppliedAt: new Date(stamp).toISOString() }
}

export function applyEvent(s: PersonaState, presetName: string, now = Date.now()): PersonaState {
  const preset = PRESETS[presetName]
  if (!preset) return s
  return applyEffects(s, preset.effects, preset.description, {
    now,
    source: presetName,
    userJustMessaged: presetName === 'masterReplied' || presetName === 'inbound',
  })
}

/**
 * 主人在鱼缸遥控台上直接拉滑块修改场值（不受模型每日预算限制，自动夹紧范围并记录 owner_adjust 因果链）。
 */
export function setFieldsDirect(
  s: PersonaState,
  patch: Partial<AtomicFields>,
  note = '主人在面板手动调节场值',
  now = Date.now(),
): PersonaState {
  const nextFields: AtomicFields = { ...s.fields }
  const chain = [...s.chain]
  for (const k of Object.keys(DEFAULT_ATOMIC_FIELDS) as Array<keyof AtomicFields>) {
    if (patch[k] !== undefined && Number.isFinite(Number(patch[k]))) {
      const min = k === 'mood' ? -1 : 0
      const clamped = clamp(Number(patch[k]), min, 1)
      const prev = nextFields[k]
      nextFields[k] = clamped
      const ev = recordFieldChangeL0('xiaoyu', k, prev, clamped, note, chain)
      if (ev) ev.source = 'owner_adjust'
    }
  }
  const emotionHistory = [...(s.emotionHistory ?? []), { ...nextFields }].slice(-EMOTION_HISTORY_LIMIT)
  return {
    ...s,
    fields: nextFields,
    chain,
    emotionHistory,
    lastAppliedAt: new Date(Math.max(now, Date.parse(s.lastAppliedAt) || 0)).toISOString(),
  }
}

export interface RememberOptions {
  sender?: 'player' | 'npc'
  intensity?: number
  tags?: string[]
  source?: Memory['source']
  milestone?: boolean
}

export function remember(s: PersonaState, content: string, opts: RememberOptions = {}): PersonaState {
  const intensity = opts.intensity ?? 0.5
  const tags = opts.tags ?? []
  const milestone = opts.milestone === true || tags.includes('milestone')
  const m: Memory = {
    id: 'mem-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    npcId: 'xiaoyu',
    sender: opts.sender ?? 'player',
    content,
    emotion: { valence: s.fields.mood, intensity, tags },
    tags,
    vividness: 0.9,
    accessCount: 0,
    createdAt: new Date(),
    encodingStrength: calculateEncodingStrength(intensity),
    flashbulb: milestone,
    source: opts.source ?? 'npc_self',
  }
  return { ...s, memories: [...s.memories, m] }
}

export function rememberFirst(
  s: PersonaState,
  content: string,
  tag: string,
  opts: Omit<RememberOptions, 'milestone'> = {},
): PersonaState {
  const first = !s.memories.some((m) => (m.tags ?? []).includes(tag))
  return remember(s, content, { ...opts, tags: [...(opts.tags ?? []), tag], milestone: first })
}

export function findMemories(s: PersonaState, sel: { id?: string; match?: string }): Memory[] {
  const ms = s.memories ?? []
  if (sel.id) return ms.filter((m) => m.id === sel.id)
  const q = String(sel.match ?? '').trim().toLowerCase()
  if (!q) return []
  return ms.filter((m) => String(m.content ?? '').toLowerCase().includes(q))
}

export function voidMemory(s: PersonaState, id: string, reason: string, now = Date.now()): PersonaState {
  const { memories, voidedIds } = voidMemories(s.memories, [id], reason, now)
  return voidedIds.length ? { ...s, memories } : s
}

const RELATION_LABEL: Record<string, string> = {
  unjudged: '未判定（还没有过回信）',
  normal: '平常',
  cold_war: '冷战',
  missing: '想念',
  repairing: '修补中',
  reunion: '重逢',
}

export function describeState(s: PersonaState, limit = 5, opts: { queryText?: string; seed?: string } = {}): string {
  return describeStateWithTrace(s, limit, opts).text
}

export function describeStateWithTrace(
  s: PersonaState,
  limit = 5,
  opts: { queryText?: string; seed?: string; live?: boolean } = {},
): { text: string; recalledIds: string[] } {
  const f = s.fields
  const pct = (n: number) => Math.round(n * 100)
  const rel = RELATION_LABEL[s.npcState?.current ?? ''] ?? s.npcState?.current ?? 'normal'
  const m = readMood(s)
  const secondary = m.secondary.length ? '，还有点' + m.secondary.join('、') : ''
  const recentChain = [...s.chain].reverse().slice(0, limit)
  const recent = recentChain
    .map((e) => `- ${e.description}（${e.fieldChanges.map((c) => `${c.field} ${c.from.toFixed(2)}→${c.to.toFixed(2)}`).join('，')}）`)
  const nowMs = Date.now()
  const context = [opts.queryText ?? '', ...recentChain.filter((e) => e.source !== 'decay').map((e) => e.description)]
    .filter(Boolean).join(' ')
  const picked = recallMemories(s.memories, {
    now: nowMs,
    k: 3,
    surprises: 1,
    text: context,
    mood: f.mood,
    seed: opts.seed,
  })
  const mems = picked.map((r) => {
    const who = r.sender === 'player' ? '主人' : '我'
    const head = r.slot === 'surprise' ? '忽然想起' : '记得'
    const title = r.content.startsWith('看过《') ? (r.content.match(/看过《([^》]+)》/) || [])[1] : ''
    const shown = title
      ? '看过《' + title.split(/[Ⅰ|｜]/)[0].trim().slice(0, 24) + '》'
      : r.content.slice(0, 40)
    return `- ${head}｜${who}：${shown}${r.flashbulb ? '（刻在心里）' : ''}`
  })
  /**
   * 场值那一行要不要带具体数字（`live` 开关）。
   *
   * 为什么要有这个开关（审计 §1.4，主人同屏看到「体力38」和「体力88」）：
   *   · 会话级前缀（`contextSegments`）宿主**整场只建一次**（loop.ts:1020 新会话、
   *     :1717 交接），于是长会话里前缀里的体力是**旧值**；
   *   · 每事件级注入（`onMessageDelivery`）每次都重读，是**新值**；
   *   · 两个都在同一次请求里，她就拿到了自相矛盾的身体状态（38 与 88 同时在场）。
   *
   * 所以：**会话级前缀不带数字**（只说"具体数值随每条消息一起到"），
   * **每事件注入才带数字**——同一份数据、同一时刻，不会打架。
   */
  const stateLine = opts.live === false
    ? '【状态】具体数值随每条消息一起到（体力/刺激/连接/社交/心情/好奇/创造）｜关系：' + rel
    : `【状态】体力${pct(f.energy)} 刺激${pct(f.stimulation)} 连接${pct(f.connection)} 社交${pct(f.social)} `
      + `心情${f.mood.toFixed(2)} 好奇${pct(f.curiosity)} 创造${pct(f.creativity)}｜关系：${rel}`
  return {
    text: [
      `【她现在的情绪】${m.primary}${secondary}（成因：${m.reason}）`,
      m.inner,
      stateLine,
      recent.length ? '最近发生：\n' + recent.join('\n') : '最近没什么特别的。',
      mems.length ? '记得：\n' + mems.join('\n') : '',
    ].filter(Boolean).join('\n'),
    recalledIds: picked.map((r) => r.id),
  }
}

export function applyRecall(s: PersonaState, ids: string[]): PersonaState {
  if (!ids.length) return s
  const hit = new Set(ids)
  return { ...s, memories: s.memories.map((m) => (hit.has(m.id) ? recallMemory(m) : m)) }
}

export function recentWatch(s: PersonaState, days = 7): { bvs: string[]; ups: string[]; upCounts: Record<string, number> } {
  return watchedFromMemories(s.memories, Date.now(), days)
}

export function annotateFeed(
  out: string,
  recent: { bvs: string[]; ups: string[]; upCounts?: Record<string, number> },
): string {
  const seen = new Set(recent.bvs)
  const counts = recent.upCounts ?? {}
  const lines = String(out ?? '').split(/\r?\n/).map((line) => {
    const marks: string[] = []
    const bv = (line.match(/\bBV[0-9A-Za-z]{8,}\b/) || [])[0]
    if (bv && seen.has(bv)) marks.push('近 7 天看过')
    const sec = Number((line.match(/(\d+)\s*s\b/) || [])[1] ?? NaN)
    if (Number.isFinite(sec) && sec > 0 && sec < 600) marks.push('短于10分钟：跳过')
    else if (Number.isFinite(sec) && sec >= 600 && sec < 1200) marks.push('短于20分钟：降级')
    const up = (line.match(/@(\S+)/) || [])[1]
    const n = up ? Number(counts[up] ?? 0) : 0
    if (n > 0) marks.push(`同UP第${n + 1}条：不深读`)
    return marks.length ? line + marks.map((m) => `  [${m}]`).join('') : line
  })
  const parts: string[] = []
  if (recent.bvs.length) parts.push(`近 7 天看过 ${recent.bvs.length} 条`)
  if (recent.ups.length) parts.push(`最近的 UP：${recent.ups.slice(0, 3).join('、')}（挑片时避开同题材/同 UP）`)
  return lines.join('\n') + (parts.length ? '\n' + parts.join('；') : '')
}

/**
 * World ↔ persona-core 适配层。
 * World 只依赖这里的四个函数；内部用 AMpath 人核心（EffectBus + 因果链 + 记忆 + 关系机）。
 *
 * 状态文件（WHALE_HOME/bili-whale/fields.json）:
 *   { fields, chain(最近200条), memories(最近200条), npcState, lastAppliedAt }
 */
import fs from 'node:fs'
import path from 'node:path'
import { EffectBus } from '../../../persona-core/src/effect-bus.ts'
import type { AtomicFields, CausalEvent, Memory } from '../../../persona-core/src/types.ts'
import { DEFAULT_ATOMIC_FIELDS } from '../../../persona-core/src/types.ts'
import { recordFieldChangeL0 } from '../../../persona-core/src/causal-chain.ts'
import { decayMemory, calculateEncodingStrength, recallMemory } from '../../../persona-core/src/memory.ts'
import { recallMemories, watchedFromMemories } from '../../../persona-core/src/retrieval.ts'
import { simulateOfflineTime } from '../../../persona-core/src/decay.ts'
import { createInitialState, deriveNPCState } from '../../../persona-core/src/npc-state-machine.ts'
import { readMood } from '../../../persona-core/src/emotion.ts'
import type { MoodLabel } from '../../../persona-core/src/emotion.ts'
import { applyBudgets, emptyBudget, type BudgetLedger } from '../../../persona-core/src/budget.ts'

export { readMood }
export type { MoodLabel }

export interface PersonaState {
  fields: AtomicFields
  chain: CausalEvent[]
  memories: Memory[]
  npcState: ReturnType<typeof createInitialState>
  budget: BudgetLedger
  /** 近 N 次结算后的场值快照，供情绪强度做滑动参照 */
  emotionHistory: AtomicFields[]
  lastAppliedAt: string
}

export interface PresetEffect { field: keyof AtomicFields; delta: number; source: string; priority: number }

/** 预设事件 → 场值效果（可扩展；这是她的"反应表"） */
export const PRESETS: Record<string, { effects: PresetEffect[]; description: string; layer?: 'L0' }> = {
  watchedVideo: {
    // 2026-10-30 她的 OPS B1：文案中性化——「看完」≠「喜欢」。
    // 实测旧文案「看了一条喜欢的视频」只进 chain（fields.json 23 处/causal 9 处），
    // 从未进 memories（0 处）；中性化后 chain/最近发生不再替她下“喜欢”的结论。
    description: '看完一条',
    effects: [
      { field: 'curiosity', delta: +0.03, source: 'watched', priority: 5 },
      // 刺激量要盖过一天的自然衰减（0.12/天），否则永远停在"零刺激"耦合区
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

export function loadState(file: string): PersonaState {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch (e) {
    if (fs.existsSync(file)) {
      // 坏文件不静默清空：留档 + 用上一份好状态；两者都不行才从零开始。
      const corrupt = file + '.corrupt-' + Date.now()
      try { fs.renameSync(file, corrupt) } catch {}
      try {
        const fromBak = normalizeState(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')))
        console.error('[persona] state corrupt, recovered from backup; corrupt kept at ' + corrupt)
        return fromBak
      } catch {}
      console.error('[persona] state corrupt, no backup; corrupt kept at ' + corrupt)
    }
    return emptyState()
  }
}

const STATE_SCHEMA_VERSION = 5
const HISTORY_LIMIT = 200
const EMOTION_HISTORY_LIMIT = 24

function normalizeState(raw: any): PersonaState {
  // 结构不对（空对象/被别的程序覆盖）按坏文件处理，走备份恢复，而不是当真清空
  if (!raw || typeof raw !== 'object' || !raw.fields || typeof raw.fields !== 'object' || !raw.npcState) {
    throw new Error('state shape invalid')
  }
  // 版本号必须认得出：未来版本降级读取可能把字段读错（比如同一字段换了语义），
  // 宁可走备份恢复也不猜。没有版本号的是 v1 老文件，结构一致可以直接读。
  const version = Number(raw.schemaVersion ?? 1)
  if (!Number.isInteger(version) || version < 1 || version > STATE_SCHEMA_VERSION) {
    throw new Error('state schema unsupported: ' + String(raw.schemaVersion))
  }
  // 只保留当前 schema 认得的字段：老文件的 trustAtColdWarStart 等别名不往新对象里带
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

export function saveState(file: string, s: PersonaState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const chain = s.chain.slice(-HISTORY_LIMIT)
  // 截断后指向已丢事件的 triggerId 会变成悬空引用，清掉
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

/** 应用一批效果：先结算离线衰减，再走 EffectBus → 因果链 → 关系机。 */
export function applyEffects(
  s: PersonaState,
  effects: PresetEffect[],
  description: string,
  opts: { now?: number; source?: string; userJustMessaged?: boolean } = {},
): PersonaState {
  const now = opts.now ?? Date.now()
  const source = opts.source ?? 'custom'
  const elapsedMs = Math.max(0, now - Date.parse(s.lastAppliedAt))

  // 记忆按真实毫秒折成小数天衰减：生活循环每 3–7 分钟结算一次，
  // 旧实现要求"距上次 ≥1 天"才衰减，而 lastAppliedAt 每 tick 重置 → 记忆永远不淡（D-02）
  const days = elapsedMs / 86400_000
  const memories = days > 0 ? s.memories.map((m) => decayMemory(m, days)) : s.memories

  const chain = [...s.chain]
  const before = { ...s.fields }
  const decayed = simulateOfflineTime(before, elapsedMs)
  for (const f of Object.keys(decayed) as (keyof AtomicFields)[]) {
    const ev = recordFieldChangeL0('xiaoyu', f, before[f], decayed[f], '时间流逝（自然衰减）', chain)
    if (ev) ev.source = 'decay'
  }

  // 先过来源预算：同源同场按天封顶，超出部分当次截断（不是整条丢弃）
  const budgeted = applyBudgets(effects, s.budget, now)
  // 一个事件就是一个批次，同源效果必须全部生效：
  // 旧实现每次 new FrequencyGate(50)，同源第二条起被当成重复发射丢弃（连接感/社交永远加不上）。
  const bus = new EffectBus()
  bus.collectAll(budgeted.effects.map((e) => ({ ...e })))
  const after = bus.apply(decayed, bus.resolve())

  for (const f of Object.keys(after) as (keyof AtomicFields)[]) {
    const ev = recordFieldChangeL0('xiaoyu', f, decayed[f], after[f], description, chain)
    if (ev) ev.source = source
  }

  const npcState = deriveNPCState(after, s.npcState, now, opts.userJustMessaged === true).newState

  // 时钟回拨：lastAppliedAt 不能被写到过去，否则下一次会重复结算同一段时间
  const prevApplied = Date.parse(s.lastAppliedAt)
  const stamp = Number.isFinite(prevApplied) ? Math.max(now, prevApplied) : now
  const emotionHistory = [...(s.emotionHistory ?? []), { ...after }].slice(-EMOTION_HISTORY_LIMIT)
  return { fields: after, chain, memories, npcState, budget: budgeted.ledger, emotionHistory, lastAppliedAt: new Date(stamp).toISOString() }
}

/** 应用一个预设事件。 */
export function applyEvent(s: PersonaState, presetName: string, now = Date.now()): PersonaState {
  const preset = PRESETS[presetName]
  if (!preset) return s
  return applyEffects(s, preset.effects, preset.description, {
    now,
    source: presetName,
    userJustMessaged: presetName === 'masterReplied' || presetName === 'inbound',
  })
}

export interface RememberOptions {
  sender?: 'player' | 'npc'
  intensity?: number
  tags?: string[]
  source?: Memory['source']
  milestone?: boolean
}

/**
 * 写入一段记忆。编码强度按刺激量（Yerkes-Dodson），**但 flashbulb 只由里程碑决定**：
 * 刺激量高的回合天天有，用它点亮"刻在心里"会让一半记忆都变成闪光灯记忆（实测 54%），标签就没信息量了。
 * `source` 默认 `npc_self`——她自己的笔记不该按"主人说的"存成最高可信、最难淡的一档。
 */
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

/**
 * 记一件"第一次"：同类事件第一次出现才点亮里程碑，之后的都按普通记忆衰减。
 * 被拒/被放行/风控暂停这类结果只有第一次真正改变她的行为，其余是重复刺激。
 */
export function rememberFirst(
  s: PersonaState,
  content: string,
  tag: string,
  opts: Omit<RememberOptions, 'milestone'> = {},
): PersonaState {
  const first = !s.memories.some((m) => (m.tags ?? []).includes(tag))
  return remember(s, content, { ...opts, tags: [...(opts.tags ?? []), tag], milestone: first })
}

const RELATION_LABEL: Record<string, string> = {
  unjudged: '未判定（还没有过回信）',
  normal: '平常',
  cold_war: '冷战',
  missing: '想念',
  repairing: '修补中',
  reunion: '重逢',
}

/** 给模型看的状态描述：情绪（含成因）+ 场值 + 关系态 + 最近因果 + 召回的记忆。 */
export function describeState(s: PersonaState, limit = 5, opts: { queryText?: string; seed?: string } = {}): string {
  return describeStateWithTrace(s, limit, opts).text
}

/**
 * 同上，另外带出本轮**真的被想起来**的记忆 id。调用方拿 `applyRecall` 写回，
 * 否则 `recallMemory` 永远没人调用：记忆只被读，从不因"回想"而变清楚，`accessCount` 恒 0。
 */
export function describeStateWithTrace(
  s: PersonaState,
  limit = 5,
  opts: { queryText?: string; seed?: string } = {},
): { text: string; recalledIds: string[] } {
  const f = s.fields
  const pct = (n: number) => Math.round(n * 100)
  const rel = RELATION_LABEL[s.npcState?.current ?? ''] ?? s.npcState?.current ?? 'normal'
  const m = readMood(s)
  const secondary = m.secondary.length ? '，还有点' + m.secondary.join('、') : ''
  const recentChain = [...s.chain].reverse().slice(0, limit)
  const recent = recentChain
    .map((e) => `- ${e.description}（${e.fieldChanges.map((c) => `${c.field} ${c.from.toFixed(2)}→${c.to.toFixed(2)}`).join('，')}）`)
  // M4：按"眼下的事"召回，而不是永远拿最鲜活的三条
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
    // 看过的只留片名：B 站标题一长串 Ⅰ 标签，整段塞进提示词只会淹掉别的信息
    const title = r.content.startsWith('看过《') ? (r.content.match(/看过《([^》]+)》/) || [])[1] : ''
    const shown = title
      ? '看过《' + title.split(/[Ⅰ|｜]/)[0].trim().slice(0, 24) + '》'
      : r.content.slice(0, 40)
    return `- ${head}｜${who}：${shown}${r.flashbulb ? '（刻在心里）' : ''}`
  })
  return {
    text: [
      `【她现在的情绪】${m.primary}${secondary}（成因：${m.reason}）`,
      m.inner,
      `【状态】体力${pct(f.energy)} 刺激${pct(f.stimulation)} 连接${pct(f.connection)} 社交${pct(f.social)} `
        + `心情${f.mood.toFixed(2)} 好奇${pct(f.curiosity)} 创造${pct(f.creativity)}｜关系：${rel}`,
      recent.length ? '最近发生：\n' + recent.join('\n') : '最近没什么特别的。',
      mems.length ? '记得：\n' + mems.join('\n') : '',
    ].filter(Boolean).join('\n'),
    recalledIds: picked.map((r) => r.id),
  }
}

/**
 * 把本轮召回的记忆写回状态：`vividness` 按递减收益上升、`accessCount` +1。
 * 只有"她自己在过日子"的路径调用；面板等只读查看不能改变她的记忆。
 */
export function applyRecall(s: PersonaState, ids: string[]): PersonaState {
  if (!ids.length) return s
  const hit = new Set(ids)
  return { ...s, memories: s.memories.map((m) => (hit.has(m.id) ? recallMemory(m) : m)) }
}

/** 选片避重：近 7 天看过的 BV / UP，供 feed 标注与提示。 */
export function recentWatch(s: PersonaState, days = 7): { bvs: string[]; ups: string[] } {
  return watchedFromMemories(s.memories, Date.now(), days)
}

/** 从 feed 输出里找出它推荐的 BV，给近 7 天看过的打标。 */
export function annotateFeed(out: string, recent: { bvs: string[]; ups: string[] }): string {
  const seen = new Set(recent.bvs)
  const lines = String(out ?? '').split(/\r?\n/).map((line) => {
    const bv = (line.match(/\bBV[0-9A-Za-z]{8,}\b/) || [])[0]
    return bv && seen.has(bv) ? line + '  [近 7 天看过]' : line
  })
  const parts: string[] = []
  if (recent.bvs.length) parts.push(`近 7 天看过 ${recent.bvs.length} 条`)
  if (recent.ups.length) parts.push(`最近的 UP：${recent.ups.slice(0, 3).join('、')}（挑片时避开同题材/同 UP）`)
  return lines.join('\n') + (parts.length ? '\n' + parts.join('；') : '')
}

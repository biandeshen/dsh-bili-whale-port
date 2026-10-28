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
import { decayMemory, calculateEncodingStrength } from '../../../persona-core/src/memory.ts'
import { simulateOfflineTime } from '../../../persona-core/src/decay.ts'
import { createInitialState, deriveNPCState } from '../../../persona-core/src/npc-state-machine.ts'

export interface PersonaState {
  fields: AtomicFields
  chain: CausalEvent[]
  memories: Memory[]
  npcState: ReturnType<typeof createInitialState>
  lastAppliedAt: string
}

export interface PresetEffect { field: keyof AtomicFields; delta: number; source: string; priority: number }

/** 预设事件 → 场值效果（可扩展；这是她的"反应表"） */
export const PRESETS: Record<string, { effects: PresetEffect[]; description: string; layer?: 'L0' }> = {
  watchedVideo: {
    description: '看了一条喜欢的视频',
    effects: [
      { field: 'curiosity', delta: +0.03, source: 'watched', priority: 5 },
      // 刺激量要盖过一天的自然衰减（0.12/天），否则永远停在"零刺激"耦合区
      { field: 'stimulation', delta: +0.12, source: 'watched', priority: 5 },
      { field: 'mood', delta: +0.05, source: 'watched', priority: 4 },
      { field: 'energy', delta: -0.02, source: 'watched', priority: 3 },
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

const STATE_SCHEMA_VERSION = 2
const HISTORY_LIMIT = 200

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
  return {
    fields: { ...DEFAULT_ATOMIC_FIELDS, ...raw.fields },
    chain: (raw.chain ?? []).map((e: any) => ({ ...e, timestamp: new Date(e.timestamp) })),
    memories: (raw.memories ?? []).map((m: any) => ({ ...m, createdAt: new Date(m.createdAt) })),
    npcState: { ...createInitialState(), ...raw.npcState },
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

  // 距上次超过 1 天 → 记忆按天衰减
  const days = elapsedMs / 86400_000
  const memories = days >= 1
    ? s.memories.map((m) => decayMemory(m, Math.floor(days)))
    : s.memories

  const chain = [...s.chain]
  const before = { ...s.fields }
  const decayed = simulateOfflineTime(before, elapsedMs)
  for (const f of Object.keys(decayed) as (keyof AtomicFields)[]) {
    const ev = recordFieldChangeL0('xiaoyu', f, before[f], decayed[f], '时间流逝（自然衰减）', chain)
    if (ev) ev.source = 'decay'
  }

  // 一个事件就是一个批次，同源效果必须全部生效：
  // 旧实现每次 new FrequencyGate(50)，同源第二条起被当成重复发射丢弃（连接感/社交永远加不上）。
  const bus = new EffectBus()
  bus.collectAll(effects.map((e) => ({ ...e })))
  const after = bus.apply(decayed, bus.resolve())

  for (const f of Object.keys(after) as (keyof AtomicFields)[]) {
    const ev = recordFieldChangeL0('xiaoyu', f, decayed[f], after[f], description, chain)
    if (ev) ev.source = source
  }

  const npcState = deriveNPCState(after, s.npcState, now, opts.userJustMessaged === true).newState

  return { fields: after, chain, memories, npcState, lastAppliedAt: new Date(now).toISOString() }
}

/** 应用一个预设事件。 */
export function applyEvent(s: PersonaState, presetName: string, now = Date.now()): PersonaState {
  const preset = PRESETS[presetName]
  if (!preset) return s
  return applyEffects(s, preset.effects, preset.description, {
    now,
    source: presetName,
    userJustMessaged: presetName === 'masterReplied',
  })
}

/** 写入一段记忆（对话/观看）；编码强度按刺激量，里程碑自动 flashbulb。 */
export function remember(s: PersonaState, content: string, opts: { sender?: 'player' | 'npc'; intensity?: number; tags?: string[]; source?: Memory['source'] } = {}): PersonaState {
  const intensity = opts.intensity ?? 0.5
  const tags = opts.tags ?? []
  const milestone = tags.includes('milestone') || intensity > 0.8
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
    source: opts.source ?? 'user_said',
  }
  return { ...s, memories: [...s.memories, m] }
}

export interface MoodLabel { primary: string; secondary: string[]; inner: string; reason: string }

/** 情绪成因只看最近 6 小时内发生过什么（沿用 AMpath mood 推导窗口）。 */
const MOOD_WINDOW_MS = 6 * 3600_000

/** 最近一件有情绪含义的事（衰减本身不算成因）；链按追加顺序即时间顺序。 */
function latestCause(s: PersonaState, now: number): string | null {
  for (let i = s.chain.length - 1; i >= 0; i--) {
    const e = s.chain[i]
    if (e.source && e.source !== 'decay' && now - e.timestamp.getTime() < MOOD_WINDOW_MS) return e.source
  }
  return null
}

/**
 * 情绪 = 场值 × 最近成因，两者缺一不可：
 * 同样 mood≈0.25，刚被回复是「开心」，刚看完视频是「满足」。
 * 成因按"最近发生的事"取，不按固定优先级；标签不持久化，每次现算。
 */
export function readMood(s: PersonaState, now = Date.now()): MoodLabel {
  const f = s.fields
  // 0.25 会把今天这种 0.2327 直接判成"不愉快"并落兜底；与真实分布对齐到 0.2
  const pleasant = f.mood >= 0.2
  const lowEnergy = f.energy < 0.35
  const lonely = f.connection < 0.35
  const close = f.connection > 0.7
  const cause = latestCause(s, now)

  if (cause === 'trafficPaused') {
    return {
      primary: '警觉', secondary: lonely ? ['不安'] : [],
      inner: '刚才被平台拦了一下，我得收着点，别给鱼片惹麻烦。',
      reason: '最近遇到风控/暂停',
    }
  }
  if (cause === 'draftRejected') {
    return {
      primary: '失落', secondary: close ? ['委屈'] : [],
      inner: '鱼片没让她发那条……是不是我挑得不好。',
      reason: '草稿被拒',
    }
  }
  if (cause === 'masterSilentDay') {
    return lonely ? {
      primary: '想念', secondary: ['空落'],
      inner: '鱼片好几天没说话了，我照写日记，但不吵他。',
      reason: '主人沉默 + 连接感低',
    } : {
      primary: '平静', secondary: [],
      inner: '今天没人说话，各忙各的，也正常。',
      reason: '主人沉默，但还没到想念的程度',
    }
  }
  if (cause === 'masterReplied' || cause === 'draftApproved') {
    if (pleasant || close) {
      const shy = f.connection < 0.55
      return {
        primary: shy ? '雀跃' : '开心', secondary: shy ? ['害羞'] : ['安心'],
        inner: shy ? '鱼片回我了……才、才没有一直等。' : '鱼片在，今天就挺好。',
        reason: cause === 'masterReplied' ? '被主人回复' : '草稿被放行',
      }
    }
    return {
      primary: '平静', secondary: [],
      inner: '他应了我一声，但我还没缓过来。',
      reason: '被回复了，心情还没回暖',
    }
  }
  if (cause === 'watchedVideo') {
    if (pleasant) {
      return {
        primary: '满足', secondary: f.energy > 0.7 ? ['意犹未尽'] : [],
        inner: '这条真不错，记下来，明天还想看类似的。',
        reason: '看完喜欢的视频 + 心情为正',
      }
    }
    return {
      primary: '平静', secondary: ['略无聊'],
      inner: '看是看了，但没太看进去。',
      reason: '看了视频，心情一般',
    }
  }
  // 「刚起身/走了两步」是最常见的成因；以前没有分支，于是每次 mood_read 都落「平静」。
  // 这里按场值给出可区分的低强度情绪，避免"同一标签覆盖一整天"。
  if (cause === 'action') {
    if (lowEnergy) {
      return {
        primary: '困倦', secondary: [],
        inner: '刚动了一下就有点累，今天不想撑。',
        reason: '刚起身 + 体力低',
      }
    }
    if (f.curiosity > 0.6 && f.stimulation < 0.4) {
      return {
        primary: '好奇', secondary: [],
        inner: '屋里太静了，想找点没见过的看看。',
        reason: '刚起身 + 好奇高、刺激低',
      }
    }
    if (f.creativity > 0.6) {
      return {
        primary: '手痒', secondary: [],
        inner: '想写点什么，哪怕只有两句。',
        reason: '刚起身 + 创造欲高',
      }
    }
    if (pleasant) {
      return {
        primary: '轻快', secondary: [],
        inner: '没什么事，但今天起来的感觉还行。',
        reason: '刚起身 + 心情为正',
      }
    }
    return {
      primary: '安静', secondary: [],
      inner: '刚醒，还没遇到什么值得说的事。',
      reason: '刚起身，场值中性',
    }
  }
  if (lowEnergy && f.mood < 0) {
    return {
      primary: '疲惫', secondary: [],
      inner: '今晚有点撑不住，少看一条也没关系。',
      reason: '体力低 + 心情低',
    }
  }
  if (close && pleasant) {
    return {
      primary: '安稳', secondary: [],
      inner: '今天就这样吧，鱼片在附近就行。',
      reason: '连接感高 + 心情为正',
    }
  }
  return {
    primary: '平静', secondary: f.stimulation < 0.3 ? ['略无聊'] : [],
    inner: '普通的一晚，看看有什么值得记的。',
    reason: '没有强成因，场值中性',
  }
}

/** 给模型看的状态描述：情绪（含成因）+ 场值 + 关系态 + 最近因果 + 最关键记忆。 */
export function describeState(s: PersonaState, limit = 5): string {
  const f = s.fields
  const pct = (n: number) => Math.round(n * 100)
  const rel = s.npcState?.current ?? 'normal'
  const m = readMood(s)
  const secondary = m.secondary.length ? '，还有点' + m.secondary.join('、') : ''
  const recent = [...s.chain].reverse().slice(0, limit)
    .map((e) => `- ${e.description}（${e.fieldChanges.map((c) => `${c.field} ${c.from.toFixed(2)}→${c.to.toFixed(2)}`).join('，')}）`)
  const mems = [...s.memories].sort((a, b) => b.vividness - a.vividness).slice(0, 3)
    .map((m) => `- ${m.sender === 'player' ? '主人' : '我'}：${m.content.slice(0, 40)}${m.flashbulb ? '（刻在心里）' : ''}`)
  return [
    `【她现在的情绪】${m.primary}${secondary}（成因：${m.reason}）`,
    m.inner,
    `【状态】体力${pct(f.energy)} 刺激${pct(f.stimulation)} 连接${pct(f.connection)} 社交${pct(f.social)} `
      + `心情${f.mood.toFixed(2)} 好奇${pct(f.curiosity)} 创造${pct(f.creativity)}｜关系：${rel}`,
    recent.length ? '最近发生：\n' + recent.join('\n') : '最近没什么特别的。',
    mems.length ? '记得：\n' + mems.join('\n') : '',
  ].filter(Boolean).join('\n')
}

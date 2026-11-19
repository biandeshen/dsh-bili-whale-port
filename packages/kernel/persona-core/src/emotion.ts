/**
 * 情绪 = 场值投影 × 最近成因。平台无关：只依赖 7 个原子场、因果链与近期状态。
 *
 * 标签来自 15 情绪投影（emotion-projection.ts），成因层只做两件事：
 * 1. 给相关情绪一个小权重加成（不是硬覆盖，投影仍是主证据）；
 * 2. 提供这一轮的 inner（她心里那句话）与 reason（给模型看的成因）。
 *
 * 强度用"近 N 次状态的滑动参照"算：与近期自己的中位状态差多远。
 * 上游用「离 0.5 多远」，场值贴边时恒为 1；滑动参照会随她一起漂，不会钉死。
 */
import type { AtomicFields, CausalEvent } from './types.ts'
import { DEFAULT_ATOMIC_FIELDS } from './types.ts'
import { fieldDistance, projectEmotion, type EmotionScore } from './emotion-projection.ts'
import { ownerName } from './naming.ts'

export interface MoodState {
  fields: AtomicFields
  chain: CausalEvent[]
  /** 近 N 次结算后的场值快照（applyEffects 追加，最多 24 条） */
  history?: AtomicFields[]
}

export interface MoodLabel {
  primary: string
  secondary: string[]
  inner: string
  reason: string
  /** 0-1：相对近期自己的偏离程度 */
  intensity: number
}

/** 情绪成因只看最近 6 小时内发生过什么。 */
const MOOD_WINDOW_MS = 6 * 3600_000

/** 最近一件有情绪含义的事（衰减本身不算成因）；链按追加顺序即时间顺序。 */
function latestCause(s: MoodState, now: number): string | null {
  for (let i = s.chain.length - 1; i >= 0; i--) {
    const e = s.chain[i]
    // 反序列化的状态里 timestamp 可能是 ISO 字符串，不能假定是 Date
    const ts = e.timestamp instanceof Date ? e.timestamp.getTime() : Date.parse(String(e.timestamp))
    if (e.source && e.source !== 'decay' && Number.isFinite(ts) && now - ts < MOOD_WINDOW_MS) return e.source
  }
  return null
}

/** 当前主导成因（供 voiceBrief 记录，不参与标签推导）。 */
export function latestCauseSource(s: MoodState, now = Date.now()): string | null {
  return latestCause(s, now)
}

/** 成因 → 情绪小加成（0.2–0.6：足以改变接近的排名，不足以压过强投影）。 */
function causeBoost(cause: string | null, f: AtomicFields): Record<string, number> {
  switch (cause) {
    case 'trafficPaused': return { anxiety: 0.6 }
    case 'draftRejected': return { frustration: 0.5 }
    case 'masterReplied': return { warmth: 0.45 }
    case 'draftApproved': return { joy: 0.45 }
    case 'watchedVideo':
    case 'watchedKeep': return { inspiration: 0.3 }
    case 'masterSilentDay':
      return f.connection < 0.35 ? { loneliness: 0.5 } : { serenity: 0.2 }
    case 'action':
      if (f.energy < 0.35) return { melancholy: 0.35 }
      if (f.creativity > 0.6) return { inspiration: 0.35 }
      if (f.curiosity > 0.6 && f.stimulation < 0.4) return { yearning: 0.3 }
      return {}
    default: return {}
  }
}

function pickPrimary(ranked: EmotionScore[], boost: Record<string, number>): EmotionScore {
  let best = ranked[0]
  let bestScore = best.weight + (boost[best.name] ?? 0)
  for (const s of ranked.slice(1)) {
    const score = s.weight + (boost[s.name] ?? 0)
    if (score > bestScore) { best = s; bestScore = score }
  }
  return best
}

function median(values: number[]): number {
  const v = [...values].sort((a, b) => a - b)
  return v[Math.floor(v.length / 2)]
}

/** 滑动参照：近 N 次场值的中位向量；样本不足时用默认基线。 */
function referenceFields(history?: AtomicFields[]): AtomicFields {
  if (!history || history.length < 5) return DEFAULT_ATOMIC_FIELDS
  const keys = Object.keys(DEFAULT_ATOMIC_FIELDS) as Array<keyof AtomicFields>
  const ref = { ...DEFAULT_ATOMIC_FIELDS }
  for (const k of keys) ref[k] = median(history.map((h) => Number(h[k])).filter(Number.isFinite))
  return ref
}

function innerFor(cause: string | null, f: AtomicFields): string {
  switch (cause) {
    case 'trafficPaused': return `刚才被平台拦了一下，我得收着点，别给${ownerName()}惹麻烦。`
    case 'draftRejected': return `${ownerName()}没让她发那条……是不是我挑得不好。`
    case 'masterSilentDay':
      return f.connection < 0.35
        ? `${ownerName()}好几天没说话了，我照写日记，但不吵他。`
        : '今天没人说话，各忙各的，也正常。'
    case 'masterReplied':
    case 'draftApproved':
      return f.connection < 0.55 ? `${ownerName()}回我了……才、才没有一直等。` : `${ownerName()}在，今天就挺好。`
    case 'watchedVideo':
    case 'watchedUnclear':
      return '看完了，收没收我还没判断出来。'
    case 'watchedKeep':
      return '这条我收了，记下来，明天还想看类似的。'
    case 'watchedDrop':
      return '这条没收，就不往心里放。'
    case 'action':
      if (f.energy < 0.35) return '刚动了一下就有点累，今天不想撑。'
      if (f.creativity > 0.6) return '想写点什么，哪怕只有两句。'
      if (f.curiosity > 0.6 && f.stimulation < 0.4) return '屋里太静了，想找点没见过的看看。'
      return '没什么事，但今天起来的感觉还行。'
    default: return '普通的一晚，看看有什么值得记的。'
  }
}

function reasonFor(cause: string | null, f: AtomicFields): string {
  switch (cause) {
    case 'trafficPaused': return '最近遇到风控/暂停'
    case 'draftRejected': return '草稿被拒'
    case 'masterSilentDay':
      return f.connection < 0.35 ? '主人沉默 + 连接感低' : '主人沉默，但还没到想念的程度'
    case 'masterReplied': return '被主人回复'
    case 'draftApproved': return '草稿被放行'
    case 'watchedVideo':
    case 'watchedUnclear': return '看完一条，结论未定'
    case 'watchedKeep': return '看完一条，收了'
    case 'watchedDrop': return '看完一条，没收'
    case 'action':
      if (f.energy < 0.35) return '刚起身 + 体力低'
      if (f.creativity > 0.6) return '刚起身 + 创造欲高'
      if (f.curiosity > 0.6 && f.stimulation < 0.4) return '刚起身 + 好奇高、刺激低'
      return '刚起身 + 场值中性'
    default: return '没有强成因，场值中性'
  }
}

/**
 * 情绪 = 15 情绪投影（主证据）+ 最近成因（加成 + 内心话）。
 * 标签不持久化，每次现算。
 */
export function readMood(s: MoodState, now = Date.now()): MoodLabel {
  const f = s.fields
  const cause = latestCause(s, now)
  const profile = projectEmotion(f)
  const boost = causeBoost(cause, f)
  const primary = pickPrimary(profile.ranked, boost)
  const rest = profile.ranked.filter((x) => x.name !== primary.name)
  const secondary = rest
    .map((x) => ({ ...x, score: x.weight + (boost[x.name] ?? 0) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, 2)
    .map((x) => x.label)

  const ref = referenceFields(s.history)
  const intensity = Math.max(0, Math.min(1, fieldDistance(f, ref) / 1.2))

  return {
    primary: primary.label,
    secondary,
    inner: innerFor(cause, f),
    reason: reasonFor(cause, f),
    intensity,
  }
}

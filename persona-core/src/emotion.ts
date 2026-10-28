/**
 * 情绪 = 场值 × 最近成因。平台无关：只依赖 7 个原子场与因果链。
 * 从 World 层下沉到 persona-core（2026-10-29，D2），避免人格语义寄生在渠道里。
 */
import type { AtomicFields, CausalEvent } from './types.js'

export interface MoodState {
  fields: AtomicFields
  chain: CausalEvent[]
}

export interface MoodLabel { primary: string; secondary: string[]; inner: string; reason: string }

/** 情绪成因只看最近 6 小时内发生过什么（沿用 AMpath mood 推导窗口）。 */
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

/**
 * 情绪 = 场值 × 最近成因，两者缺一不可：
 * 同样 mood≈0.25，刚被回复是「开心」，刚看完视频是「满足」。
 * 成因按"最近发生的事"取，不按固定优先级；标签不持久化，每次现算。
 */
export function readMood(s: MoodState, now = Date.now()): MoodLabel {
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

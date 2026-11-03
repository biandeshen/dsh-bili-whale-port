/**
 * 7 场 → 15 情绪的连续投影纯函数。
 *
 * 设计要点：
 * 1. 每个参考点都是完整 7 维（取 DEFAULT_ATOMIC_FIELDS 基线再按情绪覆盖），避免维度缺失造成系统性偏移。
 * 2. 强度由 emotion.ts 用"近 N 次状态的滑动参照"计算，避免场值贴边时恒为 1。
 *
 * 输出是连续的权重，不是单标签：矛盾情绪（又开心又孤独）会同时出现在 primary/secondary。
 */
import type { AtomicFields } from './types.ts'
import { DEFAULT_ATOMIC_FIELDS } from './types.ts'

export interface EmotionRef { name: string; label: string; fields: AtomicFields }

export interface EmotionScore { name: string; label: string; weight: number; distance: number }

export interface EmotionProfile {
  primary: EmotionScore
  secondary: EmotionScore[]
  ranked: EmotionScore[]
  /** 全量权重（name → 0..1） */
  weights: Record<string, number>
}

/** mood 是情绪锚点，距离权重加倍 */
const MOOD_WEIGHT = 2.0

const FIELDS = ['energy', 'stimulation', 'connection', 'social', 'mood', 'curiosity', 'creativity'] as const

const ref = (name: string, label: string, over: Partial<AtomicFields>): EmotionRef => ({
  name,
  label,
  fields: { ...DEFAULT_ATOMIC_FIELDS, ...over },
})

/** 15 个参考情绪：5 正向 + 5 负向 + 5 矛盾（完整 7 维）。 */
export const EMOTION_REFERENCES: EmotionRef[] = [
  // 正向
  ref('joy', '快乐', { mood: 0.7, energy: 0.6, connection: 0.3, stimulation: 0.5, social: 0.5, curiosity: 0.5, creativity: 0.4 }),
  // 宁静 = 她的日常基线本身（DEFAULT_ATOMIC_FIELDS），否则"什么都没发生"会被投影成躁动/纠结
  ref('serenity', '宁静', {}),
  ref('excitement', '兴奋', { mood: 0.5, energy: 0.7, stimulation: 0.8, connection: 0.45, social: 0.6, curiosity: 0.8, creativity: 0.5 }),
  ref('warmth', '温暖', { mood: 0.5, energy: 0.5, stimulation: 0.35, connection: 0.7, social: 0.65, curiosity: 0.45, creativity: 0.4 }),
  ref('inspiration', '灵感', { mood: 0.4, energy: 0.55, stimulation: 0.5, connection: 0.4, social: 0.4, curiosity: 0.8, creativity: 0.8 }),
  // 负向
  ref('sadness', '悲伤', { mood: -0.6, energy: 0.3, stimulation: 0.3, connection: 0.65, social: 0.3, curiosity: 0.3, creativity: 0.25 }),
  ref('anxiety', '焦虑', { mood: -0.35, energy: 0.4, stimulation: 0.7, connection: 0.5, social: 0.35, curiosity: 0.5, creativity: 0.3 }),
  ref('loneliness', '孤独', { mood: -0.25, energy: 0.5, stimulation: 0.25, connection: 0.8, social: 0.2, curiosity: 0.35, creativity: 0.3 }),
  ref('frustration', '挫败', { mood: -0.4, energy: 0.45, stimulation: 0.6, connection: 0.45, social: 0.3, curiosity: 0.3, creativity: 0.3 }),
  ref('melancholy', '忧郁', { mood: -0.35, energy: 0.3, stimulation: 0.2, connection: 0.45, social: 0.3, curiosity: 0.3, creativity: 0.35 }),
  // 矛盾
  ref('bittersweet', '苦乐参半', { mood: 0.1, energy: 0.3, stimulation: 0.3, connection: 0.7, social: 0.4, curiosity: 0.4, creativity: 0.4 }),
  ref('nostalgia', '怀旧', { mood: 0.15, energy: 0.45, stimulation: 0.2, connection: 0.65, social: 0.35, curiosity: 0.45, creativity: 0.45 }),
  ref('restless', '躁动不安', { mood: -0.15, energy: 0.75, stimulation: 0.8, connection: 0.35, social: 0.45, curiosity: 0.7, creativity: 0.45 }),
  ref('yearning', '渴望', { mood: 0.1, energy: 0.6, stimulation: 0.45, connection: 0.85, social: 0.3, curiosity: 0.5, creativity: 0.4 }),
  ref('conflicted', '纠结', { mood: 0.0, energy: 0.5, stimulation: 0.5, connection: 0.5, social: 0.3, curiosity: 0.55, creativity: 0.5 }),
]

export const EMOTION_LABELS = EMOTION_REFERENCES.map((r) => r.label)

export function fieldDistance(a: AtomicFields, b: AtomicFields): number {
  let sum = 0
  for (const key of FIELDS) {
    const diff = a[key] - b[key]
    sum += (key === 'mood' ? MOOD_WEIGHT : 1) * diff * diff
  }
  return Math.sqrt(sum)
}

export function projectEmotion(fields: AtomicFields): EmotionProfile {
  const ranked: EmotionScore[] = EMOTION_REFERENCES.map((r) => {
    const distance = fieldDistance(fields, r.fields)
    return { name: r.name, label: r.label, distance, weight: 1 / (1 + distance) }
  }).sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name))

  const weights: Record<string, number> = {}
  for (const s of ranked) weights[s.name] = s.weight

  return { primary: ranked[0], secondary: ranked.slice(1, 3), ranked, weights }
}

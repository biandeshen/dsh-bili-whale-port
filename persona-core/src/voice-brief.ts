/**
 * 把人格状态压成「这一条草稿该用什么口吻」——纯函数，不含 IO。
 * World 只负责透传；措辞规则在草稿管线（dsh-bili-whale/scripts/draft-dynamic.mjs）。
 */
import type { AtomicFields, CausalEvent, Memory } from './types.js'
import { readMood, latestCauseSource } from './emotion.js'

export interface VoiceMemory { id: string; text: string; why: string; score: number }

export interface VoiceBrief {
  v: 1
  mood: { label: string; intensity: number; reason: string; cause: string | null }
  relation: string
  memories: VoiceMemory[]
  banned: string[]
  stance: { share: boolean; because: string }
}

export interface VoiceInput {
  fields: AtomicFields
  chain: CausalEvent[]
  memories: Memory[]
  npcState: { current: string }
  history?: AtomicFields[]
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** 记忆打分：鲜活度 0.7 + 新鲜度 0.3（完整检索式留 M4）。 */
function scoreMemory(m: Memory, now: number): { score: number; days: number } {
  const created = m.createdAt instanceof Date ? m.createdAt.getTime() : Date.parse(String(m.createdAt))
  const days = Number.isFinite(created) ? Math.max(0, (now - created) / 86400_000) : 999
  const recency = Math.max(0, 1 - days / 30)
  return { score: 0.7 * Number(m.vividness ?? 0) + 0.3 * recency, days: Math.floor(days) }
}

export function buildVoiceBrief(s: VoiceInput, opts: { now?: number; k?: number } = {}): VoiceBrief {
  const now = opts.now ?? Date.now()
  const k = Math.max(0, Math.min(5, opts.k ?? 3))
  const mood = readMood(s, now)
  const relation = s.npcState?.current ?? 'normal'

  const memories: VoiceMemory[] = (s.memories ?? [])
    .map((m) => {
      const { score, days } = scoreMemory(m, now)
      return {
        id: m.id,
        text: String(m.content ?? '').slice(0, 80),
        why: `${Number(m.vividness ?? 0).toFixed(2)} 鲜活 · ${days} 天前`,
        score: Math.round(score * 1000) / 1000,
      }
    })
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
    .slice(0, k)

  return {
    v: 1,
    mood: {
      label: mood.primary,
      intensity: Math.round(clamp01(mood.intensity) * 100) / 100,
      reason: mood.reason,
      cause: latestCauseSource(s, now),
    },
    relation,
    memories,
    banned: relation === 'cold_war' ? ['鱼片', '主人'] : [],
    stance: relation === 'cold_war'
      ? { share: false, because: '冷战里不想让外人看见我们的事' }
      : { share: s.fields.mood > -0.6, because: s.fields.mood > -0.6 ? '这一轮有想说的' : '心情太低，不想说话' },
  }
}

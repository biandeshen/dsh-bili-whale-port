/**
 * 把人格状态压成「这一条草稿该用什么口吻」——纯函数，不含 IO。
 * World 只负责透传；措辞规则在草稿管线（dsh-bili-whale/scripts/draft-dynamic.mjs）。
 */
import type { AtomicFields, CausalEvent, Memory } from './types.js'
import { readMood, latestCauseSource } from './emotion.js'
import { recallMemories } from './retrieval.js'

export interface VoiceMemory {
  id: string
  text: string
  why: string
  score: number
  /** 这条记忆是谁留下的：主人说过的，还是她自己记下的 */
  from: 'player' | 'npc'
  /** 多少天前（向下取整） */
  days: number
  /** core = 和眼下的事有关；surprise = 意外想起的旧事 */
  slot: 'core' | 'surprise'
}

export interface VoiceQuery {
  /** 当前情境文本（今天的日记、这轮的动作） */
  text?: string
  terms?: string[]
  seed?: string
}

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

export function buildVoiceBrief(
  s: VoiceInput,
  opts: { now?: number; k?: number; surprises?: number; query?: VoiceQuery } = {},
): VoiceBrief {
  const now = opts.now ?? Date.now()
  const k = Math.max(0, Math.min(5, opts.k ?? 3))
  const mood = readMood(s, now)
  const relation = s.npcState?.current ?? 'normal'

  // M4：确定性召回（关键词/鲜活/情绪/新鲜 + 意外槽），在 voice 里保留可解释的 why 和出处
  const recalled = k > 0 || (opts.surprises ?? 0) > 0
    ? recallMemories(s.memories ?? [], {
        now,
        k,
        surprises: opts.surprises ?? 1,
        text: opts.query?.text,
        terms: opts.query?.terms,
        seed: opts.query?.seed,
        mood: s.fields.mood,
      })
    : []
  const memories: VoiceMemory[] = recalled.map((r) => ({
    id: r.id,
    text: r.content.slice(0, 80),
    why: r.why.join(' · '),
    score: r.score,
    from: r.sender,
    days: Math.max(0, Math.floor((now - r.createdAt.getTime()) / 86400_000)),
    slot: r.slot,
  }))

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

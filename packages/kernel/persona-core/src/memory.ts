import type { Memory, MemorySource } from './types.ts';

/** F21: Flashbulb memory decay rate multiplier — nearly immune to decay */
const FLASHBULB_DECAY_MULTIPLIER = 0.2;

/** F26: Source-based decay rate multipliers */
const SOURCE_DECAY_RATES: Record<MemorySource, number> = {
  user_said: 0.9,     // 用户说的更可信，衰减更慢
  npc_self: 1.0,      // NPC 自己想到的，基准速率
  dream: 1.5,         // 梦境产生的记忆衰减更快
  imported: 1.2,      // 导入的记忆
  user_voice: 0.95,   // 语音转录，略低于文字
  user_image: 0.95,   // 图片描述，略低于文字
};

const BASE_DECAY_RATE = 0.02;

/**
 * Decay memory vividness over time.
 * Vividness decreases naturally — memories fade.
 * - Pinned memories are immune to decay.
 * - F21: Flashbulb memories decay at 0.2x rate (nearly immune).
 * - F26: Source-based decay rates (user_said slower, dream faster).
 *
 * 记忆衰减。注意：**days 是天，不是毫秒**（传毫秒会一天归零）。
 */
export function decayMemory(memory: Memory, days: number): Memory {
  if (memory.pinned) return memory;

  const sourceRate = SOURCE_DECAY_RATES[memory.source ?? 'user_said'];
  const flashbulbRate = memory.flashbulb ? FLASHBULB_DECAY_MULTIPLIER : 1.0;
  const effectiveRate = BASE_DECAY_RATE * sourceRate * flashbulbRate;

  return {
    ...memory,
    vividness: Math.max(0, memory.vividness - effectiveRate * days),
  };
}

/**
 * 记忆显著性：鲜活度 0.7 + 新鲜度 0.3（30 天线性归零）。
 * 用于"记得"的排序——只按 vividness 排会让同分记忆永远返回最早三条（D-03）。
 */
export function memorySalience(memory: Memory, now = Date.now()): number {
  const t = memory.createdAt instanceof Date ? memory.createdAt.getTime() : Date.parse(String(memory.createdAt))
  const days = Number.isFinite(t) ? Math.max(0, (now - t) / 86400_000) : 999
  const recency = Math.max(0, 1 - days / 30)
  return 0.7 * Number(memory.vividness ?? 0) + 0.3 * recency
}

/**
 * F20: Calculate encoding strength using Yerkes-Dodson curve.
 * arousal = stimulation field value (0-1).
 * Peak encoding at arousal=0.6, decreases toward extremes.
 *
 * Formula: encodingStrength = 0.5 + 0.5 * (1 - |arousing - 0.6| / 0.6)
 * - arousal=0.6 → 1.0 (maximum)
 * - arousal=0.0 → 0.5 (minimum)
 * - arousal=1.0 → 0.667
 */
export function calculateEncodingStrength(stimulation: number): number {
  const arousing = Math.max(0, Math.min(1, stimulation));
  return 0.5 + 0.5 * (1 - Math.abs(arousing - 0.6) / 0.6);
}

/**
 * F21: Determine if a memory qualifies as a flashbulb memory.
 * Conditions:
 * 1. Emotion intensity > 0.8
 * 2. OR tagged with a milestone event
 */
export function isFlashbulbMemory(
  emotion: { intensity: number; tags: string[] },
  tags: string[],
): boolean {
  const MILESTONE_TAGS = [
    'first_conflict', 'first_reconciliation', 'first_secret_shared',
    'first_birthday', 'first_deep_talk', 'first_dependency',
    'milestone',
  ];

  if (emotion.intensity > 0.8) return true;
  return tags.some(t => MILESTONE_TAGS.includes(t))
    || emotion.tags.some(t => MILESTONE_TAGS.includes(t));
}

/**
 * Recall a memory — vividness increases, access count increments.
 * Like human memory: recalled memories become clearer.
 *
 * Diminishing returns: repeated recalls give less boost.
 * accessCount 0 → +0.05, 1 → +0.03, 2 → +0.01, >2 → +0.005
 */
export function recallMemory(memory: Memory): Memory {
  const boost = memory.accessCount === 0 ? 0.05
              : memory.accessCount === 1 ? 0.03
              : memory.accessCount === 2 ? 0.01
              : 0.005;

  return {
    ...memory,
    vividness: Math.min(1, memory.vividness + boost),
    accessCount: memory.accessCount + 1,
  };
}

/**
 * Get memory content appropriate for prompt injection.
 * Low vividness → compressed/blurry representation.
 */
export function getMemoryForPrompt(memory: Memory): string {
  if (memory.vividness > 0.7) {
    // Full recall — complete content
    return `[${memory.createdAt.toISOString().slice(0, 16)}] ${memory.sender === 'player' ? '玩家' : 'NPC'}: ${memory.content}`;
  } else if (memory.vividness > 0.4) {
    // Partial recall — summary with emotion
    const emotionDesc = memory.emotion.valence > 0.2 ? '开心地' :
                        memory.emotion.valence < -0.2 ? '难过地' : '平静地';
    return `[模糊记忆] ${memory.sender === 'player' ? '玩家' : 'NPC'}${emotionDesc}说: "${memory.content.slice(0, 30)}..."`;
  } else {
    // Faded — only emotion remains
    const emotionDesc = memory.emotion.valence > 0.2 ? '开心的' :
                        memory.emotion.valence < -0.2 ? '难过的' : '平淡的';
    return `[模糊印象] 一次${emotionDesc}对话`;
  }
}

/**
 * Check if a memory is worth keeping (not too faded).
 */
export function isMemoryArchivable(memory: Memory): boolean {
  return memory.vividness < 0.05 && memory.accessCount < 3;
}

/** 这条记忆还在不在用：作废过的不再被想起，但原文保留（可复盘"当初为什么这么记"）。 */
export function isVoided(memory: Pick<Memory, 'voided'>): boolean {
  return memory?.voided === true;
}

/**
 * 给记忆盖作废章（#55）。写错的记忆如果只能靠衰减慢慢淡掉，她在错的这段时间里
 * 会一直用它下结论；所以更正要有通道。这里是纯函数：返回新数组，不改传入对象，
 * 命中 0 条时原样返回，调用方据 `voidedIds.length` 如实回执（别说成"已更正"）。
 */
export function voidMemories<T extends Memory>(
  memories: T[],
  ids: readonly string[],
  reason: string,
  now = Date.now(),
): { memories: T[]; voidedIds: string[] } {
  const set = new Set(ids);
  const hit = (memories ?? []).filter((m) => set.has(m.id) && !m.voided);
  if (!hit.length) return { memories, voidedIds: [] };
  const at = new Date(now).toISOString();
  return {
    memories: (memories ?? []).map((m) =>
      set.has(m.id) && !m.voided ? { ...m, voided: true, voidedAt: at, voidReason: reason } : m),
    voidedIds: hit.map((m) => m.id),
  };
}

/** 撤销作废（写错了还能改回来）：只回滚带作废章的那几条，理由留档不擦。 */
export function restoreMemories<T extends Memory>(memories: T[], ids: readonly string[]): { memories: T[]; restoredIds: string[] } {
  const set = new Set(ids);
  const hit = (memories ?? []).filter((m) => set.has(m.id) && m.voided);
  if (!hit.length) return { memories, restoredIds: [] };
  return {
    memories: (memories ?? []).map((m) => (set.has(m.id) && m.voided ? { ...m, voided: false } : m)),
    restoredIds: hit.map((m) => m.id),
  };
}

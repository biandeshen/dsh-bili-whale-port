/**
 * persona-core：她自己那套逻辑，与宿主框架无关。
 *
 * 这一层不知道 Cortico / World / WebUI 的存在——它只回答"她现在想不想动"、
 * "这条记忆还清不清楚"、"该怎么称呼他"。宿主侧的读写与预设留在
 * `src/worlds/bili-account/personaAdapter.ts`（那是适配层，不是内核）。
 */
export { decideAction, restRecoveryDelta, actionCost, nextCheckDelay, dayKey, MIN_GAP_MS } from './rhythm.ts'
export type { ActionKind, ActionDecision, LifeMemory, LifeState } from './rhythm.ts'
export { decayMemory, memorySalience, calculateEncodingStrength, isFlashbulbMemory, recallMemory, getMemoryForPrompt, isMemoryArchivable, isVoided, voidMemories, restoreMemories } from './memory.ts'
export { readMood } from './emotion.ts'
export type { MoodState, MoodLabel } from './emotion.ts'
export { ownerName, setOwnerName } from './naming.ts'
export { pickActivities, ACTIVITY_LABELS } from './life-activities.ts'
export type { ActivityType, LifeActivity } from './life-activities.ts'
export { buildVoiceBrief } from './voice-brief.ts'
export type { VoiceBrief, VoiceInput, VoiceMemory, VoiceQuery } from './voice-brief.ts'
export { clamp, DEFAULT_ATOMIC_FIELDS, CONFIG } from './types.ts'
export type { AtomicFields, AtomicFieldsWithVersion, Effect, ResolvedEffect, CausalEvent, Memory, MemorySource } from './types.ts'

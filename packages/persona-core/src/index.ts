/**
 * @xiaoyu/persona-core：小鱼的纯函数内核与统一能力扩展契约（100% 宿主无关，零 IO）。
 */
export { decideAction, restRecoveryDelta, actionCost, nextCheckDelay, dayKey, MIN_GAP_MS } from './rhythm.ts'
export type { ActionKind, ActionDecision, LifeMemory, LifeState } from './rhythm.ts'
export { decayMemory, memorySalience, calculateEncodingStrength, isFlashbulbMemory, recallMemory, getMemoryForPrompt, isMemoryArchivable, isVoided, voidMemories, restoreMemories } from './memory.ts'
export { readMood, latestCauseSource } from './emotion.ts'
export type { MoodState, MoodLabel } from './emotion.ts'
export { EMOTION_LABELS, projectEmotion, fieldDistance } from './emotion-projection.ts'
export type { EmotionRef, EmotionScore, EmotionProfile } from './emotion-projection.ts'
export { ownerName, setOwnerName } from './naming.ts'
export { pickActivities, ACTIVITY_LABELS } from './life-activities.ts'
export type { ActivityType, LifeActivity } from './life-activities.ts'
export { buildVoiceBrief } from './voice-brief.ts'
export type { VoiceBrief, VoiceInput, VoiceMemory, VoiceQuery } from './voice-brief.ts'
export { recallMemories, watchedFromMemories, tokensOf } from './retrieval.ts'
export type { RecallContext, RecalledMemory } from './retrieval.ts'
export { EffectBus } from './effect-bus.ts'
export { recordFieldChangeL0, recordEntityResponseL1, recordEmergenceL2, buildCausalTree, explainMoodDrop } from './causal-chain.ts'
export { createInitialState, deriveNPCState } from './npc-state-machine.ts'
export type { NPCStateName, BondState } from './npc-state-machine.ts'
export { decayAtomicFields, applyHardCouplings, simulateOfflineTime } from './decay.ts'
export { applyBudgets, emptyBudget } from './budget.ts'
export type { BudgetLedger, ClippedEffect } from './budget.ts'
export { assessConversation } from './conversation-assessment.ts'
export type { ConversationType, BoundaryScope, ConversationAssessment } from './conversation-assessment.ts'
export { circadianPhase, season, buildTemporalMeta, nowSentence } from './temporal.ts'
export type { CircadianPhaseName, SeasonName, CircadianPhase, TemporalMeta } from './temporal.ts'
export { validateCapabilityContract } from './capability.ts'
export type {
  CapabilityKind,
  JsonSchemaProperty,
  JsonSchema,
  StorageUnit,
  PrefixBlock,
  TurnContext,
  InboundEventItem,
  DeliveryContext,
  CapabilityHost,
  ToolParameterSchema,
  ToolRegistration,
  PanelMethodDecl,
  CapabilityPanelDecl,
  XiaoyuCapability,
  CapabilityValidationResult,
} from './capability.ts'
export { clamp, DEFAULT_ATOMIC_FIELDS, CONFIG } from './types.ts'
export type { AtomicFields, AtomicFieldsWithVersion, Effect, ResolvedEffect, CausalEvent, FieldChange, Memory, MemorySource } from './types.ts'

/**
 * NPC 状态机 — 5 种关系状态
 * 权威源：docs/完整架构设计.md 执行手册 7.3
 *
 * 状态转移：
 *   normal → cold_war:   connection < 0.3 持续 24h
 *   cold_war → missing:   冷战中 user 发来消息
 *   missing → repairing:  用户真诚道歉（trust 回升）
 *   repairing → reunion:  trust 回升 > 0.1（相比 cold_war 起点）
 *   any → normal:         connection >= 0.3
 */

import type { AtomicFields } from './types.js';

export type NPCStateName = 'normal' | 'cold_war' | 'missing' | 'repairing' | 'reunion';

export interface NPCStateMachineState {
  current: NPCStateName;
  /** connection 首次跌破 0.3 的时间戳（null = 未跌破） */
  connectionBelowThresholdSince: number | null;
  /** 最后一次收到用户消息的时间戳 */
  lastUserMessageAt: number | null;
  /** 进入 cold_war 时的 trust 值 */
  trustAtColdWarStart: number | null;
}

/** 冷战触发阈值（小时） */
const COLD_WAR_THRESHOLD_HOURS = 24;
const COLD_WAR_THRESHOLD_MS = COLD_WAR_THRESHOLD_HOURS * 3600 * 1000;

/** connection 跌破线 */
const CONNECTION_THRESHOLD = 0.3;

/** reunion 需要 trust 回升幅度 */
const TRUST_RECOVERY_DELTA = 0.1;

/**
 * 创建初始状态机状态
 */
export function createInitialState(): NPCStateMachineState {
  return {
    current: 'normal',
    connectionBelowThresholdSince: null,
    lastUserMessageAt: null,
    trustAtColdWarStart: null,
  };
}

/**
 * 根据当前原子场值和外部事件，推导 NPC 的关系状态。
 *
 * @param fields      当前 7 场值
 * @param state       上一次状态机快照
 * @param nowMs       当前时间戳（毫秒）
 * @param userJustMessaged 用户是否刚刚发了消息
 */
export function deriveNPCState(
  fields: AtomicFields,
  state: NPCStateMachineState,
  nowMs: number,
  userJustMessaged: boolean,
): { newState: NPCStateMachineState; stateName: NPCStateName } {
  const connection = fields.connection;
  const trust = fields.connection; // trust 由 connection 派生

  // 拷贝一份可变状态
  const next: NPCStateMachineState = { ...state };

  // 记录用户消息时间
  if (userJustMessaged) {
    next.lastUserMessageAt = nowMs;
  }

  // ---- connection 跌破阈值追踪 ----
  if (connection < CONNECTION_THRESHOLD) {
    if (next.connectionBelowThresholdSince === null) {
      // 刚跌破，记录时间
      next.connectionBelowThresholdSince = nowMs;
      // 同时记录此刻的 trust 作为基线
      next.trustAtColdWarStart = trust;
    }
  } else {
    // connection 恢复，重置追踪
    next.connectionBelowThresholdSince = null;
    next.trustAtColdWarStart = null;
  }

  // ---- 状态转移逻辑 ----

  // 1) connection >= 0.3 → 任何状态都回到 normal
  if (connection >= CONNECTION_THRESHOLD) {
    next.current = 'normal';
    return { newState: next, stateName: 'normal' };
  }

  // 以下逻辑：connection < 0.3
  const belowDurationMs = next.connectionBelowThresholdSince != null
    ? nowMs - next.connectionBelowThresholdSince
    : 0;

  switch (next.current) {
    case 'normal':
      // normal + connection < 0.3 超过 24h → cold_war
      if (belowDurationMs >= COLD_WAR_THRESHOLD_MS) {
        next.current = 'cold_war';
      }
      break;

    case 'cold_war':
      // 冷战中用户发消息 → missing
      if (userJustMessaged) {
        next.current = 'missing';
      }
      break;

    case 'missing':
      // 用户发消息后 trust 开始回升 → repairing
      // 判断标准：trust 比 cold_war 起点有增长
      if (next.trustAtColdWarStart != null && trust > next.trustAtColdWarStart) {
        next.current = 'repairing';
      }
      break;

    case 'repairing':
      // trust 回升超过 0.1（相比 cold_war 起点）→ reunion
      if (next.trustAtColdWarStart != null && trust - next.trustAtColdWarStart >= TRUST_RECOVERY_DELTA) {
        next.current = 'reunion';
      }
      break;

    case 'reunion':
      // reunion 后如果 connection 再次长期低于阈值，重新进入 cold_war
      if (belowDurationMs >= COLD_WAR_THRESHOLD_MS) {
        next.current = 'cold_war';
      }
      break;
  }

  return { newState: next, stateName: next.current };
}

/**
 * 根据 NPC 状态和用户活跃度，返回自适应 tick 间隔（毫秒）。
 *
 * 设计原则：
 * - 用户活跃时 1s 快速响应
 * - 冷战时 60s 慢 tick（NPC 在"赌气"）
 * - 修复期 5s 频繁 tick（NPC 需要观察用户诚意）
 * - 正常状态 10s
 */
export function getTickInterval(stateName: NPCStateName, userActive: boolean): number {
  if (userActive) return 1000;
  switch (stateName) {
    case 'cold_war': return 60_000;
    case 'missing': return 30_000;
    case 'repairing': return 5_000;
    case 'reunion': return 5_000;
    default: return 10_000;
  }
}

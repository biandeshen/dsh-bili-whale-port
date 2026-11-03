/**
 * NPC 关系状态机 —— 五态 + 「未判定」
 * 权威源：docs/完整架构设计.md 执行手册 7.3；Q-06 修订（PLAN-REVIEW 2026-10-28 §2 裁决 6）。
 *
 * 状态转移：
 *   unjudged → normal:   第一次有接触证据（收到用户消息）
 *   normal → cold_war:   connection < 0.3 持续 24h（且有过接触）
 *   cold_war → missing:  冷战中用户发来消息
 *   missing → repairing: bond 回升（相比 cold_war 起点）
 *   repairing → reunion: bond 回升 ≥ 0.1（相比 cold_war 起点）
 *   any → normal:        connection >= 0.3（有接触时）
 *
 * bond 是关系存量，只在有接触证据时变化（每条用户消息 +0.1）；
 * connection 仍是场值存量，两者不再互为别名。没有接触证据就不判冷战——显示"未判定"。
 */

import type { AtomicFields } from './types.ts';

export type NPCStateName = 'unjudged' | 'normal' | 'cold_war' | 'missing' | 'repairing' | 'reunion';

export interface BondState {
  /** 关系存量 0-1：只在收到用户消息时增长，不随场值漂移 */
  level: number;
}

export interface NPCStateMachineState {
  current: NPCStateName;
  /** connection 首次跌破 0.3 的时间戳（null = 未跌破/无接触） */
  connectionBelowThresholdSince: number | null;
  /** 最后一次收到用户消息的时间戳 */
  lastUserMessageAt: number | null;
  /** 关系存量（冷战/修补/重逢都读它） */
  bond: BondState;
  /** 进入 cold_war 时的 bond 基线 */
  bondAtColdWarStart: number | null;
}

/** 冷战触发阈值（小时） */
const COLD_WAR_THRESHOLD_HOURS = 24;
const COLD_WAR_THRESHOLD_MS = COLD_WAR_THRESHOLD_HOURS * 3600 * 1000;

/** connection 跌破线 */
const CONNECTION_THRESHOLD = 0.3;

/** reunion 需要 bond 回升幅度 */
const BOND_RECOVERY_DELTA = 0.1;
/** 每条用户消息带来的关系存量 */
const BOND_PER_MESSAGE = 0.1;

/**
 * 创建初始状态机状态
 */
export function createInitialState(): NPCStateMachineState {
  return {
    current: 'unjudged',
    connectionBelowThresholdSince: null,
    lastUserMessageAt: null,
    bond: { level: 0.2 },
    bondAtColdWarStart: null,
  };
}

/**
 * 根据当前原子场值和外部事件，推导 NPC 的关系状态。
 *
 * @param fields      当前 7 场值
 * @param state       上一次状态机快照
 * @param nowMs       当前时间戳（毫秒）
 * @param userJustMessaged 用户是否刚刚发了消息（接触证据）
 */
export function deriveNPCState(
  fields: AtomicFields,
  state: NPCStateMachineState,
  nowMs: number,
  userJustMessaged: boolean,
): { newState: NPCStateMachineState; stateName: NPCStateName } {
  const connection = fields.connection;

  // 拷贝一份可变状态（老状态文件没有 bond 时补默认值）
  const next: NPCStateMachineState = { ...state, bond: { ...(state.bond ?? { level: 0.2 }) } };

  // ---- 接触证据：只有用户消息能建立/增长关系存量 ----
  if (userJustMessaged) {
    next.lastUserMessageAt = nowMs;
    next.bond.level = Math.min(1, next.bond.level + BOND_PER_MESSAGE);
  }
  const hasContact = next.lastUserMessageAt != null;

  // ---- connection 跌破阈值追踪（没有接触证据不累计，避免"素未谋面就冷战"） ----
  if (hasContact && connection < CONNECTION_THRESHOLD) {
    if (next.connectionBelowThresholdSince == null) {
      next.connectionBelowThresholdSince = nowMs;
    }
  } else {
    next.connectionBelowThresholdSince = null;
  }

  // ---- 状态转移逻辑 ----

  // 1) connection >= 0.3 → 有接触回 normal，没接触仍是未判定
  if (connection >= CONNECTION_THRESHOLD) {
    next.current = hasContact ? 'normal' : 'unjudged';
    next.bondAtColdWarStart = null;
    return { newState: next, stateName: next.current };
  }

  // 2) 没有接触证据：不判冷战
  if (!hasContact) {
    next.current = 'unjudged';
    next.bondAtColdWarStart = null;
    return { newState: next, stateName: 'unjudged' };
  }

  const belowDurationMs = next.connectionBelowThresholdSince != null
    ? nowMs - next.connectionBelowThresholdSince
    : 0;

  switch (next.current) {
    case 'unjudged':
      // 刚拿到接触证据（connection 仍低）：先按 normal 处理，冷战计时从这一刻开始
      next.current = 'normal';
      break;

    case 'normal':
      // normal + connection < 0.3 超过 24h → cold_war
      if (belowDurationMs >= COLD_WAR_THRESHOLD_MS) {
        next.current = 'cold_war';
        next.bondAtColdWarStart = next.bond.level;
      }
      break;

    case 'cold_war':
      // 冷战中用户发消息 → missing
      if (userJustMessaged) {
        next.current = 'missing';
      }
      break;

    case 'missing':
      // 用户发消息后 bond 开始回升 → repairing
      if (next.bondAtColdWarStart != null && next.bond.level > next.bondAtColdWarStart) {
        next.current = 'repairing';
      }
      break;

    case 'repairing':
      // bond 回升超过 0.1（相比 cold_war 起点）→ reunion
      if (next.bondAtColdWarStart != null && next.bond.level - next.bondAtColdWarStart >= BOND_RECOVERY_DELTA) {
        next.current = 'reunion';
      }
      break;

    case 'reunion':
      // reunion 后如果 connection 再次长期低于阈值，重新进入 cold_war
      if (belowDurationMs >= COLD_WAR_THRESHOLD_MS) {
        next.current = 'cold_war';
        next.bondAtColdWarStart = next.bond.level;
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

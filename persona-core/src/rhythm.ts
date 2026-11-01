/**
 * 状态驱动的行动节奏 —— 不是"定时唤醒"，是"她一直活着，想做事才做事"：
 * 场值（无聊/想他/睡够了）+ 关系 + 随机抖动 决定要不要起一个行动回合。
 * 没有"正确作息"时间表，也没有到点必须醒。
 *
 * 借鉴 AMpath `field-engine/drives.ts` + `action-triggers.ts` 的驱动评分，
 * 但触发条件是"她现在缺什么/想干什么"，不是"现在几点"。
 */
import type { AtomicFields } from './types.js'
import type { NPCStateName } from './npc-state-machine.js'

export interface LifeMemory {
  day: string            // 本地日期（sv-SE，跨天清零）
  actionsToday: number
  lastActionAt: number
  lastCheckAt: number
  lastKind: string | null
  /** 连续几次为了"想他"行动都没等到人 → 她会越来越少去等（不是代码拦，是心凉了） */
  connectMisses?: number
  /** 最近一次"等不到人"的时间；停几天不等了，misses 会自己回落 */
  lastMissAt?: number
  /** 已经为"他今天又没说话"掉过一次心情的日期，一天只掉一次 */
  lastSilentDay?: string
}

export interface LifeState extends LifeMemory {
  nextCheckAt: number    // 下一次评估的时间（带抖动，不是整点）
}

export type ActionKind = 'explore' | 'connect' | 'restless'

export type ActionDecision =
  | { act: false; reason: 'tired' | 'gap' | 'cap' | 'content'; urge: number }
  | { act: true; kind: ActionKind; reason: string; urge: number }

/** 两次行动之间至少隔这么久（防止刚做完又做） */
export const MIN_GAP_MS = 2.5 * 3600_000
export const MAX_ACTIONS_PER_DAY = 3
/** 每次 5 分钟评估的基准概率（还要乘驱动强度） */
const CHECK_PROB = 0.05
/** 休息时体力恢复速度（每小时）——一天回 ~0.072，只够一到两轮活动 */
export const REST_RECOVERY_PER_HOUR = 0.003
/** 行动一轮的基础体力开销（含看片/写日记），一天一轮 ≈ 恢复量，连做三天就会累 */
export const ACTION_COST_ENERGY = 0.05
/** 歇够多久开始"想活动一下"（小时），到 REST_FULL_HOURS 达到满值 */
const REST_PRESSURE_START_H = 12
const REST_FULL_HOURS = 30
/** 下一次评估间隔：3–7 分钟随机 */
export const NEXT_CHECK_MIN_MS = 3 * 60_000
export const NEXT_CHECK_MAX_MS = 7 * 60_000

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

export function dayKey(now: number): string {
  return new Date(now).toLocaleDateString('sv-SE')
}

/** 歇着这段时间体力恢复了多少（0 表示已经满了）。 */
export function restRecoveryDelta(fields: AtomicFields, hours: number): number {
  if (!(hours > 0)) return 0
  return Math.min(1 - fields.energy, hours * REST_RECOVERY_PER_HOUR)
}

export function decideAction(opts: {
  fields: AtomicFields
  relation: NPCStateName
  now: number
  mem: LifeMemory
  rng: () => number
}): ActionDecision {
  const { fields: f, relation, now, mem, rng } = opts
  if (mem.lastActionAt && now - mem.lastActionAt < MIN_GAP_MS) return { act: false, reason: 'gap', urge: 0 }
  if (mem.day === dayKey(now) && mem.actionsToday >= MAX_ACTIONS_PER_DAY) return { act: false, reason: 'cap', urge: 0 }

  const tired = clamp01((0.45 - f.energy) / 0.45)
  if (tired > 0.6) return { act: false, reason: 'tired', urge: tired }

  const explore = clamp01((0.45 - f.stimulation) / 0.45)
  const connectRaw = clamp01((0.45 - f.connection) / 0.45)
  // 冷战里她不会主动凑上去；连着几次等不到人，也会越来越少去等（几天不等会自己回落）
  const missAgeDays = mem.lastMissAt ? Math.max(0, (now - mem.lastMissAt) / 86400_000) : 0
  const misses = Math.max(0, Number(mem.connectMisses ?? 0) - missAgeDays * 0.5)
  const connect = relation === 'cold_war' ? 0 : connectRaw / (1 + 2 * misses)

  // 歇够了也会想动一动：距上次行动越久越想活动（不是看钟，是歇够了）
  const sinceHours = mem.lastActionAt ? Math.max(0, (now - mem.lastActionAt) / 3600_000) : 999
  const restPressure = clamp01((sinceHours - REST_PRESSURE_START_H) / (REST_FULL_HOURS - REST_PRESSURE_START_H))

  const urge = Math.max(explore, connect, restPressure) * (1 - tired)
  if (rng() >= urge * CHECK_PROB) return { act: false, reason: 'content', urge }

  if (explore >= connect && explore >= restPressure) {
    return { act: true, kind: 'explore', reason: '有点无聊，想找点新鲜的看', urge }
  }
  if (connect >= explore && connect >= restPressure) {
    return { act: true, kind: 'connect', reason: '想他了，想知道他有没有来找过你', urge }
  }
  return { act: true, kind: 'restless', reason: '歇够了，想活动一下', urge }
}

/** 行动会消耗的体力和带来的轻微兴奋（由 World 写进场值）。 */
export function actionCost(): Array<{ field: keyof AtomicFields; delta: number; source: string; priority: number }> {
  return [
    { field: 'energy', delta: -ACTION_COST_ENERGY, source: 'action', priority: 5 },
    { field: 'stimulation', delta: +0.02, source: 'action', priority: 5 },
  ]
}

export function nextCheckDelay(rng: () => number): number {
  return NEXT_CHECK_MIN_MS + Math.floor(rng() * (NEXT_CHECK_MAX_MS - NEXT_CHECK_MIN_MS))
}

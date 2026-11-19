/**
 * 生活循环的五个阶段，各自是纯函数。
 *
 * 存在的理由：这五步原先挤在一个 130 行的 `lifeTick` 里，顺序靠读代码才知道，
 * 任何一步被跳过单测都不会红。拆出来之后顺序可以被断言，也能单独测。
 *
 * 阶段顺序固定为：**对账 → 结算 → 衰减/恢复 → 决定 → 记账**。
 * 换顺序会改变行为：例如先决定后衰减，她就会永远按上次的旧场值做选择。
 */
import { decideAction, restRecoveryDelta, dayKey, MIN_GAP_MS } from '@xiaoyu/persona-core/rhythm'
import type { ActionDecision, LifeMemory } from '@xiaoyu/persona-core/rhythm'
import type { NPCStateName } from '@xiaoyu/persona-core/npc-state-machine'

/** life.json 的形状以内核的 `LifeMemory` 为准；这里只补两个可选的诊断字段。 */
export type LifeMemoryView = LifeMemory & {
  lastCheckAt?: number
  lastKind?: string
  connectMisses?: number
  lastMissAt?: number
  lastSilentDay?: string
  nextCheckAt?: number
}

/**
 * ① 对账：把"今天做了几次"收敛到三者最大值。
 *
 * 并发实例会把 `life.json` 写回旧值（实测：动作后 `actionsToday` 变回 0），
 * 而 `causal.jsonl` 是 append-only，不受覆盖影响——所以它是最可信的一份。
 * 跨日时先归零再比，否则昨天的计数会被带进今天。
 */
export function reconcileLife(
  mem: LifeMemory,
  disk: LifeMemory | null,
  ledger: { count: number; lastAt: number },
  today: string = dayKey(Date.now()),
): LifeMemory {
  const sameDay = mem.day === today
  return {
    ...mem,
    day: today,
    actionsToday: Math.max(
      sameDay ? Number(mem.actionsToday ?? 0) : 0,
      disk?.day === today ? Number(disk.actionsToday ?? 0) : 0,
      ledger.count,
    ),
    lastActionAt: Math.max(
      Number(sameDay ? mem.lastActionAt ?? 0 : 0),
      Number(disk?.lastActionAt ?? 0),
      ledger.lastAt,
    ),
  }
}

/** ② 睡着：距上次动作 ≥6h 算睡下。醒着不回体力，睡下才恢复。 */
export const SLEEP_AFTER_MS = 6 * 3_600_000
export function isAsleep(lastActionAt: number | null | undefined, now: number = Date.now()): boolean {
  if (lastActionAt == null || !Number.isFinite(Number(lastActionAt)) || Number(lastActionAt) <= 0) return true
  return now - Number(lastActionAt) >= SLEEP_AFTER_MS
}

/** ② 的恢复量：只有睡着才回体力；醒着返回 0。 */
export function restRecovery(fields: any, hours: number, asleep: boolean): number {
  return asleep ? restRecoveryDelta(fields, hours) : 0
}

/** ④ 决定：这一轮动不动。不动就不该扣成本。 */
export function decideStage(opts: {
  fields: any
  relation: NPCStateName
  now: number
  mem: any
  rng: () => number
}): { decision: ActionDecision; costApplied: false } {
  return { decision: decideAction(opts), costApplied: false }
}

/** ⑤ 记账：先落 append-only 因果账，再写会被覆盖的 life.json。 */
export function applyActionRecord(
  mem: LifeMemoryView,
  decision: { kind: string; reason: string },
  hooks: { now: number; writeLife: (m: LifeMemoryView) => void; writeCausal: (e: any) => void },
): LifeMemoryView {
  const next: LifeMemoryView = {
    ...mem,
    actionsToday: Number(mem.actionsToday ?? 0) + 1,
    lastActionAt: hooks.now,
    lastKind: decision.kind,
  }
  hooks.writeCausal({ kind: 'action', actionKind: decision.kind, reason: decision.reason, atMs: hooks.now })
  hooks.writeLife(next)
  return next
}

/** 下一轮间隔：MIN_GAP_MS 之内不动，避免连发。 */
export function gapLeft(lastActionAt: number | null | undefined, now: number): number {
  return Math.max(0, Number(lastActionAt || 0) + MIN_GAP_MS - now)
}

/**
 * 生活循环的五个阶段，各自是纯函数。
 * 阶段顺序固定为：对账 → 结算 → 衰减/恢复 → 决定 → 记账。
 */
import { decideAction, restRecoveryDelta, dayKey, MIN_GAP_MS } from '../../persona-core/src/rhythm.ts'
import type { ActionDecision, LifeMemory } from '../../persona-core/src/rhythm.ts'
import type { NPCStateName } from '../../persona-core/src/npc-state-machine.ts'

export type RhythmMode = 'auto' | 'force_sleep' | 'force_awake'

export type LifeMemoryView = LifeMemory & {
  lastCheckAt?: number
  lastKind?: string | null
  connectMisses?: number
  lastMissAt?: number
  lastSilentDay?: string
  nextCheckAt?: number
  mode?: RhythmMode
}

/** ① 对账：把"今天做了几次"收敛到三者最大值，跨日先归零。 */
export function reconcileLife(
  mem: LifeMemoryView,
  disk: LifeMemoryView | null,
  ledger: { count: number; lastAt: number },
  today: string = dayKey(Date.now()),
): LifeMemoryView {
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
    mode: disk?.mode ?? mem.mode ?? 'auto',
  }
}

/** ② 睡着：距上次动作 ≥6h 算睡下（除非主人切了 force_awake / force_sleep）。 */
export const SLEEP_AFTER_MS = 6 * 3_600_000
export function isAsleep(
  lastActionAt: number | null | undefined,
  now: number = Date.now(),
  mode: RhythmMode = 'auto',
): boolean {
  if (mode === 'force_sleep') return true
  if (mode === 'force_awake') return false
  if (lastActionAt == null || !Number.isFinite(Number(lastActionAt)) || Number(lastActionAt) <= 0) return true
  return now - Number(lastActionAt) >= SLEEP_AFTER_MS
}

/** ② 的恢复量：只有睡着才回体力；醒着返回 0。 */
export function restRecovery(fields: any, hours: number, asleep: boolean): number {
  return asleep ? restRecoveryDelta(fields, hours) : 0
}

/** ④ 决定：这一轮动不动（尊重主人设定的 mode）。 */
export function decideStage(opts: {
  fields: any
  relation: NPCStateName
  now: number
  mem: LifeMemoryView
  rng: () => number
}): { decision: ActionDecision; costApplied: false } {
  if (opts.mem?.mode === 'force_sleep') {
    return {
      decision: {
        act: false,
        kind: 'rest',
        reason: '主人设定了强制休息模式（force_sleep）',
        scores: { explore: 0, create: 0, connect: 0, rest: 1 },
      },
      costApplied: false,
    }
  }
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

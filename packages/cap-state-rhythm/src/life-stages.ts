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
  /** 睡眠时段（主人可改可关）；null = 关掉时段判据，只按"闲了多久" */
  sleepWindow?: SleepWindow
}

/**
 * 「累了就歇」和「睡着了」是两件事，2026-11-04 之前被塞进同一个布尔里。
 *
 * 主人的话点破了这点：**人累了就会休息，她也能这样。** 对——但休息不等于睡觉：
 *   • 歇着（resting）：体力低了就不做事，白天也会发生，慢慢回血；
 *   • 睡着（asleep）：夜间时段（或长时间闲置），**记忆结算与遗忘叙事只在这里跑**。
 * 原来只有 `isAsleep = 距上次行动 ≥6h`，于是：她几天没做事就永远不算睡（体力永不回满）、
 * 白天闲 6 小时却算"过夜"（做梦被提前触发）、账上没历史时同一段话自相矛盾
 * （14:47 线上实测：既说"她在睡着时段"又说"她想动"）。
 */
export type SleepWindow = { start: string; end: string } | null
export const DEFAULT_SLEEP_WINDOW: SleepWindow = { start: '01:00', end: '07:00' }
/** 体力低于这个数就算"她累了"（比 decideAction 的 tired 门槛 0.18 宽松：累了不等于不想动） */
export const REST_BELOW_ENERGY = 0.35

const hhmm = (s: string): number | null => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(s ?? '').trim())
  if (!m) return null
  const h = Number(m[1]), mi = Number(m[2])
  return h >= 0 && h < 24 && mi >= 0 && mi < 60 ? h * 60 + mi : null
}

/** 本地时刻落在不在睡眠时段里（支持跨零点，如 23:30–06:00） */
export function inSleepWindow(now: number, window: SleepWindow = DEFAULT_SLEEP_WINDOW, tz?: string): boolean {
  if (!window) return false
  const a = hhmm(window.start), b = hhmm(window.end)
  if (a === null || b === null || a === b) return false
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(now))
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? NaN)
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? NaN)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return false
  const cur = (hour % 24) * 60 + minute
  return a < b ? cur >= a && cur < b : cur >= a || cur < b
}

/**
 * 三态判据（**这是这次改动的正主**）：
 *   force_sleep → 睡着；force_awake → 醒着；
 *   在睡眠时段内 → 睡着；
 *   距上次行动 ≥6h 且确实有过行动 → 睡着（熬夜加班也算睡了，只是没到点）；
 *   体力 < 0.35 → 歇着；
 *   其余 → 醒着。
 * 注意 `lastActionAt<=0`（刚搬家/刚清账）**不再算睡着**：那叫没历史，不叫睡了 6 小时。
 */
export function restState(
  mem: { lastActionAt?: number; mode?: RhythmMode; sleepWindow?: SleepWindow },
  fields: { energy?: number } | null | undefined,
  now: number = Date.now(),
  tz?: string,
): 'asleep' | 'resting' | 'awake' {
  if (mem.mode === 'force_sleep') return 'asleep'
  if (mem.mode === 'force_awake') return 'awake'
  const win = mem.sleepWindow === undefined ? DEFAULT_SLEEP_WINDOW : mem.sleepWindow
  if (inSleepWindow(now, win, tz)) return 'asleep'
  const last = Number(mem.lastActionAt ?? 0)
  if (last > 0 && now - last >= SLEEP_AFTER_MS) return 'asleep'
  if (Number(fields?.energy ?? 1) < REST_BELOW_ENERGY) return 'resting'
  return 'awake'
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

/** ② 睡着：闲够多久算睡下（没有夜间时段时的另一条判据）。 */
export const SLEEP_AFTER_MS = 6 * 3_600_000

/**
 * ② 睡着：夜间时段，或确实有过行动且闲够 6 小时（force_* 最高优先）。
 *
 * **`extra.sleepWindow` 必须真的传进去**：这里曾经接了这个参数却没用，
 * 于是调用方（做梦系统）传下来的时段被丢掉、永远按默认 01:00–07:00 判——
 * 主人把时段关掉之后，她夜里照旧会去跑记忆结算。**接口收了却不用的参数，
 * 比没有这个参数更坏**：调用方以为自己在控制，其实没有。
 */
export function isAsleep(
  lastActionAt: number | null | undefined,
  now: number = Date.now(),
  mode: RhythmMode = 'auto',
  extra?: { energy?: number; sleepWindow?: SleepWindow; timezone?: string },
): boolean {
  const mem: { lastActionAt: number; mode: RhythmMode; sleepWindow?: SleepWindow } =
    { lastActionAt: Number(lastActionAt ?? 0), mode }
  // 只有调用方**明确给了**这个键才覆盖：不给（undefined）才用默认时段，
  // 给了 null 是"关掉时段判据"，那也是明确的意图，不能当成没给。
  if (extra && Object.hasOwn(extra, 'sleepWindow')) mem.sleepWindow = extra.sleepWindow ?? null
  return restState(
    mem,
    extra && extra.energy !== undefined ? { energy: extra.energy } : null,
    now,
    extra?.timezone,
  ) === 'asleep'
  // 旧行为里 `lastActionAt<=0 → 睡着` 是错的：那叫"没历史"。
  // 传了 extra.energy 时，'resting' 也返回 false（歇着不是睡着，不该触发夜间结算）。
}

/** ② 的恢复量：睡着按原速率，歇着给一半——白天累了也该慢慢回血，不然一 tired 就再也不满。 */
export function restRecovery(
  fields: { energy?: number } | any,
  hours: number,
  asleep: boolean,
  resting = false,
): number {
  if (asleep) return restRecoveryDelta(fields, hours)
  if (resting) return restRecoveryDelta(fields, hours * 0.5)
  return 0
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

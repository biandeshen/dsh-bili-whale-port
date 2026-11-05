/**
 * 状态驱动的行动节奏 —— 不是"定时唤醒"，是"她一直活着，想做事才做事"：
 * 场值（无聊/想他/睡够了）+ 关系 + 随机抖动 决定要不要起一个行动回合。
 * 没有"正确作息"时间表，也没有到点必须醒。
 *
 * 触发条件是"她现在缺什么/想干什么"，不是"现在几点"。
 */
import type { AtomicFields } from './types.ts'
import type { NPCStateName } from './npc-state-machine.ts'
import { pickActivities, activityDrive, type LifeActivity } from './life-activities.ts'

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

/**
 * 四个驱动分（0–1）。带出来是为了**可解释**：她"想动"或"不想动"时，
 * 面板与日志都得能说清是哪一路在推——不然只能看到一个 urge 数，猜不出原因。
 */
export interface ActionScores {
  explore: number
  connect: number
  restPressure: number
  /** 7 类活动里最想做的那一类的倾向分 */
  activity: number
}

export type ActionDecision =
  | { act: false; reason: 'tired' | 'gap' | 'cap' | 'content' | 'asleep' | 'forced'; urge: number; scores?: ActionScores }
  | { act: true; kind: ActionKind; reason: string; urge: number; activity?: LifeActivity; scores?: ActionScores }

/** 两次行动之间的最小间隔。
 * 2026-10-30 主人裁决二：**事件驱动，不设人为间隔**。
 * 唯一保留的是防重入：行动回合本身还在跑时不能开第二个（由 lifeTick 单 timer 结构保证）。
 * B 站侧的写间隔（writeGapSec）由 traffic guard 管——那是平台风控的疼觉反射，
 * 与她"想不想做"无关。这里 0 = 纯事件驱动：场值变了就评估，想动就动。 */
export const MIN_GAP_MS = 0
/**
 * 2026-10-30 主人裁决：**不设每日次数上限**。
 * "每天 ≤3 次"是发明的作息，不是她的欲望——像人 = 想做就做，
 * Token/体力花完自然歇（冬眠），恢复再活。频率由体力与场值自己收敛：
 * 行动耗 0.05 体力，睡着才恢复；体力低 → tired 门自然拦住，不需要人为 cap。
 * 保守的兜底仍是"一分钟最多被检查一次"× CHECK_PROB，不会狂刷。
 */
export const MAX_ACTIONS_PER_DAY = Number.POSITIVE_INFINITY
/**
 * 每次评估的基准概率（还要乘驱动强度）。
 *
 * 2026-11-06 从 0.05 调到 0.02：概率门只在**没有投递**时才拦（shouldAct=false 时
 * 一个字都不注入、一次模型调用都不花），所以它不该再拿"节省调用"当理由；
 * 它现在是纯粹的行动节奏旋钮。驱动换成 7 类活动分之后强度常在 0.8–1.0，
 * 5% × 每 5 分钟一拍 ≈ 一天 10 次以上；2% 落在每天 4–6 次。
 */
const CHECK_PROB = 0.02
/**
 * 休息时体力恢复速度（每小时）——只在睡着（距上次行动 ≥6h）生效。
 * 0.003/h 是"24h 都在歇"的旧口径；睡着按每天 ~16h 算只回 0.048，
 * 追不上 1–2 轮活动的 0.07–0.14，实测 30 天会卡在 0.15–0.2 的疲劳门附近。
 * 0.005/h × 16h ≈ 0.08/天，够一到两轮活动，又不会"满血恒久"。
 */
export const REST_RECOVERY_PER_HOUR = 0.008
/**
 * 行动一轮的基础体力开销（含看片/写日记）。
 * 原来 0.05 是按"一天一两轮"配的；驱动换成活动分后一天 4–6 轮，
 * 0.05 × 5 = 0.25/天 会把她三天就按进疲劳门，所以降到 0.015（≈0.08/天，与睡眠恢复持平）。
 */
export const ACTION_COST_ENERGY = 0.015
/** 歇够多久开始"想活动一下"（小时），到 REST_FULL_HOURS 达到满值 */
const REST_PRESSURE_START_H = 12
const REST_FULL_HOURS = 30
/** 下一次评估间隔：3–7 分钟随机 */
export const NEXT_CHECK_MIN_MS = 3 * 60_000
export const NEXT_CHECK_MAX_MS = 7 * 60_000

const clamp01 = (n: number) => Math.max(0, Math.min(1, n))

/** 日界 = 自然日 00:00（2026-10-31 主人拍板；原 04:00），与 days/ 快照、草稿日期保持一致。 */
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
  // 时钟回拨时 lastActionAt 可能在未来：负间隔不能被当成"还没到"而永久卡死
  const sinceLast = mem.lastActionAt ? now - mem.lastActionAt : Infinity
  if (sinceLast >= 0 && sinceLast < MIN_GAP_MS) return { act: false, reason: 'gap', urge: 0 }
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

  /**
   * 驱动 = 四个来源里最强的那个：
   *   · explore / connect —— "缺什么"（场值低时升高）；
   *   · restPressure —— "歇够了"（距上次行动越久越高）；
   *   · activityDrive —— "7 类里最想做的那一类有多想"（场值高时也成立）。
   *
   * 第四个是 2026-11-06 补的：只算前三个时，被喂饱 + 刚动过 = 三个全 0，
   * 她会锁死到场值衰减为止（70 小时以上）。这不是"她不想动"，是账算错了。
   */
  const activity = activityDrive(f)
  const drive = Math.max(explore, connect, restPressure, activity)
  const urge = drive * (1 - tired)
  const scores: ActionScores = { explore, connect, restPressure, activity }
  if (rng() >= urge * CHECK_PROB) return { act: false, reason: 'content', urge, scores }

  /**
   * 动了，但**做的是什么**由 7 类生活活动表挑（`pickActivities`）。
   *
   * 为什么以前不接（审计 §"接上死代码"）：`life-activities.ts` 那张表
   * （歇会儿 / 找点新鲜的 / 做点东西 / 想他 / 想想事 / 动一动 / 看点轻松的）
   * 写得很细，却**从来没有生产调用者**——她每次动的理由只有三个词
   * （explore / connect / restless），日账里读起来像机器人。
   *
   * 接法：**驱动决定大方向，活动表决定具体做什么**。
   *   · 无聊（explore 高）→ 找点新鲜的 / 看点轻松的 / 做点东西 这一类里挑；
   *   · 想他（connect 高）→ 想他 / 翻旧记录；
   *   · 歇够了（restPressure 高）→ 动一动 / 歇会儿 / 想想事。
   * 场值打分 + 抖动决定候选（同 `pickActivities` 的口径），**代码不替她决定做哪个**：
   * 表里的 `description` 会随小时轮换，同一类活动不同时辰说法不同。
   */
  const candidates = pickActivities(f, { now, rng, k: 3 })
  const byType = new Map(candidates.map((c) => [c.type, c]))
  // 候选表没覆盖到的大方向，就退回该方向对应的那一类
  const fallback: Record<'explore' | 'connect' | 'restless', LifeActivity['type']> = {
    explore: 'explore',
    connect: 'social',
    restless: 'reflect',
  }
  const pick = (preferred: Array<LifeActivity['type']>, fb: LifeActivity['type']): LifeActivity => {
    for (const t of preferred) {
      const hit = byType.get(t)
      if (hit) return hit
    }
    // 候选里没有就现算一个（描述照样按小时轮换）
    const [fallbackPick] = pickActivities(f, { now, rng: () => 0, k: 7 }).filter((c) => c.type === fb)
    return fallbackPick ?? { type: fb, label: fb, description: '' }
  }

  if (explore >= connect && explore >= restPressure) {
    const a = pick(['explore', 'consume', 'create'], fallback.explore)
    return { act: true, kind: 'explore', reason: a.description || '有点无聊，想找点新鲜的看', urge, activity: a, scores }
  }
  if (connect >= explore && connect >= restPressure) {
    const a = pick(['social', 'reflect'], fallback.connect)
    return { act: true, kind: 'connect', reason: a.description || '想他了，想知道他有没有来找过你', urge, activity: a, scores }
  }
  const a = pick(['exercise', 'reflect', 'rest'], fallback.restless)
  return { act: true, kind: 'restless', reason: a.description || '歇够了，想活动一下', urge, activity: a, scores }
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

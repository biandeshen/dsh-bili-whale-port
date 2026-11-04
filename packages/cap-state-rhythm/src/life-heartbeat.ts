/**
 * 心跳（LifeHeartbeat）——她自己醒过来的那拍。
 *
 * 为什么要有这个文件（2026-11-04 发现的真实事故）：架构重写把她的"作息"全部搬进了
 * cap-state-rhythm，但**没人把框架的心跳接上**。旧内建 bot（cormini）是在自己的
 * persona 里 new Heartbeat(...) 并在 onStart 里 startRhythm()；转接头 XiaoYuPersona
 * 只挂了 DreamTick，没有心跳。结果就是：她今天一次都没动（life.json 的
 * actionsToday=0、nextCheckAt 停在启动那一刻），只有主人戳一下或来消息才会醒。
 * **一个不会自己醒的人格，不是人格，是聊天窗口。**
 *
 * 语义照内建 bot 那份（Cortico 是 MIT，但这是 bots/cormini 的内部件，不 import 它——
 * 能力包不能反向依赖某个具体底座的内置 bot）：
 *   ① 基线间隔**每拍重读**（WebUI 改了立刻生效，不等重启）；
 *   ② 连续空拍（两拍之间没有任何外部活动）按 2^n 退避，封顶 8×，来事件即复位；
 *   ③ 基线给 null（主人关了心跳）时不投事件，但每 30 分钟回来重读一次策略，
 *      否则"关了再开"要重启才生效。
 *
 * 投递动作本身由调用方给（onFire），本文件不碰宿主 API：能力包保持宿主无关。
 */

/** 基线为 null 时，隔这么久回来重读一次策略 */
const POLICY_RECHECK_MS = 30 * 60_000
/** 连续空拍的退避倍率上限 */
const IDLE_BACKOFF_MAX = 8
/** 空拍数封顶在倍率到顶那一拍：再数下去只是让 2^n 溢出 */
const IDLE_TICKS_MAX = Math.ceil(Math.log2(IDLE_BACKOFF_MAX))

export interface LifeHeartbeatOptions {
  /** 基准间隔（毫秒）；返回 null = 此刻不心跳 */
  baseline: (now: Date) => number | null
  /** 到点投递（调用方在这里 injectDeferred 进上下文） */
  onFire: () => void
  now?: () => number
}

export class LifeHeartbeat {
  private timer: ReturnType<typeof setTimeout> | null = null
  private running = false
  private lastActivity: number
  private idleTicks = 0
  private lastFire = 0
  /** 下一拍真正会落的时间（毫秒时间戳）；没排上时为 0 */
  private nextFireAtMs = 0
  private readonly now: () => number

  private readonly opts: LifeHeartbeatOptions

  constructor(opts: LifeHeartbeatOptions) {
    this.opts = opts
    this.now = opts.now ?? (() => Date.now())
    this.lastActivity = this.now()
  }

  /**
   * 下一拍真正会落的时间。
   *
   * 为什么需要它：作息账上写的 `nextCheckAt` 原本是"3–7 分钟后"，可心跳在连续空拍时
   * 按 2^n 退避（封顶 8×，5 分钟基线 → 最长 40 分钟）。于是账上写着"4 分钟后评估"，
   * 实际上 40 分钟后才评估——**账与事实对不上**，健康检查据此报假警。
   * 把它交出去，账上写的就是真时间。
   */
  nextFireAt(): number {
    return this.nextFireAtMs
  }

  /** 任何外部事件（消息、World 投递、主人戳醒）都算"她被人叫过"，退避清零。 */
  noteActivity(): void {
    this.lastActivity = this.now()
    this.idleTicks = 0
  }

  /** 安静了多久（秒）——投进上下文的那句话要按当前安静时长生成。 */
  quietSeconds(): number {
    return Math.max(0, Math.round((this.now() - this.lastActivity) / 1000))
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.armNext()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  /** 下一拍的间隔：基线按空拍数退避。null = 此刻不心跳。 */
  nextDelay(now: Date = new Date()): number | null {
    const base = this.opts.baseline(now)
    if (base === null || !Number.isFinite(base) || base <= 0) return null
    return base * Math.min(2 ** this.idleTicks, IDLE_BACKOFF_MAX)
  }

  private armNext(): void {
    if (!this.running) return
    if (this.timer) clearTimeout(this.timer)
    const delay = this.nextDelay()
    if (delay === null) {
      // 心跳关着：也留一个真时间（30 分钟后回来重读策略），别让账上写 0
      this.nextFireAtMs = this.now() + POLICY_RECHECK_MS
      this.timer = setTimeout(() => this.armNext(), POLICY_RECHECK_MS)
      return
    }
    this.nextFireAtMs = this.now() + delay
    this.timer = setTimeout(() => this.fire(), delay)
    // 心跳不该拖住进程退出（测试与 CLI 复用同一个包时尤其重要）
    if (typeof this.timer === 'object' && 'unref' in this.timer) (this.timer as any).unref?.()
  }

  private fire(): void {
    if (!this.running) return
    // 定时等待期间主人可能关了心跳：投递前重新求值一次策略
    if (this.nextDelay() !== null) {
      // 空拍计数在投递前结算：上一拍到这一拍之间没有任何外部活动即记一拍空转
      if (this.lastActivity > this.lastFire) this.idleTicks = 0
      else this.idleTicks = Math.min(this.idleTicks + 1, IDLE_TICKS_MAX)
      this.lastFire = this.now()
      // **下一拍的真时间先算好再投递**：投递方（作息账）要拿它写 nextCheckAt，
      // 拿到的必须是**下一拍**的时间，不是刚刚这一拍（否则账上写的是过去）。
      // 空拍计数已经结算过了，所以这里的间隔是**退避后**的那一拍。
      this.nextFireAtMs = this.lastFire + this.nextDelay()!
      this.opts.onFire()
    }
    this.armNext()
  }
}

/** 安静时长写成人话：不足一分钟按秒说，免得短间隔心跳反复显示"0 分钟"。 */
export function quietLine(seconds: number): string {
  if (seconds < 60) return `[system] 已安静 ${seconds} 秒。`
  return `[system] 已安静 ${Math.floor(seconds / 60)} 分钟。`
}

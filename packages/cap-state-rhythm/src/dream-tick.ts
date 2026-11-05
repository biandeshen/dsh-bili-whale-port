/**
 * 做梦系统：睡眠期的记忆结算循环（sleep-time compute 的最小落地）。
 *
 * 她睡着的时候（isAsleep 且非 force_awake），每隔 checkIntervalMinutes 跑一次：
 *   ① settle：active 层记忆自然衰减，沉入归档的条目经 dreamDigest 变成一行"夜里结算记忆"，
 *      由调用方写进私人日记（记忆观：遗忘叙事化——遗忘是她日子里看得见的事）；
 *   ② 场值按睡眠自然恢复（不行动）。
 *
 * 她「醒着」时此循环不做事（只有结算窗口）；被 wakeNow / 消息唤醒后自然中断。
 * 循环由 XiaoYuPersona 持有，挂在 BotParts.onStart，与生活 tick 同源，绝无第二份。
 */
import fs from 'node:fs'
import path from 'node:path'

export interface DreamTickOptions {
  /** life.json 路径（读睡着状态） */
  lifeFile: string
  /** 梦话回调：digest 为第一人称遗忘叙事（null = 本夜无归档，不写） */
  onDream: (digest: string | null, archivedCount: number) => void
  /**
   * 睡着判定。第四个参数把她账上的时段带进来（`{ sleepWindow }`），
   * 不给就由实现方用默认——**不给不等于关掉**。
   */
  isAsleep: (lastActionAt: number | null | undefined, now: number, mode?: string, extra?: { sleepWindow?: { start: string; end: string } | null }) => boolean
  /** 结算执行者（MemoryCardStore.settle） */
  settle: (days?: number, archiveThreshold?: number) => unknown
  /**
   * 归档阈值（鲜活度低于它就沉入 archived）。默认 0.35。
   *
   * 以前这里是**写死的 0.35**，配置里的 `memory.archiveThreshold` 改了也没人读——
   * 又一个空旋钮。现在由主人现读后传进来。
   */
  archiveThreshold?: number
  /**
   * 睡前的反思（主人拍板：反思花模型钱）。
   *
   * 由外部（cortico-bot-xiaoyu）实现：起一个临时 session 让她真的想一遍。
   * 这里只负责**在结算之后问一次**要不要想，并把结果记进账（每天最多一次）。
   *
   * **本地那条路（settle + dreamDigest）不受影响**：反思失败、没凭据、开关关着，
   * 她照样做梦、照样沉记忆——反思只是多出来的一件事，不是前置条件。
   */
  onReflect?: (ctx: { archived: number; digest: string | null; atMs: number }) => Promise<void> | void
  /** 结算→梦话翻译（MemoryCardStore.dreamDigest） */
  dreamDigest: (settleResult: unknown) => string | null
  /** 结算间隔毫秒（默认 30 分钟） */
  intervalMs?: number
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export class DreamTick {
  private timer: ReturnType<typeof setInterval> | null = null
  /** 上次结算的日期（本地日界）；同一天不重复结算 */
  private lastSettleDay = ''
  private readonly opts: DreamTickOptions

  constructor(opts: DreamTickOptions) {
    this.opts = opts
  }

  start(): void {
    if (this.timer) return
    const interval = this.opts.intervalMs ?? 30 * 60_000
    this.timer = setInterval(() => {
      try {
        this.tickOnce()
      } catch (e) {
        // 处理器自己绝不能抛：2026-11-04 08:24 线上那次，tick 抛了本可以被这里接住的异常，
        // 结果 log() 里那句 `core.log?.(...)`（core.log 是对象不是函数）把 TypeError 顶成
        // 未捕获异常，框架关机——**错误处理器成了错误源，还顺手吞掉了原始异常**。
        const why = String((e as any)?.message ?? e)
        try {
          this.opts.log?.('warn', `做梦 tick 异常（不中断循环）：${why}`)
        } catch { /* 连日志都写不了就算了，循环必须继续 */ }
      }
    }, interval)
    // 不阻止进程退出
    if (typeof this.timer === 'object' && 'unref' in this.timer) (this.timer as any).unref?.()
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  private today(): string {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }

  private readLife(): { lastActionAt?: number; mode?: string; sleepWindow?: unknown } {
    try {
      return JSON.parse(fs.readFileSync(this.opts.lifeFile, 'utf8'))
    } catch {
      return {}
    }
  }

  tickOnce(): { dreamed: boolean; digest: string | null } {
    const life = this.readLife()
    const today = this.today()
    // 强制清醒模式不做梦；白天（醒着）也不做梦——梦是睡着时的事
    if (life.mode === 'force_awake') return { dreamed: false, digest: null }
    /**
     * 要把她账上**实际设定的**时段传进去。
     * 以前这里只给三个参数，`isAsleep` 拿不到 sleepWindow 就用默认的 01:00–07:00——
     * 于是主人在面板上"关掉时段判据"之后，夜里照旧会触发结算。
     * `life.json` 里没这个键（从没设过）= 用默认；显式 `null` = 关掉，两种都得尊重。
     */
    const win = Object.hasOwn(life as object, 'sleepWindow')
      ? { sleepWindow: (life.sleepWindow ?? null) as never }
      : {}
    if (!this.opts.isAsleep(life.lastActionAt ?? 0, Date.now(), life.mode ?? 'auto', win)) {
      return { dreamed: false, digest: null }
    }
    if (this.lastSettleDay === today) return { dreamed: false, digest: null }

    const result = this.opts.settle(1, this.opts.archiveThreshold ?? 0.35)
    this.lastSettleDay = today
    const archived = (result as any)?.archived?.length ?? 0
    const digest = this.opts.dreamDigest(result)
    this.opts.onDream(digest, archived)
    // 反思（可选、要花钱、默认关）：**放在本地结算之后**，失败也不影响做梦这条正路。
    // 这里**不 await**——反思要起模型，await 会把这一拍堵住；它本来就是后台那件事。
    if (this.opts.onReflect) {
      try {
        void Promise.resolve(this.opts.onReflect({ archived, digest, atMs: Date.now() })).catch((e: any) => {
          try { this.opts.log?.('warn', `睡前反思失败（不影响做梦）：${String(e?.message ?? e)}`) } catch { /* 连日志都写不了就算了 */ }
        })
      } catch (e: any) {
        try { this.opts.log?.('warn', `睡前反思失败（不影响做梦）：${String(e?.message ?? e)}`) } catch { /* 忽略 */ }
      }
    }
    return { dreamed: true, digest }
  }
}

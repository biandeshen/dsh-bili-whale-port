/**
 * 收件箱监听器（把迁移时落下的那只定时器接回来）。
 *
 * 旧实现在 `core/scheduler.js` 的第 310 行有一句自述，说清了这东西为什么必须存在：
 *   「`listen.allDay` 只控制"守多久" ✓，但**没人启动 listener** ✗ —— 跟生物钟当初的病一样。」
 * 能力包重写之后，同一个病又犯了一次：**四路收件箱有存储、有读工具，没有任何东西往里写**。
 * 她今天 226 笔自主行动、零次 `bili_inbox_read`，于是整天又聋又哑——不是她不想理人，
 * 是没人把"有人找她"这件事送到她面前。
 *
 * 三条从旧代码里原样保留的规矩（每条后面都注了它是怎么来的）：
 *   ① **首轮只做基线**：第一次跑不把历史全倒进她的会话里（旧注释："只把'现在'当基线"）。
 *   ② **窗口判断放在消耗间隔之前**（2026-10-24 修的）：先记 lastListenAt 再判窗口的话，
 *      窗口外白等一轮、窗口一开还得再等一整个退避间隔。
 *   ③ **失败退避有上限**（旧 pollDelay）：接口经不起每 2 秒锤，连败最多退到 15 分钟；
 *      而**窗口外不算失败**，不占退避（旧代码为此专门写了两行 return）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { pullInbox, type FetchedInboxItem, type InboxIds, type InboxSourceFail } from '../client/bili-inbox.ts'
import type { BiliReadContext } from '../client/bili-read.ts'

export interface InboxListenConfig {
  /** 「回复我的 / @我的」监听开关 */
  comment: boolean
  commentIntervalSec: number
  /** 私信监听开关 */
  dm: boolean
  dmIntervalSec: number
  /** 'both' = 回复 + @我；'reply' = 只看回复我的 */
  scope: 'both' | 'reply'
  /** 全天守，还是只在她醒着的时段守（后者省调用，也更像人） */
  allDay: boolean
  /** 只处理主人那一个号发来的（私信本来就只看主人；这条管评论/@是不是也只认主人） */
  onlyOwner: boolean
}

export const DEFAULT_LISTEN: InboxListenConfig = {
  comment: true,
  commentIntervalSec: 60,
  dm: true,
  dmIntervalSec: 150,
  scope: 'both',
  allDay: true,
  onlyOwner: false,
}

export interface ListenState {
  /** 已见过的最新时间（秒）。0 = 从没跑过，下一次只做基线。 */
  lastSeen: number
  /** 同一秒里的去重指纹（旧实现就是这个形状，别嫌它土）。 */
  lastIds: string[]
  updatedAt: string
}

export interface PollOutcome {
  /** 这一拍有没有真的去拉（窗口外/间隔未到/暂停 = 没拉）。 */
  ran: boolean
  reason?: string
  fresh?: FetchedInboxItem[]
  sourceFails?: InboxSourceFail[]
  /** 首轮基线：拉到了但一律不叫醒她。 */
  baseline?: boolean
}

export interface InboxListenerDeps {
  readCtx: () => BiliReadContext | null
  ids: () => InboxIds
  config: () => Partial<InboxListenConfig>
  /** 她醒着的时段（'HH:MM'-'HH:MM'，可多段）；allDay=true 时不调用 */
  inWindow: () => boolean
  /** 风控暂停中：不去敲门（旧代码的 networkPaused） */
  paused: () => boolean
  /** 落进存储；返回真正算"新"的那些 */
  ingest: (items: FetchedInboxItem[]) => FetchedInboxItem[]
  /** 有新东西就叫醒她一次 */
  notify: (fresh: FetchedInboxItem[], sourceFails: InboxSourceFail[]) => void
  log: (level: 'info' | 'warn', msg: string, data?: Record<string, unknown>) => void
  now?: () => number
}

/** 连败退避：从间隔起倍增至 15 分钟封顶（旧实现同口径）。 */
export function pollDelay(baseSec: number, failures: number): number {
  const b = Math.max(60, Number(baseSec) || 60)
  if (failures <= 0) return b * 1000
  return Math.min(15 * 60_000, b * 1000 * 2 ** Math.min(failures, 5))
}

export class BiliInboxListener {
  private readonly stateFile: string
  private readonly d: InboxListenerDeps
  private timer: ReturnType<typeof setTimeout> | null = null
  private commentFailures = 0
  private dmFailures = 0
  private lastCommentAt = 0
  private lastDmAt = 0
  private stopped = false
  private ticking = false

  // Node 24 的 strip-only 模式不支持构造参数属性，必须显式声明再赋值。
  constructor(stateFile: string, deps: InboxListenerDeps) {
    this.stateFile = stateFile
    this.d = deps
  }

  private readState(): ListenState {
    try {
      const raw = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
      return {
        lastSeen: Number(raw?.lastSeen ?? 0),
        lastIds: Array.isArray(raw?.lastIds) ? raw.lastIds.map(String) : [],
        updatedAt: String(raw?.updatedAt ?? ''),
      }
    } catch {
      return { lastSeen: 0, lastIds: [], updatedAt: '' }
    }
  }

  private writeState(s: ListenState): void {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true })
      const tmp = `${this.stateFile}.${process.pid}.tmp`
      fs.writeFileSync(tmp, JSON.stringify({ ...s, updatedAt: new Date().toISOString() }, null, 2) + '\n', 'utf8')
      fs.renameSync(tmp, this.stateFile)
    } catch (e: any) {
      this.d.log('warn', '监听态写盘失败', { error: String(e?.message ?? e) })
    }
  }

  /** 主人改了开关后调用：旧账不清会让下一次白等最多 15 分钟（旧实现为此写了这段）。 */
  reset(): void {
    this.commentFailures = 0
    this.dmFailures = 0
    this.lastCommentAt = 0
    this.lastDmAt = 0
  }

  start(): void {
    this.stopped = false
    this.schedule(1000)
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }

  private schedule(ms: number): void {
    if (this.stopped) return
    this.timer = setTimeout(() => {
      void this.tick().finally(() => this.schedule(5000))
    }, ms)
    if (typeof (this.timer as any).unref === 'function') (this.timer as any).unref()
  }

  /**
   * 一拍：判开关 → 判窗口 → 判间隔 → 拉 → 首轮建基线 / 否则叫醒她。
   * 导出给测试与面板手动跑一拍（`--once` 那种运维入口）用。
   */
  async tick(): Promise<PollOutcome[]> {
    if (this.ticking || this.stopped) return []
    this.ticking = true
    try {
      const cfg: InboxListenConfig = { ...DEFAULT_LISTEN, ...(this.d.config() ?? {}) }
      const now = this.d.now?.() ?? Date.now()
      const outs: PollOutcome[] = []
      if (cfg.comment) outs.push(await this.pollComment(cfg, now))
      if (cfg.dm) outs.push(await this.pollDm(cfg, now))
      return outs.filter(Boolean)
    } finally {
      this.ticking = false
    }
  }

  /** 通用的一段前置检查：窗口 → 暂停 → 间隔（**顺序不能调**，见文件头②）。 */
  private gate(cfg: InboxListenConfig, which: 'comment' | 'dm'): { go: true } | { go: false; reason: string } {
    if (!cfg.allDay && !this.d.inWindow()) {
      // 窗口外：不算失败、不占间隔（旧代码专门写了两行 return 来保证这一点）
      if (which === 'comment') this.commentFailures = 0
      else this.dmFailures = 0
      return { go: false, reason: '窗口外' }
    }
    if (this.d.paused()) return { go: false, reason: '风控暂停' }
    const baseSec = which === 'comment' ? cfg.commentIntervalSec : cfg.dmIntervalSec
    const fails = which === 'comment' ? this.commentFailures : this.dmFailures
    const last = which === 'comment' ? this.lastCommentAt : this.lastDmAt
    const interval = pollDelay(baseSec, fails)
    if ((this.d.now?.() ?? Date.now()) - last < interval) return { go: false, reason: '间隔未到' }
    return { go: true }
  }

  private markRun(which: 'comment' | 'dm'): void {
    const now = this.d.now?.() ?? Date.now()
    if (which === 'comment') this.lastCommentAt = now
    else this.lastDmAt = now
  }

  private async pollComment(cfg: InboxListenConfig, now: number): Promise<PollOutcome> {
    const g = this.gate(cfg, 'comment')
    if (!g.go) return { ran: false, reason: g.reason }
    this.markRun('comment')
    const ctx = this.d.readCtx()
    if (!ctx) { this.commentFailures += 1; return { ran: false, reason: '缺凭据' } }
    try {
      // 「收到的赞」归在这一路一起拉：它是四路收件箱之一，没有别的定时器管它。
      // scope='reply' 时不拉 @我，但赞照拉——那是两个维度（范围 vs 是否被 @）。
      const r = await pullInbox(ctx, this.d.ids(), {
        include: cfg.scope === 'reply' ? ['reply', 'like'] : ['reply', 'at', 'like'],
      })
      return this.settle('comment', r, now, cfg)
    } catch (e: any) {
      this.commentFailures += 1
      this.d.log('warn', '收件箱监听（回复/@我/赞）拉取失败', { error: String(e?.message ?? e), failures: this.commentFailures })
      return { ran: false, reason: '拉取抛错' }
    }
  }

  private async pollDm(cfg: InboxListenConfig, now: number): Promise<PollOutcome> {
    const g = this.gate(cfg, 'dm')
    if (!g.go) return { ran: false, reason: g.reason }
    // **身份没落到账上就不碰私信**：pullDm 靠 selfMid 把她自己发的消息剔出去，
    // 缺了它，她自己的回信会以"新私信"的身份把她再叫醒一次 → 自激循环。
    // 宁可这一路先空转，也不冒这个险；评论/@我 不受影响。
    if (!String(this.d.ids().selfMid ?? '').trim()) return { ran: false, reason: '她自己的 mid 还没落到账上' }
    this.markRun('dm')
    const ctx = this.d.readCtx()
    if (!ctx) { this.dmFailures += 1; return { ran: false, reason: '缺凭据' } }
    try {
      const r = await pullInbox(ctx, this.d.ids(), { include: ['dm'] })
      return this.settle('dm', r, now, cfg)
    } catch (e: any) {
      this.dmFailures += 1
      this.d.log('warn', '私信监听拉取失败', { error: String(e?.message ?? e), failures: this.dmFailures })
      return { ran: false, reason: '拉取抛错' }
    }
  }

  /**
   * 落地一批拉取结果：首轮建基线；之后只把"比基线新、且指纹没见过"的算新鲜。
   * 新鲜的一律进存储（这样她什么时候去读收件箱都在），但**只有真的新才叫醒她**——
   * 旧设计那句"你不说话 = 没有新私信 = 不叫醒 = 零 token"就是这个意思。
   */
  private settle(
    which: 'comment' | 'dm',
    r: Awaited<ReturnType<typeof pullInbox>>,
    now: number,
    cfg: InboxListenConfig,
  ): PollOutcome {
    const st = this.readState()
    const fails = r.sourceFails ?? []
    if (fails.length) {
      if (which === 'comment') this.commentFailures += 1
      else this.dmFailures += 1
      this.d.log('warn', '监听某一路失效', { which, sourceFails: fails, failures: which === 'comment' ? this.commentFailures : this.dmFailures })
    } else if (which === 'comment') this.commentFailures = 0
    else this.dmFailures = 0

    // ① 首轮：只记基线，不倒历史
    if (!st.lastSeen) {
      const lastSeen = Math.max(
        Math.floor(now / 1000),
        Number(r.lastViewSec ?? 0),
        ...r.items.map((x) => Math.floor(x.atMs / 1000)),
      )
      this.writeState({ ...st, lastSeen: Number.isFinite(lastSeen) ? lastSeen : Math.floor(now / 1000), lastIds: r.items.map((x) => x.key).slice(-200) })
      return { ran: true, baseline: true, sourceFails: fails, fresh: [] }
    }

    const seenIds = new Set(st.lastIds)
    let fresh = r.items.filter((x) => (
      (Math.floor(x.atMs / 1000) > st.lastSeen || (Math.floor(x.atMs / 1000) === st.lastSeen && !seenIds.has(x.key)))
      && (!cfg.onlyOwner || String(x.uid) === String(this.d.ids().ownerMid ?? ''))
    ))
    if (!fresh.length) return { ran: true, sourceFails: fails, fresh: [] }

    fresh.sort((a, b) => a.atMs - b.atMs)
    const added = this.d.ingest(fresh)
    // 基线往前推：取这批里最新的时间，别用 now（她的钟以内容时间为准）
    const newest = Math.max(...r.items.map((x) => Math.floor(x.atMs / 1000)), st.lastSeen)
    this.writeState({ lastSeen: newest, lastIds: r.items.map((x) => x.key).slice(-200), updatedAt: st.updatedAt })
    if (added.length) this.d.notify(added, fails)
    return { ran: true, sourceFails: fails, fresh: added }
  }

  /** 面板要看的实况。 */
  status(): { commentFailures: number; dmFailures: number; lastCommentAt: number; lastDmAt: number; state: ListenState } {
    return {
      commentFailures: this.commentFailures,
      dmFailures: this.dmFailures,
      lastCommentAt: this.lastCommentAt,
      lastDmAt: this.lastDmAt,
      state: this.readState(),
    }
  }
}

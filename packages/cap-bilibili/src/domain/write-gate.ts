/**
 * 唯一不可逆写把关链（WriteGate）+ 统一待放行队列（动态草稿/私信草稿/待审评论/待审弹幕四合一）。
 *
 * 严格实现 docs/ARCHITECTURE-TARGET-2026-11-03.md §5 与 §10.4：
 *   ① kill 急刹（入口 + 网络写前双判）
 *   ② 档位判定（读唯一 Policy 源；需放行则进统一 pending 队列，支持在线改字自动重算 bodyHash 续签令牌）
 *   ③ 内容判据（可插拔判据函数：@主人 / 30天去重 / 收藏五判据 / 私信7天回信窗）
 *   ④ quota 额度检查与记账（修掉点赞/收藏不过 quota、弹幕不记账的漏点）
 *   ⑤ traffic 冷却 / 412 风控熔断 / url+bodyHash 防重发指纹
 *   ⑥ 真实写执行器（plainOutbound 在构造时一次性清洗）
 *   ⑦ 单点记账 causal.jsonl（成功记 <kind>，失败记 <kind>-failed + stage）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { dayKey } from '../../../persona-core/src/rhythm.ts'
import { plainOutbound } from '../platform/plain-outbound.mjs'

export type WriteKind =
  | 'dynamic'
  | 'edit-dynamic'
  | 'comment'
  | 'danmaku'
  | 'dm'
  | 'like'
  | 'fav'

export type WriteIntent = 'self' | 'owner-authorized' | 'share' | 'reply'
export type PolicyTier = 'auto' | 'review' | 'self' | 'direct' | 'queue'

export interface BiliPublishPolicy {
  draftMode: 'auto' | 'review'
  autoDailyCap: number
  autoWindow: string
  like: 'self' | 'review'
  fav: 'self' | 'review'
  dmReply: 'direct' | 'queue'
  comment: 'self' | 'review'
  danmaku: 'self' | 'review'
}

/**
 * 「自动发布允许时段」的写法：`HH:MM-HH:MM`（支持跨零点，如 `23:00-07:00`）。
 * 解析失败一律当**不限**（不许因为主人写错一个字就让她整晚不能发）。
 */
export function parseAutoWindow(window: string, now: number = Date.now()): { ok: boolean; inWindow: boolean; text: string } {
  const text = String(window ?? '').trim()
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(text)
  if (!m) return { ok: false, inWindow: true, text }
  const sh = Number(m[1]), sm = Number(m[2]), eh = Number(m[3]), em = Number(m[4])
  if (sh > 23 || eh > 23 || sm > 59 || em > 59) return { ok: false, inWindow: true, text }
  const d = new Date(now)
  const cur = d.getHours() * 60 + d.getMinutes()
  const start = sh * 60 + sm
  const end = eh * 60 + em
  if (start === end) return { ok: true, inWindow: true, text }
  const inWindow = start < end ? (cur >= start && cur < end) : (cur >= start || cur < end)
  return { ok: true, inWindow, text }
}

export const DEFAULT_PUBLISH_POLICY: BiliPublishPolicy = {
  draftMode: 'review',
  autoDailyCap: 0,
  autoWindow: '00:00-24:00',
  like: 'self',
  fav: 'self',
  dmReply: 'direct',
  comment: 'review',
  danmaku: 'review',
}

export interface WriteActionInput {
  kind: WriteKind
  intent?: WriteIntent
  target: { bvid?: string; oid?: string; room?: string; mid?: string; dynId?: string }
  body: string
  imagePath?: string
  draftId?: string
  actor?: 'cli' | 'host' | 'owner'
  bypassQueueWithToken?: string
}

export interface WriteAction {
  kind: WriteKind
  intent: WriteIntent
  target: { bvid?: string; oid?: string; room?: string; mid?: string; dynId?: string }
  body: string
  bodyHash: string
  imagePath?: string
  draftId?: string
  actor: 'cli' | 'host' | 'owner'
}

export type GateVerdict =
  | { ok: true; exit: 0; result?: unknown }
  | { ok: false; exit: -2; code: 'killed'; stage: 'gate'; reason: string }
  | { ok: false; exit: 2; code: 'needs-approval'; stage: 'gate'; reason: string; pendingId: string; token: string }
  | { ok: false; exit: 2; code: 'policy'; stage: 'gate'; reason: string }
  | { ok: false; exit: 2; code: 'quota'; stage: 'gate'; reason: string; usedToday: number; cap: number }
  | { ok: false; exit: 3; code: 'precondition'; stage: 'gate'; reason: string }
  | { ok: false; exit: 4; code: 'cooldown'; stage: 'transport'; reason: string; retryAfterMs?: number }
  | { ok: false; exit: 6; code: 'platform'; stage: 'platform'; reason: string }

export interface PendingQueueItem {
  id: string
  kind: WriteKind
  intent: WriteIntent
  target: { bvid?: string; oid?: string; room?: string; mid?: string; dynId?: string }
  text: string
  bodyHash: string
  imagePath?: string
  token: string
  createdAt: string
  updatedAt: string
  status: 'pending' | 'released' | 'rejected'
  rejectReason?: string
}

export function sha1Hex(text: string): string {
  return crypto.createHash('sha1').update(String(text ?? ''), 'utf8').digest('hex')
}

export function buildWriteAction(input: WriteActionInput): WriteAction {
  const cleaned = plainOutbound(String(input.body ?? '')).trim()
  return {
    kind: input.kind,
    intent: input.intent ?? 'self',
    target: { ...input.target },
    body: cleaned,
    bodyHash: sha1Hex(cleaned),
    ...(input.imagePath ? { imagePath: input.imagePath } : {}),
    ...(input.draftId ? { draftId: input.draftId } : {}),
    actor: input.actor ?? 'host',
  }
}

export interface WriteGateOptions {
  dataDir: string
  executor?: (action: WriteAction) => Promise<{ ok: boolean; dynId?: string; rpid?: string; error?: string; status?: number }>
  contentCheck?: (action: WriteAction) => { ok: true } | { ok: false; code?: 'policy' | 'precondition'; reason: string }
  onDraftRejected?: (item: PendingQueueItem, reason: string, askRewrite: boolean) => void
  onDraftRequested?: (req: { kind: 'dynamic' | 'comment'; bvid?: string; prompt: string; atMs: number }) => void
}

export class WriteGate {
  readonly dataDir: string
  private readonly policyFile: string
  private readonly queueFile: string
  private readonly quotaFile: string
  private readonly trafficFile: string
  private readonly killFile: string
  private readonly causalFile: string
  private readonly opts: WriteGateOptions

  constructor(opts: WriteGateOptions) {
    this.opts = opts
    this.dataDir = opts.dataDir
    this.policyFile = path.join(opts.dataDir, 'policy.json')
    this.queueFile = path.join(opts.dataDir, 'pending-queue.json')
    this.quotaFile = path.join(opts.dataDir, 'quota.json')
    this.trafficFile = path.join(opts.dataDir, 'traffic-state.json')
    this.killFile = path.join(opts.dataDir, 'KILL')
    this.causalFile = path.join(opts.dataDir, 'causal.jsonl')
  }

  isKillOn(): boolean {
    return fs.existsSync(this.killFile)
  }

  setKill(on: boolean): boolean {
    fs.mkdirSync(this.dataDir, { recursive: true })
    if (on) {
      fs.writeFileSync(this.killFile, new Date().toISOString() + '\n', 'utf8')
    } else if (fs.existsSync(this.killFile)) {
      fs.unlinkSync(this.killFile)
    }
    return this.isKillOn()
  }

  readPolicy(): BiliPublishPolicy {
    try {
      const raw = JSON.parse(fs.readFileSync(this.policyFile, 'utf8'))
      return {
        draftMode: raw.draftMode === 'auto' ? 'auto' : 'review',
        autoDailyCap: Number.isFinite(Number(raw.autoDailyCap)) ? Math.max(0, Number(raw.autoDailyCap)) : 0,
        autoWindow: typeof raw.autoWindow === 'string' && raw.autoWindow.trim() ? raw.autoWindow.trim() : '00:00-24:00',
        like: raw.like === 'review' ? 'review' : 'self',
        fav: raw.fav === 'review' ? 'review' : 'self',
        dmReply: raw.dmReply === 'queue' ? 'queue' : 'direct',
        comment: raw.comment === 'self' ? 'self' : 'review',
        danmaku: raw.danmaku === 'self' ? 'self' : 'review',
      }
    } catch {
      return { ...DEFAULT_PUBLISH_POLICY }
    }
  }

  savePolicy(patch: Partial<BiliPublishPolicy>): BiliPublishPolicy {
    fs.mkdirSync(this.dataDir, { recursive: true })
    const next = { ...this.readPolicy(), ...patch }
    fs.writeFileSync(this.policyFile, JSON.stringify(next, null, 2), 'utf8')
    return this.readPolicy()
  }

  readQuota(): { day: string; selfCap: number; shareCap: number; usedSelf: number; usedShare: number; autoPublished: number } {
    const today = dayKey(Date.now())
    try {
      const raw = JSON.parse(fs.readFileSync(this.quotaFile, 'utf8'))
      const sameDay = raw.day === today
      return {
        day: today,
        selfCap: Number.isFinite(Number(raw.selfCap)) ? Number(raw.selfCap) : 12,
        shareCap: Number.isFinite(Number(raw.shareCap)) ? Number(raw.shareCap) : 3,
        usedSelf: sameDay ? Number(raw.usedSelf ?? 0) : 0,
        usedShare: sameDay ? Number(raw.usedShare ?? 0) : 0,
        autoPublished: sameDay ? Number(raw.autoPublished ?? 0) : 0,
      }
    } catch {
      return { day: today, selfCap: 12, shareCap: 3, usedSelf: 0, usedShare: 0, autoPublished: 0 }
    }
  }

  saveQuotaConfig(patch: { selfCap?: number; shareCap?: number }) {
    const cur = this.readQuota()
    const next = {
      ...cur,
      ...(patch.selfCap !== undefined ? { selfCap: Math.max(0, Number(patch.selfCap)) } : {}),
      ...(patch.shareCap !== undefined ? { shareCap: Math.max(0, Number(patch.shareCap)) } : {}),
    }
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.quotaFile, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  private bumpQuota(intent: WriteIntent): void {
    const cur = this.readQuota()
    if (intent === 'share') cur.usedShare += 1
    else cur.usedSelf += 1
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.quotaFile, JSON.stringify(cur, null, 2), 'utf8')
  }

  readTraffic(): { writeGapSec: number; pausedUntil: number; lastWriteAt: number; seenFingerprints: string[]; pauseReason: string } {
    try {
      const raw = JSON.parse(fs.readFileSync(this.trafficFile, 'utf8'))
      return {
        writeGapSec: Number.isFinite(Number(raw.writeGapSec)) ? Math.max(0, Number(raw.writeGapSec)) : 10,
        pausedUntil: Number(raw.pausedUntil ?? 0),
        lastWriteAt: Number(raw.lastWriteAt ?? 0),
        seenFingerprints: Array.isArray(raw.seenFingerprints) ? raw.seenFingerprints.slice(-500) : [],
        // 熔断为什么触发：主人要不要提前解除，全看这一句。以前只存 pausedUntil，页面上只能显示倒计时。
        pauseReason: String(raw.pauseReason ?? ''),
      }
    } catch {
      return { writeGapSec: 10, pausedUntil: 0, lastWriteAt: 0, seenFingerprints: [], pauseReason: '' }
    }
  }

  saveTraffic(patch: Partial<{ writeGapSec: number; pausedUntil: number; lastWriteAt: number; seenFingerprints: string[]; pauseReason: string }>) {
    const cur = this.readTraffic()
    const next = { ...cur, ...patch }
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.trafficFile, JSON.stringify(next, null, 2), 'utf8')
    return next
  }

  clearTrafficPause() {
    return this.saveTraffic({ pausedUntil: 0, lastWriteAt: 0, pauseReason: '' })
  }

  private writeCausal(entry: Record<string, unknown>): void {
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.appendFileSync(
      this.causalFile,
      JSON.stringify({ at: new Date().toISOString(), atMs: Date.now(), ...entry }) + '\n',
      'utf8',
    )
  }

  listQueue(statusFilter: 'pending' | 'all' = 'pending'): PendingQueueItem[] {
    try {
      const all: PendingQueueItem[] = JSON.parse(fs.readFileSync(this.queueFile, 'utf8'))
      return statusFilter === 'all' ? all : all.filter((x) => x.status === 'pending')
    } catch {
      return []
    }
  }

  private saveQueueAll(items: PendingQueueItem[]): void {
    fs.mkdirSync(this.dataDir, { recursive: true })
    const tmp = `${this.queueFile}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(items, null, 2), 'utf8')
    fs.renameSync(tmp, this.queueFile)
  }

  private needsApproval(kind: WriteKind, policy: BiliPublishPolicy): boolean {
    switch (kind) {
      case 'dynamic':
      case 'edit-dynamic':
        return policy.draftMode === 'review'
      case 'comment':
        return policy.comment === 'review'
      case 'danmaku':
        return policy.danmaku === 'review'
      case 'dm':
        return policy.dmReply === 'queue'
      case 'like':
        return policy.like === 'review'
      case 'fav':
        return policy.fav === 'review'
    }
  }

  /**
   * 自动发布的两道安全档位（审计 §2.7「安全闸补 2 档位」）。
   *
   * `autoDailyCap` 与 `autoWindow` 以前**只是配置里的两个字段，没有任何代码读它们**
   * ——主人以为设了"每天最多自动发 3 条"，其实她想发多少发多少。
   * 空的旋钮比没有旋钮更坏，所以这里把它们变成真判据。
   *
   * 两条都**只管自动发布**（draftMode === 'auto'）这一路：
   *   · 主人手动点「放行」不受影响（那是主人自己的决定）；
   *   · 命中时不是拦下来不发，而是**降级进待放行队列**——她照样写，主人照看。
   *
   * 返回空字符串 = 不拦；返回非空 = 要降级的原因（直接写进回执给主人看）。
   */
  autoPublishBlocker(policy: BiliPublishPolicy, now: number = Date.now()): string {
    if (policy.draftMode !== 'auto') return ''
    const cap = Number(policy.autoDailyCap ?? 0)
    if (cap > 0) {
      const used = this.readQuota().autoPublished
      if (used >= cap) {
        return `今天已经自动发出去 ${used} 条（上限 ${cap} 条），这一条改走待放行队列，等主人看过再发`
      }
    }
    const win = parseAutoWindow(policy.autoWindow, now)
    if (win.ok && !win.inWindow) {
      return `现在不在自动发布时段（${win.text}），这一条改走待放行队列`
    }
    return ''
  }

  /** 自动发布成功时记一笔（今天第几条自动发出去的）。 */
  private bumpAutoPublished(): void {
    const cur = this.readQuota()
    const next = { ...cur, autoPublished: cur.autoPublished + 1 }
    fs.mkdirSync(this.dataDir, { recursive: true })
    fs.writeFileSync(this.quotaFile, JSON.stringify(next, null, 2), 'utf8')
  }

  enqueue(action: WriteAction): PendingQueueItem {
    const all = this.listQueue('all')
    const id = action.draftId || `q-${action.kind}-${Date.now().toString(36)}-${crypto.randomBytes(2).toString('hex')}`
    const token = 'ack-' + crypto.randomBytes(8).toString('hex')
    const nowIso = new Date().toISOString()
    const item: PendingQueueItem = {
      id,
      kind: action.kind,
      intent: action.intent,
      target: action.target,
      text: action.body,
      bodyHash: action.bodyHash,
      ...(action.imagePath ? { imagePath: action.imagePath } : {}),
      token,
      createdAt: nowIso,
      updatedAt: nowIso,
      status: 'pending',
    }
    const filtered = all.filter((x) => x.id !== id)
    filtered.push(item)
    this.saveQueueAll(filtered)
    return item
  }

  /**
   * 主人在「统一待放行与改稿台」在线修改草稿文字或配图：
   * 一次性重算清洗后的正文 bodyHash 并续签新 token，彻底解决"改一个错别字就被哈希校验锁死拒发"。
   */
  updateDraft(input: { id: string; text: string; imagePath?: string }): { ok: true; item: PendingQueueItem } | { ok: false; error: string } {
    const all = this.listQueue('all')
    const idx = all.findIndex((x) => x.id === input.id && x.status === 'pending')
    if (idx < 0) return { ok: false, error: `找不到待放行项: ${input.id}` }
    const cleaned = plainOutbound(String(input.text ?? '')).trim()
    const nextItem: PendingQueueItem = {
      ...all[idx],
      text: cleaned,
      bodyHash: sha1Hex(cleaned),
      ...(input.imagePath !== undefined ? { imagePath: input.imagePath } : {}),
      token: 'ack-' + crypto.randomBytes(8).toString('hex'),
      updatedAt: new Date().toISOString(),
    }
    all[idx] = nextItem
    this.saveQueueAll(all)
    return { ok: true, item: nextItem }
  }

  async release(id: string): Promise<GateVerdict> {
    const all = this.listQueue('all')
    const idx = all.findIndex((x) => x.id === id && x.status === 'pending')
    if (idx < 0) {
      return { ok: false, exit: 3, code: 'precondition', stage: 'gate', reason: `找不到待放行项: ${id}` }
    }
    const item = all[idx]
    // 校验当前存储正文与 bodyHash 一致
    if (sha1Hex(item.text) !== item.bodyHash) {
      return { ok: false, exit: 2, code: 'policy', stage: 'gate', reason: '草稿正文哈希不匹配，请先保存修改后再放行' }
    }
    const verdict = await this.execute({
      kind: item.kind,
      intent: item.intent,
      target: item.target,
      body: item.text,
      imagePath: item.imagePath,
      draftId: item.id,
      actor: 'owner',
      bypassQueueWithToken: item.token,
    })
    if (verdict.ok) {
      all[idx] = { ...item, status: 'released', updatedAt: new Date().toISOString() }
      this.saveQueueAll(all)
    }
    return verdict
  }

  reject(id: string, reason: string, askRewrite = false): { ok: true; item: PendingQueueItem } | { ok: false; error: string } {
    const all = this.listQueue('all')
    const idx = all.findIndex((x) => x.id === id && x.status === 'pending')
    if (idx < 0) return { ok: false, error: `找不到待放行项: ${id}` }
    const cleanReason = String(reason ?? '').trim() || '主人未通过该草稿'
    const updated: PendingQueueItem = {
      ...all[idx],
      status: 'rejected',
      rejectReason: cleanReason,
      updatedAt: new Date().toISOString(),
    }
    all[idx] = updated
    this.saveQueueAll(all)
    this.opts.onDraftRejected?.(updated, cleanReason, askRewrite)
    return { ok: true, item: updated }
  }

  requestNewDraft(req: { kind: 'dynamic' | 'comment'; bvid?: string; prompt: string }): { ok: true; requestedAt: number } {
    const atMs = Date.now()
    this.opts.onDraftRequested?.({ ...req, atMs })
    return { ok: true, requestedAt: atMs }
  }

  async execute(rawInput: WriteActionInput): Promise<GateVerdict> {
    const action = buildWriteAction(rawInput)

    // ① kill 急刹（入口第一判）
    if (this.isKillOn()) {
      return { ok: false, exit: -2, code: 'killed', stage: 'gate', reason: 'kill 急刹已开启，所有对外写动作拦截' }
    }

    // ② 档位判定（若无一次性放行令牌且策略要求人工放行，则入队）
    const policy = this.readPolicy()
    if (!rawInput.bypassQueueWithToken && this.needsApproval(action.kind, policy)) {
      const queued = this.enqueue(action)
      return {
        ok: false,
        exit: 2,
        code: 'needs-approval',
        stage: 'gate',
        reason: `${action.kind} 当前档位要求主人放行，已进入统一待放行队列 (${queued.id})`,
        pendingId: queued.id,
        token: queued.token,
      }
    }

    // ②b 自动发布的两道安全档位：每日条数上限 + 允许时段。
    //   只在"本来会自动发出去"这一路上生效（动态发布 + draftMode=auto）；
    //   主人手动放行（bypassQueueWithToken）不受影响。
    //   命中时**降级进队列**而不是拦下来不发：她照样写，主人照看。
    if (
      !rawInput.bypassQueueWithToken
      && (action.kind === 'dynamic' || action.kind === 'edit-dynamic')
      && policy.draftMode === 'auto'
    ) {
      const why = this.autoPublishBlocker(policy)
      if (why) {
        const queued = this.enqueue(action)
        return {
          ok: false,
          exit: 2,
          code: 'auto-downgraded',
          stage: 'gate',
          reason: `${why} (${queued.id})`,
          pendingId: queued.id,
          token: queued.token,
        }
      }
    }

    // ③ 内容判据（独立判据函数）
    if (this.opts.contentCheck) {
      const c = this.opts.contentCheck(action)
      if (!c.ok) {
        const code = c.code ?? 'policy'
        this.writeCausal({ kind: `${action.kind}-failed`, stage: 'gate', actor: action.actor, bvid: action.target.bvid, reason: c.reason })
        return { ok: false, exit: code === 'precondition' ? 3 : 2, code, stage: 'gate', reason: c.reason }
      }
    }

    // ④ quota 额度检查（含 like/fav/danmaku 全覆盖）
    const quota = this.readQuota()
    if (action.intent === 'share') {
      if (quota.usedShare >= quota.shareCap) {
        this.writeCausal({ kind: `${action.kind}-failed`, stage: 'gate', actor: action.actor, reason: 'share_quota_exceeded' })
        return { ok: false, exit: 2, code: 'quota', stage: 'gate', reason: '今日分享额度已满', usedToday: quota.usedShare, cap: quota.shareCap }
      }
    } else if (quota.usedSelf >= quota.selfCap) {
      this.writeCausal({ kind: `${action.kind}-failed`, stage: 'gate', actor: action.actor, reason: 'self_quota_exceeded' })
      return { ok: false, exit: 2, code: 'quota', stage: 'gate', reason: '今日自主互动额度已满', usedToday: quota.usedSelf, cap: quota.selfCap }
    }

    // ⑤ traffic 冷却 / 412 风控熔断 / 防重发指纹
    const traffic = this.readTraffic()
    const now = Date.now()
    if (traffic.pausedUntil > now) {
      this.writeCausal({ kind: `${action.kind}-failed`, stage: 'transport', actor: action.actor, reason: 'traffic_paused_412' })
      return {
        ok: false,
        exit: 4,
        code: 'cooldown',
        stage: 'transport',
        reason: '处于 412 风控熔断暂停窗口',
        retryAfterMs: traffic.pausedUntil - now,
      }
    }
    const gapMs = traffic.writeGapSec * 1000
    if (traffic.lastWriteAt > 0 && now - traffic.lastWriteAt < gapMs) {
      const waitMs = gapMs - (now - traffic.lastWriteAt)
      this.writeCausal({ kind: `${action.kind}-failed`, stage: 'transport', actor: action.actor, reason: 'write_cooldown' })
      return {
        ok: false,
        exit: 4,
        code: 'cooldown',
        stage: 'transport',
        reason: `写操作冷却中，需等待 ${Math.ceil(waitMs / 1000)}s`,
        retryAfterMs: waitMs,
      }
    }
    const fingerprint = `${action.kind}:${action.target.bvid ?? action.target.oid ?? action.target.mid ?? ''}:${action.bodyHash}`
    if (traffic.seenFingerprints.includes(fingerprint)) {
      this.writeCausal({ kind: `${action.kind}-failed`, stage: 'transport', actor: action.actor, reason: 'duplicate_fingerprint' })
      return {
        ok: false,
        exit: 4,
        code: 'cooldown',
        stage: 'transport',
        reason: '防重发拦截：相同目标与正文指纹已发送过',
      }
    }

    // ⑥ 网络写前二次判 kill（防入队后开启急刹的时间差）
    if (this.isKillOn()) {
      return { ok: false, exit: -2, code: 'killed', stage: 'gate', reason: '网络发送前检测到 kill 急刹已开启' }
    }

    const execResult = this.opts.executor
      ? await this.opts.executor(action)
      : { ok: true, dynId: `sim-${Date.now()}` }

    if (!execResult.ok) {
      if (execResult.status === 412) {
        // 记下"为什么被熔断"：解除确认层要有原因可看，不然主人只能对着一个倒计时猜。
        // 具体是哪个接口返回的 412 现在拿不到（执行器只回 error/status），别在这里编一个。
        const why = `写 ${action.kind}${action.target.bvid ? `（${action.target.bvid}）` : ''} 被平台判 412：${execResult.error ?? '未提供原因'}，已自动进入 30 分钟熔断保护`
        this.saveTraffic({ pausedUntil: now + 30 * 60_000, pauseReason: why })
        this.writeCausal({ kind: `${action.kind}-failed`, stage: 'transport', actor: action.actor, reason: 'http_412' })
        return { ok: false, exit: 4, code: 'cooldown', stage: 'transport', reason: why }
      }
      this.writeCausal({ kind: `${action.kind}-failed`, stage: 'platform', actor: action.actor, reason: execResult.error ?? 'platform_error' })
      return { ok: false, exit: 6, code: 'platform', stage: 'platform', reason: execResult.error ?? '平台返回错误' }
    }

    // ⑦ 成功：扣减额度、更新防重发指纹、单点写 causal.jsonl
    this.bumpQuota(action.intent)
    // 自动发布成功要记一笔（"今天已自动发 N 条"是每日上限那条档位的账）
    if ((action.kind === 'dynamic' || action.kind === 'edit-dynamic') && policy.draftMode === 'auto') {
      this.bumpAutoPublished()
    }
    this.saveTraffic({
      lastWriteAt: now,
      seenFingerprints: [...traffic.seenFingerprints, fingerprint].slice(-500),
    })
    this.writeCausal({
      kind: action.kind,
      actor: action.actor,
      bvid: action.target.bvid,
      dynId: execResult.dynId,
      rpid: execResult.rpid,
    })

    return { ok: true, exit: 0, result: execResult }
  }
}

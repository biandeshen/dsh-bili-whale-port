/**
 * @xiaoyu/cap-bilibili —— B 站整域能力扩展包（100% 宿主无关，零 spawn argv）。
 *
 * 包含：
 * - 四路入站感知合一（dm / reply / mention / like）与主动事件唤醒
 * - 18 个进程内 Typed 工具（补齐 bili_inbox_read / bili_inbox_ack / bili_comment / bili_danmaku / bili_dynamic_edit / bili_watch 等）
 * - 唯一不可逆写把关链（WriteGate）与统一待放行队列（动态草稿/私信草稿/待审评论/待审弹幕四合一）
 * - 四大主人可写操作台（inbox / drafts-queue / preferences / gate-policy）
 */
import path from 'node:path'
import fs from 'node:fs'
import type {
  XiaoyuCapability,
  CapabilityHost,
  TurnContext,
  PrefixBlock,
} from '../../persona-core/src/capability.ts'
import {
  WriteGate,
  DEFAULT_PUBLISH_POLICY,
  buildWriteAction,
  sha1Hex,
  type WriteKind,
  type WriteIntent,
  type BiliPublishPolicy,
  type WriteActionInput,
  type WriteAction,
  type GateVerdict,
  type PendingQueueItem,
} from './domain/write-gate.ts'
import {
  BiliInboxAndPrefsStore,
  DEFAULT_WATCH_PREFS,
  type InboxKind,
  type InboxItem,
  type WatchPreferences,
} from './client/inbox.ts'
import {
  fetchDebrief,
  type DebriefResult,
} from './client/bili-debrief.ts'
import {
  fetchFeed,
  searchVideos,
  checkLogin,
  loadCredentials as loadReadCredentials,
  parseCredentials,
  liveCredentials,
  describeCredentials,
  saveCredentials,
  type BiliReadContext,
} from './client/bili-read.ts'
import {
  watchVideo,
  alignVisual,
  type WatchContext,
  type WatchResult,
} from './client/bili-watch.ts'
import {
  fetchSubtitles,
  fetchComments,
  fetchThread,
  whois,
  dynamicRecent,
  fmtClock,
} from './client/bili-profile.ts'
import {
  executeBiliWrite,
  checkLikeNotRepeated,
  checkFavDailyCap,
  checkFavReason,
  checkDmReplyWindow,
  loadCredentials,
  type BiliWriteContext,
} from './client/bili-write.ts'

export {
  WriteGate,
  DEFAULT_PUBLISH_POLICY,
  buildWriteAction,
  sha1Hex,
  BiliInboxAndPrefsStore,
  DEFAULT_WATCH_PREFS,
  executeBiliWrite,
  checkLikeNotRepeated,
  checkFavDailyCap,
  checkFavReason,
  checkDmReplyWindow,
  loadCredentials,
}
export type {
  WriteKind,
  WriteIntent,
  BiliPublishPolicy,
  WriteActionInput,
  WriteAction,
  GateVerdict,
  PendingQueueItem,
  InboxKind,
  InboxItem,
  WatchPreferences,
  BiliWriteContext,
}

export interface BilibiliCapabilityConfig extends BiliPublishPolicy {
  selfDailyCap: number
  shareDailyCap: number
  writeGapSec: number
}

export interface BilibiliReadHandlers {
  feed?: (opts: { count?: number; prefs: WatchPreferences }) => Promise<unknown>
  debrief?: (bvid: string) => Promise<unknown>
  watch?: (bvid: string) => Promise<unknown>
  subtitles?: (bvid: string) => Promise<unknown>
  search?: (keyword: string) => Promise<unknown>
  comments?: (bvid: string) => Promise<unknown>
  thread?: (bvid: string, rootRpid: string) => Promise<unknown>
  whois?: (mid: string) => Promise<unknown>
  dynamicRecent?: (date?: string) => Promise<unknown>
}

export interface BilibiliCapabilityOptions {
  dataDir: string
  writeExecutor?: (action: WriteAction) => Promise<{ ok: boolean; dynId?: string; rpid?: string; error?: string; status?: number }>
  contentCheck?: (action: WriteAction) => { ok: true } | { ok: false; code?: 'policy' | 'precondition'; reason: string }
  readHandlers?: BilibiliReadHandlers
  /** 真实写链路的上下文（凭据 + 本地账读法）。给了就用真执行器与真判据。 */
  writeContext?: BiliWriteContext
  /** 真实读链路的上下文（凭据 + fetch 替身）。给了 feed/search 就走真端点。 */
  readContext?: BiliReadContext
  /** 凭据文件路径；配合 writeContext.cred 缺省时从这里读 */
  credentialsFile?: string
  /**
   * 读侧 fetch 替身（测试与离线验收用）。
   * 单独开这个口是为了**不换掉凭据来源**：以前只能整个 `readContext` 替掉，
   * 一替就把"活的凭据"也替成了快照，测试绿的、线上是坏的。
   */
  fetch?: (input: string, init?: Record<string, unknown>) => Promise<Response>
  /**
   * 看画面（V-Now 第⑥路）：目录与管道注入。
   * 缺省落在 dataDir 下自己的子目录（A2 踩过的坑：dataDir 是部署级共享的，必须再下一层）。
   */
  watch?: Partial<Pick<WatchContext, 'videoDir' | 'sheetDir' | 'analyze' | 'keepVideo'>>
}

/**
 * 「上一次绑的是谁」这一笔账（`<dataDir>/bili-connection.json`）。
 *
 * 只记身份与指纹，**不记凭据值**：换号这件事要能被追溯（"她今天怎么像变了个人"），
 * 但这份文件是明文放在部署目录里的，写 cookie 进去等于把凭据再复制一份。
 */
interface ConnectionRecord {
  mid: string
  uname: string
  boundAt: string
  fp: string
  verified: boolean
}

function connectionFile(dataDir: string): string {
  return path.join(dataDir, 'bili-connection.json')
}

function readConnectionRecord(dataDir: string): ConnectionRecord | null {
  try {
    const raw = JSON.parse(fs.readFileSync(connectionFile(dataDir), 'utf8'))
    return {
      mid: String(raw.mid ?? ''),
      uname: String(raw.uname ?? ''),
      boundAt: String(raw.boundAt ?? ''),
      fp: String(raw.fp ?? ''),
      verified: raw.verified === true,
    }
  } catch {
    return null
  }
}

function writeConnectionRecord(
  dataDir: string,
  rec: ConnectionRecord,
  warn?: (msg: string) => void,
): boolean {
  try {
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(connectionFile(dataDir), JSON.stringify(rec, null, 2), 'utf8')
    return true
  } catch (e) {
    // 记不上这一笔不影响绑定本身（凭据已经落盘），不许把成功的绑定报成失败——
    // 但**必须让调用方知道没记上**：这里曾经是一个空 catch，把一句 ReferenceError
    // 静默吞掉了整整一轮（写不进去还没人知道）。吞掉的写失败比失败的写更坏。
    warn?.(`连接记录写不进 ${connectionFile(dataDir)}：${String((e as Error)?.message ?? e)}`)
    return false
  }
}

export function createBilibiliCapability(
  opts: BilibiliCapabilityOptions,
): XiaoyuCapability<BilibiliCapabilityConfig> & {
  readonly gate: WriteGate
  readonly store: BiliInboxAndPrefsStore
} {
  let hostRef: CapabilityHost | null = null
  const store = new BiliInboxAndPrefsStore(opts.dataDir)

  // 真实写上下文：凭据 + 本地账读法（点赞/收藏账）。
  // 没显式给 writeContext 时用**活的**凭据视图：每次取都现读文件（env 优先），
  // 所以「连接」页换完 cookie 下一拍就是新的，不需要重启进程。
  const writeCtx: BiliWriteContext = opts.writeContext ?? {
    cred: opts.credentialsFile
      ? liveCredentials(opts.credentialsFile)
      : { sessdata: '', bili_jct: '', buvid3: '' },
  }
  // 真实读上下文：与写共用同一份**活的**凭据；fetch 可独立注入（替身不换成快照凭据）
  const readCtx: BiliReadContext = opts.readContext ?? {
    cred: writeCtx.cred,
    ...(opts.fetch ? { fetch: opts.fetch as never } : {}),
  } as BiliReadContext

  // 看画面上下文：目录在 dataDir 下再下一层，管道可注入替身
  const watchCtx: WatchContext = {
    ...readCtx,
    videoDir: opts.watch?.videoDir ?? path.join(opts.dataDir, 'shots', 'video'),
    sheetDir: opts.watch?.sheetDir ?? path.join(opts.dataDir, 'shots', 'sheets'),
    ...(opts.watch?.analyze ? { analyze: opts.watch.analyze } : {}),
    keepVideo: opts.watch?.keepVideo ?? true,
  }

  /** 默认内容判据：按 kind 走各自原有的判据（30 天去重 / 收藏两条 / 回信时效窗）。 */
  const defaultContentCheck = (
    action: WriteAction,
  ): { ok: true } | { ok: false; code?: 'policy' | 'precondition'; reason: string } => {
    switch (action.kind) {
      case 'like':
        return checkLikeNotRepeated(String(action.target.bvid ?? ''), writeCtx)
      case 'fav': {
        const cap = checkFavDailyCap(writeCtx)
        if (!cap.ok) return cap
        return checkFavReason(action.body)
      }
      case 'dm':
        return checkDmReplyWindow(writeCtx)
      default:
        return { ok: true }
    }
  }

  /** 默认执行器：真的发 B 站请求（点赞/收藏/评论/弹幕），其余 kind 走调用方注入。 */
  const defaultExecutor = async (
    action: WriteAction,
  ): Promise<{ ok: boolean; dynId?: string; rpid?: string; error?: string; status?: number }> => {
    if (action.kind !== 'like' && action.kind !== 'fav' && action.kind !== 'comment' && action.kind !== 'danmaku') {
      return { ok: false, error: `kind=${action.kind} 还没有真实执行器（需要注入 writeExecutor）` }
    }
    const out = await executeBiliWrite(action.kind, action, writeCtx)
    if (!out.ok) {
      return { ok: false, error: out.reason, status: out.httpStatus }
    }
    const rpid = out.meta?.rpid
    return { ok: true, rpid: rpid ? String(rpid) : undefined }
  }

  const gate = new WriteGate({
    dataDir: opts.dataDir,
    executor: opts.writeExecutor ?? defaultExecutor,
    contentCheck: opts.contentCheck ?? defaultContentCheck,
    onDraftRejected(item, reason, askRewrite) {
      if (hostRef) {
        hostRef.pushEvent({
          type: 'bili-account.draft_rejected',
          source: 'bili-account',
          text: askRewrite
            ? `主人驳回了你的 ${item.kind} 草稿（${item.id}），理由：「${reason}」。请照着这个理由重新写一版。`
            : `主人驳回了你的 ${item.kind} 草稿（${item.id}），理由：「${reason}」。`,
          atMs: Date.now(),
          meta: { draftId: item.id, kind: item.kind, reason, askRewrite },
        })
      }
    },
    onDraftRequested(req) {
      if (hostRef) {
        hostRef.pushEvent({
          type: 'bili-account.owner_order_draft',
          source: 'bili-account',
          text: `主人点单让你写一条 ${req.kind === 'dynamic' ? 'B站动态' : '评论'}${req.bvid ? `（针对 ${req.bvid}）` : ''}：「${req.prompt}」`,
          atMs: req.atMs,
          meta: req,
        })
      }
    },
  })

  return {
    id: 'bilibili',
    title: 'B 站整域能力',
    kind: 'world',
    gate,
    store,
    configSchema: {
      type: 'object',
      title: 'B 站发送策略与安全闸配置',
      description: '8 个发送档位与每日配额、冷却秒数（全部热生效）',
      properties: {
        draftMode: { type: 'string', title: '动态草稿发布档位', enum: ['review', 'auto'], default: 'review', 'x-hot': true },
        autoDailyCap: { type: 'integer', title: '自动发布每日上限（0=不限）', default: 0, minimum: 0, 'x-hot': true },
        autoWindow: { type: 'string', title: '自动发布允许时段', default: '00:00-24:00', 'x-hot': true },
        like: { type: 'string', title: '点赞档位', enum: ['self', 'review'], default: 'self', 'x-hot': true },
        fav: { type: 'string', title: '收藏档位', enum: ['self', 'review'], default: 'self', 'x-hot': true },
        dmReply: { type: 'string', title: '私信回信档位', enum: ['direct', 'queue'], default: 'direct', 'x-hot': true },
        comment: { type: 'string', title: '评论档位', enum: ['review', 'self'], default: 'review', 'x-hot': true },
        danmaku: { type: 'string', title: '弹幕档位', enum: ['review', 'self'], default: 'review', 'x-hot': true },
        selfDailyCap: { type: 'integer', title: '每日自主互动上限', default: 12, minimum: 0, 'x-hot': true },
        shareDailyCap: { type: 'integer', title: '每日分享@主人上限', default: 3, minimum: 0, 'x-hot': true },
        writeGapSec: { type: 'integer', title: '写操作最小冷却间隔（秒）', default: 10, minimum: 0, 'x-hot': true },
      },
    },
    defaultConfig: {
      ...DEFAULT_PUBLISH_POLICY,
      selfDailyCap: 12,
      shareDailyCap: 3,
      writeGapSec: 10,
    },

    start(host: CapabilityHost) {
      hostRef = host
    },

    stop() {
      hostRef = null
    },

    async contextSegments(_ctx: TurnContext): Promise<readonly PrefixBlock[]> {
      const unread = store.listInbox({ unreadOnly: true })
      const pending = gate.listQueue('pending')
      const policy = gate.readPolicy()
      const killOn = gate.isKillOn()
      const summary = [
        `【B 站当前状态】急刹=${killOn ? '开启(已停止一切对外写)' : '关闭'} · 动态=${policy.draftMode} · 评论=${policy.comment} · 弹幕=${policy.danmaku} · 私信=${policy.dmReply} · 点赞=${policy.like} · 收藏=${policy.fav}`,
        `【收件箱未读】共 ${unread.length} 条（私信 ${unread.filter((x) => x.kind === 'dm').length} / 回复 ${unread.filter((x) => x.kind === 'reply').length} / @我 ${unread.filter((x) => x.kind === 'mention').length} / 收到的赞 ${unread.filter((x) => x.kind === 'like').length}）`,
        `【待主人放行队列】共 ${pending.length} 条`,
      ].join('\n')
      return [
        {
          title: 'B 站环境与收件箱摘要',
          text: summary,
          sourceKey: 'world.bilibili',
        },
      ]
    },

    tools() {
      return [
        // ── 四路收件箱感知工具 ──
        {
          name: 'bili_inbox_read',
          summary: '读取 B 站四路收件箱（私信 / 回复我的 / @我的 / 收到的赞）',
          description: '不再只看私信！一次性或按分类查看私信(dm)、评论回复(reply)、@提及(mention)和收到的赞(like)。',
          parameters: {
            type: 'object',
            properties: {
              kind: { type: 'string', enum: ['all', 'dm', 'reply', 'mention', 'like'], description: '收件箱类别（默认 all）' },
              unreadOnly: { type: 'boolean', description: '是否只看未读（默认 true）' },
            },
          },
          execute(args: { kind?: InboxKind | 'all'; unreadOnly?: boolean }) {
            const items = store.listInbox({
              kind: args?.kind ?? 'all',
              unreadOnly: args?.unreadOnly !== false,
            })
            return { ok: true, count: items.length, items }
          },
        },
        {
          name: 'bili_inbox_ack',
          summary: '将收件箱条目推进为已读',
          description: '处理完私信、回复或 @ 后，传入 keys 标记为已读。',
          parameters: {
            type: 'object',
            properties: {
              keys: { type: 'array', items: { type: 'string' }, description: '收件箱条目 key 数组' },
            },
            required: ['keys'],
          },
          mutatesState: true,
          execute(args: { keys: string[] }) {
            return { ok: true, ...store.ackItems(args?.keys ?? []) }
          },
        },
        // ── 浏览与看片感知工具 ──
        {
          name: 'bili_feed',
          summary: '刷 B 站首页推荐流（自动套用看片偏好与时长标注）',
          description: '按统一看片偏好（like/dislike/keywords/minDurationSec）获取推荐视频候选。',
          parameters: {
            type: 'object',
            properties: {
              count: { type: 'integer', description: '获取条数（默认 10）' },
            },
          },
          async execute(args: { count?: number }) {
            const prefs = store.readPrefs()
            if (opts.readHandlers?.feed) {
              return await opts.readHandlers.feed({ count: args?.count, prefs })
            }
            const r = await fetchFeed(readCtx, { count: args?.count })
            if (!r.ok) return { ok: false, error: r.error, prefs }
            // 套用看片偏好标注（与旧 annotateFeed 同口径：时长阈值 / 屏蔽词高亮）
            const min = prefs.minDurationSec
            for (const it of r.items) {
              const marks: string[] = []
              if (min > 0 && it.durationSec > 0 && it.durationSec < min) marks.push(`短于${Math.round(min / 60)}分钟：跳过`)
              if (prefs.dislike.some((w) => it.title.includes(w))) marks.push('命中屏蔽词')
              if (marks.length) it.title = `${it.title}  [${marks.join('；')}]`
            }
            return { ok: true, source: r.source, prefs, items: r.items }
          },
        },
        {
          name: 'bili_debrief',
          summary: '深读一条 B 站视频（标题/简介/弹幕采样/热评）',
          description: '传入 BV 号获取视频详情、高赞评论与弹幕氛围。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '视频 BV 号' },
            },
            required: ['bvid'],
          },
          async execute(args: { bvid: string; bucketSec?: number; top?: number; comments?: number; withFrames?: boolean }) {
            if (opts.readHandlers?.debrief) return await opts.readHandlers.debrief(args.bvid)
            const r: DebriefResult = await fetchDebrief(readCtx, args.bvid, {
              bucketSec: args?.bucketSec, top: args?.top, comments: args?.comments,
            })
            if (!r.ok) return { ok: false, error: r.error }
            // 压缩输出：字幕行只带前 40 行内联（全量走 judgment/diary 引用），弹幕热区带对齐字幕
            const inlineSubs = r.subtitles.lines.slice(0, 40).map((l) => `[${Math.floor(l.from / 60)}:${String(Math.floor(l.from % 60)).padStart(2, '0')}] ${l.text}`)
            const out: Record<string, unknown> = {
              ok: true,
              meta: r.meta,
              subtitles: { hasTrack: r.subtitles.hasTrack, count: r.subtitles.count, inline: inlineSubs, truncated: r.subtitles.count > inlineSubs.length },
              danmaku: r.danmaku,
              comments: r.comments,
            }
            // ⑥ 画面这一路默认关：它要下整条片子再跑一趟管道（44 分钟实测 59 秒 + 数百 MB），
            // 主动刷 feed 时不该每次都付这个钱；明确要"看画面"时再开。
            if (args.withFrames) {
              const w = await watchVideo(watchCtx, args.bvid)
              out.visual = w.ok
                ? { quality: w.quality, mp4: w.videoFile, sheets: w.steps, stats: w.visual?.stats ?? null, degraded: w.degraded ?? null }
                : { error: w.error }
              // 弹幕热区 → 落在第几张图的哪段时间窗
              out.hotToSheet = alignVisual(
                r.danmaku.tops.map((t) => ({ fromSec: t.fromSec, toSec: t.toSec, realCount: t.realCount })),
                w.steps,
              )
            } else {
              out.visual = { skipped: '画面这路没开（要下整条片子）。想看画面用 bili_watch，或在 bili_debrief 传 withFrames:true' }
            }
            return out
          },
        },
        {
          name: 'bili_watch',
          summary: '看一条 B 站视频的画面：下载 + 变化分留帧 + 拼成几张图',
          description: [
            '只留「画面真的变了」的那几帧，按片长摊开节奏，拼成几张 800x450 的图（每张约 216 token）。',
            '返回每张图覆盖的时间窗与落盘路径；拿到路径后用 read_image 看。',
            '判据是逐帧 HSV 变化分（切点/积分/兜底三路），不是等间隔抽样。',
            '成本提示：要下整条片子再跑一趟 ffmpeg（44 分钟实测约 59 秒、数百 MB），别在刷 feed 时批量调用。',
          ].join(' '),
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '视频 BV 号' },
              targetFrames: { type: 'number', description: '想留多少帧（默认按管道配置 48；越大越细越贵）' },
              startSec: { type: 'number', description: '从第几秒开始看' },
              endSec: { type: 'number', description: '看到第几秒' },
              keepVideo: { type: 'boolean', description: '看完是否留着 mp4（默认留）' },
            },
            required: ['bvid'],
          },
          async execute(args: { bvid: string; targetFrames?: number; startSec?: number; endSec?: number; keepVideo?: boolean }) {
            if (opts.readHandlers?.watch) return await opts.readHandlers.watch(args.bvid)
            const w: WatchResult = await watchVideo(
              args.keepVideo === undefined ? watchCtx : { ...watchCtx, keepVideo: args.keepVideo },
              args.bvid,
              { targetFrames: args?.targetFrames, startSec: args?.startSec, endSec: args?.endSec },
            )
            if (!w.ok) return { ok: false, error: w.error }
            return {
              ok: true,
              bvid: w.bvid, title: w.title, durationSec: w.durationSec, quality: w.quality,
              mp4: w.videoFile, mp4MB: +(w.videoBytes / 1024 / 1024).toFixed(1),
              sheets: w.steps,
              stats: w.visual?.stats ?? null,
              tuning: w.visual?.tuning ?? null,
              ...(w.degraded ? { degraded: w.degraded } : {}),
              hint: '每张图左上角有帧号，和 sheets[].fromSec/toSec 对齐；用 read_image 逐张看',
            }
          },
        },
        {
          name: 'bili_subtitles',
          summary: '读取视频 CC 字幕或 AI 字幕全文',
          description: '传入 BV 号提取视频字幕文本。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '视频 BV 号' },
            },
            required: ['bvid'],
          },
          async execute(args: { bvid: string; lan?: string; plain?: boolean }) {
            if (opts.readHandlers?.subtitles) return await opts.readHandlers.subtitles(args.bvid)
            const r = await fetchSubtitles(readCtx, args.bvid, { lan: args?.lan })
            if (!r.ok) return { ok: false, bvid: args.bvid, error: r.error, tracks: r.tracks }
            // 全文可能很长：默认给带时间戳的前 60 行 + 行数与覆盖区间，全文走 plain 开关
            const head = r.lines.slice(0, 60).map((l) => `[${fmtClock(l.from)}] ${l.text}`)
            return {
              ok: true,
              bvid: args.bvid, title: r.title, durationSec: r.durationSec,
              lan: r.lan, lanDoc: r.lanDoc, source: r.source, aiStatus: r.aiStatus,
              count: r.lines.length, covered: `${fmtClock(r.lines[0]?.from ?? 0)} → ${fmtClock(r.lines.at(-1)?.to ?? 0)}`,
              head, truncated: r.lines.length > head.length,
              ...(args?.plain ? { plain: r.plain } : {}),
              note: '字幕是最省的一条腿：先拿文字，再决定要不要抽帧看画面',
            }
          },
        },
        {
          name: 'bili_search',
          summary: '在 B 站按关键词搜索视频',
          description: '主动搜索感兴趣的话题或关键词。',
          parameters: {
            type: 'object',
            properties: {
              keyword: { type: 'string', description: '搜索关键词' },
            },
            required: ['keyword'],
          },
          async execute(args: { keyword: string }) {
            if (opts.readHandlers?.search) return await opts.readHandlers.search(args.keyword)
            const r = await searchVideos(readCtx, args.keyword)
            return { ...r, keyword: args.keyword }
          },
        },
        {
          name: 'bili_comments',
          summary: '读取视频或动态的评论区列表与楼中楼',
          description: '查看指定 BV 号下的评论区，支持传入 rootRpid 查看楼中楼。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '视频 BV 号' },
              rootRpid: { type: 'string', description: '可选：楼层根评论 rpid' },
            },
            required: ['bvid'],
          },
          async execute(args: { bvid: string; rootRpid?: string; ps?: number; sort?: 'hot' | 'time' }) {
            if (args.rootRpid && opts.readHandlers?.thread) {
              return await opts.readHandlers.thread(args.bvid, args.rootRpid)
            }
            if (opts.readHandlers?.comments) return await opts.readHandlers.comments(args.bvid)
            if (args.rootRpid) return await fetchThread(readCtx, args.bvid, args.rootRpid)
            return await fetchComments(readCtx, args.bvid, { ps: args?.ps, sort: args?.sort })
          },
        },
        {
          name: 'bili_whois',
          summary: '查询 B 站用户/UP 主基本信息与近期代表作',
          description: '传入用户 mid 查看对方简介与近期投稿。',
          parameters: {
            type: 'object',
            properties: {
              mid: { type: 'string', description: 'B 站用户 mid' },
            },
            required: ['mid'],
          },
          async execute(args: { mid: string }) {
            if (opts.readHandlers?.whois) return await opts.readHandlers.whois(args.mid)
            return await whois(readCtx, args.mid)
          },
        },
        {
          name: 'bili_dynamic_recent',
          summary: '查看自己账号最近已发布的动态列表',
          description: '核对某天或近期已经发出去的动态，防止重复发稿。',
          parameters: {
            type: 'object',
            properties: {
              date: { type: 'string', description: '可选日期 YYYY-MM-DD' },
              limit: { type: 'number', description: '最多几条（默认 10，上限 50）' },
            },
          },
          async execute(args: { date?: string; limit?: number }) {
            if (opts.readHandlers?.dynamicRecent) return await opts.readHandlers.dynamicRecent(args?.date)
            return await dynamicRecent(readCtx, { date: args?.date, limit: args?.limit })
          },
        },
        // ── 七大对外写工具（全部强制走 WriteGate.execute 单点把关链） ──
        {
          name: 'bili_dynamic_draft',
          summary: '发起一条 B 站图文或纯文字动态（经 WriteGate 把关）',
          description: '提交动态正文与可选配图；review 档位下进入统一待放行队列，auto 档位下过安全闸直发。',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '动态正文（自动执行 plainOutbound 去粗体与未闭合书名号清洗）' },
              imagePath: { type: 'string', description: '可选配图路径' },
              intent: { type: 'string', enum: ['self', 'share'], description: 'self 自主感想 或 share 分享@主人' },
            },
            required: ['text'],
          },
          mutatesState: true,
          async execute(args: { text: string; imagePath?: string; intent?: 'self' | 'share' }) {
            return await gate.execute({
              kind: 'dynamic',
              intent: args.intent ?? 'self',
              target: {},
              body: args.text,
              imagePath: args.imagePath,
              actor: 'host',
            })
          },
        },
        {
          name: 'bili_dynamic_edit',
          summary: '修改一条已发布的动态或待审动态草稿',
          description: '传入 dynId 或待审 draftId 修改正文。',
          parameters: {
            type: 'object',
            properties: {
              dynId: { type: 'string', description: '动态 ID 或草稿 ID' },
              text: { type: 'string', description: '修改后的新正文' },
            },
            required: ['dynId', 'text'],
          },
          mutatesState: true,
          async execute(args: { dynId: string; text: string }) {
            return await gate.execute({
              kind: 'edit-dynamic',
              intent: 'self',
              target: { dynId: args.dynId },
              body: args.text,
              actor: 'host',
            })
          },
        },
        {
          name: 'bili_comment',
          summary: '在视频下发表评论或回复别人的评论（默认进待放行队列，可由策略页切换）',
          description: '补齐她原本缺失的评论发起入口，受 WriteGate 的 permissions.comment 档位与配额管控。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '目标视频 BV 号' },
              rpid: { type: 'string', description: '可选：要回复的评论 rpid' },
              text: { type: 'string', description: '评论正文' },
              intent: { type: 'string', enum: ['self', 'reply', 'share'] },
            },
            required: ['bvid', 'text'],
          },
          mutatesState: true,
          async execute(args: { bvid: string; rpid?: string; text: string; intent?: WriteIntent }) {
            return await gate.execute({
              kind: 'comment',
              intent: args.intent ?? (args.rpid ? 'reply' : 'self'),
              target: { bvid: args.bvid, oid: args.rpid },
              body: args.text,
              actor: 'host',
            })
          },
        },
        {
          name: 'bili_danmaku',
          summary: '向视频发送一条弹幕（默认进待放行队列，可由策略页切换）',
          description: '补齐她原本缺失的弹幕发起入口，受 WriteGate 的 permissions.danmaku 档位与配额管控。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '目标视频 BV 号' },
              text: { type: 'string', description: '弹幕内容' },
            },
            required: ['bvid', 'text'],
          },
          mutatesState: true,
          async execute(args: { bvid: string; text: string }) {
            return await gate.execute({
              kind: 'danmaku',
              intent: 'self',
              target: { bvid: args.bvid },
              body: args.text,
              actor: 'host',
            })
          },
        },
        {
          name: 'bili_dm_reply',
          summary: '回复 B 站私信（受 dmReply 档位与 7 天回信窗口管控）',
          description: '向指定用户 mid 发送私信回复。',
          parameters: {
            type: 'object',
            properties: {
              mid: { type: 'string', description: '收信人 mid' },
              text: { type: 'string', description: '私信内容' },
            },
            required: ['mid', 'text'],
          },
          mutatesState: true,
          async execute(args: { mid: string; text: string }) {
            return await gate.execute({
              kind: 'dm',
              intent: 'reply',
              target: { mid: args.mid },
              body: args.text,
              actor: 'host',
            })
          },
        },
        {
          name: 'bili_like',
          summary: '为视频点赞（过 WriteGate 额度与 30 天去重）',
          description: '对真正喜欢的视频点赞。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '视频 BV 号' },
              reason: { type: 'string', description: '点赞原因' },
            },
            required: ['bvid'],
          },
          mutatesState: true,
          async execute(args: { bvid: string; reason?: string }) {
            return await gate.execute({
              kind: 'like',
              intent: 'self',
              target: { bvid: args.bvid },
              body: args.reason || `like:${args.bvid}`,
              actor: 'host',
            })
          },
        },
        {
          name: 'bili_fav',
          summary: '收藏视频（过 WriteGate 额度与五判据）',
          description: '将值得反复回看的视频加入收藏夹（必须附上 ≥6 字理由）。',
          parameters: {
            type: 'object',
            properties: {
              bvid: { type: 'string', description: '视频 BV 号' },
              reason: { type: 'string', description: '收藏理由（至少 6 个字）' },
            },
            required: ['bvid', 'reason'],
          },
          mutatesState: true,
          async execute(args: { bvid: string; reason: string }) {
            return await gate.execute({
              kind: 'fav',
              intent: 'self',
              target: { bvid: args.bvid },
              body: args.reason,
              actor: 'host',
            })
          },
        },
      ]
    },

    panels() {
      return [
        // ── 面板 1：B 站四路收件箱与指派台 ──
        {
          id: 'inbox',
          title: 'B 站四路收件箱与指派台',
          description: '实时查看私信、评论回复、@提及、收到的赞，并指派她回复、忽略或拉黑用户',
          methods: {
            list: {
              name: 'list',
              verb: 'GET',
              summary: '按类别（all/dm/reply/mention/like）与未读状态列出收件箱条目',
              writable: false,
              invoke(params: { kind?: InboxKind | 'all'; unreadOnly?: boolean }) {
                const items = store.listInbox({
                  kind: params?.kind ?? 'all',
                  unreadOnly: Boolean(params?.unreadOnly),
                })
                const all = store.listInbox({ kind: 'all', unreadOnly: false })
                return {
                  ok: true,
                  unreadCount: all.filter((x) => !x.read).length,
                  blockedUids: store.readBlockedUids(),
                  items,
                }
              },
            },
            assignAction: {
              name: 'assignAction',
              verb: 'POST',
              summary: '主人指派她回复某条消息（可附叮嘱）、直接标已读忽略、或拉黑该用户',
              writable: true,
              invoke(params: {
                itemKey: string
                action: 'ask_her_reply' | 'ignore' | 'block_user'
                ownerHint?: string
                confirm?: boolean
              }) {
                // 拉黑当场生效在平台侧，改的是她真实的人际账；放回来虽然可逆，对方的观感不可逆。
                // 跟 unblockUser 同一条规矩（抛错而不是返回 ok:false，两个方向走同一种失败）：
                // 动屏蔽名单必须显式确认，验收脚本也照这条走。
                if (params?.action === 'block_user' && params?.confirm !== true) {
                  throw new Error('要 confirm:true 才动手（这是改她的屏蔽名单）')
                }
                return store.assignAction(params, (item, hint) => {
                  if (hostRef) {
                    hostRef.pushEvent({
                      type: 'bili-account.inbox_assigned',
                      source: 'bili-account',
                      text: `主人指派你回复这条 ${item.kind}（来自 @${item.who}：「${item.text}」）${hint ? `，主人叮嘱：「${hint}」` : ''}`,
                      atMs: Date.now(),
                      meta: { item, ownerHint: hint },
                    })
                  }
                })
              },
            },
            unblockUser: {
              name: 'unblockUser',
              verb: 'POST',
              summary: '把某个用户从屏蔽名单里放回来（拉黑是可逆的，不是一锤定音）',
              writable: true,
              invoke(params: { uid?: string; uids?: string[]; confirm?: boolean }) {
                const targets = [
                  ...(params?.uid ? [String(params.uid)] : []),
                  ...(Array.isArray(params?.uids) ? params!.uids.map(String) : []),
                ]
                if (!targets.length) throw new Error('要带 uid 或 uids')
                // 屏蔽名单是她真实的人际账，动它要显式确认；验收脚本也照这条走，不许悄悄清
                if (params?.confirm !== true) throw new Error('要 confirm:true 才动手（这是改她的屏蔽名单）')
                const cur = store.readBlockedUids()
                const next = cur.filter((u) => !targets.includes(String(u)))
                store.saveBlockedUids(next)
                return { ok: true, removed: cur.length - next.length, remaining: next.length }
              },
            },
          },
        },
        {
          id: 'drafts-queue',
          title: '统一待放行与改稿工作台',
          description: '动态草稿、私信草稿、待审评论、待审弹幕四合一队列；支持在线改字（自动重算哈希续签令牌）、放行、打回重写、主人点单写稿',
          methods: {
            list: {
              name: 'list',
              verb: 'GET',
              summary: '列出全部待放行草稿与互动项',
              writable: false,
              invoke(params: { status?: 'pending' | 'all' }) {
                const items = gate.listQueue(params?.status ?? 'pending')
                return { ok: true, count: items.length, items }
              },
            },
            updateDraft: {
              name: 'updateDraft',
              verb: 'POST',
              summary: '在线修改待审项正文或配图，并自动重算 bodyHash 续签令牌',
              writable: true,
              invoke(params: { id: string; text: string; imagePath?: string }) {
                return gate.updateDraft(params)
              },
            },
            release: {
              name: 'release',
              verb: 'POST',
              summary: '放行指定待审项并经 WriteGate 立即发布',
              writable: true,
              async invoke(params: { id: string }) {
                return await gate.release(params?.id)
              },
            },
            reject: {
              name: 'reject',
              verb: 'POST',
              summary: '拒掉指定待审项（可选勾选 askRewrite 让她按拒稿理由重写）',
              writable: true,
              invoke(params: { id: string; reason: string; askRewrite?: boolean }) {
                return gate.reject(params?.id, params?.reason, Boolean(params?.askRewrite))
              },
            },
            requestNew: {
              name: 'requestNew',
              verb: 'POST',
              summary: '主人主动点单：指定 BV 号或话题让她写一条动态或评论草稿',
              writable: true,
              invoke(params: { kind: 'dynamic' | 'comment'; bvid?: string; prompt: string }) {
                if (!params?.prompt || !String(params.prompt).trim()) {
                  return { ok: false, error: 'prompt 不能为空' }
                }
                return gate.requestNewDraft({
                  kind: params.kind === 'comment' ? 'comment' : 'dynamic',
                  bvid: params.bvid?.trim(),
                  prompt: String(params.prompt).trim(),
                })
              },
            },
          },
        },
        // ── 面板 3：看片偏好与过滤规则台 ──
        {
          id: 'preferences',
          title: '看片偏好与过滤规则台',
          description: '可视化增删喜欢话题、讨厌词、关键词、关注 UP 主豁免名单与短视频跳过阈值',
          methods: {
            get: {
              name: 'get',
              verb: 'GET',
              summary: '读取当前看片偏好与过滤规则',
              writable: false,
              invoke() {
                return { ok: true, prefs: store.readPrefs() }
              },
            },
            set: {
              name: 'set',
              verb: 'POST',
              summary: '修改看片偏好与过滤规则并立即生效',
              writable: true,
              invoke(params: Partial<WatchPreferences>) {
                return { ok: true, prefs: store.savePrefs(params ?? {}) }
              },
            },
          },
        },
        // ── 面板 4：安全闸、配额与风控总控台 ──
        {
          id: 'gate-policy',
          title: '安全闸、配额与风控总控台',
          description: '一键急刹 Kill 开关、8 个发送策略档位、每日自主/分享配额、写冷却秒数、412 风控熔断解除',
          methods: {
            get: {
              name: 'get',
              verb: 'GET',
              summary: '读取 8 个发送档位、今日配额用量、风控冷却状态与 Kill 急刹状态',
              writable: false,
              invoke() {
                return {
                  ok: true,
                  killOn: gate.isKillOn(),
                  policy: gate.readPolicy(),
                  quota: gate.readQuota(),
                  traffic: gate.readTraffic(),
                }
              },
            },
            set: {
              name: 'set',
              verb: 'POST',
              summary: '修改发送策略档位、配额上限、写冷却秒数、切换 Kill 急刹或解除 412 风控暂停',
              writable: true,
              invoke(params: {
                killOn?: boolean
                clearTrafficPause?: boolean
                policy?: Partial<BiliPublishPolicy>
                quota?: { selfCap?: number; shareCap?: number }
                writeGapSec?: number
                confirm?: boolean
              }) {
                // 412 熔断是平台给她上的保护闸，手动松开等于在她可能仍被风控时立刻恢复对外写。
                // 面板那道确认层之外再兜一层（与 unblockUser / block_user 同一种失败口径）：
                // 脚本也不许一把梭把风控当 bug 关掉。
                if (params?.clearTrafficPause && params?.confirm !== true) {
                  throw new Error('解除 412 风控熔断要 confirm:true（这是把她从平台保护里放出来）')
                }
                if (typeof params?.killOn === 'boolean') {
                  gate.setKill(params.killOn)
                }
                if (params?.clearTrafficPause) {
                  gate.clearTrafficPause()
                }
                if (params?.policy) {
                  gate.savePolicy(params.policy)
                }
                if (params?.quota) {
                  gate.saveQuotaConfig(params.quota)
                }
                if (params?.writeGapSec !== undefined) {
                  gate.saveTraffic({ writeGapSec: Math.max(0, Number(params.writeGapSec)) })
                }
                return {
                  ok: true,
                  killOn: gate.isKillOn(),
                  policy: gate.readPolicy(),
                  quota: gate.readQuota(),
                  traffic: gate.readTraffic(),
                }
              },
            },
          },
        },
        // ── 面板 5：连接与凭据（story-4 的「连接页」；旧 /api/cookie 的能力复位到这里） ──
        {
          id: 'connection',
          title: '连接与凭据',
          description:
            '看她登录到哪个号上：粘贴 cookie 先向 B 站校验身份、通过了才落盘；解绑也是显式动作。凭据值不回显、不进日志',
          methods: {
            get: {
              name: 'get',
              verb: 'GET',
              summary: '登录态体检：凭据齐不齐（只给指纹）、当前登录到哪个号、上次绑定是谁',
              writable: false,
              async invoke() {
                const file = opts.credentialsFile ?? ''
                const creds = file ? loadReadCredentials(file) : { sessdata: '', bili_jct: '', buvid3: '' }
                const bound = readConnectionRecord(opts.dataDir)
                let whoami: { ok: boolean; isLogin: boolean; mid?: string | number; uname?: string; error?: string }
                try {
                  whoami = await checkLogin(readCtx)
                } catch (e) {
                  whoami = { ok: false, isLogin: false, error: String((e as Error)?.message ?? e) }
                }
                return {
                  ok: true,
                  // 只给文件名：绝对路径里带着主人的用户名，没必要显示在页面上
                  credentialsFile: file ? path.basename(file) : '',
                  present: describeCredentials(creds),
                  live: whoami,
                  // 探不动时不空着：上一次是谁、什么时候绑的，主人看得见
                  lastKnown: bound,
                  stale: !whoami.ok || !whoami.isLogin,
                }
              },
            },
            bindCookie: {
              name: 'bindCookie',
              verb: 'POST',
              summary: '粘贴 cookie：先向 B 站校验身份，通过了才写进凭据文件（要 confirm:true）',
              writable: true,
              async invoke(params: {
                cookie?: string
                sessdata?: string
                bili_jct?: string
                buvid3?: string
                confirm?: boolean
                allowUnverified?: boolean
              }) {
                if (params?.confirm !== true) {
                  return { ok: false, error: '要 confirm:true 才动手（这是换她的登录身份）' }
                }
                const file = opts.credentialsFile ?? ''
                if (!file) return { ok: false, error: '没配 credentialsFile，不知道往哪儿写' }
                const pasted = typeof params?.cookie === 'string'
                  ? params.cookie
                  : [
                      params?.sessdata ? `SESSDATA=${params.sessdata}` : '',
                      params?.bili_jct ? `bili_jct=${params.bili_jct}` : '',
                      params?.buvid3 ? `buvid3=${params.buvid3}` : '',
                    ].filter(Boolean).join('; ')
                const merged = parseCredentials(pasted)
                if (!merged.sessdata) {
                  return { ok: false, error: '没解析出 SESSDATA：粘贴的内容里找不到这个键（浏览器里复制整段 Cookie 头即可）' }
                }
                /**
                 * **先验后写**：拿新凭据问一次 nav。验不过就一个字节都不落。
                 * 写了坏凭据的下场是——她下次以匿名身份撞墙，而页面看起来像"被风控了"，
                 * 不像"凭据错了"（这一串误诊本仓 2026-11-05 刚踩过一次）。
                 * 网络不通也走这一条；主人确认要照存就明写 allowUnverified。
                 */
                let whoami: { ok: boolean; isLogin: boolean; mid?: string | number; uname?: string; error?: string } | null = null
                let verifyError = ''
                try {
                  whoami = await checkLogin({ ...readCtx, cred: merged })
                } catch (e) {
                  verifyError = String((e as Error)?.message ?? e)
                }
                const verified = Boolean(whoami?.ok && whoami?.isLogin)
                if (!verified && params?.allowUnverified !== true) {
                  return {
                    ok: false,
                    error: `校验没通过（${whoami?.error || verifyError || 'B 站说没登录'}），什么都没写。`
                      + '确认要照存就再勾「没验通也保存」。',
                  }
                }
                const wrote = saveCredentials(file, merged)
                if (!wrote.ok) return { ok: false, error: wrote.error }
                const mid = whoami?.mid != null ? String(whoami.mid) : ''
                const prev = readConnectionRecord(opts.dataDir)
                const changed = Boolean(prev?.mid && mid && prev.mid !== mid)
                const recorded = writeConnectionRecord(opts.dataDir, {
                  mid,
                  uname: whoami?.uname ?? '',
                  boundAt: new Date().toISOString(),
                  fp: describeCredentials(merged).sessdata.fp,
                  verified,
                }, (m) => hostRef?.log('warn', m))
                return {
                  ok: true,
                  identity: { mid, uname: whoami?.uname ?? '' },
                  wrote: wrote.written,
                  removed: wrote.removed,
                  verified,
                  recorded,
                  // 换号是"她突然不像她自己了"最常见的原因，页面上要主动提一句
                  changedAccount: changed,
                  previous: prev ? { mid: prev.mid, uname: prev.uname, boundAt: prev.boundAt } : null,
                }
              },
            },
            unbindCookie: {
              name: 'unbindCookie',
              verb: 'POST',
              summary: '解绑：从凭据文件里去掉这三项（其他键不动），要 confirm:true',
              writable: true,
              invoke(params: { confirm?: boolean }) {
                if (params?.confirm !== true) {
                  return { ok: false, error: '要 confirm:true 才动手（解绑后她将退回匿名身份）' }
                }
                const file = opts.credentialsFile ?? ''
                if (!file) return { ok: false, error: '没配 credentialsFile，不知道往哪儿写' }
                const r = saveCredentials(file, { sessdata: '', bili_jct: '', buvid3: '' })
                if (!r.ok) return { ok: false, error: r.error }
                return {
                  ok: true,
                  removed: ['BILI_SESSDATA', 'BILI_JCT', 'BILI_BUVID3'],
                  note: '文件里其他键没动；她自己发东西会退回未登录并被写闸挡下。',
                }
              },
            },
          },
        },
      ]
    },
  }
}

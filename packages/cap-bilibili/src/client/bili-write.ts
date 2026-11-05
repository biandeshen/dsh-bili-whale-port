/**
 * 四条写链路的 Typed API（like / fav / comment / danmaku）。
 *
 * 与 tools/commands/*.mjs 的关系：请求形状、csrf 字段、referer、body 编码、HINT 文案
 * 全部**逐字照抄**原命令（那是线上跑过、验过的形状）；差别只有两处——
 *   ① 不读 argv、不 process.exit：一律返回结构化结果，由调用方（WriteGate）裁决；
 *   ② 正文在构造时过一次 plainOutbound 清洗。
 * 判据（30 天去重、收藏五判据、分享必须 @主人）也从原命令搬过来，放在本文件里，
 * 由 WriteGate.contentCheck 统一调用。
 */
import fs from 'node:fs'
import path from 'node:path'
// 与读侧同一个凭据解析（两边都只在函数体里用对方，模块顶层不互相取值，循环引用是安全的）。
import { loadCredentials as parseShared } from './bili-read.ts'
import { plainOutbound } from '../platform/plain-outbound.mjs'
import { guardedFetch as defaultFetch } from '../platform/traffic.mjs'
// 动态与私信的执行体（协议形状不一样，另开一个文件）。
// 循环引用是安全的：两边都只在**函数体里**用对方，模块顶层不互相取值。
import { executeDynamic, executeEditDynamic, executeDmReply } from './bili-write-extra.ts'

export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

export interface BiliCredentials {
  sessdata: string
  bili_jct: string
  buvid3: string
}

export interface BiliWriteContext {
  /** 发请求用；缺省走 traffic 闸的 guardedFetch（带冷却/412 熔断/防重发）。测试可注入替身。 */
  fetch?: typeof defaultFetch
  cred: BiliCredentials
  /** 30 天点赞去重账（读） */
  readLikeLog?: () => { items?: LikeLogEntry[] }
  /** 收藏本地账（读） */
  readFavLog?: () => { items?: FavLogEntry[] }
  /** 回信时效：最后一次成功读私信的时间戳（毫秒） */
  lastDmReadAt?: number
}

/** 取实际使用的 fetch：注入的优先，否则 traffic 闸的 guardedFetch。 */
export function fetcher(ctx: BiliWriteContext): typeof defaultFetch {
  return ctx.fetch ?? defaultFetch
}

export interface LikeLogEntry {
  bv: string
  aid?: number
  title?: string
  up?: string
  at: string
  reason?: string
}

export interface FavLogEntry {
  bv: string
  aid?: number
  title?: string
  up?: string
  at: string
  reason?: string
  kind?: string
  favId?: number
}

export interface WriteOutcome {
  ok: boolean
  /** 平台返回码（0 = 成功） */
  code?: number
  /** 给人看的失败原因（已翻成中文） */
  reason?: string
  /** 平台返回原文 */
  raw?: unknown
  httpStatus?: number
  /** 成功时的附带数据（标题、UP、链接等） */
  meta?: Record<string, unknown>
}

const CODE_HINTS: Record<string, string> = {
  '-101': '账号未登录：SESSDATA 失效，重新复制一次 cookie',
  '-111': 'CSRF 校验失败：bili_jct 和当前 SESSDATA 不是同一账号，或已过期 → 两个都重新复制一次',
  '-352': '风控拦截：等几分钟再来',
  // 11-01 实测撞过两次 -400，根因未确认——不写成结论，只提示别连着重试
  '-400': '请求错误（参数形状或冷却/风控的另一种表现，未确认）—— 别拿同一个写法连续重试',
  '10031': '操作太快：退避一会儿',
  '12015': '需要验证码：停下，去浏览器手动过一次',
}

export function explainCode(code: number | undefined, message?: string): string {
  const hint = CODE_HINTS[String(code)] ?? (message ?? '未知错误')
  return `code=${code} ${hint}`
}

function cookieHeader(cred: BiliCredentials): string {
  return `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3 ?? ''}`
}

/** 写请求的公共头（UA / referer / cookie）。导出给动态与私信那两条链路复用。 */
export function baseHeaders(cred: BiliCredentials): Record<string, string> {
  return { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader(cred) }
}

/**
 * 写侧凭据：**与读侧同一个解析**（原来这里是 JSON-only 的第二份实现）。
 *
 * 为什么必须一份：同一个 `.env` 文件喂着读与写两条路。读侧上一批修成两种格式都认之后，
 * 写侧还只认 JSON，于是部署家那份 `NAME=value` 的 .env 在写侧读出来是三个空串——
 * 她带着空 cookie 去发评论，平台回 -101/412，页面看起来像"被风控了"。
 * 一个文件两套解析，就是留给未来的第二个 bug；这里只留一条。
 */
export function loadCredentials(credentialsFile: string): BiliCredentials {
  return parseShared(credentialsFile)
}

/** 取视频信息（aid / 标题 / UP）——点赞与收藏都要用。 */
export async function fetchVideoInfo(
  bv: string,
  ctx: BiliWriteContext,
): Promise<{ aid: number; title: string; up: string }> {
  const r = await fetcher(ctx)(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, {
    headers: baseHeaders(ctx.cred),
  })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`取视频信息失败：code=${j.code} ${j.message ?? ''}`)
  return {
    aid: j.data.aid,
    title: String(j.data.title ?? ''),
    up: String(j.data.owner?.name ?? ''),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 判据（WriteGate.contentCheck 调用；返回 ok=false 即闸门拒，不消耗额度）
// ─────────────────────────────────────────────────────────────────────────────

/** 点赞判据：同一视频 30 天内不重复点（B站接口是 toggle，重复点会把赞取消掉）。 */
export function checkLikeNotRepeated(bv: string, ctx: BiliWriteContext, now = Date.now()): { ok: true } | { ok: false; code: 'policy'; reason: string } {
  const items = ctx.readLikeLog?.().items ?? []
  const same = items
    .filter((x) => x.bv === bv)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
  if (same && now - Date.parse(same.at) < 30 * 86400_000) {
    const days = Math.floor((now - Date.parse(same.at)) / 86400_000)
    return {
      ok: false,
      code: 'policy',
      reason: `这条 ${days} 天前赞过了 —— 再点一次会把赞取消（B站 toggle），别手滑`,
    }
  }
  return { ok: true }
}

/** 收藏判据之一：每天最多 3 条（与现状一致）。 */
export function checkFavDailyCap(ctx: BiliWriteContext, now = Date.now()): { ok: true } | { ok: false; code: 'policy'; reason: string } {
  const today = new Date(now).toLocaleDateString('sv-SE')
  const count = (ctx.readFavLog?.().items ?? []).filter(
    (x) => new Date(x.at).toLocaleDateString('sv-SE') === today,
  ).length
  if (count >= 3) {
    return { ok: false, code: 'policy', reason: `今天已经收藏 ${count} 条（上限 3 条）` }
  }
  return { ok: true }
}

/** 收藏判据之二：理由至少 6 个字（说不清为什么就不记成收藏）。 */
export function checkFavReason(reason: string): { ok: true } | { ok: false; code: 'policy'; reason: string } {
  const r = String(reason ?? '').trim()
  if (r.length < 6) {
    return { ok: false, code: 'policy', reason: '收藏理由至少 6 个字（说不清为什么就不收藏）' }
  }
  return { ok: true }
}

/**
 * 私信判据：**必须互关**（B 站私信的硬要求）。
 *
 * 以前这里判的是"7 天回信时效窗"——那条规则**是凭空来的**：
 * 旧 CLI（`tools/lib/dm-send-core.mjs`）从来没有这条判据，
 * 它判的是①登录②不给自己发③**必须互关**（`/x/relation` 的 attribute=6）④分享额度。
 * 而且 `lastDmReadAt` 这个字段**全仓没有任何地方写**——
 * 于是判据永远读到 0，永远回「还没读过私信，没有回信时效的起点」，
 * **她永远回不了私信**（一条永远为假的规则，等于把这条路焊死了）。
 *
 * 现在换成真判据：查关系接口，没互关就说没互关（并说清差哪一步）。
 */
export async function checkDmMutualFollow(
  ctx: BiliWriteContext,
  toMid: string,
): Promise<{ ok: true } | { ok: false; code: 'precondition'; reason: string }> {
  const to = String(toMid ?? '').trim()
  if (!to) return { ok: false, code: 'precondition', reason: '没给收信人 mid' }
  try {
    const j = await (await fetcher(ctx)(`https://api.bilibili.com/x/relation?fid=${encodeURIComponent(to)}`, {
      headers: baseHeaders(ctx.cred),
    })).json()
    if (j?.code !== 0) {
      return { ok: false, code: 'precondition', reason: `关系接口查不了（code=${j?.code}）：${j?.message ?? '未知'}` }
    }
    const attribute = Number(j?.data?.attribute ?? -1)
    if (attribute !== 6) {
      return {
        ok: false,
        code: 'precondition',
        reason: `还没互关（B 站私信要求双方互相关注，当前关系值 ${attribute}）：`
          + '用她这个号关注一下对方，对方也关注她，才能发私信。',
      }
    }
    return { ok: true }
  } catch (e: any) {
    return { ok: false, code: 'precondition', reason: `查关系失败：${String(e?.message ?? e)}` }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 四条写链路的执行体（WriteGate.executor 调用；只负责发，不负责裁决）
// ─────────────────────────────────────────────────────────────────────────────

export async function executeLike(
  action: { target: { bvid?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  const bv = String(action.target.bvid ?? '')
  const info = await fetchVideoInfo(bv, ctx)
  const r = await fetcher(ctx)('https://api.bilibili.com/x/web-interface/archive/like', {
    method: 'POST',
    headers: {
      ...baseHeaders(ctx.cred),
      referer: `https://www.bilibili.com/video/${bv}/`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      bvid: bv,
      like_pos: '1',
      csrf: String(ctx.cred.bili_jct ?? ''),
    }).toString(),
  })
  const j = await r.json()
  if (j.code !== 0) {
    return { ok: false, code: j.code, reason: explainCode(j.code, j.message), raw: j, httpStatus: r.status }
  }
  return {
    ok: true,
    code: 0,
    httpStatus: r.status,
    meta: { bv, aid: info.aid, title: info.title, up: info.up, reason: action.body },
  }
}

export async function executeFav(
  action: { target: { bvid?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  const bv = String(action.target.bvid ?? '')
  const info = await fetchVideoInfo(bv, ctx)
  const favId = 1
  const body = new URLSearchParams({
    rid: String(info.aid),
    type: '2',
    add_media_ids: String(favId),
    del_media_ids: '',
    csrf: String(ctx.cred.bili_jct ?? ''),
  })
  const r = await fetcher(ctx)('https://api.bilibili.com/x/v3/fav/resource/deal', {
    method: 'POST',
    headers: { ...baseHeaders(ctx.cred), 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  })
  const j = await r.json()
  if (j.code !== 0) {
    return { ok: false, code: j.code, reason: explainCode(j.code, j.message), raw: j, httpStatus: r.status }
  }
  return {
    ok: true,
    code: 0,
    httpStatus: r.status,
    meta: { bv, aid: info.aaid ?? info.aid, title: info.title, up: info.up, reason: action.body, favId },
  }
}

export async function executeComment(
  action: { target: { bvid?: string; oid?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  const bv = String(action.target.bvid ?? '')
  const oid = String(action.target.oid ?? '')
  const text = plainOutbound(action.body).trim()
  const r = await fetcher(ctx)('https://api.bilibili.com/x/v2/reply/add', {
    method: 'POST',
    headers: {
      ...baseHeaders(ctx.cred),
      referer: `https://www.bilibili.com/video/${bv}/`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      type: '1',
      oid,
      message: text,
      plat: '1',
      web_location: oid ? '131' : '333',
      csrf: String(ctx.cred.bili_jct ?? ''),
    }).toString(),
  })
  const j = await r.json()
  if (j.code !== 0) {
    return { ok: false, code: j.code, reason: explainCode(j.code, j.message), raw: j, httpStatus: r.status }
  }
  return {
    ok: true,
    code: 0,
    httpStatus: r.status,
    meta: { bv, rpid: j.data?.rpid ?? j.data?.reply?.rpid, url: `https://www.bilibili.com/video/${bv}/#reply${j.data?.rpid ?? j.data?.reply?.rpid ?? ''}` },
  }
}

export async function executeDanmaku(
  action: { target: { room?: string; bvid?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  const room = String(action.target.room ?? action.target.bvid ?? '')
  const text = plainOutbound(action.body).trim()
  const r = await fetcher(ctx)('https://api.live.bilibili.com/msg/send', {
    method: 'POST',
    headers: { ...baseHeaders(ctx.cred), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      bubble: '0',
      msg: text,
      color: '16777215',
      mode: '1',
      fontsize: '25',
      rnd: String(Date.now()),
      roomid: room,
    }).toString(),
  })
  const j = await r.json()
  if (j.code !== 0) {
    return { ok: false, code: j.code, reason: explainCode(j.code, j.message ?? j.msg), raw: j, httpStatus: r.status }
  }
  return { ok: true, code: 0, httpStatus: r.status, meta: { room, msg: text } }
}

/** 按 kind 分派到对应执行体。 */
export async function executeBiliWrite(
  kind: 'like' | 'fav' | 'comment' | 'danmaku' | 'dynamic' | 'edit-dynamic' | 'dm',
  action: { target: { bvid?: string; oid?: string; room?: string; mid?: string; dynId?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  switch (kind) {
    case 'like':
      return await executeLike(action, ctx)
    case 'fav':
      return await executeFav(action, ctx)
    case 'comment':
      return await executeComment(action, ctx)
    case 'danmaku':
      return await executeDanmaku(action, ctx)
    case 'dynamic':
      // 动态与私信的执行体在另一个文件（协议形状不一样，见那里的说明）
      return await executeDynamic(action, ctx)
    case 'edit-dynamic':
      // 改动态是**另一个接口**（/x/dynamic/feed/edit/dyn，还要带原图），不是发动态
      return await executeEditDynamic(action, ctx)
    case 'dm':
      return await executeDmReply(action, ctx as BiliWriteContext & { selfMid?: string | number; devId?: string })
  }
}

/** 点赞/收藏的本地账（写）。 */
export function appendLocalLog(file: string, items: unknown[], entry: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify({ items: [...items, entry] }, null, 2), 'utf8')
}

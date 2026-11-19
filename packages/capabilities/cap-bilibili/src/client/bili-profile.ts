/**
 * B 站读侧剩下的五路（A2 第三批）：字幕全文 / 评论列表 / 楼中楼 / 查昵称 / 自己发过的动态。
 *
 * 与 tools/commands/*.mjs 的关系：端点、参数、翻页停止条件、真实响应里的坑
 * 全部照抄线上跑过的那几份（subtitles.mjs / comments.mjs / diagnostics/whois.mjs /
 * dynamic.mjs 的 runRecent），差别只有三点：不读 argv、不 process.exit、fetch 可注入。
 *
 * 为什么这五个必须先做完：`bili_subtitles` 此前是占位实现，返回
 * `{ ok: true, subtitles: '' }`——**"成功但空"是最坏的一种失败**，
 * 她读到空字幕会以为"这视频没字幕"，然后去花几十秒抽帧看画面，
 * 而真相是我们的读接口根本没接上。剩下四个同理（whois 拿不到名字就 @ 错人）。
 *
 * 已实测过的坑（都写在代码里，别再踩）：
 *   ① 字幕必须走 WBI 签名的 `/x/player/wbi/v2`；旧 `/x/player/v2` 也能拿到
 *      subtitle_url，但那个 URL 缺 auth_key → CDN 403。
 *   ② subtitle_url 的 auth_key 是**分钟级**有效，拿到必须马上下载，URL 不能截断。
 *   ③ 匿名拿不到 AI 字幕（返回 0 条）→ 必须带登录 cookie。
 *   ④ 有些端点会回 HTML 而不是 JSON（风控/打码），`.json()` 直接抛会整条崩——
 *      统一兜成 `{code:-1}` 按"没有"处理。
 *   ⑤ 动态流里 `pub_time` 是"昨天 17:07"这种显示串，真正的 epoch 秒在
 *      `modules.module_author.pub_ts`；流按时间倒序，翻过目标日就停。
 */
import { guardedFetch as defaultFetch } from '../platform/traffic.mjs'
import { apiGet } from '../platform/api.mjs'
import { loadMixin, wbiQuery } from '../platform/wbi.ts'
import { UA } from './bili-write.ts'
import type { BiliReadContext } from './bili-read.ts'

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** ④ 统一 JSON 兜底：非 JSON 不抛，按"没拿到"处理 */
async function jget(ctx: BiliReadContext, url: string, headers: Record<string, string>): Promise<any> {
  const fetchImpl = ctx.fetch ?? defaultFetch
  try {
    const r = await fetchImpl(url, { headers })
    const text = await r.text()
    try { return JSON.parse(text) } catch {
      return { code: -1, message: `非 JSON 响应（风控/打码？）：${text.slice(0, 80)}` }
    }
  } catch (e) {
    return { code: -2, message: `请求失败：${e instanceof Error ? e.message : String(e)}` }
  }
}

function headersFor(ctx: BiliReadContext, referer: string) {
  return {
    'user-agent': UA,
    referer,
    cookie: `SESSDATA=${ctx.cred.sessdata}; bili_jct=${ctx.cred.bili_jct}; buvid3=${ctx.cred.buvid3 ?? ''}`,
  }
}

export interface SubtitleLine { from: number; to: number; text: string }

export interface SubtitlesResult {
  ok: boolean
  bvid: string
  title: string
  durationSec: number
  /** 选定轨道与来源端点（回执里要说清，不然"没字幕"分不清是没轨还是被风控） */
  lan: string
  lanDoc: string
  source: string
  tracks: Array<{ lan: string; lanDoc: string; hasAuthKey: boolean }>
  aiStatus: number | null
  lines: SubtitleLine[]
  text: string
  plain: string
  error?: string
}

/** ① ② ③ 全在这条函数里 */
export async function fetchSubtitles(ctx: BiliReadContext, bvid: string, opt: { lan?: string } = {}): Promise<SubtitlesResult> {
  const H = headersFor(ctx, `https://www.bilibili.com/video/${bvid}/`)
  const empty: SubtitlesResult = {
    ok: false, bvid, title: '', durationSec: 0, lan: '', lanDoc: '', source: '', tracks: [],
    aiStatus: null, lines: [], text: '', plain: '',
  }
  const view = await jget(ctx, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, H)
  if (view.code !== 0) return { ...empty, error: `view 失败 code=${view.code} ${view.message ?? ''}` }
  const aid = Number(view.data?.aid ?? 0)
  const cid = Number(view.data?.cid ?? 0)
  const meta = { bvid, title: String(view.data?.title ?? ''), durationSec: Number(view.data?.duration ?? 0) }

  const mixin = await loadMixin(ctx.fetch ?? defaultFetch, H)
  const p1 = await jget(ctx, `https://api.bilibili.com/x/player/wbi/v2?${wbiQuery(mixin, { bvid, cid })}`, H)
  let subs = p1?.data?.subtitle?.subtitles ?? []
  let source = 'x/player/wbi/v2'
  const aiStatus = p1?.data?.subtitle?.ai_status ?? null

  if (!subs.length) {
    const ext = encodeURIComponent(JSON.stringify({ video_type: 1 }))
    const p2 = await jget(ctx, `https://api.bilibili.com/x/v2/subtitle/web/view?oid=${aid}&pid=${aid}`
      + `&context_ext=${ext}&type=1&cur_production_type=0&preferred_language=ai-zh&playlist_switch=0`, H)
    const s2 = p2?.data?.subtitle?.subtitles ?? []
    if (s2.length) { subs = s2; source = 'x/v2/subtitle/web/view' }
    else return {
      ...empty, ...meta, aiStatus,
      tracks: [],
      error: `两个端点都没有字幕轨（wbi/v2 code=${p1?.code} ai_status=${aiStatus ?? '-'}；web/view code=${p2?.code}）`
        + '——大概率是把字烧进画面了，那种要走画面那条路',
    }
  }

  const want = opt.lan ?? 'ai-zh'
  const pick = subs.find((s: any) => s.lan === want) ?? subs.find((s: any) => s.lan === 'zh-CN')
    ?? subs.find((s: any) => String(s.lan).startsWith('zh')) ?? subs[0]
  const url = String(pick.subtitle_url ?? '')
  if (!url) return { ...empty, ...meta, aiStatus, error: '字幕轨里没给 subtitle_url' }
  const abs = url.startsWith('http') ? url : 'https:' + url
  const fetchImpl = ctx.fetch ?? defaultFetch
  // auth_key 分钟级过期：拿到轨道就马上下载，中间不插别的请求
  const r = await fetchImpl(abs, { headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}/` } })
  const status = Number((r as any).status ?? 200)
  if ((r as any).ok === false || status >= 400) {
    return {
      ...empty, ...meta, aiStatus, source,
      tracks: subs.map((s: any) => ({ lan: String(s.lan), lanDoc: String(s.lan_doc ?? ''), hasAuthKey: String(s.subtitle_url).includes('auth_key') })),
      error: `下载字幕失败 HTTP ${status}——auth_key 是分钟级的，重跑一次即可`,
    }
  }
  let body: any[] = []
  try { body = JSON.parse(await r.text()).body ?? [] } catch {
    return { ...empty, ...meta, aiStatus, source, error: '字幕 JSON 解析失败（不是 JSON 或 body 为空）' }
  }
  const lines: SubtitleLine[] = body.map((l: any) => ({
    from: Number(l.from ?? 0), to: Number(l.to ?? (Number(l.from ?? 0) + 3)), text: String(l.content ?? ''),
  }))
  return {
    ok: true, ...meta,
    lan: String(pick.lan ?? ''), lanDoc: String(pick.lan_doc ?? ''), source,
    tracks: subs.map((s: any) => ({ lan: String(s.lan), lanDoc: String(s.lan_doc ?? ''), hasAuthKey: String(s.subtitle_url).includes('auth_key') })),
    aiStatus, lines,
    text: `${meta.title}\n${fmt(lines[0]?.from ?? 0)} → ${fmt(lines.at(-1)?.to ?? 0)} 共 ${lines.length} 行\n`
      + lines.map((l) => `[${fmt(l.from)}] ${l.text}`).join('\n'),
    plain: lines.map((l) => l.text).join('\n'),
  }
}

export interface CommentItem {
  rpid: string; user: string; mid: string; like: number; replies: number; time: string; text: string
}

export interface CommentsResult { ok: boolean; bvid: string; aid: number; total: number; count: number; items: CommentItem[]; error?: string }

const oneComment = (r: any, maxc = 200): CommentItem => ({
  rpid: String(r.rpid ?? ''),
  user: String(r.member?.uname ?? '匿名'),
  mid: String(r.member?.mid ?? ''),
  like: Number(r.like ?? 0),
  replies: Number(r.rcount ?? 0),
  time: r.ctime ? new Date(Number(r.ctime) * 1000).toLocaleString('zh-CN', { hour12: false }) : '',
  text: String(r.content?.message ?? '').replace(/\s+/g, ' ').trim().slice(0, maxc),
})

/** 评论列表（匿名也可读，带 cookie 楼层更全——照 comments.mjs 的容错口径） */
export async function fetchComments(
  ctx: BiliReadContext,
  bvid: string,
  opt: { ps?: number; pn?: number; sort?: 'hot' | 'time'; maxChars?: number } = {},
): Promise<CommentsResult> {
  const H = headersFor(ctx, `https://www.bilibili.com/video/${bvid}/`)
  const ps = Math.min(50, Math.max(1, Number(opt.ps ?? 20) || 20))
  const pn = Math.max(1, Number(opt.pn ?? 1) || 1)
  const sort = String(opt.sort ?? 'hot') === 'time' ? 0 : 2
  const maxc = Math.max(40, Number(opt.maxChars ?? 200) || 200)

  const view = await jget(ctx, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, H)
  if (view.code !== 0) return { ok: false, bvid, aid: 0, total: 0, count: 0, items: [], error: `view 失败 code=${view.code} ${view.message ?? ''}` }
  const aid = Number(view.data?.aid ?? 0)
  const rep = await jget(ctx, `https://api.bilibili.com/x/v2/reply?type=1&oid=${aid}&sort=${sort}&ps=${ps}&pn=${pn}`, H)
  if (rep.code !== 0) return { ok: false, bvid, aid, total: 0, count: 0, items: [], error: `reply 失败 code=${rep.code} ${rep.message ?? ''}` }
  const items = (rep?.data?.replies ?? []).map((r: any) => oneComment(r, maxc))
  return { ok: true, bvid, aid, total: Number(rep?.data?.page?.total ?? 0), count: items.length, items }
}

export interface ThreadResult { ok: boolean; bvid: string; rootRpid: string; count: number; items: CommentItem[]; error?: string }

/** 楼中楼：她回完一条评论要看清"别人在下面怎么接的"，靠这条 */
export async function fetchThread(ctx: BiliReadContext, bvid: string, rootRpid: string, opt: { ps?: number } = {}): Promise<ThreadResult> {
  const H = headersFor(ctx, `https://www.bilibili.com/video/${bvid}/`)
  const ps = Math.min(50, Math.max(1, Number(opt.ps ?? 20) || 20))
  const view = await jget(ctx, `https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`, H)
  if (view.code !== 0) return { ok: false, bvid, rootRpid, count: 0, items: [], error: `view 失败 code=${view.code}` }
  const aid = Number(view.data?.aid ?? 0)
  const rep = await jget(ctx, `https://api.bilibili.com/x/v2/reply/reply?type=1&oid=${aid}&root=${rootRpid}&ps=${ps}&pn=1`, H)
  if (rep.code !== 0) return { ok: false, bvid, rootRpid, count: 0, items: [], error: `reply/reply 失败 code=${rep.code} ${rep.message ?? ''}` }
  const items = (rep?.data?.replies ?? []).map((r: any) => oneComment(r))
  return { ok: true, bvid, rootRpid, count: items.length, items }
}

export interface WhoisResult { ok: boolean; mid: string; name: string; sign: string; level: number | null; fans: number | null; error?: string }

/** 按 mid 查昵称：@ 人之前先核准名字（whois.mjs 同款 WBI 端点） */
export async function whois(ctx: BiliReadContext, mid: string): Promise<WhoisResult> {
  const H = headersFor(ctx, 'https://www.bilibili.com/')
  const mixin = await loadMixin(ctx.fetch ?? defaultFetch, H)
  // 参数集必须和 whois.mjs 一模一样只签 {mid}：多带一个空 location 实测被 -400 拒掉
  const d = await jget(ctx, `https://api.bilibili.com/x/space/wbi/acc/info?${wbiQuery(mixin, { mid: String(mid) })}`, H)
  if (d.code !== 0) {
    return { ok: false, mid: String(mid), name: '', sign: '', level: null, fans: null, error: `code=${d.code} ${d.message ?? d.msg ?? ''}` }
  }
  return {
    ok: true, mid: String(mid),
    name: String(d.data?.name ?? ''),
    sign: String(d.data?.sign ?? '').slice(0, 80),
    level: Number(d.data?.level ?? 0) || null,
    fans: d.data?.fans ?? d.data?.official?.title ? Number(d.data?.fans ?? 0) || null : null,
  }
}

export interface DynamicRecentResult {
  ok: boolean; day: string; count: number
  items: Array<{ dynId: string; at: string; type: string; text: string }>
  error?: string
}

/**
 * 她自己发过的动态（feed/space 翻页，翻过目标日就停）。
 * 坑⑤：显示串 pub_time 不能用，epoch 在 modules.module_author.pub_ts。
 */
export async function dynamicRecent(
  ctx: BiliReadContext,
  opt: { date?: string; mid?: string | number; limit?: number } = {},
): Promise<DynamicRecentResult> {
  // referer 必须是 https://t.bilibili.com/（照 dynamic.mjs 的 REF）：
  // 换成 space.bilibili.com 实测被挡回一屏 HTML 而不是 JSON（风控页），
  // 不是接口坏了，是 referer 不对——这种差别只有真打一次才看得出来。
  const H = headersFor(ctx, 'https://t.bilibili.com/')
  const day = String(opt.date ?? new Date().toLocaleDateString('sv-SE'))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return { ok: false, day, count: 0, items: [], error: 'date 要形如 2026-11-04' }
  const limit = Math.min(50, Math.max(1, Number(opt.limit ?? 10) || 10))
  let mid = opt.mid
  if (!mid) {
    const nav = await jget(ctx, 'https://api.bilibili.com/x/web-interface/nav', H)
    if (nav.code !== 0) return { ok: false, day, count: 0, items: [], error: `nav 失败 code=${nav.code}（拿不到自己的 mid）` }
    mid = nav.data?.mid
  }
  const mixin = await loadMixin(ctx.fetch ?? defaultFetch, H)
  const items: DynamicRecentResult['items'] = []
  let offset = ''
  let stop = false
  for (let page = 0; page < 10 && !stop && items.length < limit; page += 1) {
    const qs = wbiQuery(mixin, { host_mid: String(mid), timezone_offset: -480, offset })
    const d = await jget(ctx, `https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?${qs}`, H)
    if (d.code !== 0) return { ok: false, day, count: items.length, items, error: `feed/space code=${d.code} ${d.message ?? d.msg ?? ''}` }
    const list = d.data?.items ?? []
    if (!list.length) break
    for (const it of list) {
      const t = Number(it?.modules?.module_author?.pub_ts ?? 0)
      if (!t) continue
      const localDate = new Date(t * 1000).toLocaleDateString('sv-SE')
      if (localDate < day) { stop = true; break }
      if (localDate !== day) continue
      items.push({
        dynId: String(it.id_str ?? it.id ?? ''),
        at: new Date(t * 1000).toISOString(),
        type: String(it.dynamic_type ?? it.type ?? ''),
        text: String(it.content?.description ?? it.modules?.module_dynamic?.desc?.text ?? '')
          .replace(/\s+/g, ' ').trim().slice(0, 160),
      })
      if (items.length >= limit) break
    }
    offset = String(d.data?.offset ?? '')
    if (!offset) break
  }
  return { ok: true, day, count: items.length, items }
}

export { fmt as fmtClock, apiGet }

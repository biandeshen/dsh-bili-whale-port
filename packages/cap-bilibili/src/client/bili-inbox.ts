/**
 * 四路收件箱的**拉取层**（A2 之后缺失的那一环）。
 *
 * 为什么单独一个文件（2026-11-06 主人："原本的 B 站那些配置全部都没迁移过来"）：
 * 能力包重写时把「四路收件箱」做成了**一个本地存储 + 一个她自愿去调的读工具**
 * （`BiliInboxAndPrefsStore` / `bili_inbox_read`），但**没有任何代码往这个存储里写**——
 * `ingestItems()` 的调用者全仓只有一个测试。结果她的收件箱永远 0 条：
 * 不是"没人找她"，是**根本没人去 B 站拉**。旧架构里干这件事的是 `core/scheduler.js`
 * 的定时器（`listen.commentIntervalSec` / `dmIntervalSec`），迁移时整块落下。
 *
 * 端点与解析**照抄已核实的旧实现**（`tools/lib/msgfeed.mjs` + docs/ARCHITECTURE.md
 * 里那条"核实私信接口"的提交记录），差别只有：不读 argv、不 process.exit、fetch 可注入。
 *
 * 三条旧代码里用事故换来的规矩，这里原样保留：
 *   ① `/x/msgfeed/reply` 的 `item.title` **不总是**那条新回复的正文（实测多条 title 同一句），
 *      真正文在 `target_reply_content` / `source_content` —— 所以优先级是
 *      target → source → title，收件箱只用来"发现有人找她"，正文以楼层为准。
 *   ② 翻页时 cursor 会返回重叠数据（实测每条出现两遍）→ 必须按 id 去重。
 *   ③ 私信只认**主人那一个会话**：系统通知、陌生人一律忽略（旧设计原话：
 *      "你不说话 = 没有新私信 = 不叫醒 = 零 token"）。
 */
import { readFetcher, readHeaders, type BiliReadContext } from './bili-read.ts'

export type InboxFeedKind = 'reply' | 'mention' | 'like' | 'dm'

/** 与 `client/inbox.ts` 的 InboxItem 同形（去掉 read —— 新拉来的都算未读）。 */
export interface FetchedInboxItem {
  key: string
  kind: InboxFeedKind
  uid: string
  who: string
  text: string
  atMs: number
  ref?: { bvid?: string; rpid?: string; dynId?: string }
}

export interface InboxSourceFail {
  source: string
  why: string
}

/**
 * 拉取要用的两个身份：
 *   · `selfMid` —— 她自己的 mid（拉私信时用来剔除**她自己发的**消息，否则她会把
 *      自己的回信当成"新私信"把自己叫醒）；
 *   · `ownerMid` —— 主人的 mid（私信只看这一个会话）。
 * 两个都留空时：reply/at/like 照常拉，私信整路标成"缺身份"而不是静默跳过——
 * 环境缺东西要能被看见（f-340915 的教训）。
 */
export interface InboxIds {
  selfMid?: string | number
  ownerMid?: string | number
}

export interface InboxPullResult {
  ok: boolean
  items: FetchedInboxItem[]
  /** 每一路的死活：code=N 是被拦（该等），fetch failed 是网络，0 条是源真没东西。 */
  sourceFails: InboxSourceFail[]
  /** `x/msgfeed/*` 的 last_view_at（秒），监听态拿它当基线。 */
  lastViewSec: number
}

const VC = 'https://api.vc.bilibili.com'
const API = 'https://api.bilibili.com'

/** msgfeed 的 kind 名与她的收件箱 kind 名不是一套：'at' → 'mention'。 */
const MSGFEED_KIND: Record<'reply' | 'at', InboxFeedKind> = { reply: 'reply', at: 'mention' }

function firstText(...cands: Array<string | undefined>): string {
  for (const c of cands) {
    const s = String(c ?? '').trim()
    if (s) return s
  }
  return ''
}

/** 剥掉 HTML 标签与实体：评论正文里混着 `<br>`、`&quot;` 这类。 */
function plain(s: string): string {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
}

async function jget(
  ctx: BiliReadContext,
  url: string,
): Promise<{ ok: true; json: any } | { ok: false; why: string }> {
  try {
    const res = await readFetcher(ctx)(url, { headers: readHeaders(ctx) })
    const j = await res.json()
    if (Number(j?.code) !== 0) return { ok: false, why: `code=${j?.code} ${String(j?.message ?? j?.msg ?? '')}`.trim() }
    return { ok: true, json: j }
  } catch (e: any) {
    return { ok: false, why: `fetch failed：${String(e?.message ?? e).slice(0, 80)}` }
  }
}

/** 「回复我的」/「@我的」：一页足够（监听器每分钟都会跑一次）。 */
async function pullMsgfeed(
  ctx: BiliReadContext,
  rawKind: 'reply' | 'at',
): Promise<{ items: FetchedInboxItem[]; lastViewSec: number; fail?: InboxSourceFail }> {
  const kind = MSGFEED_KIND[rawKind]
  const url = `${API}/x/msgfeed/${rawKind}?platform=web&build=0&mobi_app=web`
  const r = await jget(ctx, url)
  if (!r.ok) return { items: [], lastViewSec: 0, fail: { source: kind, why: r.why } }
  const rows: any[] = r.json?.data?.items ?? []
  const out: FetchedInboxItem[] = []
  for (const it of rows) {
    const t = Number(it?.reply_time ?? it?.at_time ?? 0)
    const mid = String(it?.user?.mid ?? '')
    // ② cursor/翻页重叠 + 同一条重复上报：key 带 kind 与 id，落到存储层再按 key 去重
    const id = String(it?.id ?? `${mid}:${t}`)
    out.push({
      key: `${kind}:${id}`,
      kind,
      uid: mid,
      who: String(it?.user?.nickname ?? '?'),
      // ① title 不可靠：先取"别人新写的那条"，再取源内容，最后才是 title
      text: plain(firstText(
        it?.item?.target_reply_content,
        it?.item?.source_content,
        it?.item?.title,
      )).slice(0, 400),
      atMs: t * 1000,
      ref: {
        ...(it?.item?.uri ? { bvid: String(it.item.uri) } : {}),
        ...(it?.item?.subject_id ? { bvid: String(it.item.subject_id) } : {}),
        ...(it?.item?.root_id ? { rpid: String(it.item.root_id) } : {}),
      },
    })
  }
  return { items: out, lastViewSec: Number(r.json?.data?.last_view_at ?? 0) }
}

/**
 * 「收到的赞」。
 *
 * ⚠️ 形状是**实测**来的（2026-11-06 用她自己的 cookie 真拉了一次，见 scripts/verify-inbox-live.mjs）：
 * 返回的是 `data.latest.items` + `data.total.items`，**没有 `data.items`**，
 * 一条 item 是"一批人赞了同一个东西"（`users[]` + `like_time` + `counts`），
 * 不是 `notices[]`。之前按 `items[].notices` 解，结果永远 0 条，
 * 而 0 条看起来像"真没人赞她"——这就是"解析没吃到"和"确实没有"必须分开的原因。
 * 旧实现同样踩过并把结论写进了注释：`tools/commands/likes.mjs:43`。
 */
async function pullLikes(ctx: BiliReadContext): Promise<{ items: FetchedInboxItem[]; fail?: InboxSourceFail }> {
  const r = await jget(ctx, `${API}/x/msgfeed/like?build=0&mobi_app=web`)
  if (!r.ok) return { items: [], fail: { source: 'like', why: r.why } }
  const d = r.json?.data ?? {}
  const groups = [...(d?.latest?.items ?? []), ...(d?.total?.items ?? []), ...(d?.items ?? [])] as any[]
  const out: FetchedInboxItem[] = []
  const seen = new Set<string>()
  for (const g of groups) {
    const id = String(g?.id ?? '')
    const t = Number(g?.like_time ?? g?.timestamp ?? 0)
    if (!id || !Number.isFinite(t) || t <= 0) continue // 没 id 没时间的一律不吃，免得基线被推走
    if (seen.has(id)) continue
    seen.add(id)
    const users = (g?.users ?? []) as any[]
    const who = users.map((u) => String(u?.nickname ?? '?')).filter(Boolean).join('、') || '?'
    const target = plain(firstText(g?.item?.title, g?.item?.detail_title, g?.item?.business))
    out.push({
      key: `like:${id}`,
      kind: 'like',
      // 一批人一个 id：uid 取第一个人的 mid（点赞不是"谁在跟她说话"，只是线索）
      uid: String(users[0]?.mid ?? ''),
      who: users.length > 1 ? `${who} 等 ${users.length} 人` : who,
      text: `赞了${target ? `「${target}」` : '她'}（共 ${Number(g?.counts ?? users.length) || users.length} 赞）`.slice(0, 300),
      atMs: t * 1000,
      ref: g?.item?.subject_id ? { bvid: String(g.item.subject_id) } : undefined,
    })
  }
  return { items: out }
}

/**
 * 私信：会话列表 → 只取主人那一个 → 拉该会话最近若干条。
 * 端点取自"核实私信接口"那次提交（docs/ARCHITECTURE.md 里记了参数与取字段的位置）。
 */
async function pullDm(
  ctx: BiliReadContext,
  ids: InboxIds,
): Promise<{ items: FetchedInboxItem[]; fail?: InboxSourceFail }> {
  const owner = String(ids.ownerMid ?? '').trim()
  if (!owner) return { items: [], fail: { source: 'dm', why: '缺 owner.mid（旧共享配置里这个键没迁过来）' } }
  const listUrl = `${VC}/session_svr/v1/session_svr/get_sessions?session_type=1&group_fold=1&unfollow_fold=0&sort_rule=2&build=0&mobi_app=web`
  const lr = await jget(ctx, listUrl)
  if (!lr.ok) return { items: [], fail: { source: 'dm', why: `会话列表 ${lr.why}` } }
  const sessions = (lr.json?.data?.session_list ?? []) as any[]
  const mine = sessions.find((s) => String(s?.talker_id ?? '') === owner)
  // 主人没跟她开过会话 = 没有私信可拉：这是真没数据，不是坏了（措辞要分得清）
  if (!mine) return { items: [], fail: { source: 'dm', why: '主人与她之间没有会话（她没收到过你的私信）' } }

  const msgUrl = `${VC}/svr_sync/v1/svr_sync/fetch_session_msgs?talker_id=${owner}&session_type=1&size=30&build=0&mobi_app=web`
  const mr = await jget(ctx, msgUrl)
  if (!mr.ok) return { items: [], fail: { source: 'dm', why: `消息 ${mr.why}` } }
  // 空信箱时 messages 可能是 null（旧事故 bb263b8：null 被当成读取失败）
  const msgs = (mr.json?.data?.messages ?? []) as any[]
  const self = String(ids.selfMid ?? '').trim()
  const out: FetchedInboxItem[] = []
  for (const m of msgs) {
    const sender = String(m?.sender_uid ?? '')
    // ③ + 她自己的消息不能进收件箱，否则她把自己的回信当"新私信"叫醒自己
    if (self && sender === self) continue
    if (Number(m?.msg_type ?? 0) !== 1) continue // 只要文本，图片/模板消息不当正文
    let text = ''
    try {
      const c = typeof m?.content === 'string' ? JSON.parse(m.content) : m?.content
      text = String(c?.content ?? '')
    } catch { text = String(m?.content ?? '') }
    out.push({
      key: `dm:${m?.msg_seqno ?? m?.client_seqno ?? sender}:${m?.timestamp ?? 0}`,
      kind: 'dm',
      uid: sender,
      who: '主人',
      text: plain(text).slice(0, 600),
      atMs: Number(m?.timestamp ?? 0) * 1000,
    })
  }
  return { items: out }
}

/**
 * 四路一起拉。每一路独立成败，坏的那路写进 sourceFails——
 * 她（和主人）要能分清"被风控拦了"「网络断了」「真没人找她」。
 */
export async function pullInbox(
  ctx: BiliReadContext,
  ids: InboxIds = {},
  opts: { include?: Array<'reply' | 'at' | 'like' | 'dm'> } = {},
): Promise<InboxPullResult> {
  const want = new Set(opts.include ?? ['reply', 'at', 'like', 'dm'])
  const items: FetchedInboxItem[] = []
  const sourceFails: InboxSourceFail[] = []
  let lastViewSec = 0

  if (want.has('reply')) {
    const r = await pullMsgfeed(ctx, 'reply')
    items.push(...r.items)
    lastViewSec = Math.max(lastViewSec, r.lastViewSec)
    if (r.fail) sourceFails.push(r.fail)
  }
  if (want.has('at')) {
    const r = await pullMsgfeed(ctx, 'at')
    items.push(...r.items)
    if (r.fail) sourceFails.push(r.fail)
  }
  if (want.has('like')) {
    const r = await pullLikes(ctx)
    items.push(...r.items)
    if (r.fail) sourceFails.push(r.fail)
  }
  if (want.has('dm')) {
    const r = await pullDm(ctx, ids)
    items.push(...r.items)
    if (r.fail) sourceFails.push(r.fail)
  }

  // 同一 key 只留一条（msgfeed 与 like 之间、以及翻页重叠都可能撞）
  const seen = new Set<string>()
  const uniq = items.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)))
  uniq.sort((a, b) => a.atMs - b.atMs)
  return { ok: uniq.length > 0 || sourceFails.length === 0, items: uniq, sourceFails, lastViewSec }
}

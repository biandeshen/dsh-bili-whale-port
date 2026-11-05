/**
 * 两条缺了很久的写链路：**发动态**与**回私信**。
 *
 * 缺口长什么样：能力包的写侧只有点赞/收藏/评论/弹幕四个执行器
 * （`bili-write.ts`）。动态与私信虽然有闸门档位（`draftMode` / `dmReply`）、
 * 有工具（`bili_dynamic_draft` / `bili_dm_reply`），但闸门放行之后**没有真执行器**，
 * 于是回一句「kind=dm 还没有真实执行器」——
 * **她作为 B 站账号最本分的两个动作（发动态、回私信）今天都做不了**。
 *
 * 协议形状：
 *   · 动态：`POST https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/create`
 *     （形状照 `tools/docs/dynamic-publish.md` 里那份验过的 curl：type=4 纯文本、
 *     dynamic_id=0、rid=0、extension 固定串、csrf_token + csrf 两份）。
 *   · 私信：`POST https://api.vc.bilibili.com/web_im/v1/web_im/send_msg`
 *     （形状照 `tools/lib/dm-send-core.mjs`：msg[sender_uid] 是**她自己**的 mid、
 *     msg[receiver_type]=1、msg[msg_type]=1、msg[dev_id] 要一个稳定值、
 *     msg[content] 是 `{"content":"正文"}` 的 JSON 串）。
 *
 * 两条都**只负责发**，不负责裁决——额度、档位、判据都由 WriteGate 那层管
 * （与另外四条链路同一口径：执行体只管把请求送出去、送成功）。
 */
import crypto from 'node:crypto'
import { fetcher, baseHeaders, explainCode, UA, type BiliWriteContext, type WriteOutcome } from './bili-write.ts'

/** 私信用的稳定设备号：同一台机器要一直是同一个，否则 B 站会当成新设备。 */
export function stableDevId(read: () => string | null, write: (v: string) => void): string {
  try {
    const v = String(read() ?? '').trim()
    if (/^WEB-[0-9A-F-]{20,}$/i.test(v)) return v
  } catch { /* 读不到就现造一个 */ }
  const v = 'WEB-' + crypto.randomUUID().toUpperCase()
  try { write(v) } catch { /* 写不进去就用这次的（下一轮会再变，但不至于发不出去） */ }
  return v
}

/**
 * 发动态（纯文本）。
 *
 * 只做纯文本：带图/带长文的形状在旧文档里另有一套（opus/draw），
 * 那一套**没有验过的请求形状**，不在这儿编一个。
 */
export async function executeDynamic(
  action: { target: { bvid?: string; dynId?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  const content = String(action.body ?? '').trim()
  if (!content) return { ok: false, code: -400, reason: '动态正文是空的' }
  const body = new URLSearchParams({
    dynamic_id: '0',
    type: '4',
    rid: '0',
    content,
    up_choose_comment: '0',
    up_close_comment: '0',
    extension: '{"emoji_type":1,"from":{"emoji_type":1},"flag_cfg":{}}',
    at_uids: '',
    ctrl: '[]',
    csrf_token: String(ctx.cred.bili_jct ?? ''),
    csrf: String(ctx.cred.bili_jct ?? ''),
  })
  const r = await fetcher(ctx)('https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/create', {
    method: 'POST',
    headers: {
      ...baseHeaders(ctx.cred),
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const j = await r.json().catch(() => ({}) as any)
  if (j?.code !== 0) {
    return { ok: false, code: Number(j?.code ?? r.status), reason: explainCode(Number(j?.code ?? r.status), j?.message ?? j?.msg), raw: j, httpStatus: r.status }
  }
  const dynId = String(j?.data?.dynamic_id_str ?? j?.data?.dynamic_id ?? '')
  return {
    ok: true,
    code: 0,
    httpStatus: r.status,
    meta: {
      dynamicId: dynId,
      // 主人点开就能看到那条动态
      url: dynId ? `https://www.bilibili.com/opus/${dynId}` : undefined,
      chars: content.length,
    },
  }
}

/**
 * 改动态（不是发新的一条）。
 *
 * **为什么不能拿"发动态"顶替**：编辑走的是另一个接口
 * （`/x/dynamic/feed/edit/dyn`，JSON body），而且要带原动态的图片
 * （编辑时把图丢了，用户看到的就是一条没图的动态）。旧命令
 * （`tools/commands/edit-dynamic.mjs`）是"先回读原动态拿图，再带图编辑"。
 *
 * 这里照搬那个形状：先读 detail 拿 pics，再带 payload 编辑。
 */
export async function executeEditDynamic(
  action: { target: { dynId?: string }; body: string },
  ctx: BiliWriteContext,
): Promise<WriteOutcome> {
  const dynId = String(action.target.dynId ?? '').trim()
  const content = String(action.body ?? '').trim()
  if (!dynId) return { ok: false, code: -400, reason: '没给要改的动态 id' }
  if (!content) return { ok: false, code: -400, reason: '动态正文是空的' }

  // 1) 回读原动态：把图片原样带上，别把主人的图弄丢
  let pics: Array<{ img_src: string; img_width: number; img_height: number }> = []
  try {
    const d = await (await fetcher(ctx)(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?id=${encodeURIComponent(dynId)}&features=itemOpusStyle`, {
      headers: baseHeaders(ctx.cred),
    })).json().catch(() => ({}) as any)
    const major = d?.data?.item?.modules?.module_dynamic?.major
    const opus = major?.opus ?? major?.draw
    pics = (opus?.pics ?? []).map((p: any) => ({
      img_src: String(p.url ?? ''),
      img_width: Number(p.width ?? 0),
      img_height: Number(p.height ?? 0),
    }))
  } catch (e: any) {
    return { ok: false, code: -400, reason: `读原动态失败（拿不到它的图，不敢改）：${String(e?.message ?? e)}` }
  }

  const payload = {
    dyn_id_str: dynId,
    dyn_req: {
      scene: pics.length ? 2 : 1,
      content: { contents: [{ raw_text: content, type: 1, biz_id: '' }] },
      ...(pics.length ? { pics } : {}),
      meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
    },
    csrf: String(ctx.cred.bili_jct ?? ''),
  }
  const r = await fetcher(ctx)('https://api.bilibili.com/x/dynamic/feed/edit/dyn?platform=web', {
    method: 'POST',
    headers: { ...baseHeaders(ctx.cred), 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const j = await r.json().catch(() => ({}) as any)
  if (j?.code !== 0) {
    return { ok: false, code: Number(j?.code ?? r.status), reason: explainCode(Number(j?.code ?? r.status), j?.message), raw: j, httpStatus: r.status }
  }
  return {
    ok: true,
    code: 0,
    httpStatus: r.status,
    meta: { dynamicId: dynId, picsKept: pics.length, chars: content.length },
  }
}

/**
 * 回私信（单聊）。
 *
 * 两个前置条件（都在这里判，不在闸门外）：
 *   · `sender_uid` 要的是**她自己**的 mid —— 调用方通过 `ctx.selfMid` 传进来
 *     （拿法见 `checkLogin`：nav 接口的 `data.mid`）；
 *   · **不能给自己发**（owner 就是她这个号时，B 站那边也是拒绝的），
 *     这里提前挡住，省一次白跑的风控额度。
 */
export async function executeDmReply(
  action: { target: { mid?: string }; body: string },
  ctx: BiliWriteContext & { selfMid?: string | number; selfUname?: string; devId?: string },
): Promise<WriteOutcome> {
  const content = String(action.body ?? '').trim()
  if (!content) return { ok: false, code: -400, reason: '私信正文是空的' }
  const to = String(action.target.mid ?? '').trim()
  if (!to) return { ok: false, code: -400, reason: '没给收信人 mid' }
  const self = String(ctx.selfMid ?? '').trim()
  if (!self) {
    return {
      ok: false,
      code: -101,
      reason: '拿不到她自己登录的 mid（nav 没登录？私信需要 sender_uid）',
    }
  }
  if (self === to) {
    return {
      ok: false,
      code: -400,
      reason: '不能给自己发私信：收信人就是她这个号。要发给别人需要另一个号，且双方手动互关。',
    }
  }
  const body = new URLSearchParams()
  body.set('msg[sender_uid]', self)
  body.set('msg[receiver_id]', to)
  body.set('msg[receiver_type]', '1')
  body.set('msg[msg_type]', '1')
  body.set('msg[msg_status]', '0')
  body.set('msg[timestamp]', String(Math.floor(Date.now() / 1000)))
  body.set('msg[dev_id]', ctx.devId ?? stableDevId(() => null, () => {}))
  body.set('msg[content]', JSON.stringify({ content }))
  body.set('csrf', String(ctx.cred.bili_jct ?? ''))

  const r = await fetcher(ctx)('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
    method: 'POST',
    headers: {
      'user-agent': UA,
      referer: 'https://www.bilibili.com/',
      cookie: `SESSDATA=${ctx.cred.sessdata}; bili_jct=${ctx.cred.bili_jct}; buvid3=${ctx.cred.buvid3 ?? ''}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  const j = await r.json().catch(() => ({}) as any)
  if (j?.code !== 0) {
    return { ok: false, code: Number(j?.code ?? r.status), reason: explainCode(Number(j?.code ?? r.status), j?.message), raw: j, httpStatus: r.status }
  }
  return {
    ok: true,
    code: 0,
    httpStatus: r.status,
    meta: { to, chars: content.length },
  }
}

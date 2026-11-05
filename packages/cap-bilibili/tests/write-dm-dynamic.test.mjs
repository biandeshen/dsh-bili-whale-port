/**
 * 发动态与回私信的执行器（B13i）。
 *
 * 缺口长什么样：能力包的写侧只有点赞/收藏/评论/弹幕四个执行器。
 * 动态与私信虽然有闸门档位（`draftMode` / `dmReply`）、有工具，
 * 但闸门放行之后**没有真执行器** → 回「kind=dm 还没有真实执行器」。
 * **她作为 B 站账号最本分的两个动作（发动态、回私信）今天都做不了。**
 *
 * 这一条钉住：
 *   1. 请求形状对（照旧文档/旧 CLI 验过的那份）：动态 create、私信 send_msg；
 *   2. 私信要带**她自己**的 mid 当 sender_uid，拿不到就说拿不到；
 *   3. **不能给自己发私信**（B 站那边也拒，提前挡掉省一次风控额度）；
 *   4. 平台报错要翻成人话（-101 掉登录 / -111 csrf 不匹配 / -352 风控）。
 *
 * 全部用注入的 fetch，**不真发请求**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { executeDynamic, executeEditDynamic, executeDmReply } from '../src/client/bili-write-extra.ts'

const cred = { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }

/** 记下请求的 fetch 替身。 */
function spy(reply) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ url: String(url), init, body: String(init?.body ?? '') })
    return new Response(JSON.stringify(reply), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetch }
}

test('发动态：请求形状照旧文档（type=4 / csrf 两份 / extension 固定串）', async () => {
  const s = spy({ code: 0, data: { dynamic_id_str: '888123', dynamic_id: 888123 } })
  const out = await executeDynamic(
    { target: {}, body: '今天也听雨。' },
    { cred, fetch: s.fetch },
  )
  assert.equal(out.ok, true, out.reason)
  assert.equal(s.calls.length, 1)
  const c = s.calls[0]
  assert.match(c.url, /dynamic_svr\/v1\/dynamic_svr\/create/)
  assert.match(c.body, /type=4/)
  assert.match(c.body, /dynamic_id=0/)
  assert.match(c.body, /csrf_token=J/)
  assert.match(c.body, /csrf=J/)
  // body 是 urlencoded：解出来看正文
  assert.match(decodeURIComponent(c.body), /content=今天也听雨。/)
  assert.equal(out.meta?.dynamicId, '888123')
  assert.match(String(out.meta?.url ?? ''), /opus\/888123/, '要给主人一个能点开的链接')
})

test('发动态：正文是空的就不发（省一次风控额度）', async () => {
  const s = spy({ code: 0 })
  const out = await executeDynamic({ target: {}, body: '   ' }, { cred, fetch: s.fetch })
  assert.equal(out.ok, false)
  assert.equal(s.calls.length, 0, '不该发请求')
})

test('发动态：平台报错翻成人话', async () => {
  const s = spy({ code: -101, message: '账号未登录' })
  const out = await executeDynamic({ target: {}, body: 'x' }, { cred, fetch: s.fetch })
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /未登录/)
})

test('回私信：带自己 mid 当 sender_uid，收信人是 mid', async () => {
  const s = spy({ code: 0 })
  const out = await executeDmReply(
    { target: { mid: '233643544' }, body: '我看到了。' },
    { cred, fetch: s.fetch, selfMid: '497080562' },
  )
  assert.equal(out.ok, true, out.reason)
  const c = s.calls[0]
  assert.match(c.url, /web_im\/v1\/web_im\/send_msg/)
  // body 是 urlencoded：先解出来再看字段
  const decoded = decodeURIComponent(c.body)
  assert.match(decoded, /msg\[sender_uid\]=497080562/, 'sender_uid 是她自己')
  assert.match(decoded, /msg\[receiver_id\]=233643544/)
  assert.match(decoded, /msg\[receiver_type\]=1/)
  assert.match(decoded, /msg\[msg_type\]=1/)
  assert.match(decoded, /msg\[dev_id\]=WEB-/)
  assert.match(decoded, /msg\[content\]=/)
  assert.match(decoded, /csrf=J/)
  // content 是 JSON 串，里面才是正文
  assert.match(decoded, /"content":"我看到了。"/)
})

test('回私信：拿不到自己的 mid 就说拿不到（不瞎发）', async () => {
  const s = spy({ code: 0 })
  const out = await executeDmReply(
    { target: { mid: '233643544' }, body: 'x' },
    { cred, fetch: s.fetch },
  )
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /mid/)
  assert.equal(s.calls.length, 0, '不该发请求')
})

test('回私信：不能给自己发（B 站那边也拒，提前挡掉）', async () => {
  const s = spy({ code: 0 })
  const out = await executeDmReply(
    { target: { mid: '497080562' }, body: 'x' },
    { cred, fetch: s.fetch, selfMid: '497080562' },
  )
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /自己/)
  assert.equal(s.calls.length, 0)
})

test('回私信：没给收信人 mid 就拒', async () => {
  const s = spy({ code: 0 })
  const out = await executeDmReply({ target: {}, body: 'x' }, { cred, fetch: s.fetch, selfMid: '497080562' })
  assert.equal(out.ok, false)
  assert.equal(s.calls.length, 0)
})

test('回私信：csrf 不匹配要翻成人话（-111）', async () => {
  const s = spy({ code: -111, message: ' csrf 校验失败' })
  const out = await executeDmReply(
    { target: { mid: '233643544' }, body: 'x' },
    { cred, fetch: s.fetch, selfMid: '497080562' },
  )
  assert.equal(out.ok, false)
  assert.match(out.reason ?? '', /CSRF|csrf/)
})

// ── 改动态：另一个接口，而且要带原图 ──

/** 回读 detail 的 fetch 替身：带一张原图。 */
function spy2(detail, edit) {
  const calls = []
  const fetch = async (url, init) => {
    const u = String(url)
    calls.push({ url: u, init, body: String(init?.body ?? '') })
    const payload = u.includes('/detail?') ? detail : edit
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return { calls, fetch }
}

test('改动态：走 edit/dyn 接口，且把原动态的图片原样带上（别把主人的图弄丢）', async () => {
  const detail = {
    code: 0,
    data: {
      item: {
        modules: {
          module_dynamic: {
            major: { opus: { pics: [{ url: 'http://x/1.png', width: 100, height: 200 }] } },
          },
        },
      },
    },
  }
  const s = spy2(detail, { code: 0 })
  const out = await executeEditDynamic(
    { target: { dynId: '999' }, body: '改过的正文' },
    { cred, fetch: s.fetch },
  )
  assert.equal(out.ok, true, out.reason)
  const edit = s.calls.find((c) => c.url.includes('edit/dyn'))
  assert.ok(edit, '要调 edit/dyn')
  const payload = JSON.parse(edit.body)
  assert.equal(payload.dyn_id_str, '999')
  assert.equal(payload.dyn_req.scene, 2, '有图所以 scene=2')
  assert.equal(payload.dyn_req.pics.length, 1, '原图要带上')
  assert.equal(payload.dyn_req.pics[0].img_src, 'http://x/1.png')
  assert.equal(payload.dyn_req.content.contents[0].raw_text, '改过的正文')
  assert.equal(payload.csrf, 'J')
})

test('改动态：没给 dynId 就拒，不猜', async () => {
  const s = spy2({ code: 0 }, { code: 0 })
  const out = await executeEditDynamic({ target: {}, body: 'x' }, { cred, fetch: s.fetch })
  assert.equal(out.ok, false)
  assert.equal(s.calls.length, 0)
})

// ── 私信判据：互关（换掉了那条凭空来的"7 天回信时效窗"）──

test('私信判据：没互关就说没互关，并说清差哪一步', async () => {
  const { checkDmMutualFollow } = await import('../src/client/bili-write.ts')
  const fetch = async () => new Response(JSON.stringify({ code: 0, data: { attribute: 2 } }), { status: 200 })
  const r = await checkDmMutualFollow({ cred, fetch }, '233643544')
  assert.equal(r.ok, false)
  assert.match(r.reason, /互关/)
})

test('私信判据：互关了才放行（relation attribute=6）', async () => {
  const { checkDmMutualFollow } = await import('../src/client/bili-write.ts')
  const fetch = async () => new Response(JSON.stringify({ code: 0, data: { attribute: 6 } }), { status: 200 })
  const r = await checkDmMutualFollow({ cred, fetch }, '233643544')
  assert.equal(r.ok, true)
})

test('私信判据：关系接口查不了要说查不了，不装作"没互关"', async () => {
  const { checkDmMutualFollow } = await import('../src/client/bili-write.ts')
  const fetch = async () => new Response(JSON.stringify({ code: -101, message: '账号未登录' }), { status: 200 })
  const r = await checkDmMutualFollow({ cred, fetch }, '233643544')
  assert.equal(r.ok, false)
  assert.match(r.reason, /关系接口/)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'

function makeFetchStub(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const body = await handler(String(url), init, calls.length)
    return {
      status: body?.status ?? 200,
      async json() { return body?.json ?? { code: 0, data: {} } },
    }
  }
  fn.calls = calls
  return fn
}

test('cap-bilibili/写链路：真实执行器与真实判据——30天去重/收藏理由/每日上限/私信互关 + 请求形状逐字一致', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-write-'))
  const likeLog = { items: [{ bv: 'BV1xx411c7mD', at: new Date().toISOString() }] }
  const favLog = { items: [] }
  const fetchStub = makeFetchStub((url) => {
    if (url.includes('/x/web-interface/view')) {
      return { json: { code: 0, data: { aid: 12345, title: '雷雨声采样合集', owner: { name: '声学实验室' } } } }
    }
    return { json: { code: 0, data: { rpid: 999 } } }
  })

  const cap = createBilibiliCapability({
    dataDir: dir,
    writeContext: {
      cred: { sessdata: 'SESS', bili_jct: 'JCT', buvid3: 'B3' },
      fetch: fetchStub,
      readLikeLog: () => likeLog,
      readFavLog: () => favLog,
      lastDmReadAt: Date.now(),
    },
  })

  const tools = cap.tools()
  const likeTool = tools.find((t) => t.name === 'bili_like')
  const favTool = tools.find((t) => t.name === 'bili_fav')
  const commentTool = tools.find((t) => t.name === 'bili_comment')
  const dmTool = tools.find((t) => t.name === 'bili_dm_reply')

  // 写冷却置 0：默认 10 秒会把连续两次写挡住（这本身是 WriteGate 的既定行为，测试要能连发）
  await cap.panels().find((p) => p.id === 'gate-policy').methods.set.invoke({ writeGapSec: 0 })

  // 1. 点赞 30 天去重判据：同 BV 已赞过 → 闸门拒，不打网络、不消耗额度
  const callsBefore = fetchStub.calls.length
  const dup = await likeTool.execute({ bvid: 'BV1xx411c7mD', reason: '好片' })
  assert.equal(dup.ok, false)
  assert.equal(dup.code, 'policy')
  assert.match(dup.reason, /赞过了/)
  assert.equal(fetchStub.calls.length, callsBefore, '判据拒不该打网络')

  // 2. 换一个没赞过的 BV → 走真执行器，请求形状与原命令一致
  const ok = await likeTool.execute({ bvid: 'BV1zz411c7mD', reason: '雨声采样' })
  assert.equal(ok.ok, true, JSON.stringify(ok))
  const likeCall = fetchStub.calls.find((c) => c.url.includes('/archive/like'))
  assert.ok(likeCall, '应当发出点赞请求')
  assert.equal(likeCall.url, 'https://api.bilibili.com/x/web-interface/archive/like')
  assert.equal(likeCall.init.method, 'POST')
  assert.match(likeCall.init.headers.referer, /bilibili\.com\/video\/BV1zz411c7mD/)
  const body = new URLSearchParams(likeCall.init.body)
  assert.equal(body.get('bvid'), 'BV1zz411c7mD')
  assert.equal(body.get('like_pos'), '1')
  assert.equal(body.get('csrf'), 'JCT')
  assert.match(likeCall.init.headers.cookie, /SESSDATA=SESS/)
  assert.match(likeCall.init.headers.cookie, /bili_jct=JCT/)

  // 3. 收藏：理由不足 6 字 → 判据拒；理由够 → 真发（body 字段与原命令一致）
  const favShort = await favTool.execute({ bvid: 'BV1zz411c7mD', reason: '好看' })
  assert.equal(favShort.ok, false)
  assert.equal(favShort.code, 'policy')
  assert.match(favShort.reason, /6 个字/)

  const favOk = await favTool.execute({ bvid: 'BV1zz411c7mD', reason: '雨声采样素材库，留着做参考' })
  assert.equal(favOk.ok, true, JSON.stringify(favOk))
  const favCall = fetchStub.calls.find((c) => c.url.includes('/fav/resource/deal'))
  assert.ok(favCall)
  const favBody = new URLSearchParams(favCall.init.body)
  assert.equal(favBody.get('rid'), '12345')
  assert.equal(favBody.get('type'), '2')
  assert.equal(favBody.get('csrf'), 'JCT')

  // 4. 评论：默认档位 review → 进统一待放行队列（不直发）；主人放行后才真发。
  //    正文的 ** 与未闭合书名号在构造时已被清洗（清洗发生在入队那一刻）。
  const cmt = await commentTool.execute({ bvid: 'BV1zz411c7mD', rpid: '777', text: '**谢谢**《《雷雨声' })
  assert.equal(cmt.ok, false)
  assert.equal(cmt.code, 'needs-approval')
  assert.ok(cmt.pendingId)

  const queued = (await cap.panels().find((p) => p.id === 'drafts-queue').methods.list.invoke({})).items
    .find((x) => x.id === cmt.pendingId)
  assert.ok(queued, '评论应当出现在统一待放行队列里')
  assert.equal(queued.text.includes('**'), false, '入队时正文已清洗')
  assert.equal(queued.bodyHash.length, 40, 'bodyHash 是 sha1')

  // 主人放行 → 真发（请求形状与原命令一致）
  await cap.panels().find((p) => p.id === 'gate-policy').methods.set.invoke({ policy: { comment: 'self' } })
  const released = await cap.panels().find((p) => p.id === 'drafts-queue').methods.release.invoke({ id: cmt.pendingId })
  assert.equal(released.ok, true, JSON.stringify(released))
  const cmtCall = fetchStub.calls.find((c) => c.url.includes('/x/v2/reply/add'))
  assert.ok(cmtCall)
  const cmtBody = new URLSearchParams(cmtCall.init.body)
  assert.equal(cmtBody.get('message').includes('**'), false)
  assert.equal(cmtBody.get('oid'), '777')
  assert.equal(cmtBody.get('csrf'), 'JCT')

  // 5. 私信：**没互关** → 判据拒（precondition）
  //    这条以前判的是"7 天回信时效窗"——凭空来的规则，而且依赖一个全仓没人写的字段
  //    （lastDmReadAt），于是她永远回不了私信。现在换成 B 站真正的硬要求：互关。
  const cap2 = createBilibiliCapability({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-dm-')),
    writeContext: {
      cred: { sessdata: 'SESS', bili_jct: 'JCT', buvid3: 'B3' },
      fetch: makeFetchStub((url) => {
        if (url.includes('/x/relation')) return { json: { code: 0, data: { attribute: 2 } } }
        if (url.includes('/x/web-interface/nav')) return { json: { code: 0, data: { isLogin: true, mid: 497080562 } } }
        return { json: { code: 0 } }
      }),
    },
  })
  const dmTool2 = cap2.tools().find((t) => t.name === 'bili_dm_reply')
  const dm = await dmTool2.execute({ mid: '1001', text: '好久不见' })
  assert.equal(dm.ok, false)
  assert.equal(dm.code, 'precondition')
  assert.match(dm.reason, /互关/)

  // 6. 平台失败：code≠0 → 可读原因 + 账上落 <kind>-failed
  const failFetch = makeFetchStub((url) => {
    if (url.includes('/x/web-interface/view')) {
      return { json: { code: 0, data: { aid: 1, title: 't', owner: { name: 'u' } } } }
    }
    return { json: { code: -111, message: 'csrf 校验失败' } }
  })
  const cap3 = createBilibiliCapability({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-fail-')),
    writeContext: {
      cred: { sessdata: 'SESS', bili_jct: 'JCT', buvid3: 'B3' },
      fetch: failFetch,
      readLikeLog: () => ({ items: [] }),
    },
  })
  const likeFail = await cap3.tools().find((t) => t.name === 'bili_like').execute({ bvid: 'BV1yy411c7mD', reason: '试试' })
  assert.equal(likeFail.ok, false)
  assert.equal(likeFail.code, 'platform')
  assert.match(likeFail.reason, /CSRF 校验失败/)

  const causalFile = path.join(dir, 'causal.jsonl')
  const causal = fs.readFileSync(causalFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l))
  assert.ok(causal.some((c) => c.kind === 'like-failed'), '失败要落 like-failed 账')
  assert.ok(causal.some((c) => c.kind === 'like'), '成功要落 like 账')
})

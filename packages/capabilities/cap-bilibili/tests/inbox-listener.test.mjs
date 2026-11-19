/**
 * 收件箱监听器（耳朵）的凭据测试。
 *
 * 这一批要修的是迁移落下的一环：能力包有收件箱**存储**、有她自愿去调的**读工具**，
 * 却没有任何东西往里写——`ingestItems()` 的调用者全仓只剩一个测试，
 * `bili-account.inbox` 事件在 describe.json 里声明了却从没发出过。
 * 她于是整天又聋又哑：226 笔自主行动、零次读收件箱。
 *
 * 这里钉的是旧实现用事故换来的几条规矩（文件头有出处）：
 *   ① 首轮只建基线，不把历史全倒进她眼前；
 *   ② 窗口外不消耗间隔、不计失败；
 *   ③ 她自己的私信不能叫醒她自己（缺 mid 时私信这一路直接跳过）；
 *   ④ 单路挂了要留 sourceFails，不能静默；
 *   ⑤ 空信箱 messages:null 不算失败（旧事故 bb263b8）。
 *
 * 另有两条是 2026-11-06 **拿真凭据实读 B 站**读出来的（scripts/verify-inbox-live.mjs）：
 *   ⑬ 「收到的赞」的真实形状是 `data.latest.items` + `data.total.items`（一条=一批人赞同一物），
 *      不是 `data.items[].notices`——按后者解永远 0 条，而 0 条看起来像"真没人赞她"；
 *   ⑭ 身份（她是谁 / 主人是谁）必须由 nav 或绑定给出，缺了就明着跳过。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'
import { pullInbox } from '../src/client/bili-inbox.ts'

const OWNER = '233643544'
const SELF = '497080562'

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'bili-listen-'))
}

/** 可编排的 B 站桩：每一路给什么、坏没坏，由用例说话。 */
function stubFeed(state) {
  const calls = []
  const reply = (url, body) => calls.push(url)
  const impl = async (url) => {
    reply(url)
    if (state.failAll) return { json: async () => { throw new Error('fetch failed') } }
    if (url.includes('/x/msgfeed/reply')) {
      if (state.replyCode) return { json: async () => ({ code: state.replyCode, message: '风控' }) }
      return { json: async () => ({ code: 0, data: { last_view_at: state.lastView ?? 0, items: state.reply ?? [] } }) }
    }
    if (url.includes('/x/msgfeed/at')) {
      return { json: async () => ({ code: 0, data: { items: state.at ?? [] } }) }
    }
    if (url.includes('/x/msgfeed/like')) {
      // 形状按 2026-11-06 实测：{ latest:{items}, total:{items} }，没有 data.items
      if (state.likeOldShape) {
        return { json: async () => ({ code: 0, data: { items: [{ timestamp: 1, notices: [{ id: 'n1' }] }] } }) }
      }
      return {
        json: async () => ({
          code: 0,
          data: { latest: { items: state.likeGroups ?? [] }, total: { items: state.likeTotal ?? [] } },
        }),
      }
    }
    if (url.includes('get_sessions')) {
      return { json: async () => ({ code: 0, data: { session_list: state.sessions ?? [{ talker_id: Number(OWNER), unread_count: 1 }] } }) }
    }
    if (url.includes('fetch_session_msgs')) {
      return { json: async () => ({ code: 0, data: { messages: state.dmMessages ?? [] } }) }
    }
    // nav（补 mid 用）——用例给什么身份就回什么身份
    return { json: async () => ({ code: 0, data: { isLogin: true, mid: Number(state.navMid ?? SELF), uname: '恐怖深海鱼' } }) }
  }
  return { impl, calls }
}

function replyItem(id, { t, mid = '9001', who = '观众乙', target = '', source = '', title = '' }) {
  return {
    id,
    reply_time: t,
    user: { mid: Number(mid), nickname: who },
    item: {
      ...(target ? { target_reply_content: target } : {}),
      ...(source ? { source_content: source } : {}),
      ...(title ? { title } : {}),
      subject_id: 'BV1aaBBccDD1',
      root_id: '777',
      uri: 'https://www.bilibili.com/video/BV1aaBBccDD1',
    },
  }
}

function mkCap(t, { state, listen, now = Date.UTC(2026, 10, 6, 4, 0, 0), extra = {} }) {
  const home = tmp()
  const stub = stubFeed(state)
  const events = []
  const logs = []
  // 时钟是个**数值**（不是函数）：以前这里塞了个函数，所有时间比较都变 NaN，
  // 间隔判断整条失效——测试看着像逻辑坏了，其实是桩写错。
  let clock = now
  const cap = createBilibiliCapability({
    dataDir: path.join(home, 'data', 'bilibili'),
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stub.impl },
    ownerMid: OWNER,
    selfMidHint: SELF,
    listenConfig: () => listen ?? {},
    listenNow: () => clock,
    listenAutoStart: false,
    ...extra,
  })
  cap.start({
    homeDir: home,
    dataDir: path.join(home, 'data', 'bilibili'),
    workspaceDir: home,
    pushEvent: (e) => events.push(e),
    log: (level, msg, data) => logs.push({ level, msg, data }),
  })
  t.after(async () => { await cap.stop() })
  return { cap, home, stub, events, logs, setNow: (v) => { clock = v }, getNow: () => clock }
}

test('①首轮只建基线：历史一条都不叫醒她（旧规矩：不把旧回复全倒一遍）', async (t) => {
  const { cap, stub } = mkCap(t, {
    state: { reply: [replyItem('r1', { t: 1762000000, target: '老早以前的一条回复' })], lastView: 1762000000 },
    listen: { comment: true, dm: false },
  })
  const out = await cap.pollListenOnce()
  assert.equal(out[0].ran, true, '这一拍确实去拉了')
  assert.equal(out[0].baseline, true, '首轮标成基线')
  assert.deepEqual(out[0].fresh ?? [], [], '基线轮不该有"新鲜"条目')
  assert.equal(stub.calls.filter((c) => c.includes('/x/msgfeed/reply')).length, 1)
})

test('②第二轮真有新东西：进存储 + 发出 bili-account.inbox（声明很久、第一次真发）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const state = { reply: [], lastView: Math.floor(base / 1000) }
  const { cap, events, setNow } = mkCap(t, { state, listen: { comment: true, dm: false } })

  await cap.pollListenOnce() // 建基线
  assert.equal(events.length, 0, '基线轮不该有事件')

  const laterSec = Math.floor(base / 1000) + 300
  state.reply = [replyItem('r2', { t: laterSec, target: '这段雨声分析太细了' })]
  setNow(base + 61_000)
  const out = await cap.pollListenOnce()
  assert.equal(out[0].fresh.length, 1, '第二条该算新鲜')

  const ev = events.find((e) => e.type === 'bili-account.inbox')
  assert.ok(ev, 'bili-account.inbox 必须真的发出来（describe.json 里早就声明了）')
  assert.match(ev.text, /有人找她/)
  assert.match(ev.text, /这段雨声分析太细了/)
  assert.equal(ev.meta.count, 1)

  // 存储也真的落了——她什么时候去读收件箱都在
  const unread = cap.store.listInbox({ unreadOnly: true })
  assert.equal(unread.length, 1)
  assert.equal(unread[0].kind, 'reply')
})

test('③同一条不重复叫醒：key 撞了就只算一次（翻页重叠是实测每条两遍）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const laterSec = Math.floor(base / 1000) + 600
  const state = { reply: [], lastView: Math.floor(base / 1000) }
  const { cap, events, setNow } = mkCap(t, { state, listen: { comment: true, dm: false } })

  await cap.pollListenOnce()               // 基线（此时还没东西）
  state.reply = [replyItem('r3', { t: laterSec, target: '同一条回复' })]
  setNow(base + 61_000)
  const first = await cap.pollListenOnce() // r3 比基线新 → 叫醒
  setNow(base + 122_000)                   // 间隔到点，再拉一次（同一条还在）
  const second = await cap.pollListenOnce() // 同一条 → 不该再叫醒
  assert.equal(first[0].fresh.length, 1, '第一次该叫醒')
  assert.equal(second[0].fresh?.length ?? 0, 0, '同一条不该叫醒第二次')
  assert.equal(events.filter((e) => e.type === 'bili-account.inbox').length, 1)
})

test('④她自己的私信绝不叫醒她自己：缺 mid 时私信这一路直接跳过（自激循环防线）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const sec = Math.floor(base / 1000)
  // 信箱里只有一条——是她自己发的
  const state = {
    dmMessages: [
      { sender_uid: Number(SELF), msg_type: 1, content: JSON.stringify({ content: '我自己回的' }), msg_seqno: 11, timestamp: sec + 40 },
    ],
  }
  const { cap, events, setNow } = mkCap(t, { state, listen: { comment: false, dm: true } })
  await cap.pollListenOnce() // 基线
  setNow(base + 151_000)
  const out = await cap.pollListenOnce()
  assert.equal(out[0].fresh.length, 0, '她自己发的不该算新私信')
  assert.equal(events.filter((e) => e.type === 'bili-account.inbox').length, 0, '一次都不该被自己叫醒')

  // 身份没落到账上 → 这一路明说跳过，而不是硬拉
  const cap2 = mkCap(t, {
    state: { ...state, dmMessages: [{ sender_uid: Number(OWNER), msg_type: 1, content: JSON.stringify({ content: '主人说话' }), msg_seqno: 12, timestamp: sec + 40 }] },
    listen: { comment: false, dm: true },
    now: base,
    extra: { selfMidHint: undefined, ownerMid: undefined },
  })
  await cap2.cap.pollListenOnce()
  const r2 = await cap2.cap.pollListenOnce()
  assert.equal(r2[0].ran, false, '没有 selfMid 时私信这一路不该去拉')
  assert.match(r2[0].reason, /mid/, '跳过要说清为什么，不许静默')
})

test('⑤单路挂了不静默：sourceFails 进回执与事件正文，坏的那路自己说为什么', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const state = { reply: [], lastView: Math.floor(base / 1000) }
  const { cap, events, setNow } = mkCap(t, { state, listen: { comment: true, dm: false, scope: 'both' } })
  await cap.pollListenOnce() // 基线
  // 「回复我的」这一路被风控（code=-352），@我 这一路照常
  state.replyCode = -352
  state.at = [{
    id: 'a1',
    at_time: Math.floor(base / 1000) + 200,
    user: { mid: 9002, nickname: '观众丙' },
    item: { target_reply_content: '这条是被 @ 的', subject_id: 'BV1aaBBccDD1' },
  }]
  setNow(base + 61_000)
  const out = await cap.pollListenOnce()
  assert.ok(out[0].sourceFails?.length, '坏的那路要留账')
  const reply = out[0].sourceFails.find((f) => f.source === 'reply')
  assert.ok(reply, '要指名是 reply 这一路')
  assert.match(reply.why, /code=-352/, '要带上 B 站回的错误码，好分清"该等"与"坏了"')
  assert.equal(out[0].fresh.length, 1, '另一路正常就该照常把她叫醒')
  const ev = events.find((e) => e.type === 'bili-account.inbox')
  assert.match(ev.text, /有路数没拉到/, '事件正文里也要看得见坏的那一路')
})

test('⑥正文优先级：target_reply_content > source_content > title（title 不可靠是实测踩的）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const sec = Math.floor(base / 1000)
  const state = { reply: [], lastView: sec }
  const { cap, setNow } = mkCap(t, { state, listen: { comment: true, dm: false } })
  await cap.pollListenOnce() // 空信箱建基线（首轮按规矩不倒历史，也不会进存储）

  // 三个字段同时有内容，且只有 target 才是"他这次新写的"
  state.reply = [replyItem('r7', {
    t: sec + 90,
    target: '这句才是他新写的',
    source: '我原先那条',
    title: '同一条 title 出现在好几种回复上',
  })]
  setNow(base + 61_000)
  const out = await cap.pollListenOnce()
  assert.equal(out[0].fresh.length, 1, '基线之后的新回复该叫醒她')
  const items = cap.store.listInbox({})
  assert.equal(items.length, 1)
  assert.equal(items[0].text, '这句才是他新写的', '正文必须取 target_reply_content，不能被 title 带跑')
})

test('⑦空信箱 messages:null 不算失败（旧事故 bb263b8：null 被当成读取失败）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const state = { dmMessages: null }
  const { cap, logs, setNow } = mkCap(t, { state, listen: { comment: false, dm: true } })
  await cap.pollListenOnce()
  setNow(base + 151_000)
  const out = await cap.pollListenOnce()
  assert.equal(out[0].ran, true, '空信箱也要正常跑完这一拍')
  assert.deepEqual(out[0].fresh ?? [], [], '没有消息就没有新鲜条目')
  assert.ok(!logs.some((l) => /失败|fail/i.test(l.msg) && l.level === 'warn'), '空信箱不该记成失败')
})

test('⑧间隔与退避：没到间隔不去敲；连败之后间隔翻倍（接口经不起每 2 秒锤）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const state = { reply: [], lastView: Math.floor(base / 1000) }
  const { cap, stub, setNow } = mkCap(t, { state, listen: { comment: true, commentIntervalSec: 60, dm: false } })

  await cap.pollListenOnce() // t=基线，拉了一次
  const n1 = stub.calls.filter((c) => c.includes('/x/msgfeed/reply')).length
  setNow(base + 30_000)
  const tooSoon = await cap.pollListenOnce()
  assert.equal(tooSoon[0].ran, false, '间隔未到不该拉')
  assert.equal(tooSoon[0].reason, '间隔未到')
  assert.equal(stub.calls.filter((c) => c.includes('/x/msgfeed/reply')).length, n1, '没到间隔一次都不许多敲')

  // 让它失败一次，再看退避后的间隔变长
  setNow(base + 61_000)
  state.replyCode = -352
  await cap.pollListenOnce() // 这一次挂了：连败 1 → 下次间隔翻倍到 120s
  assert.equal(cap.listenStatus().commentFailures, 1, '失败要记进连败')
  state.replyCode = 0
  setNow(base + 61_000 + 60_000) // 原间隔到了，但退避后的 120s 还没到
  const early = await cap.pollListenOnce()
  assert.equal(early[0].ran, false, '退避期内不该敲（连败 1 次 = 120s，不是 60s）')
  setNow(base + 61_000 + 121_000)
  const r = await cap.pollListenOnce()
  assert.equal(r[0].ran, true, '退避到点该再试一次')
  assert.equal(cap.listenStatus().commentFailures, 0, '成功了连败要归零')
})

test('⑨窗口外不消耗间隔、不计失败（旧代码为此专门写了两行 return）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const state = { reply: [], lastView: Math.floor(base / 1000) }
  let inWindow = false
  const { cap } = mkCap(t, {
    state,
    listen: { comment: true, dm: false, allDay: false },
    extra: { inWindow: () => inWindow },
  })
  const r = await cap.pollListenOnce()
  assert.equal(r[0].ran, false)
  assert.equal(r[0].reason, '窗口外')
  assert.equal(cap.listenStatus().commentFailures, 0, '窗口外不算失败')

  inWindow = true
  const r2 = await cap.pollListenOnce()
  assert.equal(r2[0].ran, true, '窗口一开就该马上能拉，不用再等一整个间隔')
})

test('⑩拉黑的人不进账：blocked uid 在存储层就挡掉（她眼前不会重复出现同一个人）', async (t) => {  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const state = {
    reply: [replyItem('r10', { t: Math.floor(base / 1000) + 90, mid: '666', who: '广告号', target: '来看抽奖' })],
    lastView: Math.floor(base / 1000),
  }
  const { cap, home, events, setNow } = mkCap(t, { state, listen: { comment: true, dm: false } })
  await cap.pollListenOnce()
  // 屏蔽名单直接落到存储文件（与面板 block_user 写的是同一份账）
  fs.writeFileSync(
    path.join(home, 'data', 'bilibili', 'blocked-uids.json'),
    JSON.stringify(['666']),
    'utf8',
  )
  state.reply = [replyItem('r11', { t: Math.floor(base / 1000) + 400, mid: '666', who: '广告号', target: '又来了' })]
  setNow(base + 300_000)
  const out = await cap.pollListenOnce()
  assert.equal(out[0].fresh.length, 0, '拉黑的 uid 不该进她眼前')
  assert.equal(events.filter((e) => e.type === 'bili-account.inbox').length, 0)
})

test('⑪启动补齐 mid 的纪律：没凭据一次网络都不敲；有凭据只补一次（与「连接」页同口径）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const sec = Math.floor(base / 1000)

  // A：凭据在、mid 未知 → 启动补一次 nav，私信这一路就能用了
  const stateA = { dmMessages: [] }
  const a = mkCap(t, {
    state: stateA,
    listen: { comment: false, dm: true, dmIntervalSec: 150 },
    extra: { selfMidHint: undefined, listenAutoStart: true },
  })
  await new Promise((r) => setTimeout(r, 10))
  const navCalls = a.stub.calls.filter((c) => c.includes('/x/web-interface/nav'))
  assert.equal(navCalls.length, 1, '补齐 mid 只敲一次 nav')

  a.setNow(base)
  await a.cap.pollListenOnce() // 空信箱建基线
  stateA.dmMessages = [
    { sender_uid: Number(OWNER), msg_type: 1, content: JSON.stringify({ content: '主人：今天听得见吗' }), msg_seqno: 31, timestamp: sec + 30 },
  ]
  a.setNow(base + 151_000)
  const ta = await a.cap.pollListenOnce()
  assert.equal(ta[0].ran, true, 'mid 补齐后私信这一路该开')
  assert.equal(ta[0].fresh.length, 1, '主人的私信该送到她面前')

  // B：没凭据 → 一次都不敲（这条和「连接」页"缺 SESSDATA 不动手、也不去问 B 站"是同一条规矩）
  const b = mkCap(t, {
    state: { dmMessages: [] },
    listen: { comment: false, dm: true },
    extra: { selfMidHint: undefined, listenAutoStart: true, readContext: { cred: { sessdata: '', bili_jct: '', buvid3: '' }, fetch: () => { throw new Error('不该有网络请求') } } },
  })
  await new Promise((r) => setTimeout(r, 10))
  const rb = await b.cap.pollListenOnce()
  assert.equal(rb[0].ran, false, '没凭据没身份时私信这一路不开')
  assert.match(rb[0].reason, /mid/, '不开要说清为什么')
})

test('⑫换 cookie 等于换身份：绑定成功后 mid 跟着走（自激剔除不能拿旧 mid）', async (t) => {
  const base = Date.UTC(2026, 10, 6, 4, 0, 0)
  const home = tmp()
  const credFile = path.join(home, '.env')
  fs.writeFileSync(credFile, 'SOME_OTHER_KEY=keep-me\n', 'utf8') // 还没绑定
  // 新绑定的号是 777（不是测试常量 SELF）——要证明用的是**这次绑定**拿到的 mid
  const state = { navMid: '777', dmMessages: [] }
  const { cap, setNow } = mkCap(t, {
    state,
    listen: { comment: false, dm: true, dmIntervalSec: 150 },
    extra: {
      selfMidHint: undefined,
      readContext: undefined, // 走真实的"活凭据"路径：每次现读 credentialsFile
      credentialsFile: credFile,
      fetch: stubFeed(state).impl,
      listenAutoStart: false, // 启动不补齐，模拟"启动时还没 cookie"
    },
  })
  const panel = cap.panels().find((p) => p.id === 'connection')

  setNow(base)
  const before = await cap.pollListenOnce()
  assert.equal(before[0].ran, false, '没身份时这一路不开')

  const bound = await panel.methods.bindCookie.invoke({ sessdata: 'NEW', confirm: true })
  assert.equal(bound.ok, true, '绑定本身要成功')
  assert.equal(bound.identity.mid, '777', 'nav 回的是新号')

  setNow(base + 151_000)
  const after = await cap.pollListenOnce()
  assert.equal(after[0].ran, true, '绑定后不需要重启就该开始收私信')

  // 真正的一条：新号自己发的私信不能把她叫醒（拿旧 mid 过滤就会漏这一步）
  state.dmMessages = [
    { sender_uid: 777, msg_type: 1, content: JSON.stringify({ content: '我自己回的' }), msg_seqno: 41, timestamp: Math.floor(base / 1000) + 400 },
  ]
  setNow(base + 302_000)
  const own = await cap.pollListenOnce()
  assert.equal(own[0].ran, true)
  assert.equal(own[0].fresh.length, 0, '她自己（新绑的那个号）发的不该算新私信')
})

/** 真凭据实测（2026-11-06）：`data.latest.items` + `data.total.items`，一条 = 一批人赞了同一个东西。 */
const likeGroup = (id, t, over = {}) => ({
  id,
  like_time: t,
  counts: over.users?.length ?? 1,
  users: over.users ?? [{ mid: 9001, nickname: '观众乙' }],
  item: over.item ?? { title: '雨声采集：第三章', subject_id: 'BV1aaBBccDD1' },
})

test('⑬「收到的赞」按实测形状解：latest + total 并起来、按 id 去重、时间用 like_time', async () => {
  const t0 = 1762500000
  const stub = stubFeed({
    likeGroups: [likeGroup('L1', t0, {
      users: [{ mid: 9001, nickname: '观众乙' }, { mid: 9002, nickname: '观众丙' }],
    })],
    likeTotal: [
      likeGroup('L1', t0), // total 里把同一条又报了一遍（实测就是会重叠）
      likeGroup('L2', t0 + 60, { users: [{ mid: Number(OWNER), nickname: '鱼片' }] }),
    ],
  })
  const ctx = { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stub.impl }
  const r = await pullInbox(ctx, { selfMid: SELF, ownerMid: OWNER }, { include: ['like'] })
  assert.equal(r.items.length, 2, '重叠的同一条只算一次，两条不同的都要在')
  const l1 = r.items.find((x) => x.key === 'like:L1')
  assert.equal(l1.atMs, t0 * 1000, '时间取 like_time（秒→毫秒）')
  assert.match(l1.who, /观众乙/)
  assert.match(l1.who, /等 2 人/, '一批人赞同一条：人数要说出来')
  assert.match(l1.text, /赞了「雨声采集：第三章」/)
  assert.equal(l1.ref.bvid, 'BV1aaBBccDD1')
  assert.deepEqual(r.sourceFails, [], '0 条失败就是 0 条失败')
})

test('⑭旧形状不认：items[].notices 解不出任何赞（"解析没吃到"与"真没人赞"靠探针分开，不靠猜）', async () => {
  const stub = stubFeed({ likeOldShape: true })
  const ctx = { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stub.impl }
  const r = await pullInbox(ctx, { selfMid: SELF, ownerMid: OWNER }, { include: ['like'] })
  assert.equal(r.items.length, 0, '没 like_time/id 的一律不吃：吃了会把监听基线推到假时间上')
  assert.equal(r.sourceFails.length, 0, '这一路本身是通的，不是坏了')
})

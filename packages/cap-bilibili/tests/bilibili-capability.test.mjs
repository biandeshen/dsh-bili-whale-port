import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBiliWorldAdapter } from '../../cortico-world-bilibili/src/index.ts'

test('cap-bilibili & cortico-world-bilibili：四路收件箱指派、统一待放行在线改稿自动续签哈希、WriteGate 七步把关链全闭环', async () => {
  const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-'))
  const executedActions = []
  const pushedEvents = []

  const world = createBiliWorldAdapter({
    homeDir,
    writeExecutor: async (action) => {
      executedActions.push(action)
      return { ok: true, dynId: 'dyn-' + executedActions.length, rpid: 'rpid-' + executedActions.length }
    },
  })

  assert.equal(world.id, 'bili-account')
  assert.equal(world.api, 6)
  assert.equal(world.panels().length, 4)
  assert.equal(world.tools().length, 16)

  world.start({
    homeDir,
    dataDir: path.join(homeDir, 'data', 'bilibili'),
    workspaceDir: path.join(homeDir, 'workspace'),
    pushEvent: (ev) => pushedEvents.push(ev),
    log: () => {},
  })

  // 1. 四路收件箱合一（dm / reply / mention / like）+ 10位秒时间戳自动转13位毫秒 + 主人指派回复/忽略/拉黑
  world.capability.store.ingestItems([
    { key: 'dm-1', kind: 'dm', uid: '1001', who: '路人甲', text: '小鱼你好呀', atMs: 1762000000 }, // 10位秒
    { key: 'reply-1', kind: 'reply', uid: '1002', who: '观众乙', text: '这段雨声分析太细了', atMs: 1762000100, ref: { bvid: 'BV1xx411c7mD' } },
    { key: 'at-1', kind: 'mention', uid: '1003', who: '广告号', text: '来看我的抽奖', atMs: 1762000200 },
    { key: 'like-1', kind: 'like', uid: '1004', who: '老粉丁', text: '赞了你的动态', atMs: 1762000300 },
  ])

  const inboxAll = await world.invokePanel('inbox', 'list', { kind: 'all', unreadOnly: true })
  assert.equal(inboxAll.ok, true)
  assert.equal(inboxAll.unreadCount, 4)
  // 确认 10 位秒已转为 13 位毫秒
  assert.ok(inboxAll.items.every((x) => x.atMs > 1e12))

  // 主人指派她回复评论 reply-1，自动推送唤醒事件
  const assignReply = await world.invokePanel('inbox', 'assignAction', {
    itemKey: 'reply-1',
    action: 'ask_her_reply',
    ownerHint: '礼貌谢谢对方，顺便聊聊雷雨采样',
  })
  assert.equal(assignReply.ok, true)
  assert.ok(pushedEvents.some((e) => e.type === 'bili-account.inbox_assigned' && e.text.includes('雷雨采样')))

  // 主人拉黑广告号 uid=1003，收件箱立即过滤该 UID
  await world.invokePanel('inbox', 'assignAction', { itemKey: 'at-1', action: 'block_user' })
  const afterBlock = await world.invokePanel('inbox', 'list', { kind: 'all' })
  assert.equal(afterBlock.items.some((x) => x.uid === '1003'), false)

  // 2. 评论与动态默认 review 档位 → 进统一待放行队列 → 主人在线改字（自动去粗体、重算 bodyHash 续签令牌）→ 放行成功
  const commentTool = world.tools().find((t) => t.name === 'bili_comment')
  const cRes = await commentTool.execute({
    bvid: 'BV1xx411c7mD',
    rpid: '8888',
    text: '**谢谢你**喜欢这段《《雷雨声分析》！',
  })
  assert.equal(cRes.ok, false)
  assert.equal(cRes.code, 'needs-approval')

  const qList1 = await world.invokePanel('drafts-queue', 'list', {})
  assert.equal(qList1.count, 1)
  const pendingId = qList1.items[0].id
  // plainOutbound 已经自动去掉了 ** 和嵌套书名号
  assert.equal(qList1.items[0].text.includes('**'), false)

  // 主人在面板上在线修改草稿文字（以前改一个字就会因 hash 不符被拒；现在自动重算 bodyHash 并续签 token）
  const updRes = await world.invokePanel('drafts-queue', 'updateDraft', {
    id: pendingId,
    text: '谢谢你喜欢这段《雷雨声》采样分析，那天录了很久。',
  })
  assert.equal(updRes.ok, true)

  // 把写间隔冷却设为 0 方便连续测试放行
  await world.invokePanel('gate-policy', 'set', { writeGapSec: 0 })

  const relRes = await world.invokePanel('drafts-queue', 'release', { id: pendingId })
  assert.equal(relRes.ok, true)
  assert.equal(executedActions.length, 1)
  assert.equal(executedActions[0].body, '谢谢你喜欢这段《雷雨声》采样分析，那天录了很久。')

  // 3. 打回重写（reject + askRewrite: true）→ 自动向她推送重写事件
  const dynTool = world.tools().find((t) => t.name === 'bili_dynamic_draft')
  const dRes = await dynTool.execute({ text: '今天看了一条无聊的视频。' })
  assert.equal(dRes.code, 'needs-approval')
  const rejRes = await world.invokePanel('drafts-queue', 'reject', {
    id: dRes.pendingId,
    reason: '写具体一点，写出是哪个分镜让你觉得无聊',
    askRewrite: true,
  })
  assert.equal(rejRes.ok, true)
  assert.ok(pushedEvents.some((e) => e.type === 'bili-account.draft_rejected' && e.text.includes('重新写一版')))

  // 4. 一键急刹 Kill 开关：开启后任何写动作（哪怕是直发档位 like）一律返回 exit -2 killed
  await world.invokePanel('gate-policy', 'set', { killOn: true })
  const likeTool = world.tools().find((t) => t.name === 'bili_like')
  const killedRes = await likeTool.execute({ bvid: 'BV1xx411c7mD', reason: '好片' })
  assert.equal(killedRes.ok, false)
  assert.equal(killedRes.code, 'killed')
  assert.equal(killedRes.exit, -2)

  // 关闭 Kill 后恢复正常，且 causal.jsonl 单点记账成功
  await world.invokePanel('gate-policy', 'set', { killOn: false })
  const likeOk = await likeTool.execute({ bvid: 'BV1xx411c7mD', reason: '好片' })
  assert.equal(likeOk.ok, true)
  const causalLines = fs.readFileSync(path.join(homeDir, 'data', 'bilibili', 'causal.jsonl'), 'utf8').trim().split('\n')
  assert.ok(causalLines.some((l) => JSON.parse(l).kind === 'comment'))
  assert.ok(causalLines.some((l) => JSON.parse(l).kind === 'like'))
})

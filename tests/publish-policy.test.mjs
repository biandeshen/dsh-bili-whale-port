// publish-policy：默认档 = 主人 2026-10-31 拍板的形态（review 草稿 / 点赞收藏自发 / 回信直发 / 不限速）。
// 任何一项默认值被改动都要在这里红——这是"配置语义的验收锁"，不是样式测试。
import test from 'node:test'
import assert from 'node:assert/strict'
import { POLICY_DEFAULTS, readPolicy, inWindow, capReached, tierQueues } from '../tools/lib/publish-policy.mjs'

test('空配置 = 全部落回拍板默认', () => {
  assert.deepEqual(readPolicy({}), {
    draftMode: 'review', autoDailyCap: 0, autoWindow: '', like: 'self', fav: 'self', dmReply: 'direct',
    comment: 'review', danmaku: 'review',
  })
  assert.deepEqual(readPolicy(undefined), readPolicy({}))
  assert.equal(POLICY_DEFAULTS.draftMode, 'review', '动态默认永远人工，auto 必须显式开')
  assert.equal(POLICY_DEFAULTS.comment, 'review', '评论默认等主人放行（与 11-03 之前的行为一致）')
  assert.equal(POLICY_DEFAULTS.danmaku, 'review', '弹幕默认等主人放行（与 11-03 之前的行为一致）')
})

test('非法值不越权：cap 负数/字符串、乱时窗、野模式都收敛', () => {
  const p = readPolicy({ publish: { draftMode: 'yolo', autoDailyCap: -5, autoWindow: '白天' }, permissions: { like: 'both', dmReply: 'whatever', comment: 'yolo', danmaku: 'true' } })
  assert.deepEqual(p, { draftMode: 'review', autoDailyCap: 0, autoWindow: '白天', like: 'self', fav: 'self', dmReply: 'direct', comment: 'review', danmaku: 'review' })
})

test('评论与弹幕的档位可显式设成 self（主人自己收放），且只认 self/review 两个值', () => {
  const p = readPolicy({ permissions: { comment: 'self', danmaku: 'self' } })
  assert.equal(p.comment, 'self')
  assert.equal(p.danmaku, 'self')
  assert.equal(tierQueues(p.comment), false, 'self = 不进待审队列')
  assert.equal(tierQueues(p.danmaku), false)
})

test('时段：空/非法=不限；正常区间含起点不含终点；跨午夜可用', () => {
  assert.equal(inWindow(new Date('2026-10-31T09:00:00')), true)
  assert.equal(inWindow(new Date('2026-10-31T09:00:00'), ''), true)
  assert.equal(inWindow(new Date('2026-10-31T09:00:00'), '白天'), true, '读不懂的时窗放行不误伤')
  assert.equal(inWindow(new Date('2026-10-31T10:00:00'), '10:00-23:00'), true)
  assert.equal(inWindow(new Date('2026-10-31T23:00:00'), '10:00-23:00'), false, '终点不含')
  assert.equal(inWindow(new Date('2026-10-31T03:00:00'), '23:00-07:00'), true, '跨午夜')
  assert.equal(inWindow(new Date('2026-10-31T08:00:00'), '23:00-07:00'), false)
})

test('上限：cap<=0 不限；到值即停；档位判定只认 review', () => {
  assert.equal(capReached(99, 0), false)
  assert.equal(capReached(1, 1), true)
  assert.equal(capReached(0, 1), false)
  assert.equal(tierQueues('self'), false)
  assert.equal(tierQueues('review'), true)
})

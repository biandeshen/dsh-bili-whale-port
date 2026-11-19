// 会话轮换 —— 抄上游 sessionRotateDays 的语义（2026-11-14）。
//
// 上游 lib/session-delivery.js:29：
//   rotating = days>0 && now-startedAt >= days*86400000 && now-lastDelivered >= 8*60000 && !isBusy
//
// 本仓适配：Cortico 没有 createSession，等价物是「请求一次上下文交接」。
// 效果一样（旧对话换成笔记，上下文不再无限堆），差别只是 session id 不变。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { shouldRotate, RotationStore, ROTATE_IDLE_MS, EMPTY_ROTATION } from '../src/session-rotation.ts'

const DAY = 86_400_000
const T0 = Date.parse('2026-11-14T12:00:00+08:00')

test('默认不轮换（days=0，与上游一致）', () => {
  const r = shouldRotate({ startedAt: T0 - 5 * DAY, lastDeliveredAt: T0 - 60_000, rotations: 0 },
    { rotateDays: 0, busy: false, now: T0 })
  assert.equal(r.rotate, false)
  assert.match(r.reason, /未开启/)
})

test('未满天数不轮换，且说清还差多久', () => {
  const r = shouldRotate({ startedAt: T0 - 1.5 * DAY, lastDeliveredAt: T0 - 60_000, rotations: 0 },
    { rotateDays: 3, busy: false, now: T0 })
  assert.equal(r.rotate, false)
  assert.match(r.reason, /还差/)
  assert.match(r.reason, /小时/)
})

test('到天数但距上次投递不足 8 分钟 → 等空闲', () => {
  const r = shouldRotate({ startedAt: T0 - 4 * DAY, lastDeliveredAt: T0 - 3 * 60_000, rotations: 0 },
    { rotateDays: 3, busy: false, now: T0 })
  assert.equal(r.rotate, false)
  assert.match(r.reason, /不足 8 分钟/)
})

test('到天数但正忙 → 忙完再轮换', () => {
  const r = shouldRotate({ startedAt: T0 - 4 * DAY, lastDeliveredAt: T0 - 20 * 60_000, rotations: 0 },
    { rotateDays: 3, busy: true, now: T0 })
  assert.equal(r.rotate, false)
  assert.match(r.reason, /忙/)
})

test('三个条件都满足 → 轮换', () => {
  const r = shouldRotate({ startedAt: T0 - 4 * DAY, lastDeliveredAt: T0 - 20 * 60_000, rotations: 0 },
    { rotateDays: 3, busy: false, now: T0 })
  assert.equal(r.rotate, true)
  assert.match(r.reason, /请求交接/)
})

test('首拍不轮换（还没记录起点）', () => {
  const r = shouldRotate({ ...EMPTY_ROTATION }, { rotateDays: 3, busy: false, now: T0 })
  assert.equal(r.rotate, false)
  assert.match(r.reason, /还没记录会话起点/)
})

test('恰好到天数边界就轮换（>= 而非 >）', () => {
  const r = shouldRotate({ startedAt: T0 - 3 * DAY, lastDeliveredAt: T0 - 20 * 60_000, rotations: 0 },
    { rotateDays: 3, busy: false, now: T0 })
  assert.equal(r.rotate, true, '上游用的是 >=，恰好满 3 天就该轮换')
})

test('空闲阈值常量是 8 分钟（抄上游）', () => {
  assert.equal(ROTATE_IDLE_MS, 8 * 60_000)
})

test('状态落盘：写进去能读回来', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rot-'))
  const store = new RotationStore(dir)
  store.write({ startedAt: T0, lastDeliveredAt: T0 + 1000, rotations: 2 })
  const back = store.read()
  assert.equal(back.startedAt, T0)
  assert.equal(back.lastDeliveredAt, T0 + 1000)
  assert.equal(back.rotations, 2)
})

test('状态文件坏了/缺失 → 当没有（退化成不轮换，不是"不许动"）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rot-'))
  const store = new RotationStore(dir)
  assert.deepEqual(store.read(), EMPTY_ROTATION)
  fs.writeFileSync(path.join(dir, 'session-rotation.json'), '{坏', 'utf8')
  assert.deepEqual(store.read(), EMPTY_ROTATION)
})

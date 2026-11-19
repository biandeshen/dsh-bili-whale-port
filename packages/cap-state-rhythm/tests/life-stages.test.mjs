/**
 * 生活循环的五阶段顺序：对账 → 结算 → 衰减/恢复 → 决定 → 记账。
 *
 * 从宿主 tests/life-stages.test.mjs 搬来（#88 退役第二份内核前的对账）。
 * 拆之前先把**顺序与不可跳过**写成断言，否则顺序错了、某一步被跳过，单测都不会红。
 * 这里只测纯函数，不启动 World、不碰真状态目录。
 *
 * 两处口径已经变了，按新口径钉（不是把旧断言抄绿）：
 *   · `isAsleep(null)` 不再算睡着——那叫"没历史"，不叫睡了 6 小时（2026-11-04 三态改动）；
 *   · 第③步的审批结算在本仓走 write-gate 的事件回执，不再是 consumeDraftResults。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  reconcileLife, isAsleep, restState, decideStage, applyActionRecord, SLEEP_AFTER_MS,
} from '../src/life-stages.ts'
import { dayKey } from '../../persona-core/src/rhythm.ts'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'life-stages-'))

test('① 对账：取内存 / 磁盘 / 行动账三者最大，跨日先归零', () => {
  const r = reconcileLife(
    { day: '2026-11-02', actionsToday: 0, lastActionAt: 0 },
    { day: '2026-11-02', actionsToday: 3, lastActionAt: 9_000 },
    { count: 5, lastAt: 9_500 },
    '2026-11-02',
  )
  assert.equal(r.actionsToday, 5)
  assert.equal(r.lastActionAt, 9_500)

  const newDay = reconcileLife(
    { day: '2026-11-01', actionsToday: 9 },
    { day: '2026-11-01', actionsToday: 9 },
    { count: 0, lastAt: 0 },
    '2026-11-02',
  )
  assert.equal(newDay.actionsToday, 0, '换日先清零，再和账本比')
})

test('② 睡着判定：闲够 6h 才算睡下，刚忙完不算；没历史不等于睡着', () => {
  const hour = 3_600_000
  // 关掉时段判据，只按"闲了多久"——否则夜里那个点会盖掉这条判据
  const extra = { sleepWindow: null }
  const now = Date.parse('2026-11-02T10:00:00.000Z')
  assert.equal(isAsleep(now - (5 * hour + 59 * 60_000), now, 'auto', extra), false, '5h59m 还醒着')
  assert.equal(isAsleep(now - SLEEP_AFTER_MS, now, 'auto', extra), true, '满 6h 睡下')
  assert.equal(isAsleep(null, now, 'auto', extra), false, '从没动过 = 没历史，不是睡了 6 小时')
  assert.equal(isAsleep(0, now, 'auto', extra), false)
})

test('② 三态：累了歇着 ≠ 睡着了（歇着不该触发夜间结算）', () => {
  const now = Date.parse('2026-11-02T10:00:00.000Z')
  const mem = { lastActionAt: now - 60_000, sleepWindow: null }
  assert.equal(restState(mem, { energy: 0.2 }, now), 'resting')
  assert.equal(restState(mem, { energy: 0.9 }, now), 'awake')
  assert.equal(isAsleep(now - 60_000, now, 'auto', { sleepWindow: null, energy: 0.2 }), false,
    '歇着不是睡着')
})

test('④ 决定之后才扣成本：不动就不扣场值；夜间时段不叫醒她', () => {
  const now = Date.parse('2026-11-02T10:00:00.000Z')
  const full = { energy: 0.9, stimulation: 0.9, connection: 0.9, social: 0.9, mood: 0.9, curiosity: 0.9, creativity: 0.9 }
  const r = decideStage({
    fields: full, relation: 'normal', now, rng: () => 0.99,
    mem: { day: dayKey(now), actionsToday: 0, lastActionAt: now - 60_000, sleepWindow: null },
  })
  assert.equal(r.decision.act, false, '什么都不缺又刚动过 = 不想动')
  assert.equal(r.costApplied, false, '不想动就不扣成本')

  const s = decideStage({
    fields: { ...full, stimulation: 0.0, connection: 0.0 }, relation: 'normal', now, rng: () => 0.0,
    mem: { day: dayKey(now), actionsToday: 0, lastActionAt: now - 20 * 3_600_000, sleepWindow: null },
  })
  assert.equal(s.decision.act, true, '无聊又歇够了 = 会动')
  assert.equal(s.costApplied, false, '扣成本是调用方的事，这一阶段只出决定')

  const night = Date.parse('2026-11-02T03:00:00+08:00')
  const n = decideStage({
    fields: { ...full, stimulation: 0.0 }, relation: 'normal', now: night, rng: () => 0.0,
    mem: { day: dayKey(night), actionsToday: 0, lastActionAt: night - 20 * 3_600_000 },
    tz: 'Asia/Shanghai',
  })
  assert.equal(n.decision.act, false, '睡着时段不撞门')
  assert.equal(n.decision.reason, 'asleep')
})

test('⑤ 记账在触发之前：先落 append-only 因果账，再写会被覆盖的 life.json', () => {
  const order = []
  const next = applyActionRecord(
    { day: '2026-11-02', actionsToday: 2, lastActionAt: 0 },
    { kind: 'explore', reason: 'test' },
    {
      now: 12_345_678,
      writeLife: (m) => order.push(['writeLife', m.actionsToday]),
      writeCausal: (e) => order.push(['causal', e.kind]),
    },
  )
  assert.deepEqual(order.map((x) => x[0]), ['causal', 'writeLife'],
    '因果账是唯一不会被覆盖的那份，必须先落')
  assert.equal(order[1][1], 3, '写回的汇总要已经 +1')
  assert.equal(next.actionsToday, 3)
  assert.equal(next.lastActionAt, 12_345_678)
  assert.equal(next.lastKind, 'explore')
})

test('阶段封装保持纯函数：同一输入两次结果相同，不建目录不写盘', () => {
  const mem = { day: '2026-11-02', actionsToday: 1, lastActionAt: 0 }
  const a = reconcileLife(mem, null, { count: 2, lastAt: 5 }, '2026-11-02')
  const b = reconcileLife(mem, null, { count: 2, lastAt: 5 }, '2026-11-02')
  assert.deepEqual(a, b)
  assert.equal(mem.actionsToday, 1, '不许就地改调用方的对象')
  assert.equal(fs.existsSync(path.join(tmp, 'bili-whale')), false)
  assert.equal(fs.existsSync(path.join(tmp, 'data')), false)
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))
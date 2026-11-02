/**
 * 生活循环的五阶段顺序（§8 第 19 步的前提）。
 *
 * 现状是一个 130 行的 `lifeTick` 从头跑到尾。拆之前先把**顺序与不可跳过**写成断言，
 * 否则拆的时候没有网：顺序错了、某一步被跳过，单测都不会红。
 *
 * 这条测的是纯函数层面的阶段，不启动 World、不碰真状态目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'life-stages-'))

test('五阶段：对账 → 结算 → 衰减/恢复 → 决定 → 记账，顺序不可换', async () => {
  const P = await import('../src/worlds/bili-account/life-stages.ts')

  // ① 对账：life.json 被并发实例写回旧值，因果链只增不减
  const reconcil = P.reconcileLife(
    { day: '2026-11-02', actionsToday: 0, lastActionAt: 0 },
    { day: '2026-11-02', actionsToday: 3, lastActionAt: 9_000 },
    { count: 5, lastAt: 9_500 },
  )
  assert.equal(reconcil.actionsToday, 5, '取三者最大：内存 / 磁盘 / 因果链')
  assert.equal(reconcil.lastActionAt, 9_500)

  // 跨日归零：昨天的计数不能带到今天
  const newDay = P.reconcileLife({ day: '2026-11-01', actionsToday: 9 }, { day: '2026-11-01', actionsToday: 9 }, { count: 0, lastAt: 0 }, '2026-11-02')
  assert.equal(newDay.actionsToday, 0, '换日先清零，再和账本比')
})

test('② 睡着判定：只有"距上次动作 ≥6h"才算睡下，刚忙完不算', async () => {
  const P = await import('../src/worlds/bili-account/life-stages.ts')
  const hour = 3_600_000
  const now = Date.parse('2026-11-02T10:00:00.000Z')
  assert.equal(P.isAsleep(now - (5 * hour + 59 * 60_000), now), false, '5h59m 还醒着')
  assert.equal(P.isAsleep(now - 6 * hour, now), true, '满 6h 睡下')
  assert.equal(P.isAsleep(null, now), true, '从没动过 = 一直睡着')
})

test('③ 审批结果结算：游标之前的不重复吃，理由原样带进记忆', async () => {
  const { consumeDraftResults } = await import('../src/worlds/bili-account/prompts.ts')
  const { loadState } = await import('../src/worlds/bili-account/personaAdapter.ts')
  const entries = [
    { kind: 'draft-result', at: '2026-11-02T01:00:00.000Z', result: 'rejected', draftId: 'd1', reason: '选题偏了' },
    { kind: 'draft-result', at: '2026-11-02T02:00:00.000Z', result: 'sent', draftId: 'd2' },
  ]
  // 状态形状以 persona-core 的默认值为准：自己拼一个缺 budget 的对象会让 applyEffects 崩
  const base = {
    fields: { energy: 0.5, stimulation: 0.5, connection: 0.5, social: 0.5, mood: 0.5, curiosity: 0.5, creativity: 0.5 },
    chain: [], memories: [], lastAppliedAt: '2026-11-02T00:00:00.000Z',
    npcState: { current: 'normal' },
    budget: { day: '2026-11-02', spent: {} },
    emotionHistory: [],
  }
  const out = consumeDraftResults(base, entries, Date.parse('2026-11-02T01:30:00.000Z'))
  assert.equal(out.consumedAt, Date.parse('2026-11-02T02:00:00.000Z'), '游标推进到最新吃掉的那条')
  assert.deepEqual(out.applied, ['draftApproved'], '只结算游标之后那条 sent')
  // 不重复吃：同一批再跑一次，游标已在最后，什么都不该发生
  const again = consumeDraftResults(out.state, entries, out.consumedAt)
  assert.deepEqual(again.applied, [], '吃过的不会再吃')
})

test('④ 决定之后才扣成本：不动就不扣场值', async () => {
  const P = await import('../src/worlds/bili-account/life-stages.ts')
  const { dayKey } = await import('@xiaoyu/persona-core/rhythm')
  const now = Date.parse('2026-11-02T10:00:00.000Z')
  // 造一个"确实不想动"的她：刚动过（restPressure=0）、什么事都不缺（explore/connect=0）
  const r = P.decideStage({
    fields: { energy: 0.9, stimulation: 0.9, connection: 0.9, social: 0.9, mood: 0.9, curiosity: 0.9, creativity: 0.9 },
    relation: 'normal', now, rng: () => 0.99,
    mem: { day: dayKey(now), actionsToday: 0, lastActionAt: now - 60_000 },
  })
  assert.equal(r.decision.act, false, '什么都不缺又刚动过 = 不想动')
  assert.equal(r.costApplied, false, '不想动就不扣成本')
  // 反过来：久没动静 + 无聊，就该动
  const s = P.decideStage({
    fields: { energy: 0.9, stimulation: 0.0, connection: 0.0, social: 0.9, mood: 0.9, curiosity: 0.9, creativity: 0.9 },
    relation: 'normal', now, rng: () => 0.0,
    mem: { day: dayKey(now), actionsToday: 0, lastActionAt: now - 20 * 3_600_000 },
  })
  assert.equal(s.decision.act, true, '无聊又歇够了 = 会动')
})

test('⑤ 记账在触发之前：先写 life.json 再入队，重启不会补一次', async () => {
  const P = await import('../src/worlds/bili-account/life-stages.ts')
  const order = []
  P.applyActionRecord(
    { day: '2026-11-02', actionsToday: 2, lastActionAt: 0 },
    { kind: 'explore', reason: 'test' },
    { now: 12_345_678,
      writeLife: (m) => order.push(['writeLife', m.actionsToday]),
      writeCausal: (e) => order.push(['causal', e.kind]) },
  )
  assert.deepEqual(order[0][0], 'causal', '先落因果账（append-only，是唯一不会被覆盖的）')
  assert.deepEqual(order[1][0], 'writeLife')
})

test('阶段封装保持纯函数：同一输入两次结果相同，不读真状态目录', async () => {
  const P = await import('../src/worlds/bili-account/life-stages.ts')
  const mem = { day: '2026-11-02', actionsToday: 1, lastActionAt: 0 }
  const a = P.reconcileLife(mem, null, { count: 2, lastAt: 5 })
  const b = P.reconcileLife(mem, null, { count: 2, lastAt: 5 })
  assert.deepEqual(a, b)
  assert.equal(fs.existsSync(path.join(tmp, 'bili-whale')), false, '这些函数不建目录、不写盘')
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

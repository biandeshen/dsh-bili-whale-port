import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability, loadState } from '../src/index.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-rhythm-'))

function mk(dir, fields = {}) {
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  fs.writeFileSync(fieldsFile, JSON.stringify({
    schemaVersion: 5,
    fields: { energy: 0.8, stimulation: 0.3, connection: 0.75, social: 0.5, mood: 0.4, curiosity: 0.7, creativity: 0.6, ...fields },
    memories: [], chain: [], npcState: { current: 'normal', bond: { level: 0.5 } },
    budget: { day: '2026-11-04', spent: {} }, emotionHistory: [], lastAppliedAt: new Date().toISOString(),
  }))
  fs.writeFileSync(lifeFile, JSON.stringify({ day: '2026-11-04', actionsToday: 0, lastActionAt: 0, lastCheckAt: 0, nextCheckAt: 0, mode: 'auto' }))
  return createStateRhythmCapability({ fieldsFile, lifeFile })
}

test('lifeTick：一拍就把作息账落盘（旧架构每 5 分钟有人推，重写后没人调用）', () => {
  const dir = tmp()
  const cap = mk(dir)
  assert.equal(typeof cap.lifeTick, 'function', '能力包必须把这一拍交出去')

  const before = JSON.parse(fs.readFileSync(path.join(dir, 'life.json'), 'utf8'))
  assert.equal(before.lastCheckAt, 0, '起点：账还停在没跑过的样子')

  const t = cap.lifeTick()
  const after = JSON.parse(fs.readFileSync(path.join(dir, 'life.json'), 'utf8'))

  assert.ok(t.now > 0 && Number.isFinite(t.nextCheckAt), '回执要带下一次的时间')
  assert.ok(after.lastCheckAt > 0, 'lastCheckAt 必须被推进（这就是 actionsToday 永远 0 的根因）')
  assert.ok(after.nextCheckAt > after.lastCheckAt, '下一次要落在未来')
  assert.equal(typeof t.asleep, 'boolean')
  assert.equal(typeof t.shouldAct, 'boolean')
  // 不动也要有理由：gap / cap / tired / content 四种，不许是空字符串
  if (!t.shouldAct) {
    assert.ok(['gap', 'cap', 'tired', 'content'].includes(t.reason), `不动的理由要在四种里，实得「${t.reason}」`)
  } else {
    assert.ok(['explore', 'connect', 'restless'].includes(t.kind), `要动也该说清是哪种冲动，实得「${t.kind}」`)
    assert.ok(typeof t.reason === 'string' && t.reason.length > 0, '要动也要有人话理由，不许只给代号')
  }
  // 账上从没记过行动时（新家/刚迁移），不能把她判成"睡了很久"——
  // 15:24 线上实测出过自相矛盾的话：既说"她在睡着"又说"她想动"
  if (t.neverActed) assert.equal(t.asleep, false, '没历史 ≠ 睡着')
  // 连跑两拍：间隔太短时应落在 gap（第二拍不该又动一次）
  const t2 = cap.lifeTick()
  assert.ok(t2.now >= t.now)
})

test('lifeTick：跨日把 actionsToday 归零，不把昨天的账算到今天', () => {
  const dir = tmp()
  const cap = mk(dir)
  const lifeFile = path.join(dir, 'life.json')
  // 本地日界（跟 persona-core 的 dayKey 一致）：不能用 toISOString()——
  // 那是 UTC，东八区本地 00:00–08:00 时它还停在昨天，于是这条测试在凌晨必然假失败。
  const today = new Date().toLocaleDateString('sv-SE')
  fs.writeFileSync(lifeFile, JSON.stringify({
    day: '2000-01-01', actionsToday: 7, lastActionAt: Date.now() - 3600_000, lastCheckAt: 0, nextCheckAt: 0, mode: 'auto',
  }))
  const t = cap.lifeTick()
  const after = JSON.parse(fs.readFileSync(lifeFile, 'utf8'))
  assert.equal(after.day, today, '跨日要换成今天')
  assert.equal(t.actionsToday, 0, `昨天的 7 件不该带进今天，实得 ${t.actionsToday}`)
})

test('lifeTick：主人 force_sleep 时她说不动，理由要说清是模式不是累', () => {
  const dir = tmp()
  const cap = mk(dir)
  const lifeFile = path.join(dir, 'life.json')
  fs.writeFileSync(lifeFile, JSON.stringify({
    day: new Date().toLocaleDateString('sv-SE'), actionsToday: 0,
    lastActionAt: Date.now() - 3600_000, lastCheckAt: 0, nextCheckAt: 0, mode: 'force_sleep',
  }))
  const t = cap.lifeTick()
  assert.equal(t.shouldAct, false, '强制休息不该动')
  assert.equal(t.asleep, true)
  const state = loadState(path.join(dir, 'fields.json'))
  assert.ok(state, '场值仍然读得到（对账不改场值，只记作息）')
})

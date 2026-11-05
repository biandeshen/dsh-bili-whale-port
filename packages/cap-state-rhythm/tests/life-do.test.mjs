/**
 * life_do：她自己记下一笔"真的做过的小事"。
 *
 * 三层诊断的第三层（2026-11-06）：
 *   `applyActionRecord` / `actionCost` / `restRecovery` 在生产里**都没有调用者**——
 *   life.json 的 actionsToday / lastActionAt 永远是 0，`restPressure` 顶着 1.0，
 *   行动不花体力、睡觉不回体力，五阶段循环只跑了"对账 + 决定"两步。
 *   这一条钉住补上的三笔账：
 *     ① 记一笔 → 汇总（life.json）+ 只追加流水（actions.ndjson）都对；
 *     ② 真花体力（不然"累了就歇"永远触发不了）；
 *     ③ lifeTick 用行动账对账，life.json 漂了也能纠回来，且不把昨天带进今天。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability } from '../src/index.ts'
import { readActionLedger } from '../src/action-ledger.ts'
import { ACTIVITY_TYPES } from '../../persona-core/src/life-activities.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-life-do-'))

function mk(dir, fields = {}, life = {}) {
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  fs.writeFileSync(fieldsFile, JSON.stringify({
    schemaVersion: 5,
    fields: { energy: 0.8, stimulation: 0.3, connection: 0.6, social: 0.5, mood: 0.2, curiosity: 0.6, creativity: 0.5, ...fields },
    memories: [], chain: [], npcState: { current: 'normal', bond: { level: 0.5 } },
    budget: { day: new Date().toLocaleDateString('sv-SE'), spent: {} }, emotionHistory: [],
    lastAppliedAt: new Date().toISOString(),
  }))
  fs.writeFileSync(lifeFile, JSON.stringify({
    day: new Date().toLocaleDateString('sv-SE'), actionsToday: 0, lastActionAt: 0,
    lastCheckAt: 0, nextCheckAt: 0, mode: 'auto', sleepWindow: null, ...life,
  }))
  const cap = createStateRhythmCapability({ fieldsFile, lifeFile })
  const tool = cap.tools().find((t) => t.name === 'life_do')
  return { cap, tool, fieldsFile, lifeFile, actionsFile: path.join(dir, 'actions.ndjson') }
}

const readJson = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))

test('life_do 存在，且 7 类活动都收（不另发明一套动作）', () => {
  const dir = tmp()
  const { tool } = mk(dir)
  assert.ok(tool, '要有一个她真的能按下去的行动回执工具')
  assert.equal(tool.mutatesState, true, '写账的东西必须标 mutatesState')
  assert.deepEqual([...tool.parameters.properties.activity.enum], [...ACTIVITY_TYPES], '取值范围就是那 7 类')
})

test('记一笔：life.json 汇总 + 只追加行动账 + 真的花体力', async () => {
  const dir = tmp()
  const { tool, fieldsFile, lifeFile, actionsFile } = mk(dir)
  const before = readJson(fieldsFile).fields.energy
  const r = await tool.execute({ activity: 'exercise', note: '原地跑了一小会儿' })
  assert.equal(r.ok, true)
  assert.equal(r.activity, 'exercise')
  assert.equal(r.label, '动一动')
  assert.equal(r.actionsToday, 1)
  assert.ok(r.lastActionAt > 0, '回执要给出这次行动的时间')

  const life = readJson(lifeFile)
  assert.equal(life.actionsToday, 1, '汇总要进 life.json（这是面板与心跳都读的那份）')
  assert.equal(life.lastKind, 'exercise', 'lastKind 记成 7 类之一')
  assert.ok(life.lastActionAt > 0, 'lastActionAt 要动（它原来永远是 0）')

  const ledger = readActionLedger(actionsFile)
  assert.equal(ledger.count, 1)
  assert.equal(ledger.today[0].activity, 'exercise')
  assert.equal(ledger.today[0].note, '原地跑了一小会儿')

  const after = readJson(fieldsFile).fields.energy
  assert.ok(after < before, `行动要花体力：${before} → ${after}`)
})

test('同一天第二笔记成 2；开了新的一天从 0 起算', async () => {
  const dir = tmp()
  const { tool, lifeFile } = mk(dir, {}, { day: '2000-01-01', actionsToday: 9, lastActionAt: 1 })
  const r = await tool.execute({ activity: 'reflect' })
  assert.equal(r.actionsToday, 1, '昨天的 9 件不许带进今天')
  assert.equal(readJson(lifeFile).actionsToday, 1)
  const r2 = await tool.execute({ activity: 'consume', note: '翻了会儿手机' })
  assert.equal(r2.actionsToday, 2)
})

test('非法 activity 直接拒，不写半笔账', async () => {
  const dir = tmp()
  const { tool, lifeFile, actionsFile } = mk(dir)
  const r = await tool.execute({ activity: '刷剧' })
  assert.equal(r.ok, false)
  assert.match(r.error, /activity 只能是/)
  assert.equal(readJson(lifeFile).actionsToday, 0)
  assert.equal(readActionLedger(actionsFile).total, 0)
})

test('lifeTick 用行动账对账：life.json 漂成 0，也能把今天的件数与最近行动纠回来', async () => {
  const dir = tmp()
  const { cap, tool, lifeFile } = mk(dir)
  await tool.execute({ activity: 'explore' })
  await tool.execute({ activity: 'create' })
  // 模拟漂移：汇总被旧进程覆盖回 0
  const life = readJson(lifeFile)
  fs.writeFileSync(lifeFile, JSON.stringify({ ...life, actionsToday: 0, lastActionAt: 0 }))
  const t = cap.lifeTick()
  assert.equal(t.actionsToday, 2, '对账要认行动账（流水才是凭据）')
  assert.ok(t.lastActionAt > 0, '最近行动时间也要从流水里取回来')
})

test('昨天的流水不算今天（跨日不串账）', () => {
  const dir = tmp()
  const { cap, actionsFile } = mk(dir)
  const yesterday = new Date(Date.now() - 86400_000).toLocaleDateString('sv-SE')
  fs.writeFileSync(actionsFile, [
    JSON.stringify({ at: Date.now() - 86400_000, day: yesterday, activity: 'rest', label: '歇会儿' }),
    JSON.stringify({ at: Date.now() - 86000_000, day: yesterday, activity: 'rest', label: '歇会儿' }),
  ].join('\n') + '\n')
  const t = cap.lifeTick()
  assert.equal(t.actionsToday, 0, '昨天的两笔不许算进今天')
})

test('夜间时段内不叫她：shouldAct=false 且理由是 asleep', () => {
  const dir = tmp()
  const now = Date.now()
  const hhmm = (offsetH) => {
    const d = new Date(now + offsetH * 3600_000)
    return `${String(d.getHours()).padStart(2, '0')}:00`
  }
  const { cap } = mk(dir, {}, { sleepWindow: { start: hhmm(-1), end: hhmm(1) } })
  const t = cap.lifeTick()
  assert.equal(t.shouldAct, false, '夜里那一拍不该投递（以前会白花一次模型调用）')
  assert.equal(t.reason, 'asleep')
  assert.equal(t.asleep, true)
})

test('睡着时回体力：restRecovery 真接上了（以前也是死代码）', () => {
  const dir = tmp()
  const now = Date.now()
  const hhmm = (offsetH) => {
    const d = new Date(now + offsetH * 3600_000)
    return `${String(d.getHours()).padStart(2, '0')}:00`
  }
  const { cap, fieldsFile } = mk(dir, { energy: 0.5 }, { sleepWindow: { start: hhmm(-1), end: hhmm(1) } })
  // 两小时没结算过
  const raw = readJson(fieldsFile)
  raw.lastAppliedAt = new Date(now - 2 * 3600_000).toISOString()
  fs.writeFileSync(fieldsFile, JSON.stringify(raw))
  const t = cap.lifeTick()
  assert.equal(t.asleep, true)
  const after = readJson(fieldsFile).fields.energy
  assert.ok(after > 0.5, `睡着该回一点体力：0.5 → ${after}`)
})

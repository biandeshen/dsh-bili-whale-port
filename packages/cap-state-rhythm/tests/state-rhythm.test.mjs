import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateCapabilityContract } from '../../persona-core/src/capability.ts'
import {
  emptyState,
  applyEvent,
  applyEffects,
  saveState,
  loadState,
  remember,
  describeState,
  createStateRhythmCapability,
  reconcileLife,
  isAsleep,
  decideStage,
} from '../src/index.ts'

const DAY = 86400_000
const T0 = Date.parse('2026-10-01T21:40:00+08:00')
const base = (over = {}) => ({ ...emptyState(), lastAppliedAt: new Date(T0).toISOString(), ...over })
const at = (day) => T0 + day * DAY

test('一次事件内同源效果全部生效（回归：频率门吞掉同一来源的第二条）', () => {
  const s = applyEvent(base(), 'masterReplied', at(0) + 1000)
  assert.ok(Math.abs(s.fields.connection - 0.6) < 1e-6, 'connection ' + s.fields.connection)
  assert.ok(Math.abs(s.fields.social - 0.53) < 1e-6, 'social ' + s.fields.social)
  assert.ok(Math.abs(s.fields.mood - 0.28) < 1e-6, 'mood ' + s.fields.mood)
})

test('连续 20 天没人说话：没有接触证据，不判冷战', () => {
  let s = base()
  for (let d = 1; d <= 20; d++) s = applyEvent(s, 'masterSilentDay', at(d))
  assert.ok(s.fields.connection < 0.3, 'connection ' + s.fields.connection)
  assert.equal(s.npcState.current, 'unjudged')
})

test('有过接触再连续沉默：连接跌破 0.3 并进入冷战', () => {
  let s = applyEvent(base(), 'masterReplied', at(0) + 1000)
  for (let d = 1; d <= 20; d++) s = applyEvent(s, 'masterSilentDay', at(d))
  assert.ok(s.fields.connection < 0.3, 'connection ' + s.fields.connection)
  assert.equal(s.npcState.current, 'cold_war')
})

test('冷战期主人回复：先回 missing，不被瞬时好感抹平', () => {
  let s = applyEvent(base(), 'masterReplied', at(0) + 1000)
  for (let d = 1; d <= 20; d++) s = applyEvent(s, 'masterSilentDay', at(d))
  assert.equal(s.npcState.current, 'cold_war')
  const afterReply = applyEvent(s, 'masterReplied', at(21))
  assert.equal(afterReply.npcState.current, 'missing')
})

test('入站私信：connection 上升、bond +0.1，建立接触证据', () => {
  const s = applyEvent(base(), 'inbound', at(0) + 1000)
  assert.ok(Math.abs(s.fields.connection - 0.57) < 1e-6, 'connection ' + s.fields.connection)
  assert.equal(s.npcState.lastUserMessageAt, at(0) + 1000)
  assert.ok(Math.abs(s.npcState.bond.level - 0.3) < 1e-9)
  assert.equal(s.npcState.current, 'normal')
})

test('长时间空窗：场值自然衰减写进因果链，心情不会一路单调上去', () => {
  let s = base()
  s = applyEvent(s, 'masterReplied', at(1))
  const peak = s.fields.mood
  s = applyEvent(s, 'watchedVideo', at(15))
  assert.ok(s.fields.mood < peak, 'mood ' + s.fields.mood + ' peak ' + peak)
  assert.ok(s.chain.some((e) => e.description === '时间流逝（自然衰减）'))
})

test('未知预设不改状态', () => {
  const s = base()
  assert.equal(applyEvent(s, 'nope', at(1)), s)
})

test('来源预算：custom 一天最多推动 0.15', () => {
  let s = base()
  const t = at(0)
  const custom = [{ field: 'mood', delta: 0.5, source: 'custom', priority: 5 }]
  s = applyEffects(s, custom, '自定义事件', { now: t })
  const first = s.fields.mood
  assert.ok(Math.abs(first - 0.35) < 1e-9, 'mood ' + first)
  s = applyEffects(s, custom, '自定义事件', { now: t })
  assert.ok(Math.abs(s.fields.mood - first) < 1e-9, '第二下被预算挡住，mood ' + s.fields.mood)
})

test('记忆：按真实时间折成小数天衰减（不再等满 1 天）', () => {
  let s = base()
  s = remember(s, '刚刚发生的事', { intensity: 0.5 })
  const v0 = s.memories[0].vividness
  for (let i = 1; i <= 288; i++) s = applyEffects(s, [], '时间流逝', { now: at(0) + i * 5 * 60_000 })
  const v1 = s.memories[0].vividness
  assert.ok(v1 < v0, `vividness 没有下降: ${v0} → ${v1}`)
  assert.ok(v1 > v0 - 0.03, `一天最多掉 0.02 左右，实际 ${v0} → ${v1}`)
})

test('describeState：「记得」同鲜活度时先给最近的事（不再永远最早三条）', () => {
  let s = base()
  for (let i = 0; i < 4; i++) {
    s = remember(s, '记忆 #' + i, { intensity: 0.5 })
    s.memories[s.memories.length - 1].createdAt = new Date(Date.now() - (4 - i) * 86400_000)
  }
  const text = describeState(s)
  assert.match(text, /记忆 #3/)
  assert.doesNotMatch(text, /记忆 #0/)
})

test('状态文件：原子写带 schemaVersion，坏文件从备份恢复且留档', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'))
  const file = path.join(dir, 'fields.json')
  const s1 = applyEvent(base(), 'masterReplied', at(1))
  saveState(file, s1)
  const s2 = applyEvent(s1, 'masterSilentDay', at(2))
  saveState(file, s2)
  assert.ok(fs.existsSync(file + '.bak'))
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(raw.schemaVersion, 5)
  assert.ok(Math.abs(raw.fields.connection - s2.fields.connection) < 1e-9)

  fs.writeFileSync(file, '{broken')
  const recovered = loadState(file)
  assert.ok(Math.abs(recovered.fields.connection - s1.fields.connection) < 1e-9)
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('fields.json.corrupt-')))
})

test('状态文件：截断历史后不留悬空 triggerId', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'persona-'))
  const file = path.join(dir, 'fields.json')
  const ev = (id, triggerId) => ({
    id, npcId: 'xiaoyu', timestamp: new Date(), layer: 'L0',
    type: 'field_change', description: 'x', fieldChanges: [], triggerId,
  })
  const chain = [ev('old-root'), ...Array.from({ length: 205 }, (_, i) => ev('e' + i, i === 5 ? 'old-root' : i === 6 ? 'e5' : undefined))]
  saveState(file, { ...emptyState(), chain })
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(raw.chain.length, 200)
  assert.equal(raw.chain[0].id, 'e5')
  assert.equal(raw.chain[0].triggerId, undefined)
  assert.equal(raw.chain[1].triggerId, 'e5')
})

test('cap-state-rhythm：契约校验通过，鱼缸面板 setFields / wakeNow / setMode 读写落盘闭环', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-state-'))
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  const pushedEvents = []

  const cap = createStateRhythmCapability({
    fieldsFile,
    lifeFile,
    onWakeTriggered: (e) => pushedEvents.push(e),
  })
  assert.equal(validateCapabilityContract(cap).ok, true)

  cap.start?.({
    homeDir: dir,
    dataDir: dir,
    workspaceDir: dir,
    pushEvent: (ev) => pushedEvents.push(ev),
    log: () => {},
  })

  const tankPanel = cap.panels()[0]
  assert.equal(tankPanel.id, 'tank')

  // 1. setFields：主人在面板直接拉滑块改场值（不受 0.15 预算限制，且自动 clamp）
  const setRes = await tankPanel.methods.setFields.invoke({
    patch: { energy: 0.95, mood: 0.85, curiosity: 1.5 },
    note: '主人看她累了，拉满体力',
  })
  assert.equal(setRes.ok, true)
  assert.equal(setRes.fields.energy, 0.95)
  assert.equal(setRes.fields.mood, 0.85)
  assert.equal(setRes.fields.curiosity, 1.0) // clamped

  // 2. getSnapshot 读回刚写入的值
  const snap = await tankPanel.methods.getSnapshot.invoke({})
  assert.equal(snap.ok, true)
  assert.equal(snap.fields.energy, 0.95)
  assert.ok(snap.recentChain.some((c) => c.source === 'owner_adjust'))

  // 3. setMode 切换强制休息与恢复
  const modeRes = await tankPanel.methods.setMode.invoke({ mode: 'force_sleep' })
  assert.equal(modeRes.ok, true)
  assert.equal(modeRes.asleep, true)
  const stage = decideStage({
    fields: snap.fields,
    relation: 'normal',
    now: Date.now(),
    mem: { day: '2026-11-03', actionsToday: 0, lastActionAt: 0, lastCheckAt: 0, lastKind: null, mode: 'force_sleep' },
    rng: () => 0.5,
  })
  assert.equal(stage.decision.act, false)

  // 4. wakeNow 一键戳醒她（自动解除 force_sleep 并推送唤醒事件）
  const wakeRes = await tankPanel.methods.wakeNow.invoke({ hint: '去看看收件箱' })
  assert.equal(wakeRes.ok, true)
  assert.equal(wakeRes.mode, 'auto')
  assert.ok(pushedEvents.length >= 1)

  // 5. mood_apply 工具支持 watchedVideo 的 keep / drop / unclear 三值
  const moodApplyTool = cap.tools().find((t) => t.name === 'mood_apply')
  const dropRes = await moodApplyTool.execute({ preset: 'watchedVideo', verdict: 'drop', note: '标题党，没收' })
  assert.equal(dropRes.ok, true)
  assert.ok(dropRes.applied.includes('verdict=drop'))
})

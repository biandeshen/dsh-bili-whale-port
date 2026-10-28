import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { emptyState, applyEvent, applyEffects, saveState, loadState } from '../../src/worlds/bili-account/personaAdapter.ts'

const DAY = 86400_000
const T0 = Date.parse('2026-10-01T21:40:00+08:00')

/** 固定起点状态（lastAppliedAt 可控，避免依赖系统时间）。 */
const base = (over = {}) => ({ ...emptyState(), lastAppliedAt: new Date(T0).toISOString(), ...over })
const at = (day) => T0 + day * DAY

test('一次事件内同源效果全部生效（回归：频率门吞掉同一来源的第二条）', () => {
  const s = applyEvent(base(), 'masterReplied', at(0) + 1000)
  // mood +0.08、connection +0.10、social +0.03；此前 connection/social 被频率门丢弃
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

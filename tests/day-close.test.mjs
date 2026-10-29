// 跨日收尾：只能用该日最后一条 tick 的快照，不能读新一天的状态，也不能覆盖已有 end
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'day-close-'))
process.env.DSH_HOME = WHALE
const { closeFromLastTick } = await import('../scripts/day-snapshot.mjs')
const day = '2026-10-28'
const dir = path.join(WHALE, 'bili-whale', 'days', day)

function writeTicks(rows) {
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'ticks.jsonl'), rows.map((r) => JSON.stringify(r)).join('\n') + '\n')
}

test('用最后一条 tick 写 end，带上出处；不读当前 fields', () => {
  writeTicks([
    { kind: 'tick', day, at: '2026-10-28T19:00:00.000Z', fields: { energy: 0.70, mood: 0.2 } },
    { kind: 'tick', day, at: '2026-10-28T19:56:00.000Z', fields: { energy: 0.62, mood: 0.3 } },
  ])
  // 新一天的当前状态故意写成不一样：收尾不能用它
  fs.writeFileSync(path.join(WHALE, 'bili-whale', 'fields.json'), JSON.stringify({ fields: { energy: 0.99, mood: 0.9 } }))
  const r = closeFromLastTick(day, { now: Date.parse('2026-10-28T20:01:00.000Z') })
  assert.equal(r.ok, true)
  assert.equal(r.wrote, true)
  const end = JSON.parse(fs.readFileSync(path.join(dir, 'state.end.json'), 'utf8'))
  assert.equal(end.kind, 'end')
  assert.equal(end.at, '2026-10-28T19:56:00.000Z')
  assert.equal(end.derivedFromLastTick, '2026-10-28T19:56:00.000Z')
  assert.equal(end.fields.energy, 0.62)
  assert.equal(end.fields.mood, 0.3)
  assert.equal(end.kind === 'tick', false)
})

test('已有 end 不覆盖；没有 tick 不写', () => {
  const before = fs.readFileSync(path.join(dir, 'state.end.json'), 'utf8')
  const r = closeFromLastTick(day)
  assert.equal(r.wrote, false)
  assert.equal(r.reason, 'exists')
  assert.equal(fs.readFileSync(path.join(dir, 'state.end.json'), 'utf8'), before)

  const empty = '2026-10-27'
  fs.mkdirSync(path.join(WHALE, 'bili-whale', 'days', empty), { recursive: true })
  const r2 = closeFromLastTick(empty)
  assert.equal(r2.ok, false)
  assert.equal(r2.reason, 'no-ticks')
  assert.ok(!fs.existsSync(path.join(WHALE, 'bili-whale', 'days', empty, 'state.end.json')))
})

test('睡过日界（最后 tick 已超过 2h）不收尾，宁可 MISSING 也不拿旧快照冒充', () => {
  const stale = '2026-10-26'
  const sdir = path.join(WHALE, 'bili-whale', 'days', stale)
  fs.mkdirSync(sdir, { recursive: true })
  fs.writeFileSync(path.join(sdir, 'ticks.jsonl'), JSON.stringify({ kind: 'tick', day: stale, at: '2026-10-26T19:56:00.000Z', fields: { energy: 0.5 } }) + '\n')
  const r = closeFromLastTick(stale, { now: Date.parse('2026-10-27T10:00:00.000Z') })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'stale')
  assert.ok(!fs.existsSync(path.join(sdir, 'state.end.json')))
})

test('C2 窗口收尾：允许陈旧 tick，但必须标注 derivedReason', () => {
  const day = '2026-10-25'
  const dir25 = path.join(WHALE, 'bili-whale', 'days', day)
  fs.mkdirSync(dir25, { recursive: true })
  fs.writeFileSync(path.join(dir25, 'ticks.jsonl'), JSON.stringify({ kind: 'tick', day, at: '2026-10-24T23:30:00.000Z', fields: { energy: 0.4 } }) + '\n')
  const now = Date.parse('2026-10-25T09:00:00.000Z')
  const r = closeFromLastTick(day, { now, maxAgeMs: Infinity, reason: 'c2-offline-window' })
  assert.equal(r.ok, true)
  assert.equal(r.wrote, true)
  const end = JSON.parse(fs.readFileSync(path.join(dir25, 'state.end.json'), 'utf8'))
  assert.equal(end.derivedReason, 'c2-offline-window')
  assert.equal(end.fields.energy, 0.4)
})

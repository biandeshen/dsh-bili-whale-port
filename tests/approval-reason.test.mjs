// #41 的另一半：理由要从"主人点了拒"一路走到她写的记忆里。
// dsh 侧把 --why 写进 causal 的 draft-result 条目（tests/contract/approval-reason.test.mjs 已证），
// 这里证宿主侧结算成记忆时**带上了那句话**，而且没写理由时不替主人编一个。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { loadState } from '../src/worlds/bili-account/personaAdapter.ts'
import { consumeDraftResults } from '../src/worlds/bili-account/definition.ts'
import { createInitialState } from '@xiaoyu/persona-core/npc-state-machine'
import { DEFAULT_ATOMIC_FIELDS } from '@xiaoyu/persona-core/types'

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'apr-reason-host-'))
fs.mkdirSync(path.join(HOME, 'bili-whale'), { recursive: true })
const FILE = path.join(HOME, 'bili-whale', 'fields.json')
fs.writeFileSync(FILE, JSON.stringify({
  schemaVersion: 5, fields: { ...DEFAULT_ATOMIC_FIELDS }, npcState: createInitialState('xiaoyu'),
  chain: [], memories: [], budget: null, emotionHistory: [], lastAppliedAt: '2026-11-01T00:00:00.000Z',
}))

const entry = (over) => ({ kind: 'draft-result', at: '2026-11-01T05:00:00.000Z', draftId: 'dyn-20261101-a1b2c3', date: '2026-11-01', result: 'rejected', ...over })
const lastMemory = (state) => String(state.memories[state.memories.length - 1]?.content ?? '')

test('被拒且有理由：记忆里带上主人那句原话', () => {
  const r = consumeDraftResults(loadState(FILE), [entry({ reason: '结尾那句太像教训人' })], 0)
  assert.deepEqual(r.applied, ['draftRejected'])
  assert.match(lastMemory(r.state), /主人没让发那条草稿/)
  assert.match(lastMemory(r.state), /主人的理由：结尾那句太像教训人/)
  assert.match(lastMemory(r.state), /dyn-20261101-a1b2c3/)
})

test('被拒但没写理由：如实说"没写理由"，不编一个原因', () => {
  const r = consumeDraftResults(loadState(FILE), [entry({})], 0)
  const line = lastMemory(r.state)
  assert.match(line, /主人没写理由/)
  assert.equal(line.includes('主人的理由：'), false, '没有理由就不能出现"理由："字样')
})

test('放行且主人附了话：同样进记忆（她要知道这次为什么可以发）', () => {
  const r = consumeDraftResults(loadState(FILE), [entry({ result: 'sent', reason: '这条可以发，但别带话题标签' })], 0)
  assert.deepEqual(r.applied, ['draftApproved'])
  assert.match(lastMemory(r.state), /主人把我那条草稿发出去了/)
  assert.match(lastMemory(r.state), /别带话题标签/)
})

test('理由被截到 300 字以内也不会撑爆记忆：只认因果账里已有的那份', () => {
  const r = consumeDraftResults(loadState(FILE), [entry({ reason: '咩'.repeat(300) })], 0)
  assert.ok(lastMemory(r.state).length < 640, '记忆行不该变成一整段流水账')
})

test('游标之前的旧结果不再结算（理由也不会重复灌）', () => {
  const first = consumeDraftResults(loadState(FILE), [entry({ reason: '第一次' })], 0)
  const again = consumeDraftResults(first.state, [entry({ reason: '第一次' })], first.consumedAt)
  assert.deepEqual(again.applied, [])
  assert.equal(again.state.memories.length, first.state.memories.length)
})

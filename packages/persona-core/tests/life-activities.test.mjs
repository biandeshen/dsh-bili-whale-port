import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { ACTIVITY_LABELS, pickActivities } from '../src/life-activities.ts'

const F = (over = {}) => ({ ...DEFAULT_ATOMIC_FIELDS, ...over })
const T = Date.parse('2026-10-29T14:00:00+08:00')
const zero = () => 0

test('生活活动：体力低 → 歇会儿进候选', () => {
  const list = pickActivities(F({ energy: 0.1, stimulation: 0.3, connection: 0.5 }), { now: T, rng: zero, k: 3 })
  assert.ok(list.some((x) => x.type === 'rest'), list.map((x) => x.type).join(','))
})

test('生活活动：创造欲高 → 做点东西进候选', () => {
  const list = pickActivities(F({ creativity: 0.9, energy: 0.6, stimulation: 0.5 }), { now: T, rng: zero, k: 3 })
  assert.ok(list.some((x) => x.type === 'create'), list.map((x) => x.type).join(','))
})

test('生活活动：孤独 → 想他进候选', () => {
  const list = pickActivities(F({ connection: 0.05, stimulation: 0.5 }), { now: T, rng: zero, k: 3 })
  assert.ok(list.some((x) => x.type === 'social'), list.map((x) => x.type).join(','))
})

test('生活活动：默认 3 个候选，类型不重复，id 都有中文名', () => {
  let s = 7
  const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  const list = pickActivities(F(), { now: T, rng })
  assert.equal(list.length, 3)
  assert.equal(new Set(list.map((x) => x.type)).size, 3)
  for (const a of list) {
    assert.equal(a.label, ACTIVITY_LABELS[a.type])
    assert.ok(a.description.length > 5)
  }
})

test('生活活动：同一类活动按时钟换说法', () => {
  const a = pickActivities(F({ energy: 0.1 }), { now: T, rng: zero, k: 7 }).find((x) => x.type === 'rest')
  const b = pickActivities(F({ energy: 0.1 }), { now: T + 3600_000, rng: zero, k: 7 }).find((x) => x.type === 'rest')
  assert.ok(a && b)
  assert.notEqual(a.description, b.description)
})

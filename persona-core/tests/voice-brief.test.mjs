import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { buildVoiceBrief } from '../src/voice-brief.ts'
import { readMood } from '../src/emotion.ts'

const now = Date.parse('2026-10-29T12:00:00+08:00')

function state(overrides = {}) {
  return {
    fields: { ...DEFAULT_ATOMIC_FIELDS, ...overrides },
    chain: [{
      id: 'c1', timestamp: new Date(now - 60_000), npcId: 'xiaoyu', layer: 'L0',
      type: 'field_change', description: '刚起身', fieldChanges: [], source: 'action',
    }],
    memories: [],
    npcState: { current: 'normal' },
  }
}

test('voiceBrief：情绪标签与 readMood 一致', () => {
  const s = state({ mood: 0.23 })
  const v = buildVoiceBrief(s, { now })
  assert.equal(v.v, 1)
  assert.equal(v.mood.label, readMood(s, now).primary)
  assert.equal(v.mood.cause, 'action')
  assert.ok(v.mood.intensity > 0)
})

test('voiceBrief：冷战时禁称并拒绝分享', () => {
  const s = state({ mood: 0.1 })
  s.npcState = { current: 'cold_war' }
  const v = buildVoiceBrief(s, { now })
  assert.deepEqual(v.banned, ['鱼片', '主人'])
  assert.equal(v.stance.share, false)
})

test('voiceBrief：记忆按 0.7 鲜活 + 0.3 新鲜排序并带 why', () => {
  const s = state()
  s.memories = [
    { id: 'm-old', content: '很久以前', vividness: 0.9, createdAt: new Date(now - 60 * 86400_000) },
    { id: 'm-new', content: '刚刚看的', vividness: 0.5, createdAt: new Date(now - 1 * 86400_000) },
  ]
  const v = buildVoiceBrief(s, { now, k: 2 })
  assert.equal(v.memories[0].id, 'm-new')
  assert.match(v.memories[0].why, /鲜活/)
  assert.match(v.memories[0].why, /天前/)
  assert.equal(v.memories.length, 2)
})

test('voiceBrief：没有记忆时返回空数组，不编造', () => {
  const v = buildVoiceBrief(state(), { now })
  assert.deepEqual(v.memories, [])
})

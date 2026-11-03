import test from 'node:test'
import assert from 'node:assert/strict'
import { recallMemories, watchedFromMemories, tokensOf } from '../src/retrieval.ts'

const now = Date.parse('2026-10-29T12:00:00+08:00')
const DAY = 86400_000

function mem(id, content, over = {}) {
  return {
    id,
    npcId: 'xiaoyu',
    sender: 'npc',
    content,
    emotion: { valence: 0.2, intensity: 0.5, tags: [] },
    tags: [],
    vividness: 0.9,
    accessCount: 1,
    createdAt: new Date(now - DAY),
    source: 'npc_self',
    ...over,
  }
}

test('retrieval：同样输入必得同样顺序（打乱输入也不变）', () => {
  const ms = [
    mem('a', '看过《雨声》'),
    mem('b', '主人说今天加班'),
    mem('c', '看过《猫》'),
  ]
  const ctx = { now, k: 2, text: '窗外在下雨，想起雨声', seed: '2026-10-29', mood: 0.2 }
  const r1 = recallMemories(ms, ctx).map((x) => x.id)
  const r2 = recallMemories([...ms].reverse(), ctx).map((x) => x.id)
  assert.deepEqual(r1, r2)
})

test('retrieval：关键词把相关记忆顶上来（哪怕没那么鲜活）', () => {
  const ms = [
    mem('rain', '看过《雨声》', { vividness: 0.5 }),
    mem('cat', '看过《猫咪日常》', { vividness: 0.95 }),
    mem('work', '主人说今天加班', { vividness: 0.9 }),
  ]
  const r = recallMemories(ms, { now, k: 2, text: '今天又在下雨，雨声很好听', seed: 'd1', mood: 0.2 })
  assert.equal(r[0].id, 'rain')
  assert.match(r[0].why.join(' '), /有关/)
})

test('retrieval：同等条件下，情绪接近的记忆优先', () => {
  const ms = [
    mem('low', '那天很难过', { emotion: { valence: -0.8, intensity: 0.7, tags: [] } }),
    mem('high', '那天挺开心', { emotion: { valence: 0.8, intensity: 0.7, tags: [] } }),
  ]
  const r = recallMemories(ms, { now, k: 2, seed: 'd1', mood: 0.8 })
  assert.equal(r[0].id, 'high')
})

test('retrieval：意外槽只从 ≥7 天、没被想起过、非 flashbulb 的旧事里取', () => {
  const ms = [
    mem('recent', '前几天的事', { createdAt: new Date(now - 2 * DAY) }),
    mem('flash', '里程碑', { createdAt: new Date(now - 30 * DAY), flashbulb: true }),
    mem('seen', '想过的旧事', { createdAt: new Date(now - 20 * DAY), accessCount: 3 }),
    mem('old1', '很久以前的一件小事', { createdAt: new Date(now - 10 * DAY), accessCount: 0 }),
    mem('old2', '另一件旧事', { createdAt: new Date(now - 15 * DAY), accessCount: 0 }),
  ]
  const r = recallMemories(ms, { now, k: 1, surprises: 2, seed: '2026-10-29' })
  const surprise = r.filter((x) => x.slot === 'surprise').map((x) => x.id)
  assert.equal(surprise.length, 2)
  assert.deepEqual([...surprise].sort(), ['old1', 'old2'])
  assert.equal(new Set(r.map((x) => x.id)).size, r.length, '两个槽不能重复')
})

test('retrieval：意外槽不能顶掉主槽，也不能重复主槽', () => {
  const ms = [
    mem('old1', '旧事一', { createdAt: new Date(now - 10 * DAY), accessCount: 0 }),
    mem('old2', '旧事二', { createdAt: new Date(now - 12 * DAY), accessCount: 0 }),
  ]
  const r = recallMemories(ms, { now, k: 2, surprises: 2, seed: 's' })
  assert.deepEqual(r.map((x) => x.id).sort(), ['old1', 'old2'])
  assert.ok(r.every((x) => x.slot === 'core'))
})

test('retrieval：excludeIds 生效；k=0 时只出意外槽', () => {
  const ms = [
    mem('a', '甲', { createdAt: new Date(now - 10 * DAY), accessCount: 0 }),
    mem('b', '乙', { createdAt: new Date(now - 1 * DAY) }),
  ]
  assert.deepEqual(recallMemories(ms, { now, k: 2, surprises: 0, excludeIds: ['b'] }).map((x) => x.id), ['a'])
  const onlySurprise = recallMemories(ms, { now, k: 0, surprises: 1, seed: 's' })
  assert.deepEqual(onlySurprise.map((x) => x.id), ['a'])
  assert.equal(onlySurprise[0].slot, 'surprise')
})

test('retrieval：空输入不编造', () => {
  assert.deepEqual(recallMemories([], { now }), [])
  assert.deepEqual(recallMemories(undefined, { now }), [])
})

test('tokensOf：CJK 双字 + 拉丁词，过滤单字噪声', () => {
  const t = tokensOf('雨声 BV1abcDEF 好听')
  assert.ok(t.includes('雨声'))
  assert.ok(t.includes('bv1abcdef'))
  assert.ok(!t.includes('雨'))
})

test('watchedFromMemories：近 7 天的 BV 与 UP，过期的不算', () => {
  const ms = [
    mem('w1', '看过《雨声》（雨声实验室） —— BV1aaBBccDD1', { createdAt: new Date(now - 2 * DAY) }),
    mem('w2', '看过《猫》（猫猫台） —— BV1xxYYzz001', { createdAt: new Date(now - 20 * DAY) }),
    mem('dm', '主人：今天早点睡'),
  ]
  const r = watchedFromMemories(ms, now, 7)
  assert.deepEqual(r.bvs, ['BV1aaBBccDD1'])
  assert.deepEqual(r.ups, ['雨声实验室'])
})

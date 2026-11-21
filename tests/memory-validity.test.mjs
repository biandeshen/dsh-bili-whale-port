// 记忆的时间有效性（2026-11-21，功能域分析 ① 的落地）。
//
// 问题（真会出事，不是对标洁癖）：
//   她记了「主人不喜欢猫」。三个月后主人说「我其实喜欢猫」。
//   现在会存成**两条独立记忆**，召回时权重相近，她无法判断哪条现在有效。
//
// 做法（不用图谱、不加依赖）：
//   · 每条记忆可以有 validFrom / validUntil
//   · 被新事实取代的旧记忆**不删**（content 永不删除是老规矩），只标 supersededBy
//   · 召回时已失效 / 被取代的**降权**（不是排除）——她仍能想起"我以前以为…"，
//     但不会把那当成现在的事实
//
// 判据：降权必须可断言、必须可解释（回执里说得出"这是过去的"）。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isExpired,
  isSuperseded,
  validityFactor,
  recallMemories,
  supersedeCandidates,
} from '../packages/kernel/persona-core/src/retrieval.ts'
import { SUPERSEDE_WEIGHT } from '../packages/kernel/persona-core/src/memory.ts'

const DAY = 86400_000
const NOW = Date.parse('2026-11-21T12:00:00Z')

function mem(over = {}) {
  return {
    id: 'm1',
    npcId: 'xiaoyu',
    sender: 'player',
    content: '主人不喜欢猫',
    emotion: { valence: 0, intensity: 0.5, tags: [] },
    tags: [],
    vividness: 0.9,
    accessCount: 0,
    createdAt: new Date(NOW - 90 * DAY),
    ...over,
  }
}

// ── 基本判定 ─────────────────────────────────────────────────────────
test('① 没有 validUntil = 永远有效（老数据不改行为）', () => {
  assert.equal(isExpired(mem(), NOW), false)
  assert.equal(validityFactor(mem(), NOW), 1)
})

test('① validUntil 过了 → 过期；正好到点算过期（边界不许含糊）', () => {
  const expired = mem({ validUntil: new Date(NOW - 1).toISOString() })
  assert.equal(isExpired(expired, NOW), true)
  const boundary = mem({ validUntil: new Date(NOW).toISOString() })
  assert.equal(isExpired(boundary, NOW), true, 'now >= validUntil 即失效')
  const alive = mem({ validUntil: new Date(NOW + DAY).toISOString() })
  assert.equal(isExpired(alive, NOW), false)
})

test('① validFrom 还没到 → 还无效（提前记下"将来才成立"的事）', () => {
  const future = mem({ validFrom: new Date(NOW + DAY).toISOString() })
  assert.equal(validityFactor(future, NOW), SUPERSEDE_WEIGHT, '未生效的也降权')
})

test('① 被取代的降权，且降权系数是个明确的常数（不许散落魔数）', () => {
  const old = mem({ supersededBy: 'm2' })
  assert.equal(isSuperseded(old), true)
  assert.equal(validityFactor(old, NOW), SUPERSEDE_WEIGHT)
  assert.ok(SUPERSEDE_WEIGHT > 0 && SUPERSEDE_WEIGHT < 1, '必须是 0~1 之间的下调，不能归零也不能不降')
})

// ── 召回行为 ─────────────────────────────────────────────────────────
test('① 过期的排在后面——且这个顺序只能由降权造成（不是 id 排序的巧合）', () => {
  /**
   * 第一版写成"两条内容完全相同、靠 id 排序过关"，变异测试（拆掉降权）居然仍绿——
   * 因为 id 恰好就是 'alive' < 'dead'。那种断言等于没断言。
   *
   * 现在让**过期那条各项都更占优**（更新、更鲜活、关键词命中更多），
   * 只有降权才能把它压下去。id 故意让过期的那条排前面（'aaa-dead' < 'zzz-alive'），
   * 断掉"靠 id 升序蒙对"这条路。
   */
  const dead = mem({
    id: 'aaa-dead',
    content: '主人喜欢猫 猫 猫 猫',
    vividness: 1,
    createdAt: new Date(NOW - DAY),          // 更新
    validUntil: new Date(NOW - DAY).toISOString(),
  })
  const alive = mem({
    id: 'zzz-alive',
    content: '主人喜欢猫',
    vividness: 0.4,
    createdAt: new Date(NOW - 60 * DAY),     // 更旧
  })
  const r = recallMemories([dead, alive], { text: '主人喜欢猫', now: NOW, k: 2 })
  assert.equal(r.length, 2)
  assert.equal(r[0].id, 'zzz-alive', '有效的那条必须排前面——即使过期那条更鲜活、更近、命中更多')
})

test('① 过期记忆不是被删掉——仍然召得回，只是标注了"这是过去的"', () => {
  const dead = mem({ id: 'dead', content: '主人不喜欢猫', validUntil: new Date(NOW - DAY).toISOString() })
  const r = recallMemories([dead], { text: '猫', now: NOW, k: 3 })
  assert.equal(r.length, 1, '不许因为过期就不返回')
  const why = r[0].why.join(' ')
  assert.match(why, /已失效|已被取代|过去的/, `回执要说清楚为什么降权，实际：${why}`)
})

test('① 过期但不提关键词 → 仍可能靠鲜活度进来，这时回执也要说明', () => {
  const dead = mem({ id: 'dead', content: '完全不相干的旧事', validUntil: new Date(NOW - DAY).toISOString() })
  const r = recallMemories([dead], { text: '风马牛', now: NOW, k: 3 })
  if (r.length) assert.match(r[0].why.join(' '), /已失效|已被取代|过去的/)
})

// ── 冲突候选（② 的底层） ─────────────────────────────────────────────
test('② 找矛盾候选：同主题的新旧两条要能互相指认', () => {
  const a = mem({ id: 'mine-1', content: '主人不喜欢猫' })
  const b = mem({ id: 'mine-2', content: '主人其实喜欢猫', createdAt: new Date(NOW - DAY) })
  const cands = supersedeCandidates('主人其实喜欢猫', [a], { now: NOW })
  assert.equal(cands.length, 1, '要说得出"这条可能和旧的矛盾"')
  assert.equal(cands[0].id, 'mine-1')
  assert.ok(cands[0].overlap > 0, '重叠度要是可断言的数，不是布尔')
})

test('② 无关内容不许瞎报矛盾（宁缺勿滥）', () => {
  const a = mem({ id: 'x', content: '主人不喜欢猫' })
  assert.deepEqual(supersedeCandidates('今天下雨了', [a], { now: NOW }), [])
})

test('② 已经失效的不再作为矛盾候选（免得天天提示同一件旧事）', () => {
  const a = mem({ id: 'x', content: '主人不喜欢猫', supersededBy: 'y' })
  assert.deepEqual(supersedeCandidates('主人喜欢猫', [a], { now: NOW }), [])
})

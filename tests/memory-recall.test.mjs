// 记忆闭环（2026-11-01 第二轮六席 P0）：
//   ① 召回必须写回——被想起来的记忆会变清楚，否则 recallMemory 永不被调用、accessCount 恒 0；
//   ② flashbulb 只由"第一次"点亮，不再被刺激量劫持（实测 54% 通胀）；
//   ③ 她自己的笔记不该默认标成"主人说的"（user_said 衰减最慢、可信度最高）；
//   ④ 审批结果四种都进记忆，failed/cooldown 不再等于没发生。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyState, remember, rememberFirst, describeStateWithTrace, applyRecall } from '../src/worlds/bili-account/personaAdapter.ts'
import { consumeDraftResults } from '../src/worlds/bili-account/definition.ts'

const seed = (n) => {
  let s = emptyState()
  for (let i = 0; i < n; i++) s = remember(s, `第 ${i} 条：那条雨声的助眠视频`, { sender: 'npc', intensity: 0.4 })
  return s
}

test('remember：默认 source 是 npc_self，高强度不再自动 flashbulb', () => {
  const s = remember(emptyState(), '今天很吵', { intensity: 0.95 })
  const m = s.memories.at(-1)
  assert.equal(m.source, 'npc_self')
  assert.equal(m.flashbulb, false, '刺激量高 ≠ 刻在心里')
  assert.equal(remember(s, '里程碑', { tags: ['milestone'] }).memories.at(-1).flashbulb, true)
})

test('rememberFirst：第一次点亮 flashbulb，第二次起不重复通胀', () => {
  let s = rememberFirst(emptyState(), '第一次被拒', 'draft-rejected', { sender: 'npc' })
  assert.equal(s.memories.at(-1).flashbulb, true)
  s = rememberFirst(s, '又被拒了', 'draft-rejected', { sender: 'npc' })
  assert.equal(s.memories.at(-1).flashbulb, false)
  assert.ok(s.memories.at(-1).tags.includes('draft-rejected'))
})

test('召回写回：describeStateWithTrace 带出 id，applyRecall 让 accessCount+1、鲜活度上升', () => {
  const s = seed(6)
  const { text, recalledIds } = describeStateWithTrace(s, 5, { queryText: '雨声 助眠', seed: '2026-11-01' })
  assert.match(text, /记得：/)
  assert.ok(recalledIds.length >= 1, '本轮必须带出被想起来的记忆')
  const after = applyRecall(s, recalledIds)
  const before = s.memories.filter((m) => recalledIds.includes(m.id))
  const now = after.memories.filter((m) => recalledIds.includes(m.id))
  assert.ok(now.every((m, i) => m.accessCount === before[i].accessCount + 1), '每条计数 +1')
  assert.ok(now.every((m, i) => m.vividness >= before[i].vividness), '被想起来的只会更清楚')
  // 递减收益：同一条反复召回，提升越来越小
  const twice = applyRecall(after, recalledIds)
  const d1 = now[0].vividness - before[0].vividness
  const d2 = twice.memories.find((m) => m.id === recalledIds[0]).vividness - now[0].vividness
  assert.ok(d2 < d1, `第二次增幅 ${d2} 应小于第一次 ${d1}`)
  assert.equal(applyRecall(s, []).memories, s.memories, '没召回就不该动状态')
  // 只读路径（面板）继续用 describeState：签名不变、不回写
  assert.equal(typeof describeStateWithTrace(s).text, 'string')
})

test('审批结算：sent/rejected/failed/cooldown 四种结果都留下记忆，applied 仍只有两种预设', () => {
  const at = (iso) => iso
  const entries = [
    { kind: 'draft-result', result: 'sent', draftId: 'dyn-a', at: at('2026-10-29T10:00:00') },
    { kind: 'draft-result', result: 'rejected', draftId: 'dyn-b', at: at('2026-10-30T10:00:00') },
    { kind: 'draft-result', result: 'failed', draftId: 'dyn-c', at: at('2026-10-31T10:00:00') },
    { kind: 'draft-result', result: 'cooldown', draftId: 'dyn-d', at: at('2026-11-01T10:00:00') },
  ]
  const { state, applied, consumedAt } = consumeDraftResults(emptyState(), entries, 0)
  assert.deepEqual(applied, ['draftApproved', 'draftRejected'], 'failed 不伪装成被拒')
  assert.equal(state.memories.length, 4, '四条结果都得进记忆')
  assert.match(state.memories.map((m) => m.content).join('\n'), /想发没发出去/)
  assert.equal(consumedAt, Date.parse('2026-11-01T10:00:00'))
})

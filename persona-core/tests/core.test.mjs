import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectBus } from '../src/effect-bus.ts'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { recordFieldChangeL0, buildCausalTree, explainMoodDrop } from '../src/causal-chain.ts'
import { decayMemory, calculateEncodingStrength, isFlashbulbMemory, recallMemory } from '../src/memory.ts'
import { createInitialState, deriveNPCState } from '../src/npc-state-machine.ts'
import { decayAtomicFields, applyHardCouplings, simulateOfflineTime } from '../src/decay.ts'
import { dayKey } from '../src/rhythm.ts'

const mem = (over = {}) => ({
  id: 'm1', npcId: 'xiaoyu', sender: 'player', content: '主人说晚安',
  emotion: { valence: 0.6, intensity: 0.5, tags: [] }, tags: [],
  vividness: 0.9, accessCount: 0, createdAt: new Date(), source: 'user_said', ...over,
})

test('EffectBus：同字段合并 + 按优先级排序', () => {
  const bus = new EffectBus()
  bus.collect({ field: 'mood', delta: 0.08, source: 'reply', priority: 5 })
  bus.collect({ field: 'mood', delta: 0.05, source: 'watch', priority: 3 })
  const r = bus.resolve()
  assert.equal(r.length, 1)
  assert.ok(Math.abs(r[0].totalDelta - 0.13) < 1e-9)
  assert.equal(r[0].contributions[0].priority, 3)
})

test('EffectBus：apply 改变场值并 clamp', () => {
  const bus = new EffectBus()
  bus.collect({ field: 'mood', delta: -2, source: 'x', priority: 1 })
  const after = bus.apply({ ...DEFAULT_ATOMIC_FIELDS }, bus.resolve())
  assert.equal(after.mood, -1)
})

test('EffectBus：同一来源的多条效果都生效（不再有频率门）', () => {
  const bus = new EffectBus()
  bus.collect({ field: 'mood', delta: 0.1, source: 'same', priority: 1 })
  bus.collect({ field: 'mood', delta: 0.1, source: 'same', priority: 1 })
  assert.ok(Math.abs(bus.resolve()[0].totalDelta - 0.2) < 1e-9)
})

test('因果链：显著变化入链，树可追溯', () => {
  const chain = []
  const a = recordFieldChangeL0('xiaoyu', 'mood', 0.2, -0.05, '主人两天没说话', chain)
  recordFieldChangeL0('xiaoyu', 'connection', 0.5, 0.35, '主人两天没说话', chain, a.id)
  assert.equal(chain.length, 2)
  const tree = buildCausalTree(chain, a.id)
  assert.equal(tree.event.layer, 'L0')
  assert.equal(tree.children.length, 1)
  assert.equal(explainMoodDrop(chain, 'xiaoyu').length, 1)
})

test('因果链：低于阈值不记录', () => {
  const chain = []
  assert.equal(recordFieldChangeL0('x', 'mood', 0.2, 0.21, 'noise', chain), null)
  assert.equal(chain.length, 0)
})

test('记忆：按天衰减（不是毫秒）', () => {
  const m = mem()
  assert.ok(Math.abs(decayMemory(m, 1).vividness - (0.9 - 0.02 * 0.9)) < 1e-9)
  assert.ok(decayMemory(m, 30).vividness > 0)
  assert.ok(decayMemory(m, 30).vividness > 0.3 && decayMemory(m, 30).vividness < 0.4)
})

test('记忆：flashbulb 衰减慢 5 倍，pinned 不衰减', () => {
  const m = mem({ flashbulb: true })
  assert.ok(Math.abs(decayMemory(m, 1).vividness - (0.9 - 0.02 * 0.9 * 0.2)) < 1e-9)
  assert.equal(decayMemory(mem({ pinned: true }), 365).vividness, 0.9)
})

test('记忆：编码强度峰值在 0.6 刺激量', () => {
  assert.ok(calculateEncodingStrength(0.6) > calculateEncodingStrength(0.1))
  assert.ok(calculateEncodingStrength(0.6) > calculateEncodingStrength(0.95))
})

test('记忆：里程碑 intensity>0.8 判 flashbulb', () => {
  assert.equal(isFlashbulbMemory({ intensity: 0.9, tags: [] }, []), true)
  assert.equal(isFlashbulbMemory({ intensity: 0.3, tags: [] }, ['milestone']), true)
  assert.equal(isFlashbulbMemory({ intensity: 0.3, tags: [] }, []), false)
})

test('记忆：回忆提升生动度', () => {
  assert.ok(recallMemory(mem()).vividness > 0.9)
})

test('关系状态机：连接跌破阈值 24h 进冷战', () => {
  const s = createInitialState()
  const r1 = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 1000, false)
  assert.equal(r1.stateName, 'normal')
  const r2 = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, r1.newState, 1000 + 25 * 3600_000, false)
  assert.equal(r2.stateName, 'cold_war')
})

test('关系状态机：冷战期主人发消息进入 missing', () => {
  const s = { ...createInitialState(), current: 'cold_war', connectionBelowThresholdSince: 0, trustAtColdWarStart: 0.2 }
  const r = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 1000, true)
  assert.equal(r.stateName, 'missing')
})

test('关系状态机：连接恢复回 normal', () => {
  const s = { ...createInitialState(), current: 'cold_war' }
  const r = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.8 }, s, 1000, false)
  assert.equal(r.stateName, 'normal')
})

test('场值衰减：连接/心情向 0 回落，体力向 1 恢复', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, connection: 0.9, mood: 0.8, energy: 0.5 }
  const day = 86400_000
  const oneDay = decayAtomicFields(f, day)
  assert.ok(oneDay.connection < 0.9 && Math.abs(oneDay.connection - 0.876) < 0.002)
  assert.ok(Math.abs(oneDay.mood - 0.752) < 0.002)
  assert.ok(Math.abs(oneDay.energy - 0.524) < 0.002)
  const tenDays = decayAtomicFields(f, 10 * day)
  assert.ok(Math.abs(tenDays.mood - 0.32) < 0.01)
})

test('场值衰减：dt<=0 不动，clamp 不越界', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, mood: 0.99, connection: 0.99 }
  assert.deepEqual(decayAtomicFields(f, 0), f)
  assert.deepEqual(simulateOfflineTime(f, -5), f)
  const decayed = decayAtomicFields(f, 365 * 86400_000)
  assert.equal(decayed.connection, 0)
  assert.equal(decayed.mood, 0) // 不越过基线
  assert.equal(decayed.energy, 1)
  // 长期零刺激：硬耦合继续压心情（AMpath 原模型语义）
  const long = simulateOfflineTime(f, 365 * 86400_000)
  assert.equal(long.stimulation, 0)
  assert.ok(long.mood <= 0)
})

test('硬耦合：离线再久也只按 12 小时计息，不会把心情压到 -1', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, energy: 0.1, mood: 0.0, connection: 0.05, stimulation: 0.0 }
  // 只看耦合本身：衰减会先把 connection/social 拉到基线，混在一起比会掩盖问题
  const week = applyHardCouplings(f, 7 * 86400_000)
  const year = applyHardCouplings(f, 365 * 86400_000)
  assert.ok(Math.abs(week.mood - year.mood) < 1e-9)
  assert.ok(Math.abs(week.social - year.social) < 1e-9)
  // 但确实掉了一层，不是不生效
  assert.ok(week.mood < f.mood)
  // 12h × 0.02/h（体力低） + 12h × 0.01/h（零刺激） ≈ -0.36，不会触底
  assert.ok(week.mood > -0.4, 'mood 不应被压到极端值，实际 ' + week.mood)
})

test('硬耦合：体力过低会拖累心情', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, energy: 0.1, mood: 0.5, stimulation: 0.5 }
  const after = applyHardCouplings(f, 3600_000)
  assert.ok(Math.abs(after.mood - 0.48) < 0.001)
})

test('dayKey：04:00 为日界，凌晨算前一天', () => {
  assert.equal(dayKey(Date.parse('2026-10-29T03:59:00+08:00')), '2026-10-28')
  assert.equal(dayKey(Date.parse('2026-10-29T04:00:00+08:00')), '2026-10-29')
})

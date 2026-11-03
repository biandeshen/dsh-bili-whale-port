import test from 'node:test'
import assert from 'node:assert/strict'
import { EffectBus } from '../src/effect-bus.ts'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { recordFieldChangeL0, buildCausalTree, explainMoodDrop } from '../src/causal-chain.ts'
import { decayMemory, calculateEncodingStrength, isFlashbulbMemory, recallMemory } from '../src/memory.ts'
import { createInitialState, deriveNPCState } from '../src/npc-state-machine.ts'
import { decayAtomicFields, applyHardCouplings, simulateOfflineTime } from '../src/decay.ts'
import { dayKey, decideAction } from '../src/rhythm.ts'

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
  const s = { ...createInitialState(), current: 'normal', lastUserMessageAt: 1000 }
  const r1 = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 1000, false)
  assert.equal(r1.stateName, 'normal')
  const r2 = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, r1.newState, 1000 + 25 * 3600_000, false)
  assert.equal(r2.stateName, 'cold_war')
})

test('关系状态机：没有接触证据不判冷战（未判定）', () => {
  const s = createInitialState()
  const r = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0 }, s, 1000 + 365 * 86400_000, false)
  assert.equal(r.stateName, 'unjudged')
  // 第一条消息之后才建立关系存量并进入 normal
  const r2 = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0 }, r.newState, 1000 + 365 * 86400_000 + 1000, true)
  assert.equal(r2.stateName, 'normal')
  assert.ok(Math.abs(r2.newState.bond.level - 0.3) < 1e-9)
})

test('关系状态机：冷战期主人发消息进入 missing', () => {
  const s = {
    ...createInitialState(), current: 'cold_war', connectionBelowThresholdSince: 0,
    lastUserMessageAt: 0, bond: { level: 0.2 }, bondAtColdWarStart: 0.2,
  }
  const r = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 1000, true)
  assert.equal(r.stateName, 'missing')
})

test('关系状态机：道歉后 missing → repairing → reunion 可达', () => {
  let s = {
    ...createInitialState(), current: 'cold_war', connectionBelowThresholdSince: 0,
    lastUserMessageAt: 0, bond: { level: 0.2 }, bondAtColdWarStart: 0.2,
  }
  s = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 1000, true).newState // 消息 → bond 0.3
  assert.equal(s.current, 'missing')
  s = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 2000, false).newState
  assert.equal(s.current, 'repairing')
  s = deriveNPCState({ ...DEFAULT_ATOMIC_FIELDS, connection: 0.2 }, s, 3000, false).newState
  assert.equal(s.current, 'reunion')
})

test('关系状态机：连接恢复回 normal', () => {
  const s = { ...createInitialState(), current: 'cold_war', lastUserMessageAt: 1000 }
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
})

test('离线结算：衰减跑满时长，硬耦合最多按 24h 计息', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, energy: 0.1, mood: 0.5, stimulation: 0, connection: 0.05 }
  const week = simulateOfflineTime(f, 7 * 86400_000)
  // 衰减不封顶：一周后刺激/连接都回基线，体力朝 1 恢复（约 0.268）
  assert.equal(week.stimulation, 0)
  assert.equal(week.connection, 0)
  assert.ok(week.energy > 0.26 && week.energy < 0.28, 'energy ' + week.energy)
  // 一年不叠加 6 天份的抑郁：耦合只算 24h，mood 不会穿到 -1
  const year = simulateOfflineTime(f, 365 * 86400_000)
  assert.ok(year.mood >= -0.245, 'mood 被耦合压穿，实际 ' + year.mood)
})

test('硬耦合：不再按 12 小时封顶，离线/在线同一套积分', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, energy: 0.1, mood: 0.5, stimulation: 0.0 }
  const h12 = applyHardCouplings(f, 12 * 3600_000)
  const h13 = applyHardCouplings(f, 13 * 3600_000)
  const h24 = applyHardCouplings(f, 24 * 3600_000)
  // 旧实现 12h 之后不再计息，13h 与 12h 完全相同
  assert.ok(h13.mood < h12.mood)
  // 12h ×（体力低 0.02 + 零刺激 0.01）= -0.36
  assert.ok(Math.abs((h12.mood - h24.mood) - 0.36) < 0.001)
})

test('硬耦合：被陪着会把心情/体力托起来（正向耦合）', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, energy: 0.5, mood: 0.0, stimulation: 0.5, social: 0.9, connection: 0.9 }
  const after = applyHardCouplings(f, 24 * 3600_000)
  assert.ok(Math.abs(after.mood - 0.01) < 1e-6)    // social>0.6 → +0.01/天
  assert.ok(Math.abs(after.energy - 0.512) < 1e-6)  // connection>0.6 → 恢复 ×1.5
})

test('硬耦合：体力过低会拖累心情', () => {
  const f = { ...DEFAULT_ATOMIC_FIELDS, energy: 0.1, mood: 0.5, stimulation: 0.5 }
  const after = applyHardCouplings(f, 3600_000)
  assert.ok(Math.abs(after.mood - 0.48) < 0.001)
})

test('dayKey：自然日 00:00 为日界（2026-10-31 主人拍板）', () => {
  assert.equal(dayKey(Date.parse('2026-10-29T23:59:00+08:00')), '2026-10-29')
  assert.equal(dayKey(Date.parse('2026-10-30T00:00:00+08:00')), '2026-10-30')
})

test('时钟回拨：lastActionAt 在未来时不被间隔门卡死', () => {
  const now = Date.parse('2026-10-29T12:00:00+08:00')
  const d = decideAction({
    fields: { ...DEFAULT_ATOMIC_FIELDS, stimulation: 0.1, energy: 0.9 },
    relation: 'normal',
    now,
    mem: { day: dayKey(now), actionsToday: 0, lastActionAt: now + 3600_000, lastCheckAt: now },
    rng: () => 0,
  })
  assert.notEqual(d.reason, 'gap')
})

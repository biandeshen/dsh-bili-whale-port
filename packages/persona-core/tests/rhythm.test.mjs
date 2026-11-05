import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { decideAction, restRecoveryDelta, dayKey, nextCheckDelay } from '../src/rhythm.ts'
import { decayAtomicFields } from '../src/decay.ts'

const T0 = Date.parse('2026-10-27T14:00:00+08:00')
const F = (over = {}) => ({ ...DEFAULT_ATOMIC_FIELDS, ...over })
const mem = (over = {}) => ({
  day: dayKey(T0), actionsToday: 0, lastActionAt: T0 - 86400_000, lastCheckAt: T0, lastKind: null, ...over,
})
const seeded = (seed) => {
  let s = seed >>> 0
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
}

test('rhy：刚醒不久、什么都不缺 → 继续睡着（没有到点必须醒）', () => {
  const d = decideAction({ fields: F({ stimulation: 0.7, connection: 0.6, energy: 0.7 }), relation: 'normal', now: T0, mem: mem({ lastActionAt: T0 - 3 * 3600_000 }), rng: () => 0.99 })
  assert.equal(d.act, false)
  assert.equal(d.reason, 'content')
})

test('rhy：睡够一天也会自己醒（睡眠压力，不是看钟）', () => {
  const d = decideAction({ fields: F({ stimulation: 0.7, connection: 0.6, energy: 0.7 }), relation: 'normal', now: T0, mem: mem({ lastActionAt: T0 - 24 * 3600_000 }), rng: () => 0 })
  assert.equal(d.act, true)
  assert.equal(d.kind, 'restless')
})

test('rhy：无聊且不累 → 会醒（explore）', () => {
  const d = decideAction({ fields: F({ stimulation: 0, energy: 0.7 }), relation: 'normal', now: T0, mem: mem(), rng: () => 0 })
  assert.equal(d.act, true)
  assert.equal(d.kind, 'explore')
})

test('rhy：太累就先睡，不硬撑', () => {
  const d = decideAction({ fields: F({ stimulation: 0, energy: 0.1 }), relation: 'normal', now: T0, mem: mem(), rng: () => 0 })
  assert.equal(d.act, false)
  assert.equal(d.reason, 'tired')
})

test('rhy：纯事件驱动——无间隔门、无次数上限（2026-10-30 主人裁决二）', () => {
  // 刚做完 10 秒后，欲望仍在 → 照样允许（防重入由单 timer 结构保证，不在这里）
  const now = decideAction({ fields: F({ stimulation: 0, energy: 0.7 }), relation: 'normal', now: T0, mem: mem({ lastActionAt: T0 - 10_000 }), rng: () => 0 })
  assert.notEqual(now.reason, 'gap')
  assert.notEqual(now.reason, 'cap')
  // 一天 20 次也不 cap
  const many = decideAction({ fields: F({ stimulation: 0, energy: 0.7 }), relation: 'normal', now: T0, mem: mem({ actionsToday: 20 }), rng: () => 0 })
  assert.notEqual(many.reason, 'cap')
})

test('rhy：跨天后次数清零', () => {
  const d = decideAction({
    fields: F({ stimulation: 0, energy: 0.7 }), relation: 'normal', now: T0,
    mem: mem({ day: dayKey(T0 - 86400_000), actionsToday: 3 }), rng: () => 0,
  })
  assert.equal(d.act, true)
})

test('rhy：冷战时不主动找他，但自己待烦了照样会醒', () => {
  const cold = decideAction({ fields: F({ stimulation: 0.7, connection: 0.1, energy: 0.7 }), relation: 'cold_war', now: T0, mem: mem(), rng: () => 0.99 })
  assert.equal(cold.act, false)
  const bored = decideAction({ fields: F({ stimulation: 0, connection: 0.1, energy: 0.7 }), relation: 'cold_war', now: T0, mem: mem(), rng: () => 0 })
  assert.equal(bored.act, true)
  assert.equal(bored.kind, 'explore')
})

test('rhy：睡着时体力按小时恢复，满了不溢出', () => {
  // 0.008/h（2026-11-06 从 0.005 调上来：一天 4–6 轮小事，恢复要跟得上开销）
  assert.ok(Math.abs(restRecoveryDelta(F({ energy: 0.5 }), 5) - 0.04) < 1e-9)
  assert.equal(restRecoveryDelta(F({ energy: 1 }), 24), 0)
  assert.equal(restRecoveryDelta(F({ energy: 0.5 }), 0), 0)
})

test('rhy：评估间隔带抖动，不是整点', () => {
  const a = nextCheckDelay(() => 0)
  const b = nextCheckDelay(() => 0.999)
  assert.ok(a >= 3 * 60_000 && b <= 7 * 60_000 && b > a)
})

test('rhy：等不到人的次数会随时间回落（不会永远不再找他）', () => {
  const baseMem = { lastActionAt: T0 - 5 * 3600_000, lastMissAt: T0 - 5 * 86400_000, connectMisses: 4 }
  const stale = decideAction({
    fields: F({ stimulation: 0.7, connection: 0, energy: 0.7 }), relation: 'normal', now: T0,
    mem: mem(baseMem), rng: () => 0,
  })
  // misses 4 - 5×0.5 = 1.5 → connect 压力 = 1/(1+3) = 0.25
  // 这条测的是"等不到人的次数会回落"，所以看的是 connect 这一路的分；
  // urge 是四路里最高的那一路（可能被"看点什么"顶上去），不是这条要守的东西。
  assert.ok(Math.abs(stale.scores.connect - 0.25) < 1e-9, 'connect=' + stale.scores.connect)
  const fresh = decideAction({
    fields: F({ stimulation: 0.7, connection: 0, energy: 0.7 }), relation: 'normal', now: T0,
    mem: mem({ ...baseMem, lastMissAt: T0 }), rng: () => 0,
  })
  assert.ok(fresh.scores.connect < stale.scores.connect, 'misses 没回落时 connect 应该更低')
  assert.ok(fresh.scores.connect <= 0.25 + 1e-9)
})

test('10 天模拟：醒几次、几点醒由状态+抖动决定，不跟随固定时间表', () => {
  const rng = seeded(42)
  let fields = F({ energy: 0.7, stimulation: 0.5, connection: 0.5 })
  let t = T0
  let m = mem()
  const wakes = []
  const end = T0 + 10 * 86400_000
  while (t < end) {
    t += 5 * 60_000
    fields = decayAtomicFields(fields, 5 * 60_000)
    const sinceActionH = m.lastActionAt ? (t - m.lastActionAt) / 3600_000 : Infinity
    if (sinceActionH >= 6) fields = { ...fields, energy: Math.min(1, fields.energy + restRecoveryDelta(fields, 5 / 60)) }
    if (m.day !== dayKey(t)) m = { ...m, day: dayKey(t), actionsToday: 0 }
    const d = decideAction({ fields, relation: 'normal', now: t, mem: m, rng })
    if (!d.act) continue
    wakes.push({ at: t, kind: d.kind })
    fields = { ...fields, energy: fields.energy - 0.03, stimulation: Math.min(1, fields.stimulation + 0.12) }
    m = { ...m, actionsToday: m.actionsToday + 1, lastActionAt: t, lastKind: d.kind }
  }
  assert.ok(wakes.length >= 4, '10 天只醒了 ' + wakes.length + ' 次')
  const byDay = new Map()
  for (const w of wakes) byDay.set(dayKey(w.at), (byDay.get(dayKey(w.at)) ?? 0) + 1)
  // 2026-10-30 主人裁决：不设每日上限；但体力是自然的节流阀，单日不应失控（>15 次说明体力门失效）
  assert.ok([...byDay.values()].every((n) => n <= 15), '单日失控：' + JSON.stringify([...byDay]))
  const hours = new Set(wakes.map((w) => new Date(w.at).getHours()))
  assert.ok(hours.size >= 3, '醒来时刻只有这几种：' + [...hours].join(','))
  assert.ok(wakes.some((w) => { const h = new Date(w.at).getHours(); return h < 20 || h > 23 }), '全都在 20–23 点，等于固定作息')
})

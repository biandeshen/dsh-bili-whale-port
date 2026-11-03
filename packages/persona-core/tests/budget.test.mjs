import test from 'node:test'
import assert from 'node:assert/strict'
import { applyBudgets, emptyBudget } from '../src/budget.ts'
import { dayKey } from '../src/rhythm.ts'

const T = Date.parse('2026-10-29T12:00:00+08:00')
const E = (source, field, delta) => ({ field, delta, source, priority: 5 })

test('预算：同源同场按天累计，超出部分截断', () => {
  const a = applyBudgets([E('custom', 'mood', 0.5)], emptyBudget(), T)
  assert.ok(Math.abs(a.effects[0].delta - 0.15) < 1e-9)
  assert.equal(a.clipped.length, 1)
  assert.ok(Math.abs(a.ledger.spent['custom|mood'] - 0.15) < 1e-9)

  const b = applyBudgets([E('custom', 'mood', 0.2)], a.ledger, T + 1000)
  assert.equal(b.effects.length, 0)
  assert.equal(b.clipped[0].allowed, 0)
})

test('预算：余额不足时部分生效', () => {
  const a = applyBudgets([E('custom', 'mood', 0.1)], emptyBudget(), T)
  const b = applyBudgets([E('custom', 'mood', 0.1)], a.ledger, T + 1000)
  assert.ok(Math.abs(b.effects[0].delta - 0.05) < 1e-9)
})

test('预算：不同场独立计费', () => {
  const a = applyBudgets([E('custom', 'mood', 0.15)], emptyBudget(), T)
  const b = applyBudgets([E('custom', 'curiosity', 0.15)], a.ledger, T + 1000)
  assert.ok(Math.abs(b.effects[0].delta - 0.15) < 1e-9)
  assert.equal(b.clipped.length, 0)
})

test('预算：负向同样计费（防止刷负面）', () => {
  const a = applyBudgets([E('custom', 'mood', -0.5)], emptyBudget(), T)
  assert.ok(Math.abs(a.effects[0].delta + 0.15) < 1e-9)
  const b = applyBudgets([E('custom', 'mood', -0.1)], a.ledger, T + 1000)
  assert.equal(b.effects.length, 0)
})

test('预算：换日清零（自然日 00:00 日界）', () => {
  const a = applyBudgets([E('custom', 'mood', 0.15)], emptyBudget(), T)
  const next = T + 86400_000
  assert.notEqual(dayKey(T), dayKey(next))
  const b = applyBudgets([E('custom', 'mood', 0.15)], a.ledger, next)
  assert.ok(Math.abs(b.effects[0].delta - 0.15) < 1e-9)
  assert.equal(b.clipped.length, 0)
})

test('预算：decay 无上限', () => {
  const a = applyBudgets([E('decay', 'mood', -0.9)], emptyBudget(), T)
  assert.ok(Math.abs(a.effects[0].delta + 0.9) < 1e-9)
  assert.equal(a.clipped.length, 0)
})

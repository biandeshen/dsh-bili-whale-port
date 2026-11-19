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

test('预算：action/rest 不设上限——身体收支不是可刷的输入（2026-11-06 首夜实锤）', () => {
  // 线上实锤：action 预算 0.20 在第 13 笔 life_do 花完后，收据里的 energy
  // 冻结在 0.8014——"累了就歇"的反馈链断了（体力永远耗不干 = 变相配额）。
  // 30 笔 × 0.015 = 0.45，全部必须生效。
  let ledger = emptyBudget()
  for (let i = 0; i < 30; i++) {
    const r = applyBudgets([E('action', 'energy', -0.015)], ledger, T + i * 60_000)
    assert.equal(r.effects.length, 1, `第 ${i + 1} 笔行动开销不得被预算截断`)
    assert.ok(Math.abs(r.effects[0].delta + 0.015) < 1e-9)
    assert.equal(r.clipped.length, 0)
    ledger = r.ledger
  }
  // rest 同理：睡眠恢复是身体自己的进账，一天回多少都照算
  const r2 = applyBudgets([E('rest', 'energy', 0.4)], emptyBudget(), T)
  assert.ok(Math.abs(r2.effects[0].delta - 0.4) < 1e-9)
  assert.equal(r2.clipped.length, 0)
  // 防刷的初衷不放松：模型可反复填 delta 的来源仍然受限
  const r3 = applyBudgets([E('custom', 'mood', 0.5)], emptyBudget(), T)
  assert.equal(r3.clipped.length, 1)
})

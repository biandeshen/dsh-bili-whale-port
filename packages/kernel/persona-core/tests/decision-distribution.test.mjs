// B 侧 decideAction 的分布检查 —— 合并报告"未查清第 8 条"。
//
// 背景：A 侧（cognition-core）发现 decide() 在真实数据上恒定输出 resume。
// 本组对 B 侧的 decideAction（urge + CHECK_PROB 概率门）做同款检查，
// 结论写进 docs/MERGED-ANALYSIS-2026-11-14.md §7 第 8 条。
//
// **实测结论：B 侧不是"恒定"，而是"反向退化"** ——
// 场值全满（最不该动）时一天醒 57 次，比低体力时（27 次）更多，urge=1。
import test from 'node:test'
import assert from 'node:assert/strict'
import { activityDrive } from '../src/life-activities.ts'
import { decideAction, restRecoveryDelta, dayKey } from '../src/rhythm.ts'
import { decayAtomicFields } from '../src/decay.ts'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'

const T0 = Date.parse('2026-11-13T23:38:00+08:00')
const F = (o = {}) => ({ ...DEFAULT_ATOMIC_FIELDS, ...o })
const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

/** 跑一天（288 拍 × 5 分钟），返回行动列表与 reason 分布。 */
function simulateDay(seed, startFields) {
  const rng = seeded(seed)
  let f = F(startFields)
  let m = { day: dayKey(T0), actionsToday: 0, lastActionAt: T0 - 3_600_000, lastCheckAt: T0, lastKind: null }
  const acts = []
  const dist = {}
  let t = T0
  for (let i = 0; i < 288; i++) {
    t += 5 * 60_000
    f = decayAtomicFields(f, 5 * 60_000)
    const sinceH = m.lastActionAt ? (t - m.lastActionAt) / 3_600_000 : Infinity
    if (sinceH >= 6) f = { ...f, energy: Math.min(1, f.energy + restRecoveryDelta(f, 5 / 60)) }
    if (m.day !== dayKey(t)) m = { ...m, day: dayKey(t), actionsToday: 0 }
    const d = decideAction({ fields: f, relation: 'normal', now: t, mem: m, rng })
    const key = d.act ? 'act:' + d.kind : d.reason
    dist[key] = (dist[key] || 0) + 1
    if (d.act) {
      acts.push({ at: t, kind: d.kind, urge: d.urge })
      f = { ...f, energy: f.energy - 0.015, stimulation: Math.min(1, f.stimulation + 0.02) }
      m = { ...m, actionsToday: m.actionsToday + 1, lastActionAt: t, lastKind: d.kind }
    }
  }
  return { acts, dist }
}

test('B 侧决策不是恒定输出（与 A 侧的恒定 resume 不同）', () => {
  const { acts, dist } = simulateDay(42, { energy: 0.94, stimulation: 0.19, connection: 0.5 })
  assert.ok(acts.length > 0, '一天里应该有行动')
  assert.ok(dist.content > 0 || dist.tired > 0, '应该有"不行动"的拍（不是每拍都动）')
  // 至少有 act 与不 act 两种，说明闸门不是恒定
  const kinds = new Set(acts.map((a) => a.kind))
  assert.ok(kinds.size >= 1)
  const urges = new Set(acts.map((a) => +a.urge.toFixed(2)))
  assert.ok(urges.size > 5, `urge 取值应该连续变化，实际只有 ${urges.size} 种`)
})

test('**已登记缺陷**：场值全满时 activityDrive 反而最高（1.000）', () => {
  // 这是本组查出的真实问题，不是待修代码的测试。
  // scoreActivity 里 consume = clamp01((stimulation-0.15)*1.5)，
  // stimulation=1.0 → 1.275 → clamp 到 1.0；exercise 同理 1.35 → 1.0。
  // 于是"很满足"这个最不需要活动的状态，驱动分最高。
  const full = activityDrive(F({ energy: 1, stimulation: 1, connection: 1 }))
  const empty = activityDrive(F({ energy: 1, stimulation: 0, connection: 0 }))
  const neutral = activityDrive(F({ energy: 0.5, stimulation: 0.5, connection: 0.5 }))

  assert.equal(+full.toFixed(3), 1.0, '全满时驱动分应（按当前实现）是 1.0')
  assert.ok(full > empty,
    `全满(${full}) 竟高于全空(${empty}) —— 驱动方向反了：`
    + '满足状态下比匮乏状态下更想动，是把"参与度"记成了"需求"')
  assert.ok(full > neutral, '全满也高于中性')
})

test('**已登记缺陷的后果**：全满场值下一整天的唤醒次数多于低体力时', () => {
  const rich = simulateDay(99, { energy: 1.0, stimulation: 1.0, connection: 1.0 })
  const poor = simulateDay(7, { energy: 0.5, stimulation: 0.2, connection: 0.2 })
  assert.ok(rich.acts.length > poor.acts.length,
    `全满(${rich.acts.length} 次) 竟比低体力(${poor.acts.length} 次) 醒得更多 —— `
    + '这正是"越不饿越吃"的形状，与 A 侧"永远 resume"是一对镜像缺陷')
})

test('驱动曲线呈 U 形：谷底在场值中段，两端都高', () => {
  const at = (s) => activityDrive(F({ energy: 0.7, stimulation: s, connection: 0.5 }))
  const v0 = at(0), v04 = at(0.4), v1 = at(1.0)
  assert.ok(v04 < v0, `谷底应低于"很无聊"端：at(0.4)=${v04.toFixed(3)} vs at(0)=${v0.toFixed(3)}`)
  assert.ok(v04 < v1, `谷底应低于"很满足"端：at(0.4)=${v04.toFixed(3)} vs at(1.0)=${v1.toFixed(3)}`)
  // 记录精确形状，供报告引用
  assert.ok(Math.abs(v04 - 0.375) < 0.01, `谷底值实测约 0.375，实际 ${v04.toFixed(3)}`)
})

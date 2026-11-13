/**
 * 只读归因探针：宿主 rhythm.test.mjs 的「10 天模拟」在本仓真内核上判红（首日 18 次 > 15）。
 * 问：是体力门失效，还是 ≤15 这条界限本身按旧参数标定的？
 *
 * 做法：照抄那条测试的模拟循环（**不改内核、不改测试**），把每次醒的 energy 与每个 reason 的拍数记下来，
 * 同一份循环分别喂两份内核（本仓真内核 / 宿主旧副本）做对照。
 *
 * 只写临时目录都不需要——本脚本不落任何文件，只打印。零模型调用。
 *
 * 用法：
 *   node --import tsx docs/evidence/probes/rhythm-attrib.mjs               # 本仓真内核
 *   PROBE_KERNEL=host node --import tsx docs/evidence/probes/rhythm-attrib.mjs   # 宿主旧副本
 */
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { hostRoot } from '../../../scripts/lib/host-root.mjs'

const WHALE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..')
const ROOT = process.env.PROBE_KERNEL === 'host'
  ? path.join(hostRoot(), 'persona-core', 'src')
  : path.join(WHALE, 'packages', 'persona-core', 'src')
const K = pathToFileURL(ROOT).href + '/'
console.log('内核=' + ROOT.replace(/\\/g, '/'))

const { decideAction, restRecoveryDelta, dayKey, NEXT_CHECK_MIN_MS, NEXT_CHECK_MAX_MS, REST_RECOVERY_PER_HOUR, ACTION_COST_ENERGY } = await import(K + 'rhythm.ts')
const { decayAtomicFields } = await import(K + 'decay.ts')
const { DEFAULT_ATOMIC_FIELDS } = await import(K + 'types.ts')

// 与宿主 persona-core/tests/rhythm.test.mjs:7-15 逐字同口径
const T0 = Date.parse('2026-10-27T14:00:00+08:00')
const F = (over = {}) => ({ ...DEFAULT_ATOMIC_FIELDS, ...over })
const mem = (over = {}) => ({ day: dayKey(T0), actionsToday: 0, lastActionAt: T0 - 86400_000, lastCheckAt: T0, lastKind: null, ...over })
const seeded = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

const rng = seeded(42)
let fields = F({ energy: 0.7, stimulation: 0.5, connection: 0.5 })
let t = T0
let m = mem()
const wakes = []
const reasons = new Map()
const end = T0 + 10 * 86400_000
while (t < end) {
  t += 5 * 60_000
  fields = decayAtomicFields(fields, 5 * 60_000)
  const sinceActionH = m.lastActionAt ? (t - m.lastActionAt) / 3600_000 : Infinity
  if (sinceActionH >= 6) fields = { ...fields, energy: Math.min(1, fields.energy + restRecoveryDelta(fields, 5 / 60)) }
  if (m.day !== dayKey(t)) m = { ...m, day: dayKey(t), actionsToday: 0 }
  const d = decideAction({ fields, relation: 'normal', now: t, mem: m, rng })
  // act=true 时 reason 是活动描述文案，按 'act' 归一类，免得刷屏
  const key = d.act ? 'act' : d.reason
  reasons.set(key, (reasons.get(key) ?? 0) + 1)
  if (!d.act) continue
  wakes.push({ at: t, day: dayKey(t), kind: d.kind, energyBefore: +fields.energy.toFixed(4), urge: +d.urge.toFixed(3) })
  fields = { ...fields, energy: fields.energy - 0.03, stimulation: Math.min(1, fields.stimulation + 0.12) }
  m = { ...m, actionsToday: m.actionsToday + 1, lastActionAt: t, lastKind: d.kind }
}

const byDay = new Map()
for (const w of wakes) byDay.set(w.day, (byDay.get(w.day) ?? 0) + 1)
const ticks = [...reasons.values()].reduce((a, b) => a + b, 0)
console.log('内核常量：评估间隔=' + NEXT_CHECK_MIN_MS / 1000 + '–' + NEXT_CHECK_MAX_MS / 1000 + 's  睡着恢复=' + REST_RECOVERY_PER_HOUR + '/h  行动开销=' + ACTION_COST_ENERGY)
console.log('总醒次数=' + wakes.length + ' / 总拍数=' + ticks)
console.log('逐日=' + JSON.stringify([...byDay]))
console.log('reason 拍数分布=' + JSON.stringify([...reasons]))
console.log('tired 门阈值：energy < 0.45*(1-0.6) = ' + (0.45 * 0.4).toFixed(4))
const firstDay = [...byDay.keys()][0]
const first = wakes.filter((w) => w.day === firstDay)
console.log('首日每次醒的 energy（前→后）=' + first.map((w) => w.energyBefore).join(' → '))
console.log('首日最后一次醒后 energy=' + (first.length ? (first[first.length - 1].energyBefore - 0.03).toFixed(4) : 'n/a'))
console.log('--- 归因 ---')
console.log('首日醒 ' + first.length + ' 次；tired 拍数=' + (reasons.get('tired') ?? 0) + '（占 ' + (((reasons.get('tired') ?? 0) / ticks) * 100).toFixed(1) + '%）')
console.log('判据：tired 拍数≈0 ⇒ 体力门根本没被触发，「单日 ≤15」这条界限在这种参数下不构成约束；')
console.log('      tired 拍数占绝大多数且首日末 energy 恰好落到阈值下 ⇒ 门在起作用，18 是「一箱体力能撑几轮」的算术结果。')
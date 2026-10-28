/**
 * 离线模拟 30 天作息：醒来时刻由场值 + 抖动决定（不联网、不触发真实唤醒）。
 * 逻辑与 src/worlds/bili-account/definition.ts 的 rhythmTick 对齐（connect 失约计数 + 一天一次的"又没等到"）。
 * 用法：cd ../Cortico && node --import tsx ../dsh-bili-whale/scripts/simulate-rhythm.mjs [seed]
 */
const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const base = 'file:///' + CORTICO.replace(/\\/g, '/')
const { decideAction, restRecoveryDelta, dayKey, ACTION_COST_ENERGY } = await import(base + '/persona-core/src/rhythm.ts')
const { simulateOfflineTime } = await import(base + '/persona-core/src/decay.ts')
const { DEFAULT_ATOMIC_FIELDS } = await import(base + '/persona-core/src/types.ts')
const { createInitialState, deriveNPCState } = await import(base + '/persona-core/src/npc-state-machine.ts')
const { applyBudgets, emptyBudget } = await import(base + '/persona-core/src/budget.ts')

const seed = Number(process.argv[2] || 42)
let s = seed >>> 0
const rng = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
const pad = (n) => String(n).padStart(2, '0')
const fmt = (t) => { const d = new Date(t); return `${pad(d.getHours())}:${pad(d.getMinutes())}` }

const DAYS = 30
const STEP = 5 * 60_000
const start = Date.parse('2026-10-28T00:00:00+08:00')
let fields = { ...DEFAULT_ATOMIC_FIELDS }
let npc = createInitialState()
let t = start
let mem = { day: dayKey(t), actionsToday: 0, lastActionAt: 0, lastCheckAt: t, lastKind: null, connectMisses: 0, lastSilentDay: null }
let budget = emptyBudget()
const clampF = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
const applyEvents = (events) => {
  const b = applyBudgets(events, budget, t)
  budget = b.ledger
  for (const e of b.effects) fields = { ...fields, [e.field]: clampF(fields[e.field] + e.delta, e.field === 'mood' ? -1 : 0, 1) }
}
const byDay = new Map()

const daily = new Map()
while (t < start + DAYS * 86400_000) {
  t += STEP
  fields = simulateOfflineTime(fields, STEP)
  // 与 definition.ts 对齐：一轮行动后至少 6h 无动作才算睡着，睡着才回体力
  const sinceActionH = mem.lastActionAt ? (t - mem.lastActionAt) / 3600_000 : Infinity
  const asleep = sinceActionH >= 6
  if (asleep) applyEvents([{ field: 'energy', delta: restRecoveryDelta(fields, STEP / 3600_000), source: 'rest', priority: 2 }])
  npc = deriveNPCState(fields, npc, t, false).newState
  if (mem.day !== dayKey(t)) mem = { ...mem, day: dayKey(t), actionsToday: 0 }
  const cur = daily.get(dayKey(t)) ?? { moodSum: 0, n: 0, moodMin: 1, moodMax: -1, energySum: 0, asleep: 0 }
  cur.moodSum += fields.mood; cur.n++; cur.moodMin = Math.min(cur.moodMin, fields.mood); cur.moodMax = Math.max(cur.moodMax, fields.mood); cur.energySum += fields.energy
  if (asleep) cur.asleep++
  daily.set(dayKey(t), cur)
  const d = decideAction({ fields, relation: npc.current, now: t, mem, rng })
  if (!d.act) continue
  if (!byDay.has(dayKey(t))) byDay.set(dayKey(t), [])
  byDay.get(dayKey(t)).push({ at: fmt(t), kind: d.kind, energy: fields.energy.toFixed(2), relation: npc.current })
  const events = [
    { field: 'energy', delta: -ACTION_COST_ENERGY, source: 'action', priority: 5 },
    { field: 'stimulation', delta: 0.02, source: 'action', priority: 5 },
  ]
  // 看完一轮视频（bili_mood_apply preset=watchedVideo）的真实增量
  if (d.kind === 'explore') {
    events.push(
      { field: 'curiosity', delta: 0.03, source: 'watched', priority: 5 },
      { field: 'stimulation', delta: 0.12, source: 'watched', priority: 5 },
      { field: 'mood', delta: 0.05, source: 'watched', priority: 4 },
      { field: 'energy', delta: -0.02, source: 'watched', priority: 3 },
    )
  }
  // 从没人回过她 → 每新的一天，等不到就掉一次心情
  if (d.kind === 'connect' && mem.lastSilentDay !== dayKey(t)) {
    events.push(
      { field: 'connection', delta: -0.05, source: 'silence', priority: 8 },
      { field: 'mood', delta: -0.03, source: 'silence', priority: 8 },
    )
    mem.lastSilentDay = dayKey(t)
  }
  applyEvents(events)
  mem = { ...mem, actionsToday: mem.actionsToday + 1, lastActionAt: t, lastKind: d.kind }
  if (d.kind === 'connect') {
    mem.connectMisses = (mem.connectMisses ?? 0) + 1
    mem.lastMissAt = t
    npc = deriveNPCState(fields, npc, t, false).newState
  }
}

let total = 0
const hours = []
const kinds = {}
for (let i = 0; i < DAYS; i++) {
  const day = dayKey(start + i * 86400_000 + 6 * 3600_000)
  const list = byDay.get(day) || []
  total += list.length
  for (const w of list) { hours.push(Number(w.at.slice(0, 2))); kinds[w.kind] = (kinds[w.kind] ?? 0) + 1 }
  const st = daily.get(day)
  const m = st ? `心情 均${(st.moodSum / st.n).toFixed(2)} [${st.moodMin.toFixed(2)},${st.moodMax.toFixed(2)}] 体力 均${(st.energySum / st.n).toFixed(2)} 睡${Math.round(st.asleep * STEP / 3600_000)}h` : '无样本'
  console.log(day + '  ' + m + '  ' + (list.length ? list.map((w) => `${w.at}(${w.kind},体力${w.energy})`).join('  ') : '—— 没动（发呆/在歇）'))
}
const daysWithWake = [...byDay.keys()].length
console.log(`\nseed=${seed} · ${DAYS} 天共行动 ${total} 次（${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join('，')}）· 有行动的天数 ${daysWithWake}/${DAYS}`)
console.log(`行动时段分布：${[...new Set(hours)].sort((a, b) => a - b).map((h) => pad(h) + '点').join('、')}`)
console.log(`最终：connection=${fields.connection.toFixed(2)} mood=${fields.mood.toFixed(2)} 关系=${npc.current}`)

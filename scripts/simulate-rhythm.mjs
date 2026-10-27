/**
 * 离线模拟 30 天作息：醒来时刻由场值 + 抖动决定（不联网、不触发真实唤醒）。
 * 逻辑与 src/worlds/bili-account/definition.ts 的 rhythmTick 对齐（connect 失约计数 + 一天一次的"又没等到"）。
 * 用法：cd ../Cortico && node --import tsx ../dsh-bili-whale/scripts/simulate-rhythm.mjs [seed]
 */
const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const base = 'file:///' + CORTICO.replace(/\\/g, '/')
const { decideWake, restRecoveryDelta, dayKey } = await import(base + '/persona-core/src/rhythm.ts')
const { simulateOfflineTime } = await import(base + '/persona-core/src/decay.ts')
const { DEFAULT_ATOMIC_FIELDS } = await import(base + '/persona-core/src/types.ts')
const { createInitialState, deriveNPCState } = await import(base + '/persona-core/src/npc-state-machine.ts')

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
let mem = { day: dayKey(t), wakesToday: 0, lastWakeAt: 0, lastCheckAt: t, lastKind: null, connectMisses: 0, lastSilentDay: null }
const byDay = new Map()

while (t < start + DAYS * 86400_000) {
  t += STEP
  fields = simulateOfflineTime(fields, STEP)
  fields = { ...fields, energy: Math.min(1, fields.energy + restRecoveryDelta(fields, STEP / 3600_000)) }
  npc = deriveNPCState(fields, npc, t, false).newState
  if (mem.day !== dayKey(t)) mem = { ...mem, day: dayKey(t), wakesToday: 0 }
  const d = decideWake({ fields, relation: npc.current, now: t, mem, rng })
  if (!d.wake) continue
  if (!byDay.has(dayKey(t))) byDay.set(dayKey(t), [])
  byDay.get(dayKey(t)).push({ at: fmt(t), kind: d.kind, energy: fields.energy.toFixed(2), relation: npc.current })
  fields = { ...fields, energy: fields.energy - 0.03, stimulation: Math.min(1, fields.stimulation + 0.12) }
  mem = { ...mem, wakesToday: mem.wakesToday + 1, lastWakeAt: t, lastKind: d.kind }
  if (d.kind === 'connect') {
    mem.connectMisses = (mem.connectMisses ?? 0) + 1
    // 从没人回过她 → 每新的一天，等不到就掉一次心情
    if (mem.lastSilentDay !== dayKey(t)) {
      fields = { ...fields, connection: Math.max(0, fields.connection - 0.05), mood: Math.max(-1, fields.mood - 0.03) }
      mem.lastSilentDay = dayKey(t)
    }
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
  console.log(day + '  ' + (list.length ? list.map((w) => `${w.at}(${w.kind},体力${w.energy})`).join('  ') : '—— 没醒（发呆/在睡）'))
}
const daysWithWake = [...byDay.keys()].length
console.log(`\nseed=${seed} · ${DAYS} 天共醒 ${total} 次（${Object.entries(kinds).map(([k, n]) => k + ' ' + n).join('，')}）· 有醒来的天数 ${daysWithWake}/${DAYS}`)
console.log(`醒来时段分布：${[...new Set(hours)].sort((a, b) => a - b).map((h) => pad(h) + '点').join('、')}`)
console.log(`最终：connection=${fields.connection.toFixed(2)} mood=${fields.mood.toFixed(2)} 关系=${npc.current}`)

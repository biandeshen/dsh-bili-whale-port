/**
 * C2 离线验证：关机前 arm（预登记），开机后 verify（按裁决 7 步核对）。
 *
 *   node scripts/c2-offline.mjs arm      # 关机前跑：记录 T0，并给 D0/D1 预登记 expected.json
 *   node scripts/c2-offline.mjs verify   # 开机后跑：>=8h、跨 00:00、健康、日报告、行动上限
 *   node scripts/c2-offline.mjs verify --skip-health   # 演练用
 *
 * 裁决见 docs/evidence/C2-DECISION-2026-10-29.md
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'
import { largestOfflineGap, readTickTimes } from '../tools/lib/offline-gap.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const DAYS = path.join(WHALE_HOME, 'bili-whale', 'days')
const CFG = path.join(CONTROL, 'c2.json')
const RESULT = path.join(CONTROL, 'c2-result.json')
const CANARY = path.join(CONTROL, 'canary.json')
const MIN_HOURS = 8

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const writeAtomic = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true })
  const tmp = f + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(o, null, 2) + '\n')
  fs.renameSync(tmp, f)
}
const logicalDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE') // 自然日
const addDays = (day, n) => new Date(Date.parse(day) + n * 86400_000).toLocaleDateString('sv-SE')
const run = (script, args = []) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { encoding: 'utf8', timeout: 120000 })

const cmd = process.argv[2]

if (cmd === 'arm') {
  const now = Date.now()
  const d0 = logicalDay(now)
  const d1 = addDays(d0, 1)
  const fields = readJson(path.join(WHALE_HOME, 'bili-whale', 'fields.json'))
  const life = readJson(path.join(CONTROL, 'life.json'))
  writeAtomic(CFG, {
    armedAt: new Date(now).toISOString(),
    expectedDays: [d0, d1],
    minHours: MIN_HOURS,
    baseline: {
      lastAppliedAt: fields?.lastAppliedAt ?? null,
      actionsToday: life?.actionsToday ?? null,
      lastActionAt: life?.lastActionAt ?? null,
    },
  })
  // 事前预登记：离线窗口内的 missed/late/tick-gap 属预期
  for (const d of [d0, d1]) {
    writeAtomic(path.join(DAYS, d, 'expected.json'), {
      allowFlags: ['missed', 'late', 'tick-gap'],
      reason: 'C2 offline window（关机前预登记）',
      requiresC2Result: true,
      armedAt: new Date(now).toISOString(),
    })
  }
  console.log(JSON.stringify({ ok: true, armedAt: new Date(now).toISOString(), expectedDays: [d0, d1], next: '关机 >=8h；开机后跑 verify' }, null, 2))
  process.exit(0)
}

if (cmd !== 'verify') {
  console.log('用法：node scripts/c2-offline.mjs arm | verify [--skip-health]')
  process.exit(2)
}

const cfg = readJson(CFG)
if (!cfg?.armedAt) {
  console.log(JSON.stringify({ ok: false, error: 'not-armed', hint: '关机前先跑 arm' }, null, 2))
  process.exit(2)
}
const armedAt = Date.parse(cfg.armedAt)
const now = Date.now()
const hours = (now - armedAt) / 3600_000
const checks = []
const add = (name, ok, detail) => checks.push({ name, ok, detail })

add('离线 ≥8h（arm→now）', hours >= MIN_HOURS, `${hours.toFixed(2)}h`)
// 真正的验收：tick 时间线里必须有一段 ≥8h 的空窗，且这段空窗跨过 00:00（自然日界）。
// 只看 arm→now 的耗时会把“arm 了但服务一直跑”误判成离线。
const tickTimes = readTickTimes(DAYS, cfg.expectedDays)
const gap = largestOfflineGap(tickTimes, { armedAt, now })
const gapHours = gap.ms / 3600_000
add('真实离线空窗 ≥8h', gap.ms >= MIN_HOURS * 3600_000,
  `${gapHours.toFixed(2)}h [${new Date(gap.from).toLocaleString()} → ${new Date(gap.to).toLocaleString()}]（${tickTimes.length} 条 tick）`)
add('空窗跨 00:00 日界', gap.crossed, gap.crossed ? 'yes' : 'no')

if (!process.argv.includes('--skip-health')) {
  const h = run('cortico-health.mjs')
  add('health 通过', h.status === 0, h.status === 0 ? '5 项全过' : String(h.stdout || h.stderr).slice(-300))
}

for (const d of cfg.expectedDays ?? []) {
  const r = run('day-report.mjs', ['--date', d, '--expect-offline'])
  add(`day-report ${d}`, r.status === 0, r.status === 0 ? '仅预期 flag' : String(r.stdout || r.stderr).slice(-300))
  const ticks = path.join(DAYS, d, 'ticks.jsonl')
  if (fs.existsSync(ticks)) {
    const lines = fs.readFileSync(ticks, 'utf8').trim().split('\n').filter(Boolean)
    let lastOk = true
    try { JSON.parse(lines[lines.length - 1]) } catch { lastOk = false }
    add(`ticks 末行可解析 ${d}`, lastOk, `${lines.length} 条`)
  }
}

const life = readJson(path.join(CONTROL, 'life.json'))
add('单日行动记录存在', life?.actionsToday !== undefined, `actionsToday=${life?.actionsToday ?? '?'}（2026-10-30 起无每日上限，欲望驱动）`)

const bad = checks.filter((c) => !c.ok)
const out = { ok: bad.length === 0, verifiedAt: new Date(now).toISOString(), hours: Number(hours.toFixed(2)), crossed: gap.crossed, offlineGapHours: Number(gapHours.toFixed(2)), checks }
writeAtomic(RESULT, out)

if (out.ok) {
  const canary = readJson(CANARY) ?? {}
  canary.C2 = { status: 'pass', at: out.verifiedAt, evidence: 'control/c2-result.json', detail: `offline gap ${out.offlineGapHours}h, crossed04=${gap.crossed}` }
  writeAtomic(CANARY, canary)
}

console.log(JSON.stringify(out, null, 2))
process.exit(out.ok ? 0 : 1)

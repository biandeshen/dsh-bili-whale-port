/**
 * 进程外看门狗：每 5 分钟给"她的一天"打一个 tick，并标记缺天/停摆。
 *
 *   node scripts/day-watchdog.mjs            # 常驻
 *   node scripts/day-watchdog.mjs --once     # 只跑一轮（测试/手动）
 *   node scripts/day-watchdog.mjs --audit    # 启动时回看 14 天，把缺失日标为 missed
 *
 * 它不生成草稿、不改人格状态，只读状态 + 写 days/ 与日志。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'
import { tick, seed, logicalDay, daysDir } from './day-snapshot.mjs'

const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const LOCK = path.join(CONTROL, 'day-watchdog.pid')
const LOG = path.join(CONTROL, 'day-watchdog.log')
const DAYS_ROOT = path.join(WHALE_HOME, 'bili-whale', 'days')
const INTERVAL_MS = Number(process.argv.includes('--interval') ? process.argv[process.argv.indexOf('--interval') + 1] : 300) * 1000
const ONCE = process.argv.includes('--once')
const AUDIT = process.argv.includes('--audit')

function log(line) {
  try {
    fs.mkdirSync(CONTROL, { recursive: true })
    fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${line}\n`, 'utf8')
  } catch {}
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

function acquireLock() {
  try {
    fs.mkdirSync(CONTROL, { recursive: true })
    fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' })
    return true
  } catch {
    try {
      const pid = Number(fs.readFileSync(LOCK, 'utf8'))
      if (pid && pidAlive(pid)) return false
      fs.unlinkSync(LOCK)
      fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' })
      return true
    } catch { return false }
  }
}

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function writeAtomic(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

function markFlag(day, flag, reason) {
  const dir = daysDir(day)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, 'day.json')
  const cur = readJson(file) || { day, createdAt: new Date().toISOString(), tickCount: 0, wakes: 0, mood: { min: null, max: null, last: null }, drafts: [], flags: { missed: false, late: false, tainted: false, taintReasons: [] } }
  cur.flags = cur.flags || { missed: false, late: false, tainted: false, taintReasons: [] }
  if (!cur.flags.taintReasons) cur.flags.taintReasons = []
  if (!cur.flags[flag]) {
    cur.flags[flag] = true
    cur.flags.taintReasons.push(`${new Date().toISOString()} ${reason}`)
    writeAtomic(file, cur)
    log(`flag ${flag} on ${day}: ${reason}`)
  }
}

function lastTickAt(day) {
  try {
    const lines = fs.readFileSync(path.join(daysDir(day), 'ticks.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
    if (!lines.length) return null
    return Date.parse(JSON.parse(lines[lines.length - 1]).at)
  } catch { return null }
}

/** 启动时回看 14 天：缺失的日期只标 missed，不伪造任何 state。 */
function audit(days = 14) {
  const now = Date.now()
  for (let i = 0; i < days; i += 1) {
    const day = logicalDay(now - i * 86400_000)
    const dir = daysDir(day)
    if (!fs.existsSync(dir)) {
      markFlag(day, 'missed', 'watchdog audit: 该日没有任何快照（机器关机/未运行）')
      const incident = path.join(dir, 'incident.md')
      if (!fs.existsSync(incident)) {
        fs.writeFileSync(incident, `# ${day} 事件记录\n\n- 看门狗审计：该日无任何快照，判定为 missed（未运行）。\n`, 'utf8')
      }
    }
  }
}

function once() {
  const now = Date.now()
  const day = logicalDay(now)
  seed(now, day)
  const r = tick(now, day)
  const hhmm = new Date(now).toLocaleTimeString('sv-SE').slice(0, 5)
  // 04:30 后仍无 state.start → missed（正常情况 seed 已建，这里防 seed 失败）
  if (hhmm >= '04:30' && !fs.existsSync(path.join(daysDir(day), 'state.start.json'))) {
    markFlag(day, 'missed', '04:30 后仍无 state.start')
  }
  // 超过 2 小时没有 tick → late（机器休眠/看门狗被杀）
  const last = lastTickAt(day)
  if (last && now - last > 2 * 3600_000) markFlag(day, 'late', `距上次 tick ${Math.round((now - last) / 60000)} 分钟`)
  log(`tick ${day} count=${r.tickCount}`)
  return r
}

if (AUDIT) audit(14)

if (ONCE) {
  const r = once()
  console.log(JSON.stringify({ ok: true, ...r }, null, 2))
  process.exit(0)
}

if (!acquireLock()) {
  console.log(JSON.stringify({ ok: false, error: 'another watchdog is running', lock: LOCK }))
  process.exit(0)
}

log(`start pid=${process.pid} interval=${INTERVAL_MS}ms`)
const timer = setInterval(() => {
  try { once() } catch (e) { log('tick failed: ' + String(e?.message ?? e)) }
}, INTERVAL_MS)
process.on('SIGINT', () => { clearInterval(timer); try { fs.unlinkSync(LOCK) } catch {}; process.exit(0) })
process.on('SIGTERM', () => { clearInterval(timer); try { fs.unlinkSync(LOCK) } catch {}; process.exit(0) })

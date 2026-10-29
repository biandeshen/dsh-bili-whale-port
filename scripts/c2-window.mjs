/**
 * C2 计划离线窗：定时停 → 定时起。
 *
 *   node scripts/c2-window.mjs stop [--dry]     # arm + 优雅停 Cortico + 停看门狗
 *   node scripts/c2-window.mjs start [--dry]    # 收尾离线日 + 起 Cortico/看门狗 + health
 *   node scripts/c2-window.mjs verify [--dry]   # 恢复后跑 c2-offline verify
 *
 * 只由一次性计划任务调用；不常驻。停之前必须 arm，这样 expected.json 才会预登记。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { DSH_HOME } from '../tools/lib/paths.mjs'
import { closeFromLastTick } from './day-snapshot.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CONTROL = path.join(DSH_HOME, 'bili-whale', 'control')
const LOG = path.join(CONTROL, 'c2-window.log')
const C2 = path.join(CONTROL, 'c2.json')
const SKIPPED = path.join(CONTROL, 'c2-window-skipped.json')
const CORTICO_PID = path.join(CONTROL, 'cortico.pid')
const WATCHDOG_PID = path.join(CONTROL, 'day-watchdog.pid')
const NODE = process.execPath
const cmd = process.argv[2]
const dry = process.argv.includes('--dry')
const logicalDay = (now = Date.now()) => new Date(now - 4 * 3600_000).toLocaleDateString('sv-SE')

const LEGACY_DRAFTS = 'D:/AI/养鱼/drafts'
function draftsDir() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const isDefault = path.resolve(DSH_HOME).toLowerCase() === path.resolve(home, '.dsh').toLowerCase()
  return process.env.WHALE_DRAFTS || (isDefault && fs.existsSync(LEGACY_DRAFTS) ? LEGACY_DRAFTS : path.join(DSH_HOME, 'bili-whale', 'drafts'))
}
/** 当天有带 diaryHash 的稿，C2 的 day-report 才有基础；没有就别停，停了也过不了。 */
function validDraftToday(day) {
  const d = readJson(path.join(draftsDir(), day + '.json'))
  return !!d && d.date === day && !!d.diaryHash && d.degraded !== true
}

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  try { fs.mkdirSync(CONTROL, { recursive: true }); fs.appendFileSync(LOG, line + '\n') } catch {}
  console.log(line)
}
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
function pidFrom(file) {
  try { return Number(fs.readFileSync(file, 'utf8').trim()) || 0 } catch { return 0 }
}
function kill(pid, label) {
  if (!Number.isInteger(pid) || pid <= 0) return
  if (dry) { log(`[dry] taskkill ${label} pid=${pid}`); return }
  const r = spawnSync('taskkill', ['/PID', String(pid), '/F'], { encoding: 'utf8', windowsHide: true })
  log(`taskkill ${label} pid=${pid}: ${String(r.stdout || r.stderr).trim().slice(0, 120)}`)
}
async function health(ms = 120000) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch('http://127.0.0.1:7799/api/status', { signal: AbortSignal.timeout(1500) })
      if (r.ok) return true
    } catch {}
    await new Promise((r) => setTimeout(r, 1000))
  }
  return false
}

if (cmd === 'stop') {
  const today = logicalDay()
  if (!dry && !process.env.C2_FORCE_STOP && !validDraftToday(today)) {
    fs.writeFileSync(SKIPPED, JSON.stringify({ at: new Date().toISOString(), day: today, reason: 'no-draft-with-diaryHash' }, null, 2) + '\n')
    log(`skip: ${today} 还没有带 diaryHash 的稿，停了也过不了 C2；保留她的行动窗口（强停用 C2_FORCE_STOP=1）`)
    process.exit(3)
  }
  if (!dry) { try { fs.rmSync(SKIPPED, { force: true }) } catch {} }
  const arm = dry ? { status: 0, stdout: '[dry] c2-offline arm' } : spawnSync(NODE, [path.join(ROOT, 'scripts', 'c2-offline.mjs'), 'arm'], { encoding: 'utf8' })
  log(`arm: exit=${arm.status} ${String(arm.stdout || arm.stderr || '').replace(/\s+/g, ' ').slice(0, 300)}`)
  const pid = pidFrom(CORTICO_PID)
  if (!dry) {
    try { await fetch('http://127.0.0.1:7799/api/run/shutdown', { method: 'POST', signal: AbortSignal.timeout(5000) }) } catch {}
    const down = await (async () => {
      for (let i = 0; i < 20; i += 1) {
        try { await fetch('http://127.0.0.1:7799/', { signal: AbortSignal.timeout(800) }); await new Promise((r) => setTimeout(r, 500)) }
        catch { return true }
      }
      return false
    })()
    log(`Cortico graceful shutdown: ${down ? 'ok' : 'timeout'}`)
    if (!down) kill(pid, 'cortico')
  } else log('[dry] POST /api/run/shutdown')
  kill(pidFrom(WATCHDOG_PID), 'watchdog')
  log('offline window armed; proxy 保持运行（不产生 tick）')
  // 不用 process.exit：fetch 的 keep-alive 句柄在退出瞬间可能触发 libuv 断言
  await new Promise((r) => setTimeout(r, 500))
  process.exitCode = 0
} else if (cmd === 'start') {
  if (dry) { log('[dry] close offline days + start-cortico + watchdog'); process.exit(0) }
  const cfg = readJson(C2)
  const today = logicalDay()
  for (const d of cfg?.expectedDays ?? []) {
    if (d >= today) continue
    const r = closeFromLastTick(d, { maxAgeMs: Infinity, reason: 'c2-offline-window' })
    log(`close ${d}: ${r.wrote ? 'wrote from ' + r.from : r.reason}`)
  }
  const start = spawnSync(NODE, [path.join(ROOT, 'scripts', 'start-cortico.mjs')], { encoding: 'utf8', timeout: 90000 })
  log(`start-cortico: exit=${start.status} ${String(start.stdout || start.stderr || '').replace(/\s+/g, ' ').slice(-300)}`)
  if (!(await health())) { log('health 未就绪，停止'); process.exit(1) }
  const out = fs.openSync(path.join(CONTROL, 'day-watchdog.log'), 'a')
  const wd = spawn(NODE, [path.join(ROOT, 'scripts', 'day-watchdog.mjs')], { cwd: ROOT, detached: true, stdio: ['ignore', out, out] })
  wd.unref()
  log(`watchdog started pid=${wd.pid}`)
  if (!(await health())) { log('health 在 watchdog 启动后失败'); process.exit(1) }
  log('online; C2 day-report/verify 留到两天都结束后跑')
  await new Promise((r) => setTimeout(r, 500))
  process.exitCode = 0
} else if (cmd === 'verify') {
  if (dry) { log('[dry] c2-offline verify'); process.exit(0) }
  const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'c2-offline.mjs'), 'verify'], { encoding: 'utf8', timeout: 180000 })
  log(`verify: exit=${r.status} ${String(r.stdout || r.stderr || '').replace(/\s+/g, ' ').slice(-600)}`)
  process.exit(r.status ?? 1)
} else if (cmd === 'wait') {
  const stopAt = Date.parse(process.env.C2_STOP_AT || '2026-10-30T01:00:00+08:00')
  const startAt = Date.parse(process.env.C2_START_AT || '2026-10-30T09:00:00+08:00')
  if (!Number.isFinite(stopAt) || !Number.isFinite(startAt) || startAt <= stopAt) {
    log('wait: 时间参数无效'); process.exit(2)
  }
  fs.writeFileSync(path.join(CONTROL, 'c2-window-plan.json'), JSON.stringify({ stopAt: new Date(stopAt).toISOString(), startAt: new Date(startAt).toISOString(), pid: process.pid }, null, 2) + '\n')
  log(`wait: stop=${new Date(stopAt).toLocaleString()} start=${new Date(startAt).toLocaleString()}`)
  let didStop = false
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
  while (true) {
    const now = Date.now()
    // 机器睡过整段窗口：别再补 stop（补了也不够 8h），直接确保在线
    if (now >= startAt) {
      if (!didStop) log('wait: 已过 start 时间，跳过 stop（窗口没赶上）')
      const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'c2-window.mjs'), 'start'], { encoding: 'utf8', timeout: 120000 })
      log(`wait: start exit=${r.status} ${String(r.stdout || r.stderr || '').replace(/\s+/g, ' ').slice(-300)}`)
      break
    }
    if (!didStop && now >= stopAt) {
      const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'c2-window.mjs'), 'stop'], { encoding: 'utf8', timeout: 120000 })
      log(`wait: stop exit=${r.status} ${String(r.stdout || r.stderr || '').replace(/\s+/g, ' ').slice(-300)}`)
      if (r.status === 3) { log('wait: 今天没有可过 C2 的稿，窗口取消；服务保持运行'); break }
      didStop = true
    }
    await sleep(30_000)
  }
  process.exitCode = 0
} else if (cmd === 'verify-at') {
  const at = Date.parse(process.env.C2_VERIFY_AT || '2026-10-31T04:15:00+08:00')
  if (!Number.isFinite(at)) { log('verify-at: 时间参数无效'); process.exit(2) }
  log(`verify-at: ${new Date(at).toLocaleString()}`)
  while (Date.now() < at) await new Promise((r) => setTimeout(r, 30_000))
  // 到点再看窗口是否被跳过：marker 可能是 01:00 stop 时写的
  const skipped = readJson(SKIPPED)
  const cfg = readJson(C2)
  if (skipped && (cfg?.expectedDays ?? []).includes(skipped.day)) {
    log(`verify-at: 窗口已跳过（${skipped.day}: ${skipped.reason}），不验证`); process.exit(3)
  }
  log('verify-at: 到点，跑 c2-offline verify')
  const r = spawnSync(NODE, [path.join(ROOT, 'scripts', 'c2-offline.mjs'), 'verify'], { encoding: 'utf8', timeout: 180000 })
  log(`verify-at: exit=${r.status} ${String(r.stdout || r.stderr || '').replace(/\s+/g, ' ').slice(-600)}`)
  process.exitCode = r.status ?? 1
} else if (cmd === 'check') {
  const day = logicalDay()
  const d = readJson(path.join(draftsDir(), day + '.json'))
  const valid = validDraftToday(day)
  const plan = readJson(path.join(CONTROL, 'c2-window-plan.json'))
  const c2 = readJson(C2)
  const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
  const wdPid = pidFrom(WATCHDOG_PID)
  const corticoPid = pidFrom(CORTICO_PID)
  let lastTickAt = null
  try {
    const lines = fs.readFileSync(path.join(DSH_HOME, 'bili-whale', 'days', day, 'ticks.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
    lastTickAt = JSON.parse(lines[lines.length - 1]).at
  } catch {}
  console.log(JSON.stringify({
    ok: true,
    day,
    draftValid: valid,
    draftId: d?.id ?? null,
    draftStatus: d?.status ?? null,
    hasDiaryHash: !!d?.diaryHash,
    plan,
    expectedDays: c2?.expectedDays ?? null,
    lastTickAt,
    lastTickAgeMin: lastTickAt ? Math.round((Date.now() - Date.parse(lastTickAt)) / 60000) : null,
    watchdog: { pid: wdPid || null, alive: wdPid ? alive(wdPid) : false },
    cortico: { pid: corticoPid || null, alive: corticoPid ? alive(corticoPid) : false },
  }, null, 2))
  process.exit(valid ? 0 : 1)
} else if (cmd === 'postcheck-at') {
  const at = Date.parse(process.env.C2_POSTCHECK_AT || '2026-10-30T09:05:00+08:00')
  if (!Number.isFinite(at)) { log('postcheck-at: 时间参数无效'); process.exit(2) }
  log(`postcheck-at: ${new Date(at).toLocaleString()}`)
  while (Date.now() < at) await new Promise((r) => setTimeout(r, 30_000))
  const health = spawnSync(NODE, [path.join(ROOT, 'scripts', 'cortico-health.mjs')], { encoding: 'utf8', timeout: 60000 })
  const check = spawnSync(NODE, [path.join(ROOT, 'scripts', 'c2-window.mjs'), 'check'], { encoding: 'utf8', timeout: 30000 })
  let parsed = null
  try { parsed = JSON.parse(check.stdout) } catch {}
  const cf = readJson(path.join(DSH_HOME, 'bili-whale', 'days', '2026-10-29', 'counterfactual.json'))
  const end = readJson(path.join(DSH_HOME, 'bili-whale', 'days', '2026-10-29', 'state.end.json'))
  const out = {
    at: new Date().toISOString(),
    healthExit: health.status,
    healthTail: String(health.stdout || health.stderr || '').trim().split('\n').slice(-3),
    check: parsed,
    cf: cf ? { ok: cf.ok, diffChars: cf.diffChars, realMood: cf.realMood } : null,
    end: end ? { at: end.at, derivedReason: end.derivedReason ?? null } : null,
  }
  fs.writeFileSync(path.join(CONTROL, 'c2-poststart.json'), JSON.stringify(out, null, 2) + '\n')
  log(`postcheck-at: health=${health.status} cf=${cf ? cf.ok + '/' + cf.diffChars : 'missing'} end=${end ? 'y' : 'n'}`)
  process.exitCode = health.status === 0 ? 0 : 1
} else {
  console.error('用法: node scripts/c2-window.mjs stop|start|verify|wait|verify-at|check|postcheck-at [--dry]')
  process.exit(2)
}

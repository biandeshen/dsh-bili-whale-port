/**
 * 行动观察器（一次性）：等她下一次自然行动，自动留一份证据。
 *
 *   node scripts/action-watch.mjs [--timeout 12h] [--settle 10m]
 *
 * 只读 causal.jsonl；命中 `kind:'action'` 后等 settle（让她把 feed/debrief/日记/草稿走完），
 * 再跑 wake-audit + day-report，写 days/<day>/wake-<HHMM>.json。不改变她的行为。
 *
 *   --follow  捕获一轮后不退出，重置起点继续等下一轮（观测期长驻用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DSH_HOME } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CONTROL = path.join(DSH_HOME, 'bili-whale', 'control')
const CAUSAL = path.join(DSH_HOME, 'bili-whale', 'causal.jsonl')
const DAYS = path.join(DSH_HOME, 'bili-whale', 'days')
const LOG = path.join(CONTROL, 'action-watch.log')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const timeoutMs = parseDur(arg('timeout', '12h'))
const settleMs = parseDur(arg('settle', '10m'))
const follow = argv.includes('--follow')
let startMs = Date.now()
const startDay = logicalDay(startMs)

function parseDur(s) {
  const m = /^(\d+)([hm])$/.exec(String(s))
  if (!m) return 12 * 3600_000
  return Number(m[1]) * (m[2] === 'h' ? 3600_000 : 60_000)
}
function logicalDay(now) { return new Date(now).toLocaleDateString('sv-SE') } // 自然日（2026-10-31 拍板）
function readJson(f) { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`
  try { fs.mkdirSync(CONTROL, { recursive: true }); fs.appendFileSync(LOG, line + '\n') } catch {}
  console.log(line)
}
function latestAction(f) {
  let raw = ''
  try { raw = fs.readFileSync(f, 'utf8') } catch { return null }
  for (const line of raw.trim().split('\n').reverse()) {
    try {
      const e = JSON.parse(line)
      if (e?.kind === 'action' && Number(e.atMs) >= startMs) return e
    } catch {}
  }
  return null
}

log(`watching since ${new Date(startMs).toLocaleString()} (timeout ${timeoutMs / 3600_000}h, settle ${settleMs / 60000}m)`)
while (Date.now() - startMs < timeoutMs) {
  const action = latestAction(CAUSAL)
  if (action) {
    log(`action found: ${action.actionKind ?? '?'} at ${new Date(Number(action.atMs)).toLocaleString()} — settle ${settleMs / 60000}m`)
    await new Promise((r) => setTimeout(r, settleMs))
    const day = logicalDay(Number(action.atMs))
    const dir = path.join(DAYS, day)
    fs.mkdirSync(dir, { recursive: true })
    const stamp = new Date(Number(action.atMs)).toTimeString().slice(0, 5).replace(':', '')
    const out = path.join(dir, `wake-${stamp}.json`)
    const audit = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'wake-audit.mjs'), '--last', '1', '--strict', '--json'], { encoding: 'utf8', timeout: 30000 })
    const report = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'day-report.mjs'), '--date', day, '--json'], { encoding: 'utf8', timeout: 30000 })
    const payload = {
      action,
      capturedAt: new Date().toISOString(),
      audit: (() => { try { return JSON.parse(audit.stdout) } catch { return { ok: false, stderr: String(audit.stderr).slice(-400) } } })(),
      auditExit: audit.status,
      report: (() => { try { return JSON.parse(report.stdout) } catch { return { ok: false, stderr: String(report.stderr).slice(-400) } } })(),
      reportExit: report.status,
    }
    fs.writeFileSync(out, JSON.stringify(payload, null, 2) + '\n')
    log(`captured ${out} (audit exit=${audit.status}, report exit=${report.status})`)
    fs.writeFileSync(path.join(CONTROL, 'action-watch-result.json'), JSON.stringify({ ok: true, at: payload.capturedAt, day, file: out }, null, 2) + '\n')
    process.exitCode = 0
    if (follow) {
      startMs = Date.now()
      log('follow: continuing after capture')
      continue
    }
    break
  }
  await new Promise((r) => setTimeout(r, 30_000))
}
if (process.exitCode === undefined) {
  log(`timeout: no action since ${new Date(startMs).toLocaleString()}`)
  fs.writeFileSync(path.join(CONTROL, 'action-watch-result.json'), JSON.stringify({ ok: false, at: new Date().toISOString(), reason: 'timeout', since: new Date(startMs).toISOString() }, null, 2) + '\n')
  process.exitCode = 2
}

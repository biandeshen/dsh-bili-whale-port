/**
 * 观测启动闸：G3b 未就绪时拒绝开始 14 天窗口。
 *
 *   node scripts/observation-start.mjs [--dry]
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const FILE = path.join(CONTROL, 'observation.json')
const dry = process.argv.includes('--dry')
const days = Number(process.env.OBSERVE_DAYS || 14)

const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'g3b-check.mjs'), '--json'], { encoding: 'utf8' })
let report = null
try { report = JSON.parse(String(r.stdout ?? '')) } catch {}
if (!report?.ready) {
  const pending = (report?.checks ?? []).filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`)
  console.log(JSON.stringify({ ok: false, error: 'g3b-not-ready', pending: pending.length ? pending : ['g3b-check 无法解析'] }, null, 2))
  process.exit(1)
}

const startDay = new Date(Date.now()).toLocaleDateString('sv-SE') // 自然日
const payload = { startDay, days, createdAt: new Date().toISOString() }
if (dry) {
  console.log(JSON.stringify({ ok: true, dry: true, wouldWrite: FILE, ...payload }, null, 2))
  process.exit(0)
}
fs.mkdirSync(CONTROL, { recursive: true })
const tmp = FILE + '.' + process.pid + '.tmp'
fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + '\n')
fs.renameSync(tmp, FILE)
console.log(JSON.stringify({ ok: true, file: FILE, ...payload }, null, 2))

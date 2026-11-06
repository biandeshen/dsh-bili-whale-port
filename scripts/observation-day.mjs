/**
 * 观测期每日证据包：只读 + 写当天 evidence，不改 state。
 *
 *   node scripts/observation-day.mjs [--date 2026-10-31] [--json]
 *
 * 依赖 control/observation.json（observation-start 创建）；未开窗直接拒绝。
 * 输出 days/<D>/observation-check.json / .md。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { whaleHome, actionLedgerPaths } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const CONTROL = path.join(whaleHome, 'bili-whale', 'control')
const DAYS = path.join(whaleHome, 'bili-whale', 'days')
const CFG = path.join(CONTROL, 'observation.json')
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const asJson = argv.includes('--json')
const logicalDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE') // 自然日
const day = arg('date', logicalDay())

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const runJson = (script, args) => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args, '--json'], { encoding: 'utf8', timeout: 60000 })
  try { return { exit: r.status, json: JSON.parse(String(r.stdout ?? '')) } } catch { return { exit: r.status, json: null, stderr: String(r.stderr ?? '') } }
}
/**
 * 今天的行动笔数：旧 causal（历史）与新 actions.ndjson（搬家后的真账）都数。
 * 路径解析统一在 paths.mjs（`actionLedgerPaths`）——测试隔离 whale home 时部署家
 * 跟着隔离，不会读到本机真账把 FAIL 误判成 PASS。
 */
function actionCount(d) {
  let n = 0
  const { legacy, current } = actionLedgerPaths()
  try {
    for (const line of fs.readFileSync(legacy, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e?.kind === 'action' && Number.isFinite(Number(e.atMs)) && logicalDay(Number(e.atMs)) === d) n += 1
      } catch {}
    }
  } catch {}
  try {
    for (const line of fs.readFileSync(current, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r?.day && r?.activity) { if (String(r.day) === d) n += 1 }
        else if (Number.isFinite(Number(r?.at)) && logicalDay(Number(r.at)) === d) n += 1
      } catch {}
    }
  } catch {}
  return n
}

const cfg = readJson(CFG)
if (!cfg?.startDay) { console.error('observation-day: 未开窗（control/observation.json 缺失），先过 G3b 再 observation-start'); process.exit(2) }
const status = runJson('observation-status.mjs', [])
if (!status.json) { console.error('observation-day: observation-status 无法解析'); process.exit(2) }
const row = (status.json.rows ?? []).find((r) => r.day === day)
if (!row) { console.error(`observation-day: ${day} 不在观测窗口 ${cfg.startDay} + ${cfg.days} 天内`); process.exit(2) }

const report = runJson('day-report.mjs', ['--date', day])
const start = readJson(path.join(DAYS, day, 'state.start.json'))
const startAt = start?.at ? Date.parse(start.at) : NaN
const boundary = Date.parse(day + 'T04:00:00')
const actions = actionCount(day)

const checks = [
  { name: '窗口内', ok: true, detail: `${cfg.startDay} + ${cfg.days}` },
  { name: 'state.start 在 04:00 后', ok: Number.isFinite(startAt) && startAt >= boundary, detail: start?.at ?? 'MISSING' },
  { name: '行动记账存在', ok: true, detail: `${actions} 次（2026-10-30 起无每日上限）` },
  { name: '当天有自然 action（D-39）', ok: row.action === true, detail: row.action ? 'y' : 'n' },
  { name: '草稿合规（diaryHash/date/degraded）', ok: row.draft === true, detail: row.draft ? 'y' : 'n' },
  { name: '反事实 ok', ok: row.cfOk === true, detail: row.mood ?? '-' },
  { name: '未 tainted', ok: row.tainted !== true, detail: row.tainted ? 'TAINTED' : 'ok' },
  { name: 'day-report 全项', ok: (report.json?.items ?? []).every((i) => i.ok) && (report.json?.items?.length ?? 0) > 0, detail: (report.json?.items ?? []).filter((i) => !i.ok).map((i) => i.name).join(',') || 'ok' },
]
const ok = checks.every((c) => c.ok)
const out = { day, checkedAt: new Date().toISOString(), ok, checks, row, report: report.json }
fs.mkdirSync(path.join(DAYS, day), { recursive: true })
fs.writeFileSync(path.join(DAYS, day, 'observation-check.json'), JSON.stringify(out, null, 2) + '\n')
const md = [
  `# 观测日检查 · ${day}`,
  '',
  `- 结论：**${ok ? 'PASS' : 'FAIL'}**`,
  `- 检查时间：${out.checkedAt}`,
  '',
  '| 项 | 结果 | 细节 |',
  '|---|---|---|',
  ...checks.map((c) => `| ${c.name} | ${c.ok ? 'PASS' : 'FAIL'} | ${String(c.detail).replace(/\|/g, '/')} |`),
  '',
  !ok ? '> 有 FAIL：按 OBSERVATION-PROTOCOL 记录 incident，不要补数据。\n' : '',
].join('\n')
fs.writeFileSync(path.join(DAYS, day, 'observation-check.md'), md)
if (asJson) console.log(JSON.stringify(out, null, 2))
else console.log(md)
process.exit(ok ? 0 : 1)

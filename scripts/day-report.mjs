/**
 * 一天的证据报告：只读，不补数据、不猜。
 *
 *   node scripts/day-report.mjs                 # 默认按 04:00 日界取今天
 *   node scripts/day-report.mjs --date 2026-10-28
 *   node scripts/day-report.mjs --json
 *
 * 退出码：0 = 必需项齐全；1 = 有 MISSING/FAIL。缺失一律显式打印 MISSING。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const DAY_BOUNDARY_HOUR = 4
const DAYS_ROOT = path.join(WHALE_HOME, 'bili-whale', 'days')
const DIARY = path.join(WHALE_HOME, 'whale-diary.md')

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const asJson = argv.includes('--json')

function logicalDay(now = Date.now()) {
  return new Date(now - DAY_BOUNDARY_HOUR * 3600_000).toLocaleDateString('sv-SE')
}
function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function sha1(t) { return crypto.createHash('sha1').update(String(t ?? '')).digest('hex') }
function draftDir() {
  if (process.env.WHALE_DRAFTS) return process.env.WHALE_DRAFTS
  const legacy = 'D:/AI/养鱼/drafts'
  const isDefaultHome = path.resolve(WHALE_HOME).toLowerCase() === path.resolve(process.env.USERPROFILE || '', '.dsh').toLowerCase()
  return isDefaultHome && fs.existsSync(legacy) ? legacy : path.join(WHALE_HOME, 'bili-whale', 'drafts')
}
function draftPath(day) { return path.join(draftDir(), day + '.json') }

function buildReport(day, opts = {}) {
  const dir = path.join(DAYS_ROOT, day)
  const exists = fs.existsSync(dir)
  const files = exists ? fs.readdirSync(dir) : []
  const start = readJson(path.join(dir, 'state.start.json'))
  const end = readJson(path.join(dir, 'state.end.json'))
  const summary = readJson(path.join(dir, 'day.json'))
  const ticksFile = path.join(dir, 'ticks.jsonl')
  const ticks = (() => {
    try { return fs.readFileSync(ticksFile, 'utf8').trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean) } catch { return [] }
  })()
  const draft = readJson(draftPath(day))
  const diary = (() => { try { return fs.readFileSync(DIARY, 'utf8') } catch { return null } })()

  const items = []
  const add = (name, ok, detail = '') => items.push({ name, ok, detail })

  add('day-dir', exists, dir)
  add('state.start.json', !!start, start?.at ?? 'MISSING')
  add('ticks.jsonl', ticks.length > 0, ticks.length ? `${ticks.length} 条 · 最后 ${ticks[ticks.length - 1].at}` : 'MISSING')
  add('day.json', !!summary, summary ? `tick=${summary.tickCount} wakes=${summary.wakes} mood=[${summary.mood?.min},${summary.mood?.max}]` : 'MISSING')
  const isPastDay = day < logicalDay()
  add('state.end.json', !!end || !isPastDay, end?.at ?? (isPastDay ? 'MISSING' : '（当天未结束，正常）'))

  if (draft) {
    const textOk = !!draft.textHash || !!draft.text
    add('draft', textOk, `${draft.id} status=${draft.status} textHash=${String(draft.textHash ?? sha1(draft.text)).slice(0, 10)}`)
    if (draft.diaryHash && diary !== null) {
      add('draft.diaryHash==diary', draft.diaryHash === sha1(diary), draft.diaryHash === sha1(diary) ? 'match' : 'MISMATCH')
    } else {
      add('draft.diaryHash', false, 'MISSING（旧草稿或未记录）')
    }
    add('draft.date', draft.date === day, draft.date ?? 'MISSING')
  } else {
    add('draft', false, 'MISSING')
  }

  // 相邻 tick 的最大间隔（判断是否长时间停摆）
  let maxGapMin = null
  for (let i = 1; i < ticks.length; i += 1) {
    const a = Date.parse(ticks[i - 1].at); const b = Date.parse(ticks[i].at)
    if (Number.isFinite(a) && Number.isFinite(b)) {
      const m = Math.round((b - a) / 60000)
      maxGapMin = maxGapMin === null ? m : Math.max(maxGapMin, m)
    }
  }
  add('tick 最大间隔', maxGapMin === null || maxGapMin <= 90, maxGapMin === null ? `仅 ${ticks.length} 条 tick（无间隔可比）` : `${maxGapMin} 分钟`)

  const flags = summary?.flags ?? {}
  // 预登记的预期flag（如 C2 离线日的 missed/late）不算失败；未登记的才算
  const expected = readJson(path.join(dir, 'expected.json')) || {}
  const allow = new Set(Array.isArray(expected.allowFlags) ? expected.allowFlags : [])
  // C2 离线复核专用：命令行显式声明"预期 missed/late"，不是默认放行
  if (opts.expectOffline) { allow.add('missed'); allow.add('late') }
  const raised = Object.entries(flags).filter(([k, v]) => v === true && k !== 'taintReasons').map(([k]) => k)
  const unexpected = raised.filter((k) => !allow.has(k))
  add('flags', unexpected.length === 0,
    raised.length === 0 ? '无'
      : (unexpected.length ? `unexpected: ${unexpected.join(',')}` : `expected: ${raised.join(',')}${expected.reason ? '（' + expected.reason + '）' : ''}`))

  const failed = items.filter((i) => !i.ok)
  return { day, dir, exists, files, items, failed: failed.length, summary, generatedAt: new Date().toISOString() }
}

if (process.argv[1] && process.argv[1].endsWith('day-report.mjs')) {
  const day = arg('date', logicalDay())
  const report = buildReport(day, { expectOffline: argv.includes('--expect-offline') })
  if (asJson) {
    console.log(JSON.stringify(report, null, 2))
  } else {
    console.log(`# 她的一天 · ${report.day}`)
    console.log(`目录：${report.dir}`)
    for (const it of report.items) console.log(`${it.ok ? 'PASS ' : 'MISSING'}  ${it.name}  ${it.detail}`)
    console.log(`\n${report.failed === 0 ? '齐全' : report.failed + ' 项缺失/失败'}`)
  }
  process.exit(report.failed === 0 ? 0 : 1)
}

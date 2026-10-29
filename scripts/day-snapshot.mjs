/**
 * 她的一天：按 04:00 日界把运行时状态落成可核查的证据。
 *
 *   node scripts/day-snapshot.mjs --seed          建当天目录与 state.start.json
 *   node scripts/day-snapshot.mjs --tick          追加一条 tick（watchdog 每 5 分钟调）
 *   node scripts/day-snapshot.mjs --end           写 state.end.json
 *   node scripts/day-snapshot.mjs --tick --date 2026-10-28
 *   node scripts/day-snapshot.mjs --status        只打印当天摘要
 *
 * 目录：<WHALE_HOME>/bili-whale/days/<YYYY-MM-DD>/
 *   state.start.json  state.end.json  ticks.jsonl（append-only）  day.json  incident.md
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const DAY_BOUNDARY_HOUR = 4
const DAYS_ROOT = path.join(WHALE_HOME, 'bili-whale', 'days')
const FIELDS = path.join(WHALE_HOME, 'bili-whale', 'fields.json')
const RHYTHM = path.join(WHALE_HOME, 'bili-whale', 'control', 'rhythm.json')
const LIFE = path.join(WHALE_HOME, 'bili-whale', 'control', 'life.json')
const ROUND = path.join(WHALE_HOME, 'bili-whale', 'control', 'round.json')
const DIARY = path.join(WHALE_HOME, 'whale-diary.md')

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }

/** 04:00 为日界：凌晨 2 点算前一天。 */
export function logicalDay(now = Date.now()) {
  const d = new Date(now - DAY_BOUNDARY_HOUR * 3600_000)
  return d.toLocaleDateString('sv-SE')
}

export function daysDir(day) { return path.join(DAYS_ROOT, day) }

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null }
}

function sha1(text) { return crypto.createHash('sha1').update(String(text ?? '')).digest('hex') }

function draftDir() {
  if (process.env.WHALE_DRAFTS) return process.env.WHALE_DRAFTS
  const legacy = 'D:/AI/养鱼/drafts'
  const isDefaultHome = path.resolve(WHALE_HOME).toLowerCase() === path.resolve(process.env.USERPROFILE || '', '.dsh').toLowerCase()
  return isDefaultHome && fs.existsSync(legacy) ? legacy : path.join(WHALE_HOME, 'bili-whale', 'drafts')
}

function draftPath(day) {
  return path.join(draftDir(), day + '.json')
}

function collect(day, now) {
  const fields = readJson(FIELDS)
  const rhythm = readJson(RHYTHM)
  const life = readJson(LIFE)
  const round = readJson(ROUND)
  const diary = (() => { try { return fs.readFileSync(DIARY, 'utf8') } catch { return null } })()
  const draft = readJson(draftPath(day))
  return {
    at: new Date(now).toISOString(),
    day,
    fields: fields?.fields ?? null,
    npc: fields?.npcState ?? null,
    npcState: fields?.npcState ?? null,
    // 反事实检查要能重建当天的 voice：保留链与记忆本体，不只是条数
    chain: Array.isArray(fields?.chain) ? fields.chain.slice(-50) : [],
    chainTail: Array.isArray(fields?.chain) ? fields.chain.slice(-3) : [],
    memories: Array.isArray(fields?.memories) ? fields.memories.slice(-50) : [],
    memoryCount: Array.isArray(fields?.memories) ? fields.memories.length : 0,
    rhythm: rhythm ?? null,
    life: life ?? null,
    round: round ?? null,
    diary: diary === null ? { present: false } : { present: true, chars: diary.length, hash: sha1(diary) },
    draft: draft ? { id: draft.id, status: draft.status, textHash: draft.textHash ?? sha1(draft.text), diaryHash: draft.diaryHash ?? null } : null,
  }
}

function ensureDay(day) {
  const dir = daysDir(day)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function writeAtomic(file, obj) {
  const tmp = file + '.' + process.pid + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n', 'utf8')
  fs.renameSync(tmp, file)
}

function updateDay(dir, snap, kind) {
  const file = path.join(dir, 'day.json')
  const cur = readJson(file) || {
    day: snap.day, createdAt: snap.at, tickCount: 0,
    wakes: 0, lastWakeAt: null, lastKind: null,
    mood: { min: null, max: null, last: null },
    drafts: [], flags: { missed: false, late: false, tainted: false, taintReasons: [] },
  }
  cur.tickCount += kind === 'tick' ? 1 : 0
  // life.json 是现行的活动账本；rhythm.json 是更名前的遗留文件，只作回退
  if (snap.life) {
    cur.lastWakeAt = snap.life.lastActionAt ?? cur.lastWakeAt
    cur.lastKind = snap.life.lastKind ?? cur.lastKind
    cur.wakes = Number(snap.life.actionsToday ?? cur.wakes) || cur.wakes
  } else if (snap.rhythm) {
    cur.lastWakeAt = snap.rhythm.lastWakeAt ?? cur.lastWakeAt
    cur.lastKind = snap.rhythm.lastKind ?? cur.lastKind
    cur.wakes = Number(snap.rhythm.wakesToday ?? cur.wakes) || cur.wakes
  }
  if (snap.fields) {
    const mood = Number(snap.fields.mood)
    if (Number.isFinite(mood)) {
      cur.mood.min = cur.mood.min === null ? mood : Math.min(cur.mood.min, mood)
      cur.mood.max = cur.mood.max === null ? mood : Math.max(cur.mood.max, mood)
      cur.mood.last = mood
    }
  }
  if (snap.draft && !cur.drafts.some((d) => d.id === snap.draft.id)) cur.drafts.push(snap.draft)
  cur.updatedAt = new Date().toISOString()
  writeAtomic(file, cur)
  return cur
}

export function tick(now = Date.now(), day = logicalDay(now)) {
  const dir = ensureDay(day)
  const snap = collect(day, now)
  const start = path.join(dir, 'state.start.json')
  if (!fs.existsSync(start)) writeAtomic(start, { ...snap, kind: 'start' })
  fs.appendFileSync(path.join(dir, 'ticks.jsonl'), JSON.stringify({ kind: 'tick', ...snap }) + '\n', 'utf8')
  const summary = updateDay(dir, snap, 'tick')
  return { ok: true, day, dir, tickCount: summary.tickCount }
}

export function seed(now = Date.now(), day = logicalDay(now)) {
  const dir = ensureDay(day)
  const snap = collect(day, now)
  const start = path.join(dir, 'state.start.json')
  const created = !fs.existsSync(start)
  if (created) writeAtomic(start, { ...snap, kind: 'start' })
  // 建当天的 incident 模板，缺失才建，永不覆盖
  const incident = path.join(dir, 'incident.md')
  if (!fs.existsSync(incident)) {
    fs.writeFileSync(incident, [
      '# 当天事件记录', '',
      '> 只记事实：时间 / 发生了什么 / 证据文件。不许事后补写“应该发生”的事。', '',
      '| 时间 | 事件 | 证据 |', '|---|---|---|', '',
    ].join('\n'), 'utf8')
  }
  const summary = updateDay(dir, snap, 'seed')
  return { ok: true, day, dir, created, tickCount: summary.tickCount }
}

export function end(now = Date.now(), day = logicalDay(now)) {
  const dir = ensureDay(day)
  const snap = collect(day, now)
  writeAtomic(path.join(dir, 'state.end.json'), { ...snap, kind: 'end' })
  const summary = updateDay(dir, snap, 'end')
  return { ok: true, day, dir, tickCount: summary.tickCount }
}

/**
 * 跨日收尾：用该日**自己最后一条 tick** 的快照写 state.end，不读新一天的状态。
 * 不覆盖已有 state.end；没有 tick 就不写（不补造）。
 * 最后一条 tick 距现在超过 maxAgeMs（机器睡过日界/进程被挂起）就不收尾——
 * 那一段没有被观测到，宁可让 day-report 显示 MISSING，也不拿几小时前的快照冒充收口。
 */
export function closeFromLastTick(day, { now = Date.now(), maxAgeMs = 2 * 3600_000 } = {}) {
  const dir = daysDir(day)
  const endFile = path.join(dir, 'state.end.json')
  if (fs.existsSync(endFile)) return { ok: true, wrote: false, reason: 'exists' }
  let last = null
  try {
    const lines = fs.readFileSync(path.join(dir, 'ticks.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
    last = lines.length ? JSON.parse(lines[lines.length - 1]) : null
  } catch {}
  if (!last) return { ok: false, wrote: false, reason: 'no-ticks' }
  const lastAt = Date.parse(last.at)
  if (!Number.isFinite(lastAt) || now - lastAt > maxAgeMs) {
    return { ok: false, wrote: false, reason: 'stale', from: last.at }
  }
  const { kind, ...snap } = last
  writeAtomic(endFile, { ...snap, kind: 'end', endedAt: new Date().toISOString(), derivedFromLastTick: last.at })
  return { ok: true, wrote: true, from: last.at }
}

export function status(now = Date.now(), day = logicalDay(now)) {
  const dir = daysDir(day)
  const summary = readJson(path.join(dir, 'day.json'))
  const files = fs.existsSync(dir) ? fs.readdirSync(dir) : []
  return { ok: fs.existsSync(dir), day, dir, files, summary }
}

if (process.argv[1] && process.argv[1].endsWith('day-snapshot.mjs')) {
  const now = Date.now()
  const day = arg('date', logicalDay(now))
  const kind = argv.includes('--seed') ? 'seed' : argv.includes('--end') ? 'end' : argv.includes('--status') ? 'status' : 'tick'
  const out = kind === 'seed' ? seed(now, day) : kind === 'end' ? end(now, day) : kind === 'status' ? status(now, day) : tick(now, day)
  console.log(JSON.stringify(out, null, 2))
  process.exit(out.ok ? 0 : 1)
}

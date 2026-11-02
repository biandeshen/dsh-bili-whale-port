/**
 * 一天的例行只读汇总（OPS 日常）：把主人每天 6–8 分钟的点击压到一条命令。
 *
 *   node scripts/ops-day.mjs                 # 默认今天
 *   node scripts/ops-day.mjs --date 2026-11-02 [--json] [--port 7799]
 *
 * 默认离线：不发包、不打 B站、不写任何状态。端口用本地 bind 试探
 * （EADDRINUSE = 有进程在听），进程判定只读 pid 文件 + process.kill(pid,0)。
 * 退出码：0 = 没有要人看的事；1 = 有拦项/缺项；2 = 进程死或关键文件读不到。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { whaleHome as WHALE_HOME, draftsDir, stateDir } from '../tools/lib/paths.mjs'
import { causalFile } from '../tools/lib/causal.mjs'
import { isKillOn } from '../tools/lib/kill.mjs'
import { queueDir } from './ack.mjs'
import { checkAnchor } from './live-code-anchor.mjs'

const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const asJson = argv.includes('--json')
const logicalDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE')
const DAY = arg('date', logicalDay())
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const DAYS = path.join(WHALE_HOME, 'bili-whale', 'days')
const CAUSAL = causalFile(WHALE_HOME)
const HOME_DIR = process.env.USERPROFILE || process.env.HOME || '.'
const BILI_AI = stateDir()
const PORT = Number(arg('port', process.env.OPS_DAY_PORT || 7799)) || 7799
const NEUTRAL_MOOD = ['宁静', '平静']

const rows = []
const add = (level, name, detail) => { rows.push({ level, name, detail }) }
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

/** pid 文件 → 活/死/读不到；EPERM 算活（存在但没权限探）。 */
function pidState(file) {
  let raw
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { state: 'no-file' } }
  const pid = Number(String(raw).trim())
  if (!Number.isInteger(pid) || pid <= 0) return { state: 'bad-file', pid }
  try { process.kill(pid, 0); return { state: 'alive', pid } } catch (e) {
    if (e?.code === 'EPERM') return { state: 'alive', pid }
    if (e?.code === 'ESRCH') return { state: 'dead', pid }
    return { state: 'unknown', pid, why: String(e?.code ?? e) }
  }
}

/** 本地 bind 试探：occupied = 有进程在听（健康），free = 没人听。 */
function portState(port) {
  return new Promise((resolve) => {
    const srv = net.createServer()
    srv.once('error', (e) => resolve(e?.code === 'EADDRINUSE' ? 'occupied' : 'unknown:' + String(e?.code ?? e)))
    srv.once('listening', () => srv.close(() => resolve('free')))
    srv.listen(port, '127.0.0.1')
  })
}

/** 只读 pending 队列（不用 ack.listPending——它会把过期项顺手删掉，那是写）。 */
function pendingTokens() {
  const dir = queueDir(WHALE_HOME)
  let files
  try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')) } catch { return { readable: false, items: [] } }
  const items = []
  for (const f of files) {
    const it = readJson(path.join(dir, f))
    if (!it || it.used === true) continue
    items.push({ id: String(it.id ?? f), expiresAt: Number(Date.parse(String(it.expiresAt ?? ''))), draftId: String(it.payload?.draftId ?? '') })
  }
  return { readable: true, items }
}

/** 今天（00:00 起）的因果事件：action / dm-out / inbound / diary。 */
function causalToday() {
  const out = { action: 0, dmOut: 0, inbound: 0, diary: 0, lastActionMs: null, diaryHeadings: [] }
  for (const line of fs.readFileSync(CAUSAL, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    const atMs = Number.isFinite(Number(e?.atMs)) ? Number(e.atMs) : Date.parse(String(e?.at ?? ''))
    if (!Number.isFinite(atMs) || logicalDay(atMs) !== DAY) continue
    if (e.kind === 'action') { out.action += 1; out.lastActionMs = Math.max(out.lastActionMs ?? 0, atMs) }
    else if (e.kind === 'dm-out') out.dmOut += 1
    else if (e.kind === 'inbound') out.inbound += 1
    else if (e.kind === 'diary') { out.diary += 1; out.diaryHeadings.push(String(e.heading ?? '')) }
  }
  return out
}

function lastTickMin() {
  try {
    const lines = fs.readFileSync(path.join(DAYS, DAY, 'ticks.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
    if (!lines.length) return null
    const at = Date.parse(String(JSON.parse(lines[lines.length - 1]).at ?? ''))
    return Number.isFinite(at) ? Math.round((Date.now() - at) / 60000) : null
  } catch { return null }
}

/** 稿子当日情绪：draft.voice.mood（label + cause）+ 当日快照 fields.mood 数值。 */
function moodPair(draft) {
  const label = String(draft?.voice?.mood?.label ?? '')
  const cause = String(draft?.voice?.mood?.cause ?? draft?.voice?.mood?.reason ?? '')
  const snap = readJson(path.join(DAYS, DAY, 'state.end.json')) || readJson(path.join(DAYS, DAY, 'state.start.json'))
  const value = Number(snap?.fields?.mood)
  return { label, cause, value: Number.isFinite(value) ? value : null, degraded: draft?.degraded === true }
}

/** 日记里最新的 `## YYYY-MM-DD` 小节日期（两本都看）。 */
function latestDiaryDate() {
  let latest = null
  let seen = 0
  for (const book of ['whale-diary.md', 'whale-diary-private.md']) {
    let text
    try { text = fs.readFileSync(path.join(WHALE_HOME, book), 'utf8') } catch { continue }
    for (const m of text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})/gm)) { seen += 1; if (!latest || m[1] > latest) latest = m[1] }
  }
  return { latest, seen }
}

const ports = await portState(PORT)
const events = fs.existsSync(CAUSAL) ? causalToday() : null

// ① 进程活着没
for (const [label, file] of [['Cortico', path.join(CONTROL, 'cortico.pid')], ['看门狗', path.join(CONTROL, 'day-watchdog.pid')]]) {
  const p = pidState(file)
  const detail = `${path.relative(HOME_DIR, file) || file} → ${p.state}${p.pid ? ' pid=' + p.pid : ''}`
  if (p.state === 'alive') add('ok', label + ' 进程', detail)
  else add('fatal', label + ' 进程', detail + (p.state === 'no-file' ? '（没有 pid 文件）' : ''))
}
if (ports === 'occupied') add('ok', '端口 ' + PORT + ' 在听', '本地 bind 试探：EADDRINUSE')
else add('watch', '端口 ' + PORT + ' 在听', ports === 'free' ? '没人听（WebUI 不在）' : ports)

// ② 今天有没有稿 + 待审令牌
const draftPath = path.join(draftsDir(), DAY + '.json')
const draft = readJson(draftPath)
if (!fs.existsSync(draftPath)) add('watch', '今天的稿', 'MISSING ' + draftPath + '（她今天还没出稿）')
else if (draft === null) add('fatal', '今天的稿', '读不到/解析失败：' + draftPath)
else {
  const st = String(draft.status ?? 'unknown')
  add(['sent', 'dry-run'].includes(st) ? 'ok' : 'watch', '今天的稿', `${draft.id} status=${st}`)
}
const tokens = pendingTokens()
if (!tokens.readable) add('watch', '待审令牌', '读不到 ' + queueDir(WHALE_HOME))
else {
  const soonest = tokens.items.map((x) => x.expiresAt).filter(Number.isFinite).sort((a, b) => a - b)[0]
  const soon = Number.isFinite(soonest) ? new Date(soonest).toLocaleString('zh-CN', { hour12: false }) : '—'
  const urgent = Number.isFinite(soonest) && soonest - Date.now() < 30 * 60000
  const expired = tokens.items.filter((x) => Number.isFinite(x.expiresAt) && x.expiresAt <= Date.now()).length
  if (!tokens.items.length) add('watch', '待审令牌', '0 张' + (draft && draft.status === 'pending' ? '（稿还挂着但没令牌，等于发不出去）' : ''))
  else add(urgent ? 'watch' : 'ok', '待审令牌', `${tokens.items.length} 张，最近过期 ${soon}${urgent ? '（<30 分钟）' : ''}${expired ? ' · 已过期未清 ' + expired + ' 张' : ''}`)
}

// ③ 今天她的行动数与最后一次 tick
if (events === null) add('fatal', '因果账本', '读不到 ' + CAUSAL)
else {
  add(events.action > 0 ? 'ok' : 'watch', '今天的行动', `${events.action} 次` + (events.lastActionMs ? `，最后一次 ${new Date(events.lastActionMs).toLocaleString('zh-CN', { hour12: false })}` : ''))
  const mins = lastTickMin()
  if (mins === null) add('watch', '最后一次 tick', DAYS + '/' + DAY + '/ticks.jsonl 无今日 tick')
  else add(mins <= 10 ? 'ok' : 'watch', '最后一次 tick', `${mins} 分钟前（看门狗 5 分钟一跳，>10 视为断了）`)
}

// ④ 三条 K4 的当前可算值（算不出就说缺什么，不许说"看起来正常"）
if (events !== null) {
  const both = events.inbound > 0 && events.dmOut > 0
  add(both ? 'ok' : 'watch', 'K4-1 私信有来有回', `今天 来=${events.inbound} 回=${events.dmOut}`
    + (both ? '（连续天数由 observe:day 汇总）'
      : '；缺：' + [events.inbound ? '' : 'causal kind:inbound（她读主人私信，宿主写）', events.dmOut ? '' : 'causal kind:dm-out（真发成功才写）'].filter(Boolean).join(' + ')))
  const m = moodPair(draft)
  const k42 = !draft ? '缺：今天没有稿（drafts/' + DAY + '.json）'
    : m.degraded ? '缺：这条稿是 --no-voice 降级稿，voice 没进正文'
      : !m.label ? '缺：草稿里没有 voice.mood.label（出稿时没带情绪）'
        : m.value === null ? '缺：days/' + DAY + ' 的快照里没有 fields.mood 数值，没法对照'
          : '可对：稿面情绪「' + m.label + '」+ 当日 fields.mood=' + m.value + (m.cause ? '，归因有' : '，归因缺')
  add(!draft || m.degraded || !m.label || m.value === null || (NEUTRAL_MOOD.includes(m.label) && Math.abs(m.value) >= 0.3) ? 'watch' : 'ok', 'K4-2 稿子情绪对得上', k42)
  const d = latestDiaryDate()
  const k43 = d.seen === 0 ? '缺：两本日记里一个 `## YYYY-MM-DD` 小节都没有'
    : d.latest === DAY ? '可对：最新小节就是今天（' + d.latest + '），今日 diary 事件 ' + events.diary + ' 条'
      : '错位：日记最新小节 ' + (d.latest ?? '—') + '，今天 ' + DAY + '（今日 diary 事件 ' + events.diary + ' 条）'
  add(d.seen === 0 || d.latest !== DAY ? 'watch' : 'ok', 'K4-3 日记日期错位', k43)
} else {
  add('watch', 'K4 三条', '缺：因果账本读不到，三条都算不出')
}

// ⑤ kill 开关与风控暂停
if (isKillOn()) add('watch', 'kill 开关', '已触发：' + path.join(CONTROL, 'kill') + '（所有写操作停）')
else add('ok', 'kill 开关', '未触发')
const ts = readJson(path.join(BILI_AI, 'traffic-state.json'))
const ban = readJson(path.join(BILI_AI, 'api-ban.json'))
const pauseUntil = Math.max(Number(ts?.until ?? 0), Number(ban?.until ?? 0))
if (Number.isFinite(pauseUntil) && pauseUntil > Date.now()) add('watch', '风控暂停', '暂停到 ' + new Date(pauseUntil).toLocaleString('zh-CN', { hour12: false }) + (ts?.reason ? '（' + ts.reason + '）' : ''))
else add('ok', '风控暂停', '未暂停')

// ⑥ live 代码指纹：观测协议说"证据归因靠 live 冻结在同一份代码"，但本项目里
// World 每个工具都是 `spawn(node tools/bili.mjs …)`——**改 dsh 不重启就立刻生效**。
// 所以"今天没重启"根本证明不了"今天没改 live"，只能逐日对一次 git 指纹（本地读，不联网）。
const anchor = checkAnchor()
const stamp = (iso) => String(iso ?? '').slice(0, 16).replace('T', ' ')
if (anchor.state === 'missing') add('watch', 'live 代码锚点', '未锚定：观测期没有可比对的代码基线（先跑 node scripts/live-code-anchor.mjs --set）')
else if (anchor.state === 'drift') add('watch', 'live 代码锚点', `相对 ${stamp(anchor.at)} 的锚点漂移：` + anchor.drift.map((d) => `${d.name}（${d.why}）`).join('、') + ' —— 观测窗内这算行为变更')
else add('ok', 'live 代码锚点', `与 ${stamp(anchor.at)} 的锚点一致：` + anchor.hosts.map((h) => `${h.name}=${h.cur.short}${h.cur.dirty ? '(未提交改动)' : ''}`).join(' · '))

const fatal = rows.filter((r) => r.level === 'fatal').length
const watch = rows.filter((r) => r.level === 'watch').length
const code = fatal ? 2 : (watch ? 1 : 0)
const result = { day: DAY, at: new Date().toISOString(), exit: code, fatal, watch, rows }
if (asJson) console.log(JSON.stringify(result, null, 2))
else {
  console.log(`# 例行汇总 · ${DAY}（只读，未联网）`)
  for (const r of rows) console.log(`${r.level === 'ok' ? '✓ ' : r.level === 'watch' ? '⚠ ' : '✗ '}${r.name}  ${r.detail}`)
  console.log(`\n${code === 0 ? '没有要人看的事' : code === 1 ? watch + ' 项要你看一眼' : fatal + ' 项是硬的（进程/关键文件）'}`)
}
process.exitCode = code

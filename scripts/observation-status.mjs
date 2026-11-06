/**
 * 观测期状态：只读，给每天 20–30 分钟的检查用。
 *
 *   node scripts/observation-status.mjs [--json]
 *
 * 观察窗口由 control/observation.json 定义：
 *   { "startDay": "2026-10-31", "days": 14 }
 * 未创建该文件时，输出 "not-started"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME as WHALE_HOME, actionLedgerPaths, dayEvidencePaths } from '../tools/lib/paths.mjs'

const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const DAYS = path.join(WHALE_HOME, 'bili-whale', 'days')
const CFG = path.join(CONTROL, 'observation.json')
const CAUSAL = path.join(WHALE_HOME, 'bili-whale', 'causal.jsonl')
const asJson = process.argv.includes('--json')

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const logicalDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE') // 自然日

/** 该逻辑日有没有她自然醒过的记录（kind:'action'）。
 *
 * 账源随架构搬家（2026-11-06）：新家行动账在部署 `actions.ndjson`（B14 账本），
 * 旧 causal.jsonl 停在 11-03。两本都读；路径解析在 paths.mjs 统一。 */
function actionDays() {
  const set = new Set()
  const { legacy, current } = actionLedgerPaths()
  try {
    for (const line of fs.readFileSync(legacy, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e?.kind === 'action' && Number.isFinite(Number(e.atMs))) set.add(logicalDay(Number(e.atMs)))
      } catch {}
    }
  } catch {}
  try {
    for (const line of fs.readFileSync(current, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const r = JSON.parse(line)
        if (r?.day && r?.activity) set.add(String(r.day))
        else if (Number.isFinite(Number(r?.at))) set.add(logicalDay(Number(r.at)))
      } catch {}
    }
  } catch {}
  return set
}

function draftPath(day) {
  const legacy = 'D:/AI/养鱼/drafts'
  const isDefault = path.resolve(WHALE_HOME).toLowerCase() === path.resolve(process.env.USERPROFILE || '', '.dsh').toLowerCase()
  const dir = process.env.WHALE_DRAFTS || (isDefault && fs.existsSync(legacy) ? legacy : path.join(WHALE_HOME, 'bili-whale', 'drafts'))
  return path.join(dir, day + '.json')
}
/**
 * 当天有没有留下**对外的东西**（新架构口径，2026-11-06）。
 * 旧口径靠 daily draft.json；撕封条之后那条产物线不再产生，改看真产物：
 * 当天日记页正文 / 当天记忆卡 / 待放行队列条目。旧 draft 若存在仍算最硬的证据。
 */
function hasOutwardEvidence(day, draftOk) {
  if (draftOk) return true
  const ev = dayEvidencePaths()
  try {
    for (const book of ['public', 'private']) {
      const raw = fs.readFileSync(path.join(ev.diary, book + '.md'), 'utf8')
      const dayRe = new RegExp('^#{1,3}\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$', 'gm')
      let m
      while ((m = dayRe.exec(raw)) !== null) {
        if (m[1] !== day) continue
        const start = m.index + m[0].length
        const rest = raw.slice(start)
        const nextDay = /^#{1,3}\s*\d{4}-\d{2}-\d{2}\s*$/m.exec(rest)
        const body = (nextDay ? rest.slice(0, nextDay.index) : rest).trim()
        if (body.length > 0) return true
      }
    }
  } catch {}
  try {
    const q = JSON.parse(fs.readFileSync(ev.pendingQueue, 'utf8'))
    if (Array.isArray(q) && q.some((it) => String(it?.createdAt ?? it?.day ?? '').slice(0, 10) === day)) return true
  } catch {}
  return false
}
function normalize(s) {
  return String(s ?? '').replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]《》<>—…·-]/g, '')
}
function dayList(start, count) {
  const out = []
  const base = Date.parse(start)
  for (let i = 0; i < count; i += 1) out.push(new Date(base + i * 86400_000).toLocaleDateString('sv-SE'))
  return out
}

const cfg = readJson(CFG)
if (!cfg?.startDay) {
  const out = { ok: false, status: 'not-started', reason: 'control/observation.json 未创建（G3b 通过后创建）' }
  if (asJson) console.log(JSON.stringify(out, null, 2))
  else console.log('观测尚未开始：G3b 通过后创建 control/observation.json（{startDay, days:14}）')
  process.exit(0)
}

const days = dayList(cfg.startDay, Number(cfg.days ?? 14))
const today = logicalDay()
const done = days.filter((d) => d < today) // 已完整结束的逻辑日
const actionSet = actionDays()
const rows = []
for (const d of days) {
  const dir = path.join(DAYS, d)
  const summary = readJson(path.join(dir, 'day.json'))
  const cf = readJson(path.join(dir, 'counterfactual.json'))
  const draft = readJson(draftPath(d))
  const flags = summary?.flags ?? {}
  const draftOk = !!draft?.diaryHash && draft.date === d && draft.degraded !== true
  rows.push({
    day: d,
    ended: d < today,
    snapshot: fs.existsSync(path.join(dir, 'state.start.json')),
    draft: draftOk,
    // 当天有对外凭据：旧口径 = daily draft；新口径 = 日记页/记忆卡/待放行条目
    evidence: hasOutwardEvidence(d, draftOk),
    action: actionSet.has(d),
    text: draft?.text ?? '',
    cfOk: !!cf?.ok,
    mood: cf?.realMood ?? null,
    tainted: flags.tainted === true,
    missed: flags.missed === true,
  })
}
const inWindow = rows.filter((r) => r.ended)
// K1 = 当天有对外凭据，且当天至少有一次自然行动；重启补稿不能单独撑起一天
const k1 = inWindow.filter((r) => r.evidence && r.action).length
// 中性标签：新词汇是「宁静」，旧数据里是「平静」——两者都不算“有情绪”
const k3 = inWindow.filter((r) => r.cfOk && r.mood && r.mood !== '宁静' && r.mood !== '平静').length
let k2 = 0
for (let i = 1; i < inWindow.length; i += 1) {
  if (normalize(inWindow[i - 1].text) && normalize(inWindow[i].text) && normalize(inWindow[i - 1].text) !== normalize(inWindow[i].text)) k2 += 1
}
const tainted = rows.filter((r) => r.tainted).length
const missing = rows.filter((r) => r.ended && !r.snapshot).length

const result = {
  ok: k1 >= 11 && k2 >= 9 && k3 >= 3,
  startDay: cfg.startDay,
  days: days.length,
  endedDays: inWindow.length,
  k1_drafts: { value: k1, need: 11 },
  k2_textDiff: { value: k2, need: 9 },
  k3_moodNotCalm: { value: k3, need: 3 },
  tainted,
  missing,
  rows,
}
if (asJson) console.log(JSON.stringify(result, null, 2))
else {
  console.log(`# 观测 ${cfg.startDay} + ${days.length} 天｜已结束 ${inWindow.length} 天`)
  console.log(`K1 有稿 ${k1}/11｜K2 文本不同 ${k2}/9｜K3 情绪非宁静 ${k3}/3`)
  console.log(`tainted=${tainted}  missing=${missing}`)
  for (const r of rows.slice(-7)) console.log(`${r.day} ${r.ended ? '' : '(进行中)'} snap=${r.snapshot ? 'y' : 'n'} draft=${r.draft ? 'y' : 'n'} cf=${r.cfOk ? 'ok' : '-'} mood=${r.mood ?? '-'}${r.tainted ? ' TAINTED' : ''}${r.missed ? ' MISSED' : ''}`)
  console.log(result.ok ? '\n三条 kill criterion 已满足' : '\n未满足（继续观测，不许补数据）')
}
process.exit(result.ok ? 0 : 1)

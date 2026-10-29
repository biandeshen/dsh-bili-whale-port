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
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const DAYS = path.join(WHALE_HOME, 'bili-whale', 'days')
const CFG = path.join(CONTROL, 'observation.json')
const CAUSAL = path.join(WHALE_HOME, 'bili-whale', 'causal.jsonl')
const asJson = process.argv.includes('--json')

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }
const logicalDay = (now = Date.now()) => new Date(now - 4 * 3600_000).toLocaleDateString('sv-SE')

/** 该逻辑日有没有她自然醒过的记录（kind:'action'）。 */
function actionDays() {
  const set = new Set()
  try {
    for (const line of fs.readFileSync(CAUSAL, 'utf8').split('\n')) {
      if (!line.trim()) continue
      try {
        const e = JSON.parse(line)
        if (e?.kind === 'action' && Number.isFinite(Number(e.atMs))) set.add(logicalDay(Number(e.atMs)))
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
  rows.push({
    day: d,
    ended: d < today,
    snapshot: fs.existsSync(path.join(dir, 'state.start.json')),
    draft: !!draft?.diaryHash && draft.date === d && draft.degraded !== true,
    action: actionSet.has(d),
    text: draft?.text ?? '',
    cfOk: !!cf?.ok,
    mood: cf?.realMood ?? null,
    tainted: flags.tainted === true,
    missed: flags.missed === true,
  })
}
const inWindow = rows.filter((r) => r.ended)
// K1 = 当天有合规稿，且当天至少有一次自然行动；重启补稿不能单独撑起一天
const k1 = inWindow.filter((r) => r.draft && r.action).length
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

/**
 * 每日反事实：同一天、同一份日记，用「真实状态」与「中性状态」各出一版草稿，
 * 量出差异。G3b 要求连续 3 天 diff ≥ 4 字。
 *
 *   cd Cortico && node --import tsx ../dsh-bili-whale/scripts/counterfactual.mjs --date 2026-10-28
 *   ... --json
 */
import fs from 'node:fs'
import path from 'node:path'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'
import { composeDraft } from './draft-dynamic.mjs'

const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const argv = process.argv.slice(2)
const arg = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }
const asJson = argv.includes('--json')
const DAY_BOUNDARY_HOUR = 4
const logicalDay = (now = Date.now()) => new Date(now - DAY_BOUNDARY_HOUR * 3600_000).toLocaleDateString('sv-SE')

const { buildVoiceBrief } = await import('file:///' + CORTICO.replace(/\\/g, '/') + '/persona-core/src/voice-brief.ts')

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }
function readText(file) { try { return fs.readFileSync(file, 'utf8') } catch { return null } }

/** 去掉标点与空白后比较，避免"只改标点"通过。 */
function normalize(s) {
  return String(s ?? '').replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]《》<>—…·-]/g, '')
}
function diffChars(a, b) {
  const A = [...normalize(a)]; const B = [...normalize(b)]
  const count = (arr) => { const m = new Map(); for (const c of arr) m.set(c, (m.get(c) ?? 0) + 1); return m }
  const ma = count(A); const mb = count(B)
  let d = 0
  for (const [c, n] of ma) d += Math.max(0, n - (mb.get(c) ?? 0))
  for (const [c, n] of mb) d += Math.max(0, n - (ma.get(c) ?? 0))
  return d
}

const day = arg('date', logicalDay())
const dir = path.join(WHALE_HOME, 'bili-whale', 'days', day)
const snapshot = readJson(path.join(dir, 'state.end.json')) || readJson(path.join(dir, 'state.start.json'))
const diary = readText(path.join(WHALE_HOME, 'whale-diary.md'))

if (!snapshot) {
  console.log(JSON.stringify({ ok: false, error: 'no-snapshot', day, dir }, null, 2))
  process.exit(2)
}
if (!diary) {
  console.log(JSON.stringify({ ok: false, error: 'no-diary', day }, null, 2))
  process.exit(2)
}

const at = Date.parse(snapshot.at) || Date.now()
// 旧快照只有 chainTail/记忆条数；缺什么就从 live fields.json 补，并显式标注 hybrid
let chain = Array.isArray(snapshot.chain) ? snapshot.chain : []
let memories = Array.isArray(snapshot.memories) ? snapshot.memories : []
let npcState = snapshot.npcState ?? snapshot.npc ?? { current: 'normal' }
let source = 'snapshot'
if (!chain.length || !memories.length) {
  const live = readJson(path.join(WHALE_HOME, 'bili-whale', 'fields.json'))
  if (live) {
    if (!chain.length) chain = live.chain ?? []
    if (!memories.length) memories = live.memories ?? []
    if (!npcState) npcState = live.npcState
    source = 'hybrid(live)'
  }
}
const realVoice = buildVoiceBrief({ fields: snapshot.fields, chain, memories, npcState }, { now: at })
const neutralVoice = {
  v: 1,
  mood: { label: '宁静', intensity: 0, reason: '对照：中性状态', cause: null },
  relation: 'normal',
  memories: [],
  banned: [],
  stance: { share: true, because: '对照' },
}

const real = composeDraft(diary, { date: day, voice: realVoice })
const neutral = composeDraft(diary, { date: day, voice: neutralVoice })

if (!real.ok || !neutral.ok) {
  console.log(JSON.stringify({ ok: false, error: 'compose-failed', real, neutral }, null, 2))
  process.exit(2)
}

const diff = diffChars(real.text, neutral.text)
const memoryHit = realVoice.memories.find((m) => m.score > 0.5)
const out = {
  ok: diff >= 4,
  day,
  at: snapshot.at,
  source,
  diffChars: diff,
  threshold: 4,
  realMood: realVoice.mood.label,
  neutralMood: neutralVoice.mood.label,
  relation: realVoice.relation,
  memoryRecall: memoryHit ? memoryHit.id : null,
  realText: real.text,
  neutralText: neutral.text,
}
if (asJson) console.log(JSON.stringify(out, null, 2))
else {
  console.log(`# 反事实 · ${day}`)
  console.log(`真实情绪：${out.realMood}｜对照：${out.neutralMood}｜差异：${diff} 字（阈值 4）`)
  console.log(`真实：${out.realText}`)
  console.log(`对照：${out.neutralText}`)
}
process.exit(out.ok ? 0 : 1)

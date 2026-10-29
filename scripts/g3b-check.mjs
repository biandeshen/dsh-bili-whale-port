/**
 * G3b 就绪审计：只读，判定"能不能开始 14 天观测"。
 *
 *   node scripts/g3b-check.mjs [--json]
 *
 * 判据（全部满足才 PASS）：
 *   1. canary 3/3（control/canary.json 三项均 pass）
 *   2. 验收脚本哈希一致（scripts/hashes.json）
 *   3. 最近连续 3 个逻辑日：每天有快照、counterfactual.ok=true 且 diff>=4、草稿带 diaryHash、无 tainted
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const asJson = process.argv.includes('--json')
const DAYS = path.join(WHALE_HOME, 'bili-whale', 'days')
const CANARY = path.join(WHALE_HOME, 'bili-whale', 'control', 'canary.json')
const HASHES = path.join(ROOT, 'scripts', 'hashes.json')
const CAUSAL = path.join(WHALE_HOME, 'bili-whale', 'causal.jsonl')

const logicalDay = (now = Date.now()) => new Date(now - 4 * 3600_000).toLocaleDateString('sv-SE')
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

/** 该逻辑日有没有她自然醒过的记录（action_due → lifeTick 写的 kind:'action'）。 */
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
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function draftPath(day) {
  const legacy = 'D:/AI/养鱼/drafts'
  const isDefault = path.resolve(WHALE_HOME).toLowerCase() === path.resolve(process.env.USERPROFILE || '', '.dsh').toLowerCase()
  const dir = process.env.WHALE_DRAFTS || (isDefault && fs.existsSync(legacy) ? legacy : path.join(WHALE_HOME, 'bili-whale', 'drafts'))
  return path.join(dir, day + '.json')
}

const checks = []
const add = (name, ok, detail) => checks.push({ name, ok, detail })

// 1) canary
const canary = readJson(CANARY)
for (const id of ['C1', 'C2', 'C3']) {
  const s = canary?.[id]?.status
  add(`canary ${id}`, s === 'pass', s ?? 'missing（control/canary.json）')
}

// 2) 哈希
let hashOk = true; const hashDetail = []
const manifest = readJson(HASHES)
if (!manifest) { hashOk = false; hashDetail.push('hashes.json missing') }
else {
  for (const [rel, want] of Object.entries(manifest.files ?? {})) {
    const abs = path.join(ROOT, rel)
    if (!fs.existsSync(abs)) { hashOk = false; hashDetail.push(`missing ${rel}`); continue }
    if (sha256(abs) !== want) { hashOk = false; hashDetail.push(`changed ${rel}`) }
  }
}
add('验收脚本哈希', hashOk, hashDetail.length ? hashDetail.join('; ') : '一致')

// 3) 连续 3 天
const today = logicalDay()
const days = []
for (let i = 1; i <= 3; i += 1) days.push(logicalDay(Date.parse(today) - i * 86400_000))
const actionSet = actionDays()
let streak = true; const dayDetail = []
for (const d of days) {
  const dir = path.join(DAYS, d)
  const cf = readJson(path.join(dir, 'counterfactual.json'))
  const draft = readJson(draftPath(d))
  const summary = readJson(path.join(dir, 'day.json'))
  const snap = readJson(path.join(dir, 'state.end.json')) || readJson(path.join(dir, 'state.start.json'))
  const snapDiaryHash = snap?.diary?.hash ?? null
  // 草稿写下后她可能又写了日记（同一天第二次行动）→ end 的哈希会变。
  // 只要草稿的 diaryHash 在该日任一 tick 的日记哈希里出现过，就证明它基于当天版本。
  const ticks = (() => {
    try {
      return fs.readFileSync(path.join(dir, 'ticks.jsonl'), 'utf8').trim().split('\n').filter(Boolean)
        .map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
    } catch { return [] }
  })()
  const tickHashes = new Set(ticks.map((t) => t?.diary?.hash).filter(Boolean))
  const flags = summary?.flags ?? {}
  const badFlags = Object.entries(flags).filter(([k, v]) => v === true && !['missed', 'late'].includes(k)).map(([k]) => k)
  const draftBound = !!draft?.diaryHash && (draft.diaryHash === snapDiaryHash || tickHashes.has(draft.diaryHash)) && draft.date === d && draft.degraded !== true
  const hasAction = actionSet.has(d)
  const cfBound = !!cf && cf.day === d
  const ok = !!cf?.ok && Number(cf?.diffChars) >= 4 && cfBound && draftBound && hasAction && badFlags.length === 0
  if (!ok) streak = false
  dayDetail.push(`${d}: cf=${cf ? (cf.ok ? 'ok' : 'fail') + '/' + cf.diffChars : 'missing'}${cf && !cfBound ? '(day-mismatch)' : ''} draftHash=${draftBound ? 'match' : (draft?.diaryHash ? 'mismatch' : 'n')} action=${hasAction ? 'y' : 'n'} flags=${badFlags.join(',') || 'ok'}`)
}
add('连续 3 天反事实', streak, dayDetail.join(' | '))

const bad = checks.filter((c) => !c.ok)
const result = { ok: bad.length === 0, ready: bad.length === 0, day: today, checks }
if (asJson) console.log(JSON.stringify(result, null, 2))
else {
  console.log('# G3b 就绪审计')
  for (const c of checks) console.log(`${c.ok ? 'PASS ' : 'PENDING'}  ${c.name}  ${c.detail}`)
  console.log(`\n${result.ok ? '可以进入 14 天观测' : bad.length + ' 项未满足'}`)
  if (!result.ok) console.log('注意：本脚本只判 readiness，不替代 G3b 评审记录。')
}
process.exit(result.ok ? 0 : 1)

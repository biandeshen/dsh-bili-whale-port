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
import { actionLedgerPaths, dayEvidencePaths, hasAutonomousCalls } from '../tools/lib/paths.mjs'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const asJson = process.argv.includes('--json')
const DAYS = path.join(WHALE_HOME, 'bili-whale', 'days')
const CANARY = path.join(WHALE_HOME, 'bili-whale', 'control', 'canary.json')
const HASHES = path.join(ROOT, 'scripts', 'hashes.json')
const CAUSAL = path.join(WHALE_HOME, 'bili-whale', 'causal.jsonl')

const logicalDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE') // 自然日（2026-10-31 拍板）
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')) } catch { return null } }

/** 该逻辑日有没有她自然醒过的记录（action_due → lifeTick 写的 kind:'action'）。
 *
 * 账源随架构搬家（2026-11-06）：旧 causal.jsonl 的 kind:'action' 最后一笔停在
 * 11-03——搬家后 lifeTick 的行动账改写部署家 `actions.ndjson`（B14 的行动账本，
 * 每笔有 day/activity/source 字段）。两本账都读：旧的管历史，新的管现在。
 * 路径解析统一在 paths.mjs（`actionLedgerPaths`）——测试把 whale home 指向临时目录时，
 * 部署家跟着隔离，不会读到本机真账。 */
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
  // 兜底：运行记录里的自主工具调用。`life_do` 是 2026-11-06 才有的工具，
  // 在那之前她做了事（11-05：55 次工具调用，记忆大扫除 + 复盘式练习）却没账可写。
  // 只看账本会把"记账工具还不存在"误判成"她什么都没干"。
  const today = logicalDay()
  for (let i = 1; i <= 3; i += 1) {
    const d = logicalDay(Date.parse(today) - i * 86400_000)
    if (set.has(d)) continue
    if (hasAutonomousCalls(d)) set.add(d)
  }
  return set
}
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

function draftPath(day) {
  const legacy = 'D:/AI/养鱼/drafts'
  const isDefault = path.resolve(WHALE_HOME).toLowerCase() === path.resolve(process.env.USERPROFILE || '', '.dsh').toLowerCase()
  const dir = process.env.WHALE_DRAFTS || (isDefault && fs.existsSync(legacy) ? legacy : path.join(WHALE_HOME, 'bili-whale', 'drafts'))
  return path.join(dir, day + '.json')
}

/**
 * 当天有没有留下**对外的东西**（新架构口径，2026-11-06）。
 *
 * 旧判据靠 daily draft.json 证明"她当天真的写了东西"；B16 撕封条之后那条产物线
 * 不再产生，改看新架构的真产物：当天日记页正文 / 当天记忆卡 / 待放行队列条目。
 * 任一为真 = 当天有对外凭据。
 */
function hasOutwardEvidence(day) {
  const ev = dayEvidencePaths()
  // ① 当天日记页有正文
  //
  // 日记结构是 `## 2026-11-04` → `## 想说`（同级）→ 正文，**正文不在日期小节里面**，
  // 而在它后面的同级小节里。所以边界是"下一个**日期**标题"，不是"下一个任意标题"。
  try {
    for (const book of ['public', 'private']) {
      const raw = fs.readFileSync(path.join(ev.diary, book + '.md'), 'utf8')
      const dayRe = new RegExp('^#{1,3}\\s*(\\d{4}-\\d{2}-\\d{2})\\s*$', 'gm')
      let m
      let found = false
      while ((m = dayRe.exec(raw)) !== null) {
        if (m[1] !== day) continue
        found = true
        const start = m.index + m[0].length
        const rest = raw.slice(start)
        const nextDay = /^#{1,3}\s*\d{4}-\d{2}-\d{2}\s*$/m.exec(rest)
        const body = (nextDay ? rest.slice(0, nextDay.index) : rest).trim()
        if (body.length > 0) return true
      }
      if (found) continue
    }
  } catch {}
  // ② 待放行队列里有当天的条目
  try {
    const q = JSON.parse(fs.readFileSync(ev.pendingQueue, 'utf8'))
    if (Array.isArray(q) && q.some((it) => String(it?.createdAt ?? it?.day ?? '').slice(0, 10) === day)) return true
  } catch {}
  return false
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
let passedDays = 0
let taintedDays = 0
const dayDetail = []
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
  /**
   * 当天有对外凭据：旧口径是「daily draft.json 绑定当天日记哈希」；新架构（撕封条后）
   * 那条产物线不再产生，改看真产物：日记页正文 / 记忆卡 / 待放行条目。
   * 旧 draft 若存在且绑定当天，仍算最硬的证据。
   */
  const evidence = draftBound || hasOutwardEvidence(d)
  const ok = !!cf?.ok && Number(cf?.diffChars) >= 4 && cfBound && evidence && hasAction && badFlags.length === 0
  if (ok) passedDays += 1
  /**
   * **污染（tainted）单独拦**：协议 §3 明写「tainted + missing > 3 → K1 直接失败，
   * 不允许用『后面多跑几天』补」。2/3 的宽容只给「历史空洞」，不给污染——
   * 污染是当天行为出问题（改码/补写/手回填），不能靠另外两天达标抵消。
   */
  if (badFlags.length) taintedDays += 1
  dayDetail.push(`${d}: cf=${cf ? (cf.ok ? 'ok' : 'fail') + '/' + cf.diffChars : 'missing'}${cf && !cfBound ? '(day-mismatch)' : ''} evidence=${evidence ? 'y' : 'n'} action=${hasAction ? 'y' : 'n'} flags=${badFlags.join(',') || 'ok'}`)
}
/**
 * 连续 3 天里**至少 2 天达标**（2026-11-06 主人拍板）。
 *
 * 为什么不是 3/3：2026-11-04/05 两天的行动账是断的（搬家后 lifeTick 的 action 记录
 * 没写进旧 causal.jsonl——这正是 B14「记账接通」修掉的毛病）。那两天她**有真实产出**
 *（公开日记页、私人日记页、记忆卡共 6 张），只是账本缺 action 行。
 * 观测窗从今天起算 14 天，历史空洞不该拦住它——但空洞也不许回填（协议 §3 污染）。
 * 口径：3 天里 2 天达标即可开窗；阈值（cf.ok / diff≥4 / evidence / action / 无 tainted）一条没松。
 */
const MIN_PASSED_DAYS = 2
// 污染单独拦：tainted 当天不计入达标，且**不允许**靠另外两天达标抵消（协议 §3）。
const streak = passedDays >= MIN_PASSED_DAYS && taintedDays === 0
add('连续 3 天反事实', streak,
  `${passedDays}/${days.length} 天达标（至少 ${MIN_PASSED_DAYS} 天）`
  + (taintedDays ? `，污染 ${taintedDays} 天（污染不宽容）` : '')
  + ` | ${dayDetail.join(' | ')}`)

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

/**
 * 对外凭据核对：她这一天到底有没有对世界留下东西（只读，零成本）。
 *
 *   node scripts/outward-evidence.mjs [--date=YYYY-MM-DD] [--json]
 *
 * 为什么要单独一支（2026-11-07 评审验收口径第 4/5 条）：
 * `story-1` 那条「至少 2 次自主行动产生对外凭据」以前是**拿 `life_do` 行动账自己当凭据**过的——
 * 而 `life_do` 是她自己写的记录，226 笔内务也能"通过"验收。判据被写软了，所以这里把凭据定义钉死：
 *
 *   硬凭据（平台侧留痕）：`dynId` / `kind:dynamic` / 评论或私信的发送回执 / 写闸 lastWriteAt > 0
 *   软凭据（本地真产物）：待放行队列里当天的条目、当天日记页正文
 *   **不算凭据**：`life_do` / `mood_apply` 这类她自己写的账
 *
 * 今天实测的对照值：开闸一整天，硬凭据 = 0（`causal.jsonl` 227 行内 dynId 0、kind:dynamic 0、
 * `traffic.lastWriteAt` 0）。这一支脚本的作用就是让那个"0"以后不需要靠人说，命令自己会说。
 */
import fs from 'node:fs'
import path from 'node:path'
import { actionLedgerPaths, dayEvidencePaths } from '../packages/cap-bilibili/src/platform/paths.mjs'

const argv = process.argv.slice(2)
const argOf = (name, dflt) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : dflt
}
const asJson = argv.includes('--json')
const date = argOf('date', new Date().toISOString().slice(0, 10))


function ledgers() {
  const { legacy, current } = actionLedgerPaths()
  return [legacy, current].filter((f) => f && fs.existsSync(f))
}

const counts = { dynId: 0, kindDynamic: 0, draftSent: 0, commentSent: 0, dmSent: 0, likeSent: 0, favSent: 0, selfReported: 0, otherLedgerRows: 0 }
const samples = []

/** 两条账的日期字段不一样：新家 `day` + 毫秒 `at`，旧家是 ISO 串 `at` + `date`。 */
function dayOf(e) {
  const direct = String(e?.day ?? e?.date ?? '')
  if (/^\d{4}-\d{2}-\d{2}$/.test(direct)) return direct
  const at = e?.atMs ?? e?.at
  const ms = typeof at === 'number' ? at : Date.parse(String(at ?? ''))
  return Number.isFinite(ms) && ms > 0 ? new Date(ms).toISOString().slice(0, 10) : ''
}

for (const file of ledgers()) {
  /**
   * 分类按"账本身份"而不只按字段名：新家的 `actions.ndjson` 整本都是**她自己写的**
   * （activity 是 consume/explore 这类活动名，不是工具名），所以整本都不能当对外凭据。
   * 上一版按 `life_do/mood_apply` 这些工具名去认，结果把 226 笔自记读成 0 笔——
   * "工具没读到"和"真的没有"是两个完全不同的结论，必须分开（这正是本脚本要消灭的那类错）。
   */
  const selfOnlyLedger = file.endsWith('actions.ndjson')
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue
    let e
    try { e = JSON.parse(line) } catch { continue }
    if (dayOf(e) !== date) continue
    const raw = JSON.stringify(e)
    let hardThis = 0
    if (e?.dynId || /"dyn_id"/.test(raw)) { counts.dynId += 1; hardThis += 1; samples.push(`dynId ${e.dynId ?? ''}`) }
    // 旧家真回执的形状是 { kind:'draft-result', draftId:'dyn-…', result:'sent' }
    if (e?.kind === 'draft-result' && String(e?.result ?? '').toLowerCase() === 'sent') {
      counts.draftSent += 1; hardThis += 1; samples.push(`draft-result sent ${e.draftId ?? ''}`)
    }
    if (e?.kind === 'dynamic' || e?.activity === 'dynamic') { counts.kindDynamic += 1; hardThis += 1; samples.push('kind:dynamic') }
    if (e?.kind === 'comment' || e?.activity === 'comment') { counts.commentSent += 1; hardThis += 1; samples.push('comment') }
    if (e?.kind === 'dm' || e?.activity === 'dm_reply') { counts.dmSent += 1; hardThis += 1; samples.push('dm') }
    if (e?.activity === 'like') { counts.likeSent += 1; hardThis += 1 }
    if (e?.activity === 'fav') { counts.favSent += 1; hardThis += 1 }
    if (hardThis > 0 || !selfOnlyLedger) counts.otherLedgerRows += 1
    if (selfOnlyLedger && hardThis === 0) counts.selfReported += 1
  }
}

const ev = dayEvidencePaths()
const pendingToday = (() => {
  try {
    const q = JSON.parse(fs.readFileSync(ev.pendingQueue, 'utf8'))
    return Array.isArray(q) ? q.filter((it) => String(it?.createdAt ?? it?.day ?? '').slice(0, 10) === date).length : 0
  } catch { return 0 }
})()
const lastWriteAt = (() => {
  try { return Number(JSON.parse(fs.readFileSync(path.join(path.dirname(ev.pendingQueue), 'traffic-state.json'), 'utf8')).lastWriteAt ?? 0) } catch { return 0 }
})()

const hard = counts.dynId + counts.kindDynamic + counts.draftSent + counts.commentSent + counts.dmSent + (lastWriteAt > 0 ? 1 : 0)
const soft = pendingToday
const verdict = hard > 0 ? 'PASS 有对外凭据' : soft > 0 ? 'PART 只有待放行（还没真发出去）' : 'FAIL 今天对外产出为 0'

if (asJson) {
  console.log(JSON.stringify({ date, hard, soft, verdict, counts, pendingToday, lastWriteAt, ledgers: ledgers(), samples: samples.slice(0, 10) }, null, 2))
} else {
  console.log(`# 对外凭据核对 ${date}`)
  console.log(`  账本：${ledgers().join(' ｜ ') || '(没有可读的行动账)'}`)
  console.log(`  硬凭据（平台侧留痕）合计 ${hard}`)
  console.log(`    · dynId ${counts.dynId} · 真发出去的回执 draft-result/sent ${counts.draftSent} · kind:dynamic ${counts.kindDynamic}`)
  console.log(`    · 评论 ${counts.commentSent} · 私信 ${counts.dmSent} · 赞 ${counts.likeSent} · 收藏 ${counts.favSent} · 写闸 lastWriteAt ${lastWriteAt || '(从未写过)'}`)
  console.log(`  软凭据（本地待放行条目） ${soft}`)
  console.log(`  对照：她自记的行动账 ${counts.selfReported} 笔 —— **一律不算对外凭据**（判据见评审验收第 5 条）`)
  if (samples.length) console.log(`  样本：${samples.slice(0, 6).join(' ｜ ')}`)
  console.log(`\n  判定：${verdict}`)
}
process.exitCode = hard > 0 ? 0 : 1

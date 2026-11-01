/**
 * 存量更正（#55 后半，2026-11-01）：有一批记忆是**她自己**的判断（sender=npc），
 * 却被打上 `source: user_said`（"主人说的"）。后果不是格式难看：
 *   · 召回与提示里会出现"主人说过……"，而那句话她从没人说过；
 *   · user_said 衰减更慢（0.9 vs 1.0），错的标签让错的话记得更牢。
 *
 * 写入口径已经在 personaAdapter 修好了（#30），这里只清存量。
 * 默认**只报告不动盘**；`--go` 才写，写之前留时间戳 .bak。
 * 已经自己作废过的条目不碰——那是她的更正，不是我们的迁移。
 *
 * 用法：node scripts/repair-memory-source.mjs [--go]
 */
import fs from 'node:fs'
import path from 'node:path'
import { whalePath } from '../tools/lib/paths.mjs'

const GO = process.argv.includes('--go')
const file = whalePath('bili-whale', 'fields.json')

const classify = (m) => {
  if (!m || typeof m !== 'object') return 'broken'
  if (m.voided === true) return 'voided'
  if (m.source !== 'user_said') return 'clean'
  const isDm = Array.isArray(m.tags) && m.tags.includes('dm')
  if (m.sender === 'npc') return 'mislabelled'          // 她想的 → 该是 npc_self
  if (m.sender === 'player' && !isDm) return 'suspicious' // 说是主人说的，但没私信留痕：只报不动
  return 'clean'
}

if (!fs.existsSync(file)) {
  console.log(JSON.stringify({ ok: true, file, total: 0, changed: 0, note: '还没有 fields.json，无需更正' }, null, 2))
  process.exit(0)
}

const raw = fs.readFileSync(file, 'utf8')
let state
try { state = JSON.parse(raw) } catch (e) {
  console.error(`[repair] 读不了 ${file}：${e.message}（状态文件坏的时候不要写，先恢复）`)
  process.exit(1)
}
const memories = Array.isArray(state.memories) ? state.memories : []
const buckets = {}
for (const m of memories) {
  const k = classify(m)
  ;(buckets[k] ??= []).push(m)
}
const mis = buckets.mislabelled ?? []
const sus = buckets.suspicious ?? []
const rep = {
  file,
  total: memories.length,
  mislabelled: mis.length,
  suspicious: sus.length,
  voided: (buckets.voided ?? []).length,
  clean: (buckets.clean ?? []).length,
  broken: (buckets.broken ?? []).length,
  mode: GO ? 'write' : 'dry-run',
}
console.log(JSON.stringify(rep, null, 2))
if (mis.length) console.log('要改成 npc_self 的：\n' + mis.map((m) => `- ${m.id} ${(m.content || '').replace(/\s+/g, ' ').slice(0, 46)}`).join('\n'))
if (sus.length) console.log('只报不动（说是主人说的却没有私信留痕，得人工看）：\n' + sus.map((m) => `- ${m.id} ${(m.content || '').replace(/\s+/g, ' ').slice(0, 46)}`).join('\n'))

if (!GO) {
  console.log('\n（dry-run：什么都没改。确认过上面这份名单再跑 --go）')
  process.exit(0)
}
if (!mis.length) { console.log('没有可改的条目，不写盘。'); process.exit(0) }

const bak = `${file}.bak-${Date.now()}`
fs.writeFileSync(bak, raw)
for (const m of mis) m.source = 'npc_self'
state.memoryRepair = { at: new Date().toISOString(), from: 'user_said', to: 'npc_self', ids: mis.map((m) => m.id), backup: path.basename(bak) }
// 与 Cortico 的 saveState 一样：写坏等于把她整个人抹掉，所以先写临时文件再换名。
const tmp = `${file}.repair-tmp`
fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
fs.renameSync(tmp, file)
console.log(`\n已改 ${mis.length} 条 → npc_self；原件备份 ${bak}`)

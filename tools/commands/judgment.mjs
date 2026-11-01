/**
 * 判断卡 CLI（2026-11-01，方案 A）。
 *
 * 用法:
 *   node bili.mjs judgment add --scope feed --stance avoid --tokens "助眠,白噪音" --reason "…" [--bvid BV…]
 *   node bili.mjs judgment list [--json] [--status proposed|adopted|rejected|all]
 *
 * 采纳（adopt）与驳回（reject）**不在这里**：它们只有世界页的 invoke 能调，
 * 主人身份由 WebUI 会话决定（见 tools/lib/judgment.mjs 头部红线）。
 * 只写本地文件，不联网、不动 B 站。
 */
import path from 'node:path'
import { appendJudgment, listJudgments, JUDGMENT_FILE } from '../lib/judgment.mjs'

const argv = process.argv.slice(2)
const isMain = process.argv[1] && path.resolve(process.argv[1]).endsWith(path.join('tools', 'commands', 'judgment.mjs'))

if (isMain) {
  const cmd = argv[0]
  const flag = (k) => argv.includes('--' + k)
  const val = (k) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : undefined }

  if (cmd === 'add') {
    const r = appendJudgment({
      scope: val('scope') || 'feed',
      stance: val('stance') || 'prefer',
      tokens: val('tokens'),
      reason: val('reason'),
      bvid: val('bvid'),
    })
    if (r.ok) console.log(`[judgment] 已提卡 ${r.id}（${r.stance} · ${r.tokens.join('、')}）；要主人在世界页采纳后才影响 feed`)
    else console.error('[judgment] ' + r.error)
    process.exit(r.ok ? 0 : 2)
  }
  if (cmd === 'list') {
    const r = listJudgments(JUDGMENT_FILE, { status: val('status') || 'all' })
    if (flag('json')) console.log(JSON.stringify(r, null, 2))
    else {
      console.log(`待采纳 ${r.proposed} 张 · 已采纳 ${r.adopted} 张（共 ${r.total}）`)
      for (const it of r.items) console.log(`  ${it.id} [${it.stance}·${it.scope}·${it.status}] ${it.day} ${it.tokens.join('、')} ← ${it.reason}`)
      if (!r.items.length) console.log('  （空）')
    }
    process.exit(0)
  }
  console.error('用法: judgment add --tokens "a,b" --reason "…" [--scope feed|draft|dm|any] [--stance prefer|avoid|noise] [--bvid BV…] | list [--json] [--status …]')
  process.exit(2)
}

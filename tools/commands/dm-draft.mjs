/**
 * 私信回信草稿（只入队，不发送）。
 *
 * 用法:
 *   node tools/bili.mjs dm-draft add --text "…" [--inbound <key>] [--who 鱼片] [--src "他说的"]
 *   node tools/bili.mjs dm-draft list [--json]
 *
 * 审批不在本脚本：scripts/dm-approve.mjs list / approve <id> --token … --go
 */
import { DSH_HOME, dshPath } from '../lib/paths.mjs'
import { addDraft, attachAck, loadDrafts } from '../lib/dm-drafts.mjs'
import * as ack from '../../scripts/ack.mjs'

const argv = process.argv.slice(2)
const cmd = argv[0]
const opt = {}
for (let i = 1; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[argv[i].slice(2)] = true
    else { opt[argv[i].slice(2)] = v; i += 1 }
  } else if (!opt._a) opt._a = argv[i]
}
const FILE = dshPath('bili-whale', 'control', 'dm-drafts.json')

if (cmd === 'list') {
  const db = loadDrafts(FILE)
  if (argv.includes('--json')) { console.log(JSON.stringify(db, null, 2)); process.exit(0) }
  if (!db.items.length) { console.log('（没有回信草稿）'); process.exit(0) }
  for (const x of db.items.slice(-20)) {
    console.log(`  ${x.id}  ${x.status}  → ${x.who || '鱼片'}  「${x.text.slice(0, 40)}${x.text.length > 40 ? '…' : ''}」`)
  }
  process.exit(0)
}

if (cmd === 'add') {
  const text = String(opt.text ?? '').trim()
  if (!text) { console.error('需要 --text'); process.exit(2) }
  const inboundKey = String(opt.inbound ?? '').trim()
  // 先入队拿 id，再挂一次性令牌；令牌只在审批 CLI 的 list 里出现，不进模型上下文
  const first = addDraft(FILE, { text, inboundKey, who: opt.who, src: opt.src })
  if (!first.ok) { console.error('[dm-draft] ' + first.error); process.exit(2) }
  try {
    const it = ack.enqueue(DSH_HOME, {
      kind: 'dm',
      draftId: first.item.id,
      textHash: first.item.textHash,
      inboundKey,
    })
    attachAck(FILE, first.item.id, { ackId: it.id, expiresAt: it.expiresAt })
    console.log(`[dm-draft] 已入队 ${first.item.id}（只入队，未发送；${text.length} 字，等主人审批）`)
  } catch (e) {
    console.error('[dm-draft] 已入队但令牌生成失败：' + String(e?.message ?? e))
    process.exit(1)
  }
  process.exit(0)
}

console.error('用法: dm-draft add --text "…" [--inbound key] [--who 名字] [--src "他说的"] | dm-draft list [--json]')
process.exit(2)

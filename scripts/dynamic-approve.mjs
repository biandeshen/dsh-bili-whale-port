/**
 * 草稿审批（Track A）：list / approve <id> / reject <id> [--dry]
 * 默认 dry：只打印将执行的命令；--go 才真正发送（需显式，且过 kill 开关）。
 * 幂等：已 approved/sent 的草稿拒绝再次执行；失败记 failed，不自动重试。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'

const DRAFTS = process.env.WHALE_DRAFTS || 'D:/AI/养鱼/drafts'
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const KILL = path.join(CONTROL, 'kill')
const AUDIT = path.join(DRAFTS, 'audit.jsonl')
const BILI = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'tools', 'bili.mjs')

function load(id) {
  const files = fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')) : []
  for (const f of files) {
    const p = path.join(DRAFTS, f)
    const d = JSON.parse(fs.readFileSync(p, 'utf8'))
    if (d.id === id || f === id + '.json' || f.startsWith(id)) return { file: p, draft: d }
  }
  return null
}
function save(file, draft) { fs.writeFileSync(file, JSON.stringify(draft, null, 2) + '\n', 'utf8') }
function audit(entry) { fs.mkdirSync(DRAFTS, { recursive: true }); fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + '\n') }

export function approve({ id, go = false, runner } = {}) {
  const hit = load(id)
  if (!hit) return { ok: false, error: '找不到草稿 ' + id }
  const d = hit.draft
  if (['approved', 'sent', 'rejected', 'failed'].includes(d.status)) return { ok: false, error: '草稿已处理过：' + d.status }
  if (fs.existsSync(KILL)) { audit({ id: d.id, action: 'approve', result: 'blocked-kill' }); return { ok: false, error: 'kill switch 已触发' } }
  audit({ id: d.id, action: 'approve', mode: go ? 'go' : 'dry', image: d.image, textHash: crypto.createHash('sha1').update(d.text).digest('hex') })
  const args = ['dynamic-image', '--image', d.image, '--text', d.text, go ? '--go' : '--dry']
  const run = runner || ((a) => spawnSync(process.execPath, [BILI, ...a], { encoding: 'utf8', timeout: 120000, env: { ...process.env, BILI_SEND: go ? '1' : '0' } }))
  const r = run(args)
  const out = String(r.stdout ?? '') + String(r.stderr ?? '')
  const ok = (r.status === 0) && (go ? /dyn_id|dynamic|成功|code=0/i.test(out) : true)
  d.status = ok ? (go ? 'sent' : 'dry-run') : 'failed'
  d.result = { ok, at: new Date().toISOString(), mode: go ? 'go' : 'dry', out: out.slice(-800) }
  save(hit.file, d)
  audit({ id: d.id, action: go ? 'send' : 'dry-run', result: ok ? d.status : 'failed', exit: r.status ?? null, outHash: crypto.createHash('sha1').update(out).digest('hex') })
  return { ok, status: d.status, out: out.slice(-800) }
}
export function reject(id) {
  const hit = load(id)
  if (!hit) return { ok: false, error: '找不到草稿 ' + id }
  hit.draft.status = 'rejected'; hit.draft.rejectedAt = new Date().toISOString(); save(hit.file, hit.draft)
  audit({ id: hit.draft.id, action: 'reject' })
  return { ok: true }
}
export function list() {
  const files = fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).sort().reverse() : []
  return files.map((f) => { const d = JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8')); return { id: d.id, date: d.date, status: d.status, image: d.image, text: d.text } })
}

if (process.argv[1] && process.argv[1].endsWith('dynamic-approve.mjs')) {
  const [cmd, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  const go = process.argv.includes('--go')
  const out = cmd === 'list' ? { ok: true, items: list() }
    : cmd === 'approve' ? approve({ id, go })
    : cmd === 'reject' ? reject(id)
    : { ok: false, error: '用法：list | approve <id> [--go] | reject <id>' }
  console.log(JSON.stringify(out, null, 2))
  process.exitCode = out.ok ? 0 : 1
}

/**
 * 草稿审批（Track A）：list / approve <id> / reject <id> [--go]
 * 默认 dry：只打印将执行的命令；--go 才真正发送（需显式，且过 kill 开关）。
 * 幂等：已 sent/rejected/failed 拒绝重放；dry-run 不消耗审批。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { DSH_HOME as WHALE_HOME } from '../tools/lib/paths.mjs'
import * as ack from './ack.mjs'

const LEGACY_DRAFTS = 'D:/AI/养鱼/drafts'
const DRAFTS = process.env.WHALE_DRAFTS || (fs.existsSync(LEGACY_DRAFTS) ? LEGACY_DRAFTS : path.join(WHALE_HOME, 'bili-whale', 'drafts'))
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const KILL = path.join(CONTROL, 'kill')
const AUDIT = path.join(DRAFTS, 'audit.jsonl')
const BILI = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'tools', 'bili.mjs')

function load(id) {
  if (!id) return null
  const files = fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')) : []
  for (const f of files) {
    const p = path.join(DRAFTS, f)
    try {
      const d = JSON.parse(fs.readFileSync(p, 'utf8'))
      if (d.id === id || f === id + '.json') return { file: p, draft: d }
    } catch {}
  }
  return null
}
function save(file, draft) {
  const tmp = file + '.' + process.pid + '.' + crypto.randomBytes(3).toString('hex') + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(draft, null, 2) + String.fromCharCode(10), 'utf8')
  fs.renameSync(tmp, file)
}
function audit(entry) { fs.mkdirSync(DRAFTS, { recursive: true }); fs.appendFileSync(AUDIT, JSON.stringify({ at: new Date().toISOString(), ...entry }) + String.fromCharCode(10)) }

/**
 * 把审批结果写进她自己的因果链：她下次醒来会由代码结算成 draftApproved/draftRejected。
 * 只写事件，不改场值——场值归 World（唯一事实源）管，这里不越权。
 */
function recordDraftResult(draft, result) {
  try {
    const file = path.join(WHALE_HOME, 'bili-whale', 'causal.jsonl')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({
      at: new Date().toISOString(),
      kind: 'draft-result',
      draftId: draft.id,
      date: draft.date,
      result,
      textHash: crypto.createHash('sha1').update(String(draft.text ?? '')).digest('hex').slice(0, 12),
    }) + String.fromCharCode(10))
  } catch {}
}
function markUsed(image) {
  try {
    const f = path.join(path.dirname(image), 'used-images.json')
    const cur = JSON.parse(fs.readFileSync(f, 'utf8'))
    cur.used = [...new Set([...(cur.used || []), path.basename(image)])]
    cur.updatedAt = new Date().toISOString()
    fs.writeFileSync(f, JSON.stringify(cur, null, 2) + String.fromCharCode(10))
  } catch {}
}

export function approve({ id, token, go = false, runner } = {}) {
  const hit = load(id)
  if (!hit) return { ok: false, error: '找不到草稿 ' + id }
  const d = hit.draft
  // failed 允许重试：写之前就可能失败（网络/超时/风控），拦住等于一条草稿报废。
  // 重复发送由 traffic 层的幂等与间隔保护兜底，不靠这里挡。
  // sending = 已在发送中途（进程可能被杀）：绝不允许自动重放，先人工核对平台。
  const blocked = ['sent', 'rejected', 'sending']
  if (blocked.includes(d.status)) {
    return { ok: false, error: d.status === 'sending' ? '上次发送中断（sending），先人工核对 B 站有没有发出去，再决定 reject/重写' : '草稿已处理过：' + d.status }
  }
  if (fs.existsSync(KILL)) { audit({ id: d.id, action: 'approve', result: 'blocked-kill' }); return { ok: false, error: 'kill switch 已触发' } }
  if (go) {
    if (!d.ackId) return { ok: false, error: '旧草稿没有一次性令牌，请重新生成草稿再发' }
    const a = ack.approve(WHALE_HOME, d.ackId, token)
    if (!a.ok) return { ok: false, error: '一次性令牌校验失败：' + a.error, code: a.code }
  }
  audit({ id: d.id, action: 'approve', mode: go ? 'go' : 'dry', image: d.image, textHash: crypto.createHash('sha1').update(d.text).digest('hex') })
  // 发送前先落 sending：如果进程在这之后被杀，重试会被 blocked 拦住，绝不自动重放。
  if (go) {
    d.status = 'sending'
    d.sendingAt = new Date().toISOString()
    save(hit.file, d)
  }
  const args = ['dynamic-image', '--image', d.image, '--text', d.text, go ? '--go' : '--dry']
  const run = runner || ((a) => spawnSync(process.execPath, [BILI, ...a], { encoding: 'utf8', timeout: 300000, env: { ...process.env, BILI_SEND: go ? '1' : '0' } }))
  let r
  try { r = run(args) } catch (e) { r = { status: -1, stdout: '', stderr: String(e?.message ?? e) } }
  const out = String(r.stdout ?? '') + String(r.stderr ?? '')
  const ok = (r.status === 0) && (go ? /dyn_id=\S+/.test(out) : true)
  const transient = !ok && /冷却|TRAFFIC_PAUSED|请稍后/.test(out)
  d.status = ok ? (go ? 'sent' : 'dry-run') : (transient ? 'cooldown' : 'failed')
  d.result = { ok, at: new Date().toISOString(), mode: go ? 'go' : 'dry', out: out.slice(-800) }
  save(hit.file, d)
  // 没发出去就把一次性令牌退回去，主人/她能拿同一个 token 重试。
  // （10-26 那轮连撞 6 次 send failed，旧逻辑每次都在发送前吞掉令牌，一条草稿就废了）
  if (go && !ok && d.ackId) {
    try { ack.release(WHALE_HOME, d.ackId) } catch {}
  }
  if (go && ok) markUsed(d.image)
  // 只有真正发出去/明确被拒才回写因果；dry 与冷却不算审批结果
  if (go && ok) recordDraftResult(d, 'sent')
  audit({ id: d.id, action: go ? 'send' : 'dry-run', result: ok ? d.status : 'failed', exit: r.status ?? null, outHash: crypto.createHash('sha1').update(out).digest('hex') })
  return { ok, status: d.status, out: out.slice(-800) }
}
export function reject(id) {
  const hit = load(id)
  if (!hit) return { ok: false, error: '找不到草稿 ' + id }
  // 已发出的草稿不能被改成 rejected：那会让审计和她的记忆都对不上真实发生过的事
  if (hit.draft.status === 'sent') return { ok: false, error: '这条已经发出去了，不能再拒' }
  hit.draft.status = 'rejected'; hit.draft.rejectedAt = new Date().toISOString(); save(hit.file, hit.draft)
  recordDraftResult(hit.draft, 'rejected')
  audit({ id: hit.draft.id, action: 'reject' })
  return { ok: true }
}
export function list() {
  const files = fs.existsSync(DRAFTS) ? fs.readdirSync(DRAFTS).filter((f) => f.endsWith('.json')).sort().reverse() : []
  return files.map((f) => {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8'))
      return { id: d.id, date: d.date, status: d.status, image: d.image, text: d.text }
    } catch { return null }
  }).filter(Boolean)
}

if (process.argv[1] && process.argv[1].endsWith('dynamic-approve.mjs')) {
  const [cmd, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (cmd === 'list') {
    const drafts = list()
    const pend = ack.listPending(WHALE_HOME)
    const byDraft = new Map(pend.map((p) => [p.payload?.draftId, p]))
    if (!drafts.length) console.log('（没有草稿）')
    for (const d of drafts) {
      const p = byDraft.get(d.id)
      console.log(`${d.id}  [${d.status}]  ${path.basename(d.image)}`)
      console.log(`   ${String(d.text).replace(/\s+/g, ' ').slice(0, 70)}`)
      if (p) console.log(`   待审 token: ${p.token}  过期 ${new Date(p.expiresAt).toLocaleString()}`)
      else if (d.status === 'pending') console.log('   待审 token: （无或已过期，不能真发；请重新生成草稿）')
    }
    process.exitCode = 0
    process.exit(0)
  }
  const go = process.argv.includes('--go')
  const ti = process.argv.indexOf('--token')
  const token = ti >= 0 ? process.argv[ti + 1] : ''
  const out = cmd === 'approve' ? approve({ id, token, go })
    : cmd === 'reject' ? reject(id)
    : { ok: false, error: '用法：list | approve <id> [--token T] [--go] | reject <id>' }
  console.log(JSON.stringify(out, null, 2))
  process.exitCode = out.ok ? 0 : 1
}

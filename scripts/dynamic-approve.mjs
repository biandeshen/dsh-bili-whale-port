/**
 * 草稿审批（Track A）：list / approve <id> [--go] [--why 一句话] / reject <id> [--why 一句话]
 * 默认 dry：只打印将执行的命令；--go 才真正发送（需显式，且过 kill 开关）。
 * 幂等：已 sent/rejected/failed 拒绝重放；dry-run 不消耗审批。
 * --why 是主人给的理由（#41）：进草稿文件 + draft-result 因果账，让她从被拒里学到东西；
 *       不写就是"没给理由"，工具不替主人编。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { whaleHome as WHALE_HOME, draftsDir } from '../tools/lib/paths.mjs'
import * as ack from './ack.mjs'
import { loadDraftById, saveDraftFile, audit as auditDraft, recordDraftResult as recordResult, markUsed as markImgUsed } from '../tools/drafts/store.mjs'
// M2：审批只认 publisher（发布实现的唯一入口）；runner 保留为测试注入（映射成 publisher 形状）
import { postImageDynamic } from '../tools/drafts/publishers/bilibili-dynamic.mjs'

// M1a 收口：与 draft-dynamic 同一个来源（paths.draftsDir），不再是本地一份 legacy 判断
const DRAFTS = draftsDir()
const CONTROL = path.join(WHALE_HOME, 'bili-whale', 'control')
const KILL = path.join(CONTROL, 'kill')

const load = (id) => loadDraftById(DRAFTS, id)
const save = (file, draft) => saveDraftFile(file, draft)
const audit = (entry) => auditDraft(DRAFTS, entry)
const recordDraftResult = (draft, result, reason) => recordResult(WHALE_HOME, draft, result, reason)
const markUsed = (image) => markImgUsed(image)

/** 测试用 runner（旧 spawn 契约：argv → {status, stdout, stderr}）适配成 publisher 形状。 */
const fromRunner = (run) => ({ image, text, go }) => {
  const r = run(['dynamic-image', '--image', image, '--text', text, go ? '--go' : '--dry'])
  const out = String(r.stdout ?? '') + String(r.stderr ?? '')
  return { exit: r.status ?? -1, ok: r.status === 0, dynId: (out.match(/dyn_id=(\S+)/) || [])[1] || null, transient: /冷却|TRAFFIC_PAUSED|请稍后/.test(out), out }
}

export async function approve({ id, token, go = false, runner, publisher, why } = {}) {
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
    // M1e：令牌必须绑定 draftId + 入队时的正文哈希 —— 审完又改稿就拒（与 dm-approve 同一条规则）
    const pending = ack.listPending(WHALE_HOME).find((x) => x.id === d.ackId)
    if (!pending) return { ok: false, error: '令牌不存在或已过期' }
    if (String(pending.payload?.draftId ?? '') !== String(d.id)) return { ok: false, error: '令牌与草稿不匹配' }
    const nowHash = crypto.createHash('sha1').update(String(d.text ?? '')).digest('hex')
    if (String(pending.payload?.textHash ?? '') !== nowHash) {
      return { ok: false, error: '正文在入队后被改过（哈希不符），请重新生成草稿再审' }
    }
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
  const exec = publisher || (runner ? fromRunner(runner) : postImageDynamic)
  let r
  try { r = await exec({ image: d.image, text: d.text, go }) } catch (e) { r = { exit: -1, ok: false, dynId: null, transient: false, out: String(e?.message ?? e) } }
  const out = String(r.out ?? '')
  const ok = (r.exit === 0) && (go ? !!r.dynId : true)
  const transient = !ok && (r.transient === true || /冷却|TRAFFIC_PAUSED|请稍后/.test(out))
  d.status = ok ? (go ? 'sent' : 'dry-run') : (transient ? 'cooldown' : 'failed')
  d.result = { ok, at: new Date().toISOString(), mode: go ? 'go' : 'dry', out: out.slice(-800) }
  // #41：主人放行时写的一句话也留在草稿上——她只知道"发了"和知道"为什么现在发"是两件事。
  const note = String(why ?? '').trim()
  if (note) d.ownerNote = note.slice(0, 300)
  save(hit.file, d)
  // 没发出去就把一次性令牌退回去，主人/她能拿同一个 token 重试。
  // （10-26 那轮连撞 6 次 send failed，旧逻辑每次都在发送前吞掉令牌，一条草稿就废了）
  if (go && !ok && d.ackId) {
    try { ack.release(WHALE_HOME, d.ackId) } catch {}
  }
  if (go && ok) markUsed(d.image)
  // 只有真正发出去/明确被拒才回写因果；dry 与冷却不算审批结果
  if (go && ok) recordDraftResult(d, 'sent', why)
  audit({ id: d.id, action: go ? 'send' : 'dry-run', result: ok ? d.status : 'failed', exit: r.exit ?? null, outHash: crypto.createHash('sha1').update(out).digest('hex') })
  return { ok, status: d.status, out: out.slice(-800) }
}

/**
 * 面板放行入口（2026-10-31 主人：“我去哪里放行她的操作？”）。
 * token 只在服务端流转：浏览器 POST 只带 {id}，响应里永远没有 token（比 CLI stdout 更严，M1e 方向不变）。
 * 令牌缺失/过期、或正文在入队后被改过 → 用**当前这份正文**重新入队再发：
 * 审批对象 = 面板上显示的正文 = 实际执行的正文（M1e「展示=执行」原则保持）。
 * kill / 一次性 / status 拦截全部沿用 approve()，本函数只是保证“有可用且绑定当前正文的令牌”。
 * @returns {{ok:boolean, status?:string, error?:string, dynId?:string|null, outTail?:string}} 不含 token
 */
export async function approveFromPanel({ id, runner, publisher, why } = {}) {
  const hit = load(id)
  if (!hit) return { ok: false, error: '找不到草稿 ' + id }
  const d = hit.draft
  if (['sent', 'rejected', 'sending'].includes(d.status)) {
    return { ok: false, error: d.status === 'sending' ? '上次发送中断（sending），先人工核对 B 站有没有发出去' : '草稿已处理过：' + d.status }
  }
  const nowHash = crypto.createHash('sha1').update(String(d.text ?? '')).digest('hex')
  const pend = ack.listPending(WHALE_HOME).find((x) => x.id === d.ackId)
  const bound = pend
    && String(pend.payload?.draftId ?? '') === String(d.id)
    && String(pend.payload?.textHash ?? '') === nowHash
  let token
  if (bound) {
    token = pend.token
  } else {
    const it = ack.enqueue(WHALE_HOME, { draftId: d.id, date: d.date, textHash: nowHash })
    d.ackId = it.id
    save(hit.file, d)
    token = it.token
  }
  const r = await approve({ id, token, go: true, runner, publisher, why })
  const out = String(r.out ?? '')
  return {
    ok: r.ok,
    status: r.status ?? undefined,
    error: r.error ?? undefined,
    dynId: (out.match(/dyn_id=([^\s]+)/) || [])[1] || null,
    outTail: out.slice(-300),
  }
}

export function reject(id, reason) {
  const hit = load(id)
  if (!hit) return { ok: false, error: '找不到草稿 ' + id }
  // 已发出的草稿不能被改成 rejected：那会让审计和她的记忆都对不上真实发生过的事
  if (hit.draft.status === 'sent') return { ok: false, error: '这条已经发出去了，不能再拒' }
  const why = String(reason ?? '').trim().slice(0, 300)
  hit.draft.status = 'rejected'
  hit.draft.rejectedAt = new Date().toISOString()
  // #41（2026-11-01 意见箱）：她要从被拒里学习，只知道"没通过"学不到东西。
  // 理由可以留空——留空就如实写"没给理由"，绝不替主人编一个原因。
  if (why) hit.draft.rejectReason = why
  save(hit.file, hit.draft)
  recordDraftResult(hit.draft, 'rejected', why)
  audit({ id: hit.draft.id, action: 'reject', reason: why ? 'given' : 'none' })
  return { ok: true, reason: why || null }
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

/**
 * 令牌取法：`--token-env VAR` 优先于 `--token T`。
 * argv 同机任意进程可读（进程列表、崩溃栈、审计日志），宿主自动放行走环境变量。
 */
export function resolveToken(argv, env = process.env) {
  const ei = argv.indexOf('--token-env')
  if (ei >= 0) return String(env[argv[ei + 1]] ?? '')
  const ti = argv.indexOf('--token')
  return ti >= 0 ? String(argv[ti + 1] ?? '') : ''
}

/** #41：审批理由走 --why（明文，不是凭据）；缺失就是"没给理由"，工具不替主人编。 */
export function resolveWhy(argv) {
  const i = argv.indexOf('--why')
  return i >= 0 ? String(argv[i + 1] ?? '') : ''
}

if (process.argv[1] && process.argv[1].endsWith('dynamic-approve.mjs')) {
  const [cmd, id] = process.argv.slice(2).filter((a) => !a.startsWith('--'))
  if (cmd === 'list') {
    const drafts = list()
    const pend = ack.listPending(WHALE_HOME)
    const byDraft = new Map(pend.map((p) => [p.payload?.draftId, p]))
    // M1e：默认隐藏完整 token（不进 stdout/日志/模型）；要看哪条用 --show-token <草稿id>
    const showTok = process.argv.includes('--show-token')
    if (showTok && !id) console.log('（--show-token 需要指定草稿 id，如：list --show-token dyn-20261030-xxx）')
    if (!drafts.length) console.log('（没有草稿）')
    for (const d of drafts) {
      const p = byDraft.get(d.id)
      console.log(`${d.id}  [${d.status}]  ${path.basename(d.image)}`)
      console.log(`   ${String(d.text).replace(/\s+/g, ' ').slice(0, 70)}`)
      if (p) {
        const full = showTok && id === d.id
        console.log(full
          ? `   待审 token: ${p.token}  过期 ${new Date(p.expiresAt).toLocaleString()}`
          : `   待审 token: 已隐藏（本条用 list --show-token ${d.id} 查看）  过期 ${new Date(p.expiresAt).toLocaleString()}`)
      } else if (d.status === 'pending') console.log('   待审 token: （无或已过期，不能真发；请重新生成草稿）')
    }
    process.exitCode = 0
    process.exit(0)
  }
  const go = process.argv.includes('--go')
  const token = resolveToken(process.argv)
  const why = resolveWhy(process.argv)
  if (cmd === 'panel') {
    // 服务端持 token 的放行（面板按钮与 auto 模式共用；stdout 永不含 token）
    const r = await approveFromPanel({ id, why })
    console.log(JSON.stringify(r, null, 2))
    process.exitCode = r.ok ? 0 : 1
    process.exit(r.ok ? 0 : 1)
  }
  const out = cmd === 'approve' ? await approve({ id, token, go, why })
    : cmd === 'reject' ? reject(id, why)
    : { ok: false, error: '用法：list | approve <id> [--token T | --token-env VAR] [--go] [--why 一句话] | reject <id> [--why 一句话]' }
  console.log(JSON.stringify(out, null, 2))
  process.exitCode = out.ok ? 0 : 1
}

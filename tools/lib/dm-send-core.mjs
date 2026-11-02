/**
 * 私信发送核心（2026-10-31 批次②）——「闸门 → 发送 → 记账」的唯一实现。
 *
 * dm.mjs（CLI）与 scripts/dm-approve.mjs（回信放行）以前各走一遍：CLI 靠 dm.mjs，
 * 审批靠 `spawnSync(bili.mjs dm …)` 再解析 stdout 里有没有「已发送」。两条链一份语义，
 * 改一处漏一处（publisher 收敛前 dynamic 已经踩过）。现在两边都调这里。
 *
 * 写死的三条红线原样保留（主人 2026-10-18 定）：
 *   ① 一天只锁定 1 个收信人（对同一个人条数不限）② 只发给 config.owner.mid
 *   ③ 必须互关；④ 分享型过 quota-gate（与评论区 @ 同账）
 * 退出码沿用 dm.mjs 老语义：0 成功 / 2 参数与配置 / 3 关系接口失败 / 4 闸门拒 / 1 发送失败。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { guardedFetch as fetch } from './traffic.mjs'
import { config } from './config.mjs'
import { gate, record } from './quota-gate.mjs'
import { whaleHome, readStateText, writeStateText, statePath } from './paths.mjs'
import { appendCausal } from './causal.mjs'
import { plainOutbound } from './plain-outbound.mjs'

const QUOTA = 'dm-quota.json'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const ONE_TARGET_PER_DAY = true
const REQUIRE_MUTUAL = true
const MAX_LEN = 300
const today = () => new Date().toLocaleDateString('sv-SE')
const loadQ = () => { try { return JSON.parse(readStateText(QUOTA)) } catch { return {} } }
const saveQ = (o) => { writeStateText(JSON.stringify(o, null, 2) + '\n', QUOTA) }

/** 稳定的设备 ID（状态目录里的 dev_id，永久复用）：随机换 dev_id 会被风控判成设备高频切换。 */
function stableDevId() {
  const file = statePath('dev_id')
  try {
    const v = readStateText('dev_id').trim()
    if (/^WEB-[0-9A-F-]{20,}$/i.test(v)) return v
  } catch {}
  const v = 'WEB-' + crypto.randomUUID().toUpperCase()
  try {
    writeStateText(v + '\n', 'dev_id')
    try { fs.chmodSync(file, 0o600) } catch {}
  } catch (e) { throw new Error('无法保存私信设备 ID，已停止发送：' + e.message) }
  return v
}

async function loadCtx() {
  const { loadCred, missingForWrite, explainCode, looksLikeJct } = await import('./cred.mjs')
  const cred = loadCred()
  const miss = missingForWrite(cred)
  if (miss.length) {
    const lines = ['✗ 凭据不完整，没法发私信：', ...miss.map((m) => '   · 缺 ' + m), '  → 设置页把 SESSDATA 和 bili_jct 【两个都】重新粘贴一次并保存 ✓']
    return { fail: { exit: 2, reason: 'credentials', lines } }
  }
  if (!looksLikeJct(cred.bili_jct)) {
    console.error(`⚠️ bili_jct 格式不像（长度 ${String(cred.bili_jct).length}，B站 目前是 32 位十六进制）—— 发送大概率 code=-111`)
  }
  const H = { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` }
  return { cred, H, explainCode }
}

const jget = async (H, u) => (await fetch(u, { headers: H })).json()

async function me(H) {
  const nav = await jget(H, 'https://api.bilibili.com/x/web-interface/nav')
  if (!nav.data?.isLogin) return null
  return { mid: String(nav.data.mid), uname: nav.data.uname }
}

async function relation(H, toMid) {
  const j = await jget(H, `https://api.bilibili.com/x/relation?fid=${toMid}`)
  if (j.code !== 0) return { ok: false, attribute: -1, why: `关系接口 code=${j.code}` }
  return { ok: true, attribute: Number(j.data?.attribute ?? -1), beAttribute: j.data?.be_relation?.attribute == null ? null : Number(j.data.be_relation.attribute) }
}

/** 未互关时的出路提示（谁关注谁、还差哪一步）。 */
export function relationLines(rel, meInfo) {
  if (!rel.ok) return [rel.why + '，无法确认关注方向，请稍后重试']
  const outgoing = [2, 6].includes(rel.attribute)
  const incoming = [4, 6].includes(rel.beAttribute ?? -1)
  const lines = [
    `${meInfo?.uname ?? '她'} → 主人：${outgoing ? '已关注' : '未关注'}`,
    `主人 → ${meInfo?.uname ?? '她'}：${incoming ? '已关注' : '未关注'}`,
  ]
  if (!outgoing) lines.push('请登录她的账号，关注主人（B站 私信要求互关）。')
  if (!incoming) lines.push('请让主人从自己的账号回关她 —— 这一步只能主人自己做。')
  return lines
}

/**
 * 发一条私信给主人。dry=true 时跑完所有只读预检但不发送、不记账。
 * @returns {{ok:boolean, exit:number, reason:string, lines:string[], transient?:boolean, http?:number, code?:number}}
 */
export async function sendOwnerDm({ text, share = false, shareTarget = '', dry = false } = {}) {
  const out = { ok: false, exit: 2, reason: 'usage', lines: [] }
  const push = (...ls) => { out.lines.push(...ls); for (const l of ls) (l.startsWith('✗') || l.startsWith('⚠') ? console.error : console.log)(l) }
  // 出站与拦下都进因果账本（K4-1「私信有来有回」的分子/分母）：只记身份、日期、长度，
  // 正文与凭据（SESSDATA/bili_jct/dev_id）一律不写。dry 一条都不写——预检不是事件。
  const causal = (event) => (dry ? false : appendCausal(whaleHome, { toMid: OWNER, day: today(), atMs: Date.now(), ...event }))
  const blocked = (reason, extra = {}) => causal({ kind: 'dm-blocked', reason, ...extra })
  const cfg = config()
  const OWNER = String(cfg.owner?.mid ?? '').trim()
  const OWNER_NAME = String(cfg.owner?.name ?? '主人')
  // 私信不渲染 Markdown：`**加粗**` 发出去就是给对面看一串星号（2026-11-02 实测漏出的
  // dm-20261101-cbc62a）。清洗放在这条唯一出口上，幂等，所以审过的稿再发一次也不会变样。
  const MSG = plainOutbound(text)

  if (!OWNER) { push('✗ 配置里 owner.mid 为空 —— 私信只发给主人，没配就不发'); return out }
  if (!MSG) { push('用法: dm --msg "…" --dry|--go'); return out }
  if (MSG.length > MAX_LEN) { push(`✗ 私信太长（${MSG.length} > ${MAX_LEN} 字），退化成刷屏了 ✗`); return out }

  const ctx = await loadCtx()
  if (ctx.fail) { push(...ctx.fail.lines); return { ...out, ...ctx.fail } }
  const { cred, H, explainCode } = ctx

  const meInfo = await me(H)
  if (!meInfo) { push('✗ 未登录（cookie 失效 ✗）'); blocked('not-login'); return { ...out, exit: 3, reason: 'not-login' } }
  if (String(meInfo.mid) === OWNER) {
    push(
      '✗ 不能给自己发私信（owner.mid 就是 cookie 这个号）',
      '  私信通道需要【第二个 B 站号】：设 owner.mid 为另一个号，且双方手动互关',
      '  只有一个号时：分享方式选「评论区 @」，推送选桌面通知 / Webhook / 自定义命令 ✓',
    )
    return { ...out, reason: 'self' }
  }

  const rel = await relation(H, OWNER)
  if (!rel.ok) { push(`✗ ${rel.why}`); blocked('relation-probe'); return { ...out, exit: 3, reason: 'relation-probe' } }
  if (REQUIRE_MUTUAL && rel.attribute !== 6) {
    push(`✗ 未互关（attribute=${rel.attribute}）—— 私信通道要求双方互相关注 ✓`, ...relationLines(rel, meInfo))
    blocked('not-mutual', { attribute: rel.attribute })
    return { ...out, exit: 4, reason: 'not-mutual' }
  }

  const q = loadQ()
  const used = q.date === today() ? Number(q.count ?? 0) : 0
  if (ONE_TARGET_PER_DAY && q.date === today() && q.mid && String(q.mid) !== OWNER) {
    push(`✗ 今天已经锁定给 mid ${q.mid} 了 —— 一天只能锁定 1 个收信人（防刷量 ✗）`)
    blocked('target-locked', { lockedMid: String(q.mid) })
    return { ...out, exit: 4, reason: 'target-locked' }
  }

  push(`[dm] ${meInfo.uname} → ${OWNER_NAME}（mid ${OWNER}）`)
  push(`  正文 ${MSG.length} 字：${MSG.slice(0, 80)}${MSG.length > 80 ? '…' : ''}`)
  push(`  互关 ✓  ·  今天第 ${used + 1} 条（条数不限 ✓ 锁定给 ${OWNER_NAME} ✓）`)

  if (share) {
    const target = shareTarget || `dm:${OWNER}`
    if (!gate({ type: 'dm', target, auto: true, share: true })) {
      push('✗ 分享额度不允许（见上面的 [限额闸] 输出）')
      blocked('share-quota')
      return { ...out, exit: 4, reason: 'share-quota' }
    }
  }
  if (dry) { push('  [dry] 预检通过，未发送 ✓ 正式发送时会重新检查额度'); return { ...out, ok: true, exit: 0, reason: 'dry' } }

  const body = new URLSearchParams()
  body.set('msg[sender_uid]', meInfo.mid)
  body.set('msg[receiver_id]', String(OWNER))
  body.set('msg[receiver_type]', '1')
  body.set('msg[msg_type]', '1')
  body.set('msg[msg_status]', '0')
  body.set('msg[timestamp]', String(Math.floor(Date.now() / 1000)))
  body.set('msg[dev_id]', stableDevId())
  body.set('msg[content]', JSON.stringify({ content: MSG }))
  body.set('csrf', String(cred.bili_jct))
  let r
  try {
    const res = await fetch('https://api.vc.bilibili.com/web_im/v1/web_im/send_msg', {
      method: 'POST', headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    })
    const j = await res.json().catch(() => ({}))
    r = { http: res.status, code: j.code, message: j.message }
  } catch (e) {
    const msg = String(e?.message ?? e)
    push('  ✗ 发送异常：' + msg)
    blocked('throw', { transient: /冷却|TRAFFIC_PAUSED|请稍后/.test(msg) || e?.name === 'TrafficError' })
    return { ...out, exit: 1, reason: 'throw', transient: /冷却|TRAFFIC_PAUSED|请稍后/.test(msg) || e?.name === 'TrafficError' }
  }
  if (r.code === 0) {
    saveQ({ date: today(), count: used + 1, mid: OWNER, at: new Date().toISOString() })
    if (share) record({ type: 'dm', target: shareTarget || `dm:${OWNER}`, note: MSG.slice(0, 40), auto: true, share: true })
    causal({ kind: 'dm-out', charLen: MSG.length })
    push(`  ✓ 已发送（HTTP ${r.http}）${share ? ' · 已记入分享额度 ✓' : ' · 推送不占额度 ✓'}`)
    return { ok: true, exit: 0, reason: 'sent', lines: out.lines, http: r.http, code: r.code }
  }
  push(`  ✗ 发送失败：HTTP ${r.http} ${explainCode(r.code)}${r.message ? `（B站原文：${r.message}）` : ''}`)
  blocked('send-failed', { http: r.http, code: r.code })
  return { ...out, exit: 1, reason: 'send-failed', http: r.http, code: r.code }
}

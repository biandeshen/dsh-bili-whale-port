import { guardedFetch as fetch } from '../lib/traffic.mjs'
// One-shot dynamic (动态) test: post -> list -> remove. Same boundary as the
// comment tool: credentials come from the local drop box, nothing is echoed.
//
//   node bili-dynamic.mjs list
//   node bili-dynamic.mjs post --text "..." --dry | --go
//   node bili-dynamic.mjs rm --id <dyn_id> --dry | --go
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
// 2026-10-21 修（外部审计）：下面 --go 路径里调了 gate()，但从来没导入过 ✗
//   一跑到那儿就是 ReferenceError（danmaku.mjs 早就踩过同一个坑，这次补齐三条）
import { gate } from '../lib/quota-gate.mjs'
import { draftsDir } from '../lib/paths.mjs'
import { postTextDynamic } from '../drafts/publishers/bilibili-dynamic.mjs'

const argv = process.argv.slice(2)
const mode = argv[0]
const args = new Map()
for (let i = 1; i < argv.length; i += 1) {
  const a = argv[i]
  if (a.startsWith('--')) args.set(a.slice(2), argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true)
}
const isDry = args.has('dry')
const isGo = args.has('go')
const text = args.get('text')
const dynId = args.get('id')

const credPath = path.join((process.env.USERPROFILE || process.env.HOME || '/'), '.bili-ai', 'credentials.json')
if (!fs.existsSync(credPath)) { console.error(`缺少凭据文件: ${credPath}`); process.exit(3) }
const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
for (const k of ['sessdata', 'bili_jct', 'buvid3']) {
  if (!cred[k] || String(cred[k]).trim() === '') { console.error(`凭据文件缺少 ${k}`); process.exit(3) }
}
const cookieHeader = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REF = 'https://t.bilibili.com/'

const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
async function wbi(params) {
  const d = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
  })).json()
  const img = d?.data?.wbi_img?.img_url, sub = d?.data?.wbi_img?.sub_url
  if (!img || !sub) return ''
  const mixin = MIXIN_TAB.map((i) => (keyOf(img) + keyOf(sub))[i]).join('').slice(0, 32)
  const wts = Math.round(Date.now() / 1000)
  const clean = (v) => String(v).replace(/[!'()*]/g, '')
  const q = Object.keys({ ...params, wts }).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(k === 'wts' ? wts : params[k]))}`).join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
}

async function whoami() {
  const d = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
  })).json()
  if (d.code !== 0) { console.log(`  登录态无效: code=${d.code} ${d.message}`); process.exit(4) }
  console.log(`  账号: ${d.data.uname} (mid ${d.data.mid})  手机绑定=${d.data.mobile_verified ? '是' : '否'}`)
  return d.data.mid
}

/** whoami 的安静版：--json 时 stdout 只能是 JSON。 */
async function whoamiQuiet() {
  const d = await (await fetch('https://api.bilibili.com/x/web-interface/nav', {
    headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
  })).json()
  if (d.code !== 0) { console.error(`登录态无效: code=${d.code} ${d.message}`); process.exit(4) }
  return d.data.mid
}

async function list(mid) {
  const u = `https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/space_history?host_uid=${mid}&offset_dynamic_id=0&need_top=0`
  let d
  try {
    d = await (await fetch(u, { headers: { 'user-agent': UA, referer: REF, cookie: cookieHeader } })).json()
  } catch {
    // 该老接口时常回 HTML 风控页：说清楚，别把 stack 甩给人
    console.log('  space_history 返回的不是 JSON（该老接口常被打码/风控）；判定单条存在用 dynamic check --id <dyn_id>')
    return []
  }
  console.log(`  space_history code=${d.code} ${d.message ?? ''}  卡片数=${(d.data?.cards ?? []).length}`)
  for (const c of (d.data?.cards ?? []).slice(0, 6)) {
    const desc = c.desc ?? {}
    let body = ''
    try { body = (JSON.parse(c.card).item?.description ?? JSON.parse(c.card).item?.content ?? '').slice(0, 60) } catch {}
    console.log(`    dyn_id=${desc.dynamic_id_str}  ${new Date((desc.timestamp ?? 0) * 1000).toLocaleTimeString('zh-CN')}  ${body}`)
  }
  return (d.data?.cards ?? []).map((c) => String(c.desc?.dynamic_id_str))
}

if (mode === 'list') {
  console.log('=== 当前空间动态 ===')
  const mid = await whoami()
  await list(mid)
  process.exit(0)
}

// recent —— 按自然日期查她自己发过的动态（2026-10-31 普查后补：space_history 老接口常回 HTML，
// 发布链路需要一个可靠的复核入口；数据源换 polymer feed/space，与 check 同一套 wbi 签名）
if (mode === 'recent') {
  await runRecent().catch((e) => {
    if (e?.name === 'TrafficError' || /请求已暂停/.test(String(e?.message ?? e))) {
      console.error('⏸ ' + e.message + '（查最新动态这类读取也被风控闸统一管——到点前别重试）')
      process.exit(5)
    }
    throw e
  })
  process.exitCode = 0
}

// 下面三个是 recent 的取位助手；用 function 声明（不是 const 箭头），
// 因为 `if (mode === 'recent')` 在文件里就早于它们执行，const 会撞 TDZ。
function flat(v) { return String(v ?? '').replace(/\s+/g, ' ').trim() }
function paragraphsOf(o) {
  const ps = o?.paragraphs ?? o?.item?.paragraphs
  if (!Array.isArray(ps)) return ''
  return flat(ps.map((p) => String(p?.text ?? p?.words ?? p?.content ?? '')).filter(Boolean).join(' '))
}
function asObject(v) {
  if (v && typeof v === 'object') return v
  const s = String(v ?? '').trim()
  if (!s.startsWith('{') && !s.startsWith('[')) return null
  try { return JSON.parse(s) } catch { return null }
}

/**
 * 动态卡片正文取位（缺口清单批次③）：同一句稿子在不同类型、不同代接口里位置不一样——
 * 纯文字在顶层 description，新版 feed/space 在 modules.module_dynamic.desc.text，
 * 老卡片把整份稿子塞在 item.dynamic/item.card 一段 JSON 字符串里，DRAW/opus 还可能只有段落。
 * 按这些位置依次回退；全落空返回 text=null，由调用方显式说「取不到」，不静默给空串。
 * @returns {{text:string|null, from:string|null}}
 */
export function pickDynamicText(item = {}) {
  const direct = [
    ['description', () => flat(item.description)],
    ['desc.text', () => flat(item.modules?.module_dynamic?.desc?.text)],
    ['content.text', () => flat(item.content?.text ?? item.modules?.module_dynamic?.content?.text)],
    ['paragraph', () => paragraphsOf(item) || paragraphsOf(item.modules?.module_dynamic)],
  ]
  for (const [from, get] of direct) { const t = get(); if (t) return { text: t, from } }
  for (const key of ['dynamic', 'card', 'origin']) {
    const nested = asObject(item[key])
    if (!nested) continue
    for (const t of [flat(nested.item?.description), flat(nested.text), flat(nested.desc), flat(nested.item?.content), paragraphsOf(nested)]) {
      if (t) return { text: t, from: key }
    }
  }
  return { text: null, from: null }
}

/**
 * dyn_id → 本地草稿（"今天发的动态对应她哪篇稿"）。
 * 草稿文件里的出处有两种：publisher 直接写 result.dynId，
 * 审批层只留了 result.out（stdout 尾巴里有 `dyn_id=…` 或 `dynamic check --id …`），两种都认。
 */
function draftIndexByDynId() {
  const out = new Map()
  const dir = draftsDir()
  if (!fs.existsSync(dir)) return out
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    let d
    try { d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
    const outText = String(d?.result?.out ?? '')
    const fromOut = outText.match(/dyn(?:amic)?_id=([0-9]+)/) ?? outText.match(/dynamic check --id ([0-9]+)/)
    const id = String(d?.result?.dynId ?? fromOut?.[1] ?? '')
    if (id) out.set(id, { draftId: String(d?.id ?? f.replace(/\.json$/, '')), date: String(d?.date ?? '') })
  }
  return out
}

async function runRecent() {
  const day = String(args.get('date') ?? new Date().toLocaleDateString('sv-SE'))
  const cap = Math.max(1, Math.min(50, Number(args.get('n') ?? 10) || 10))
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { console.error('recent 的 --date 要形如 2026-10-31'); process.exit(2) }
  const mid = args.has('json') ? await whoamiQuiet() : await whoami()
  const drafts = draftIndexByDynId()
  const rows = []
  let offset = ''
  let stop = false
  for (let page = 0; page < 10 && !stop; page += 1) {
    const qs = await wbi({ host_mid: String(mid), timezone_offset: -480, offset })
    const r = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/space?${qs}`, {
      headers: { 'user-agent': UA, referer: REF, cookie: cookieHeader },
    })
    let d
    try { d = await r.json() } catch { console.error('✗ feed/space 返回的不是 JSON（风控/打码）——过几分钟再试'); process.exit(6) }
    if (d.code !== 0) { console.error(`✗ feed/space code=${d.code} ${d.message ?? d.msg ?? ''}`); process.exit(6) }
    const items = d.data?.items ?? []
    if (!items.length) break
    for (const it of items) {
      // 真实响应：pub_time 是"昨天 17:07"这类显示串，epoch 秒在 module_author.pub_ts
      const t = Number(it.modules?.module_author?.pub_ts ?? (String(it.pub_time ?? '').match(/^\d+$/) ? it.pub_time : 0) ?? 0)
      if (!t) continue
      const localDate = new Date(t * 1000).toLocaleDateString('sv-SE')
      if (localDate < day) { stop = true; break }  // 流是按时间倒序的：翻过那天就停
      if (localDate !== day) continue
      const dynId = String(it.id_str ?? it.id ?? '')
      const picked = pickDynamicText(it)
      const link = drafts.get(dynId)
      rows.push({
        dyn_id: dynId,
        at: new Date(t * 1000).toISOString(),
        local: new Date(t * 1000).toLocaleString('zh-CN', { hour12: false }),
        type: String(it.dynamic_type ?? it.type ?? ''),
        text: picked.text === null ? null : picked.text.slice(0, 80) + (picked.text.length > 80 ? '…' : ''),
        text_from: picked.from,
        draft_id: link?.draftId ?? null,
        draft_date: link?.date ?? null,
      })
      if (rows.length >= cap) { stop = true; break }
    }
    if (stop) break
    if (!d.data?.offset || d.data?.has_more === false) break
    offset = String(d.data.offset)
  }
  if (args.has('json')) {
    console.log(JSON.stringify({ ok: true, day, mid: Number(mid), count: rows.length, items: rows }, null, 2))
  } else if (!rows.length) {
    console.log(`  ${day} 没有查到她发的动态（发布失败/还没发/就是没有这一天）`)
  } else {
    console.log(`=== ${day} 她发过的动态（${rows.length} 条）===`)
    for (const x of rows) {
      const body = x.text === null ? `（这条取不到正文，type=${x.type || '未知'}）` : x.text
      console.log(`  dyn_id=${x.dyn_id}  ${x.local}  [${x.type}] ${body}${x.draft_id ? `  ←草稿 ${x.draft_id}` : ''}`)
    }
    const missing = rows.filter((x) => x.text === null).length
    if (missing) console.log(`  ⚠ ${missing} 条取不到正文：别当作「她今天没写字」，按 type 人工核对`)
    console.log('  复核单条: node bili.mjs dynamic check --id <dyn_id>')
  }
}

if (mode === 'post') {
  if (!text) { console.error('post 需要 --text'); process.exit(2) }
  if (!isDry && !isGo) { console.error('必须显式 --dry 或 --go'); process.exit(2) }
  // M2：发帖实现收口到 publishers/bilibili-dynamic.mjs（与 dynamic-image、审批同一条链）
  const r = await postTextDynamic({ text, go: isGo })
  console.log(r.out)
  // 不 process.exit：keep-alive socket 未关时强退会在 Windows 触发 libuv 断言（退出码 127）；
  // 落 exitCode 后让脚本自然收尾，下面的用法兜底只对未知 mode 生效
  process.exitCode = r.exit
}

if (mode === 'check') {
  if (!dynId) { console.error('check 需要 --id <dyn_id>'); process.exit(2) }
  await whoami()
  const qs = await wbi({ id: String(dynId) })
  const r = await fetch(`https://api.bilibili.com/x/polymer/web-dynamic/v1/detail?${qs}`, {
    headers: { 'user-agent': UA, referer: `${REF}${dynId}`, cookie: cookieHeader },
  })
  const ct = r.headers.get('content-type') ?? ''
  if (!ct.includes('json')) {
    console.log(`  detail 端点返回 ${ct || '未知类型'}，无法用它判定（不代表动态不存在）`)
    process.exit(0)
  }
  const d = await r.json()
  console.log(`  detail code=${d.code} ${d.message ?? d.msg ?? ''}`)
  if (d.code === 0) {
    const it = d.data?.item ?? {}
    console.log(`  存在 ✓  id=${it.id_str}  作者=${it.modules?.module_author?.name}  时间=${it.modules?.module_author?.pub_time}`)
    const t = it.modules?.module_dynamic?.desc?.text
    if (t) console.log(`  正文: ${t}`)
  } else {
    console.log('  未取到（删除后应当如此；若刚发完也没取到，多半是端点/权限问题）')
  }
  process.exit(0)
}

if (mode === 'rm') {
  if (!dynId) { console.error('rm 需要 --id <dyn_id>'); process.exit(2) }
  if (!isDry && !isGo) { console.error('必须显式 --dry 或 --go'); process.exit(2) }
  console.log('=== 登录态 ===')
  await whoami()
  console.log(`\n=== 将要删除 dyn_id=${dynId} ===`)
  console.log('  POST https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/rm_dynamic  (multipart/form-data)')
  console.log('  fields: dynamic_id / csrf / csrf_token   cookie: SESSDATA=***; bili_jct=***')
  if (isDry) { console.log('\n[dry] 未删除。'); process.exit(0) }
  const fd = new FormData()
  fd.append('dynamic_id', String(dynId))
  fd.append('csrf', String(cred.bili_jct))
  fd.append('csrf_token', String(cred.bili_jct))
  const r = await fetch('https://api.vc.bilibili.com/dynamic_svr/v1/dynamic_svr/rm_dynamic', {
    method: 'POST',
    headers: { 'user-agent': UA, referer: REF, cookie: cookieHeader },
    body: fd,
  })
  const out = await r.json()
  const hints = { 0: '成功', '-101': '账号未登录', 500404: '已经删除过该动态', 500406: '动态不是自己的' }
  console.log(`\n[go] HTTP ${r.status}  code=${out.code} ${out.message ?? out.msg ?? ''}`)
  console.log(`  ${hints[out.code] ?? ''}`)
  process.exit(0)
}

if (!['list', 'post', 'check', 'rm', 'recent'].includes(mode)) {
  console.error('用法: list | recent [--date YYYY-MM-DD] [--n 10] [--json] | post --text "..." --dry|--go | rm --id <dyn_id> --dry|--go')
  process.exit(2)
}

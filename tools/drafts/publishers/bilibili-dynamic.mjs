/**
 * B站动态发布器（M2）：唯一的发帖实现。CLI（dynamic-image/dynamic.mjs post）与
 * 审批（scripts/dynamic-approve.mjs）都走这里——换发布端只改本文件。
 *
 * postImageDynamic({image, text, atMid, atName, go}) → { exit, ok, dynId, transient, out, dry? }
 * postTextDynamic({text, go})                        → 同上
 *   exit：与旧 CLI 退出码同义（0 成功/2 参数或闸/3 凭据/4 登录态/5 图片/6 上传失败/1 异常）
 *   transient：冷却/风控类失败（审批层据此进 cooldown 状态而不是 failed）
 *   out：人可读的过程与结果（不含凭据；csrf/cookie 打码）
 * 注入点（测试）：fetchImpl（默认 traffic guardedFetch）、gateFn（默认 quota-gate）、log（默认收集）
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { guardedFetch as guarded } from '../../lib/traffic.mjs'
import { gate as quotaGate } from '../../lib/quota-gate.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const REF = 'https://t.bilibili.com/'
const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))

function loadCred() {
  const credPath = path.join((process.env.USERPROFILE || process.env.HOME || '/'), '.bili-ai', 'credentials.json')
  if (!fs.existsSync(credPath)) return { error: `缺少凭据文件: ${credPath}` }
  const cred = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  for (const k of ['sessdata', 'bili_jct', 'buvid3']) {
    if (!cred[k] || String(cred[k]).trim() === '') return { error: `凭据文件缺少 ${k}` }
  }
  return { cred, cookieHeader: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` }
}

export function sniffImage(buf) {
  function kindOf(b) {
    if (b.length > 8 && b[0] === 0x89 && b.toString('latin1', 1, 4) === 'PNG') return 'png'
    if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
    if (b.length > 6 && b.toString('latin1', 0, 3) === 'GIF') return 'gif'
    if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
    return 'unknown'
  }
  function dimsOf(b, kind) {
    if (kind === 'png') return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) }
    if (kind === 'gif') return { width: b.readUInt16LE(6), height: b.readUInt16LE(8) }
    if (kind === 'jpg') {
      let i = 2
      while (i + 9 < b.length) {
        if (b[i] !== 0xff) { i += 1; continue }
        const marker = b[i + 1]
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) }
        }
        const len = b.readUInt16BE(i + 2)
        i += 2 + len
      }
      return null
    }
    return null
  }
  const kind = kindOf(buf)
  return { kind, dims: dimsOf(buf, kind), bytes: buf.length }
}

async function wbi(fetchImpl, cookieHeader, params) {
  const d = await (await fetchImpl('https://api.bilibili.com/x/web-interface/nav', {
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

function caught(e) {
  const msg = String(e?.message ?? e)
  return { exit: 1, ok: false, dynId: null, transient: /冷却|TRAFFIC_PAUSED|请稍后/.test(msg) || e?.name === 'TrafficError', out: msg }
}

/**
 * 图文动态。go=false 是 dry：只做登录态检查与计划输出，一次写请求都不发（上传也是写）。
 * 上传前过限额闸；上传与发布之间补写冷却（DYNAMIC_WRITE_GAP_MS，默认 125s）。
 */
export async function postImageDynamic({ image, text = '', atMid = null, atName = null, go = false, fetchImpl = guarded, gateFn = quotaGate } = {}) {
  const lines = []
  const log = (s) => lines.push(s)
  const done = (extra) => ({ dynId: null, transient: false, ...extra, out: lines.join('\n') })

  if (!image || !fs.existsSync(image)) return done({ exit: 2, ok: false, out: lines.concat(`图片不存在: ${image}`).join('\n') })
  const buf = fs.readFileSync(image)
  const { kind, dims } = sniffImage(buf)
  log('=== 图片 ===')
  log(`  路径: ${image}`)
  log(`  类型: ${kind}   ${(buf.length / 1024).toFixed(1)} KiB   ${dims ? `${dims.width}x${dims.height}` : '尺寸未解析'}`)
  if (!['png', 'jpg', 'gif'].includes(kind)) return done({ exit: 5, ok: false, out: lines.concat(`✗ 该接口只收 jpg / png / gif，当前是 ${kind}。先转换再发。`).join('\n') })
  if (!dims) return done({ exit: 5, ok: false, out: lines.concat('✗ 没解析出尺寸，无法组装 pics').join('\n') })

  const { cred, cookieHeader, error } = loadCred()
  if (error) return done({ exit: 3, ok: false, out: lines.concat(error).join('\n') })

  let nav
  try {
    nav = await (await fetchImpl('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
    })).json()
  } catch (e) { return done(caught(e)) }
  log('\n=== 登录态 ===')
  if (nav.code !== 0) return done({ exit: 4, ok: false, out: lines.concat(`  登录态无效 code=${nav.code} ${nav.message}`).join('\n') })
  log(`  账号: ${nav.data.uname} (mid ${nav.data.mid})  手机绑定=${nav.data.mobile_verified ? '是' : '否'}`)

  const contents = []
  if (text) contents.push({ raw_text: (atMid && !/\s$/.test(text)) ? `${text}\n` : text, type: 1, biz_id: '' })
  if (atMid) contents.push({ raw_text: `@${atName ?? ''} `, type: 2, biz_id: String(atMid) })
  log('\n=== 计划 ===')
  log('  1) POST https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs（multipart: file_up / category=daily / csrf）')
  log(`  2) POST https://api.bilibili.com/x/dynamic/feed/create/dyn（scene=2 带图, pics=[{img_src, ${dims.width}x${dims.height}}]）`)
  log(`     正文: ${text ? `「${text.replace(/\n/g, ' / ')}」(${text.length} 字)` : '（空）'}`)
  if (!go) { log('\n[dry] 未上传、未发布（上传本身也是写操作，所以 dry 阶段一次写请求都不发）。'); return done({ exit: 0, ok: true, dry: true }) }

  // 闸门必须在上传图片之前：上传本身就是写操作（2026-10-21 外部审计 #9）
  if (!gateFn({ type: 'dynamic', target: 'dynamic', auto: false })) {
    return done({ exit: 2, ok: false, out: lines.concat('拒绝：限额闸不通过（额度 / 名单）—— 还没上传图片，未产生任何写入 ✓').join('\n') })
  }

  log('\n[1/2] 上传图片…')
  let upJson
  try {
    const fd = new FormData()
    const mime = kind === 'png' ? 'image/png' : kind === 'jpg' ? 'image/jpeg' : 'image/gif'
    fd.append('file_up', new Blob([buf], { type: mime }), `upload.${kind}`)
    fd.append('category', 'daily')
    fd.append('csrf', String(cred.bili_jct))
    const up = await fetchImpl('https://api.bilibili.com/x/dynamic/feed/draw/upload_bfs', {
      method: 'POST',
      headers: { 'user-agent': UA, referer: REF, cookie: cookieHeader },
      body: fd,
    })
    upJson = await up.json()
    log(`     HTTP ${up.status}  code=${upJson.code} ${upJson.message ?? ''}`)
  } catch (e) { return done(caught(e)) }
  if (upJson.code !== 0) return done({ exit: 6, ok: false, out: lines.concat(`     上传失败: ${JSON.stringify(upJson).slice(0, 300)}`).join('\n') })
  const { image_url: imgSrc, image_width: w, image_height: h, img_size: kb } = upJson.data ?? {}
  log(`     image_url=${imgSrc}  ${w}x${h}  ${kb}KB`)

  // 上传与发帖是两次写；补足风控写冷却，避免被自己的间隔拦住
  const gap = Number(process.env.DYNAMIC_WRITE_GAP_MS || 125000)
  if (gap > 0) await new Promise((r) => setTimeout(r, gap))
  log('\n[2/2] 发布图文动态…')
  const dynReq = {
    pics: [{ img_src: imgSrc, img_width: w, img_height: h, img_size: kb }],
    scene: 2,
    meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
  }
  if (contents.length) dynReq.content = { contents }
  const body = JSON.stringify({ dyn_req: dynReq })
  let out
  try {
    const qs = await wbi(fetchImpl, cookieHeader, { csrf: String(cred.bili_jct) })
    const r = await fetchImpl(`https://api.bilibili.com/x/dynamic/feed/create/dyn?${qs}`, {
      method: 'POST',
      headers: { 'user-agent': UA, referer: REF, origin: 'https://t.bilibili.com', 'content-type': 'application/json', cookie: cookieHeader },
      body,
    })
    out = await r.json()
    log(`     HTTP ${r.status}  code=${out.code} ${out.message ?? ''}`)
  } catch (e) { return done(caught(e)) }
  if (out.code === 0) {
    const id = out.data?.dyn_id_str ?? out.data?.dyn_id
    log(`\n✅ 已发布  dyn_id=${id}`)
    log(`   https://t.bilibili.com/${id}`)
    return done({ exit: 0, ok: true, dynId: String(id) })
  }
  log(`  errmsg: ${out.data?.errmsg ?? '-'}`)
  return done({ exit: 0, ok: false })
}

/** 纯文字动态（scene=1）。go=false 是 dry。 */
export async function postTextDynamic({ text, go = false, fetchImpl = guarded, gateFn = quotaGate } = {}) {
  const lines = []
  const log = (s) => lines.push(s)
  const done = (extra) => ({ dynId: null, transient: false, ...extra, out: lines.join('\n') })
  if (!text) return done({ exit: 2, ok: false, out: 'post 需要 --text' })

  const { cred, cookieHeader, error } = loadCred()
  if (error) return done({ exit: 3, ok: false, out: lines.concat(error).join('\n') })
  let nav
  try {
    nav = await (await fetchImpl('https://api.bilibili.com/x/web-interface/nav', {
      headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: cookieHeader },
    })).json()
  } catch (e) { return done(caught(e)) }
  log('=== 登录态 ===')
  if (nav.code !== 0) return done({ exit: 4, ok: false, out: lines.concat(`  登录态无效: code=${nav.code} ${nav.message}`).join('\n') })
  log(`  账号: ${nav.data.uname} (mid ${nav.data.mid})  手机绑定=${nav.data.mobile_verified ? '是' : '否'}`)
  const body = JSON.stringify({
    dyn_req: {
      content: { contents: [{ raw_text: text, type: 1, biz_id: '' }] },
      scene: 1,
      meta: { app_meta: { from: 'create.dynamic.web', mobi_app: 'web' } },
    },
  })
  log('=== 将要发布 ===')
  log(`  正文(${text.length} 字): ${text}`)
  if (!go) { log('\n[dry] 未发布。'); return done({ exit: 0, ok: true, dry: true }) }
  if (!gateFn({ type: 'dynamic', target: 'dynamic', auto: false })) {
    return done({ exit: 2, ok: false, out: lines.concat('拒绝：限额闸不通过（额度/白名单）').join('\n') })
  }
  let out
  try {
    const qs = await wbi(fetchImpl, cookieHeader, { csrf: String(cred.bili_jct) })
    const r = await fetchImpl(`https://api.bilibili.com/x/dynamic/feed/create/dyn?${qs}`, {
      method: 'POST',
      headers: { 'user-agent': UA, referer: REF, origin: 'https://t.bilibili.com', 'content-type': 'application/json', cookie: cookieHeader },
      body,
    })
    out = await r.json()
    log(`\n[go] HTTP ${r.status}  code=${out.code} message=${out.message ?? ''}`)
  } catch (e) { return done(caught(e)) }
  if (out.code === 0) {
    const id = out.data?.dyn_id_str ?? out.data?.dyn_id
    log(`  ✅ 已发布  dyn_id=${id}`)
    log(`  https://t.bilibili.com/${id}`)
    return done({ exit: 0, ok: true, dynId: String(id) })
  }
  log(`  errmsg: ${out.data?.errmsg ?? '-'}`)
  return done({ exit: 0, ok: false })
}

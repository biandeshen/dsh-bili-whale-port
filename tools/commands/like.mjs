import { guardedFetch as fetch } from '../lib/traffic.mjs'
// 点赞（2026-10-31 分级放开加，主人拍板：点赞 = 自发档）
//
// 用法:
//   node bili.mjs like <BV> --reason "…" [--dry|--go]   赞她看完觉得好的
//   node bili.mjs like --list [--json]                  看她赞过什么
//
// 与收藏的区别：点赞是轻表态，没有五判据；但也不是无脑赞 ——
//   ① 同一视频 30 天内不重复点（B站接口是 toggle，重复点会把赞取消掉，本地账防误伤）
//   ② 理由可选，但给了就记进本地账（feed 的偏好学习会读）
import fs from 'node:fs'
import path from 'node:path'

const HOME = (process.env.USERPROFILE || process.env.HOME || '/')
const LIKE_LOG = path.join(HOME, '.bili-ai', 'likes-sent.json')
let cred = { sessdata: '', bili_jct: '', buvid3: '' }
try { cred = JSON.parse(fs.readFileSync(path.join(HOME, '.bili-ai', 'credentials.json'), 'utf8')) } catch {}
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const cookie = `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3 ?? ''}`
const H = { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie }

const argv = process.argv.slice(2)
const opt = {}
const positional = []
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2)
    if (argv[i + 1] && !argv[i + 1].startsWith('--')) { opt[k] = argv[i + 1]; i += 1 } else opt[k] = true
  } else positional.push(argv[i])
}
const DRY = !!opt.dry
const GO = !!opt.go
const DAY = 86400000

// 档位收回（publish-policy）：config.permissions.like='review' 时，--go 进待审队列而不是直发。
// 默认 'self' = 自发档（2026-10-31 分级放开）。
import { config } from '../lib/config.mjs'
import { readPolicy, tierQueues } from '../lib/publish-policy.mjs'
import { queueGo } from '../lib/go-gate.mjs'
if (GO && tierQueues(readPolicy(config()).like)) {
  queueGo({ argv: ['like', ...argv.filter((a) => a !== '--go')], kind: '点赞', bvid: positional[0] ?? '', message: String(opt.reason ?? ''), src: positional[0] ?? '' })
  process.exit(0)
}

const load = () => { try { return JSON.parse(fs.readFileSync(LIKE_LOG, 'utf8')) } catch { return { items: [] } } }
const save = (d) => { fs.mkdirSync(path.dirname(LIKE_LOG), { recursive: true }); fs.writeFileSync(LIKE_LOG, JSON.stringify(d, null, 2)) }

async function videoInfo(bv) {
  const r = await fetch(`https://api.bilibili.com/x/web-interface/view?bvid=${bv}`, { headers: H })
  const j = await r.json()
  if (j.code !== 0) throw new Error(`取视频信息失败：code=${j.code} ${j.message ?? ''}`)
  return { aid: j.data.aid, title: String(j.data.title ?? ''), up: String(j.data.owner?.name ?? '') }
}

if (opt.list) {
  const items = (load().items ?? []).slice(-50).reverse()
  if (JSONOUT()) { console.log(JSON.stringify({ items }, null, 2)); process.exit(0) }
  if (!items.length) { console.log('（她还没赞过东西）'); process.exit(0) }
  for (const x of items) console.log(`${x.at.slice(0, 10)}  ${x.bv}  「${String(x.title).slice(0, 40)}」${x.reason ? `  —— ${x.reason}` : ''}`)
  process.exit(0)
}
function JSONOUT() { return !!opt.json }

const bv = positional[0]
if (!bv || !/^BV[0-9A-Za-z]{10}$/.test(bv)) {
  console.error('用法: node bili.mjs like <BV> [--reason "…"] [--dry|--go] | --list [--json]')
  process.exit(2)
}

const d = load()
const same = (d.items ?? []).filter((x) => x.bv === bv).sort((a, b) => Date.parse(b.at) - Date.parse(a.at))[0]
if (same && Date.now() - Date.parse(same.at) < 30 * DAY) {
  console.error(`✗ 这条 ${Math.floor((Date.now() - Date.parse(same.at)) / DAY)} 天前赞过了 —— 再点一次会把赞取消（B站 toggle），别手滑`)
  process.exit(3)
}

if (!cred.sessdata || !cred.bili_jct) {
  console.error('✗ 还没配置 B站 凭据，没法点赞')
  process.exit(2)
}
let info
try { info = await videoInfo(bv) }
catch (error) { console.error(error.message); process.exit(3) }
console.log(`[like] ${bv}  「${info.title.slice(0, 44)}」  @${info.up}`)
if (opt.reason) console.log(`  理由：${String(opt.reason).slice(0, 120)}`)

if (!GO && !DRY) { console.error('✗ 必须给 --dry 或 --go'); process.exit(2) }
if (DRY) { console.log('  [dry] 未写入 ✓ 确认后把 --dry 换成 --go'); process.exit(0) }

const r = await fetch('https://api.bilibili.com/x/web-interface/archive/like', {
  method: 'POST',
  headers: { ...H, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ bvid: bv, like_pos: '1', csrf: String(cred.bili_jct ?? '') }).toString(),
})
const j = await r.json()
if (j.code !== 0) {
  const HINT = {
    '-101': '账号未登录：SESSDATA 失效，重新复制一次 cookie',
    '-111': 'CSRF 校验失败：bili_jct 和当前 SESSDATA 不是同一账号，或已过期 → 两个都重新复制一次',
    '-352': '风控拦截：等几分钟再来',
  }
  console.error(`  ✗ 点赞失败：code=${j.code} ${HINT[String(j.code)] ?? (j.message ?? '未知错误')}`)
  process.exit(4)
}
d.items = [...(d.items ?? []), { bv, aid: info.aid, title: info.title, up: info.up, at: new Date().toISOString(), reason: String(opt.reason ?? '').slice(0, 120) }]
save(d)
console.log(`  ✓ 已点赞（HTTP ${r.status}）· 本地账 +1（共 ${d.items.length} 条）`)

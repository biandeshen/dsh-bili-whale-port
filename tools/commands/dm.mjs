import { guardedFetch as fetch } from '../lib/traffic.mjs'
// 私信（专属通道）—— 2026-10-18 主人定：**三条写死在代码里**
//   ① **一天只锁定 1 个收信人**（防刷量；对同一个人发多少条不限 ✓）
//   ② 只发给配置里的 owner.mid（同一个用户，别处发不出去）
//   ④ **带 --share 时占「分享 3 条/天」的额度**（与评论区 @ 共用同一本账 ✓；不带则只是推送，不占额度）
//   ③ 必须互关（relation.attribute === 6），否则拒发
//
// 为什么写死：私信是 B站 风控最凶的接口（判营销/骚扰），而我们要的只是
// "把一条分享私密地送到主人手里"，不是群发工具 ✗ 所以能力越窄越安全 ✓
//
// 用法:
//   node dm.mjs --msg "…" --dry
//   node dm.mjs --msg "…" --go
//   node dm.mjs --status            （看今天额度 + 互关状态）
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { config } from '../lib/config.mjs'
import { validateShare } from '../lib/share-policy.mjs'
import { gate, record } from '../lib/quota-gate.mjs'
import { sendOwnerDm } from '../lib/dm-send-core.mjs'
import { report } from '../lib/report.mjs'
import { stateReadPath, writeStateText } from '../lib/paths.mjs'
import { credentialsPath } from '../lib/paths.mjs'



const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[argv[i].slice(2)] = true
    else { opt[argv[i].slice(2)] = v; i += 1 }
  }
}
const SHARE = !!opt.share       // ④ 分享型：占「分享 3 条/天」额度（与评论区 @ 共用 ✓）
// 分享型的 target 用正文里的 BV 号（"同一视频 7 天一次"才判得准 ✓）；没有就退回 dm:<mid>
const BV = (String(opt.msg ?? "").match(/BV[0-9A-Za-z]{10}/) ?? [])[0] ?? "";
// ⚠️ SHARE_TARGET 移到 ONLY_TO 定义之后（2026-10-19 修：原先在模块顶层引用 ONLY_TO，触发 TDZ
//    ReferenceError: Cannot access 'ONLY_TO' before initialization → dm.mjs 整个跑不起来，
//    notify 的私信后端也跟着挂 ✗）
const DRY = !!opt.dry
const GO = !!opt.go
const STATUS = !!opt.status
const MSG = String(opt.msg ?? '').trim()
if (SHARE && !STATUS) {
  try { validateShare(config(), opt) } catch (e) { console.error(e.message); process.exit(2) }
}

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const CRED = credentialsPath()
const QUOTA = stateReadPath('dm-quota.json')
// 2026-10-21：用共用凭据层（trim + 缺字段检查 + 错误码翻译）
//   以前这里直接 JSON.parse 就用：bili_jct 空着也照发 → B站回裸的 code=-111，
//   用户看到"体检全绿 / 能查互关"却发不出去，完全不知道该改什么 ✗
const { loadCred, missingForWrite, explainCode, looksLikeJct } = await import('../lib/cred.mjs')
const cred = loadCred()
const miss = missingForWrite(cred)
if (miss.length) {
  console.error('✗ 凭据不完整，没法发私信：')
  for (const m of miss) console.error('   · 缺 ' + m)
  console.error('  → 设置页把 SESSDATA 和 bili_jct 【两个都】重新粘贴一次并保存 ✓')
  process.exit(2)
}
// 只检查"有没有"不够 —— 截断/粘错的 bili_jct 一样会让 B 站回 -111 ✗
if (!looksLikeJct(cred.bili_jct)) {
  console.error('⚠️ bili_jct 格式不像（长度 ' + String(cred.bili_jct).length + '，B站 目前是 32 位十六进制）')
  console.error('   发送大概率会被拒（code=-111 CSRF 校验失败）—— 建议回设置页重新粘贴一次')
  console.error('   （只读接口不受影响，所以"依赖体检全绿"不代表能发东西 ✗）')
  console.error('')
}
const cfg = config()
const OWNER = String(cfg.owner?.mid ?? '').trim()
const OWNER_NAME = String(cfg.owner?.name ?? '主人')

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const H = {
  'user-agent': UA,
  referer: 'https://www.bilibili.com/',
  cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}`,
}
const jget = async (u) => (await fetch(u, { headers: H })).json()
const loadQ = () => { try { return JSON.parse(fs.readFileSync(QUOTA, 'utf8')) } catch { return {} } }
// 写只落新家：跟着读路径写会让旧家那份继续被追加，两处计数对不上（实测新 5 / 旧 4）。
const saveQ = (o) => writeStateText(JSON.stringify(o, null, 2) + '\n', 'dm-quota.json')
const today = () => new Date().toLocaleDateString('sv-SE')

// ── 写死的三条 ───────────────────────────────────────────────────────
const ONE_TARGET_PER_DAY = true  // ① 一天只锁定 1 个收信人（条数不限 ✓）
const ONLY_TO = OWNER            // ② 只发给主人
const REQUIRE_MUTUAL = true      // ③ 必须互关
// 分享型的 target：优先正文里的 BV（"同一视频 7 天一次"才判得准 ✓），否则退回 dm:<mid>
const targetBV = BV || (String(opt.target ?? "").match(/^(?:BV:)?(BV[0-9A-Za-z]{10})$/) ?? [])[1]
if (SHARE && !STATUS && !targetBV) { console.error("分享需要正文或 --target 中的有效 BV 号"); process.exit(2) }
const SHARE_TARGET = targetBV ? "BV:" + targetBV : "dm:" + ONLY_TO

async function me() {
  const nav = await jget('https://api.bilibili.com/x/web-interface/nav')
  if (!nav.data?.isLogin) { console.error('✗ 未登录（cookie 失效 ✗）'); process.exit(3) }
  return { mid: String(nav.data.mid), uname: nav.data.uname }
}

async function relation(toMid) {
  const j = await jget(`https://api.bilibili.com/x/relation?fid=${toMid}`)
  if (j.code !== 0) return { ok: false, attribute: -1, why: `关系接口 code=${j.code}` }
  return { ok: true, attribute: Number(j.data?.attribute ?? -1), beAttribute: j.data?.be_relation?.attribute == null ? null : Number(j.data.be_relation.attribute) }
}

function relationLines(rel, meInfo) {
  if (!rel.ok) return [rel.why + '，无法确认关注方向，请稍后重试']
  const outgoing = [2, 6].includes(rel.attribute)
  const incoming = rel.attribute === 6 || (rel.beAttribute != null ? [2, 6].includes(rel.beAttribute) : null)
  const lines = [
    `她 → 主人：${outgoing ? '已关注' : '未关注'}`,
    `主人 → 她：${incoming === null ? '未知（请在主人账号确认）' : incoming ? '已关注' : '未关注'}`,
  ]
  if (!outgoing) lines.push(`请登录她的账号，在 https://space.bilibili.com/${ONLY_TO} 手动关注主人。`)
  if (incoming !== true) lines.push(`请登录主人账号，在 https://space.bilibili.com/${meInfo.mid} 确认并手动关注她。`)
  if (rel.attribute === 128 || rel.beAttribute === 128) lines.push('存在拉黑关系，请先检查双方黑名单。')
  return lines
}


if (STATUS) {
  const q = loadQ()
  const lockedToday = q.date === today() ? String(q.mid ?? '') : ''
  const rel = await relation(ONLY_TO)
  const meInfo = await me()
  console.log(`账号: ${meInfo.uname}（mid ${meInfo.mid}）`)
  console.log(`专属对象: ${OWNER_NAME}（mid ${ONLY_TO || '未配置'}）`)
  console.log(`今天锁定给: ${lockedToday || '（还没发过）'}${lockedToday && lockedToday !== ONLY_TO ? '  ⚠️ 和当前配置不一致 ✗' : ''}`)
  console.log(`今日已发: ${q.date === today() ? Number(q.count ?? 0) : 0} 条（**条数不限** ✓ 只限收信人 ✓）`)
  console.log(`互关状态: attribute=${rel.attribute} ${rel.attribute === 6 ? '（✓ 互关，可以发）' : '（✗ 不是互关，发不出去）'}`)
  for (const line of relationLines(rel, meInfo)) console.log(line)
  if (!rel.ok) process.exit(3)
  process.exit(0)
}

if (!MSG) { console.error('用法: node dm.mjs --msg "…" [--share --target BV…] --dry|--go   |   --status'); process.exit(2) }

// ── 闸门与发送全部在 tools/lib/dm-send-core.mjs（与 dm-approve 共用一份实现） ──
if (!GO && !DRY) { console.error('✗ 必须给 --dry 或 --go'); process.exit(2) }
const r = await sendOwnerDm({ text: MSG, share: SHARE, shareTarget: SHARE ? SHARE_TARGET : '', dry: DRY })
// 报备：私信是主人最想知道的一条（"她刚刚给我写信了"）。dry 不报，没发出去也不报。
if (r.exit === 0 && !DRY) {
  const rep = await report('私信', crypto.createHash('sha1').update(MSG).digest('hex').slice(0, 12),
    `给主人写了条私信${SHARE ? '（分享型）' : ''}：
${MSG.slice(0, 300)}`)
  if (rep.error) console.error('报备没发出去：' + rep.error)
}
process.exit(r.exit)

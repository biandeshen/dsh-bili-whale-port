import { guardedFetch as fetch } from '../lib/traffic.mjs'
// 改 B站 昵称（2026-11-01 加；主人要求"昵称允许页面"）
//
// 为什么单独成命令而不是塞进设置页：B站 的改昵称是一次真实账号写，改完别人看得见，
// 而且次数有限。所以：
//   ① 只做一件事：把当前号的名字改成给定值，别的一项都不碰；
//   ② 必须 --go 才发，--dry 只报"现在叫什么、要改成什么"；
//   ③ 改完立刻用 nav 复核一次，回执里给出账号现在真实的名字（不信自己发的返回值）。
//
// 用法:
//   node bili.mjs rename --to "新名字" --dry
//   node bili.mjs rename --to "新名字" --go
//   node bili.mjs rename --status           （看现在叫什么，只读）
import { loadCred, missingForWrite, explainCode, looksLikeJct } from '../lib/cred.mjs'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) {
    const v = argv[i + 1]
    if (v === undefined || v.startsWith('--')) opt[argv[i].slice(2)] = true
    else { opt[argv[i].slice(2)] = v; i += 1 }
  }
}
const DRY = !!opt.dry
const GO = !!opt.go
const STATUS = !!opt.status
const TO = String(opt.to ?? '').trim()

const cred = loadCred()
const headers = { 'user-agent': UA, referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3 ?? ''}` }

async function currentName() {
  const j = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers })).json()
  if (j.code !== 0 || !j.data?.isLogin) throw new Error(`读不到当前账号：${explainCode(j.code)}`)
  return { uname: String(j.data.uname ?? ''), mid: String(j.data.mid ?? '') }
}

if (STATUS) {
  const me = await currentName()
  console.log(`${me.uname}（mid ${me.mid}）`)
  process.exit(0)
}

if (!TO) { console.error('用法: node bili.mjs rename --to "新名字" --dry|--go  |  --status'); process.exit(2) }
if (!GO && !DRY) { console.error('✗ 必须给 --dry 或 --go（改昵称是真实账号写）'); process.exit(2) }
// B站 的昵称上限是 20 个字；先自己挡，别让请求跑一趟才发现。
if ([...TO].length > 20) { console.error(`✗ 昵称最长 20 个字，现在是 ${[...TO].length} 个`); process.exit(2) }

const me = await currentName()
console.log(`现在叫：${me.uname}（mid ${me.mid}）`)
console.log(`要改成：${TO}`)
if (me.uname === TO) { console.log('  已经是这个名字了，不用改 ✓'); process.exit(0) }

if (DRY) { console.log('  [dry] 未提交 ✓ 确认后把 --dry 换成 --go'); process.exit(0) }

const miss = missingForWrite(cred)
if (miss.length) { console.error('✗ 凭据不完整：' + miss.join('、')); process.exit(3) }
if (!looksLikeJct(cred.bili_jct)) { console.error('✗ bili_jct 形状不对（应为 32 位十六进制），写操作会被 CSRF 拒'); process.exit(3) }

const r = await fetch('https://api.bilibili.com/x/member/web/update', {
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ uname: TO, csrf: String(cred.bili_jct) }).toString(),
})
const j = await r.json()
if (j.code !== 0) {
  console.error(`  ✗ 改名失败：${explainCode(j.code)}`)
  process.exit(4)
}
// 不信自己发的返回值：再读一次账号，报的是平台现在真实记着的名字。
const after = await currentName()
const ok = after.uname === TO
console.log(ok
  ? `  ✓ 已改名：${me.uname} → ${after.uname}`
  : `  ⚠ 平台回了成功，但账号现在叫「${after.uname}」，不是「${TO}」—— 可能是审核排队或名字被占用`)
process.exit(ok ? 0 : 5)

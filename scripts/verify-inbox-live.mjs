/**
 * 收件箱拉取层对**真 B 站**的一次通读（只读，不写盘、不进存储、不调模型）。
 *
 *   node scripts/verify-inbox-live.mjs
 *
 * 为什么要单独一支：监听器（B18）的规矩全部钉在替身上（`inbox-listener.test.mjs` 12 条），
 * 那只能证明"逻辑对"，证明不了"这四个端点今天还按这个形状回话"。
 * 而读 B 站不花模型的钱——主人 11-06 说了现在只做不花钱的活，这一支就是那一类：
 * 零 token、零写入、零对外发言。
 *
 * 三条克制：
 *   ① 不落任何文件：探针不该把她收件箱的时间线弄脏（写了会推走 lastSeen，等于吃掉一条真消息）；
 *   ② 私信正文不回显：只报条数与时间，主人的话不进日志；
 *   ③ 凭据只报有无与指纹前 6 位，值不打出来。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { liveCredentials, checkLogin } from '../packages/cap-bilibili/src/client/bili-read.ts'
import { pullInbox } from '../packages/cap-bilibili/src/client/bili-inbox.ts'
import { readLegacyIdentity } from '../packages/cortico-world-bilibili/src/legacy-identity.ts'
import { deployHome } from '../packages/cap-bilibili/src/platform/paths.mjs'

const home = deployHome()
// 转接头用的就是 `<部署目录>/.env`（botDir=家/xiaoyu）；两个摆法都探一下，别赌
const credFile = [path.join(home, 'xiaoyu', '.env'), path.join(home, '.env')].find((f) => fs.existsSync(f)) ?? path.join(home, 'xiaoyu', '.env')
const cred = liveCredentials(credFile)
const fp = (v) => (v ? crypto.createHash('sha1').update(v, 'utf8').digest('hex').slice(0, 6) : '(空)')
console.log(`凭据：${credFile}`)
console.log(`  SESSDATA=${fp(cred.sessdata)} bili_jct=${fp(cred.bili_jct)} buvid3=${fp(cred.buvid3)}（只给指纹）`)
if (!cred.sessdata) {
  console.log('\n没有 SESSDATA，探针到此为止（不去匿名撞接口，也不猜身份）。')
  process.exitCode = 1
  process.exit(0)
}

const ctx = { cred }
const legacy = readLegacyIdentity()
let selfMid = legacy.selfMid ?? ''
let ownerMid = legacy.ownerMid ?? ''

// nav 是"她自己是谁"的正源；旧共享配置只兜底
const me = await checkLogin(ctx)
if (me.ok && me.isLogin) {
  selfMid = String(me.mid ?? selfMid)
  console.log(`\n她自己：mid ${selfMid}（${me.uname ?? '?'}）· nav 通了`)
} else {
  console.log(`\nnav 没确认登录态（${me.error ?? 'isLogin=false'}）→ 私信这一路本轮跳过，不猜 mid`)
}
console.log(`主人：mid ${ownerMid || '(未知)'}${legacy.source ? `｜来源 ${legacy.source}` : ''}`)

const r = await pullInbox(ctx, { selfMid, ownerMid })
const byKind = (k) => r.items.filter((x) => x.kind === k)
console.log(`\n# 四路收件箱实读结果`)
for (const k of ['dm', 'reply', 'mention', 'like']) {
  const rows = byKind(k)
  const newest = rows.length ? new Date(Math.max(...rows.map((x) => x.atMs))).toISOString() : '—'
  const sample = k === 'dm'
    ? `(正文不回显)`
    : rows.length ? JSON.stringify(rows[rows.length - 1].text.slice(0, 30)) : '—'
  console.log(`  ${k.padEnd(8)} ${String(rows.length).padStart(3)} 条 · 最新 ${newest} · 样例 ${sample}`)
}
console.log(`  合计 ${r.items.length} 条 · last_view_at=${r.lastViewSec || '(无)'}`)
if (r.sourceFails.length) {
  console.log(`  没拉动的路数：`)
  for (const f of r.sourceFails) console.log(`    - ${f.source}：${f.why}`)
} else {
  console.log('  四路都拉到了（0 条也算拉到：真没人找她 ≠ 坏了）')
}
console.log('\n没有写盘、没有叫醒她、没有调模型——这条链的真凭据到此确认完。')

/**
 * `--raw`：把每一路的**原始形状**打出来。
 * 为什么要：0 条有两种意思——"真没人找她"和"解析没吃到"，光看条数分不出来。
 * 而赞那一路线上返回的是 `items[].notices[]` 两层，最容易出现"外层有东西、内层没数到"。
 */
if (process.argv.includes('--raw')) {
  const { readFetcher, readHeaders } = await import('../packages/cap-bilibili/src/client/bili-read.ts')
  const get = async (u) => (await readFetcher(ctx)(u, { headers: readHeaders(ctx) })).json()
  console.log('\n# 原始形状')
  for (const kind of ['reply', 'at', 'like']) {
    try {
      const j = await get(`https://api.bilibili.com/x/msgfeed/${kind}?platform=web&build=0&mobi_app=web`)
      const items = j?.data?.items ?? []
      const notices = kind === 'like' ? items.reduce((n, x) => n + ((x?.notices ?? []).length), 0) : undefined
      console.log(`  ${kind.padEnd(6)} code=${j?.code} items=${items.length}`
        + (notices !== undefined ? ` notices合计=${notices}` : '')
        + ` data键=[${Object.keys(j?.data ?? {}).join(',')}]`)
      // 「收到的赞」实测**没有 items**：返回的是 `latest` + `total`。
      // 不打出 latest 的形状，就会把"解析没吃到"读成"真没人点赞"——这两件事必须分得开。
      if (kind === 'like' && j?.data?.latest !== undefined) {
        const s = JSON.stringify(j.data.latest) ?? ''
        console.log(`         latest 类型=${Array.isArray(j.data.latest) ? `数组(${j.data.latest.length})` : typeof j.data.latest} total=${j?.data?.total}`)
        console.log(`         latest 前 400 字：${s.slice(0, 400)}`)
      }
      if (items.length) {
        const it = items[items.length - 1]
        console.log(`         最后一条外层键=[${Object.keys(it ?? {}).join(',')}]`)
        if (it?.item) console.log(`         item 键=[${Object.keys(it.item).join(',')}]`)
        if (it?.notices?.length) console.log(`         notice[0] 键=[${Object.keys(it.notices[0]).join(',')}]`)
      }
    } catch (e) {
      console.log(`  ${kind} 探不动：${String(e?.message ?? e).slice(0, 80)}`)
    }
  }
}
process.exitCode = r.items.length >= 0 && r.sourceFails.length < 4 ? 0 : 1

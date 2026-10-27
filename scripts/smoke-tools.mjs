/**
 * 真实 CLI 冒烟（只读）：traffic + feed。
 * 用临时 WHALE_HOME，不碰生产状态、不建草稿；只消耗两次 B 站读请求。
 * 用法：cd ../Cortico && node --import tsx ../dsh-bili-whale/scripts/smoke-tools.mjs
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'))
process.env.WHALE_HOME = home

const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const mod = await import('file:///' + CORTICO.replace(/\\/g, '/') + '/src/worlds/bili-account/definition.ts')
const tools = Object.fromEntries(mod.BILI_ACCOUNT.create().tools().map((t) => [t.name, t]))

let pass = true
const show = (s, n = 300) => String(s).replace(/\s+/g, ' ').slice(0, n)

const traffic = await tools.bili_traffic.handler({})
const trafficOk = !String(traffic).startsWith('[bili_traffic failed]') && String(traffic).trim().length > 0
console.log((trafficOk ? 'PASS  ' : 'FAIL  ') + 'traffic：' + show(traffic))
pass = pass && trafficOk

const feed = await tools.bili_feed.handler({ n: 1 })
const feedOk = /BV[0-9A-Za-z]{10}/.test(String(feed)) && String(feed).includes('[NEXT]')
console.log((feedOk ? 'PASS  ' : 'FAIL  ') + 'feed：' + show(feed))
pass = pass && feedOk

console.log('\n临时 home：' + home)
console.log(pass ? '冒烟通过（真实 CLI，只读）' : '冒烟失败')
process.exitCode = pass ? 0 : 1

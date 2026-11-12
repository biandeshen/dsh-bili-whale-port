/**
 * 真实 CLI 冒烟（只读）：traffic + feed。
 * 用临时 WHALE_HOME，不碰生产状态、不建草稿；只消耗两次 B 站读请求。
 * 用法：cd ../Cortico-up && node --import tsx ../dsh-bili-whale/scripts/smoke-tools.mjs
 *
 * 现状（2026-11-12 实测）：它加载的 src/worlds/bili-account/ 只在第二宿主克隆里有，
 * live 那棵检出已经没有这个目录（世界搬进了 packages/cortico-world-bilibili）。
 * 所以本脚本对 live 宿主跑不起来，会明确报「宿主检出里没有 …」；退役与否归旧代码清理批次判。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { hostImport } from './lib/host-root.mjs'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'smoke-'))
process.env.WHALE_HOME = home

// 跨仓加载（同 counterfactual.mjs）：宿主检出由 lib/host-root.mjs 一处解析，包名会绑死到某一份检出。
const mod = await import(hostImport('src/worlds/bili-account/definition.ts'))
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

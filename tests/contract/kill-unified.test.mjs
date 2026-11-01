// D-22 补做（主人 2026-10-30 图片指令“kill 统一检查也补上，别留口子”，推翻 10-28 DECIDED-NO）：
// kill 在 traffic 的写通道统一收口——写全拦、读照走、关掉即恢复；transport 一次都不该被调用。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createTrafficGuard, RISK_DEFAULTS } from '../../tools/lib/traffic.mjs'
import { DSH_HOME, setHomes } from '../../tools/lib/paths.mjs'
import { isKillOn, killFile } from '../../tools/lib/kill.mjs'

const ORIG_HOME = DSH_HOME
const endpoint = 'https://api.bilibili.com/x/v2/reply/add'
const nav = 'https://api.bilibili.com/x/web-interface/nav'
const ok = () => new Response(JSON.stringify({ code: 0 }), { headers: { 'content-type': 'application/json' } })

function setup(t, override = {}) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-killstate-'))
  const whale = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-killhome-'))
  setHomes({ whaleHome: whale })
  let time = Date.now(), calls = 0
  const options = {
    directory, settings: () => ({ ...RISK_DEFAULTS, writeGapSec: 0, ...override }), now: () => time,
    sleep: async (ms) => { time += ms }, transport: async () => { calls++; return ok() },
  }
  t.after(() => {
    try { fs.rmSync(killFile(), { force: true }) } catch {}
    setHomes({ whaleHome: ORIG_HOME })
    fs.rmSync(directory, { recursive: true, force: true })
    fs.rmSync(whale, { recursive: true, force: true })
  })
  return { guard: createTrafficGuard(options), calls: () => calls }
}

test('D-22：kill 打开 → 写全拦（transport 零调用）、读照走；关掉即恢复', async (t) => {
  const s = setup(t)
  assert.equal(isKillOn(), false)

  // 1) 无 kill：读写都过
  await s.guard.fetch(nav)
  assert.equal(s.calls(), 1, '读应出门')
  await s.guard.fetch(endpoint, { method: 'POST', body: 'x=1' })
  assert.equal(s.calls(), 2, '写应出门')

  // 2) 打开 kill：写必须在发包前被拦
  fs.mkdirSync(path.dirname(killFile()), { recursive: true })
  fs.writeFileSync(killFile(), '1\n')
  assert.equal(isKillOn(), true)
  await assert.rejects(
    s.guard.fetch(endpoint, { method: 'POST', body: 'x=2' }),
    (e) => /kill switch/.test(e.message),
    'kill 下写操作必须抛 kill 错误',
  )
  assert.equal(s.calls(), 2, 'kill 下写请求一次都不该出门')

  // 3) 读不受影响（急停=停发送，不停读）
  await s.guard.fetch(nav + '?x=2')
  assert.equal(s.calls(), 3, 'kill 下读仍可出门')

  // 4) 关掉 kill：写恢复
  fs.rmSync(killFile())
  assert.equal(isKillOn(), false)
  await s.guard.fetch(endpoint, { method: 'POST', body: 'x=3' })
  assert.equal(s.calls(), 4, 'kill 关闭后写恢复')
})

test('D-22：kill 只认当前 whale home（路径跟 setHomes 走，不碰真 home）', () => {
  const homeA = fs.mkdtempSync(path.join(os.tmpdir(), 'kill-homeA-'))
  const homeB = fs.mkdtempSync(path.join(os.tmpdir(), 'kill-homeB-'))
  const save = ORIG_HOME
  t_cleanup(() => {
    setHomes({ whaleHome: save })
    fs.rmSync(homeA, { recursive: true, force: true })
    fs.rmSync(homeB, { recursive: true, force: true })
  })
  setHomes({ whaleHome: homeA })
  const killB = path.join(homeB, 'bili-whale', 'control', 'kill')
  fs.mkdirSync(path.dirname(killB), { recursive: true })
  fs.writeFileSync(killB, '1')
  assert.equal(isKillOn(), false, 'kill 在 homeB，当前 homeA → 不该拦')
  setHomes({ whaleHome: homeB })
  assert.equal(isKillOn(), true, '切到 homeB → 认这个 kill')
  setHomes({ whaleHome: homeA })
  assert.equal(isKillOn(), false, '切回 homeA → 不拦')
})

const cleanups = []
function t_cleanup(fn) { cleanups.push(fn) }
process.on('exit', () => { for (const fn of cleanups) { try { fn() } catch {} } })

test('kill 也管第三方出口：非 B 站域的写同样被拦，读照走', async (t) => {
  const s = setup(t)
  const hook = 'https://hooks.example.com/notify'
  fs.mkdirSync(path.dirname(killFile()), { recursive: true })
  fs.writeFileSync(killFile(), 'stop')

  // 非 B 站域的写：以前在域名分叉那一行就 transport 出去了，kill 等于不存在。
  await assert.rejects(() => s.guard.fetch(hook, { method: 'POST', body: '{}' }), /kill switch/)
  assert.equal(s.calls(), 0, '被拦下的写一次都不许出网')

  // 非 B 站域的读不受影响
  await s.guard.fetch('https://hooks.example.com/status')
  assert.equal(s.calls(), 1)

  // B 站写同样被拦（原有行为不回退）
  await assert.rejects(() => s.guard.fetch(endpoint, { method: 'POST', body: '{}' }), /kill switch/)
  assert.equal(s.calls(), 1)
})

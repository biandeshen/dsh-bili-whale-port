// 报备（tools/lib/report.mjs）：她发出的每条对外内容都要推一句，但三件事必须成立——
// 没配渠道就不推、同一条只推一次、推失败不改判已经发生的事。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'report-'))
process.env.USERPROFILE = home
process.env.HOME = home
process.env.DSH_HOME = path.join(home, '.dsh')
process.env.BILI_WHALE_CONFIG = path.join(home, '.dsh', 'bili-whale.config.json')
fs.mkdirSync(path.dirname(process.env.BILI_WHALE_CONFIG), { recursive: true })

const { report, notifyChannel } = await import('../../tools/lib/report.mjs')

const writeCfg = (notify) => fs.writeFileSync(process.env.BILI_WHALE_CONFIG, JSON.stringify({ notify }))

test('没配渠道就不推：skip 原因写明，不抛也不假装推了', async () => {
  writeCfg({ type: 'none' })
  let called = 0
  const r = await report('点赞', 'BV1', 'x', async () => { called += 1 })
  assert.equal(r.notified, false)
  assert.equal(r.skipped, 'channel-none')
  assert.equal(called, 0)
})

test('配了渠道就推，同一条只推一次（重试、并发都不刷屏）', async () => {
  writeCfg({ type: 'webhook', url: 'https://hooks.example.com/x' })
  assert.equal(notifyChannel().type, 'webhook')
  let called = 0
  const send = async () => { called += 1 }
  const first = await report('收藏', 'BV2', '收了一条', send)
  assert.equal(first.notified, true)
  const again = await report('收藏', 'BV2', '收了一条', send)
  assert.equal(again.notified, false)
  assert.equal(again.skipped, 'already')
  assert.equal(called, 1, '同一条只推一次')
})

test('推失败如实报错——但那是报备的问题，不是发送的问题', async () => {
  writeCfg({ type: 'webhook', url: 'https://hooks.example.com/x' })
  const r = await report('私信', 'm-1', '写了一封信', async () => { throw new Error('网络断了') })
  assert.equal(r.notified, false)
  assert.match(r.error, /网络断了/)
})

test('没有 id 的报备直接跳过：没有标识就无法判重', async () => {
  writeCfg({ type: 'stdout' })
  const r = await report('动态', '', 'x', async () => {})
  assert.equal(r.skipped, 'no-id')
})

test.after?.(() => fs.rmSync(home, { recursive: true, force: true }))

// 风控暂停到期自检（f-617735）：pausedUntil 过期后状态不能再含糊说"暂停中"。
// traffic status 区分 未到期 / 已到期 / 从未暂停 三态并写明 remaining；
// 同时锁死"不因此放宽额度"——settings 必须仍是原 RISK_DEFAULTS，闸门判据没动。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { RISK_DEFAULTS } from '../tools/lib/traffic.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function statusOf(t, state) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'traffic-expiry-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  if (state) fs.writeFileSync(path.join(home, '.bili-ai', 'traffic-state.json'), JSON.stringify(state))
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'commands', 'traffic.mjs'), 'status'],
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: path.join(home, '.dsh') } })
  assert.equal(r.status, 0, r.stderr)
  return JSON.parse(r.stdout)
}

test('未到期：paused=true，remainingMs 给出还要等多久', (t) => {
  const until = Date.now() + 600000
  const out = statusOf(t, { until, reason: 'HTTP 412 / code -412' })
  assert.equal(out.paused, true)
  assert.equal(out.pauseState, '未到期')
  assert.ok(out.remainingMs > 500000 && out.remainingMs <= 600000, `remainingMs 不在窗口内：${out.remainingMs}`)
  assert.equal(out.pausedUntil, until)
})

test('已到期：不再报"暂停中"，明确"已到期，等待平台侧解除"', (t) => {
  const out = statusOf(t, { until: Date.now() - 60000, reason: 'HTTP 412 / code -412' })
  assert.equal(out.paused, false)
  assert.equal(out.pauseState, '已到期，等待平台侧解除')
  assert.equal(out.remainingMs, null, '已到期不该还给不出剩余时间')
  assert.ok(out.pausedUntil, '原始时间戳保留，供对账')
})

test('从未暂停：三态里最干净的一档', (t) => {
  const out = statusOf(t, null)
  assert.equal(out.paused, false)
  assert.equal(out.pauseState, '从未暂停')
  assert.equal(out.pausedUntil, null)
  assert.equal(out.remainingMs, null)
})

test('到期自检不放宽写额度：settings 仍是原默认值', (t) => {
  const out = statusOf(t, { until: Date.now() - 60000 })
  for (const key of Object.keys(RISK_DEFAULTS)) {
    // riskSettings() 对下限有钳制（minGapMs≥500、writeGapSec≥30），比对用同一函数
    assert.equal(out.settings[key], RISK_DEFAULTS[key], `${key} 被改了`)
  }
})

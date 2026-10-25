// 注入防线契约：外部内容=数据铁律必须存在于所有唤醒/监听提示词
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { wakePrompt } from '../../core/scheduler.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const KEY = '安全铁律'

test('wakePrompt 与监听/直播/私信提示词都带注入铁律', () => {
  const st = { atText: '2026-10-26 22:37', window: '20:00–24:00' }
  assert.match(wakePrompt(st, '', 5, 'dm'), new RegExp(KEY))
  assert.match(wakePrompt(st, '', 5, 'comment'), new RegExp(KEY))
  const src = fs.readFileSync(path.join(ROOT, 'core/scheduler.js'), 'utf8')
  const hits = src.split(KEY).length - 1
  assert.ok(hits >= 4, `铁律应出现 ≥4 处（wake+监听+直播+私信），实际 ${hits}`)
})

test('启动面不泄露完整 token（panel/launcher 打印）', () => {
  for (const f of ['panel/server.js', 'scripts/launch-panel.mjs']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8')
    assert.ok(!/\?t=\$\{token\}/.test(src) && !/\?t=\$\{url\}/.test(src), `${f} 不应把完整 token 打进控制台`)
  }
})

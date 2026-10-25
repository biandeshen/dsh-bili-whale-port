// 启动器回归：复用已有面板路径（上一版这里因作用域 bug 直接崩）
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAUNCH = path.join(ROOT, 'scripts', 'launch-panel.mjs')

test('面板已在跑时，启动器复用并正常退出（不 ReferenceError）', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-'))
  const wh = path.join(home, 'whale')
  fs.mkdirSync(wh, { recursive: true }); fs.mkdirSync(path.join(home, '.bili-ai'))
  fs.writeFileSync(path.join(wh, 'bili-whale.config.json'), '{}')
  const port = 18600 + Math.floor(Math.random() * 300)
  const env = { ...process.env, WHALE_HOME: wh, BILI_WHALE_CONFIG: path.join(wh, 'bili-whale.config.json'), USERPROFILE: home, HOME: home, PANEL_PORT: String(port), WHALE_NO_BROWSER: '1' }
  const first = spawn(process.execPath, [LAUNCH], { env, stdio: 'ignore' })
  try {
    let up = false
    for (let i = 0; i < 40 && !up; i++) {
      await new Promise((r) => setTimeout(r, 200))
      try { const r = await fetch(`http://127.0.0.1:${port}/api/vitals`); up = r.status === 503 } catch {}
    }
    assert.ok(up, '首个面板应已启动')
    const again = spawnSync(process.execPath, [LAUNCH], { env, encoding: 'utf8', timeout: 20000 })
    assert.equal(again.status, 0, again.stderr)
    assert.match(again.stdout + again.stderr, /已有面板在跑|面板已就绪/)
    assert.doesNotMatch(again.stderr, /ReferenceError/)
  } finally { first.kill('SIGKILL') }
})

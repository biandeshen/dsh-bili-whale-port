// 启动器回归：复用已有面板路径（上一版这里因作用域 bug 直接崩）
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { freePort } from '../helpers/free-port.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const LAUNCH = path.join(ROOT, 'scripts', 'launch-panel.mjs')

test('面板已在跑时，启动器复用并正常退出（不 ReferenceError）', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'launcher-'))
  const wh = path.join(home, 'whale')
  fs.mkdirSync(wh, { recursive: true }); fs.mkdirSync(path.join(home, '.bili-ai'))
  fs.writeFileSync(path.join(wh, 'bili-whale.config.json'), '{}')
  // 区间要与 panel.test 的 18441–19340 错开，并且躲开常驻 OFM 代理的 18910：
  // 原来 `18600 + random(300)` 落在 panel.test 的区间里，两个文件并发跑会互相抢端口（2026-11-05 随机红）。
  const port = await freePort({ base: 19500, span: 200 })
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

// SteamCommunity 302 用 hosts 把 GitHub 系域名指到 127.0.0.1:443 并自签证书（根证书在 Windows 库里）。
// Node 默认不读系统证书库 → 市场索引与 npm 全报 UNABLE_TO_GET_ISSUER_CERT_LOCALLY，代理救不了。
// 启动器因此必须带 --use-system-ca（Node 22.15/23+），让"用不用 Clash 都能出网"。
test('启动器给 Cortico 带上 --use-system-ca，并把它传给子进程', () => {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'start-cortico.mjs'), '--print-flags'], { encoding: 'utf8', timeout: 15000 })
  assert.equal(r.status, 0, r.stderr)
  const flags = r.stdout.trim()
  const [major, minor] = process.versions.node.split('.').map(Number)
  const shouldHave = major >= 23 || (major === 22 && minor >= 15)
  assert.equal(flags.includes('--use-system-ca'), shouldHave, `本机 Node ${process.versions.node} → 期望 ${shouldHave}，实得「${flags}」`)
  // 参数必须真被本机 Node 接受（不接受就是启动即崩，比证书错误更糟）
  const probe = spawnSync(process.execPath, [...(flags ? flags.split(' ') : []), '-e', '0'], { encoding: 'utf8', timeout: 15000 })
  assert.equal(probe.status, 0, `node 不接受这组参数：${probe.stderr}`)
})

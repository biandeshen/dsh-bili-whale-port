// 启动器回归：Cortico 启动器交给子进程的 Node 旗标。
// 原本还有一条「面板已在跑时启动器复用」，那是 scripts/launch-panel.mjs 的契约；
// 旧面板整棵树退役后那条一并退场（2026-11-12）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

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

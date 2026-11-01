// WHALE_HOME 收口（改名不搬家）：
//   ① 优先级链只有 paths.mjs 一份实现，三档各一条 + 两个都设时 WHALE_HOME 赢
//   ② 只设旧变量 DSH_HOME 的机器必须照旧能用（不许突然失效）
//   ③ DSH_HOME / dshPath 作为兼容别名与 whaleHome / whalePath 是同一批 live binding
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { whaleHome, DSH_HOME, whalePath, dshPath, resolveWhaleHome, setHomes, HOME } from '../../tools/lib/paths.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const PROBE = path.join(HERE, '..', 'helpers', 'home-probe.mjs')

/** 起一个干净子进程：临时家只通过 HOME/USERPROFILE 传进去，home 变量由 withHome(临时家) 决定。 */
function probe(t, withHome) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const base = { ...process.env, USERPROFILE: home, HOME: home, ...withHome(home) }
  if (!('WHALE_HOME' in base)) delete base.WHALE_HOME
  if (!('DSH_HOME' in base)) delete base.DSH_HOME
  const r = spawnSync(process.execPath, [PROBE], { env: base, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  return { home, got: JSON.parse(r.stdout.trim().split('\n').pop()) }
}

test('档位 1：只设 WHALE_HOME → 用它，配置与 kill 闸门跟着同一个 home', (t) => {
  const { home, got } = probe(t, (h) => ({ WHALE_HOME: path.join(h, 'whale') }))
  assert.equal(got.whaleHome, path.join(home, 'whale'))
  assert.equal(got.configPath, path.join(home, 'whale', 'bili-whale.config.json'))
  assert.equal(got.killFile, path.join(home, 'whale', 'bili-whale', 'control', 'kill'))
})

test('档位 2（兼容回归）：只设旧变量 DSH_HOME → 仍能用，不静默退回 ~/.dsh', (t) => {
  const { home, got } = probe(t, (h) => ({ DSH_HOME: path.join(h, 'legacy') }))
  assert.equal(got.whaleHome, path.join(home, 'legacy'))
  assert.equal(got.fromEnv, path.join(home, 'legacy'))
})

test('档位 3：两个都不设 → 落到 <用户主目录>/.dsh', (t) => {
  const { home, got } = probe(t, () => ({}))
  assert.equal(got.whaleHome, path.join(home, '.dsh'))
})

test('两个都设 → WHALE_HOME 赢（DSH_HOME 只是兜底，不是并列）', (t) => {
  const { home, got } = probe(t, (h) => ({ WHALE_HOME: path.join(h, 'new'), DSH_HOME: path.join(h, 'old') }))
  assert.equal(got.whaleHome, path.join(home, 'new'))
  assert.notEqual(got.whaleHome, path.join(home, 'old'))
})

test('resolveWhaleHome(env) 纯函数：同一优先级链，不读真实 process.env', () => {
  assert.equal(resolveWhaleHome({ WHALE_HOME: '/a', DSH_HOME: '/b' }), '/a')
  assert.equal(resolveWhaleHome({ DSH_HOME: '/b' }), '/b')
  assert.equal(resolveWhaleHome({}), path.join(HOME, '.dsh'))
})

test('DSH_HOME / dshPath 兼容别名与规范名同源，setHomes 一次两个名字都跟着变', (t) => {
  assert.equal(DSH_HOME, whaleHome, '别名读到的必须是同一个值')
  const orig = whaleHome
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-alias-'))
  t.after(() => { setHomes({ whaleHome: orig }); fs.rmSync(dir, { recursive: true, force: true }) })
  setHomes({ whaleHome: dir })
  assert.equal(whaleHome, dir)
  assert.equal(DSH_HOME, dir, '旧名字的引用方也必须看到新值')
  assert.equal(whalePath('x'), path.join(dir, 'x'))
  assert.equal(dshPath('x'), path.join(dir, 'x'))
})

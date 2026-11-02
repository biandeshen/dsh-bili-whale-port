/**
 * live 代码锚点（2026-11-02）。
 *
 * 观测协议说"证据归因靠 live 冻结在同一份代码"，但 `observation-start.mjs`（哈希冻住的）
 * 只记 `{startDay,days,createdAt}`——没有代码身份。而 World 每个工具都是 spawn 一条
 * `node tools/bili.mjs …`，**改 dsh 不重启就立刻生效**，所以"没重启"根本不等于"冻结"。
 * 这个脚本补的就是那条读数。测试只在临时目录里造一份"live Cortico"来制造漂移；
 * dsh 那一侧读的是真仓 HEAD（只读取指纹，不改真仓、不联网、不写真家的 control）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 本文件在 tests/ 根下（不是 tests/contract/），往上**一层**就是仓根
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'live-code-anchor.mjs')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'live-code-anchor-'))
const home = path.join(tmp, 'home')
fs.mkdirSync(path.join(home, 'bili-whale', 'control'), { recursive: true })
const ANCHOR = path.join(home, 'bili-whale', 'control', 'live-code.json')

// 一份假的"live Cortico"：临时 git 仓库，能提交、能变脏
const repoB = path.join(tmp, 'cortico-b')
fs.mkdirSync(repoB, { recursive: true })
const git = (args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t.invalid', ...args], { cwd: repoB, encoding: 'utf8' })
git(['init', '-q'])
fs.writeFileSync(path.join(repoB, 'a.ts'), 'export const a = 1\n', 'utf8')
git(['add', 'a.ts'])
git(['commit', '-q', '-m', 'first'])

const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], {
  cwd: ROOT, encoding: 'utf8', env: { ...process.env, WHALE_HOME: home }, timeout: 60000,
})

test('--set 记下两份指纹：目录、40 位 sha、dirty 状态，落盘在 control/live-code.json', () => {
  const r = run(['--set', '--cortico', repoB])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const j = JSON.parse(fs.readFileSync(ANCHOR, 'utf8'))
  assert.deepEqual(j.hosts.map((h) => h.name).sort(), ['cortico', 'dsh'])
  for (const h of j.hosts) {
    assert.match(h.sha, /^[0-9a-f]{40}$/, h.name + ' 的 sha 不是 git 提交：' + JSON.stringify(h))
    assert.equal(typeof h.dirty, 'boolean')
  }
  const b = j.hosts.find((h) => h.name === 'cortico')
  assert.equal(b.dir, path.resolve(repoB), '锚点必须记住当初那个目录，之后按它复查')
  assert.equal(b.dirty, false)
})

test('--check：代码没动就说一致，退出码 0', () => {
  const r = run(['--check', '--json'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(JSON.parse(r.stdout).state, 'ok')
})

test('live 那边多一个提交 → --check 必须红（这正是"不重启也改了 live"的那种漂移）', () => {
  fs.writeFileSync(path.join(repoB, 'b.ts'), 'export const b = 2\n', 'utf8')
  git(['add', 'b.ts'])
  git(['commit', '-q', '-m', 'second'])
  const r = run(['--check', '--json'])
  assert.equal(r.status, 2, '漂移必须非零退出：' + r.stdout)
  const j = JSON.parse(r.stdout)
  assert.equal(j.state, 'drift')
  assert.deepEqual(j.drift.map((d) => d.name), ['cortico'])
  assert.equal(j.drift[0].diff, 'code', '改的是 .ts，必须标成代码')
  assert.match(j.drift[0].why, /提交变了/, j.drift[0].why)
})

test('只动文档的漂移要说清"行为不变"，别天天冒充事故（红多了就没人看了）', () => {
  run(['--set', '--cortico', repoB])
  fs.writeFileSync(path.join(repoB, 'README.md'), '# 多加两句说明\n', 'utf8')
  git(['add', 'README.md'])
  git(['commit', '-q', '-m', 'docs: 说明'])
  const r = run(['--check', '--json'])
  assert.equal(r.status, 2, '仍然是漂移，仍要非零：' + r.stdout)
  const j = JSON.parse(r.stdout)
  assert.equal(j.drift[0].diff, 'docs', JSON.stringify(j.drift))
  assert.match(j.drift[0].why, /只动文档/, j.drift[0].why)
})

test('锚点之后工作区从干净变成有未提交改动，也算漂移', () => {
  run(['--set', '--cortico', repoB])
  fs.writeFileSync(path.join(repoB, 'loose.ts'), '改了一点没提交\n', 'utf8')
  const j = JSON.parse(run(['--check', '--json']).stdout)
  assert.equal(j.state, 'drift')
  assert.match(j.drift[0].why, /未提交改动/)
})

test('没锚过就报 missing，而不是假装一致', () => {
  fs.rmSync(ANCHOR, { force: true })
  const r = run(['--check'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /未锚定/)
})

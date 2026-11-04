import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'check-live-drift.mjs')

/**
 * 造一个小仓库 + 一个部署家，只放漂移门禁要看的那几样东西。
 * 目的不是测它"能不能跑"，是测它**会不会误报**：
 * 上一版拿整个 src 的最新 mtime 判产物新旧，一次报出 4 处漂移，3 处是假的——
 * 假漂移和假阳性一样坏，它教人把这个门禁的输出划过去。
 */
function fixture({ bundleStale = false, promptMissing = false, promptNewer = false, describeTools = ['a_tool'] } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'drift-'))
  const repo = path.join(root, 'repo')
  const deploy = path.join(root, 'home')
  const pkg = path.join(repo, 'packages', 'cap-x')
  const botPkg = path.join(repo, 'packages', 'cortico-bot-x')
  fs.mkdirSync(path.join(pkg, 'src', 'webui'), { recursive: true })
  fs.mkdirSync(path.join(pkg, 'dist'), { recursive: true })
  fs.mkdirSync(path.join(botPkg, 'src'), { recursive: true })
  fs.mkdirSync(path.join(botPkg, 'persona'), { recursive: true })
  fs.mkdirSync(path.join(deploy, 'mybot', 'prompts'), { recursive: true })

  const client = path.join(pkg, 'src', 'webui', 'client.ts')
  fs.writeFileSync(client, "export const p = { mount() { /* 面板 */ } }\n")
  const out = path.join(pkg, 'dist', 'webui.js')
  fs.writeFileSync(out, 'bundle')
  if (bundleStale) {
    // 产物"旧"：把产物时间推到过去，源码保持现在
    const past = (Date.now() - 600_000) / 1000
    fs.utimesSync(out, past, past)
  }

  const srcPrompt = path.join(botPkg, 'persona', 'ORIENTATION.md')
  fs.writeFileSync(srcPrompt, '# 这一轮怎么做\n仓库正本\n')
  const livePrompt = path.join(deploy, 'mybot', 'prompts', 'ORIENTATION.md')
  if (!promptMissing) fs.writeFileSync(livePrompt, '# 这一轮怎么做\n仓库正本\n')
  if (promptNewer) {
    fs.writeFileSync(livePrompt, '# 这一轮怎么做\n主人在页面上改过的版本\n')
    const future = (Date.now() + 60_000) / 1000
    fs.utimesSync(livePrompt, future, future)
  }

  // bot 包的源码清单与 describe.json
  fs.writeFileSync(path.join(botPkg, 'src', 'index.ts'),
    `const TOOL_SUMMARIES: Record<string, string> = {\n${describeTools.map((t) => `  ${t}: 'x',`).join('\n')}\n}\n`)
  fs.mkdirSync(path.join(botPkg), { recursive: true })
  fs.writeFileSync(path.join(botPkg, 'describe.json'),
    JSON.stringify({ tools: describeTools.map((t) => ({ name: t, summary: 'x' })) }))

  return { repo, deploy, client, out, srcPrompt, livePrompt }
}

function run(fx) {
  const r = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { ...process.env, DRIFT_REPO: fx.repo, CORTICO_HOME: fx.deploy, CORTICO_BOT: 'mybot' },
  })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

test('干净状态：不报漂移（产物新、正本一致、describe 对得上）', () => {
  const fx = fixture()
  const r = run(fx)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /没有漂移/)
  assert.match(r.out, /部署 ORIENTATION\.md 与正本一致/)
  assert.match(r.out, /cap-x webui 产物是新的/)
})

test('产物比源码旧：报出来，并点名是哪个文件', () => {
  const fx = fixture({ bundleStale: true })
  const r = run(fx)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /cap-x 的 webui 产物比源码旧/)
  assert.match(r.out, /client\.ts/)
})

test('部署缺人设副本：报漂移（改正本不生效那种）', () => {
  const fx = fixture({ promptMissing: true })
  const r = run(fx)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /部署缺 ORIENTATION\.md/)
})

test('部署副本比正本新：只提示不判失败（那可能是主人自己在页面上改的）', () => {
  const fx = fixture({ promptNewer: true })
  const r = run(fx)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /· 部署 ORIENTATION\.md 比仓库正本新/)
  assert.match(r.out, /别反向覆盖/)
})

test('describe.json 少了源码里的工具：报漂移并给出修法命令', () => {
  const fx = fixture({ describeTools: ['a_tool', 'b_tool'] })
  // 源码里两个工具，describe 只写一个：把 describe 改窄
  fs.writeFileSync(path.join(fx.repo, 'packages', 'cortico-bot-x', 'describe.json'),
    JSON.stringify({ tools: [{ name: 'a_tool', summary: 'x' }] }))
  const r = run(fx)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /cortico-bot-x describe\.json 过期/)
  assert.match(r.out, /缺 b_tool/)
  assert.match(r.out, /describe:extension/)
})

test('真仓当前状态：不许有漂移（这条就是今天踩的两个坑的守门人）', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..', '..') })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  assert.equal(r.status, 0, `线上漂移门禁红了：\n${out}`)
})

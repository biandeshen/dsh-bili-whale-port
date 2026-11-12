// 宿主路径门禁的故意违规测试：门禁必须真的会拦人，而不是"能跑"。
// 造一个小仓库，逐条塞进违规写法，断言非零退出 + 点名文件与规则；
// 同时塞进**合法**写法（-up、hostRoot()、把 Cortico 当显示标签），断言不误报——
// 假红比漏红更坏，它教人把门禁输出划过去（check-state-roots.mjs 踩过）。
//
// 注意：违规字符串在这里是拼出来的（OLD/DRIVE 两个变量），不是字面量。
// 否则本测试文件自己就会被它测的那条门禁判红。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'check-cortico-paths.mjs')
const OLD = 'Cortico'
const DRIVE = 'E:/'

function fixture(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'cortico-paths-'))
  fs.mkdirSync(path.join(repo, 'scripts'), { recursive: true })
  for (const [rel, text] of Object.entries(files)) {
    const abs = path.join(repo, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, text)
  }
  return repo
}

function run(repo, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, '--root', repo, ...args], { encoding: 'utf8', timeout: 30000 })
  return { code: r.status, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

test('干净仓库：hostRoot() + -up 路径不报红', () => {
  const repo = fixture({
    'scripts/a.mjs': `import { hostRoot, hostImport } from './lib/host-root.mjs'\nconst h = hostRoot()\nconst m = await import(hostImport('persona-core/src/rhythm.ts'))\n`,
    'scripts/b.mjs': `// 用法：cd ../${OLD}-up && node --import tsx ../dsh-bili-whale/scripts/b.mjs\nconst root = process.env.CORTICO_ROOT || path.resolve(ROOT, '..', '${OLD}-up')\n`,
  })
  const r = run(repo)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /没有指向第二宿主克隆的路径/)
})

test('R1 绝对路径指向旧克隆：判红并点名文件与行号', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const a = 1\nconst CORTICO = '${DRIVE}WorkSpace_Qoder/${OLD}'\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /R1-absolute\s+scripts\/bad\.mjs:2/)
  assert.match(r.out, /host-root\.mjs/)
})

test('R1 注释里的用法示例也算：照着跑就会跑错树', () => {
  const repo = fixture({ 'scripts/bad.mjs': `/**\n * 用法：cd ../${OLD} && node --import tsx ../dsh-bili-whale/scripts/bad.mjs\n */\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /R1-relative\s+scripts\/bad\.mjs:2/)
})

test('R1 path.join 片段拼出旧克隆：判红', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const host = path.resolve(REPO, '..', '${OLD}')\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /R1-segment\s+scripts\/bad\.mjs:1/)
})

test('R2 CORTICO_ROOT 兜底是绝对机器路径：判红', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const CORTICO = process.env.CORTICO_ROOT || '${DRIVE}WorkSpace_Qoder/${OLD}-up'\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  // 指向 live 那棵也照样红：换台机器这个盘符就是错的，该报错而不是猜
  assert.match(r.out, /R2-hard-default\s+scripts\/bad\.mjs:1/)
  assert.match(r.out, /去掉硬默认/)
})

test('不误报：Cortico 当显示标签、docs/ 里的历史案卷', () => {
  const repo = fixture({
    'scripts/label.mjs': `for (const [label, file] of [['${OLD}', pidFile]]) console.log(label)\n`,
    'docs/CORTICO-RUNBOOK.md': `- 部署：${DRIVE}WorkSpace_Qoder\\${OLD}\\deployments\\mybot\n`,
    'scripts/node_modules/x/index.mjs': `const p = '${DRIVE}WorkSpace_Qoder/${OLD}'\n`,
  })
  const r = run(repo)
  assert.equal(r.code, 0, r.out)
})

test('--json 出机器可读结果：hits 带规则/文件/行号', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const CORTICO = '${DRIVE}WorkSpace_Qoder/${OLD}'\n` })
  const r = run(repo, ['--json'])
  assert.equal(r.code, 1, r.out)
  const j = JSON.parse(r.out)
  assert.equal(j.ok, false)
  assert.equal(j.hits.length, 1)
  assert.equal(j.hits[0].rule, 'R1-absolute')
  assert.equal(j.hits[0].file, 'scripts/bad.mjs')
  assert.equal(j.hits[0].line, 1)
})

test('真仓当前状态：不许有指向旧克隆的路径', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..'), timeout: 60000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  assert.equal(r.status, 0, `宿主路径门禁红了：\n${out}`)
})
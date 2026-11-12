// 脚本路径门禁的故意违规测试：删旧代码之后，脚本不许指着空气。
// 造一个小仓库，逐条塞进违规写法，断言非零退出 + 点名文件与规则；
// 同时塞进**合法**写法（写目标、夹具键名、散文注释、运行时根、变量打断的 join、仓外路径），
// 断言不误报——假红比漏红更坏，它教人把门禁输出划过去。
//
// 注意：违规字符串在这里是拼出来的（GONE 变量），不是字面量。
// 否则本测试文件自己就会被它测的那条门禁判红。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(import.meta.dirname, '..', 'scripts', 'check-script-paths.mjs')
const GONE = 'gone'
const OK = 'ok'

function fixture(files) {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'script-paths-'))
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

test('干净仓库：真存在的 import / 仓根 join / 启动器不报红', () => {
  const repo = fixture({
    'scripts/lib/ok.mjs': 'export const x = 1\n',
    'scripts/a.mjs': `import { x } from './lib/${OK}.mjs'\nconst p = path.join(ROOT, 'scripts', 'lib', '${OK}.mjs')\n`,
    'start.cmd': '@echo off\r\nnode scripts\\a.mjs\r\n',
  })
  const r = run(repo)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /没有指向已消失文件的仓内路径/)
})

test('R1 相对 import 指向已删文件：判红并点名文件与行号', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const a = 1\nimport { x } from './lib/${GONE}.mjs'\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /## R1-import 不存在/)
  assert.match(r.out, /scripts\/bad\.mjs:2/)
})

test('R1 省略扩展名也算：.ts/.mjs/index.* 都补过一遍才判红', () => {
  const repo = fixture({
    'scripts/a.mjs': `import { x } from './lib/ok'\n`,
    'scripts/lib/ok.ts': 'export const x = 1\n',
    'scripts/b.mjs': `import { y } from './lib/${GONE}'\n`,
  })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /scripts\/b\.mjs:1/)
  assert.doesNotMatch(r.out, /scripts\/a\.mjs/)
})

test('R2 引号里的仓内路径不存在：判红', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const f = 'scripts/${GONE}.mjs'\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /## R2-仓内路径不存在/)
  assert.match(r.out, /scripts\/bad\.mjs:1/)
})

test('R3 path.join 片段拼出的仓内路径不存在：判红', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const p = path.join(ROOT, 'scripts', '${GONE}.mjs')\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /## R3-片段拼出的路径不存在/)
  assert.match(r.out, /scripts\/bad\.mjs:1/)
})

test('R4 启动器指向不存在的脚本：判红', () => {
  const repo = fixture({ 'start.cmd': `@echo off\r\nnode scripts\\${GONE}.mjs\r\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /## R4-启动器指向不存在/)
  assert.match(r.out, /start\.cmd:2/)
})

test('注释里的用法示例也算：照着跑就会跑错', () => {
  const repo = fixture({ 'scripts/bad.mjs': `// 用法：node scripts/${GONE}.mjs --date=today\nconst a = 1\n` })
  const r = run(repo)
  assert.equal(r.code, 1, r.out)
  assert.match(r.out, /## R5-用法示例里的裸路径不存在/)
  assert.match(r.out, /scripts\/bad\.mjs:1/)
})

test('不误报：写目标 / 运行时根 / 变量打断的 join / 仓外路径 / 散文注释', () => {
  const repo = fixture({
    'scripts/ok.mjs': [
      `fs.writeFileSync(path.join(ROOT, 'scripts', '${GONE}.json'), '{}')`,
      `const f = path.join(DEPLOY, 'data', 'persona', 'fields.json')`,
      `const g = path.join(ROOT, 'packages', pkg, 'src', 'index.ts')`,
      `const h = path.join(HOME, 'scripts', '${GONE}.mjs')`,
      `const outside = '../Cortico-up/persona-core/src/rhythm.ts'`,
      `// 案卷里写的 scripts/${GONE}.mjs 从来没存在过，这条是负结果记录`,
      `const t = \`node scripts/\${name}.mjs\``,
      '',
    ].join('\n'),
  })
  const r = run(repo)
  assert.equal(r.code, 0, r.out)
})

test('不误报：夹具键名与比较型断言的期望值', () => {
  const repo = fixture({
    'scripts/ok.mjs': `const files = { 'scripts/${GONE}.mjs': 'const a = 1' }\nassert.equal(hit.file, 'scripts/${GONE}.mjs')\n`,
  })
  const r = run(repo)
  assert.equal(r.code, 0, r.out)
  assert.match(r.out, /未核/)
})

test('--json 出机器可读结果：problems 带规则/文件/行号，未核带理由', () => {
  const repo = fixture({ 'scripts/bad.mjs': `const f = 'scripts/${GONE}.mjs'\n` })
  const r = run(repo, ['--json'])
  assert.equal(r.code, 1, r.out)
  const j = JSON.parse(r.out)
  assert.equal(j.ok, false)
  assert.equal(j.problems.length, 1)
  assert.equal(j.problems[0].rule, 'R2-仓内路径不存在')
  assert.equal(j.problems[0].where, 'scripts/bad.mjs:1')
  assert.ok(j.uncheckedByReason && typeof j.uncheckedByReason === 'object')
})

test('真仓当前状态：脚本里没有指向已消失文件的仓内路径', () => {
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', cwd: path.resolve(import.meta.dirname, '..'), timeout: 120000 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`
  assert.equal(r.status, 0, out)
})
// 元测试：保证磁盘上的每个 *.test.mjs 都被 npm test 显式执行（防漏挂）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const script = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).scripts.test

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) { if (e.name !== 'node_modules') walk(p, out) }
    else if (e.name.endsWith('.test.mjs')) out.push(path.relative(ROOT, p).replace(/\\/g, '/'))
  }
  return out
}

test('npm test 覆盖磁盘上所有 *.test.mjs（手写清单或动态发现）', () => {
  const files = [...walk(path.join(ROOT, 'tests')), ...walk(path.join(ROOT, 'adapters'))]

  // 动态发现：runner 从磁盘重新枚举，天然覆盖全部；只需确认它存在且没把 tests/adapters 排除
  if (/run-mjs-tests\.mjs/.test(script)) {
    const runner = path.join(ROOT, 'scripts', 'run-mjs-tests.mjs')
    assert.ok(fs.existsSync(runner), 'npm test 指向了不存在的 run-mjs-tests.mjs')
    const src = fs.readFileSync(runner, 'utf8')
    const skipLine = (src.match(/const SKIP = new Set\(\[([^\]]*)\]\)/) || [])[1] || ''
    for (const dir of ['tests', 'adapters']) {
      assert.ok(!skipLine.includes(`'${dir}'`), `动态发现把 ${dir}/ 排除了`)
    }
    return
  }

  const missing = files.filter((f) => !script.includes(f))
  assert.deepEqual(missing, [], '这些测试没被 npm test 挂上：' + missing.join(', '))
})

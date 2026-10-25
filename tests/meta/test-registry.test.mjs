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

test('package.json 的 test 列表覆盖磁盘上所有 *.test.mjs', () => {
  const files = [...walk(path.join(ROOT, 'tests')), ...walk(path.join(ROOT, 'adapters'))]
  const missing = files.filter((f) => !script.includes(f))
  assert.deepEqual(missing, [], '这些测试没被 npm test 挂上：' + missing.join(', '))
})

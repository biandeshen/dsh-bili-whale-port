// vendor 完整性：dsh-autocut lib 哈希与宿主隔离
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

const DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'vendor', 'dsh-autocut')
const sha256 = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex')

test('vendor/dsh-autocut 与 SHA256SUMS 一致', () => {
  const lines = fs.readFileSync(path.join(DIR, 'SHA256SUMS'), 'utf8').trim().split('\n').filter(Boolean)
  assert.ok(lines.length >= 15, '清单条目过少')
  for (const line of lines) {
    const [want, f] = line.trim().split(/\s+\*?/)
    const abs = path.join(DIR, f)
    assert.ok(fs.existsSync(abs), '缺文件 ' + f)
    assert.equal(sha256(abs), want, '哈希不一致 ' + f)
  }
})

test('vendor/dsh-autocut/lib 不依赖 DSH 宿主', () => {
  for (const f of fs.readdirSync(path.join(DIR, 'lib'))) {
    if (!f.endsWith('.js')) continue
    const src = fs.readFileSync(path.join(DIR, 'lib', f), 'utf8')
    assert.doesNotMatch(src, /@deepseek-ai|dsh-tools|cordis|electron/, f + ' 引入了宿主依赖')
  }
})

// M1b 凭据注册表契约：来源顺序 / fail-closed / describe 永不含 secret / B 站 provider 不改行为
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  loadMimoKey, defaultCandidates, describeMimo,
  missingForWrite, describeBilibiliCred,
  CREDENTIAL_PROVIDERS, describe,
} from '../../tools/lib/credentials/index.mjs'

const tmpFile = (obj) => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'm1b-cred-')), 'key.json')
  fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj))
  return f
}
const missing = path.join(os.tmpdir(), 'm1b-no-such-file.json')

test('M1b：env 优先于一切文件（换 key 不用改文件）', () => {
  const f = tmpFile({ xiaomi: { key: 'file-loses' } })
  const r = loadMimoKey({ env: { MIMO_API_KEY: 'env-wins' }, candidates: [f] })
  assert.equal(r.key, 'env-wins')
  assert.equal(r.source, 'env')
})

test('M1b：候选按序、坏文件跳过、三种 key 结构都认', () => {
  const broken = tmpFile('not json {{{')
  const a = tmpFile({ xiaomi: { key: 'key-a' } })
  const r1 = loadMimoKey({ env: {}, candidates: [missing, broken, a] })
  assert.equal(r1.key, 'key-a')
  assert.equal(r1.source, 'file:' + a)

  const b = tmpFile({ key: 'flat-key' })
  assert.equal(loadMimoKey({ env: {}, candidates: [b] }).key, 'flat-key')
  const c = tmpFile({ apiKey: 'alt-key' })
  assert.equal(loadMimoKey({ env: {}, candidates: [c] }).key, 'alt-key')
})

test('M1b：全缺 → fail-closed（key 严格 null，不猜空串）', () => {
  const r = loadMimoKey({ env: {}, candidates: [missing] })
  assert.equal(r.key, null)
  assert.strictEqual(r.key, null)
  assert.equal(r.source, 'missing')
})

test('M1b：describe 只回来源，永不含 key', () => {
  const secret = 'super-secret-key-12345'
  const loaded = loadMimoKey({ env: { MIMO_API_KEY: secret }, candidates: [] })
  const d = describeMimo(loaded)
  const d2 = describe('mimo', loaded)
  for (const s of [d, d2]) {
    assert.equal(s, 'env')
    assert.ok(!s.includes(secret), 'describe 不得包含 key')
    assert.ok(!JSON.stringify(s).includes('secret'))
  }
  assert.equal(describeMimo({ source: 'file:/x/y.json' }), 'file')
  assert.equal(describeMimo({ source: 'missing' }), 'missing')
  // bilibili 的 describe 只回 file/missing
  const bd = describeBilibiliCred()
  assert.ok(['file', 'missing'].includes(bd))
})

test('M1b：defaultCandidates 顺序 = auth.json → whale home（与原实现一致）', () => {
  const c = defaultCandidates()
  assert.equal(c.length, 2)
  assert.ok(c[0].replace(/\\/g, '/').endsWith('.local/share/mimocode/auth.json'), c[0])
  assert.ok(c[1].replace(/\\/g, '/').endsWith('bili-whale/credentials/mimo.json'), c[1])
})

test('M1b：B 站 provider 是纯 re-export，missingForWrite 行为不变', () => {
  const miss = missingForWrite({ sessdata: '', bili_jct: '', buvid3: '' })
  assert.equal(miss.length, 2)
  assert.match(miss[0], /SESSDATA/)
  assert.match(miss[1], /bili_jct/)
  assert.deepEqual(missingForWrite({ sessdata: 'x', bili_jct: 'y', buvid3: 'z' }), [])
})

test('M1b：注册表登记两家；未知 provider 显式抛错', () => {
  assert.deepEqual(CREDENTIAL_PROVIDERS, ['mimo', 'bilibili'])
  assert.throws(() => describe('nope', {}), /未知凭据 provider/)
})

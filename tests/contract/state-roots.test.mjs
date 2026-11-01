// 状态根语义表（tools/lib/state-roots.mjs）——R1–R5 各一条。
// 这是解耦方案 A0 的契约：路径之外还要说清"谁有权写"，否则路径统一了仍会分账。
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'state-roots-'))
const home = path.join(tmp, 'user')
const whale = path.join(home, '.dsh')
const legacy = path.join(home, '.bili-ai')
fs.mkdirSync(legacy, { recursive: true })
fs.mkdirSync(whale, { recursive: true })
process.env.USERPROFILE = home
process.env.HOME = home
process.env.WHALE_HOME = whale
process.env.BILI_WHALE_CONFIG = path.join(whale, 'bili-whale.config.json')

const R = await import('../../tools/lib/state-roots.mjs')

after(() => fs.rmSync(tmp, { recursive: true, force: true }))

test('R1 读写分离：写只落新家，读按新→旧探测', () => {
  const q = R.resolve('quota')
  assert.equal(q.write, path.join(whale, 'bili-ai', 'quota.json'))
  assert.deepEqual(q.read, [q.write, path.join(legacy, 'quota.json')])
})

test('R2 凭据读写都固定在旧家', () => {
  const c = R.resolve('credentials')
  assert.equal(c.write, path.join(legacy, 'credentials.json'))
  assert.deepEqual(c.read, [c.write], '凭据不做"新→旧"，新家那份陈旧副本会压住真 cookie')
})

test('R3 草稿取当前真实在用的目录，不是"应该在哪"的', () => {
  const live = path.join(tmp, 'live-drafts')
  fs.mkdirSync(live, { recursive: true })
  const prev = process.env.WHALE_DRAFTS
  process.env.WHALE_DRAFTS = live
  try {
    const d = R.resolve('drafts')
    assert.equal(d.write, live)
    assert.deepEqual(d.read, [live])
  } finally {
    if (prev === undefined) delete process.env.WHALE_DRAFTS
    else process.env.WHALE_DRAFTS = prev
  }
})

test('R4 探测存在即用：旧家有文件时读列表里带着它', () => {
  fs.writeFileSync(path.join(legacy, 'feedback.json'), '{"x":1}')
  const f = R.resolve('feedback')
  assert.equal(f.read.length, 2, '旧家还在兜底期内，读列表要有它')
  assert.equal(R.readHitsLegacy('feedback'), true, '这一读会落到旧家，要能报出来')
  fs.mkdirSync(path.join(whale, 'bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(whale, 'bili-ai', 'feedback.json'), '{"x":2}')
  assert.equal(R.readHitsLegacy('feedback'), false, '新家有了就不算读旧家')
})

test('R5 写者守卫：cli 不能写宿主的状态，host 不能写 CLI 的状态', () => {
  assert.equal(R.assertWriter('fields', 'host'), true)
  assert.throws(() => R.assertWriter('fields', 'cli'), /只允许 host 写/)
  assert.equal(R.assertWriter('traffic-state', 'cli'), true)
  assert.throws(() => R.assertWriter('traffic-state', 'host'), /只允许 cli 写/)
  // 两边都写的那一类不受 owner 限制（但要求拿锁，见下一条）
  assert.equal(R.assertWriter('causal', 'cli'), true)
  assert.equal(R.assertWriter('causal', 'host'), true)
})

test('R5 附带：没说身份的进程只放行 both-with-lock', () => {
  const prev = R.currentWriter()
  R.setWriter('unknown')
  try {
    assert.equal(R.assertWriter('causal'), true)
    assert.throws(() => R.assertWriter('fields'), /没说自己是 cli 还是 host/)
  } finally {
    R.setWriter(prev)
  }
})

test('退场日：过了 legacyUntil 读列表里不再有旧家，且不静默当空', () => {
  const after = Date.parse(R.LEGACY_UNTIL) + 86400_000
  const f = R.resolve('feedback', { now: after })
  assert.deepEqual(f.read, [f.write], '到期后只读新家')
  assert.equal(R.readHitsLegacy('feedback', after), false)
})

test('不认识的类当场抛错，不落到某个默认路径', () => {
  assert.throws(() => R.resolve('没这一类'), /state-roots 不认这个状态类/)
})

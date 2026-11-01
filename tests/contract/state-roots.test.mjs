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
  const after = Date.parse(R.LEGACY_UNTIL()) + 86400_000
  const f = R.resolve('feedback', { now: after })
  assert.deepEqual(f.read, [f.write], '到期后只读新家')
  assert.equal(R.readHitsLegacy('feedback', after), false)
})

test('不认识的类当场抛错，不落到某个默认路径', () => {
  assert.throws(() => R.resolve('没这一类'), /state-roots 不认这个状态类/)
})

// ── both-with-lock：无条件写必须被拒（四红测试的第 4 条）──────────────────
const L = await import('../../tools/lib/state-lock.mjs')

test('both-with-lock 的文件：拿锁才能写，两个进程并发追加不丢行', async () => {
  const file = path.join(tmp, 'causal.jsonl')
  await Promise.all(
    Array.from({ length: 20 }, (_, i) => L.appendLocked(file, JSON.stringify({ i }))),
  )
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 20, '并发追加一条都不能丢')
  assert.deepEqual(lines.map((l) => JSON.parse(l).i).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i))
})

test('锁被活进程持有超时，本次不写（不是硬写）', async () => {
  const target = path.join(tmp, 'busy.json')
  const lock = target + '.lock'
  // 自己持有一个"活着的"锁：pid 是本进程，stale 判定会认为它没死
  fs.writeFileSync(lock, JSON.stringify({ pid: process.pid, at: Date.now() }))
  try {
    await assert.rejects(
      () => L.withStateLock(target, () => 'never', { timeoutMs: 120 }),
      /拿不到 .* 的锁/,
    )
    assert.equal(fs.existsSync(target), false, '没拿到锁就一次都不该写')
  } finally {
    fs.rmSync(lock, { force: true })
  }
})

test('崩溃留下的陈旧锁（pid 已死）会被清掉，下一次还能拿', async () => {
  const target = path.join(tmp, 'stale.json')
  const lock = target + '.lock'
  // 一个几乎不可能存在的 pid
  fs.writeFileSync(lock, JSON.stringify({ pid: 2147483646, at: Date.now() - 60_000 }))
  const ok = await L.withStateLock(target, () => 'done', { timeoutMs: 500 })
  assert.equal(ok, 'done', '陈旧锁不该永久堵住下一次')
  assert.equal(fs.existsSync(lock), false, '跑完要放锁')
})

test('causal 两边都写但只追加：不要求锁；读-改-写的类才要求', () => {
  // 2026-11-02 实测：三进程并发各写 60 行 100KB，600 行无撕裂——单行 append 本身原子。
  // 所以 causal 不该配锁（配了只会多一种"超时失败"）；这条防止有人凭直觉把它改回去。
  assert.equal(R.requiresLock('causal'), false)
  assert.equal(R.specOf('causal').owner, 'both-with-lock')
  assert.equal(R.requiresLock('fields'), false)
  assert.equal(R.requiresLock('traffic-state'), false)
})

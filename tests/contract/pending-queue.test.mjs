/**
 * 待审队列放行（2026-11-02）。
 *
 * 缺陷起点：`go-gate.mjs` 只入队，注释放行的那个 panel 界面已退役，于是队列只进不出。
 * 实测 9 条从 10-25 堆到 11-02，CLI 只有 drop/take，没有任何"发出去"的路径。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pending-queue-'))
const home = path.join(tmp, 'home')
const legacy = path.join(tmp, 'legacy')
fs.mkdirSync(path.join(home, 'bili-ai'), { recursive: true })
fs.mkdirSync(legacy, { recursive: true })

process.env.WHALE_HOME = home
process.env.BILI_LEGACY_STATE_DIR = legacy

const Q = await import('../../tools/lib/pending-queue.mjs')
const P = await import('../../tools/lib/paths.mjs')

const biliPath = path.join(tmp, 'fake-bili.mjs')
fs.writeFileSync(biliPath, 'process.exit(0)', 'utf8')
const killPath = path.join(home, 'bili-whale', 'control', 'kill')

function writeQueue(items) {
  fs.mkdirSync(path.join(home, 'bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, 'bili-ai', 'pending-replies.json'), JSON.stringify({ items }, null, 2))
}
function readQueue() {
  return JSON.parse(fs.readFileSync(path.join(home, 'bili-ai', 'pending-replies.json'), 'utf8')).items
}

test('放行 = 原样执行入队 argv 并加回 --go（入队时正是把它剔掉的）', () => {
  const item = { id: 'a', at: '', kind: '收藏', argv: ['fav', 'BV1xx', '--reason', '想留着'] }
  assert.deepEqual(Q.argvForRelease(item), ['fav', 'BV1xx', '--reason', '想留着', '--go'])
  // 已经带 --go 的不重复加
  assert.deepEqual(Q.argvForRelease({ ...item, argv: ['fav', 'BV1', '--go'] }), ['fav', 'BV1', '--go'])
})

test('放行前检查：kill 开着不发', () => {
  fs.mkdirSync(path.dirname(killPath), { recursive: true })
  fs.writeFileSync(killPath, '')
  try {
    const r = Q.preflight({ id: 'a', at: '', kind: '收藏', argv: ['fav', 'BV1'] }, { biliPath, killPath })
    assert.equal(r.ok, false)
    assert.match(r.reason, /kill/)
  } finally { fs.rmSync(killPath, { force: true }) }
})

test('放行前检查：图片已不在的图文动态不发（10-25 那批图可能被清理）', () => {
  const r = Q.preflight(
    { id: 'b', at: '', kind: '动态', argv: ['dynamic-image', '--image', path.join(tmp, 'nope.png'), '--text', 'x'] },
    { biliPath, killPath },
  )
  assert.equal(r.ok, false)
  assert.match(r.reason, /图片已不在/)
})

test('放行前检查：凭据缺失时不发，理由说清', () => {
  const r = Q.preflight({ id: 'c', at: '', kind: '收藏', argv: ['fav', 'BV1'] }, { biliPath, killPath })
  assert.equal(r.ok, false)
  assert.match(r.reason, /凭据/)
})

test('批量放行：成功的摘掉，失败的留在队列里并带 attempts（风控冷却过会儿能重试）', () => {
  // 造一份假凭据 + 假图片 + 假 bili，让第一条成功
  fs.writeFileSync(P.credentialsPath(), JSON.stringify({ sessdata: 's', bili_jct: 'j', buvid3: 'b' }))
  const img = path.join(tmp, 'ok.png')
  fs.writeFileSync(img, 'x')
  fs.writeFileSync(biliPath, 'process.exit(0)\n', 'utf8')

  writeQueue([
    { id: 'ok1', at: '2026-11-02T00:00:00.000Z', kind: '动态', argv: ['dynamic-image', '--image', img, '--text', 'hi'] },
    { id: 'bad1', at: '2026-11-02T00:00:00.000Z', kind: '动态', argv: ['dynamic-image', '--image', path.join(tmp, 'gone.png'), '--text', 'x'] },
  ])

  const results = Q.releaseMany(['ok1', 'bad1', 'missing'], { biliPath, killPath })
  assert.equal(results.length, 3)
  assert.equal(results[0].ok, true, '第一条应放行成功')
  assert.equal(results[1].ok, false, '图片没了不该发')
  assert.equal(results[2].reason !== undefined, true, '队列里没有的 id 要明说')

  const left = readQueue()
  assert.equal(left.length, 1, '成功的摘掉；失败的留在队列里')
  assert.equal(left[0].id, 'bad1')
  assert.equal(left[0].attempts.length, 1, '失败原因留在 attempts 里')
  assert.match(left[0].attempts[0].reason, /图片已不在/)
})

test('dry 不执行、不改队列', () => {
  writeQueue([{ id: 'd1', at: '', kind: '收藏', argv: ['fav', 'BV1'] }])
  const before = JSON.stringify(readQueue())
  const r = Q.releaseMany(['d1'], { biliPath, killPath, dry: true })
  assert.equal(r[0].ok, true)
  assert.match(r[0].out, /\[dry\]/)
  assert.equal(JSON.stringify(readQueue()), before, 'dry 模式一个字节都不该动')
})

test('丢弃：只删点名的，不碰其它条', () => {
  writeQueue([
    { id: 'k1', at: '', kind: '收藏', argv: ['fav', 'A'] },
    { id: 'k2', at: '', kind: '收藏', argv: ['fav', 'B'] },
  ])
  const r = Q.dropMany(['k1'])
  assert.deepEqual(r.dropped, ['k1'])
  assert.deepEqual(readQueue().map((x) => x.id), ['k2'])
})

test('输出里打 ✗ 就算被拒：退出码 0 不能当成功（真实踩过）', () => {
  // 实测 fav：`✗ 不能收：这个 0 天前收过了` 退出码是 0。
  // 只看 exit 会把"规则拒绝"报成"已放行"，队列也摘了 —— 那条记录就此消失。
  fs.writeFileSync(biliPath, "console.log('✗ 不能收：理由太短');process.exit(0)", 'utf8')
  fs.writeFileSync(P.credentialsPath(), JSON.stringify({ sessdata: 's', bili_jct: 'j', buvid3: 'b' }))
  writeQueue([{ id: 'r1', at: '', kind: '收藏', argv: ['fav', 'BV1'] }])
  const r = Q.releaseMany(['r1'], { biliPath, killPath })
  assert.equal(r[0].ok, false, '输出里有 ✗ 就是被拒')
  assert.match(r[0].reason, /被规则拒绝/)
})

test.after(() => fs.rmSync(tmp, { recursive: true, force: true }))

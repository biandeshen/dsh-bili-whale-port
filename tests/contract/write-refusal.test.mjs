/**
 * 写失败不再崩栈、也不再无痕（2026-11-02）。
 *
 * 现场：她 11-01 三次 `bili_like` 的回执是一份 Node 堆栈（traffic.mjs 的 TrafficError 没人接），
 * 一次是 `code=-400`；`causal.jsonl` 里 `like` 相关 **0 条**。
 * 于是"她从没点过赞"和"她点了四次全失败"在账上完全一样——#33 想知道的就是这个区别。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'write-refusal-'))
const home = path.join(tmp, 'home')
fs.mkdirSync(path.join(home, 'bili-whale'), { recursive: true })
process.env.WHALE_HOME = home

const W = await import('../../tools/lib/write-refusal.mjs')
const CAUSAL = path.join(home, 'bili-whale', 'causal.jsonl')
const T = await import('../../tools/lib/traffic.mjs')

const lines = () => (fs.existsSync(CAUSAL) ? fs.readFileSync(CAUSAL, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])

test('traffic 闸的拒绝认得出来，且翻成能读的一句话（不是堆栈）', () => {
  const e = new T.TrafficError('写操作冷却中，请稍后再发送')
  assert.equal(W.isGateRefusal(e), true)
  assert.match(W.refusalReason(e), /写操作冷却中/)
  assert.match(W.refusalReason(e), /等冷却过了再试/, '要告诉她这类是可重试的：' + W.refusalReason(e))
  assert.equal(W.isGateRefusal(new Error('别的错')), false)
})

test('noteWriteFailure 落一条 <kind>-failed，带 actor=cli 与 bv', () => {
  W.noteWriteFailure({ kind: 'like', bv: 'BV1134y1M7tr', reason: 'code=-400 请求错误', home })
  const rows = lines()
  assert.equal(rows.length, 1, JSON.stringify(rows))
  assert.equal(rows[0].kind, 'like-failed')
  assert.equal(rows[0].bv, 'BV1134y1M7tr')
  assert.equal(rows[0].actor, 'cli')
  assert.match(rows[0].reason, /-400/)
})

test('attemptWrite：冷却抛错 → 一行 ✗ + 一条失败账 + 抛 WriteRefusedError（库不再杀进程）', () => {
  const script = path.join(tmp, 'gate.mjs')
  fs.writeFileSync(script, [
    `process.env.WHALE_HOME = ${JSON.stringify(home)};`,
    `const { attemptWrite, WriteRefusedError } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools/lib/write-refusal.mjs')).href)});`,
    `const { TrafficError } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools/lib/traffic.mjs')).href)});`,
    `try {`,
    `  await attemptWrite('点赞', async () => { throw new TrafficError('写操作冷却中，请稍后再发送') }, { kind: 'like', bv: 'BVgate1234567' });`,
    `  console.log('不该走到这里');`,
    `} catch (e) {`,
    `  console.log('CAUGHT:' + (e instanceof WriteRefusedError) + ':' + e.exit + ':' + e.kind);`,
    `}`,
  ].join('\n'), 'utf8')
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30000 })
  // 库层不再 process.exit：子进程正常退出（0），且把拒绝以异常形式交回调用方
  assert.equal(r.status, 0, `库层不该杀进程：\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /^✗ 点赞没发出去：写操作冷却中/m, r.stderr)
  assert.doesNotMatch(r.stderr, /at .*\(file:\/\//, '不许再把 Node 堆栈交给她：' + r.stderr)
  assert.equal(r.stdout.includes('不该走到这里'), false)
  assert.match(r.stdout, /CAUGHT:true:4:like/, '应当抛 WriteRefusedError 且带 exit=4 与 kind')
  const last = lines().at(-1)
  assert.equal(last.kind, 'like-failed')
  assert.equal(last.bv, 'BVgate1234567')
})

test('CLI 入口 attemptWriteCli：闸门拒仍退 4（不是崩栈，也不是退 1）', () => {
  const script = path.join(tmp, 'gate-cli.mjs')
  fs.writeFileSync(script, [
    `process.env.WHALE_HOME = ${JSON.stringify(home)};`,
    `const { attemptWriteCli } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools/lib/write-refusal.mjs')).href)});`,
    `const { TrafficError } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools/lib/traffic.mjs')).href)});`,
    `await attemptWriteCli('点赞', async () => { throw new TrafficError('写操作冷却中，请稍后再发送') }, { kind: 'like', bv: 'BVgate1234567' });`,
    `console.log('不该走到这里');`,
  ].join('\n'), 'utf8')
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 4, `退出码该是 4（闸门拒）：\n${r.stdout}\n${r.stderr}`)
  assert.match(r.stderr, /^✗ 点赞没发出去：写操作冷却中/m, r.stderr)
  assert.doesNotMatch(r.stderr, /at .*\(file:\/\//, '不许再把 Node 堆栈交给她：' + r.stderr)
  assert.equal(r.stdout.includes('不该走到这里'), false)
  const last = lines().at(-1)
  assert.equal(last.kind, 'like-failed')
})

test('非闸门错误也不崩栈：CLI 退 4，库抛可捕获的错并留下原因', () => {
  const script = path.join(tmp, 'other.mjs')
  fs.writeFileSync(script, [
    `process.env.WHALE_HOME = ${JSON.stringify(home)};`,
    `const { attemptWriteCli } = await import(${JSON.stringify(pathToFileURL(path.join(ROOT, 'tools/lib/write-refusal.mjs')).href)});`,
    `await attemptWriteCli('收藏', async () => { throw new TypeError('fetch failed') }, { kind: 'fav', bv: 'BVother1234567' });`,
  ].join('\n'), 'utf8')
  const r = spawnSync(process.execPath, [script], { encoding: 'utf8', timeout: 30000 })
  assert.equal(r.status, 4, r.stdout + r.stderr)
  assert.match(r.stderr, /✗ 收藏没发出去：fetch failed/, r.stderr)
  assert.equal(lines().at(-1).kind, 'fav-failed')
})

test('四条写链路都接了这个出口（评论/弹幕/点赞/收藏），且走的是 CLI 版', () => {
  for (const f of ['like', 'fav', 'comment', 'danmaku']) {
    const src = fs.readFileSync(path.join(ROOT, 'tools/commands', `${f}.mjs`), 'utf8')
    assert.match(src, /from '\.\.\/lib\/write-refusal\.mjs'/, f + ' 没导入收口')
    assert.match(src, /attemptWrite\(/, f + ' 的写请求没包：')
    assert.match(src, /attemptWriteCli as attemptWrite/, f + ' 的 CLI 入口必须走 attemptWriteCli（库层不杀进程）')
  }
})

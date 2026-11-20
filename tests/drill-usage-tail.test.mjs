// 对抗演练（2026-11-21）第三轮：`usage.jsonl` 只增不减，心跳每次全量扫会越来越慢。
//
// 反方实测：线上那份 6.5MB / 7940 行，整份读+解析 ≈ 110ms；心跳每 30–90 秒一次，
// 这是常驻开销。正方的修法是"只读尾部"。
//
// 这条测试要钉住两件事，缺一不可：
//   1. 大文件时**不许**把整个文件读进来（否则修法只是换了个写法）
//   2. 读尾部之后，**语义没变**——昨天的最后一次 402 仍要被看见（这是反方②刚修的）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCostToday } from '../packages/capabilities/cap-state-rhythm/src/cost-today.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'tail-'))

/** 造一个足够大的账：几十万行历史 + 结尾几条真正的账。 */
function bigLog(dir, tailRows) {
  const file = path.join(dir, 'usage.jsonl')
  const filler = JSON.stringify({
    attempt: { startedAt: '2026-01-01T00:00:00.000Z', outcome: 'success', status: 200, meters: { input: 100 } },
  }) + '\n'
  const fd = fs.openSync(file, 'w')
  try {
    // 约 12MB：故意超过任何合理的"整份读"
    const chunk = filler.repeat(10000)
    for (let i = 0; i < 4; i += 1) fs.writeSync(fd, chunk)
    fs.writeSync(fd, tailRows.map((r) => JSON.stringify(r)).join('\n') + '\n')
  } finally {
    fs.closeSync(fd)
  }
  return file
}

test('12MB 的账：不允许整份读进内存，但结尾的 402 仍算数', (t) => {
  const dir = tmp()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const today = '2026-11-22'
  const file = bigLog(dir, [
    { attempt: { startedAt: `${today}T01:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 1000 } } },
    { attempt: { startedAt: `${today}T02:00:00.000Z`, outcome: 'failed', status: 402, meters: { input: null } } },
  ])

  /**
   * 断言"读了多少字节"，而不是猜堆占用。
   *
   * 第一版用 heapUsed 差值，变异测试（把窗口改成全文件）居然仍通过——
   * 因为 GC 时机与堆波动把差异吃掉了。那种断言等于没断言。
   * 现在直接数 `fs.readSync` 实际读进来的字节：整份读必然 ≥ 文件大小。
   */
  const realSize = fs.statSync(file).size
  let bytesRead = 0
  const readSync = fs.readSync
  const readFileSync = fs.readFileSync
  fs.readSync = function patched(fd, buf, off, len, pos) {
    const n = readSync.call(fs, fd, buf, off, len, pos)
    bytesRead += n
    return n
  }
  fs.readFileSync = function patchedRead(p, opts) {
    if (String(p) === file) {
      const out = readFileSync.call(fs, p, opts)
      bytesRead += Buffer.byteLength(out)
      return out
    }
    return readFileSync.call(fs, p, opts)
  }
  let c
  try {
    c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${today}T03:00:00.000Z`) })
  } finally {
    fs.readSync = readSync
    fs.readFileSync = readFileSync
  }

  assert.equal(c.verdict, 'stalled-auth', '结尾那条 402 必须被看见')
  assert.equal(c.calls, 2, '当日累计只数今天这两条，历史填充不算')
  assert.ok(
    bytesRead < realSize / 2,
    `只读了 ${(bytesRead / 1e6).toFixed(1)}MB / 共 ${(realSize / 1e6).toFixed(1)}MB —— 必须远小于整个文件，否则就是整份扫`,
  )
})

test('小文件照旧全读（尾部窗口比文件还大时不能丢数据）', (t) => {
  const dir = tmp()
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const today = '2026-11-22'
  fs.writeFileSync(
    path.join(dir, 'usage.jsonl'),
    [
      { attempt: { startedAt: `${today}T01:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 500 } } },
      { attempt: { startedAt: `${today}T02:00:00.000Z`, outcome: 'success', status: 200, meters: { input: 700 } } },
    ].map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  )
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${today}T03:00:00.000Z`) })
  assert.equal(c.calls, 2)
  assert.equal(c.paid, 2)
  assert.equal(c.verdict, 'ok')
})

// D-32：并发实例会覆盖 life.json 的 actionsToday；启动时用 append-only 因果链对账。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dayKey } from '../persona-core/src/rhythm.ts'
import { countCausalActions } from '../src/worlds/bili-account/definition.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'causal-ledger-'))

test('只数 kind=action 且落在该自然日（00:00 日界，2026-10-31 主人拍板）的记录', () => {
  const dir = tmp()
  const file = path.join(dir, 'causal.jsonl')
  const day = '2026-10-28'
  const at = (iso) => Date.parse(iso)
  const lines = [
    // 自然日：10-28 的区间是 00:00–24:00，跨到 10-29 零点之后就算第二天
    { kind: 'action', actionKind: 'restless', atMs: at('2026-10-28T10:00:00+08:00') },
    { kind: 'watched', bvid: 'BV1xx', atMs: at('2026-10-28T10:05:00+08:00') },
    { kind: 'action', actionKind: 'restless', atMs: at('2026-10-28T23:59:00+08:00') },
    // 以下两条已属 10-29，不能算进 10-28（旧的 04:00 口径会把 02:21 算进来）
    { kind: 'action', actionKind: 'explore', atMs: at('2026-10-29T00:00:00+08:00') },
    { kind: 'action', actionKind: 'rest', atMs: at('2026-10-29T05:00:00+08:00') },
    { kind: 'draft-result', result: 'sent', atMs: at('2026-10-28T11:00:00+08:00') },
  ]
  fs.writeFileSync(file, lines.map((x) => JSON.stringify(x)).join('\n') + '\n')
  const got = countCausalActions(file, day)
  assert.equal(got.count, 2)
  assert.equal(got.lastAt, at('2026-10-28T23:59:00+08:00'))
})

test('坏行与缺 atMs 的行跳过，不影响其它记录', () => {
  const dir = tmp()
  const file = path.join(dir, 'causal.jsonl')
  const day = dayKey(Date.parse('2026-10-28T12:00:00+08:00'))
  fs.writeFileSync(file, [
    'not json',
    JSON.stringify({ kind: 'action' }),
    JSON.stringify({ kind: 'action', atMs: 'NaN' }),
    JSON.stringify({ kind: 'action', atMs: Date.parse('2026-10-28T12:00:00+08:00') }),
  ].join('\n'))
  assert.deepEqual(countCausalActions(file, day), {
    count: 1,
    lastAt: Date.parse('2026-10-28T12:00:00+08:00'),
  })
})

test('文件不存在按 0 处理（不阻止启动）', () => {
  assert.deepEqual(countCausalActions(path.join(tmp(), 'nope.jsonl'), '2026-10-28'), { count: 0, lastAt: 0 })
})

/**
 * 行动账（append-only）的读法边界。
 *
 * 从宿主 tests/causal-ledger.test.mjs 搬来（#88 退役第二份内核前的对账）：
 * 那份测 countCausalActions(causal.jsonl)，本仓换成 readActionLedger(actions.ndjson)。
 * 口径不变：只数落在该自然日的行动（00:00 日界，2026-10-31 主人拍板），
 * 坏行跳过、文件不存在按 0 处理——账读不出来不许阻止她启动。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendActionRecord, readActionLedger } from '../src/action-ledger.ts'
import { dayKey } from '../../persona-core/src/rhythm.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'action-ledger-'))
const at = (iso) => Date.parse(iso)
const rec = (iso, activity = 'explore') => ({
  at: at(iso), day: dayKey(at(iso)), activity, label: activity,
})

test('只数落在该自然日的记录（00:00 日界，跨零点就算第二天）', () => {
  const dir = tmp()
  const file = path.join(dir, 'actions.ndjson')
  const lines = [
    rec('2026-10-28T10:00:00+08:00', 'rest'),
    rec('2026-10-28T23:59:00+08:00', 'rest'),
    // 以下两条已属 10-29，不能算进 10-28（旧的 04:00 口径会把凌晨算进来）
    rec('2026-10-29T00:00:00+08:00'),
    rec('2026-10-29T05:00:00+08:00', 'rest'),
  ]
  fs.writeFileSync(file, lines.map((x) => JSON.stringify(x)).join('\n') + '\n')
  const got = readActionLedger(file, at('2026-10-28T12:00:00+08:00'))
  assert.equal(got.count, 2)
  assert.equal(got.total, 4, '总行数含历史，不跟着日界走')
  assert.equal(got.lastAt, at('2026-10-29T05:00:00+08:00'), 'lastAt 是任何一天的最近一次')
  assert.deepEqual(got.today.map((r) => r.at), [at('2026-10-28T23:59:00+08:00'), at('2026-10-28T10:00:00+08:00')],
    '今天的流水新→旧')
})

test('坏行与缺 at 的行跳过，不影响其它记录', () => {
  const dir = tmp()
  const file = path.join(dir, 'actions.ndjson')
  const good = at('2026-10-28T12:00:00+08:00')
  fs.writeFileSync(file, [
    'not json',
    '{"at":',
    JSON.stringify({ activity: 'explore' }),
    JSON.stringify({ at: 'NaN', activity: 'explore' }),
    JSON.stringify({ at: 0, activity: 'explore' }),
    JSON.stringify({ at: -5, activity: 'explore' }),
    '',
    JSON.stringify(rec('2026-10-28T12:00:00+08:00')),
  ].join('\n'))
  const got = readActionLedger(file, good)
  assert.equal(got.count, 1)
  assert.equal(got.total, 1, '半行坏账不许毁掉整本账，也不许被算成一条')
  assert.equal(got.lastAt, good)
})

test('文件不存在按 0 处理（不阻止启动）', () => {
  assert.deepEqual(readActionLedger(path.join(tmp(), 'nope.ndjson'), Date.now()),
    { count: 0, lastAt: 0, today: [], total: 0 })
})

test('day 缺失时按时间戳现算，不因为少个字段就漏账', () => {
  const dir = tmp()
  const file = path.join(dir, 'actions.ndjson')
  const t = at('2026-10-28T12:00:00+08:00')
  appendActionRecord(file, { at: t, activity: 'social', label: '想想事' })
  const got = readActionLedger(file, t)
  assert.equal(got.count, 1)
  assert.equal(got.today[0].day, dayKey(t))
  assert.equal(got.today[0].source, 'self', '没写来源就是她自己报的')
})

test('只追加：记两笔就是两行，旧行不许被覆盖或删掉', () => {
  const dir = tmp()
  const file = path.join(dir, 'actions.ndjson')
  const t = at('2026-10-28T12:00:00+08:00')
  appendActionRecord(file, { at: t, day: dayKey(t), activity: 'rest', label: '歇会儿' })
  appendActionRecord(file, { at: t + 60_000, day: dayKey(t), activity: 'create', label: '写两句', source: 'owner' })
  const raw = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(raw.length, 2)
  const got = readActionLedger(file, t)
  assert.equal(got.count, 2)
  assert.equal(got.today[0].source, 'owner', '主人替她补的那笔要认得出来')
})
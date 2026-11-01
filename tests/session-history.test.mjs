// #59 控制台历史：全量记录一直在盘上（各 run 的 transcript.jsonl，只追加、从不剪枝），
// 缺的是读它的入口。session-main.jsonl 会在交接/清空时被整体替换，不能当账本。
// 这里锁读法的三件事：跨 run 的先后稳定、游标能往前翻、坏行不带走整页。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readTranscriptHistory } from '../src/core/transcript.ts'

const mk = (dir, run, lines) => {
  const full = path.join(dir, 'runs', run)
  fs.mkdirSync(full, { recursive: true })
  fs.writeFileSync(path.join(full, 'transcript.jsonl'), lines.join('\n') + '\n', 'utf8')
}
const item = (text, role = 'user') => JSON.stringify({ kind: 'item', ts: '2026-11-01T10:00:00.000Z', run: 'r', index: 0, item: { type: 'message', role, content: [{ type: 'input_text', text }] }, context: {} })
const boundary = (event) => JSON.stringify({ kind: 'boundary', ts: '2026-11-01T10:00:00.000Z', run: 'r', event, data: {} })

function tree(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'history-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

const textOf = (page) => page.records
  .filter((r) => r.kind === 'item')
  .map((r) => r.item.content[0].text)

test('跨 run 的先后稳定：晚的 run 排在后面，页内按旧→新返回', (t) => {
  const dir = tree(t)
  mk(dir, 'r-20261031-090000-aaaa', [item('昨天一'), item('昨天二')])
  mk(dir, 'r-20261101-090000-bbbb', [item('今天一'), boundary('handoff'), item('今天二')])
  const p = readTranscriptHistory(dir, { limit: 80 })
  assert.deepEqual(textOf(p), ['昨天一', '昨天二', '今天一', '今天二'])
  assert.equal(p.records.filter((r) => r.kind === 'boundary').length, 1, '边界记录也要带出来，让人看得见哪里交接过')
  assert.equal(p.hasMore, false, '一共 5 行，翻不完不该说还有')
  assert.equal(p.scannedRuns, 2)
})

test('游标只返回更早的，翻到底 hasMore=false 且不再多给一条', (t) => {
  const dir = tree(t)
  const lines = Array.from({ length: 10 }, (_, i) => item(`m${i}`))
  mk(dir, 'r-20261101-100000-cccc', lines)
  const p1 = readTranscriptHistory(dir, { limit: 4 })
  assert.deepEqual(textOf(p1), ['m6', 'm7', 'm8', 'm9'])
  assert.equal(p1.hasMore, true)
  const p2 = readTranscriptHistory(dir, { limit: 4, before: p1.cursor })
  assert.deepEqual(textOf(p2), ['m2', 'm3', 'm4', 'm5'])
  const p3 = readTranscriptHistory(dir, { limit: 4, before: p2.cursor })
  assert.deepEqual(textOf(p3), ['m0', 'm1'])
  assert.equal(p3.hasMore, false)
  assert.equal(p3.cursor, null || p3.cursor, '最后一页仍给得出游标（指回最旧一条）')
  const p4 = readTranscriptHistory(dir, { limit: 4, before: p3.cursor })
  assert.deepEqual(textOf(p4), [], '游标到顶之后不该再挤出东西')
  assert.equal(p4.hasMore, false)
})

test('坏行与缺文件不带崩整页；没有 runs 目录时给空页', (t) => {
  const dir = tree(t)
  mk(dir, 'r-20261101-110000-dddd', [item('好的一条'), '{这行不是完整 JSON', '', item('另一条好的')])
  const p = readTranscriptHistory(dir, { limit: 10 })
  assert.deepEqual(textOf(p), ['好的一条', '另一条好的'])
  const empty = readTranscriptHistory(path.join(dir, 'nope'), { limit: 10 })
  assert.deepEqual(empty.records, [])
  assert.equal(empty.hasMore, false)
})

test('limit 收在 1..500：坏值回落默认，不给一次翻穿整个盘', (t) => {
  const dir = tree(t)
  mk(dir, 'r-20261101-120000-eeee', Array.from({ length: 30 }, (_, i) => item(`x${i}`)))
  // 0 / 负数 / NaN 都按默认 120 处理（这里全量才 30 条，所以都拿满）
  for (const bad of [0, -5, NaN]) {
    const p = readTranscriptHistory(dir, { limit: bad })
    assert.equal(p.records.length, 30, `limit=${bad} 该回落默认而不是清空返回`)
  }
  assert.equal(readTranscriptHistory(dir, { limit: 99999 }).records.length, 30, '超上限按 500 收')
  assert.equal(readTranscriptHistory(dir, { limit: 7 }).records.length, 7, '正常上限照用')
})

// ── 检索（#67）：跨 run、按日期、按关键词、按角色 ────────────────────────────
// 分页回答"最近说了什么"，检索回答"某天那句话在哪"。日期按 run 目录名而不是记录 ts：
// 交接这类边界记录可能落在第二天凌晨，按 ts 归日会把它算错一天。
test('按日期只扫那一天的 run，别的天即使命中也不返回', async (t) => {
  const { searchTranscript } = await import('../src/core/transcript.ts')
  const dir = tree(t)
  mk(dir, 'r-20261031-090000-aaaa', [item('昨天提到 鼓')])
  mk(dir, 'r-20261101-090000-bbbb', [item('今天提到 鼓')])
  const p = searchTranscript(dir, { date: '2026-11-01', query: '鼓' })
  assert.deepEqual(p.hits.map((h) => h.excerpt), ['今天提到 鼓'])
  assert.equal(p.matchingRuns, 1, '范围内只有一天一个 run')
})

test('关键词不区分大小写；命中片段带前后文但不塞整段工具回执', async (t) => {
  const { searchTranscript } = await import('../src/core/transcript.ts')
  const dir = tree(t)
  mk(dir, 'r-20261101-090000-bbbb', [item('FLOWER Dance 很好听', 'assistant')])
  const p = searchTranscript(dir, { query: 'flower' })
  assert.equal(p.hits.length, 1)
  assert.equal(p.hits[0].role, 'assistant')
  assert.match(p.hits[0].excerpt, /FLOWER Dance/)
})

test('按角色只看她说的，工具调用单独一类并带上工具名', async (t) => {
  const { searchTranscript } = await import('../src/core/transcript.ts')
  const dir = tree(t)
  const call = JSON.stringify({
    kind: 'item', ts: '2026-11-01T10:00:00.000Z', run: 'r', index: 1,
    item: { type: 'function_call', call_id: 'c1', name: 'bili_feed', arguments: '{"n":2}' }, context: {},
  })
  mk(dir, 'r-20261101-090000-bbbb', [item('主人的话'), item('她的话', 'assistant'), call])
  const hers = searchTranscript(dir, { role: 'assistant' })
  assert.deepEqual(hers.hits.map((h) => h.excerpt), ['她的话'])
  const tools = searchTranscript(dir, { role: 'tool' })
  assert.equal(tools.hits.length, 1)
  assert.equal(tools.hits[0].tool, 'bili_feed')
})

test('游标翻页不重复、不跳过；坏行不带走整页', async (t) => {
  const { searchTranscript } = await import('../src/core/transcript.ts')
  const dir = tree(t)
  mk(dir, 'r-20261101-090000-bbbb', [item('a1 命中'), '{坏行', item('a2 命中'), item('a3 命中')])
  const first = searchTranscript(dir, { query: '命中', limit: 2 })
  assert.equal(first.hits.length, 2)
  assert.equal(first.hasMore, true)
  const second = searchTranscript(dir, { query: '命中', limit: 2, before: first.cursor })
  assert.equal(second.hits.length, 1, '坏行不算命中，也不能让第二页整页失败')
  const keys = new Set([...first.hits, ...second.hits].map((h) => h.key))
  assert.equal(keys.size, 3, '两页之间不许重复同一条')
})

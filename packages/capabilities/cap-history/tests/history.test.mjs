/**
 * 对话历史能力包：分页与检索必须与被搬走的那份**行为一致**。
 *
 * 这段逻辑原在宿主 `src/core/transcript.ts`（228 行，#59/#67）。搬出来后
 * 用同形数据钉住三件事：游标翻页不重不漏、日期按 run 名归日、坏行不能带走整页。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { readTranscriptHistory, searchTranscript, runDate, createHistoryCapability } =
  await import('../src/index.ts')

/** 造一个部署数据目录：dataDir/runs/<run>/transcript.jsonl */
function mkData(t, runs) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-history-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  for (const [run, records] of Object.entries(runs)) {
    const dir = path.join(root, 'runs', run)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(
      path.join(dir, 'transcript.jsonl'),
      records.map((r) => JSON.stringify(r)).join('\n') + '\n',
      'utf8',
    )
  }
  return root
}

const msg = (run, ts, role, text) => ({
  kind: 'item', ts, run, index: 0,
  item: { type: 'message', role, content: [{ type: 'text', text }] },
})

test('runDate：从 run 名取日期，认不出返回 null', () => {
  assert.equal(runDate('r-20261101-125921-dc5f'), '2026-11-01')
  assert.equal(runDate('nonsense'), null)
})

test('分页：旧→新返回，cursor 指本页最旧一条', (t) => {
  const root = mkData(t, {
    'r-20260101-000000-aaaa': [msg('r-20260101-000000-aaaa', '2026-01-01T00:00:01Z', 'user', '第一条')],
    'r-20260102-000000-bbbb': [
      msg('r-20260102-000000-bbbb', '2026-01-02T00:00:01Z', 'user', '第二条'),
      msg('r-20260102-000000-bbbb', '2026-01-02T00:00:02Z', 'assistant', '第三条'),
    ],
  })
  const page = readTranscriptHistory(root, { limit: 10 })
  assert.equal(page.records.length, 3)
  // 旧→新
  assert.deepEqual(
    page.records.map((r) => r.item.content[0].text),
    ['第一条', '第二条', '第三条'],
  )
  assert.equal(page.cursor, 'r-20260101-000000-aaaa#00000000')
})

test('翻页：before 传 cursor 不重不漏', (t) => {
  const root = mkData(t, {
    'r-20260101-000000-aaaa': [
      msg('r-20260101-000000-aaaa', '2026-01-01T00:00:01Z', 'user', 'A'),
      msg('r-20260101-000000-aaaa', '2026-01-01T00:00:02Z', 'user', 'B'),
    ],
    'r-20260102-000000-bbbb': [msg('r-20260102-000000-bbbb', '2026-01-02T00:00:01Z', 'user', 'C')],
  })
  const first = readTranscriptHistory(root, { limit: 1 })
  assert.deepEqual(first.records.map((r) => r.item.content[0].text), ['C'])
  assert.equal(first.hasMore, true)

  const second = readTranscriptHistory(root, { limit: 1, before: first.cursor })
  assert.deepEqual(second.records.map((r) => r.item.content[0].text), ['B'])

  const third = readTranscriptHistory(root, { limit: 1, before: second.cursor })
  assert.deepEqual(third.records.map((r) => r.item.content[0].text), ['A'])
  assert.equal(third.hasMore, false)
})

test('坏行不能带走整页；目录不存在返回空页而不是抛', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-history-bad-'))
  t.after(() => fs.rmSync(root, { recursive: true, force: true }))
  const dir = path.join(root, 'runs', 'r-20260101-000000-aaaa')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'transcript.jsonl'), 'not json\n' + JSON.stringify(msg('r-20260101-000000-aaaa', '2026-01-01T00:00:01Z', 'user', '好的那行')) + '\n', 'utf8')

  const page = readTranscriptHistory(root)
  assert.equal(page.records.length, 1)
  assert.equal(page.records[0].item.content[0].text, '好的那行')

  const missing = readTranscriptHistory(path.join(root, 'nope'))
  assert.deepEqual(missing.records, [])
  assert.equal(missing.hasMore, false)
})

test('检索：按日期只扫那天的 run，按关键词与角色过滤', (t) => {
  const root = mkData(t, {
    'r-20260101-000000-aaaa': [msg('r-20260101-000000-aaaa', '2026-01-01T00:00:01Z', 'user', '今天下雨了')],
    'r-20260102-000000-bbbb': [
      msg('r-20260102-000000-bbbb', '2026-01-02T00:00:01Z', 'user', '今天也下雨了'),
      msg('r-20260102-000000-bbbb', '2026-01-02T00:00:02Z', 'assistant', '嗯，雨声好听'),
    ],
  })

  const byDate = searchTranscript(root, { date: '2026-01-02' })
  assert.equal(byDate.matchingRuns, 1)
  assert.equal(byDate.hits.length, 2)

  const byQuery = searchTranscript(root, { query: '下雨' })
  assert.equal(byQuery.hits.length, 2, '两条主人消息都含"下雨"')

  const byRole = searchTranscript(root, { query: '雨', role: 'assistant' })
  assert.equal(byRole.hits.length, 1)
  assert.equal(byRole.hits[0].role, 'assistant')
})

test('能力包：三段式契约（tools / panels / configSchema）齐全且工具只读', (t) => {
  const root = mkData(t, {
    'r-20260102-000000-bbbb': [msg('r-20260102-000000-bbbb', '2026-01-02T00:00:01Z', 'user', '你好')],
  })
  const cap = createHistoryCapability({ dataDir: root })
  assert.equal(cap.id, 'history')
  assert.equal(cap.kind, 'internal')
  assert.equal(cap.configSchema.type, 'object')

  const tools = cap.tools()
  assert.deepEqual(tools.map((x) => x.name).sort(), ['history_page', 'history_search'])
  for (const x of tools) assert.notEqual(x.mutatesState, true, `${x.name} 不该标成写工具`)

  const panels = cap.panels()
  assert.equal(panels.length, 1)
  const methods = Object.values(panels[0].methods)
  assert.ok(methods.some((m) => m.writable === true && m.verb === 'POST'), '面板要有一个可写的 POST 方法')
})

test('能力包的 history_page 工具能真的读到数据', async (t) => {
  const root = mkData(t, {
    'r-20260102-000000-bbbb': [msg('r-20260102-000000-bbbb', '2026-01-02T00:00:01Z', 'user', '记得这句')],
  })
  const cap = createHistoryCapability({ dataDir: root })
  const out = await cap.tools().find((x) => x.name === 'history_page').execute({})
  assert.equal(out.ok, true)
  assert.equal(out.count, 1)
  assert.match(out.records[0], /记得这句/)
})

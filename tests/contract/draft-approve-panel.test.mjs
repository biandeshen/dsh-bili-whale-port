// 面板放行入口契约（2026-10-31 主人：“我去哪里放行她的操作？”）
// token 只在服务端流转：响应永不含 token；令牌过期/正文被改 → 按**当前正文**重新绑定再发
// （审批对象 = 面板上展示的正文 = 实际执行的正文，M1e 原则不变）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'

const DRAFTS = fs.mkdtempSync(path.join(os.tmpdir(), 'apanel-drafts-'))
const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'apanel-whale-'))
process.env.WHALE_DRAFTS = DRAFTS
process.env.DSH_HOME = WHALE
const { approveFromPanel } = await import('../../scripts/dynamic-approve.mjs')
const ack = await import('../../scripts/ack.mjs')
fs.mkdirSync(path.join(WHALE, 'bili-whale', 'control'), { recursive: true })

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex')
const img = path.join(DRAFTS, 'daily-01.png') // markUsed 写同目录 used-images.json（有 try/catch）
const fakeRunner = () => ({ status: 0, stdout: 'dyn_id=555', stderr: '' })
const writeDraft = (d) => fs.writeFileSync(path.join(DRAFTS, d.date + '.json'), JSON.stringify(d))

test('面板放行：无可用令牌 → 自动按当前正文重新入队，再放行；响应无 token', async () => {
  const d = { id: 'dyn-20261101-aaa', date: '2026-11-01', status: 'pending', image: img, text: '正文A', textHash: sha1('正文A'), ackId: 'ack-dead-beef' }
  writeDraft(d)
  const r = await approveFromPanel({ id: d.id, runner: fakeRunner })
  assert.equal(r.ok, true)
  assert.equal(r.dynId, '555')
  const onDisk = JSON.parse(fs.readFileSync(path.join(DRAFTS, '2026-11-01.json'), 'utf8'))
  assert.ok(onDisk.ackId && onDisk.ackId !== 'ack-dead-beef', '换上新令牌')
  assert.equal(onDisk.status, 'sent')
  // 放行后令牌已 consumed（listPending 不再返回）→ 直接读令牌文件核绑定
  const pend = JSON.parse(fs.readFileSync(path.join(WHALE, 'bili-whale', 'control', 'pending', onDisk.ackId + '.json'), 'utf8'))
  assert.equal(pend.used, true, '令牌已消费')
  assert.equal(pend.payload.textHash, sha1('正文A'), '新令牌绑定当前正文')
  assert.ok(!JSON.stringify(r).includes(pend.token), '响应里绝不含 token')
})

test('面板放行：有效绑定令牌直接用，不重复入队', async () => {
  const d = { id: 'dyn-20261101-bbb', date: '2026-11-01', status: 'pending', image: img, text: '正文B', textHash: sha1('正文B') }
  const it = ack.enqueue(WHALE, { draftId: d.id, date: d.date, textHash: d.textHash })
  d.ackId = it.id
  writeDraft(d)
  const r = await approveFromPanel({ id: d.id, runner: fakeRunner })
  assert.equal(r.ok, true)
  const onDisk = JSON.parse(fs.readFileSync(path.join(DRAFTS, '2026-11-01.json'), 'utf8'))
  assert.equal(onDisk.ackId, it.id, '原令牌未换')
})

test('面板放行：已 sent 的拒放，且不新建令牌', async () => {
  const d = { id: 'dyn-20261101-ccc', date: '2026-11-01', status: 'sent', image: img, text: '正文C' }
  writeDraft(d)
  const before = ack.listPending(WHALE).length
  const r = await approveFromPanel({ id: d.id, runner: fakeRunner })
  assert.equal(r.ok, false)
  assert.match(r.error, /已处理过/)
  assert.equal(ack.listPending(WHALE).length, before, '不新建令牌')
})

test('面板放行：入队后正文被改过 → 按当前正文重新绑定（展示=执行）', async () => {
  const d = { id: 'dyn-20261101-ddd', date: '2026-11-01', status: 'pending', image: img, text: '正文D改过', textHash: sha1('正文D改过') }
  const it = ack.enqueue(WHALE, { draftId: d.id, date: d.date, textHash: sha1('正文D旧') })
  d.ackId = it.id
  writeDraft(d)
  const r = await approveFromPanel({ id: d.id, runner: fakeRunner })
  assert.equal(r.ok, true)
  const onDisk = JSON.parse(fs.readFileSync(path.join(DRAFTS, '2026-11-01.json'), 'utf8'))
  assert.notEqual(onDisk.ackId, it.id, '旧绑定作废换新令牌')
  const pend = JSON.parse(fs.readFileSync(path.join(WHALE, 'bili-whale', 'control', 'pending', onDisk.ackId + '.json'), 'utf8'))
  assert.equal(pend.used, true)
  assert.equal(pend.payload.textHash, sha1('正文D改过'), '新令牌绑定改后正文')
})

// #41：面板上放行时主人写的那句话也要落到她能读到的地方（草稿 + 因果账）。
test('面板放行带理由：ownerNote 与 draft-result 的 reason 都落盘', async () => {
  const d = { id: 'dyn-20261101-why', date: '2026-11-02', status: 'pending', image: img, text: '带理由的正文', textHash: sha1('带理由的正文') }
  const it = ack.enqueue(WHALE, { draftId: d.id, date: d.date, textHash: d.textHash })
  d.ackId = it.id
  writeDraft(d)
  const r = await approveFromPanel({ id: d.id, runner: fakeRunner, why: '这条发吧，语气是对的' })
  assert.equal(r.ok, true)
  const onDisk = JSON.parse(fs.readFileSync(path.join(DRAFTS, '2026-11-02.json'), 'utf8'))
  assert.equal(onDisk.ownerNote, '这条发吧，语气是对的')
  const causal = fs.readFileSync(path.join(WHALE, 'bili-whale', 'causal.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } })
    .filter((e) => e && e.kind === 'draft-result' && e.draftId === d.id)
  assert.equal(causal.length, 1, 'sent 应有一条 draft-result')
  assert.equal(causal[0].reason, '这条发吧，语气是对的')
  assert.ok(!JSON.stringify(r).includes(it.token), '带理由也不许把 token 漏进响应')
})

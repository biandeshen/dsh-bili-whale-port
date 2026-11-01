// #41 审批要回传理由（2026-11-01 意见箱）：她只知道"没通过"，学不到东西。
// 规则：主人写了理由 → 进草稿文件 + draft-result 因果账（她那边据此写记忆）；
//       没写理由 → 两处都不出现 reason 字段，宿主侧据此说"主人没写理由"，
//       绝不替主人编一个原因（那等于把她的学习建在假话上）。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const DRAFTS = fs.mkdtempSync(path.join(os.tmpdir(), 'apr-why-drafts-'))
const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'apr-why-whale-'))
process.env.WHALE_DRAFTS = DRAFTS
process.env.DSH_HOME = WHALE
fs.mkdirSync(path.join(WHALE, 'bili-whale', 'control'), { recursive: true })

const { makeDraft } = await import('../../scripts/draft-dynamic.mjs')
const { approve, reject, resolveWhy } = await import('../../scripts/dynamic-approve.mjs')
const ack = await import('../../scripts/ack.mjs')

const CAUSAL = path.join(WHALE, 'bili-whale', 'causal.jsonl')
const results = () => (fs.existsSync(CAUSAL) ? fs.readFileSync(CAUSAL, 'utf8') : '')
  .split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l) } catch { return null } })
  .filter((e) => e && e.kind === 'draft-result')
const draftFile = (id) => {
  const f = fs.readdirSync(DRAFTS).filter((x) => x.endsWith('.json')).find((x) => {
    try { return JSON.parse(fs.readFileSync(path.join(DRAFTS, x), 'utf8')).id === id } catch { return false }
  })
  return f ? JSON.parse(fs.readFileSync(path.join(DRAFTS, f), 'utf8')) : null
}

let n = 0
function pendingDraft(text) {
  const d = makeDraft({ date: '2026-11-01', image: `D:/x${++n}.png`, text })
  // 与生产 draft-dynamic 一致：令牌先入队，再把 ackId 写回草稿——没有 ackId 的草稿
  // 在 approve(go) 那一关就被挡（"旧草稿没有一次性令牌"），根本走不到理由回写。
  const it = ack.enqueue(WHALE, { draftId: d.id, date: d.date, textHash: d.textHash })
  d.ackId = it.id
  fs.writeFileSync(path.join(DRAFTS, `2026-11-01-${n}.json`), JSON.stringify(d))
  return { d, token: it.token }
}

const publisher = () => ({ exit: 0, ok: true, dynId: 'dyn-999', out: 'dyn_id=dyn-999' })

test('resolveWhy：--why 取下一格；没有或裸旗标都算"没写理由"', () => {
  assert.equal(resolveWhy(['reject', 'dyn-1', '--why', '选题太水']), '选题太水')
  assert.equal(resolveWhy(['reject', 'dyn-1']), '')
  assert.equal(resolveWhy(['reject', 'dyn-1', '--why']), '')
})

test('approve --why：理由同时落进草稿与因果账，她的学习有源头', async () => {
  const { d, token } = pendingDraft('这条我可以发，但下次别带话题标签')
  const r = await approve({ id: d.id, token, go: true, why: '下次别带话题标签', publisher })
  assert.equal(r.ok, true, JSON.stringify(r))
  assert.equal(draftFile(d.id).ownerNote, '下次别带话题标签')
  const e = results().find((x) => x.draftId === d.id && x.result === 'sent')
  assert.ok(e, 'sent 的因果账要有')
  assert.equal(e.reason, '下次别带话题标签')
})

test('approve 没写理由：两处都不出现 reason 字段（不编）', async () => {
  const { d, token } = pendingDraft('没写理由也要能放行')
  const r = await approve({ id: d.id, token, go: true, publisher })
  assert.equal(r.ok, true)
  assert.equal('ownerNote' in draftFile(d.id), false)
  const e = results().find((x) => x.draftId === d.id && x.result === 'sent')
  assert.equal('reason' in e, false, '没有理由就不能有 reason 字段，否则宿主会把"字段存在但为空"当成写了')
})

test('reject --why：草稿与因果账都带上她能看到的那句话', () => {
  const { d } = pendingDraft('结尾那句太像教训人')
  const r = reject(d.id, '结尾那句太像教训人，读着像在教主人做事')
  assert.equal(r.ok, true)
  assert.equal(r.reason, '结尾那句太像教训人，读着像在教主人做事')
  assert.equal(draftFile(d.id).status, 'rejected')
  assert.equal(draftFile(d.id).rejectReason, '结尾那句太像教训人，读着像在教主人做事')
  const e = results().find((x) => x.draftId === d.id && x.result === 'rejected')
  assert.equal(e.reason, '结尾那句太像教训人，读着像在教主人做事')
})

test('reject 不写理由：拒绝仍然成功，但只有时间没有理由', () => {
  const { d } = pendingDraft('不给理由地拒一条')
  const r = reject(d.id)
  assert.equal(r.ok, true)
  assert.equal(r.reason, null, '回执不能把空当理由')
  assert.equal('rejectReason' in draftFile(d.id), false)
  assert.ok(draftFile(d.id).rejectedAt, '时间戳还是要留')
  const e = results().find((x) => x.draftId === d.id && x.result === 'rejected')
  assert.equal('reason' in e, false)
})

test('理由 300 字封顶：不把整段日记塞进因果账', () => {
  const { d } = pendingDraft('超长理由这条')
  reject(d.id, '啊'.repeat(500))
  assert.equal(draftFile(d.id).rejectReason.length, 300)
  const e = results().find((x) => x.draftId === d.id && x.result === 'rejected')
  assert.equal(e.reason.length, 300)
})

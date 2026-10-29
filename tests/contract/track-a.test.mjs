// Track A 契约：草稿生成解析 / 幂等 / 审批 dry 不消耗 / kill 阻断 / 重复 approve 拒绝
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
const DRAFTS = fs.mkdtempSync(path.join(os.tmpdir(), 'tracka-'))
const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'tracka-whale-'))
process.env.WHALE_DRAFTS = DRAFTS
process.env.DSH_HOME = WHALE
const { buildText, makeDraft, findDuplicateText } = await import('../../scripts/draft-dynamic.mjs')
const { approve, reject, list } = await import('../../scripts/dynamic-approve.mjs')
const ack = await import('../../scripts/ack.mjs')
function attachAck(draft, date) {
  const it = ack.enqueue(WHALE, { draftId: draft.id, date })
  draft.ackId = it.id
  return it.token
}

const diary = `## 看过\n| 时间 | BV | 标题 | 简介 | 想法 |\n| --- | --- | --- | --- | --- |\n| 2026-10-25 | BV1x | 纯雨声没人声 | 雨 | 很安稳 |\n## 想说\n- 今天只听雨，没看到特别想说的。\n`
fs.mkdirSync(path.join(WHALE, 'bili-whale', 'control'), { recursive: true })

test('buildText 取看过标题 + 想说 + AI 标识，≤100 字', () => {
  const t = buildText(diary)
  assert.match(t, /纯雨声没人声/); assert.match(t, /今天只听雨/); assert.doesNotMatch(t, /AI 虚拟角色/)
  assert.ok(t.split('\n')[0].length <= 100)
})

test('buildText 只取当天那一段：旧日记不会拿来重复出稿', () => {
  const twoDays = [
    '## 2026-10-25',
    '## 看过',
    '| 时间 | BV | 标题 | 简介 | 想法 |',
    '| --- | --- | --- | --- | --- |',
    '| 2026-10-25 | BVold | 昨天的视频 | 雨 | 安稳 |',
    '## 想说',
    '- 昨天的话。',
    '',
    '## 2026-10-26',
    '## 看过',
    '| 时间 | BV | 标题 | 简介 | 想法 |',
    '| --- | --- | --- | --- | --- |',
    '| 2026-10-26 | BVnew | 今天的新视频 | 浪 | 新鲜 |',
    '## 想说',
    '- 今天的话。',
    '',
  ].join('\n')
  const today = buildText(twoDays, { date: '2026-10-26' })
  assert.match(today, /今天的新视频/)
  assert.match(today, /今天的话/)
  assert.doesNotMatch(today, /昨天/)
  const old = buildText(twoDays, { date: '2026-10-25' })
  assert.match(old, /昨天的视频/)
})

test('buildText：真实日记首列是 BV 也能取到标题', () => {
  const diaryBvFirst = [
    '## 2026-10-28',
    '',
    '## 看过',
    '',
    '| BV | 标题 | 时长 |',
    '|---|---|---|',
    '| BV1ji4y1Y77p | 世界公认最佳放松雨声（432HZ） | 44:30 |',
    '',
    '## 想说',
    '',
    '- 今天这条雨声不错。',
    '',
  ].join('\n')
  const t = buildText(diaryBvFirst, { date: '2026-10-28' })
  assert.match(t, /今晚看的是《世界公认最佳放松雨声/)
  assert.match(t, /今天这条雨声不错/)
})

test('buildText：想说 的多条 bullet 都保留（不再只取第一条）', () => {
  const diaryMulti = [
    '## 2026-10-28',
    '',
    '## 想说',
    '',
    '- 第一条：今天只听了雨。',
    '- 第二条：但那条标题夸大了。',
    '- 第三条：下次不选它。',
    '',
  ].join('\n')
  const t = buildText(diaryMulti, { date: '2026-10-28' })
  assert.match(t, /第一条/)
  assert.match(t, /第二条/)
  assert.match(t, /第三条/)
})

test('makeDraft id 稳定，重复输入同 id', () => {  const a = makeDraft({ date: '2026-10-25', diaryText: diary, image: 'x.png', text: buildText(diary) })
  const b = makeDraft({ date: '2026-10-25', diaryText: diary, image: 'x.png', text: buildText(diary) })
  assert.equal(a.id, b.id); assert.equal(a.status, 'pending')
})

test('findDuplicateText：和别的日期一字不差就拒稿（旧日记复用）', () => {
  const drafts = [{ id: 'old', date: '2026-10-25', text: '同一句' }]
  assert.equal(findDuplicateText(drafts, { date: '2026-10-27', text: '同一句' })?.id, 'old')
  assert.equal(findDuplicateText(drafts, { date: '2026-10-25', text: '同一句' }), null)
  assert.equal(findDuplicateText(drafts, { date: '2026-10-27', text: '新的一句' }), null)
})

test('approve dry 不消耗审批；重复 dry 允许；go 后拒绝', () => {
  const d = makeDraft({ date: '2026-10-26', diaryText: diary, image: 'D:/x.png', text: buildText(diary) })
  const token = attachAck(d)
  fs.writeFileSync(path.join(DRAFTS, '2026-10-26.json'), JSON.stringify(d))
  const calls = []
  const runner = (a) => { calls.push(a); return { status: 0, stdout: 'dry ok' } }
  const r1 = approve({ id: d.id, go: false, runner })
  assert.equal(r1.ok, true); assert.equal(r1.status, 'dry-run')
  const r2 = approve({ id: d.id, go: false, runner })
  assert.equal(r2.ok, true)
  const r3 = approve({ id: d.id, go: true, token, runner: () => ({ status: 0, stdout: 'dyn_id=1 ok' }) })
  assert.equal(r3.ok, true); assert.equal(r3.status, 'sent')
  const r4 = approve({ id: d.id, go: true, token, runner })
  assert.equal(r4.ok, false)
})

test('成功判定必须有 dyn_id：只出现 dynamic 字样不算发出去', () => {
  const d = makeDraft({ date: '2026-10-29', diaryText: diary, image: 'D:/x.png', text: 'y' })
  const token = attachAck(d)
  fs.writeFileSync(path.join(DRAFTS, '2026-10-29.json'), JSON.stringify(d))
  const r = approve({ id: d.id, go: true, token, runner: () => ({ status: 0, stdout: 'dynamic interface ok but nothing posted' }) })
  assert.equal(r.ok, false)
  assert.equal(r.status, 'failed')
})

test('go 发送前落 sending；已 sending 的草稿拒绝自动重放', () => {
  const d = makeDraft({ date: '2026-10-30', diaryText: diary, image: 'D:/x.png', text: 'z' })
  const token = attachAck(d)
  const file = path.join(DRAFTS, '2026-10-30.json')
  fs.writeFileSync(file, JSON.stringify(d))
  let seen = null
  const r = approve({
    id: d.id, go: true, token,
    runner: () => { seen = JSON.parse(fs.readFileSync(file, 'utf8')).status; return { status: 0, stdout: 'dyn_id=1 ok' } },
  })
  assert.equal(seen, 'sending')
  assert.equal(r.ok, true)
  assert.equal(r.status, 'sent')

  const stuck = makeDraft({ date: '2026-10-31', diaryText: diary, image: 'D:/x.png', text: 'stuck' })
  stuck.status = 'sending'
  fs.writeFileSync(path.join(DRAFTS, '2026-10-31.json'), JSON.stringify(stuck))
  const r2 = approve({ id: stuck.id, go: true, runner: () => { throw new Error('must not run') } })
  assert.equal(r2.ok, false)
  assert.match(r2.error, /sending|中断/)
})

test('kill switch 阻断 approve', () => {
  const d = makeDraft({ date: '2026-10-27', diaryText: diary, image: 'D:/x.png', text: 'x' })
  fs.writeFileSync(path.join(DRAFTS, '2026-10-27.json'), JSON.stringify(d))
  const kill = path.join(process.env.DSH_HOME || path.join(process.env.USERPROFILE, '.dsh'), 'bili-whale', 'control', 'kill')
  // 用真实 WHALE_HOME 路径做只读判断；测试环境无 DSH_HOME 时跳过
  if (!process.env.DSH_HOME) return
  fs.mkdirSync(path.dirname(kill), { recursive: true }); fs.writeFileSync(kill, '1')
  const r = approve({ id: d.id, go: true, runner: () => ({ status: 0, stdout: '' }) })
  fs.rmSync(kill, { force: true })
  assert.equal(r.ok, false)
})

test('reject 后不能再 approve', () => {
  const d = makeDraft({ date: '2026-10-28', diaryText: diary, image: 'D:/x.png', text: 'x' })
  fs.writeFileSync(path.join(DRAFTS, '2026-10-28.json'), JSON.stringify(d))
  assert.equal(reject(d.id).ok, true)
  const r = approve({ id: d.id, go: true, runner: () => ({ status: 0, stdout: '' }) })
  assert.equal(r.ok, false)
  assert.ok(list().some((x) => x.id === d.id && x.status === 'rejected'))
})

test('冷却失败退回一次性令牌：同一个 token 可以重试', () => {
  const d = makeDraft({ date: '2026-10-30', diaryText: diary, image: 'D:/y.png', text: '冷却重试' })
  const token = attachAck(d)
  fs.writeFileSync(path.join(DRAFTS, '2026-10-30.json'), JSON.stringify(d))
  const cool = approve({ id: d.id, go: true, token, runner: () => ({ status: 1, stdout: '写操作冷却中，请稍后' }) })
  assert.equal(cool.ok, false); assert.equal(cool.status, 'cooldown')
  const retry = approve({ id: d.id, go: true, token, runner: () => ({ status: 0, stdout: 'dyn_id=9 ok' }) })
  assert.equal(retry.ok, true); assert.equal(retry.status, 'sent')
  const again = approve({ id: d.id, go: true, token, runner: () => ({ status: 0, stdout: 'dyn_id=10' }) })
  assert.equal(again.ok, false)
})

test('only go 成功才标记图片已用；dry 不标记', async () => {  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'used-'))
  const img = path.join(imgDir, 'daily-99.png'); fs.writeFileSync(img, 'x')
  fs.writeFileSync(path.join(imgDir, 'used-images.json'), JSON.stringify({ used: [] }))
  const d = makeDraft({ date: '2026-10-29', image: img, text: 't' })
  const token = attachAck(d)
  fs.writeFileSync(path.join(DRAFTS, '2026-10-29.json'), JSON.stringify(d))
  approve({ id: d.id, go: false, runner: () => ({ status: 0, stdout: 'dry' }) })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(imgDir, 'used-images.json'), 'utf8')).used, [])
  approve({ id: d.id, go: true, token, runner: () => ({ status: 0, stdout: 'dyn_id=1' }) })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(imgDir, 'used-images.json'), 'utf8')).used, ['daily-99.png'])
})

test('发送失败不锁死草稿：failed 可重试，且不消耗图片', () => {
  const d = makeDraft({ date: '2026-10-23', image: 'D:/z.png', text: '重试用例' })
  const token = attachAck(d)
  fs.writeFileSync(path.join(DRAFTS, '2026-10-23.json'), JSON.stringify(d))
  const fail = approve({ id: d.id, go: true, token, runner: () => ({ status: 1, stdout: '', stderr: '网络断了' }) })
  assert.equal(fail.ok, false); assert.equal(fail.status, 'failed')
  // 旧实现把 failed 列进 blocked → 这条草稿永远发不出去
  const retry = approve({ id: d.id, go: true, token, runner: () => ({ status: 0, stdout: 'dyn_id=9 ok' }) })
  assert.equal(retry.ok, true); assert.equal(retry.status, 'sent')
})

test('审批结果写进因果，醒来可由代码结算（不靠模型自觉）', async () => {
  const causalFile = path.join(WHALE, 'bili-whale', 'causal.jsonl')
  const readResults = () => (fs.existsSync(causalFile) ? fs.readFileSync(causalFile, 'utf8').trim().split('\n').filter(Boolean) : [])
    .map((l) => JSON.parse(l)).filter((o) => o.kind === 'draft-result')
  const before = readResults().length
  const sent = makeDraft({ date: '2026-10-22', image: 'D:/s.png', text: '要发的' })
  const sentTok = attachAck(sent)
  fs.writeFileSync(path.join(DRAFTS, '2026-10-22.json'), JSON.stringify(sent))
  approve({ id: sent.id, go: true, token: sentTok, runner: () => ({ status: 0, stdout: 'dyn_id=7 ok' }) })
  const rejected = makeDraft({ date: '2026-10-21', image: 'D:/r.png', text: '被拒的' })
  fs.writeFileSync(path.join(DRAFTS, '2026-10-21.json'), JSON.stringify(rejected))
  reject(rejected.id)
  const rows = readResults().slice(before)
  assert.deepEqual(rows.map((r) => r.result).sort(), ['rejected', 'sent'])
  assert.equal(rows.find((r) => r.result === 'sent').draftId, sent.id)
  // dry 不算审批结果
  const dryDraft = makeDraft({ date: '2026-10-20', image: 'D:/d.png', text: '只看不发' })
  fs.writeFileSync(path.join(DRAFTS, '2026-10-20.json'), JSON.stringify(dryDraft))
  approve({ id: dryDraft.id, go: false, runner: () => ({ status: 0, stdout: 'dry ok' }) })
  assert.equal(readResults().length, before + 2)
})

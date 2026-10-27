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

test('makeDraft id 稳定，重复输入同 id', () => {
  const a = makeDraft({ date: '2026-10-25', diaryText: diary, image: 'x.png', text: buildText(diary) })
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

test('only go 成功才标记图片已用；dry 不标记', async () => {
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'used-'))
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

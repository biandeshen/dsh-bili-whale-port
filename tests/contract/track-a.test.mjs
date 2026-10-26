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
const { buildText, makeDraft } = await import('../../scripts/draft-dynamic.mjs')
const { approve, reject, list } = await import('../../scripts/dynamic-approve.mjs')

const diary = `## 看过\n| 时间 | BV | 标题 | 简介 | 想法 |\n| --- | --- | --- | --- | --- |\n| 2026-10-25 | BV1x | 纯雨声没人声 | 雨 | 很安稳 |\n## 想说\n- 今天只听雨，没看到特别想说的。\n`
fs.mkdirSync(path.join(WHALE, 'bili-whale', 'control'), { recursive: true })

test('buildText 取看过标题 + 想说 + AI 标识，≤100 字', () => {
  const t = buildText(diary)
  assert.match(t, /纯雨声没人声/); assert.match(t, /今天只听雨/); assert.match(t, /AI 虚拟角色/)
  assert.ok(t.split('\n')[0].length <= 100)
})

test('makeDraft id 稳定，重复输入同 id', () => {
  const a = makeDraft({ date: '2026-10-25', diaryText: diary, image: 'x.png', text: buildText(diary) })
  const b = makeDraft({ date: '2026-10-25', diaryText: diary, image: 'x.png', text: buildText(diary) })
  assert.equal(a.id, b.id); assert.equal(a.status, 'pending')
})

test('approve dry 不消耗审批；重复 dry 允许；go 后拒绝', () => {
  const d = makeDraft({ date: '2026-10-26', diaryText: diary, image: 'D:/x.png', text: buildText(diary) })
  fs.writeFileSync(path.join(DRAFTS, '2026-10-26.json'), JSON.stringify(d))
  const calls = []
  const runner = (a) => { calls.push(a); return { status: 0, stdout: 'dry ok' } }
  const r1 = approve({ id: d.id, go: false, runner })
  assert.equal(r1.ok, true); assert.equal(r1.status, 'dry-run')
  const r2 = approve({ id: d.id, go: false, runner })
  assert.equal(r2.ok, true)
  const r3 = approve({ id: d.id, go: true, runner: () => ({ status: 0, stdout: 'dyn_id=1 ok' }) })
  assert.equal(r3.ok, true); assert.equal(r3.status, 'sent')
  const r4 = approve({ id: d.id, go: true, runner })
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

test('只有 go 成功才标记图片已用；dry 不标记', async () => {
  const imgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'used-'))
  const img = path.join(imgDir, 'daily-99.png'); fs.writeFileSync(img, 'x')
  fs.writeFileSync(path.join(imgDir, 'used-images.json'), JSON.stringify({ used: [] }))
  const d = makeDraft({ date: '2026-10-29', image: img, text: 't' })
  fs.writeFileSync(path.join(DRAFTS, '2026-10-29.json'), JSON.stringify(d))
  approve({ id: d.id, go: false, runner: () => ({ status: 0, stdout: 'dry' }) })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(imgDir, 'used-images.json'), 'utf8')).used, [])
  approve({ id: d.id, go: true, runner: () => ({ status: 0, stdout: 'dyn_id=1' }) })
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(imgDir, 'used-images.json'), 'utf8')).used, ['daily-99.png'])
})

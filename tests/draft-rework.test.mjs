/**
 * 被主人拒掉的稿，今天还得能重出一版（2026-11-02）。
 *
 * 撞出来的现场：主人一天里 reject 了五条稿，理由都写回草稿（#41）。她 12:19 那轮读了理由，
 * 日记里写「这一轮出稿被『当天草稿已存在』拒了……不重试」——闸门把**被拒的**也算成"今天已有稿"，
 * 于是"照着理由重写"变成一句她执行不了的话。
 *
 * 这里跑的是真 CLI（起子进程、真写盘、真入队令牌），不是把函数抄一遍。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'draft-rework-'))
const home = path.join(tmp, 'home')
const drafts = path.join(tmp, 'drafts')
const images = path.join(tmp, 'images')
fs.mkdirSync(path.join(home, 'bili-whale'), { recursive: true })
fs.mkdirSync(drafts, { recursive: true })
fs.mkdirSync(images, { recursive: true })
fs.writeFileSync(path.join(images, 'daily-01-test-a.png'), 'not-a-real-png-but-picker-only-lists-names', 'utf8')

const { logicalDay } = await import('../scripts/day-snapshot.mjs')
const DAY = logicalDay()
fs.writeFileSync(path.join(home, 'whale-diary.md'), [
  '# 公开日记',
  '',
  '## ' + DAY,
  '',
  '### 看过',
  '',
  '| 日期 | BV | 片名 | 时长 |',
  '| --- | --- | --- | --- |',
  `| ${DAY} | BV1testBV001 | 《44分钟的雨声》 | 44:12 |`,
  '',
  '### 想说',
  '',
  '- 热评都在叫别人别看评论了，一屋子失眠的人互相看着对方别熬夜。',
  '',
].join('\n'))

const voice = {
  v: 1,
  mood: { label: '苦乐参半', intensity: 0.4, reason: '读到那条热评', cause: 'action' },
  relation: 'normal',
  memories: [],
  banned: [],
  stance: { share: true, because: '有想说的' },
}
const voiceFile = path.join(tmp, 'voice.json')
fs.writeFileSync(voiceFile, JSON.stringify(voice), 'utf8')

function runDraft() {
  const r = spawnSync(process.execPath, [
    path.join(ROOT, 'scripts', 'draft-dynamic.mjs'),
    '--date', DAY, '--drafts', drafts, '--images', images, '--voice', voiceFile,
  ], { encoding: 'utf8', env: { ...process.env, WHALE_HOME: home, WHALE_DRAFTS: drafts }, timeout: 60000 })
  let parsed = null
  try { parsed = JSON.parse(r.stdout) } catch {}
  return { r, parsed }
}
const dayFile = path.join(drafts, DAY + '.json')
const setStatus = (status) => {
  const d = JSON.parse(fs.readFileSync(dayFile, 'utf8'))
  fs.writeFileSync(dayFile, JSON.stringify({ ...d, status }, null, 2))
}

test('今天没有稿 → 出稿并配一张一次性令牌', () => {
  const { r, parsed } = runDraft()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(parsed?.ok, true, r.stdout)
  assert.equal(parsed.status, 'pending')
  assert.ok(parsed.ackId, '成稿必须带令牌，否则 auto/人工都发不出去：' + r.stdout)
  assert.ok(!parsed.text.includes('*'), '出站正文不该有星号（compose 已收口）：' + parsed.text)
})

test('状态=rejected → 同一天允许重出，重新入队一张新令牌', () => {
  const first = JSON.parse(fs.readFileSync(dayFile, 'utf8'))
  setStatus('rejected')
  const { r, parsed } = runDraft()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(parsed?.ok, true, '被拒的稿必须能重写：' + r.stdout)
  assert.equal(parsed.status, 'pending', '重出来的那条要回到等审批的状态')
  assert.ok(parsed.ackId, '重出必须带令牌，否则 auto 还是发不出去')
  assert.notEqual(parsed.ackId, first.ackId, '令牌必须是新入队的那一张：' + r.stdout)
  // 记下这条事实：id 由「日期 + 正文」推出来，同一篇日记重写两次 id 相同。
  // 被拒那条的理由不会丢——它已经进了 causal.jsonl（append-only）并被结算成记忆。
  assert.equal(parsed.id, first.id)
})

test('状态=sent / pending → 仍然拦住（一天两条是刷屏，不是重写）', () => {
  for (const status of ['sent', 'pending']) {
    setStatus(status)
    const { r, parsed } = runDraft()
    assert.equal(parsed?.ok, false, status + ' 不该放行第二版：' + r.stdout)
    assert.equal(parsed?.error, '当天草稿已存在')
    assert.equal(parsed?.status, status)
    assert.equal(r.status, 0, '拦住是正常结论，不是崩溃：' + r.stderr)
  }
})

test('被拒重出时旧那条留了痕：新稿落在同一个日期文件上，读者只看得到当前状态', () => {
  setStatus('rejected')
  const { parsed } = runDraft()
  const onDisk = JSON.parse(fs.readFileSync(dayFile, 'utf8'))
  assert.equal(onDisk.id, parsed.id)
  assert.equal(onDisk.date, DAY)
})

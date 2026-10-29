// 唤醒审计：按 external_event_frame 分组；当天已有稿时不把“本轮没出稿”算缺失
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'wake-audit-'))
const DRAFTS = path.join(WHALE, 'drafts')
fs.mkdirSync(DRAFTS, { recursive: true })
fs.writeFileSync(path.join(DRAFTS, '2026-10-29.json'), JSON.stringify({ id: 'dyn-20261029-x', date: '2026-10-29', status: 'pending', diaryHash: 'h' }))
process.env.WHALE_DRAFTS = DRAFTS
process.env.DSH_HOME = WHALE
const { auditSession } = await import('../scripts/wake-audit.mjs')

const row = (item, ts) => JSON.stringify({ version: 2, item, context: { ts } })
const call = (name, callId, args = '{}') => ({ type: 'function_call', name, call_id: callId, arguments: args })
const out = (callId, output) => ({ type: 'function_call_output', call_id: callId, output })

const session = path.join(WHALE, 'session.jsonl')
fs.writeFileSync(session, [
  row(call('external_event_frame', 'c1'), '2026-10-29T10:00:00+08:00'),
  row(out('c1', '[1 new event] 【你想做点什么】'), '2026-10-29T10:00:00+08:00'),
  row(call('bili_mood_read', 'c1a'), '2026-10-29T10:00:01+08:00'),
  row(call('bili_traffic', 'c1b'), '2026-10-29T10:00:02+08:00'),
  row(call('bili_feed', 'c2', '{"n":1}'), '2026-10-29T10:00:05+08:00'),
  row(call('bili_debrief', 'c3', '{"bvid":"BV1xx"}'), '2026-10-29T10:00:10+08:00'),
  row(call('bili_diary_append', 'c4', '{"book":"public","heading":"看过","text":"x"}'), '2026-10-29T10:00:15+08:00'),
  row(call('bili_draft_dynamic', 'c5'), '2026-10-29T10:00:20+08:00'),
  row(out('c5', '{"ok":true,"id":"dyn-20261029-x"}'), '2026-10-29T10:00:21+08:00'),
  row({ type: 'message', role: 'user', content: [{ type: 'input_text', text: '[system] 进程重启,session 已续上。' }] }, '2026-10-29T10:05:00+08:00'),
  row(call('external_event_frame', 'c10'), '2026-10-29T18:00:00+08:00'),
  row(out('c10', '[1 new event] 【你想做点什么】'), '2026-10-29T18:00:00+08:00'),
  row(call('bili_diary_append', 'c11', '{"book":"private","heading":"判断","text":"今天不想发，因为…"}'), '2026-10-29T18:00:10+08:00'),
].join('\n'))

test('两次唤醒分组；流程完整与缺失分别判定', () => {
  const w = auditSession(session)
  assert.equal(w.length, 2)
  assert.equal(w[0].day, '2026-10-29')
  assert.equal(w[0].complete, true)
  assert.equal(w[0].checks.feed, true)
  assert.equal(w[0].checks.debrief, true)
  assert.equal(w[0].checks.draftInWake, true)
  assert.equal(w[0].draft.id, 'dyn-20261029-x')

  assert.equal(w[1].complete, false)
  assert.deepEqual(w[1].missing, ['mood_read', 'traffic', 'feed', 'debrief'])
  assert.equal(w[1].checks.draftExists, true)
  assert.equal(w[1].checks.privateDiary, true)
})

test('重启消息会切断上一次唤醒，不会把它算进下一轮', () => {
  const w = auditSession(session)
  assert.equal(w[0].calls.includes('end_turn'), false)
})

test('--strict：最近一次完整才 exit 0；不完整 exit 1', async () => {
  const { spawnSync } = await import('node:child_process')
  const pathMod = await import('node:path')
  const script = pathMod.resolve(pathMod.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'scripts', 'wake-audit.mjs')
  const complete = path.join(WHALE, 'complete.jsonl')
  fs.writeFileSync(complete, fs.readFileSync(session, 'utf8').split('\n').slice(0, 7).join('\n'))
  const env = { ...process.env, DSH_HOME: WHALE, WHALE_DRAFTS: DRAFTS }
  const ok = spawnSync(process.execPath, [script, '--file', complete, '--strict'], { env, encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  const bad = spawnSync(process.execPath, [script, '--file', session, '--strict'], { env, encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.match(bad.stderr, /不完整/)
})

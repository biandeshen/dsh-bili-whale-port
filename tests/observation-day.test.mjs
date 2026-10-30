// 观测日证据包：开窗拒绝 / 完整日 PASS / 缺自然 action FAIL
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'

const SCRIPT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'scripts', 'observation-day.mjs')
const logicalDay = (now = Date.now()) => new Date(now).toLocaleDateString('sv-SE') // 自然日（2026-10-31 拍板）

function makeHome({ withAction = true } = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'obsday-'))
  const control = path.join(home, 'bili-whale', 'control')
  const drafts = path.join(home, 'bili-whale', 'drafts')
  const d = logicalDay()
  const dir = path.join(home, 'bili-whale', 'days', d)
  fs.mkdirSync(control, { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(control, 'observation.json'), JSON.stringify({ startDay: d, days: 1 }))
  const diary = `## ${d}\n\n## 看过\n\n| BV | 标题 |\n|---|---|\n| BV1x | t |\n\n## 想说\n\n- 好。\n`
  fs.writeFileSync(path.join(home, 'whale-diary.md'), diary)
  const diaryHash = crypto.createHash('sha1').update(diary).digest('hex')
  fs.writeFileSync(path.join(dir, 'state.start.json'), JSON.stringify({ at: `${d}T05:00:00+08:00`, day: d }))
  const ticks = []
  for (let h = 5; h <= 20; h += 1) ticks.push(JSON.stringify({ at: `${d}T${String(h).padStart(2, '0')}:00:00+08:00`, day: d }))
  fs.writeFileSync(path.join(dir, 'ticks.jsonl'), ticks.join('\n') + '\n')
  fs.writeFileSync(path.join(dir, 'day.json'), JSON.stringify({ day: d, flags: { missed: false, late: false, tainted: false } }))
  fs.writeFileSync(path.join(dir, 'counterfactual.json'), JSON.stringify({ day: d, ok: true, diffChars: 6, realMood: '灵感' }))
  fs.writeFileSync(path.join(drafts, d + '.json'), JSON.stringify({ id: 'dyn-' + d, date: d, diaryHash, text: 'x', status: 'pending' }))
  if (withAction) fs.writeFileSync(path.join(home, 'bili-whale', 'causal.jsonl'),
    JSON.stringify({ kind: 'action', atMs: Date.parse(d + 'T12:00:00+08:00') }) + '\n')
  return { home, drafts, day: d, dir }
}

function run(home, drafts, args = []) {
  const r = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { ...process.env, WHALE_HOME: home, DSH_HOME: home, WHALE_DRAFTS: drafts },
  })
  return r
}

test('未开窗拒绝', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'obsday-'))
  const r = run(home, path.join(home, 'drafts'))
  assert.equal(r.status, 2)
  assert.match(r.stderr, /未开窗/)
})

test('完整日：PASS 并写 observation-check.json/md', () => {
  const { home, drafts, day, dir } = makeHome()
  const r = run(home, drafts)
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(fs.existsSync(path.join(dir, 'observation-check.json')))
  assert.match(fs.readFileSync(path.join(dir, 'observation-check.md'), 'utf8'), /PASS/)
})

test('缺自然 action：FAIL', () => {
  const { home, drafts, dir } = makeHome({ withAction: false })
  const r = run(home, drafts)
  assert.equal(r.status, 1)
  assert.match(fs.readFileSync(path.join(dir, 'observation-check.md'), 'utf8'), /FAIL/)
})

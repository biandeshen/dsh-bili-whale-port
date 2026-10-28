import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

function sh(script, args, env) {
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts', script), ...args], { env, encoding: 'utf8', timeout: 120000 })
}

test('C2 arm/verify：≥8h 跨日才 PASS；只 arm 不放宽 day-report；verify 后才生效', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'c2test-'))
  const control = path.join(home, 'bili-whale', 'control')
  const drafts = path.join(home, 'drafts')
  fs.mkdirSync(control, { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(home, 'bili-whale', 'fields.json'), JSON.stringify({ fields: {}, lastAppliedAt: new Date().toISOString(), chain: [], memories: [], npcState: { current: 'normal' }, schemaVersion: 2 }))
  fs.writeFileSync(path.join(control, 'life.json'), JSON.stringify({ day: '2026-10-27', actionsToday: 2, lastActionAt: Date.now() - 3600_000, lastCheckAt: Date.now(), lastKind: 'explore' }))

  const env = { ...process.env, WHALE_HOME: home, WHALE_DRAFTS: drafts }
  assert.equal(sh('c2-offline.mjs', ['arm'], env).status, 0)

  // 造两天的完整证据
  const days = ['2026-10-26', '2026-10-27']
  const diary = '## 2026-10-26\n\n## 想说\n\n- 离线前。\n'
  fs.writeFileSync(path.join(home, 'whale-diary.md'), diary)
  const diaryHash = crypto.createHash('sha1').update(diary).digest('hex')
  for (const d of days) {
    const dir = path.join(home, 'bili-whale', 'days', d)
    fs.mkdirSync(dir, { recursive: true })
    const snap = { at: `${d}T09:00:00+08:00`, day: d, diary: { present: true, hash: diaryHash } }
    fs.writeFileSync(path.join(dir, 'state.start.json'), JSON.stringify(snap))
    fs.writeFileSync(path.join(dir, 'state.end.json'), JSON.stringify(snap))
    fs.writeFileSync(path.join(dir, 'ticks.jsonl'), JSON.stringify(snap) + '\n' + JSON.stringify(snap) + '\n')
    fs.writeFileSync(path.join(dir, 'day.json'), JSON.stringify({ day: d, tickCount: 2, wakes: 1, flags: { missed: true, late: true, tainted: false, taintReasons: [] } }))
    fs.writeFileSync(path.join(dir, 'expected.json'), JSON.stringify({ allowFlags: ['missed', 'late', 'tick-gap'], requiresC2Result: true, reason: 'test' }))
    fs.writeFileSync(path.join(drafts, `${d}.json`), JSON.stringify({ id: `d-${d}`, date: d, diaryHash, text: 'x', status: 'pending' }))
  }

  // 只 arm：expected.json 不放宽
  assert.equal(sh('day-report.mjs', ['--date', '2026-10-27'], env).status, 1)

  // 伪造一次「跨过 04:00 且 ≥8h」的 arm：从最近一次日界往前推 9h。
  // 固定 21h 前会随时间翻转（凌晨跑时区间里没有 04:00），这里按日界锚定。
  const boundary = new Date()
  boundary.setHours(4, 0, 0, 0)
  if (boundary.getTime() > Date.now()) boundary.setDate(boundary.getDate() - 1)
  const cfg = JSON.parse(fs.readFileSync(path.join(control, 'c2.json'), 'utf8'))
  cfg.armedAt = new Date(boundary.getTime() - 9 * 3600_000).toISOString()
  cfg.expectedDays = days
  fs.writeFileSync(path.join(control, 'c2.json'), JSON.stringify(cfg))

  const verify = sh('c2-offline.mjs', ['verify', '--skip-health'], env)
  assert.equal(verify.status, 0, verify.stdout + verify.stderr)
  assert.equal(JSON.parse(fs.readFileSync(path.join(control, 'c2-result.json'), 'utf8')).ok, true)
  assert.equal(JSON.parse(fs.readFileSync(path.join(control, 'canary.json'), 'utf8')).C2.status, 'pass')

  // verify 之后，expected.json 才生效
  assert.equal(sh('day-report.mjs', ['--date', '2026-10-27'], env).status, 0)

  fs.rmSync(home, { recursive: true, force: true })
})

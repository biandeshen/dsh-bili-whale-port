// scripts/ops-day.mjs —— 一天例行只读汇总的三种退出码
// 真子进程 + 真临时目录（pid 文件/草稿/因果账本/待审令牌都是真文件）；
// 进程判定用测试自己的 process.pid 写进假 pid 文件，不 spawn 真 Cortico；
// 端口用测试自己起的本地监听器占位，全程不打 B站、不发 HTTP。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'ops-day.mjs')
const today = () => new Date().toLocaleDateString('sv-SE')
const DEAD_PID = 999999

/** 造一个"一切都好"的沙箱，按需删改某一项来触发不同退出码。 */
async function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-day-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const whale = path.join(home, '.dsh')
  const control = path.join(whale, 'bili-whale', 'control')
  const drafts = path.join(home, 'drafts')
  const day = today()
  fs.mkdirSync(path.join(control, 'pending'), { recursive: true })
  fs.mkdirSync(path.join(whale, 'bili-whale', 'days', day), { recursive: true })
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(control, 'cortico.pid'), String(process.pid) + '\n')
  fs.writeFileSync(path.join(control, 'day-watchdog.pid'), String(process.pid) + '\n')
  fs.writeFileSync(path.join(whale, 'bili-whale', 'causal.jsonl'), [
    { at: new Date().toISOString(), kind: 'action', atMs: Date.now() - 60000 },
    { at: new Date().toISOString(), kind: 'inbound', key: 'k1', chars: 12, atMs: Date.now() - 50000 },
    { at: new Date().toISOString(), kind: 'dm-out', toMid: '222', day, charLen: 18, atMs: Date.now() - 40000 },
    { at: new Date().toISOString(), kind: 'diary', book: 'public', heading: '看过', chars: 90, atMs: Date.now() - 30000 },
  ].map((e) => JSON.stringify(e)).join('\n') + '\n')
  fs.writeFileSync(path.join(drafts, day + '.json'), JSON.stringify({
    id: 'dyn-' + day.replace(/-/g, '') + '-abc123', date: day, status: 'sent', degraded: false,
    voice: { mood: { label: '雀跃', intensity: 0.6, cause: '主人回了私信' } },
    result: { ok: true, dynId: '234567890123456789' },
  }) + '\n')
  fs.writeFileSync(path.join(control, 'pending', 'ack-1.json'), JSON.stringify({
    id: 'ack-1', used: false, expiresAt: new Date(Date.now() + 2 * 3600_000).toISOString(), payload: { draftId: 'dyn-x' },
  }) + '\n')
  fs.writeFileSync(path.join(whale, 'bili-whale', 'days', day, 'ticks.jsonl'), JSON.stringify({ at: new Date().toISOString() }) + '\n')
  fs.writeFileSync(path.join(whale, 'bili-whale', 'days', day, 'state.end.json'), JSON.stringify({ at: new Date().toISOString(), fields: { mood: 0.6 } }) + '\n')
  fs.writeFileSync(path.join(whale, 'whale-diary.md'), '# 公开日记\n\n## ' + day + '\n\n### 看过\n\n今天看了条鱼。\n')
  const server = net.createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((r) => server.once('close', r).close()))
  const port = server.address().port
  const run = (extra = []) => spawnSync(process.execPath, [SCRIPT, ...extra, '--port', String(port)], {
    encoding: 'utf8', timeout: 30000,
    env: { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: whale, WHALE_HOME: whale, WHALE_DRAFTS: drafts },
  })
  return { home, whale, control, drafts, day, run }
}

test('一切都齐 → 退出 0，且 K4 三条都给得出可算值', async (t) => {
  const s = await sandbox(t)
  const r = s.run(['--json'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.exit, 0)
  assert.equal(j.fatal, 0)
  assert.equal(j.watch, 0, '不该有拦项：' + JSON.stringify(j.rows.filter((x) => x.level !== 'ok')))
  const k = (p) => j.rows.find((x) => x.name.startsWith(p))
  assert.match(k('K4-1').detail, /来=1 回=1/)
  assert.match(k('K4-2').detail, /雀跃/)
  assert.match(k('K4-3').detail, /最新小节就是今天/)
})

test('pid 文件指向死进程 → 退出 2（进程死是硬伤）', async (t) => {
  const s = await sandbox(t)
  fs.writeFileSync(path.join(s.control, 'cortico.pid'), String(DEAD_PID) + '\n')
  const r = s.run(['--json'])
  assert.equal(r.status, 2, r.stdout + r.stderr)
  const j = JSON.parse(r.stdout)
  assert.ok(j.fatal >= 1)
  assert.match(j.rows.find((x) => x.name === 'Cortico 进程').detail, /dead/)
})

test('人活着但今天没稿、账本读不到 → 退出 1，K4 说清缺什么', async (t) => {
  const s = await sandbox(t)
  fs.rmSync(path.join(s.drafts, s.day + '.json'))
  fs.writeFileSync(path.join(s.whale, 'bili-whale', 'causal.jsonl'), '')
  const r = s.run()
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stdout, /今天的稿.*MISSING/)
  assert.match(r.stdout, /K4-1 私信有来有回.*缺：/)
  assert.match(r.stdout, /K4-2 稿子情绪对得上.*缺：今天没有稿/)
  assert.ok(!/看起来正常|一切正常/.test(r.stdout), '不许把缺项说成正常')
})

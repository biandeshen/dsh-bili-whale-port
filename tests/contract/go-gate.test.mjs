// go-gate 契约：公开表达类写操作（评论/弹幕）--go 进待审队列；panel 放行重放 argv+--go
// 2026-10-31 分级放开：收藏/点赞改自发档、回主人私信直发——不在此列（见 tests/perm-tier.test.mjs）
process.env.BILI_TRAFFIC_TEST = '1'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const _env = { u: process.env.USERPROFILE, h: process.env.HOME, d: process.env.DSH_HOME, n: process.env.DSH_NODE, b: process.env.BILI_TRAFFIC_TEST }
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'go-gate-'))
process.env.USERPROFILE = home
process.env.HOME = home
process.env.DSH_HOME = path.join(home, 'whale')
process.env.DSH_NODE = process.execPath
fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'x'.repeat(32), bili_jct: 'a'.repeat(32), buvid3: '0BE6296B-F60E-ABAF-24FD-2D4F1619E79785121infoc' }))
// 凭据留旧家，其余状态写新家（DSH_HOME/bili-ai）—— 见 tools/lib/paths.mjs 的归一规则
const STATE = path.join(home, 'whale', 'bili-ai')
fs.mkdirSync(STATE, { recursive: true })
const PENDING = path.join(STATE, 'pending-replies.json')
const run = (file, args) => spawnSync(process.execPath, [path.join(ROOT, file), ...args], { encoding: 'utf8', timeout: 20000 })
const items = () => { try { return JSON.parse(fs.readFileSync(PENDING, 'utf8')).items ?? [] } catch { return [] } }
const REQ = () => { const p = path.join(home, 'requests.jsonl'); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '' }

test('普通评论 --go 进待审，不发网络请求', () => {
  const r = run('tools/commands/comment.mjs', ['--oid', '1', '--bvid', 'BV1234567890', '--message', 'hello', '--go'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(REQ(), '', '不得发出任何请求')
  const it = items().at(-1)
  assert.equal(it.kind, '评论'); assert.equal(it.argv[0], 'comment'); assert.ok(!it.argv.includes('--go'))
})
test('收藏 --go 不进待审（2026-10-31 分级放开：自发档），五判据仍然强制', () => {
  const before = items().length
  const r = run('tools/commands/fav.mjs', ['BV1234567890', '--reason', '想留着', '--go'])
  // 不入队、也不放行：理由太短在判据层就被拒（exit 3，发生在任何网络请求之前）
  assert.equal(r.status, 3, r.stderr)
  assert.match(r.stderr, /理由太短/)
  assert.equal(items().length, before, 'fav --go 不得再进待审队列')
  assert.equal(REQ(), '', '判据拒了就不该发请求')
})
test('弹幕 send --go 进待审', () => {
  const r = run('tools/commands/danmaku.mjs', ['send', '--room', '999', '--msg', 'hi', '--go'])
  assert.equal(r.status, 0, r.stderr)
  const it = items().at(-1)
  assert.equal(it.kind, '弹幕'); assert.equal(it.argv[0], 'danmaku')
})
test('分享链路不受闸影响（--share --auto 直发，由既有评分闸管）', () => {
  const env = { ...process.env, TEST_REQUESTS: path.join(home, 'requests-share.jsonl'), NODE_OPTIONS: '--import=' + pathToFileURL(path.join(ROOT, 'tests/helpers/mock-fetch.mjs')).href }
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/commands/comment.mjs'), '--oid', '2', '--bvid', 'BV1234567890', '--message', '好', '--share', '--auto', '--go'], { env, encoding: 'utf8', timeout: 20000 })
  assert.notEqual(r.status, 0, '无评分仍须被既有闸拒绝')
  assert.equal(fs.existsSync(env.TEST_REQUESTS) ? fs.readFileSync(env.TEST_REQUESTS, 'utf8') : '', '')
})
test('panel approve 对 go-gate 项重放 argv 并补 --go', async () => {
  const seeded = { id: 'gate1', at: new Date().toISOString(), kind: '评论', who: '评论', src: '', message: 'hi', oid: '1', bvid: 'BV1', argv: ['comment', '--oid', '1', '--message', 'hi'] }
  fs.writeFileSync(PENDING, JSON.stringify({ items: [seeded] }))
  const calls = []
  const { makeRoutes } = await import(pathToFileURL(path.join(ROOT, 'core/api/routes.js')).href)
  const { routes } = makeRoutes({
    cfgFile: path.join(home, 'whale', 'bili-whale.config.json'), credFile: path.join(home, '.bili-ai', 'credentials.json'),
    toolsRoot: ROOT, home, whaleHome: path.join(home, 'whale'),
    getSchedStatus: () => ({ ok: true }), execNode: (args, o, cb) => { if (args.includes('take')) return cb(null, JSON.stringify(seeded), ''); calls.push(args); cb(null, 'code=0 rpid=1', '') },
    fetch: async () => ({ json: async () => ({}) }),
  })
  const { readBody } = await import(pathToFileURL(path.join(ROOT, 'core/api/support.js')).href)
  const body = JSON.stringify({ id: 'gate1' })
  const req = { method: 'POST', headers: { host: '127.0.0.1' }, destroy() {} }
  req.on = (ev, cb) => { if (ev === 'data') cb(Buffer.from(body)); if (ev === 'end') cb() }
  const res = { statusCode: 0, writeHead() {}, end(t) { this.body = t } }
  await routes['/dsh-bili/api/pending/approve'](req, res)
  const out = JSON.parse(res.body)
  assert.equal(out.ok, true, res.body)
  assert.deepEqual(calls.at(-1).slice(1, 3), ['comment', '--oid'])
  assert.equal(calls.at(-1).at(-1), '--go')
})

// 恢复进程级 env，避免污染同进程的后续测试文件
test.after(() => { process.env.USERPROFILE = _env.u; process.env.HOME = _env.h; process.env.DSH_HOME = _env.d; process.env.DSH_NODE = _env.n; process.env.BILI_TRAFFIC_TEST = _env.b })

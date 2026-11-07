// 契约测试：makeRoutes 的宿主无关面（dsh adapter 与 whale-panel 都必须只靠这张表工作）
// 冻结三件事：① 路由清单 ② 配置写白名单 ③ scheduler 状态经 getSchedStatus 并源（缺口①的规避契约）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { makeRoutes } from '../../core/api/routes.js'
import { KNOWN_CONFIG_KEYS } from '../../core/api/support.js'

function sandbox() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'whale-contract-'))
  const whaleHome = path.join(home, 'whale')
  fs.mkdirSync(whaleHome, { recursive: true })
  fs.mkdirSync(path.join(home, '.bili-ai'))
  return { home, whaleHome, cfgFile: path.join(whaleHome, 'bili-whale.config.json') }
}

function makeRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, h) { this.statusCode = code; this.headers = h },
    end(t) { this.body = t },
    json() { return JSON.parse(this.body) },
  }
}

async function call(handler, { method = 'POST', body = {}, host = '127.0.0.1' } = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.headers = { host }
  const res = makeRes()
  await handler(req, res)
  return res
}

function setup() {
  const s = sandbox()
  const calls = []
  let schedStatus = { ok: false, reason: '未初始化', at: null }
  const fakeExecNode = (args, opts, cb) => { calls.push(args); cb(null, JSON.stringify({ ok: true, items: [{ name: 'B站 cookie', detail: '已登录：小鱼（mid 999）' }] }), '') }
  const { routes } = makeRoutes({
    cfgFile: s.cfgFile, credFile: path.join(s.home, '.bili-ai', 'credentials.json'),
    toolsRoot: path.resolve(import.meta.dirname, '..'),
    home: s.home, whaleHome: s.whaleHome,
    getSchedStatus: () => schedStatus, execNode: fakeExecNode,
    fetch: async () => ({ json: async () => ({ data: { isLogin: false } }) }),
    onConfigSaved: (changed) => calls.push(['invalidate', changed]),
  })
  return { s, routes, calls, setSched: (v) => { schedStatus = v } }
}

test('路由清单与 docs/BASELINE.md 冻结一致（9 条）', () => {
  const { routes } = setup()
  assert.deepEqual(Object.keys(routes).sort(), [
    '/dsh-bili/api/cookie', '/dsh-bili/api/deps', '/dsh-bili/api/notify-test',
    '/dsh-bili/api/pending', '/dsh-bili/api/pending/approve', '/dsh-bili/api/pending/reject',
    '/dsh-bili/api/persona', '/dsh-bili/api/settings', '/dsh-bili/api/status',
  ])
})

test('配置写只认白名单，未知键丢弃；night 变更触发 invalidate', async () => {
  const { s, routes, calls } = setup()
  const h = routes['/dsh-bili/api/settings']
  const res = await call(h, { body: { night: { windows: [{ start: '21:00', end: '23:00', wakes: 2 }], skipChance: 0.5 }, hacker: { evil: 1 }, quota: { shareDaily: 5 } } })
  assert.equal(res.json().ok, true)
  const written = JSON.parse(fs.readFileSync(s.cfgFile, 'utf8'))
  assert.equal(written.hacker, undefined, '白名单外键必须被丢弃')
  assert.equal(written.night.windows[0].start, '21:00')
  assert.equal(written.quota.shareDaily, 5)
  assert.ok(calls.some(c => c[0] === 'invalidate' && c[1] === true), 'windows 变更须报 schedulingChanged=true')
})

test('缺口①：deps 的 scheduler 一律来自 getSchedStatus 并源，非回环 403', async () => {
  const { routes, setSched } = setup()
  setSched({ ok: true, reason: '已启动（每 60 秒 tick）', at: 'x' })
  const res = await call(routes['/dsh-bili/api/deps'], { method: 'GET' })
  assert.equal(res.json().scheduler.ok, true)
  const denied = await call(routes['/dsh-bili/api/settings'], { host: '192.168.1.9:8441', body: {} })
  assert.equal(denied.statusCode, 403)
})

test('KNOWN 白名单与 BASELINE 文档逐字对账', () => {
  /**
   * 2026-11-07 文档体制改制后基线件按原日期进 attic（只搬不改写）。这条锁的是
   * **已退役的 legacy HTTP 面**（8447/8448）的白名单与当年冻结的基线一致——specs 不接管退役面，
   * 所以这里读的就是 attic 里那份原文件：当作对账凭证可以，当作施工依据不行（见 docs/INDEX.md）。
   */
  const doc = fs.readFileSync(path.resolve(import.meta.dirname, '../../docs/attic/2026-10/BASELINE.md'), 'utf8')
  for (const k of KNOWN_CONFIG_KEYS) assert.ok(doc.includes(k), `BASELINE.md 缺 ${k}`)
})

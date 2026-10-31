// M1e 审批加固契约：① 放行按 kind 重建 argv（审批对象=执行对象）
// ② 动态草稿令牌绑定 draftId+正文哈希（审完改稿拒发）
// ③ list 默认不打印完整 token，--show-token 才显示单条
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { rebuildApproveArgs } from '../../tools/lib/go-rebuild.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')
const DRAFTS = fs.mkdtempSync(path.join(os.tmpdir(), 'm1e-drafts-'))
const WHALE = fs.mkdtempSync(path.join(os.tmpdir(), 'm1e-whale-'))
process.env.WHALE_DRAFTS = DRAFTS
process.env.DSH_HOME = WHALE
fs.mkdirSync(path.join(WHALE, 'bili-whale', 'control'), { recursive: true })

const { makeDraft } = await import('../../scripts/draft-dynamic.mjs')
const { approve } = await import('../../scripts/dynamic-approve.mjs')
const ack = await import('../../scripts/ack.mjs')

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex')
function enqueue(draft) {
  const it = ack.enqueue(WHALE, { draftId: draft.id, date: draft.date, textHash: draft.textHash })
  draft.ackId = it.id
  fs.writeFileSync(path.join(DRAFTS, draft.date + '.json'), JSON.stringify(draft))
  return it
}
const fakeRun = () => ({ status: 0, stdout: 'dyn_id=9', stderr: '' })

// ── ① rebuild：白名单 + 展示=执行 ──────────────────────────────────────────

test('M1e：白名单外旗标（--share/--force 等）直接拒，不重放', () => {
  for (const evil of ['--share', '--force', '--auto', '--evil']) {
    const r = rebuildApproveArgs({ kind: '评论', argv: ['comment', '--oid', '1', '--message', 'hi', evil], oid: '1', message: 'hi' })
    assert.equal(r.ok, false, evil + ' 应被拒')
    assert.match(r.error, /白名单外旗标/)
  }
})

test('M1e：未知 kind 不给重放（模型换子命令无效）', () => {
  const r = rebuildApproveArgs({ kind: '注入', argv: ['dynamic-image', '--image', 'x.png', '--text', 'y'] })
  assert.equal(r.ok, false)
  assert.match(r.error, /未知类型/)
})

test('M1e：展示的 message/oid 覆盖 argv 里的同名值（执行=主人看到的）', () => {
  const r = rebuildApproveArgs({
    kind: '评论', argv: ['comment', '--oid', '1', '--message', 'argv里的版本', '--root', '5'],
    oid: '1', message: '面板显示的版本', root: '5',
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.args, ['comment', '--oid', '1', '--root', '5', '--message', '面板显示的版本'])
})

test('M1e：坐标非法/消息以 -- 开头 → 拒', () => {
  assert.equal(rebuildApproveArgs({ kind: '评论', argv: ['comment', '--oid', 'abc', '--message', 'hi'], oid: 'abc', message: 'hi' }).ok, false)
  assert.equal(rebuildApproveArgs({ kind: '评论', argv: ['comment', '--oid', '1', '--message', '--go'], oid: '1', message: '--go' }).ok, false)
  assert.equal(rebuildApproveArgs({ kind: '评论', argv: ['comment', '--message', 'hi'] }).ok, false)
})

test('M1e：收藏/弹幕 重建', () => {
  const fav = rebuildApproveArgs({ kind: '收藏', argv: ['fav', 'BV1x', '--reason', '留着'], bvid: 'BV1x', message: '留着' })
  assert.equal(fav.ok, true)
  assert.deepEqual(fav.args, ['fav', 'BV1x', '--reason', '留着'])

  const dm = rebuildApproveArgs({ kind: '弹幕', argv: ['danmaku', 'send', '--room', '999', '--msg', 'hi'], src: 'room 999', message: 'hi' })
  assert.equal(dm.ok, true)
  assert.deepEqual(dm.args, ['danmaku', 'send', '--room', '999', '--msg', 'hi'])

  // 队列 src 与 argv 房间号不一致 → 执行 src（展示给主人看的是 src）
  const mismatch = rebuildApproveArgs({ kind: '弹幕', argv: ['danmaku', 'send', '--room', '111', '--msg', 'hi'], src: 'room 999', message: 'hi' })
  assert.equal(mismatch.ok, true)
  assert.ok(mismatch.args.includes('999') && !mismatch.args.includes('111'))
})

test('M1e：referer 只允许 bilibili.com', () => {
  const bad = rebuildApproveArgs({ kind: '评论', argv: ['comment', '--oid', '1', '--message', 'hi', '--referer', 'https://evil.example/x'], oid: '1', message: 'hi' })
  assert.equal(bad.ok, false)
  const ok = rebuildApproveArgs({ kind: '评论', argv: ['comment', '--oid', '1', '--message', 'hi', '--referer', 'https://t.bilibili.com/1'], oid: '1', message: 'hi' })
  assert.equal(ok.ok, true)
})

// ── ② 动态草稿：令牌绑定 draftId + 正文哈希 ────────────────────────────────

test('M1e：入队后改稿 → go 拒发，且不烧掉令牌', async () => {
  const d = makeDraft({ date: '2026-10-31', diaryText: 'x', image: 'D:/x1.png', text: '入队时的正文' })
  const it = enqueue(d)
  const file = path.join(DRAFTS, '2026-10-31.json')
  const tampered = JSON.parse(fs.readFileSync(file, 'utf8'))
  tampered.text = '入队后被改的正文'
  fs.writeFileSync(file, JSON.stringify(tampered))
  const r = await approve({ id: d.id, token: it.token, go: true, runner: fakeRun })
  assert.equal(r.ok, false)
  assert.match(r.error, /入队后被改过/)
  // 拒在 ack.approve 之前 → 令牌未消耗，可查证
  const still = ack.listPending(WHALE).find((x) => x.id === it.id)
  assert.ok(still, '令牌应仍未被消耗')
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).status, 'pending')
})

test('M1e：令牌 draftId 与草稿不匹配 → 拒发', async () => {
  const d = makeDraft({ date: '2026-11-01', diaryText: 'x', image: 'D:/x2.png', text: '另一个草稿' })
  const it = ack.enqueue(WHALE, { draftId: 'not-this-draft', date: d.date, textHash: d.textHash })
  d.ackId = it.id
  fs.writeFileSync(path.join(DRAFTS, '2026-11-01.json'), JSON.stringify(d))
  const r = await approve({ id: d.id, token: it.token, go: true, runner: fakeRun })
  assert.equal(r.ok, false)
  assert.match(r.error, /令牌与草稿不匹配/)
})

test('M1e：未改动的稿 + 正确 token → 正常放行（绑定不误伤正常流）', async () => {
  const d = makeDraft({ date: '2026-11-02', diaryText: 'x', image: 'D:/x3.png', text: '原样未改' })
  const it = enqueue(d)
  const r = await approve({ id: d.id, token: it.token, go: true, runner: fakeRun })
  assert.equal(r.ok, true)
  assert.equal(r.status, 'sent')
})

// ── ③ list 默认不打印 token ───────────────────────────────────────────────

test('M1e：dynamic-approve list 不吐完整 token，--show-token 才给单条', () => {
  const d = makeDraft({ date: '2026-11-03', diaryText: 'x', image: 'D:/x4.png', text: '看我藏不藏' })
  const it = enqueue(d)
  const cli = path.join(ROOT, 'scripts', 'dynamic-approve.mjs')
  const env = { ...process.env, DSH_HOME: WHALE, WHALE_DRAFTS: DRAFTS }
  const plain = spawnSync(process.execPath, [cli, 'list'], { env, encoding: 'utf8', timeout: 30000 })
  assert.equal(plain.status, 0, plain.stderr)
  assert.ok(!plain.stdout.includes(it.token), '默认 list 不得包含完整 token')
  assert.match(plain.stdout, /已隐藏/)

  const show = spawnSync(process.execPath, [cli, 'list', '--show-token', d.id], { env, encoding: 'utf8', timeout: 30000 })
  assert.equal(show.status, 0, show.stderr)
  assert.ok(show.stdout.includes(it.token), '--show-token <id> 应给出该条完整 token')

  const showOther = spawnSync(process.execPath, [cli, 'list', '--show-token', 'dyn-nonexistent'], { env, encoding: 'utf8', timeout: 30000 })
  assert.ok(!showOther.stdout.includes(it.token), '指错 id 不得泄露别的令牌')
})

// ── ④ panel 端点：真走 routes，坏队列项必须 400 且一次执行都不发生 ────────
// 注意：routes → support → paths.mjs 会在模块初始化时读 env，
// 所以必须动态 import（静态 import 会被提升到上面的 DSH_HOME 赋值之前）。
import { Readable } from 'node:stream'

function makeRes() {
  return {
    statusCode: 0, headers: null, body: '',
    writeHead(code, h) { this.statusCode = code; this.headers = h },
    end(t) { this.body = t },
    json() { return JSON.parse(this.body) },
  }
}

async function callRoute(routes, body) {
  const req = Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = 'POST'
  req.headers = { host: '127.0.0.1' }
  const res = makeRes()
  await routes['/dsh-bili/api/pending/approve'](req, res)
  return res
}

async function routeSetup(queuedItem) {
  const { makeRoutes } = await import('../../core/api/routes.js')
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'm1e-panel-'))
  const whaleHome = path.join(home, 'whale')
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'pending-replies.json'), JSON.stringify({ items: [queuedItem] }))
  const execs = []
  const fakeExec = (args, opts, cb) => {
    if (args.includes('reply-draft')) { cb(null, JSON.stringify(queuedItem), ''); return }
    execs.push(args)
    cb(null, 'code=0 rpid=7', '')
  }
  const { routes } = makeRoutes({
    cfgFile: path.join(whaleHome, 'bili-whale.config.json'),
    credFile: path.join(home, '.bili-ai', 'credentials.json'),
    toolsRoot: ROOT, home, whaleHome,
    getSchedStatus: () => ({ ok: false, reason: 't', at: null }),
    execNode: fakeExec,
    fetch: async () => ({ json: async () => ({ data: { isLogin: false } }) }),
    onConfigSaved: () => {},
  })
  return { routes, execs }
}

test('M1e：panel 放行——白名单外 argv → 400，且从不真的执行', async () => {
  const { routes, execs } = await routeSetup({
    id: 'evil1', kind: '评论', who: 'x', message: 'hi',
    oid: '1', bvid: '', argv: ['comment', '--oid', '1', '--message', 'hi', '--share'],
  })
  const res = await callRoute(routes, { id: 'evil1' })
  assert.equal(res.statusCode, 400)
  assert.match(res.json().error, /拒绝放行/)
  assert.equal(execs.length, 0, '拒绝时不得发生任何发送执行')
})

test('M1e：panel 放行——正常项按重建 args 执行（展示 message=执行 message）', async () => {
  const { routes, execs } = await routeSetup({
    id: 'ok1', kind: '评论', who: 'x', message: '面板显示的正文',
    oid: '42', bvid: 'BV1a2b3c4', root: '9', parent: '8',
    argv: ['comment', '--oid', '42', '--message', 'argv里的旧正文', '--root', '9', '--parent', '8', '--bvid', 'BV1a2b3c4'],
  })
  const res = await callRoute(routes, { id: 'ok1' })
  assert.equal(res.statusCode, 200)
  assert.equal(res.json().ok, true)
  assert.equal(execs.length, 1)
  const run = execs[0].map(String)
  assert.ok(run.includes('面板显示的正文'), '执行必须用展示的 message')
  assert.ok(!run.includes('argv里的旧正文'), '不得执行队列 argv 里的旧正文')
  assert.ok(run.includes('--go') && run.includes('comment'))
  assert.ok(!run.includes('--share'))
})

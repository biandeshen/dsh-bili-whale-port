// feed 真排除已看项（f-a2142e，2026-11-01 意见箱）：
// 已看名单三源 = 日记 + 评论审计表 + fields.json 近 7 天观看记录。以前第三源没接进来，
// 她 debrief 看完的片子第二天又被当新候选排第一。这里真跑 feed.mjs 子进程（网络打桩），
// 断言 stdout 里出现/不出现哪些 BV、快照文件的行与 seen 标记 —— 不是字符串 lint。
process.env.BILI_TRAFFIC_TEST = '1'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const MOCK = path.join(ROOT, 'tests', 'helpers', 'mock-fetch.mjs')

const NEW_BV = 'BVnew0000001'      // 全新候选（无观看记录）
const WATCH_BV = 'BVwatch00001'    // fields.json 昨天看过 → 默认应排除
const DIARY_BV = 'BVdiary00000'    // 日记「看过的」表里 → 默认应排除
const OLD_BV = 'BVold000000'       // fields.json 10 天前看过（窗外）→ 不排除，窗口是她立的线
const JUNK_BV = 'BVjunk000000'     // 播放 1 弹幕 0 → 质量下限丢弃（进快照 dropped 行）

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-seen-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const whale = path.join(home, 'whale')
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'x'.repeat(32), bili_jct: 'a'.repeat(32), buvid3: 'b'.repeat(32) }))
  fs.mkdirSync(path.join(whale, 'bili-whale'), { recursive: true })
  fs.writeFileSync(path.join(whale, 'whale-diary.md'), `## 看过的\n| 时间 | BV | 标题 |\n|---|---|---|\n| 2026-10-30 | ${DIARY_BV} | 旧雨声 |\n`)
  const at = (offsetDays) => new Date(Date.now() - offsetDays * 86400000).toISOString()
  fs.writeFileSync(path.join(whale, 'bili-whale', 'fields.json'), JSON.stringify({
    memories: [
      { createdAt: at(1), content: `看过《雷雨声助眠》（UP乙） —— ${WATCH_BV}` },
      { createdAt: at(10), content: `看过《很旧的雨声》（UP丙） —— ${OLD_BV}` },
    ],
  }))
  const cfg = path.join(whale, 'bili-whale.config.json')
  fs.writeFileSync(cfg, JSON.stringify({ preferences: { like: ['助眠雨声'], dislike: [] } }))
  const search = path.join(home, 'search.json')
  const row = (bvid, title, extra = {}) => ({ bvid, title, duration: '32:00', danmaku: 300, play: 5000, author: '测试UP', ...extra })
  fs.writeFileSync(search, JSON.stringify({ code: 0, data: { result: [
    row(NEW_BV, '深夜雨声助眠白噪音'), row(WATCH_BV, '雷雨声助眠合集'), row(DIARY_BV, '竹林雨声助眠'),
    row(OLD_BV, '旧雨声助眠重听'), row(JUNK_BV, '无人看的雨声助眠', { danmaku: 0, play: 1 }),
  ] } }))
  const req = path.join(home, 'requests.jsonl')
  const run = (extra = []) => spawnSync(process.execPath,
    ['--import', pathToFileURL(MOCK).href, path.join(ROOT, 'tools', 'commands', 'feed.mjs'), '--source=search', ...extra],
    { encoding: 'utf8', timeout: 30000, env: { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: whale, BILI_WHALE_CONFIG: cfg, BILI_TRAFFIC_TEST: '1', NODE_TEST_CONTEXT: '1', TEST_REQUESTS: req, TEST_SEARCH_FILE: search } })
  const snapshot = () => {
    const day = new Date().toLocaleDateString('sv-SE')
    return JSON.parse(fs.readFileSync(path.join(whale, 'bili-whale', 'feed', day + '.json'), 'utf8'))
  }
  return { home, whale, run, snapshot, requests: () => (fs.existsSync(req) ? fs.readFileSync(req, 'utf8') : '') }
}

test('默认排除已看项：日记/审计表/近 7 天观看记录三源都进 seen，快照里不留已看行', (t) => {
  const s = setup(t)
  const r = s.run()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /默认排除/)
  assert.match(r.stdout, new RegExp(NEW_BV), '新候选应保留')
  assert.ok(!r.stdout.includes(WATCH_BV), '近 7 天观看记录里的 BV 又被推出来了 —— 这正是 f-a2142e 报的坑')
  assert.ok(!r.stdout.includes(DIARY_BV), '日记「看过的」里的 BV 又被推出来了')
  assert.match(r.stdout, new RegExp(OLD_BV), '10 天前的观看在窗口外，按她的线不拦')
  const snap = s.snapshot()
  const rows = snap.rows.map((x) => x.bv)
  assert.ok(!rows.includes(WATCH_BV) && !rows.includes(DIARY_BV), '快照里混进了已看项')
  const junk = snap.rows.find((x) => x.bv === JUNK_BV)
  assert.ok(junk, '质量下限丢掉的应留在快照 dropped 行')
  assert.equal(junk.keep, false)
  assert.match(s.requests(), /wbi\/search\/type/, '搜索请求应真发出（走的是打桩）')
})

test('--allow-seen 显式放回：已看项回来并逐行标 [已看过]，快照行带 seen 标记', (t) => {
  const s = setup(t)
  const r = s.run(['--allow-seen'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /--allow-seen 显式放回/)
  const line = r.stdout.split(/\r?\n/).find((l) => l.includes(WATCH_BV))
  assert.ok(line && line.includes('[已看过]'), `已看项回来却没标注：${line}`)
  const seenRows = s.snapshot().rows.filter((x) => x.seen).map((x) => x.bv)
  assert.ok(seenRows.includes(WATCH_BV) && seenRows.includes(DIARY_BV), '快照没记录哪些是放回的已看项')
})

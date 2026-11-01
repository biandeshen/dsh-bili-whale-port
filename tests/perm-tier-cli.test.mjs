// 档位的**行为**测试（2026-11-01 挑刺席指出 perm-tier 只有"源码含 tierQueues(" 的文本 lint）：
// 真跑 like.mjs 子进程、真网络打桩、断言副作用文件与请求记录 —— 删掉 if 包的那层必须红。
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

function setup(tier) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'perm-cli-'))
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'x'.repeat(32), bili_jct: 'a'.repeat(32), buvid3: 'b'.repeat(32) }))
  const cfg = path.join(home, 'whale', 'bili-whale.config.json')
  fs.mkdirSync(path.dirname(cfg), { recursive: true })
  fs.writeFileSync(cfg, JSON.stringify({ permissions: { like: tier } }))
  const req = path.join(home, 'requests.jsonl')
  const run = (args) => spawnSync(process.execPath,
    ['--import', pathToFileURL(MOCK).href, path.join(ROOT, 'tools', 'commands', 'like.mjs'), ...args],
    {
      encoding: 'utf8', timeout: 30000,
      env: { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: path.join(home, 'whale'), BILI_WHALE_CONFIG: cfg, BILI_TRAFFIC_TEST: '1', NODE_TEST_CONTEXT: '1', TEST_REQUESTS: req },
    })
  const read = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
  return {
    run,
    requests: () => (fs.existsSync(req) ? fs.readFileSync(req, 'utf8') : ''),
    pending: () => read(path.join(home, 'whale', 'bili-ai', 'pending-replies.json'))?.items ?? [],
    likes: () => read(path.join(home, '.bili-ai', 'likes-sent.json'))?.items ?? [],
  }
}

test('like 默认 self 档：--go 真发出去，本地账 +1，不进待审队列', () => {
  const s = setup('self')
  const r = s.run(['BV1234567890', '--reason', '看完觉得好', '--go'])
  assert.equal(r.status, 0, r.stderr)
  assert.match(s.requests(), /archive\/like/, '自发档没发出请求，"直发"就是假的')
  assert.equal(s.likes().length, 1)
  assert.equal(s.pending().length, 0, 'self 档不得进待审队列')
})

test('like 档位收回 review：--go 进待审队列，一个请求都不发', () => {
  const s = setup('review')
  const r = s.run(['BV1234567890', '--reason', '看完觉得好', '--go'])
  assert.equal(r.status, 0, r.stderr)
  assert.equal(s.requests(), '', '档位收回后仍发请求 = 闸门失效')
  const it = s.pending().at(-1)
  assert.equal(it?.kind, '点赞')
  assert.ok(Array.isArray(it?.argv) && !it.argv.includes('--go'), '队列里存的是去掉 --go 的 argv')
})

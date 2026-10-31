// 私信出站事件（K4-1「私信有来有回」的前置）
// 真跑 tools/commands/dm.mjs 子进程 + tests/helpers/mock-fetch.mjs 打桩网络：
// 断言的是 causal.jsonl 里真的多了一条 dm-out（以及不该有的时候一条都不多），不是源码里有没有这行。
process.env.BILI_TRAFFIC_TEST = '1'
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const HERE = path.dirname(fileURLToPath(import.meta.url))
const today = () => new Date().toLocaleDateString('sv-SE')
const MSG = '今天这条是想跟你说的一句话'

/** 每轮一个干净沙箱：凭据 + owner 配置 + DSH_HOME（causal 落点）。 */
function sandbox(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dm-out-causal-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const dsh = path.join(home, '.dsh')
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.mkdirSync(dsh, { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'SESSDATA_FAKE_VALUE', bili_jct: 'a'.repeat(32), buvid3: 'buvid-fake' }))
  fs.writeFileSync(path.join(dsh, 'bili-whale.config.json'), JSON.stringify({ owner: { mid: '222', name: 'Owner' } }))
  const env = {
    ...process.env,
    USERPROFILE: home, HOME: home, DSH_HOME: dsh, WHALE_HOME: dsh,
    BILI_WHALE_CONFIG: path.join(dsh, 'bili-whale.config.json'),
    TEST_REQUESTS: path.join(home, 'requests.jsonl'),
    NODE_OPTIONS: '--import=' + pathToFileURL(path.join(HERE, 'helpers', 'mock-fetch.mjs')).href,
  }
  const causal = path.join(dsh, 'bili-whale', 'causal.jsonl')
  const dm = (args) => spawnSync(process.execPath, [path.join(ROOT, 'tools', 'commands', 'dm.mjs'), ...args], { env, encoding: 'utf8', timeout: 30000 })
  const events = () => fs.existsSync(causal)
    ? fs.readFileSync(causal, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : []
  return { env, home, causal, dm, events }
}

test('真发成功：causal 落且只落一条 dm-out，字段齐、不含正文与凭据', (t) => {
  const s = sandbox(t)
  const r = s.dm(['--msg', MSG, '--go'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const evs = s.events()
  assert.equal(evs.length, 1, '一次成功只追加一条：' + JSON.stringify(evs))
  const e = evs[0]
  assert.equal(e.kind, 'dm-out')
  assert.equal(e.toMid, '222')
  assert.equal(e.day, today())
  assert.equal(e.charLen, MSG.length)
  assert.ok(Number.isFinite(e.atMs) && e.atMs > 0, 'atMs 是 epoch 毫秒')
  assert.ok(!Number.isNaN(Date.parse(e.at)), 'at 是 ISO 时间')
  const raw = fs.readFileSync(s.causal, 'utf8')
  assert.ok(!raw.includes(MSG), '账本里不许有正文')
  for (const secret of ['SESSDATA_FAKE_VALUE', 'a'.repeat(32), 'buvid-fake', 'dev_id']) {
    assert.ok(!raw.includes(secret), `账本里不许有凭据/设备号：${secret}`)
  }
})

test('dry 预检通过：账本零新增', (t) => {
  const s = sandbox(t)
  const r = s.dm(['--msg', MSG, '--dry'])
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /\[dry\] 预检通过/)
  assert.equal(s.events().length, 0, 'dry 不是事件，一条都不许写')
  assert.equal(fs.existsSync(s.causal), false, 'dry 连文件都不该创建')
})

test('闸门拦下（今天已锁定别的收信人）：不产出 dm-out，只留 dm-blocked', (t) => {
  const s = sandbox(t)
  fs.writeFileSync(path.join(s.home, '.bili-ai', 'dm-quota.json'), JSON.stringify({ date: today(), count: 1, mid: '999' }))
  const r = s.dm(['--msg', MSG, '--go'])
  assert.equal(r.status, 4, r.stdout + r.stderr)
  const evs = s.events()
  assert.equal(evs.filter((e) => e.kind === 'dm-out').length, 0, '被拦下的不算发出去')
  assert.equal(evs.length, 1)
  assert.equal(evs[0].kind, 'dm-blocked')
  assert.equal(evs[0].reason, 'target-locked')
  assert.equal(evs[0].toMid, '222')
  assert.ok(!fs.readFileSync(s.causal, 'utf8').includes(MSG), '被拦的路径同样不落正文')
})

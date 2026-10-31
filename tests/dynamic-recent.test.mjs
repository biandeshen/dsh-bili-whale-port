// dynamic recent —— 按自然日期复核她发过的动态（2026-10-31 普查后补的发布复核入口）
// 全程走 mock-fetch：不打网络；页流按时间倒序，翻过目标日就停。
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
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'recent-home-'))
fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 's'.repeat(32), bili_jct: 'j'.repeat(32), buvid3: 'b' }))

// 用本地正午造 pub_time，任何时区的机器上 localDate 都落在想要的那天
const noon = (d) => Math.floor(new Date(`2026-${d}T12:00:00`).getTime() / 1000)
const FIX = {
  pages: {
    '': {
      items: [
        { id_str: '3001', pub_time: noon('10-30') + 3 * 3600, dynamic_type: 'DRAW', modules: { module_dynamic: { desc: { text: '今晚看的是《雨》。 晚风' } } } },
        { id_str: '3002', pub_time: noon('10-30'), dynamic_type: 'COMMON', modules: { module_dynamic: { desc: { text: '第二条\n换行要压平' } } } },
        { id_str: '2901', pub_time: noon('10-29'), dynamic_type: 'DRAW', modules: { module_dynamic: { desc: { text: '昨天的' } } } },
      ],
      offset: 'p1',
      has_more: true,
    },
    p1: {
      items: [{ id_str: '2701', pub_time: noon('10-27'), dynamic_type: 'DRAW', modules: { module_dynamic: { desc: { text: '更早' } } } }],
      offset: 'p2',
      has_more: true,
    },
  },
}

function run(extraArgs, fx = FIX) {
  const fxFile = path.join(home, 'space-' + Math.random().toString(36).slice(2) + '.json')
  fs.writeFileSync(fxFile, JSON.stringify(fx))
  const reqFile = path.join(home, 'req-' + path.basename(fxFile))
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'commands', 'dynamic.mjs'), 'recent', ...extraArgs], {
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      TEST_REQUESTS: reqFile,
      TEST_SPACE_FILE: fxFile,
      NODE_OPTIONS: '--import=' + pathToFileURL(path.join(HERE, 'helpers', 'mock-fetch.mjs')).href,
    },
  })
  const calls = fs.existsSync(reqFile) ? fs.readFileSync(reqFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).url) : []
  return { ...r, calls }
}

test('命中当天两条、翻到昨天即停：不请求第二页', () => {
  const r = run(['--date', '2026-10-30', '--json'])
  assert.equal(r.status, 0, r.stderr)
  const j = JSON.parse(r.stdout)
  assert.equal(j.ok, true)
  assert.deepEqual(j.items.map((x) => x.dyn_id), ['3001', '3002'])
  assert.match(j.items[1].text, /第二条 换行要压平/, '换行压成空格')
  assert.equal(j.count, 2)
  assert.equal(r.calls.filter((u) => u.includes('feed/space')).length, 1, '翻过目标日就停，不多翻页')
})

test('--n 1 截断；查没有的那天 = 翻页到更早后报「没查到」', () => {
  const capped = run(['--date', '2026-10-30', '--n', '1', '--json'])
  assert.equal(JSON.parse(capped.stdout).items.length, 1)
  const none = run(['--date', '2026-10-28'])
  assert.equal(none.status, 0, none.stderr)
  assert.match(none.stdout, /2026-10-28 没有查到/)
  assert.equal(none.calls.filter((u) => u.includes('feed/space')).length, 2, '10-28 要翻两页才遇到更早')
})

test('接口报错不当成功：code≠0 退出 6', () => {
  const bad = run(['--date', '2026-10-30', '--json'], { pages: { '': { __code: -352, items: [], offset: '', has_more: false } } })
  assert.equal(bad.status, 6)
  assert.match(bad.stderr, /code=-352/)
})

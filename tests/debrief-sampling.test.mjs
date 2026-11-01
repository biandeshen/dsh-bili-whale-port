// debrief 采样口径回执（f-a2142e）：同类视频实测采样比 1/3、1/20、1/49 都出现过，
// 以前"条/桶"密度不写口径 → 跨片不可比。现在 [采样口径] 行固定写明
// 采样数/标称总数/桶数/采样比，桶数 <15 直接标"密度不可横向比较"（她立的线写进回执）。
// 真跑 debrief.mjs 子进程（网络打桩 + --no-frames），断言回执文本与副作用。
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
const CLAIMED = 264807

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-sampling-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const whale = path.join(home, 'whale')
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'x'.repeat(32), bili_jct: 'a'.repeat(32), buvid3: 'b'.repeat(32) }))
  fs.mkdirSync(whale, { recursive: true })
  fs.writeFileSync(path.join(home, 'view.json'), JSON.stringify({
    code: 0, data: { aid: 12345, cid: 999, duration: 3600, title: '测试雷雨声', owner: { name: 'UP乙' },
      pic: 'https://i.example/cover.jpg', desc: '简介', tname: '睡眠 aids', stat: { view: 5000, like: 100, favorite: 10, coin: 5, danmaku: CLAIMED, reply: 20 } },
  }))
  const run = (points) => {
    const xml = '<?xml version="1.0" encoding="UTF-8"?><i>' +
      points.map(([sec, text], i) => `<d p="${sec},1,25,1699999999,0,0,${i + 1}">${text}</d>`).join('') + '</i>'
    const dan = path.join(home, 'danmaku.xml')
    fs.writeFileSync(dan, xml)
    const req = path.join(home, 'requests.jsonl')
    fs.rmSync(req, { force: true })
    const r = spawnSync(process.execPath,
      ['--import', pathToFileURL(MOCK).href, path.join(ROOT, 'tools', 'commands', 'debrief.mjs'), 'BV1test000001', '--no-frames'],
      { encoding: 'utf8', timeout: 60000, env: { ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: whale, BILI_TRAFFIC_TEST: '1', NODE_TEST_CONTEXT: '1', TEST_REQUESTS: req, TEST_VIEW_FILE: path.join(home, 'view.json'), TEST_DANMAKU_FILE: dan } })
    return { out: r.stdout + r.stderr, status: r.status, requests: () => (fs.existsSync(req) ? fs.readFileSync(req, 'utf8') : '') }
  }
  return { home, whale, run }
}

const lineOf = (out, prefix) => out.split(/\r?\n/).find((l) => l.includes(prefix)) ?? ''

test('桶数 <15：回执写明采样数/标称总数/桶数/采样比，并声明密度不可横向比较', (t) => {
  const s = setup(t)
  const r = s.run([[10.5, '雨好大'], [20, '打雷了'], [100, '困了'], [200, '快来了'], [215, '声音舒服'], [400, '晚安']])
  assert.equal(r.status, 0, r.out)
  const cal = lineOf(r.out, '[采样口径]')
  assert.equal(cal.includes('采样数 6') && cal.includes(`标称总数 ${CLAIMED}`) && cal.includes('桶数 5') && cal.includes('采样比 1/44135'), true, `采样口径行不完整：${cal}`)
  assert.match(r.out, /桶数 <15：条\/桶密度不可用于横向比较/)
  assert.match(r.requests(), /comment\.bilibili\.com/, '弹幕接口应真发出（走的是打桩）')
  // 副作用：shots 目录建了、封面下载失败被如实报告而不是静默
  assert.ok(fs.existsSync(path.join(s.whale, 'shots', 'covers')))
  assert.match(r.out, /封面下载失败/)
})

test('桶数 ≥15：口径行照写，但不再报"不可比较"', (t) => {
  const s = setup(t)
  const points = Array.from({ length: 40 }, (_, i) => [i * 30 + 5, `弹幕词${i}`])
  const r = s.run(points)
  assert.equal(r.status, 0, r.out)
  const cal = lineOf(r.out, '[采样口径]')
  assert.match(cal, /采样数 40 · 标称总数 264807 · 桶数 40 · 采样比 1\/6620/)
  assert.ok(!r.out.includes('不可用于横向比较'), '桶数够时不该报不可比较')
})

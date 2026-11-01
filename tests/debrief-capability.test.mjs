// debrief 两处 high（2026-11-01 意见箱）：
//   f-17767a：回执硬写「交给 read_image 看」，但她的工具清单里从来没有这个工具
//             → 她以为漏了能力，在十几轮日记里反复标「画面未核对」。现在按宿主传来的
//             BILI_VISION=1/0 如实标注，未传时用条件句，任何情况都不再假装工具存在。
//   f-54fb32：字幕落在工作区外的文件里，read_file 报 not found → 唯一能知道"它到底说了
//             什么"的通道等于没有。现在字幕正文直接内联进回执，文件只当留档。
// 真跑子进程（网络打桩 + --no-frames），断言回执文本。
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

const SUBS = Array.from({ length: 60 }, (_, i) => ({ from: i * 10, to: i * 10 + 9, content: `第${i + 1}句台词，内容够长以便占满预算并测试截断行为` }))

function setup(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'debrief-cap-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const whale = path.join(home, 'whale')
  fs.mkdirSync(path.join(home, '.bili-ai'), { recursive: true })
  fs.writeFileSync(path.join(home, '.bili-ai', 'credentials.json'), JSON.stringify({ sessdata: 'x'.repeat(32), bili_jct: 'a'.repeat(32), buvid3: 'b'.repeat(32) }))
  fs.mkdirSync(whale, { recursive: true })
  fs.writeFileSync(path.join(home, 'view.json'), JSON.stringify({
    code: 0, data: { aid: 12345, cid: 999, duration: 600, title: '测试片', owner: { name: 'UP甲' },
      pic: 'https://i.example/cover.jpg', desc: '简介', tname: '影视', stat: { view: 5000, like: 100, favorite: 10, coin: 5, danmaku: 100, reply: 20 } },
  }))
  fs.writeFileSync(path.join(home, 'player.json'), JSON.stringify({
    code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://subs.example/sub.json' }] } },
  }))
  fs.writeFileSync(path.join(home, 'subs.json'), JSON.stringify({ body: SUBS }))
  const dan = path.join(home, 'danmaku.xml')
  fs.writeFileSync(dan, '<?xml version="1.0" encoding="UTF-8"?><i>' +
    [[30, '开场'], [300, '中段'], [560, '结尾炸了']].map(([sec, text], i) => `<d p="${sec},1,25,1699999999,0,0,${i + 1}">${text}</d>`).join('') + '</i>')
  const run = (extraArgs = [], extraEnv = {}) => {
    const req = path.join(home, 'requests.jsonl')
    fs.rmSync(req, { force: true })
    const r = spawnSync(process.execPath,
      ['--import', pathToFileURL(MOCK).href, path.join(ROOT, 'tools', 'commands', 'debrief.mjs'), 'BV1test000001', '--no-frames', ...extraArgs],
      { encoding: 'utf8', timeout: 60000, env: {
        ...process.env, USERPROFILE: home, HOME: home, DSH_HOME: whale, BILI_TRAFFIC_TEST: '1', NODE_TEST_CONTEXT: '1',
        TEST_REQUESTS: req, TEST_VIEW_FILE: path.join(home, 'view.json'), TEST_DANMAKU_FILE: dan,
        TEST_PLAYER_FILE: path.join(home, 'player.json'), TEST_SUBTITLE_FILE: path.join(home, 'subs.json'),
        ...extraEnv } })
    return { out: r.stdout + r.stderr, status: r.status }
  }
  return { home, whale, run }
}

// 回执里绝不允许再出现"命令式地让她用某个工具"的写法
const IMPERATIVE = [/交给\s*read_image/, /用\s*read_image\s*看/]
const assertNoImperative = (out, tag) => {
  for (const re of IMPERATIVE) assert.ok(!re.test(out), `${tag}：回执仍在命令她用 read_image（${re}）`)
}

test('BILI_VISION=0：明说本会话没有读图工具，不再给不存在的指令', (t) => {
  const s = setup(t)
  const r = s.run([], { BILI_VISION: '0' })
  assert.equal(r.status, 0, r.out)
  assertNoImperative(r.out, 'VISION=0')
  assert.match(r.out, /没有读图工具/)
  assert.match(r.out, /画面未核对/)
  assert.ok(!r.out.includes('read_image'), 'VISION=0 时连工具名都不该出现（她没有这个名字的工具）')
})

test('BILI_VISION=1：有读图工具时才让她看', (t) => {
  const s = setup(t)
  const r = s.run([], { BILI_VISION: '1' })
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /本会话有读图工具/)
})

test('BILI_VISION 未传：用条件句，不假装能力存在', (t) => {
  const s = setup(t)
  const r = s.run([])
  assert.equal(r.status, 0, r.out)
  assertNoImperative(r.out, 'VISION 未传')
  assert.match(r.out, /工具清单里/)
})

test('字幕正文内联进回执，并写明内联/总数与预算（f-54fb32）', (t) => {
  const s = setup(t)
  const r = s.run(['--subs-chars', '600'])
  assert.equal(r.status, 0, r.out)
  assert.match(r.out, /字幕正文/)
  assert.ok(r.out.includes('第1句台词'), `字幕正文没内联：${r.out.slice(0, 300)}`)
  const line = r.out.split(/\r?\n/).find((l) => l.includes('内联') && l.includes('行'))
  assert.ok(/内联 \d+ 行/.test(line ?? ''), `没写清内联行数：${line}`)
  assert.match(r.out, /read_file 读不到|别去读这个文件/)
  assert.equal(r.out.includes('第60句台词'), false, '超出预算的行不该全量塞进回执')
  // 留档文件照写，只是不再是读取入口
  assert.ok(fs.existsSync(path.join(s.whale, 'shots', 'subs', 'BV1test000001-debrief.txt')))
})

test('--from/--to 只裁展示时段，字幕与热区都跟着窗口走（f-aec73f）', (t) => {
  const s = setup(t)
  const r = s.run(['--from', '08:00', '--to', '09:30'])
  assert.equal(r.status, 0, r.out)
  assert.ok(r.out.includes('结尾炸了'), '窗口内的热区弹幕应出现')
  assert.ok(!r.out.includes('开场'), '窗口外的热区弹幕不该出现')
  assert.ok(r.out.includes('第49句台词'), '窗口内的字幕应内联')
  assert.ok(!r.out.includes('第1句台词'), '窗口外的字幕不该内联')
})

test('--from/--to 写进展示窗口，采样口径仍按全片算', (t) => {
  const s = setup(t)
  const full = s.run([])
  const win = s.run(['--from', '8:00', '--to', '9:30'])
  assert.equal(win.status, 0, win.out)
  assert.match(win.out, /展示窗口 08:00–09:30/)
  const calOf = (out) => out.split(/\r?\n/).find((l) => l.includes('[采样口径]')) ?? ''
  const num = (s2) => (s2.match(/采样数 (\d+)/)?.[1] ?? '') + '/' + (s2.match(/标称总数 (\S+)/)?.[1] ?? '')
  assert.equal(num(calOf(win.out)), num(calOf(full.out)), '窗口不该改变采样口径')
  assert.match(calOf(win.out), /窗口只裁展示/)
})

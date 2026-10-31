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

// 真实响应形状：epoch 秒在 modules.module_author.pub_ts；pub_time 是「昨天 17:07」这类显示串
const noon = (d) => Math.floor(new Date(`2026-${d}T12:00:00`).getTime() / 1000)
const item = (id, d, extraS, type, text) => ({
  id_str: id,
  dynamic_type: type,
  modules: { module_author: { pub_ts: noon(d) + extraS, pub_time: '昨天 17:07' }, module_dynamic: { desc: { text } } },
})
const FIX = {
  pages: {
    '': {
      items: [
        item('3001', '10-30', 3 * 3600, 'DRAW', '今晚看的是《雨》。 晚风'),
        item('3002', '10-30', 0, 'COMMON', '第二条\n换行要压平'),
        item('2901', '10-29', 0, 'DRAW', '昨天的'),
      ],
      offset: 'p1',
      has_more: true,
    },
    p1: {
      items: [item('2701', '10-27', 0, 'DRAW', '更早')],
      offset: 'p2',
      has_more: true,
    },
  },
}

function run(extraArgs, fx = FIX, extraEnv = {}) {
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
      ...extraEnv,
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

// ── 批次③：正文取位（纯文字 / 带图嵌 JSON 字符串 / 只有段落的 DRAW / 全落空） ──
const at = (extraS) => noon('10-30') + extraS
const TYPE_FX = {
  pages: {
    '': {
      items: [
        // 纯文字稿：正文在顶层 description
        { id_str: '4001', dynamic_type: 'DYNAMIC_TEXT', description: '纯文字稿：今天风很大', modules: { module_author: { pub_ts: at(0) } } },
        // 带图稿：正文嵌在 item.dynamic 这段 JSON 字符串里
        { id_str: '4002', dynamic_type: 'DRAW', dynamic: JSON.stringify({ item: { description: '带图稿：嵌在 dynamic 字符串里的正文' } }), modules: { module_author: { pub_ts: at(60) } } },
        // DRAW 的另一种：新版卡片只有段落
        { id_str: '4003', dynamic_type: 'DRAW', modules: { module_author: { pub_ts: at(120) }, module_dynamic: { paragraphs: [{ text: '只有段落的图稿正文' }] } } },
        // 哪里都没有正文——必须显式说取不到，不能给空串
        { id_str: '4004', dynamic_type: 'ARTICLE', modules: { module_author: { pub_ts: at(180) } } },
      ],
      offset: '',
      has_more: false,
    },
  },
}

test('四种卡片形状各取到位：取不到的那条是 null 不是空串', () => {
  const r = run(['--date', '2026-10-30', '--json'], TYPE_FX)
  assert.equal(r.status, 0, r.stderr)
  const items = JSON.parse(r.stdout).items
  assert.deepEqual(items.map((x) => x.dyn_id), ['4001', '4002', '4003', '4004'])
  assert.deepEqual(items.map((x) => x.text), ['纯文字稿：今天风很大', '带图稿：嵌在 dynamic 字符串里的正文', '只有段落的图稿正文', null])
  assert.deepEqual(items.map((x) => x.text_from), ['description', 'dynamic', 'paragraph', null])
})

test('取不到正文在人读输出里说出来（type 带上），不静默', () => {
  const r = run(['--date', '2026-10-30'], TYPE_FX)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /dyn_id=4004.*（这条取不到正文，type=ARTICLE）/)
  assert.match(r.stdout, /1 条取不到正文/)
  assert.ok(!/dyn_id=4004.*\[ARTICLE\] \s*$/.test(r.stdout), '不能退化成空白正文')
})

test('dyn_id 对回本地草稿 id：result.dynId 与 result.out 里的 dyn_id 都认', () => {
  const drafts = path.join(home, 'drafts-' + Math.random().toString(36).slice(2))
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(drafts, '2026-10-30-a.json'), JSON.stringify({ id: 'dyn-2026-10-30-a', date: '2026-10-30', result: { ok: true, dynId: '4001' } }))
  fs.writeFileSync(path.join(drafts, '2026-10-30-b.json'), JSON.stringify({ id: 'dyn-2026-10-30-b', date: '2026-10-30', result: { ok: true, out: '…\n   复核: node bili.mjs dynamic check --id 4002\n' } }))
  const r = run(['--date', '2026-10-30', '--json'], TYPE_FX, { WHALE_DRAFTS: drafts })
  assert.equal(r.status, 0, r.stderr)
  const items = JSON.parse(r.stdout).items
  assert.equal(items[0].draft_id, 'dyn-2026-10-30-a', 'result.dynId 对上了')
  assert.equal(items[1].draft_id, 'dyn-2026-10-30-b', '只有 result.out 时也能对上')
  assert.equal(items[3].draft_id, null, '没有对应草稿就留 null')
})

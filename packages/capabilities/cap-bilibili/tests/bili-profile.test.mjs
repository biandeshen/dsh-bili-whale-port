import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetchSubtitles, fetchComments, fetchThread, whois, dynamicRecent } from '../src/client/bili-profile.ts'
import { createBilibiliCapability } from '../src/index.ts'

const NAV = { code: 0, data: { isLogin: true, mid: 777, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/abcd1234efgh5678.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/ijkl9012mnop3456.png' } } }
const VIEW = { code: 0, data: { bvid: 'BV1aa411c7mD', aid: 12345, cid: 999, title: '雷雨声分析', duration: 600, owner: { name: '声学实验室' }, stat: { view: 1, like: 1, favorite: 0, coin: 0, danmaku: 0, reply: 0 }, tname: 'x', pubdate: 0, desc: '', pic: '' } }
const SUB_BODY = JSON.stringify({ body: [{ from: 0, to: 3, content: '开头' }, { from: 30, to: 40, content: '这段雨声最密' }] })

const cred = { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }

/** 可编排的 fetch 替身：按 URL 片段返回，并记下所有请求 */
function stub(routes, extra = {}) {
  const calls = []
  const f = async (url) => {
    const u = String(url)
    calls.push(u)
    for (const [frag, make] of Object.entries(routes)) {
      if (u.includes(frag)) return { status: 200, ok: true, async text() { return typeof make === 'function' ? make(u) : make }, async json() { return JSON.parse(typeof make === 'function' ? make(u) : make) } }
    }
    if (extra.fallback) return extra.fallback(u)
    return { status: 404, ok: false, async text() { return 'not found' }, async json() { return { code: -404 } } }
  }
  f.calls = calls
  return f
}

test('fetchSubtitles：走 wbi/v2 拿轨道，马上下载 body，出带时间戳全文', async () => {
  const fetch = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/player/wbi/v2': JSON.stringify({ code: 0, data: { subtitle: { ai_status: 1, subtitles: [{ lan: 'ai-zh', lan_doc: '中文 AI', subtitle_url: '//cdn.example.com/sub.json?auth_key=1793000000-0-0-abc' }] } } }),
    'cdn.example.com/sub.json': SUB_BODY,
  })
  const r = await fetchSubtitles({ cred, fetch }, 'BV1aa411c7mD')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.source, 'x/player/wbi/v2')
  assert.equal(r.lan, 'ai-zh')
  assert.equal(r.lines.length, 2)
  assert.match(r.text, /\[00:30\] 这段雨声最密/)
  assert.equal(r.plain, '开头\n这段雨声最密')
  assert.equal(r.tracks[0].hasAuthKey, true, 'URL 里必须带 auth_key，否则 CDN 会 403')
  // 签名确实加了（w_rid 在请求里）
  assert.ok(fetch.calls.some((u) => u.includes('/x/player/wbi/v2') && u.includes('w_rid=')), '字幕端点必须走 WBI 签名')
})

test('fetchSubtitles：两个端点都没轨时给 ok:false，不再"成功但空"', async () => {
  const fetch = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/player/wbi/v2': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
    '/x/v2/subtitle/web/view': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
  })
  const r = await fetchSubtitles({ cred, fetch }, 'BV1aa411c7mD')
  assert.equal(r.ok, false, '没字幕不是成功')
  assert.match(r.error, /两个端点都没有字幕轨/)
  assert.match(r.error, /烧进画面/, '要指出去哪条路（画面）')
})

test('fetchSubtitles：兜底端点能用；auth_key 过期(403)说清是分钟级问题', async () => {
  const ok = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/player/wbi/v2': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
    '/x/v2/subtitle/web/view': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'zh-CN', lan_doc: '中文', subtitle_url: 'https://cdn.example.com/s2.json' }] } } }),
    'cdn.example.com/s2.json': SUB_BODY,
  })
  const r = await fetchSubtitles({ cred, fetch: ok }, 'BV1aa411c7mD')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.source, 'x/v2/subtitle/web/view', '兜底端点要如实报出来')

  const dead = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/player/wbi/v2': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://cdn.example.com/expired.json' }] } } }),
  }, { fallback: () => ({ status: 403, ok: false, async text() { return 'Forbidden' }, async json() { return { code: -403 } } }) })
  const r2 = await fetchSubtitles({ cred, fetch: dead }, 'BV1aa411c7mD')
  assert.equal(r2.ok, false)
  assert.match(r2.error, /分钟级/)
})

test('fetchComments / fetchThread：楼层与楼中楼的形状（照 comments.mjs）', async () => {
  const fetch = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/v2/reply?': JSON.stringify({ code: 0, data: { page: { total: 31 }, replies: [
      { rpid: 'r1', like: 42, rcount: 3, ctime: 1793000000, member: { uname: '听雨人', mid: 5001 }, content: { message: '第三分钟的采样点讲得很细' } },
    ] } }),
    '/x/v2/reply/reply?': JSON.stringify({ code: 0, data: { replies: [
      { rpid: 'r1-1', like: 2, ctime: 1793000100, member: { uname: '路人', mid: 5002 }, content: { message: '同感' } },
    ] } }),
  })
  const c = await fetchComments({ cred, fetch }, 'BV1aa411c7mD')
  assert.equal(c.ok, true)
  assert.equal(c.total, 31)
  assert.equal(c.items[0].user, '听雨人')
  assert.equal(c.items[0].rpid, 'r1')
  assert.ok(fetch.calls.some((u) => u.includes('sort=2')), '默认热度排序')

  const t = await fetchThread({ cred, fetch }, 'BV1aa411c7mD', 'r1')
  assert.equal(t.ok, true)
  assert.equal(t.count, 1)
  assert.equal(t.items[0].text, '同感')
  assert.ok(fetch.calls.some((u) => u.includes('root=r1')))
})

test('whois：签名查昵称，@ 人前先核准名字', async () => {
  const fetch = stub({
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/space/wbi/acc/info': JSON.stringify({ code: 0, data: { name: '雨声研究所', sign: '做声音的', level: 5, fans: 12000 } }),
  })
  const r = await whois({ cred, fetch }, '123456')
  assert.equal(r.ok, true)
  assert.equal(r.name, '雨声研究所')
  assert.equal(r.level, 5)
  assert.ok(fetch.calls.some((u) => u.includes('/x/space/wbi/acc/info') && u.includes('w_rid=')), 'whois 必须走 WBI 签名')

  const bad = stub({ '/x/web-interface/nav': JSON.stringify(NAV) }, { fallback: () => ({ status: 200, ok: true, async text() { return JSON.stringify({ code: -404, message: '啥也找不到' }) }, async json() { return { code: -404 } } }) })
  const r2 = await whois({ cred, fetch: bad }, '999')
  assert.equal(r2.ok, false)
  assert.match(r2.error, /-404/)
})

test('dynamicRecent：用 pub_ts 而不是显示串，翻过目标日就停', async () => {
  const day = '2026-11-03'
  const t = (iso) => Math.floor(Date.parse(iso) / 1000)
  let page = 0
  const fetch = async (url) => {
    const u = String(url)
    if (u.includes('/x/web-interface/nav')) return { status: 200, ok: true, async text() { return JSON.stringify(NAV) }, async json() { return NAV } }
    if (u.includes('/feed/space')) {
      page += 1
      // 第一页：目标日 + 更晚的一天（应停）；第二页不该被请求
      const items = [
        { id_str: 'd1', dynamic_type: 'DYNAMIC_TYPE_DRAW', pub_time: '昨天 17:07', modules: { module_author: { pub_ts: t(`${day}T09:00:00Z`) }, module_dynamic: { desc: { text: '今天发了条动态' } } } },
        { id_str: 'd0', dynamic_type: 'DYNAMIC_TYPE_DRAW', modules: { module_author: { pub_ts: t('2026-11-02T09:00:00Z') } } },
      ]
      return { status: 200, ok: true, async text() { return JSON.stringify({ code: 0, data: { items, offset: 'o2' } }) }, async json() { return { code: 0, data: { items, offset: 'o2' } } } }
    }
    return { status: 404, ok: false, async text() { return '{}' }, async json() { return { code: -404 } } }
  }
  const r = await dynamicRecent({ cred, fetch }, { date: day })
  assert.equal(r.ok, true)
  assert.equal(r.count, 1, `只该留下 ${day} 那天的，实得 ${r.count}`)
  assert.equal(r.items[0].dynId, 'd1')
  assert.equal(page, 1, '翻过目标日就该停，不再多要一页')

  const bad = await dynamicRecent({ cred, fetch }, { date: '11月' })
  assert.equal(bad.ok, false)
  assert.match(bad.error, /2026-11-04/)
})

test('bili_subtitles 工具不再返回"成功但空"（这是最危险的一种失败）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-profile-'))
  const fetch = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/player/wbi/v2': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
    '/x/v2/subtitle/web/view': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [] } } }),
  })
  const cap = createBilibiliCapability({ dataDir: dir, readContext: { cred, fetch } })
  const tool = cap.tools().find((t) => t.name === 'bili_subtitles')
  const r = await tool.execute({ bvid: 'BV1aa411c7mD' })
  assert.equal(r.ok, false, '以前这里是 {ok:true, subtitles:""}，她会以为视频没字幕')
  assert.match(r.error, /两个端点都没有字幕轨/)

  // 有字幕时给前 60 行 + 截断标记
  const fetch2 = stub({
    '/x/web-interface/view': JSON.stringify(VIEW),
    '/x/web-interface/nav': JSON.stringify(NAV),
    '/x/player/wbi/v2': JSON.stringify({ code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', lan_doc: '中文 AI', subtitle_url: 'https://cdn.example.com/sub.json' }] } } }),
    'cdn.example.com/sub.json': SUB_BODY,
  })
  const cap2 = createBilibiliCapability({ dataDir: dir, readContext: { cred, fetch: fetch2 } })
  const r2 = await cap2.tools().find((t) => t.name === 'bili_subtitles').execute({ bvid: 'BV1aa411c7mD' })
  assert.equal(r2.ok, true, r2.error)
  assert.equal(r2.count, 2)
  assert.equal(r2.head.length, 2)
  assert.equal(r2.truncated, false)
})

test('WBI 混淆表在包内只剩一份（防"四处各抄一份要改就一起改"）', () => {
  const root = path.resolve(import.meta.dirname, '..')
  const hits = []
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'dist') continue
      const p = path.join(d, e.name)
      if (e.isDirectory()) walk(p)
      else if (/\.(ts|mjs)$/.test(e.name) && /MIXIN_TAB\s*=\s*\[/.test(fs.readFileSync(p, 'utf8'))) hits.push(p)
    }
  }
  walk(root)
  assert.equal(hits.length, 1, `MIXIN_TAB 的字面量定义只该有一处，实得：${hits.map((h) => path.basename(h)).join(', ')}`)
  assert.match(hits[0], /platform[\\/]wbi\.ts$/, '那一处必须在 platform/wbi.ts 里')
})

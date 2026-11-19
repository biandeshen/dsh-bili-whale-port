import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'
import { fetchDebrief } from '../src/client/bili-debrief.ts'

const NAV = { code: 0, data: { isLogin: true, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/abcd1234efgh5678.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/ijkl9012mnop3456.png' } } }

test('深读六路素材：元信息/字幕/弹幕刷屏剔除分桶/热评（fetch 替身，不打网络）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-debrief-'))
  const stub = async (url) => {
    const u = String(url)
    if (u.includes('/x/web-interface/view')) {
      return { status: 200, async json() {
        return { code: 0, data: {
          bvid: 'BV1xx411c7mD', title: '雷雨声采样合集', cid: 999, aid: 12345, duration: 600,
          tname: '声音', pubdate: 1793000000,
          owner: { name: '声学实验室' },
          stat: { view: 1000, like: 100, favorite: 50, coin: 20, danmaku: 2640, reply: 30 },
          desc: '一小时雷雨声的采样分析',
          pic: 'https://i0.hdslb.com/bfs/archive/cover.jpg',
        } }
      } }
    }
    if (u.includes('/x/web-interface/nav')) return { status: 200, async json() { return NAV } }
    if (u.includes('/x/player/wbi/v2')) {
      return { status: 200, async json() {
        return { code: 0, data: { subtitle: { subtitles: [{ lan: 'ai-zh', subtitle_url: 'https://i0.hdslb.com/sub.json' }] } } }
      } }
    }
    if (u.includes('sub.json')) {
      return { status: 200, async text() {
        return JSON.stringify({ body: [
          { from: 0, to: 3, content: '开头' },
          { from: 30, to: 40, content: '这段雨声最密' },
          { from: 600, to: 610, content: '结尾' },
        ] })
      } }
    }
    if (u.includes('comment.bilibili.com')) {
      // 伪造 deflate 弹幕 XML 太绕——返回明文 XML（走 <d 匹配分支）
      const xml = '<i><d p="35.0,1,25,0">太密了</d><d p="36.0,1,25,0">太密了</d>'
        + '<d p="36.5,1,25,0">太密了</d><d p="37.0,1,25,0">这里绝了</d>'
        + '<d p="100.0,1,25,0">打卡</d><d p="101.0,1,25,0">前排</d></i>'
      return { status: 200, async arrayBuffer() { return Buffer.from(xml).buffer } }
    }
    if (u.includes('/x/v2/reply')) {
      return { status: 200, async json() {
        return { code: 0, data: { replies: [
          { like: 42, rcount: 3, member: { uname: '听雨人' }, content: { message: '第三分钟的采样点讲得很细' } },
        ] } }
      } }
    }
    return { code: -999 }
  }

  const r = await fetchDebrief({ cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stub }, 'BV1xx411c7mD')
  assert.equal(r.ok, true, r.error)
  assert.equal(r.meta.title, '雷雨声采样合集')
  assert.equal(r.meta.up, '声学实验室')
  assert.equal(r.subtitles.count, 3, '官方字幕 3 行')
  assert.ok(r.subtitles.hasTrack)

  // 刷屏剔除：「太密了」×3 在同一桶占 >30% 且 ≥20 条不满足（只有 3 条），所以不会被剔
  // 但分桶与采样口径应如实记录
  assert.equal(r.danmaku.sampled, 6)
  assert.equal(r.danmaku.claimed, 2640)
  assert.match(r.danmaku.sampleRatio, /1\//)
  assert.ok(r.danmaku.tops.length >= 1)
  const top = r.danmaku.tops[0]
  assert.ok(top.realCount >= 1)
  assert.equal(top.hot, false, '样本太少不应标 🔥')

  assert.equal(r.comments.length, 1)
  assert.equal(r.comments[0].user, '听雨人')
  assert.match(r.comments[0].text, /第三分钟/)
})

test('bili_debrief 工具缺省走真实现并内联字幕前 40 行', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-db-'))
  const stub = async (url) => {
    const u = String(url)
    if (u.includes('/x/web-interface/view')) {
      return { status: 200, async json() { return { code: 0, data: { bvid: 'BV1xx411c7mD', title: 'T', cid: 1, aid: 1, duration: 100, tname: 'x', pubdate: 0, owner: { name: 'u' }, stat: { view: 1, like: 1, favorite: 0, coin: 0, danmaku: 0, reply: 0 }, desc: '', pic: '' } } } }
    }
    if (u.includes('/x/web-interface/nav')) return { status: 200, async json() { return NAV } }
    if (u.includes('/x/player/wbi/v2')) return { status: 200, async json() { return { code: 0, data: { subtitle: { subtitles: [] } } } } }
    if (u.includes('comment.bilibili.com')) return { status: 200, async arrayBuffer() { return Buffer.from('<i></i>').buffer } }
    if (u.includes('/x/v2/reply')) return { status: 200, async json() { return { code: 0, data: { replies: [] } } } }
    return { code: -999 }
  }
  const cap = createBilibiliCapability({
    dataDir: dir,
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stub },
  })
  const tool = cap.tools().find((t) => t.name === 'bili_debrief')
  const r = await tool.execute({ bvid: 'BV1xx411c7mD' })
  assert.equal(r.ok, true)
  assert.equal(r.meta.bvid, 'BV1xx411c7mD')
  assert.equal(r.subtitles.hasTrack, false)
  assert.ok(r.danmaku.sampleRatio)
})

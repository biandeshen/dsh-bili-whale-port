import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'
import { alignVisual } from '../src/client/bili-watch.ts'

const VIEW = { code: 0, data: { bvid: 'BV1aa411c7mD', cid: 999, aid: 12345, title: '四十四分钟的雨', duration: 2669, owner: { name: '白噪音研究所' }, tname: '声音', pubdate: 1793000000, stat: { view: 10, like: 1, favorite: 0, coin: 0, danmaku: 12, reply: 1 }, desc: '', pic: '' } }

/** 六个读端点的替身；下载那一路给真正的 web ReadableStream，好让 pipeline 走真代码 */
function stubFetch({ playurlOk = true, body = 'mp4-bytes' } = {}) {
  const calls = []
  const f = async (url, init) => {
    const u = String(url)
    calls.push(u)
    if (u.includes('/x/web-interface/view')) return { status: 200, async json() { return VIEW } }
    if (u.includes('/x/web-interface/nav')) return { status: 200, async json() { return { code: 0, data: { isLogin: true, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/abcd1234efgh5678.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/ijkl9012mnop3456.png' } } } } }
    if (u.includes('/x/player/playurl')) {
      return { status: 200, async json() { return playurlOk ? { code: 0, data: { quality: 64, durl: [{ url: 'https://cdn.example.com/v.m4s' }] } } : { code: -101, message: 'Forbidden' } } }
    }
    if (u.includes('cdn.example.com/v.m4s')) {
      return { ok: true, status: 200, body: new Response(body).body }
    }
    if (u.includes('/x/player/wbi/v2')) return { status: 200, async json() { return { code: 0, data: { subtitle: { subtitles: [] } } } } }
    if (u.includes('comment.bilibili.com')) return { status: 200, async arrayBuffer() { return Buffer.from('<i><d p="100.0,1,25,0">绝了</d><d p="101.0,1,25,0">绝了</d></i>').buffer } }
    if (u.includes('/x/v2/reply')) return { status: 200, async json() { return { code: 0, data: { replies: [] } } } }
    return { code: -999 }
  }
  f.calls = calls
  return f
}

const fakeVisual = (file) => ({
  ok: true,
  source: { file, durationSec: 2669 },
  tuning: { width: 800, height: 450, fps: 2, maxFrames: 12, maxWaitSec: 444, integralSeconds: 55, silentFloorSec: 83, dupMin: 12, durationSec: 2669 },
  stats: { frames: 5339, kept: 35, cuts: 0, marks: 34, floors: 0, dupSkipped: 1669, sheets: 2, msDecode: 58000, msPipeline: 0, scoreMax: 12.1, scoreAvg: 4.03, motionPerSec: 8.07, overflow: 0 },
  sheets: [
    { index: 1, fromSec: 0, toSec: 1300, why: 'time', frames: [{ t: 0, tier: 3, level: 2, via: 'start' }], w: 800, h: 450, png: new Uint8Array([1]), file: 'C:/x/1.png' },
    { index: 2, fromSec: 1300, toSec: 2652, why: 'end', frames: [], w: 800, h: 450, png: new Uint8Array([2]), file: 'C:/x/2.png' },
  ],
  dropped: 0,
  truncated: false,
})

test('bili_watch：直链→流式下载→管道，回执带画质/时间窗/统计', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-watch-'))
  const seen = []
  const cap = createBilibiliCapability({
    dataDir: dir,
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stubFetch({ body: 'abcdefghij' }) },
    watch: { analyze: async (f, o) => { seen.push({ f, o }); return fakeVisual(f) } },
  })
  const tool = cap.tools().find((t) => t.name === 'bili_watch')
  const r = await tool.execute({ bvid: 'BV1aa411c7mD' })

  assert.equal(r.ok, true, r.error)
  assert.equal(r.quality, '720P', '画质按服务端实际给的报')
  assert.equal(r.durationSec, 2669)
  assert.equal(r.mp4MB, 0, '10 字节的 mp4 四舍五入到 0 MB')
  assert.ok(fs.existsSync(r.mp4), '流式下载要真落盘')
  assert.equal(fs.readFileSync(r.mp4, 'utf8'), 'abcdefghij', '写进去的是 body，不是空文件')
  assert.equal(seen[0].o.durationSec, 2669, '片长要传给管道（配平靠它）')
  assert.equal(seen[0].o.outDir, path.join(dir, 'shots', 'sheets'), '拼图落在 dataDir 下自己的子目录')
  assert.deepEqual(r.sheets.map((s) => s.fromSec), [0, 1300])
  assert.equal(r.stats.kept, 35)
})

test('bili_watch：没拿到直链给结构化错误；管道失败只降级不整体失败', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-watch2-'))
  const cap1 = createBilibiliCapability({
    dataDir: dir,
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stubFetch({ playurlOk: false }) },
    watch: { analyze: async (f) => fakeVisual(f) },
  })
  const r1 = await cap1.tools().find((t) => t.name === 'bili_watch').execute({ bvid: 'BV1aa411c7mD' })
  assert.equal(r1.ok, false)
  assert.match(r1.error, /没拿到直链/)

  const cap2 = createBilibiliCapability({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'bili-watch3-')),
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stubFetch() },
    watch: { analyze: async () => ({ ok: false, error: 'ffmpeg 退出码 1', source: { file: '', durationSec: null }, tuning: {}, stats: {}, sheets: [], dropped: 0, truncated: false }) },
  })
  const r2 = await cap2.tools().find((t) => t.name === 'bili_watch').execute({ bvid: 'BV1aa411c7mD' })
  assert.equal(r2.ok, true, '下载成功了，画面失败不该把整条判死')
  assert.match(r2.degraded, /画面这路失败/)
})

test('bili_debrief：默认不付画面的钱，withFrames 才下载并给出热区→图的对齐', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bili-db-fr-'))
  const mk = () => createBilibiliCapability({
    dataDir: dir,
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stubFetch() },
    watch: { analyze: async (f) => fakeVisual(f) },
  })
  const tool = mk().tools().find((t) => t.name === 'bili_debrief')

  const plain = await tool.execute({ bvid: 'BV1aa411c7mD' })
  assert.equal(plain.ok, true)
  assert.match(plain.visual.skipped, /没开/, '默认只给说明，不去下载')

  const withFr = await tool.execute({ bvid: 'BV1aa411c7mD', withFrames: true })
  assert.equal(withFr.visual.sheets.length, 2)
  // 弹幕热区在 100~130 秒（bucket 30s），应落在第 1 张（0→1300）
  const hit = withFr.hotToSheet.find((h) => h.fromSec === 90 || h.fromSec === 120 || h.fromSec === 105)
  assert.ok(hit, `热区没算出来：${JSON.stringify(withFr.hotToSheet)}`)
  assert.equal(hit.sheet, 1, '热区要指到覆盖它的那张图')
})

test('alignVisual：没有图时全 null，越界也 null', () => {
  assert.deepEqual(alignVisual([{ fromSec: 0, toSec: 30, realCount: 3 }], []), [{ fromSec: 0, toSec: 30, realCount: 3, sheet: null }])
  const steps = [{ fromSec: 0, toSec: 100, why: 'time', file: 'a.png', frames: 4 }, { fromSec: 100, toSec: 200, why: 'end', file: 'b.png', frames: 2 }]
  assert.equal(alignVisual([{ fromSec: 150, toSec: 160, realCount: 9 }], steps)[0].sheet, 2)
  assert.equal(alignVisual([{ fromSec: 900, toSec: 910, realCount: 1 }], steps)[0].sheet, null)
})

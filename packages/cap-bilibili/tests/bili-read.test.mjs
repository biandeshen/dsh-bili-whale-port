import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'

function makeFetchStub(handler) {
  const calls = []
  const fn = async (url, init = {}) => {
    calls.push({ url: String(url), init })
    const body = await handler(String(url), init)
    return { status: 200, async json() { return body } }
  }
  fn.calls = calls
  return fn
}

test('读侧真实现：feed 三源回落 + 偏好标注 + search WBI 路径（fetch 替身，不打网络）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-read-'))
  const stub = makeFetchStub((url) => {
    if (url.includes('/x/web-interface/popular')) {
      return { code: 0, data: { item: [
        { bvid: 'BV1aa411c7mD', title: '雨声采样 <em class=keyword>合集</em>', duration: 900, owner: { name: '声学实验室' } },
        { bvid: 'BV1bb411c7mD', title: '引导冥想（标题命中屏蔽词）', duration: 300, owner: { name: 'x' } },
        { bvid: 'BV1cc411c7mD', title: '短片', duration: 120, owner: { name: 'y' } },
      ] } }
    }
    return { code: -999 }
  })

  const cap = createBilibiliCapability({
    dataDir: dir,
    readContext: {
      cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' },
      fetch: stub,
    },
  })
  const feedTool = cap.tools().find((t) => t.name === 'bili_feed')
  const r = await feedTool.execute({ count: 5 })
  assert.equal(r.ok, true)
  assert.equal(r.source, 'popular', '第一源 popular 命中就不再回落')
  assert.equal(r.items.length, 3)

  // 偏好标注：时长 <600s 跳过标记；dislike 命中标记
  const byBv = Object.fromEntries(r.items.map((x) => [x.bvid, x]))
  assert.match(byBv['BV1bb411c7mD'].title, /命中屏蔽词/)
  assert.match(byBv['BV1cc411c7mD'].title, /短于10分钟：跳过/)
  assert.doesNotMatch(byBv['BV1aa411c7mD'].title, /\[/)

  // search：走 WBI 端点
  const stub2 = makeFetchStub((url) => {
    if (url.includes('/x/web-interface/nav')) {
      return { code: 0, data: { isLogin: true, mid: 1, wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/abcd1234efgh5678.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/ijkl9012mnop3456.png' } } }
    }
    if (url.includes('/wbi/search/type')) {
      return { code: 0, data: { result: [{ bvid: 'BV1dd411c7mD', title: '搜索结果片', duration: 600, author: 'up主' }] } }
    }
    return { code: -999 }
  })
  const cap2 = createBilibiliCapability({
    dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'cap-bili-s-')),
    readContext: { cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' }, fetch: stub2 },
  })
  const searchTool = cap2.tools().find((t) => t.name === 'bili_search')
  const s = await searchTool.execute({ keyword: '雨声' })
  assert.equal(s.ok, true)
  assert.equal(s.items[0].bvid, 'BV1dd411c7mD')
  assert.ok(stub2.calls.some((c) => c.url.includes('/wbi/search/type')), 'search 应走 wbi 端点')
})

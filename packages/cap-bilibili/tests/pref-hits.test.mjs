/**
 * 看片偏好规则的命中统计（审计 §2.6 缺失项）。
 *
 * 缺口长什么样：10-31 她连报三次"词表未生效"，而"dislike 拦下 N 条"只打在 CLI 的
 * stdout 里——面板上看不见规则有没有生效，你就没法判断是**词写窄了**还是**匹配没跑到**。
 * 现在每次真的扫过内容都记一笔，面板能直接读。
 *
 * 这里要钉住三件事：
 *   1. 命中的确要计数（按词分、按太短分）；
 *   2. **没命中就不该计数**——不能因为"配了词"就算命中（数字好看不等于规则生效）；
 *   3. 面板读到的形状：每个词各几条、还在用没、最近命中样本。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createBilibiliCapability } from '../src/index.ts'

/** 造一个只会返回固定 feed 的 fetch 替身（热门源）。 */
function feedFetch(items) {
  return async (input) => {
    const url = String(input)
    if (url.includes('/popular')) {
      return new Response(JSON.stringify({
        code: 0,
        data: {
          item: items.map((it) => ({
            bvid: it.bvid,
            title: it.title,
            duration: it.durationSec,
            owner: { name: it.up ?? '某人' },
          })),
        },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    return new Response(JSON.stringify({ code: -404, data: null }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

function setup(items) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-prefhits-'))
  const dataDir = path.join(home, 'data', 'bilibili')
  const cap = createBilibiliCapability({
    dataDir,
    readContext: {
      cred: { sessdata: 'S', bili_jct: 'J', buvid3: 'B' },
      fetch: feedFetch(items),
    },
  })
  const panel = cap.panels().find((p) => p.id === 'preferences')
  const tool = cap.tools().find((t) => t.name === 'bili_feed')
  return { home, dataDir, cap, panel, tool }
}

const VIDEOS = [
  { bvid: 'BV1aaBBccDD1', title: '引导冥想：睡前放松', durationSec: 1200 },
  { bvid: 'BV1aaBBccDD2', title: '深夜助眠白噪音合集', durationSec: 300 },
  { bvid: 'BV1aaBBccDD3', title: '传统木工：榫卯的做法', durationSec: 1800 },
]

test('偏好命中统计：屏蔽词命中要按词计数，时长阈值单独记', async () => {
  const { panel, tool } = setup(VIDEOS)
  await panel.methods.set.invoke({ dislike: ['引导冥想'], minDurationSec: 600 })

  const feed = await tool.execute({ count: 5 })
  assert.equal(feed.ok, true)
  assert.ok(feed.hits, '取数要带回命中统计')

  const hits = await panel.methods.hits.invoke({})
  assert.equal(hits.ok, true)
  assert.equal(hits.hits.dislike['引导冥想'], 1, '「引导冥想」拦下 1 条')
  assert.equal(hits.hits.tooShort, 1, '300 秒那条被时长阈值跳过')
  assert.equal(hits.hits.scanned, 3, '扫过 3 条')
  assert.equal(hits.hits.everScanned, true)
  assert.ok(hits.hits.samples.length >= 1, '要有命中样本（能核对是不是误伤）')
})

test('偏好命中统计：没命中就不计数（配了词 ≠ 词生效）', async () => {
  const { panel, tool } = setup(VIDEOS)
  await panel.methods.set.invoke({ dislike: ['根本不会出现的词'], minDurationSec: 0 })

  await tool.execute({ count: 5 })
  const hits = await panel.methods.hits.invoke({})
  assert.equal(hits.hits.dislike['根本不会出现的词'], 0, '没命中就是 0')
  assert.equal(hits.hits.tooShort, 0, '阈值关着就不该有太短记录')
  assert.equal(hits.hits.scanned, 3, '扫过几条还是要记（不然"没数字"分不清是没跑还是没命中）')

  // 在用的词也要列出来，哪怕一条都没命中——"一条都没拦下"本身就是信号
  const word = hits.hits.words.find((w) => w.word === '根本不会出现的词')
  assert.ok(word, '在用的屏蔽词要列出来')
  assert.equal(word.count, 0)
  assert.equal(word.inUse, true)
})

test('偏好命中统计：清零只清计数，不动词表', async () => {
  const { panel, tool } = setup(VIDEOS)
  await panel.methods.set.invoke({ dislike: ['引导冥想'], minDurationSec: 600 })
  await tool.execute({ count: 5 })

  const reset = await panel.methods.resetHits.invoke({})
  assert.equal(reset.ok, true)
  const hits = await panel.methods.hits.invoke({})
  assert.equal(hits.hits.dislike['引导冥想'], 0, '计数清了')
  assert.equal(hits.hits.scanned, 0)
  assert.equal(hits.hits.everScanned, false)
  const prefs = await panel.methods.get.invoke({})
  assert.ok(prefs.prefs.dislike.includes('引导冥想'), '词表不能被清零带走')
})

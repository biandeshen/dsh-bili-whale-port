/**
 * 看片偏好页的「规则命中统计」（审计 §2.6 缺失项）。
 *
 * 缺口的来历：10-31 她连报三次"词表未生效"，而"dislike 拦下 N 条"只打在 CLI 的
 * stdout 里——面板上看不见规则有没有生效，你就没法判断是词写窄了还是匹配没跑到。
 * 现在这一块摆在偏好页上，所以要钉住：
 *   · 数字确实在页面上（扫过几条、拦下几条、太短几条）；
 *   · **一条都没扫过**时要说明白（"0"不等于"规则没生效"，只等于"还没跑过"）；
 *   · 每个词一行，在用/已删要说清；
 *   · 清零要确认，确认了就发请求。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { preferencesPanel } from '../../packages/cap-bilibili/src/webui/client.ts'

const HITS = {
  ok: true,
  hits: {
    scanned: 42,
    dislike: { '引导冥想': 7, '吃播': 2 },
    tooShort: 5,
    updatedAt: '2026-11-05T09:12:33.000Z',
    everScanned: true,
    minDurationSec: 600,
    words: [
      { word: '引导冥想', count: 7, inUse: true },
      { word: '吃播', count: 2, inUse: true },
      { word: '引导睡眠瑜伽', count: 1, inUse: false },
    ],
    samples: [
      { at: '2026-11-05T09:12:33.000Z', kind: 'dislike', word: '引导冥想', title: '睡前冥想引导' },
    ],
  },
}

function mountPrefs(hitsRes = HITS) {
  const h = mountPanel({
    get: () => ({
      ok: true,
      prefs: { like: ['雨声'], dislike: ['引导冥想', '吃播'], keywords: ['雨声'], exemptUps: [], minDurationSec: 600 },
    }),
    hits: () => hitsRes,
    set: () => ({ ok: true, prefs: { like: [], dislike: [], keywords: [], exemptUps: [], minDurationSec: 600 } }),
    resetHits: () => ({ ok: true, hits: { scanned: 0, dislike: {}, tooShort: 0, samples: [], everScanned: false } }),
  }, { pageId: 'world:bili-account', panelId: 'preferences' })
  preferencesPanel.mount(h.ctx)
  return h
}

test('偏好命中统计：数字摆在页面上，每个词一行', async () => {
  const h = mountPrefs()
  await settle()
  const text = h.root.textContent
  assert.match(text, /规则命中统计/)
  assert.match(text, /42 条/, '扫过几条')
  assert.match(text, /引导冥想/)
  assert.match(text, /吃播/)
  assert.match(text, /已删（历史命中）/, '删掉但命中过的词要标出来')
  assert.match(text, /睡前冥想引导/, '命中样本要能看到（核对是不是误伤）')
})

test('偏好命中统计：一条都没扫过时要说清「还没跑过」，不能让人以为规则没生效', async () => {
  const empty = {
    ok: true,
    hits: { scanned: 0, dislike: {}, tooShort: 0, updatedAt: '', everScanned: false, minDurationSec: 600, words: [{ word: '引导冥想', count: 0, inUse: true }], samples: [] },
  }
  const h = mountPrefs(empty)
  await settle()
  const text = h.root.textContent
  assert.match(text, /还没有扫过任何内容/)
  assert.match(text, /还没跑过/)
})

test('偏好命中统计：清零要确认，确认后才发请求', async () => {
  const h = mountPrefs()
  await settle()
  const reset = h.findButton('清零统计')
  assert.ok(reset, '要有清零那颗键')
  h.confirmAnswer = false
  await h.click(reset)
  assert.equal(h.calls.filter((c) => c.method === 'resetHits').length, 0, '取消就不该发')
  h.confirmAnswer = true
  await h.click(reset)
  assert.equal(h.calls.filter((c) => c.method === 'resetHits').length, 1, '答应才发')
  assert.match(String(h.confirms.at(-1).title), /清零/)
})

test('偏好命中统计：刷新统计只换内容，不摞出第二份', async () => {
  const h = mountPrefs()
  await settle()
  const before = (h.root.textContent.match(/规则命中统计/g) ?? []).length
  await h.click(h.findButton('刷新统计'))
  await settle()
  const after = (h.root.textContent.match(/规则命中统计/g) ?? []).length
  assert.equal(before, 1)
  assert.equal(after, 1, '刷新不该摞出第二块')
})

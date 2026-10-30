// M1a 可观测 + 资产根收口契约：
// ① 路径唯一来源（env → 旧路径-if-exists → whale home，两个环境变量名都认）
// ② causal 投影（时间归一 / 未知 kind 不丢）+ timeline 主源/回退
// ③ 三队列只读合并（不暴露 token）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { DSH_HOME, draftsDir, imagesDir } from '../../tools/lib/paths.mjs'
import { normalizeCausalEntry } from '../../panel/causal.mjs'
import { collectDrafts } from '../../panel/drafts.mjs'
import { timeline } from '../../panel/data.js'

// ── ① 路径收口 ────────────────────────────────────────────────────────────

test('M1a：draftsDir/imagesDir——env 优先且胜过存在的旧路径；两个旧变量名都认', () => {
  assert.equal(draftsDir({ WHALE_DRAFTS: '/tmp/x-drafts' }), '/tmp/x-drafts')
  assert.equal(draftsDir({ WHALE_DRAFTS: '/tmp/env-wins' }, { legacy: 'D:/AI/养鱼/drafts' }), '/tmp/env-wins')
  assert.equal(imagesDir({ WHALE_IMAGE_DIR: '/tmp/a', WHALE_IMAGES: '/tmp/b' }), '/tmp/a')
  assert.equal(imagesDir({ WHALE_IMAGES: '/tmp/b-only' }), '/tmp/b-only')
  // 无 env：home 兜底（legacy 显式传不存在的路径）
  const noLegacyDrafts = draftsDir({}, { legacy: path.join(os.tmpdir(), 'no-such-legacy-drafts') })
  assert.equal(noLegacyDrafts, path.join(DSH_HOME, 'bili-whale', 'drafts'))
  const noLegacyImages = imagesDir({}, { legacy: path.join(os.tmpdir(), 'no-such-legacy-images') })
  assert.equal(noLegacyImages, path.join(DSH_HOME, 'bili-whale', 'assets', 'daily'))
  // legacy 存在则用 legacy（本机 D:/AI 场景）
  const realLegacy = fs.mkdtempSync(path.join(os.tmpdir(), 'm1a-legacy-'))
  assert.equal(draftsDir({}, { legacy: realLegacy }), realLegacy)
  assert.equal(imagesDir({}, { legacy: realLegacy }), realLegacy)
})

// ── ② causal 投影 ─────────────────────────────────────────────────────────

test('M1a：action 用 atMs 归一；diary 拼 book/heading/chars', () => {
  const iso = '2026-10-30T03:11:02.771Z'
  const a = normalizeCausalEntry({ kind: 'action', at: iso, atMs: Date.parse(iso), actionKind: 'restless', reason: '歇够了，想活动一下' })
  assert.equal(a.at, iso, 'atMs 优先且转成 ISO')
  assert.equal(a.target, 'restless')
  assert.equal(a.note, '歇够了，想活动一下')

  const d = normalizeCausalEntry({ kind: 'diary', at: iso, book: 'private', heading: '本轮留下的判断', chars: 1518 })
  assert.equal(d.at, iso)
  assert.equal(d.target, 'private')
  assert.equal(d.note, '本轮留下的判断 · 1518字')
})

test('M1a：未知 kind 不丢——降级展示，绝不静默消失', () => {
  const future = normalizeCausalEntry({ kind: 'future-signal', payload: { x: 1 } })
  assert.ok(future, '未知 kind 必须返回条目')
  assert.equal(future.kind, 'future-signal')
  assert.ok(future.note.includes('future-signal') || future.target === 'future-signal')
  assert.equal(normalizeCausalEntry(null), null)
  assert.equal(normalizeCausalEntry({}), null)
})

test('M1a：timeline 主源 causal、缺失回退 whale-log（旧契约保留）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'm1a-tl-'))
  fs.mkdirSync(path.join(home, 'bili-whale'), { recursive: true })
  const iso1 = '2026-10-30T03:11:02.771Z'
  const iso2 = '2026-10-30T09:07:17.304Z'
  fs.writeFileSync(path.join(home, 'bili-whale', 'causal.jsonl'),
    JSON.stringify({ kind: 'action', at: iso1, atMs: Date.parse(iso1), actionKind: 'restless', reason: 'x' }) + '\n'
    + JSON.stringify({ kind: 'draft-result', at: iso2, draftId: 'dyn-1', result: 'sent' }) + '\n')
  fs.writeFileSync(path.join(home, 'whale-log.jsonl'), JSON.stringify({ at: iso1, kind: 'wake', note: 'e2e' }) + '\n')

  const tl = timeline(home, { cursor: 0, limit: 50 })
  assert.equal(tl.source, 'causal', '有 causal 就用 causal')
  assert.equal(tl.total, 2)
  assert.equal(tl.items[0].kind, 'draft-result', '降序：最新在前')
  assert.equal(tl.items[0].note, 'dyn-1 · ')
  assert.equal(tl.items[1].kind, 'action')
  // cursor 语义不变：偏移行号
  const t2 = timeline(home, { cursor: 2, limit: 50 })
  assert.equal(t2.items.length, 0)
  assert.equal(t2.next, null)

  // 无 causal → 回退 whale-log（panel.test 的老契约）
  const home2 = fs.mkdtempSync(path.join(os.tmpdir(), 'm1a-tl2-'))
  fs.writeFileSync(path.join(home2, 'whale-log.jsonl'), JSON.stringify({ at: iso1, kind: 'wake', note: 'old' }) + '\n')
  const t3 = timeline(home2, { cursor: 0, limit: 50 })
  assert.equal(t3.source, 'whale-log')
  assert.equal(t3.items[0].kind, 'wake')
})

// ── ③ 三队列只读合并 ──────────────────────────────────────────────────────

test('M1a：动态+回信队列合并、needs 计数、结果里没有 token', () => {
  const drafts = fs.mkdtempSync(path.join(os.tmpdir(), 'm1a-drafts-'))
  const whale = fs.mkdtempSync(path.join(os.tmpdir(), 'm1a-whale-'))
  fs.mkdirSync(path.join(whale, 'bili-whale', 'control'), { recursive: true })
  fs.writeFileSync(path.join(drafts, '2026-10-30.json'), JSON.stringify({
    id: 'dyn-20261030-x', date: '2026-10-30', status: 'pending', text: '今天的稿', image: 'D:/x.png', createdAt: 'c',
  }))
  fs.writeFileSync(path.join(drafts, '2026-10-29.json'), JSON.stringify({
    id: 'dyn-20261029-y', date: '2026-10-29', status: 'sent', text: '已发', image: 'D:/y.png',
  }))
  fs.writeFileSync(path.join(whale, 'bili-whale', 'control', 'dm-drafts.json'), JSON.stringify({
    items: [{ id: 'dm-1', status: 'pending', text: '回她一句', who: '鱼片', at: '2026-10-30T10:00:00.000Z' }],
  }))

  const r = collectDrafts({ whaleHome: whale, draftsDirPath: drafts })
  assert.equal(r.ok, true)
  assert.equal(r.dynamic.length, 2)
  assert.equal(r.dynamic[0].id, 'dyn-20261030-x', '最新在前')
  assert.equal(r.dm.length, 1)
  assert.equal(r.dm[0].queue, '回信')
  assert.equal(r.needs, 2, 'pending 动态 1 + pending 回信 1；sent 不算')
  assert.ok(!JSON.stringify(r).includes('token'), 'M1e 不变量：合并结果不得含 token')

  // limit 生效
  const r2 = collectDrafts({ whaleHome: whale, draftsDirPath: drafts, limit: 1 })
  assert.equal(r2.dynamic.length, 1)
})

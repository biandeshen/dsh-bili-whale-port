/**
 * 意见箱三条真遗留的修复凭据（2026-11-06 清账批）：
 *
 * ① f-340915（源失效不报警）：能力包的 fetchFeed 以前只在**全源都挂**时才报错，
 *    单源失效静默 `continue`——她把"池子 140→31"当成"今天就是这么少"，为
 *    "是不是我太挑"自我怀疑了一晚。现在每个源的死活都进回执（sourceFails），
 *    且 fetch failed 与"0 条"分开说（前者该等，后者该当它坏了）。
 * ② 批复回写链：面板结案时若只点"结案"不填批复，`feedback-owner-reply` 行就是 0 条，
 *    `contextSegments` 的「主人批复」注入永远空——她提了 52 条没收到过一句回音。
 *    钉住：replyFeedbackByOwner 写的正文必须能从 listFeedback 读回来。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fetchFeed } from '../src/client/bili-read.ts'
import { appendFeedback, replyFeedbackByOwner, listFeedback } from '../../cap-journal/src/judgments-feedback.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-fb-clear-'))

function ctxWith(fetchImpl) {
  // fetchFeed 里是 `await (await fetch(url)).json()`：桩要包一层 .json()
  return {
    fetch: async (url) => ({ json: async () => await fetchImpl(url) }),
    cred: { sessdata: 'x', bili_jct: 'y', buvid3: 'z' },
  }
}

test('feed：单源挂了不静默——sourceFails 留账，好源照常出数据', async () => {
  let call = 0
  const r = await fetchFeed(ctxWith(async () => {
    call += 1
    if (call === 1) throw new Error('fetch failed') // 热门挂
    return { code: 0, data: { list: [{ bvid: 'BV1xx411c7mD', title: '雨声', duration: 300, author: '白噪' }] } }
  }))
  assert.equal(r.ok, true, '还有一个好源就该出数据')
  assert.equal(r.source, 'ranking')
  assert.ok(r.sourceFails?.length === 1, `要有失败账，实得 ${JSON.stringify(r.sourceFails)}`)
  assert.equal(r.sourceFails?.[0]?.source, 'popular')
  assert.match(r.sourceFails?.[0]?.why ?? '', /fetch failed/)
})

test('feed：三源全挂时 error 逐源列原因（不许只说"都取不到"）', async () => {
  const r = await fetchFeed(ctxWith(async () => {
    throw new Error('fetch failed')
  }))
  assert.equal(r.ok, false)
  for (const src of ['popular', 'ranking', 'dynamic']) {
    assert.ok(r.sourceFails?.some((f) => f.source === src), `${src} 的死法要有账`)
  }
  assert.match(r.error ?? '', /fetch failed/)
})

test('feed：code 非 0 与 fetch 抛错分开说（该等还是该当坏了，答案不同）', async () => {
  let call = 0
  const r = await fetchFeed(ctxWith(async () => {
    call += 1
    if (call === 1) return { code: -412, message: '请求被拦截' } // 风控味
    if (call === 2) throw new Error('fetch failed')
    return { code: 0, data: { items: [{ modules: { module_dynamic: { major: { archive: { bvid: 'BV1xx411c7mD', title: 't', duration: 60 } } } } }] } }
  }))
  assert.equal(r.ok, true)
  const bySrc = new Map((r.sourceFails ?? []).map((f) => [f.source, f.why]))
  assert.match(bySrc.get('popular') ?? '', /-412/, '风控拦截要说清是拦')
  assert.match(bySrc.get('ranking') ?? '', /fetch failed/)
})

test('意见箱：批复正文写进去就要读得回来（回写链凭据）', () => {
  const file = path.join(tmp(), 'feedback.jsonl')
  const added = appendFeedback({ issue: '测试意见：星号不渲染', severity: 'low' }, file)
  assert.equal(added.ok, true)
  const newId = added.id
  const rep = replyFeedbackByOwner(file, {
    id: newId,
    ownerReply: '已在写闸入口统一剥 Markdown，正文不会再带星号出稿（f-79f26d）',
    resolve: true,
  })
  assert.equal(rep.ok, true)
  const all = listFeedback(file, { status: 'all' })
  const item = all.items.find((x) => x.id === newId)
  assert.equal(item?.resolved, true)
  assert.equal(item?.resolvedBy, 'owner')
  assert.equal(item?.ownerReply, '已在写闸入口统一剥 Markdown，正文不会再带星号出稿（f-79f26d）')
})

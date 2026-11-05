/**
 * B13d 的三处 UI 收尾（story-1 遗留 + 承诺过的半成品）：
 *
 *   ① 日记翻页：后端 paginateDiary 早就支持 page，页面以前不传 → 永远只看第一页，
 *      而且正文里写着"（还有更多，往前翻）"却**没得翻**。
 *   ② 日记只读/编辑分离：以前只读视图和 textarea 并排摆着，主人分不清哪块是她的原文、
 *      哪块是自己改的，手一抖就整段覆盖。
 *   ③ diff 不堆叠：以前每点一次「看改动」就 append 一个 <pre>，连点几次叠几份。
 *   ④ 收件箱按 id 局部更新：以前每个动作的 after 都是整表 refresh()，
 *      主人正在别的行里打的"叮嘱"会被抹掉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { journalBoardPanel } from '../../packages/cap-journal/src/webui/client.ts'
import { memoryCenterPanel } from '../../packages/cap-memory/src/webui/client.ts'
import { inboxPanel } from '../../packages/cap-bilibili/src/webui/client.ts'

// ── ① ② 日记：翻页 + 只读/编辑分离 ──

function mountJournal(getDiary) {
  const h = mountPanel({ getDiary }, { panelId: 'journal-board' })
  journalBoardPanel.mount(h.ctx)
  return h
}

const diaryPage = (page, over = {}) => ({
  ok: true,
  book: 'public',
  totalDays: 20,
  totalChars: 4000,
  page,
  dates: [`2026-11-0${page + 1}`],
  body: `## 2026-11-0${page + 1}\n第 ${page + 1} 页的日记`,
  returnedChars: 100,
  hasMore: page < 2,
  ...over,
})

test('日记：能翻页，且请求真的带上 page', async () => {
  const seen = []
  const h = mountJournal((p = {}) => {
    seen.push(p)
    return diaryPage(Number(p.page ?? 0))
  })
  await settle()
  await h.click(h.findButton('读取日记'))
  assert.match(h.root.textContent, /第 1 \/ 3 页/, '要显示页码')
  const next = h.findButton('下一页')
  assert.ok(next, '要有下一页')
  await h.click(next)
  const paged = seen.find((p) => p.page === 1)
  assert.ok(paged, '翻页要带 page')
  assert.match(h.root.textContent, /第 2 \/ 3 页/)
})

test('日记：第一页的「上一页」是禁用的（别让她翻到不存在的页）', async () => {
  const h = mountJournal((p = {}) => diaryPage(Number(p.page ?? 0)))
  await settle()
  await h.click(h.findButton('读取日记'))
  const prev = h.findButton('上一页')
  assert.ok(prev)
  assert.equal(prev.disabled, true, '第一页的上一页要禁用')
})

test('日记：默认只读，要改先点「编辑这段」', async () => {
  const h = mountJournal((p = {}) => diaryPage(0))
  await settle()
  await h.click(h.findButton('读取日记'))
  // 读的时候只有原文，没有编辑框
  assert.equal(h.textareas().length, 0, '默认不该有编辑框')
  assert.match(h.root.textContent, /第 1 页的日记/)
  // 点「编辑这段」才出编辑框
  await h.click(h.findButton('编辑这段'))
  assert.equal(h.textareas().length, 1, '点了才出编辑框')
  assert.match(h.root.textContent, /改这里会覆盖当天整段/, '要写清后果')
})

test('日记：保存后回到只读态（编辑区收起来）', async () => {
  const saved = []
  const h = mountPanel({
    getDiary: (p = {}) => diaryPage(0),
    saveDiarySection: (p = {}) => { saved.push(p); return { ok: true } },
  }, { panelId: 'journal-board' })
  journalBoardPanel.mount(h.ctx)
  await settle()
  await h.click(h.findButton('读取日记'))
  await h.click(h.findButton('编辑这段'))
  await h.click(h.findButton('保存并提交'))
  assert.equal(saved.length, 1, '保存要发请求')
  assert.equal(h.textareas().length, 0, '存完回到只读态')
})

// ── ③ diff 不堆叠 ──

function mountMemory(history) {
  const h = mountPanel({
    list: () => ({ ok: true, counts: { total: 0, core: 0, active: 0, archived: 0, voided: 0 }, items: [] }),
    history,
  }, { panelId: 'memory-center' })
  memoryCenterPanel.mount(h.ctx)
  return h
}

test('看改动：连点两次只留最新一份 diff，不叠', async () => {
  const h = mountMemory((p = {}) => {
    if (p?.diffOf) return { ok: true, diff: `diff of ${p.diffOf}` }
    return {
      ok: true,
      status: { available: true, repo: true, dirty: false, head: 'abc1234', lastCommit: null, checkpoints: [] },
      log: [
        { hash: 'aaa1111', author: 'xiaoyu', message: 'memory: 记下第一条' },
        { hash: 'bbb2222', author: 'owner', message: 'memory: 改了一句' },
      ],
    }
  })
  await settle()
  await h.click(h.findButton('查看版本历史'))
  await h.click(h.findButton('看改动'))
  await h.click(h.findButton('看改动'))
  const pres = h.root.querySelectorAll ? h.root.querySelectorAll('pre') : []
  const text = h.root.textContent
  const count = (text.match(/diff of /g) ?? []).length
  assert.equal(count, 1, `页面里只该有一份 diff，实得 ${count}`)
})

// ── ④ 收件箱按 id 局部更新 ──

function mountInbox(listRes, assignRes) {
  const h = mountPanel({
    list: () => listRes,
    assignAction: () => assignRes,
  }, { pageId: 'world:bili-account', panelId: 'inbox' })
  inboxPanel.mount(h.ctx)
  return h
}

const INBOX = {
  ok: true,
  unreadCount: 2,
  blockedUids: [],
  items: [
    { key: 'k1', who: '鱼片', text: '今天有直播吗', kind: 'comment', atMs: Date.parse('2026-11-05T10:00:00+08:00'), read: false, uid: '233643544' },
    { key: 'k2', who: '别人', text: '你好', kind: 'at', atMs: Date.parse('2026-11-05T09:00:00+08:00'), read: false, uid: '999' },
  ],
}

test('收件箱：动作后只改那一行，不整表重取', async () => {
  let listCalls = 0
  const h = mountPanel({
    list: () => { listCalls += 1; return INBOX },
    assignAction: (p = {}) => ({ ok: true, item: { ...INBOX.items[0], read: true, assignedAction: p.action } }),
  }, { pageId: 'world:bili-account', panelId: 'inbox' })
  inboxPanel.mount(h.ctx)
  await settle()
  const before = listCalls
  await h.click(h.findButton('✓ 忽略已读'))
  assert.equal(listCalls, before, '不该整表重取')
  assert.match(h.root.textContent, /已指派：ignore/, '这一行要就地更新')
})

test('收件箱：拉黑后那一行自己消失（她已屏蔽此人）', async () => {
  const h = mountPanel({
    list: () => INBOX,
    assignAction: (p = {}) => ({ ok: true, item: { ...INBOX.items[0], read: true, assignedAction: p.action } }),
  }, { pageId: 'world:bili-account', panelId: 'inbox' })
  inboxPanel.mount(h.ctx)
  await settle()
  h.confirmAnswer = true
  await h.click(h.findButton('🚫 拉黑此人'))
  const text = h.root.textContent
  assert.ok(!text.includes('今天有直播吗'), '被拉黑那条要从列表里去掉')
  assert.match(text, /你好/, '别的条还在')
})

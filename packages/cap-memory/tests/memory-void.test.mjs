/**
 * 记忆更正通道（#55，2026-11-01 意见箱 high）：写错的记忆过去只能等衰减，
 * 期间她照常拿它下结论。补的是"更正"不是"删除"：
 *   · 原文永不改写（否则日后复盘"当初为什么这么记"就断了）；
 *   · 作废过的不再被召回；
 *   · 一次只准点一条：0 命中 / 多命中一律拒绝，并把候选还给她。
 *
 * 从宿主 tests/memory-void.test.mjs 搬来（#88 退役第二份内核前的对账）。
 * 入口换成 cap-memory 的 MemoryCardStore.voidCard / restoreCard 与 memory_void 工具。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability, MemoryCardStore } from '../src/index.ts'

const NOW = Date.parse('2026-11-01T12:00:00.000Z')
const TEXTS = [
  '我以为主人说过他讨厌雨声',
  '今天把弹幕密度这把尺子磨了一道',
  '看过《竹林雨声》',
]

function setup(extra = []) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memvoid-'))
  const memoRoot = path.join(dir, 'memo')
  const store = new MemoryCardStore(memoRoot)
  const cards = [...TEXTS, ...extra].map((content) => store.create({ content, sender: 'npc', tier: 'active' }))
  const cap = createMemoryCapability({ memoRoot, getCurrentMood: () => 0.3 })
  const panel = cap.panels().find((p) => p.id === 'memory-center')
  const tool = cap.tools().find((t) => t.name === 'memory_void')
  return { dir, memoRoot, store, cards, cap, panel, tool }
}

test('作废是盖章不是删除：原文、时间、理由都留在条上', () => {
  const { store, cards } = setup()
  const r = store.voidCard({ id: cards[0].id }, '这句话是我自己想的，不是主人说的', NOW)
  assert.equal(r.ok, true)
  assert.equal(r.card.voided, true)
  assert.equal(r.card.tier, 'voided')
  assert.equal(r.card.voidedAt, new Date(NOW).toISOString())
  assert.equal(r.card.content, TEXTS[0], '原文不能被改写成"（已更正）"')
  assert.match(r.card.voidReason, /不是主人说的/)
  assert.equal(store.findById(cards[1].id).voided, false, '没点名的那条不该被动')
  // 落盘也要留住原文（不只是返回值好看）
  const onDisk = store.readAll({ tier: 'voided' }).find((c) => c.id === cards[0].id)
  assert.equal(onDisk.content, TEXTS[0])
})

test('作废后不再被想起来；没作废的照常召回', () => {
  const { store, cards } = setup()
  store.voidCard({ id: cards[0].id }, '这条记错了，先作废', NOW)
  const picked = store.recall({ text: '主人 雨声 讨厌', now: NOW, k: 3, surprises: 0 })
  assert.equal(picked.some((m) => m.id === cards[0].id), false, '作废的记忆还在召回池里 = 更正没生效')
  assert.ok(picked.length, '其余记忆不该被连带清掉')
})

test('没命中就什么都不改，且如实报失败（调用方不能说"已更正"）', () => {
  const { store } = setup()
  const before = store.readAll({ tier: 'all' }).map((c) => `${c.id}:${c.tier}`).sort()
  const r = store.voidCard({ id: 'mem-zzz' }, '不存在也要说实话', NOW)
  assert.equal(r.ok, false)
  assert.deepEqual(store.readAll({ tier: 'all' }).map((c) => `${c.id}:${c.tier}`).sort(), before)
})

test('短理由先挡住：留痕不足 6 字不许作废', () => {
  const { store, cards } = setup()
  for (const reason of ['', '   ', '记错']) {
    const r = store.voidCard({ id: cards[0].id }, reason, NOW)
    assert.equal(r.ok, false, `理由「${reason}」应被拒`)
    assert.match(r.error, /6/)
  }
  assert.equal(store.findById(cards[0].id).tier, 'active', '拒绝时一条都不该被动')
})

test('多命中一律拒绝，并把候选还给她', () => {
  const { store, cards } = setup(['今天把弹幕密度这把尺子又磨了一道'])
  const r = store.voidCard({ match: '尺子' }, '这两条我分不清是哪条记错了', NOW)
  assert.equal(r.ok, false)
  assert.match(r.error, /2 条/)
  assert.ok(r.candidates?.some((s) => s.includes(cards[1].id)), '候选里要带 id，她才能点名')
  assert.equal(store.readAll({ tier: 'voided' }).length, 0, '拒绝时一条都不该被动')
})

test('撤销作废能改回来，当初为什么作废要留着不擦', () => {
  const { store, cards } = setup()
  store.voidCard({ id: cards[1].id }, '先撤这条试试', NOW)
  assert.equal(store.findById(cards[1].id).voided, true)
  const back = store.restoreCard(cards[1].id, 'active')
  assert.equal(back.ok, true)
  assert.equal(back.card.voided, false)
  assert.equal(back.card.tier, 'active')
  assert.equal(back.card.voidReason, '先撤这条试试', '恢复后仍要能看到当初为什么作废')
})

test('memory_void 工具：标成写操作，成功回执说清是更正不是删除', async () => {
  const { tool, cards, store } = setup()
  assert.ok(tool, '她需要一个能更正记忆的入口')
  assert.equal(tool.mutatesState, true, '作废会改她的状态，不能算只读')
  const ok = await tool.execute({ id: cards[0].id, reason: '这句是我自己想出来的，不该记成主人说的' })
  assert.equal(ok.ok, true)
  assert.equal(store.findById(cards[0].id).voided, true)
  const short = await tool.execute({ id: cards[2].id, reason: '短' })
  assert.equal(short.ok, false)
})
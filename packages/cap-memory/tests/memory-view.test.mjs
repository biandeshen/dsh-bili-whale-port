import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability, MemoryCardStore } from '../src/index.ts'
import { FADED_VIVIDNESS } from '../../persona-core/src/retrieval.ts'

test('记忆观：faded 元记忆 + 遗忘叙事化（dreamDigest）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memoryview-'))
  const memoRoot = path.join(dir, 'memo')
  const store = new MemoryCardStore(memoRoot)

  // 1. 造一条会被召回但鲜活度低于阈值的记忆
  const card = store.create({ content: '某天深夜和主人聊到天亮的那次长谈', tier: 'active', vividness: 0.9 })
  // 直接衰减到阈值下
  const settled = store.settle(30, FADED_VIVIDNESS)
  // 30 天衰减足够让它沉入归档
  assert.ok(settled.archived.some((a) => a.id === card.id), '长谈记忆应已归档')
  assert.equal(store.findById(card.id)?.tier, 'archived')

  // 2. dreamDigest：归档叙事文本——第一人称、说明"原文还在"
  const digest = store.dreamDigest(settled)
  assert.ok(digest, '有归档就该有梦话')
  assert.match(digest, /夜里结算记忆/)
  assert.match(digest, /长谈/)
  assert.match(digest, /原文都还在/)

  // 3. 没有归档时 dreamDigest 返回 null（不硬凑）
  assert.equal(store.dreamDigest({ decayed: 3, archivedIds: [], archived: [] }), null)

  // 4. faded 标记：召回结果里鲜活度低的条目带 faded=true 和"只剩轮廓"的 why
  const cap = createMemoryCapability({ memoRoot, getCurrentMood: () => 0.2 })
  // 恢复到 active 但压低鲜活度，制造"召回得到但已淡"的状态
  await cap.panels()[0].methods.restore.invoke({ id: card.id, targetTier: 'active' })
  await cap.panels()[0].methods.update.invoke({ id: card.id, vividness: 0.2 })
  const recallTool = cap.tools().find((t) => t.name === 'memory_recall')
  const hits = await recallTool.execute({ query: '深夜 长谈 主人' })
  assert.ok(hits.items.length >= 1, '淡忘的记忆仍可被召回（唤醒机制）')
  assert.equal(hits.items[0].faded, true)
  assert.ok(hits.items[0].why.some((w) => String(w).includes('只剩个轮廓')))
})

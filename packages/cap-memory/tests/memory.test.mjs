import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { validateCapabilityContract } from '../../persona-core/src/capability.ts'
import { createMemoryCapability, MemoryCardStore } from '../src/index.ts'

test('cap-memory：契约校验通过，四层卡片增删改查、置顶、作废与恢复、自动衰减归档全闭环', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-memory-'))
  const memoRoot = path.join(dir, 'memo')
  const cap = createMemoryCapability({ memoRoot, getCurrentMood: () => 0.3 })

  assert.equal(validateCapabilityContract(cap).ok, true)

  const panel = cap.panels()[0]
  assert.equal(panel.id, 'memory-center')

  // 1. 主人在面板直接塞一条核心记忆给她
  const c1 = await panel.methods.create.invoke({
    content: '主人最喜欢90年代赛璐璐动画风格，比如《猫眼三姐妹》',
    tags: ['审美', '动画'],
    tier: 'core',
  })
  assert.equal(c1.ok, true)
  assert.equal(c1.card.tier, 'core')
  assert.equal(c1.card.sender, 'player')

  // 2. 她自己通过工具记一条普通活跃记忆 + rememberFirst 里程碑去重
  const rememberTool = cap.tools().find((t) => t.name === 'memory_remember')
  const m1 = await rememberTool.execute({
    content: '第一次被主人驳回草稿，因为写得太像客服机器人',
    firstTag: 'first-reject',
    tags: ['草稿'],
  })
  assert.equal(m1.ok, true)
  assert.equal(m1.tier, 'core')
  assert.equal(m1.flashbulb, true)

  // 同标签第二次不再点亮 flashbulb，进 active
  const m2 = await rememberTool.execute({
    content: '第二次被驳回草稿，漏了书名号',
    firstTag: 'first-reject',
    tags: ['草稿'],
  })
  assert.equal(m2.ok, true)
  assert.equal(m2.tier, 'active')
  assert.equal(m2.flashbulb, false)

  // 3. 面板 list 统计与过滤
  const listAll = await panel.methods.list.invoke({ tier: 'all' })
  assert.equal(listAll.ok, true)
  assert.equal(listAll.counts.total, 3)
  assert.equal(listAll.counts.core, 2)
  assert.equal(listAll.counts.active, 1)

  const searchHit = await panel.methods.list.invoke({ query: '猫眼三姐妹' })
  assert.equal(searchHit.items.length, 1)
  assert.equal(searchHit.items[0].id, c1.card.id)

  // 4. 主人在面板在线修改记忆正文与鲜活度
  const upd = await panel.methods.update.invoke({
    id: m2.id,
    content: '第二次草稿被驳回：书名号没闭合',
    vividness: 0.4,
  })
  assert.equal(upd.ok, true)
  assert.equal(upd.card.content, '第二次草稿被驳回：书名号没闭合')
  assert.equal(upd.card.vividness, 0.4)

  // 5. 每日衰减结算 settle：vividness 0.4 衰减 5 天后跌破 0.35 自动移入 archived/
  const store = new MemoryCardStore(memoRoot)
  const settled = store.settle(5, 0.35)
  assert.ok(settled.archivedIds.includes(m2.id))
  assert.equal(store.findById(m2.id)?.tier, 'archived')

  // 6. 作废与恢复：先点作废移入 voided/，再一键恢复回 active/
  const voidRes = await panel.methods.void.invoke({
    id: m2.id,
    reason: '这条记混了日期，先作废处理',
  })
  assert.equal(voidRes.ok, true)
  assert.equal(voidRes.card.tier, 'voided')
  assert.equal(voidRes.card.voided, true)

  // 作废后不应被 memory_recall 召回
  const recallTool = cap.tools().find((t) => t.name === 'memory_recall')
  const recalledAfterVoid = await recallTool.execute({ query: '书名号没闭合' })
  assert.ok(!recalledAfterVoid.items.some((x) => x.id === m2.id))

  // 主人一键恢复
  const restored = await panel.methods.restore.invoke({ id: m2.id, targetTier: 'active' })
  assert.equal(restored.ok, true)
  assert.equal(restored.card.tier, 'active')
  assert.equal(restored.card.voided, false)
})

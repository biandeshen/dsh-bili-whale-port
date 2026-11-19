/**
 * 核心常驻退位审阅台（审计 §2.2「核心常驻准入/退出规则」）。
 *
 * 缺口的原话：「8 条核心常驻里 3 条是同一主题的旧拒稿，把她的注意力钉死了」。
 * 现状（2026-11-05 实测）：core 里 22 条，同主题旧拒稿只剩 1 条——原诊断已大幅缓解；
 * 但"core 该放什么"仍是**政策问题**，主人得**看得见**才能定。
 *
 * 这一条钉住：
 *   1. 三类提示都能算出来：久未使用 / 同主题重复 / 像某次具体经过；
 *   2. **只读**：审阅这一步绝不改她的记忆（不许自动退位——那是动她的账）；
 *   3. 退位是"移到 active"（**不删**，git 里有历史，可放回去）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryCapability } from '../src/index.ts'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-coreview-'))
  const memoRoot = path.join(dir, 'memo')
  const cap = createMemoryCapability({ memoRoot, getCurrentMood: () => 0.2 })
  return { dir, memoRoot, cap, panel: cap.panels().find((p) => p.id === 'memory-center') }
}

const old = (days) => new Date(Date.now() - days * 86400_000).toISOString()

test('审阅：三类提示都算得出来（久未使用 / 同主题重复 / 具体事件）', async () => {
  const { panel } = setup()
  const mk = async (content, over = {}) => {
    const r = await panel.methods.create.invoke({ content, tier: 'core' })
    assert.equal(r.ok, true, r.error)
    return r.card.id
  }
  const stale = await mk('看过《雨声》那次的结论', { })     // 会被标"从没被想起"
  const dup1 = await mk('看过《BV1aaBBccDD1》这片的观察')
  const dup2 = await mk('看过《BV1aaBBccDD1》的另一条')
  const event = await mk('今天 3 条动态被发了出去')

  const res = await panel.methods.coreReview.invoke({ staleDays: 14 })
  assert.equal(res.ok, true)
  assert.equal(res.total, 4, '四条都在（stale / dup1 / dup2 / event）')

  const find = (id) => res.items.find((i) => i.id === id)
  assert.equal(find(stale).unused, true, '从没被想起要被认出来')
  assert.equal(find(stale).longUnused, false, '刚建的还不算"久"')
  assert.ok(find(dup1).sameTopic.includes(dup2), '同一个 BV 号算同主题')
  assert.ok(find(dup2).sameTopic.includes(dup1))
  assert.equal(find(event).specificEvent, true, '带具体数字的算"某次具体经过"')
  assert.ok(res.counts.duplicateTopic >= 2)
  assert.ok(res.counts.specificEvent >= 1)
})

test('审阅：只读——跑一遍不动她的记忆', async () => {
  const { panel } = setup()
  await panel.methods.create.invoke({ content: '一条核心记忆', tier: 'core' })
  const before = panel.methods.list
  await panel.methods.coreReview.invoke({})
  const after = await panel.methods.list.invoke({ tier: 'core' })
  assert.equal(after.items.length, 1, '审阅不许动她的记忆')
  assert.equal(after.items[0].tier, 'core')
})

test('退位：移到 active（不删，git 里有历史）', async () => {
  const { panel } = setup()
  const r = await panel.methods.create.invoke({ content: '要退下来的一条', tier: 'core' })
  const id = r.card.id
  const moved = await panel.methods.update.invoke({ id, tier: 'active' })
  assert.equal(moved.ok, true, moved.error)
  assert.equal(moved.card.tier, 'active')
  const core = await panel.methods.list.invoke({ tier: 'core' })
  const active = await panel.methods.list.invoke({ tier: 'active' })
  assert.equal(core.items.length, 0, 'core 里没了')
  assert.equal(active.items.length, 1, 'active 里还在（没删）')
  assert.equal(active.items[0].id, id)
  assert.match(active.items[0].content, /要退下来的一条/, '原文还在')
})

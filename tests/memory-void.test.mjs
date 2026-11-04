// #55 记忆要更正（2026-11-01 意见箱 high）：写错的记忆过去只能等衰减，期间她照常拿它下结论。
// 补的是"更正通道"，不是"删除按钮"：
//   · 原文留在 fields.json（content 永不删除），只盖作废章 → 日后能复盘"当初为什么这么记"
//   · 作废过的不再被召回（recallMemories 排除）
//   · 一次只准点一条：0 命中 / 多命中一律拒绝，并把候选还给她
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { voidMemories, restoreMemories, isVoided } from '@xiaoyu/persona-core/memory'
import { recallMemories } from '@xiaoyu/persona-core/retrieval'
import { createInitialState } from '@xiaoyu/persona-core/npc-state-machine'
import { DEFAULT_ATOMIC_FIELDS } from '@xiaoyu/persona-core/types'
import { findMemories, voidMemory } from '../legacy/bili-account-retired/personaAdapter.ts'

const NOW = Date.parse('2026-11-01T12:00:00.000Z')
const mem = (id, content, extra) => ({
  id, npcId: 'xiaoyu', sender: 'npc', content,
  emotion: { valence: 0.2, intensity: 0.5, tags: [] }, tags: [],
  vividness: 0.9, accessCount: 0, createdAt: new Date(NOW).toISOString(), source: 'npc_self', ...(extra || {}),
})
const MEMS = [
  mem('mem-a', '我以为主人说过他讨厌雨声'),
  mem('mem-b', '今天把弹幕密度这把尺子磨了一道'),
  mem('mem-c', '看过《竹林雨声》'),
]

test('作废是盖章不是删除：原文、时间、理由都留在条上', () => {
  const r = voidMemories(MEMS, ['mem-a'], '这句话是我自己想的，不是主人说的', NOW)
  assert.deepEqual(r.voidedIds, ['mem-a'])
  const a = r.memories.find((m) => m.id === 'mem-a')
  assert.equal(a.voided, true)
  assert.equal(a.voidedAt, new Date(NOW).toISOString())
  assert.equal(a.content, MEMS[0].content, '原文不能被改写成"（已更正）"，否则复盘就断了')
  assert.match(a.voidReason, /不是主人说的/)
  assert.equal(r.memories.find((m) => m.id === 'mem-b').voided, undefined, '没点名的那条不该被动')
})

test('作废后不再被想起来；没作废的照常召回', () => {
  const r = voidMemories(MEMS, ['mem-a'], '记错了', NOW)
  const picked = recallMemories(r.memories, { text: '主人 雨声 讨厌', now: NOW, k: 3, surprises: 0 })
  assert.equal(picked.some((m) => m.id === 'mem-a'), false, '作废的记忆还在召回池里 = 更正没生效')
  assert.ok(picked.length, '其余记忆不该被连带清掉')
})

test('没命中就什么都不改，且如实报 0（调用方不能说"已更正"）', () => {
  const r = voidMemories(MEMS, ['mem-zzz'], '不存在也要说实话', NOW)
  assert.deepEqual(r.voidedIds, [])
  assert.equal(r.memories, MEMS, '没命中时不该复制一份假装有动作')
})

test('撤销作废能改回来，理由留着不擦', () => {
  const r = voidMemories(MEMS, ['mem-b'], '先撤', NOW)
  assert.equal(isVoided(r.memories.find((m) => m.id === 'mem-b')), true)
  const back = restoreMemories(r.memories, ['mem-b'])
  assert.deepEqual(back.restoredIds, ['mem-b'])
  const m = back.memories.find((x) => x.id === 'mem-b')
  assert.equal(m.voided, false)
  assert.equal(m.voidReason, '先撤', '恢复后仍要能看到当初为什么作废')
})

test('点名：id 精确、match 忽略大小写包含算；空选择一律不命中', () => {
  const s = { memories: MEMS, fields: {}, chain: [] }
  assert.deepEqual(findMemories(s, { id: 'mem-a' }).map((m) => m.id), ['mem-a'])
  assert.deepEqual(findMemories(s, { match: '尺子' }).map((m) => m.id), ['mem-b'])
  assert.deepEqual(findMemories(s, { match: '  ' }), [])
  assert.deepEqual(findMemories(s, { id: 'nope' }), [])
})

// ── 工具面：真跑 handler（临时 WHALE_HOME，绝不碰正式 fields.json）──────────
const HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'memvoid-home-'))
fs.mkdirSync(path.join(HOME, 'bili-whale'), { recursive: true })
const STATE_FILE = path.join(HOME, 'bili-whale', 'fields.json')
const writeState = (memories) => fs.writeFileSync(STATE_FILE, JSON.stringify({
  schemaVersion: 5, fields: { ...DEFAULT_ATOMIC_FIELDS }, npcState: createInitialState('xiaoyu'),
  chain: [], memories, budget: null, emotionHistory: [], lastAppliedAt: new Date(NOW).toISOString(),
}))
const readState = () => JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))

test('voidMemory（适配器层）：点到的那条作废，其余原样', () => {
  writeState(MEMS)
  const s = voidMemory({ ...readState() }, 'mem-c', '这条其实没看完', NOW)
  assert.equal(s.memories.find((m) => m.id === 'mem-c').voided, true)
  assert.equal(s.memories.find((m) => m.id === 'mem-a').voided, undefined)
})

test('bili_memory_void 工具：拒空理由、拒多条命中、成功后回执说清留原文且没有撤销通道', async () => {
  process.env.WHALE_HOME = HOME
  const { BILI_ACCOUNT } = await import('../legacy/bili-account-retired/definition.ts')
  const world = BILI_ACCOUNT.create({ repoRoot: HOME, botDir: HOME })
  const tool = world.tools().find((t) => t.name === 'bili_memory_void')
  assert.ok(tool, '她需要一个能更正记忆的入口')
  assert.deepEqual(tool.tags, ['write'], '作废会改她的状态，不能算只读')

  writeState(MEMS)
  assert.match(await tool.handler({ match: '尺子' }), /≥6 字/, '空/短理由要先挡住')

  writeState([...MEMS, mem('mem-d', '今天把弹幕密度这把尺子又磨了一道')])
  const amb = await tool.handler({ match: '尺子', reason: '这两条我分不清是哪条记错了' })
  assert.match(amb, /命中 2 条/)
  assert.match(amb, /mem-b/)
  assert.equal(readState().memories.some((m) => m.voided), false, '拒绝时一条都不该被动')

  writeState(MEMS)
  const ok = await tool.handler({ id: 'mem-a', reason: '这句是我自己想出来的，不该记成主人说的' })
  assert.match(ok, /已作废 mem-a/)
  assert.match(ok, /这是更正，不是删除/)
  assert.match(ok, /我没有撤销通道/)
  assert.equal(readState().memories.find((m) => m.id === 'mem-a').voided, true)

  writeState(MEMS)
  assert.match(await tool.handler({ id: 'mem-missing', reason: '这条根本不存在' }), /没点到记忆/)
})

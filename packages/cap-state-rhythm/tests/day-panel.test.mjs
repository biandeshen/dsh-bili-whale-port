/**
 * 「她的一天」落地页的数据面契约（设计交接 story-5）。
 *
 * 这一页只回答三个问题：她在干什么 / 今天做过什么 / 下一拍什么时候。
 * 所以测试钉的是：读数来自作息账、流水**只含今天**（按本地日切）、而且它排在面板第一位
 * ——宿主没有给扩展开放路由，"默认落地页"能做到的就是排在第一个。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability } from '../src/index.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-day-'))
const today = new Date().toLocaleDateString('sv-SE')

function mk(dir, over = {}) {
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  const now = Date.now()
  fs.writeFileSync(fieldsFile, JSON.stringify({
    schemaVersion: 5,
    fields: { energy: 0.8, stimulation: 0.3, connection: 0.75, social: 0.5, mood: 0.4, curiosity: 0.7, creativity: 0.6 },
    memories: [],
    npcState: { current: 'normal', bond: { level: 0.5 } },
    budget: { day: today, spent: {} },
    emotionHistory: [],
    lastAppliedAt: new Date().toISOString(),
    // 因果账：默认今天三条（含一条改了场值）、昨天两条。昨天的不该出现在"她的一天"里。
    // 传 chain 就整本换掉（"账上什么都没有"那种情形要能真的清空）。
    chain: Array.isArray(over.chain) ? over.chain : [
      { atMs: now - 6 * 3600_000, type: 'watch', description: '看了一条雨声的片子', source: 'self', fieldChanges: [] },
      { atMs: now - 40 * 60_000, type: 'diary', description: '写了今天的公开日记', source: 'self', fieldChanges: [] },
      {
        atMs: now - 5 * 60_000, type: 'owner_adjust', description: '主人拉了体力',
        source: 'owner', fieldChanges: [{ field: 'energy', from: 0.6, to: 0.8 }],
      },
      { atMs: now - 30 * 3600_000, type: 'watch', description: '昨天看的一条', source: 'self', fieldChanges: [] },
      { atMs: now - 31 * 3600_000, type: 'reply', description: '昨天回的一条私信', source: 'self', fieldChanges: [] },
    ],
  }))
  fs.writeFileSync(lifeFile, JSON.stringify({
    day: today,
    actionsToday: over.actionsToday ?? 3,
    lastActionAt: over.lastActionAt ?? now - 5 * 60_000,
    lastCheckAt: now - 60_000,
    nextCheckAt: over.nextCheckAt ?? now + 4 * 60_000,
    mode: over.mode ?? 'auto',
    sleepWindow: null,
  }))
  return createStateRhythmCapability({ fieldsFile, lifeFile })
}

const dayGet = (cap) => cap.panels().find((p) => p.id === 'day')?.methods?.get?.invoke

test('「她的一天」是第一个面板（宿主不给扩展开路由，落地页只能靠排序）', () => {
  const cap = mk(tmp())
  const ids = cap.panels().map((p) => p.id)
  assert.equal(ids[0], 'day', `面板顺序应当是 day 在最前，实得 ${ids.join('、')}`)
  assert.ok(ids.includes('tank'), '鱼缸还在，控制仍然在那一页')
})

test('读数来自作息账，不自己编数', () => {
  const cap = mk(tmp())
  const s = dayGet(cap)({})
  assert.equal(s.ok, true)
  assert.equal(s.today.actionsToday, 3)
  assert.equal(s.today.day, today, '日子按本地日切，不是 UTC')
  assert.ok(s.today.nextInMin >= 3 && s.today.nextInMin <= 5, `下一拍该在 4 分钟左右，实得 ${s.today.nextInMin}`)
  assert.ok(['awake', 'resting', 'asleep'].includes(s.rest), '三态必须给出，前端才能说人话')
  assert.equal(typeof s.described, 'string')
  assert.ok(s.mood && typeof s.mood.intensity === 'number', '心情强度要带着，页面好写成百分比')
})

test('流水只含今天：昨天的账不混进「今天做过什么」', () => {
  const cap = mk(tmp())
  const s = dayGet(cap)({})
  assert.equal(s.eventCountToday, 3, `今天应当 3 条，实得 ${s.eventCountToday}`)
  assert.equal(s.eventCountAll, 5, '总账还是 5 条，过滤只在这一页发生')
  const texts = s.events.map((e) => e.description)
  assert.ok(texts.includes('主人拉了体力') && !texts.includes('昨天看的一条'))
  assert.equal(s.events[0].description, '主人拉了体力', '新→旧')
  // 改了场值的那条要带着 from/to，前端才写得出「体力 0.6→0.8」
  assert.deepEqual(s.events[0].fieldChanges, [{ field: 'energy', from: 0.6, to: 0.8 }])
})

test('账上没动过也不炸：读数是 0，事件是空数组', () => {
  const cap = mk(tmp(), { actionsToday: 0, lastActionAt: 0, nextCheckAt: 0, chain: [] })
  const s = dayGet(cap)({})
  assert.equal(s.today.actionsToday, 0)
  assert.equal(s.events.length, 0)
  assert.equal(s.today.nextInMin, null, '没排下一拍就说"没排"，不许写个 0 分钟')
  assert.equal(s.mode, 'auto')
})

/**
 * 「戳醒她」这一颗按钮在两个页面上都有，但**只能有一份实现**。
 *
 * 宿主的合同校验会拒掉纯只读面板（persona-core 的能力包合同：每个面板至少一个 POST），
 * 所以第一版把这一页做成只读落地页时，整条 hub 起不来——这条测试记下这个约束是真的 enforced，
 * 不是文档里的一句愿望。
 */
test('这一页的写入口只有「戳醒她」，且与鱼缸那份行为一致（回执说清做了什么）', () => {
  const dir = tmp()
  const cap = mk(dir)
  const day = cap.panels().find((p) => p.id === 'day')
  const tank = cap.panels().find((p) => p.id === 'tank')
  const lifeFile = path.join(dir, 'life.json')
  const writable = Object.values(day.methods).filter((m) => m.writable)
  assert.equal(writable.length, 1, `只该有一个写入口，实得 ${writable.map((m) => m.name).join('、')}`)
  assert.equal(writable[0].name, 'wakeNow')

  const r1 = day.methods.wakeNow.invoke({ hint: '先回那条私信' })
  assert.equal(r1.ok, true)
  assert.ok(r1.triggeredAt > 0)
  assert.equal(r1.hint, '先回那条私信')
  assert.ok(Array.isArray(r1.receipt?.did) && r1.receipt.did.length >= 2, '回执要列出做了什么')
  assert.ok(String(r1.receipt?.notYet).includes('因果账'), '回执要诚实说"还没看到什么"，不许承诺她这一轮会说什么')

  // 鱼缸那颗走的是同一个实现：返回值形状与作息账的改动一致
  const r2 = tank.methods.wakeNow.invoke({ hint: '' })
  for (const k of ['ok', 'hint', 'mode', 'delivered', 'receipt']) {
    assert.ok(k in r2, `鱼缸的回执少了 ${k}——两份实现开始漂了`)
  }
  assert.deepEqual(Object.keys(r1.receipt).sort(), Object.keys(r2.receipt).sort())

  // 戳醒真正的效果：作息账的"下一拍"被拨到现在
  const saved = JSON.parse(fs.readFileSync(lifeFile, 'utf8'))
  assert.ok(Math.abs(saved.nextCheckAt - Date.now()) < 60_000, `下一拍该是现在，实得 ${saved.nextCheckAt}`)
})

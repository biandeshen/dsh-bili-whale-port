/**
 * 7 类生活活动接进决策（审计 §"接上死代码"）。
 *
 * `life-activities.ts` 那张表（歇会儿 / 找点新鲜的 / 做点东西 / 想他 / 想想事 / 动一动 / 看点轻松的）
 * 写得很细，却**从来没有生产调用者**——她每次动的理由只有三个词
 * （explore / connect / restless），日账读起来像机器人。
 *
 * 这一条钉住：
 *   1. 动了的时候**带着具体活动**（type / label / description 都在）；
 *   2. 活动**随场值变**：孤独时偏向"想他"，好奇高时偏向"找点新鲜的 / 看点轻松的"，
 *      体力足时偏向"动一动"；
 *   3. 同一类活动不同时辰说法不同（表里本来就按时钟轮换文案）；
 *   4. 不动的时候**不带活动**（不许给她编一件没做的事）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { decideAction } from '../src/rhythm.ts'
import { ACTIVITY_LABELS } from '../src/life-activities.ts'

const DAY = 86400_000

function fields(over = {}) {
  return {
    energy: 0.8,
    stimulation: 0.2,
    connection: 0.8,
    social: 0.5,
    mood: 0,
    curiosity: 0.2,
    creativity: 0.3,
    ...over,
  }
}

const mem = (over = {}) => ({
  day: '2026-11-05',
  actionsToday: 0,
  lastActionAt: 0,
  lastCheckAt: 0,
  lastKind: null,
  ...over,
})

/** rng 恒返回 0 → 概率门必然放行（urge>0 时 0 < urge*CHECK_PROB） */
const alwaysAct = () => 0

test('动了就带具体活动：type/label/description 都在', () => {
  const d = decideAction({
    fields: fields(),
    relation: 'normal',
    now: Date.parse('2026-11-05T10:00:00+08:00'),
    mem: mem(),
    rng: alwaysAct,
  })
  assert.equal(d.act, true)
  const a = d.activity
  assert.ok(a, '决策里要带活动')
  assert.ok(Object.keys(ACTIVITY_LABELS).includes(a.type), `活动类型得是七类之一：${a.type}`)
  assert.equal(a.label, ACTIVITY_LABELS[a.type], 'label 要跟表里一致')
  assert.ok(a.description && a.description.length > 0, '要有说法')
})

test('孤独时偏向"想他"，好奇高时偏向"找点新鲜的/看点轻松的"', () => {
  const now = Date.parse('2026-11-05T10:00:00+08:00')
  // 注意：lastActionAt 要给"最近动过"，不然她算成闲了 999 小时 →
  // 休息压力直接拉满，孤独就被压下去了（那是另一条规则，测的是别的）。
  const justActed = mem({ lastActionAt: now - 3600_000 })
  const lonely = decideAction({
    fields: fields({ connection: 0.02, stimulation: 0.8, curiosity: 0.1, energy: 0.8 }),
    relation: 'normal', now, mem: justActed, rng: alwaysAct,
  })
  assert.equal(lonely.kind, 'connect')
  assert.equal(lonely.activity.type, 'social', '想他那一类')

  const curious = decideAction({
    fields: fields({ connection: 0.9, stimulation: 0.02, curiosity: 0.95, energy: 0.8 }),
    relation: 'normal', now, mem: justActed, rng: alwaysAct,
  })
  assert.equal(curious.kind, 'explore')
  assert.ok(['explore', 'consume', 'create'].includes(curious.activity.type), `好奇高该往新鲜/轻松那边，实得 ${curious.activity.type}`)
})

test('体力足且闲得久 → 偏向"动一动/想想事"，不是歇着', () => {
  const now = Date.parse('2026-11-05T10:00:00+08:00')
  const d = decideAction({
    fields: fields({ energy: 0.95, stimulation: 0.75, connection: 0.9, curiosity: 0.2, creativity: 0.2 }),
    relation: 'normal',
    now,
    // 20 小时没动 → 休息压力拉满
    mem: mem({ lastActionAt: now - 20 * 3600_000 }),
    rng: alwaysAct,
  })
  assert.equal(d.kind, 'restless')
  assert.ok(['exercise', 'reflect', 'rest'].includes(d.activity.type), `实得 ${d.activity.type}`)
})

test('同一类活动不同时辰说法不同（表里按时钟轮换文案）', () => {
  const mk = (hour) => decideAction({
    fields: fields({ connection: 0.02, stimulation: 0.8, curiosity: 0.1 }),
    relation: 'normal',
    now: new Date(2026, 10, 5, hour, 0).getTime(),
    mem: mem(),
    rng: alwaysAct,
  })
  const a = mk(3)
  const b = mk(19)
  const descs = new Set([a.activity.description, b.activity.description])
  assert.ok(descs.size > 1 || a.activity.type !== b.activity.type, '同一类活动在不同时辰该换说法')
})

test('不动的时候不带活动（不许给她编一件没做的事）', () => {
  const d = decideAction({
    fields: fields({ energy: 0.05 }),  // 太累 → tired
    relation: 'normal',
    now: Date.parse('2026-11-05T10:00:00+08:00'),
    mem: mem(),
    rng: alwaysAct,
  })
  assert.equal(d.act, false)
  assert.equal(d.activity, undefined, '没动就没有活动')
})

import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  inSleepWindow, restState, isAsleep, restRecovery,
  DEFAULT_SLEEP_WINDOW, REST_BELOW_ENERGY, SLEEP_AFTER_MS,
} from '../src/life-stages.ts'
import { createStateRhythmCapability } from '../src/index.ts'

/** 把"今天本地 HH:MM"变成一个时间戳（时段判据按本地时间算，测试不能依赖 UTC） */
const at = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

test('睡眠时段：默认 01:00–07:00，跨零点也算，关掉就不算', () => {
  assert.equal(inSleepWindow(at('02:30')), true, '凌晨 2:30 在默认时段内')
  assert.equal(inSleepWindow(at('08:00')), false, '早上 8 点不在')
  assert.equal(inSleepWindow(at('00:59')), false, '01:00 之前不算')
  // 跨零点（23:30–06:00）：夜里 23:50 和凌晨 5 点都算，中午不算
  const cross = { start: '23:30', end: '06:00' }
  assert.equal(inSleepWindow(at('23:50'), cross), true)
  assert.equal(inSleepWindow(at('05:00'), cross), true)
  assert.equal(inSleepWindow(at('12:00'), cross), false)
  // 关掉时段判据（主人传 off）
  assert.equal(inSleepWindow(at('02:30'), null), false)
  // 坏值不猜：起止相同 / 格式不对 → 不判睡
  assert.equal(inSleepWindow(at('03:00'), { start: '04:00', end: '04:00' }), false)
  assert.equal(inSleepWindow(at('03:00'), { start: '4am', end: '7' }), false)
})

test('三态：累了歇着 ≠ 睡着了（主人的原话是"人累了就会休息，她不也能这样"）', () => {
  const day = at('14:00')
  const night = at('03:00')
  const recent = day - 10 * 60_000

  // 白天、精神好、刚做过事 → 醒着
  assert.equal(restState({ lastActionAt: recent }, { energy: 0.8 }, day), 'awake')
  // 白天、体力低 → 歇着（不是睡着，所以不该触发夜间结算）
  assert.equal(restState({ lastActionAt: recent }, { energy: REST_BELOW_ENERGY - 0.05 }, day), 'resting')
  // 夜里 → 睡着，哪怕她刚做过事（时段为主）
  assert.equal(restState({ lastActionAt: night - 60_000 }, { energy: 0.9 }, night), 'asleep')
  // 白天闲够 6 小时 → 也算睡着（熬夜那种）
  assert.equal(restState({ lastActionAt: day - SLEEP_AFTER_MS - 1000 }, { energy: 0.9 }, day), 'asleep')
  // 账上没历史：白天就是白天，不许判成"睡了很久"
  assert.equal(restState({ lastActionAt: 0 }, { energy: 0.9 }, day), 'awake')
  // 主人的强制开关最高优先
  assert.equal(restState({ lastActionAt: recent, mode: 'force_sleep' }, { energy: 0.9 }, day), 'asleep')
  assert.equal(restState({ lastActionAt: day - SLEEP_AFTER_MS * 2, mode: 'force_awake' }, { energy: 0.1 }, day), 'awake')
  // 关掉时段后只按"闲够 6 小时"
  assert.equal(restState({ lastActionAt: night - 60_000, sleepWindow: null }, { energy: 0.9 }, night), 'awake')
})

test('体力恢复：睡着全速、歇着半速、醒着不回（原来"累了"永远回不满）', () => {
  const fields = { energy: 0.2 }
  const asleep = restRecovery(fields, 2, true, false)
  const resting = restRecovery(fields, 2, false, true)
  const awake = restRecovery(fields, 2, false, false)
  assert.ok(asleep > 0, '睡着要回体力')
  assert.equal(awake, 0, '醒着不靠睡觉回体力')
  assert.ok(resting > 0 && resting < asleep, `歇着也要慢慢回（实得 ${resting}，睡着 ${asleep}）`)
})

test('isAsleep 保持布尔契约（老调用方不炸），且不再把"没历史"当睡着', () => {
  assert.equal(isAsleep(0, at('14:00'), 'auto'), false, '没历史 + 白天 ≠ 睡着')
  assert.equal(isAsleep(at('03:00') - 60_000, at('03:30'), 'auto'), true, '夜间时段内 = 睡着')
  assert.equal(isAsleep(at('14:00') - SLEEP_AFTER_MS - 1000, at('14:00'), 'auto'), true, '闲够 6 小时 = 睡着')
  assert.equal(isAsleep(at('14:00') - 60_000, at('14:00'), 'force_sleep'), true, '强制睡')
})

test('能力包：快照给三态，setSleepWindow 可改可关，关掉这件事要存得住', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-sleep-'))
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  fs.writeFileSync(fieldsFile, JSON.stringify({
    schemaVersion: 5,
    fields: { energy: 0.8, stimulation: 0.5, connection: 0.5, social: 0.5, mood: 0.5, curiosity: 0.5, creativity: 0.5 },
    memories: [], chain: [], npcState: { current: 'normal', bond: { level: 0.5 } },
    budget: { day: '2026-11-04', spent: {} }, emotionHistory: [], lastAppliedAt: new Date().toISOString(),
  }))
  fs.writeFileSync(lifeFile, JSON.stringify({ day: '2026-11-04', actionsToday: 0, lastActionAt: Date.now(), mode: 'auto' }))
  const cap = createStateRhythmCapability({ fieldsFile, lifeFile })
  const panel = cap.panels()[0]

  const snap = panel.methods.getSnapshot.invoke()
  assert.ok(['awake', 'resting', 'asleep'].includes(snap.rest), `快照要给三态，实得 ${JSON.stringify(snap.rest)}`)
  assert.deepEqual(snap.sleepWindow, DEFAULT_SLEEP_WINDOW, '没设过就用默认时段')

  const off = panel.methods.setSleepWindow.invoke({ off: true })
  assert.equal(off.ok, true)
  assert.equal(off.sleepWindow, null)
  // 重新读一次：关掉必须还在（不能下一次读档悄悄复原成默认）
  const snap2 = panel.methods.getSnapshot.invoke()
  assert.equal(snap2.sleepWindow, null, 'off 要持久；丢了就等于主人说的"不按时段判睡"被系统忘了')

  const set = panel.methods.setSleepWindow.invoke({ start: '22:30', end: '06:30' })
  assert.equal(set.ok, true)
  assert.deepEqual(panel.methods.getSnapshot.invoke().sleepWindow, { start: '22:30', end: '06:30' })

  // 坏值拒
  assert.equal(panel.methods.setSleepWindow.invoke({ start: '10pm', end: '06:00' }).ok, false)
  assert.equal(panel.methods.setSleepWindow.invoke({ start: '04:00', end: '04:00' }).ok, false)
})

test('lifeAsleep：做梦系统要的判据（夜里没做过事也该算睡着，白天累了不该）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rhythm-dream-'))
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  fs.writeFileSync(fieldsFile, JSON.stringify({
    schemaVersion: 5,
    fields: { energy: 0.2, stimulation: 0.5, connection: 0.5, social: 0.5, mood: 0.5, curiosity: 0.5, creativity: 0.5 },
    memories: [], chain: [], npcState: { current: 'normal', bond: { level: 0.5 } },
    budget: { day: '2026-11-04', spent: {} }, emotionHistory: [], lastAppliedAt: new Date().toISOString(),
  }))
  // 白天 14:00、体力很低、今天一次没做：她在歇着，不做梦
  fs.writeFileSync(lifeFile, JSON.stringify({ day: '2026-11-04', actionsToday: 0, lastActionAt: at('13:00'), mode: 'auto' }))
  const cap = createStateRhythmCapability({ fieldsFile, lifeFile })
  assert.equal(cap.lifeAsleep(at('14:00')), false, '累了歇着 ≠ 睡着，不该跑夜间结算')

  // 凌晨 03:00：睡着（哪怕今天一次没做）——做梦不该取决于她那天忙不忙
  assert.equal(cap.lifeAsleep(at('03:00')), true, '夜间该做梦；遗忘叙事不能看她那天有没有做事')
})

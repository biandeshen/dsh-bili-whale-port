/**
 * 强制作息的"到期自动回 auto"（B13d 收尾项之一）。
 *
 * 缺口长什么样：主人戳一下"保持清醒"是**临时**的意思。以前 `mode` 一落盘就永久生效，
 * 于是她夜里被叫醒之后**再也睡不着**——除非主人手动改回去。
 * 我们把"临时"实现成了"永久"，这是实现偏离了设计，不是主人的意思。
 *
 * 这一条钉三件事：
 *   1. 强制模式可以带到期时间；
 *   2. 到了点**自动回 auto 并落盘**（不是只在内存里假装回 auto）；
 *   3. 没带到期时间的旧账（老 life.json）行为不变——不能因为加了字段就把她的状态改坏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability } from '../src/index.ts'
import { restState, effectiveMode } from '../src/life-stages.ts'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-modeexp-'))
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  const cap = createStateRhythmCapability({ fieldsFile, lifeFile })
  const tank = cap.panels().find((p) => p.id === 'tank')
  return { dir, fieldsFile, lifeFile, cap, tank }
}

const readLife = (lifeFile) => JSON.parse(fs.readFileSync(lifeFile, 'utf8'))

test('effectiveMode：过期了就是 auto（纯函数，不落盘）', () => {
  const now = Date.now()
  assert.equal(effectiveMode({ mode: 'force_awake' }, now), 'force_awake')
  assert.equal(effectiveMode({ mode: 'force_awake', modeExpiresAt: now + 60_000 }, now), 'force_awake')
  assert.equal(effectiveMode({ mode: 'force_awake', modeExpiresAt: now - 1 }, now), 'auto', '过期即 auto')
  assert.equal(effectiveMode({ mode: 'auto', modeExpiresAt: now - 1 }, now), 'auto')
})

test('restState：过期的 force_awake 不再压住睡眠时段', () => {
  const now = Date.now()
  // 过期了 → 该按睡眠时段判：窗口内就是睡着
  const mem = { lastActionAt: now, mode: 'force_awake', modeExpiresAt: now - 1, sleepWindow: { start: '00:00', end: '23:59' } }
  assert.equal(restState(mem, { energy: 1 }, now), 'asleep', '过期后不能再强制清醒')
  // 没过期 → 仍然清醒
  const mem2 = { lastActionAt: now, mode: 'force_awake', modeExpiresAt: now + 60_000, sleepWindow: { start: '00:00', end: '23:59' } }
  assert.equal(restState(mem2, { energy: 1 }, now), 'awake')
})

test('setMode：能带到期时间，到点自动回 auto 且**落盘**', async () => {
  const { tank, lifeFile } = setup()
  const set = await tank.methods.setMode.invoke({ mode: 'force_awake', expiresInMinutes: 30 })
  assert.equal(set.ok, true)
  assert.equal(set.mode, 'force_awake')
  assert.ok(set.modeExpiresAt > Date.now(), '要有到期时间')
  assert.equal(readLife(lifeFile).mode, 'force_awake')
  assert.ok(readLife(lifeFile).modeExpiresAt > 0)

  // 把到期时间改到过去（模拟时间到了）→ 读账时自动收回并落盘
  const life = readLife(lifeFile)
  life.modeExpiresAt = Date.now() - 1000
  fs.writeFileSync(lifeFile, JSON.stringify(life, null, 2))

  const snap = await tank.methods.getSnapshot.invoke({})
  assert.equal(snap.mode, 'auto', '过期后读到的应该是 auto')
  assert.equal(snap.modeExpiresAt, null)
  assert.equal(readLife(lifeFile).mode, 'auto', '落盘也要改回来（不然下次重启还是旧的）')
  assert.equal(readLife(lifeFile).modeExpiresAt, undefined, '过期的到期时间要抹掉')
})

test('setMode：auto 一律清掉到期时间（auto 本身没有"到期"这回事）', async () => {
  const { tank, lifeFile } = setup()
  await tank.methods.setMode.invoke({ mode: 'force_awake', expiresInMinutes: 30 })
  await tank.methods.setMode.invoke({ mode: 'auto' })
  assert.equal(readLife(lifeFile).mode, 'auto')
  assert.equal(readLife(lifeFile).modeExpiresAt, undefined)
})

test('老账没有到期字段时，行为不变（不因为加了字段就改坏她的状态）', async () => {
  const { tank, lifeFile } = setup()
  fs.writeFileSync(lifeFile, JSON.stringify({
    day: '2026-11-05', actionsToday: 1, lastActionAt: Date.now(), lastCheckAt: Date.now(),
    lastKind: 'explore', mode: 'force_awake', nextCheckAt: Date.now() + 60_000,
  }, null, 2))
  const snap = await tank.methods.getSnapshot.invoke({})
  assert.equal(snap.mode, 'force_awake', '没写到期时间的旧账照旧生效')
  assert.equal(snap.modeExpiresAt, null)
})

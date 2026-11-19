import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DreamTick } from '../src/dream-tick.ts'
import { isAsleep } from '../src/index.ts'

test('做梦系统：睡着才结算、同日不重复、强制清醒不做梦、梦话含遗忘叙事', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-'))
  const lifeFile = path.join(dir, 'life.json')
  const writes = []

  const store = {
    settle: (days, threshold) => {
      writes.push({ days, threshold })
      return { decayed: 3, archivedIds: ['a1'], archived: [{ id: 'a1', content: '某晚的雨声长谈' }] }
    },
  }

  // 1. 睡着 → 结算并产出梦话
  const tick = new DreamTick({
    lifeFile,
    isAsleep: (last, now, mode) => mode !== 'force_awake',
    settle: store.settle,
    dreamDigest: (r) => r.archived.length ? `夜里结算记忆：「${r.archived[0].content}」想不太清了，只剩个轮廓。原文都还在。` : null,
    onDream: (digest, count) => {
      writes.push({ digest, count })
      return digest
    },
    intervalMs: 60_000,
  })
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'auto' }), 'utf8')
  const r1 = tick.tickOnce()
  assert.equal(r1.dreamed, true)
  assert.match(r1.digest, /夜里结算记忆/)
  assert.match(r1.digest, /原文都还在/)
  assert.ok(writes.some((w) => w.digest))

  // 2. 同一天不重复结算
  const r2 = tick.tickOnce()
  assert.equal(r2.dreamed, false)

  // 3. 换日（模拟 lastSettleDay 清空）后 force_awake 不做梦
  const tick2 = new DreamTick({
    lifeFile,
    isAsleep,
    settle: store.settle,
    dreamDigest: (r) => `夜里结算 ${r.archived?.length ?? 0} 条`,
    onDream: () => null,
    intervalMs: 60_000,
  })
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'force_awake' }), 'utf8')
  const r3 = tick2.tickOnce()
  assert.equal(r3.dreamed, false)

  /**
   * 4. 醒着（刚动过）不做梦。
   *
   * **这条以前是看天色过的**：只给三个参数的 isAsleep 会套用默认夜间时段，
   * 白天跑通过、凌晨 01:45 跑就挂（2026-11-05 实测）。
   * 现在把时段显式关掉（sleepWindow: null），测的是逻辑而不是当时的钟点。
   */
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: Date.now(), mode: 'auto', sleepWindow: null }), 'utf8')
  const r4 = tick2.tickOnce()
  assert.equal(r4.dreamed, false, '刚动过 + 时段关掉 = 醒着，不该结算')

  // 5. 无归档 → onDream 收到 null 且梦话为 null（不硬凑）
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'auto' }), 'utf8')
  const tick3 = new DreamTick({
    lifeFile,
    isAsleep: () => true,
    settle: () => ({ decayed: 3, archivedIds: [], archived: [] }),
    dreamDigest: () => null,
    onDream: (digest) => { writes.push({ nodream: digest }); return digest },
    intervalMs: 60_000,
  })
  const r5 = tick3.tickOnce()
  assert.equal(r5.dreamed, true)
  assert.equal(r5.digest, null)
})

test('做梦系统要把她账上的睡眠时段带给判定（主人关掉时段，夜里就不该结算）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dream-win-'))
  const lifeFile = path.join(dir, 'life.json')
  const seen = []
  const tick = new DreamTick({
    lifeFile,
    // 记录判定收到的第四个参数：这是"接口收了却不用"那类 bug 的唯一抓法
    isAsleep: (last, now, mode, extra) => { seen.push(extra); return false },
    settle: () => ({ archived: [] }),
    dreamDigest: () => null,
    onDream: () => null,
    intervalMs: 60_000,
  })

  // ① 从没设过时段 → 不该塞 sleepWindow 这个键（让实现方用默认）
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'auto' }), 'utf8')
  tick.tickOnce()
  assert.ok(!Object.hasOwn(seen.at(-1) ?? {}, 'sleepWindow'),
    `没设过时段时不许带 sleepWindow 键（带了就等于替主人做决定），实得 ${JSON.stringify(seen.at(-1))}`)

  // ② 主人显式关掉 → 必须把 null 带到判定里
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'auto', sleepWindow: null }), 'utf8')
  tick.tickOnce()
  assert.ok(seen.at(-1) && seen.at(-1).sleepWindow === null,
    `关掉时段要传达到判定，实得 ${JSON.stringify(seen.at(-1))}`)

  // ③ 主人改了时段 → 原样带过去
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'auto', sleepWindow: { start: '22:00', end: '06:00' } }), 'utf8')
  tick.tickOnce()
  assert.deepEqual(seen.at(-1), { sleepWindow: { start: '22:00', end: '06:00' } },
    '改过的时段要原样带进判定')
})

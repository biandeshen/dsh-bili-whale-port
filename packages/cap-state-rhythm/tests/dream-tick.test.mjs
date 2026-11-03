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
    onDream: () => null,
    intervalMs: 60_000,
  })
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'force_awake' }), 'utf8')
  const r3 = tick2.tickOnce()
  assert.equal(r3.dreamed, false)

  // 4. 醒着（lastActionAt 刚刚）不做梦
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: Date.now(), mode: 'auto' }), 'utf8')
  const r4 = tick2.tickOnce()
  assert.equal(r4.dreamed, false)

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

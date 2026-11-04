import test from 'node:test'
import assert from 'node:assert/strict'
import { LifeHeartbeat, quietLine } from '../src/life-heartbeat.ts'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('心跳：基线到点就投递，空拍按 2^n 退避且封顶 8×', async () => {
  let now = 0
  let fired = 0
  const hb = new LifeHeartbeat({
    now: () => now,
    baseline: () => 20,
    onFire: () => { fired += 1 },
  })
  hb.start()
  await wait(45)
  assert.equal(fired, 1, '第一拍应在基线间隔到点')
  // 空拍退避：倍率 2 → 40ms；再空一拍 4 → 80ms
  await wait(60)
  assert.equal(fired, 2, `退避后的第二拍（约 40ms）应到点，实得 ${fired}`)
  hb.stop()
})

test('心跳：外部事件把退避清零；基线改 0/null 时不投事件但会回来重读', async () => {
  let base = 20
  let fired = 0
  const hb = new LifeHeartbeat({ baseline: () => base, onFire: () => { fired += 1 } })
  hb.noteActivity()
  assert.equal(hb.quietSeconds(), 0)
  hb.start()
  await wait(40)
  assert.ok(fired >= 1, '正常基线要投')
  const before = fired
  base = null // 主人关了心跳
  await wait(60)
  assert.equal(fired, before, '关掉后不该再投事件')
  assert.equal(hb.nextDelay(), null, 'nextDelay 认 null')
  hb.stop()
})

test('quietLine：不足一分钟按秒说，别显示"0 分钟"', () => {
  assert.equal(quietLine(37), '[system] 已安静 37 秒。')
  assert.equal(quietLine(125), '[system] 已安静 2 分钟。')
})

test('nextFireAt 交出的是**下一拍**的真时间（账与事实要对得上）', async () => {
  const seen = []
  const hb = new LifeHeartbeat({
    baseline: () => 20,
    onFire: () => { seen.push(hb.nextFireAt()) },
  })
  hb.start()
  await wait(45)
  assert.ok(seen.length >= 1, '应已投递一拍')
  // 投递那一刻拿到的必须是**下一拍**的时间，且在将来
  assert.ok(seen[0] > Date.now(), `nextFireAt 必须是将来的时间，实得 ${seen[0]}`)
  // 空拍退避后，下一拍应更远（倍率翻倍）
  await wait(120)
  assert.ok(seen.length >= 2, `应已投递多拍，实得 ${seen.length}`)
  assert.ok(seen[1] > seen[0], `退避后下一拍应更远：${seen[0]} → ${seen[1]}`)
  hb.stop()
})

test('心跳关掉时 nextFireAt 也留真时间（不能写 0）', async () => {
  const hb = new LifeHeartbeat({ baseline: () => null, onFire: () => {} })
  hb.start()
  await wait(20)
  assert.ok(hb.nextFireAt() > Date.now(), '关掉心跳也要留一个将来的重读时间')
  hb.stop()
})

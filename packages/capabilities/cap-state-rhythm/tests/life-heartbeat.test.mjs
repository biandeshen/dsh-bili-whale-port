import test from 'node:test'
import assert from 'node:assert/strict'
import { LifeHeartbeat, quietLine } from '../src/life-heartbeat.ts'

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

test('心跳：空拍不再退避——每一拍都按基线来（退避只买到更安静的她）', async () => {
  let fired = 0
  const hb = new LifeHeartbeat({
    baseline: () => 50,
    onFire: () => { fired += 1 },
  })
  hb.start()
  // Windows 定时器粒度约 15ms：基线给 50ms、等 130ms，稳拿两拍。
  // 旧实现在这一拍之后会翻倍到 100ms，再下一拍 200ms——这里能直接抓到它变稀。
  await wait(130)
  assert.ok(fired >= 2, `固定基线该连着投，实得 ${fired} 拍`)
  // 再等一段：仍然按基线来，不该因为"连续空拍"越来越稀
  const at = fired
  await wait(130)
  assert.ok(fired - at >= 2, `空拍也该照着基线来，实得 ${fired - at} 拍`)
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
  const firedAt = []
  const hb = new LifeHeartbeat({
    baseline: () => 20,
    onFire: () => { firedAt.push(Date.now()); seen.push(hb.nextFireAt()) },
  })
  hb.start()
  await wait(45)
  assert.ok(seen.length >= 1, '应已投递一拍')
  // 下一拍的时间必须**晚于这一拍**。
  // 以前这条断言写的是 `seen[0] > Date.now()`——那是拿"断言跑到哪儿"当标准：
  // 机器一忙，等待多拖了十几毫秒，"下一拍"就已经过去了，测试变红；
  // 可它跟心跳对不对没关系（2026-11-05 全量门禁在跑 esbuild 时就是这么红过一次）。
  // 真正要守的是不变量：**下一拍比这一拍晚**。
  assert.ok(seen[0] > firedAt[0], `下一拍必须晚于这一拍：${seen[0]} vs ${firedAt[0]}`)
  await wait(120)
  assert.ok(seen.length >= 2, `应已投递多拍，实得 ${seen.length}`)
  assert.ok(seen[1] > seen[0], `下一拍应在上一拍之后：${seen[0]} → ${seen[1]}`)
  hb.stop()
})

test('心跳关掉时 nextFireAt 也留真时间（不能写 0）', async () => {
  const hb = new LifeHeartbeat({ baseline: () => null, onFire: () => {} })
  hb.start()
  await wait(20)
  assert.ok(hb.nextFireAt() > Date.now(), '关掉心跳也要留一个将来的重读时间')
  hb.stop()
})

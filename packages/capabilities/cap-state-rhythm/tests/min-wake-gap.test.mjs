// 最小唤醒间隔（抄上游 night.minGapMin 的硬下限）—— 2026-11-14。
//
// 上游原文（Alterssss/dsh-bili-whale tools/lib/night-plan.mjs:73-86）：
//   「下限 = cfg.minGapMin（默认 10 分钟）… 改成【硬下限】——窗口挤不下就少醒几次，
//     不自动压缩间隔（主人要的是"每次至少隔 10 分钟"，不是"尽量隔开"）」
//
// 为什么必须补：我们的 tick.intervalMinutes = 0.5（30 秒）是**评估**间隔，不花钱；
// 但一旦 shouldAct=true 就真的叫模型。实测 11-13 那个 run 两次行动之间最短只隔 5 分钟。
import test from 'node:test'
import assert from 'node:assert/strict'
import { LifeHeartbeat, DEFAULT_MIN_WAKE_GAP_MIN } from '../src/life-heartbeat.ts'

/** 可推进的假时钟：setTimeout 由我们手动触发，不用真等。 */
function harness({ baselineMs = 1000, gapMs = 0 } = {}) {
  let nowMs = Date.parse('2026-11-14T12:00:00+08:00')
  const fires = []
  const timers = []
  const hb = new LifeHeartbeat({
    baseline: () => baselineMs,
    minWakeGapMs: () => gapMs,
    onFire: () => fires.push(nowMs),
    now: () => nowMs,
  })
  // 把 setTimeout 换成记录器：记录「计划在什么时候触发」
  const origSetTimeout = globalThis.setTimeout
  const origClearTimeout = globalThis.clearTimeout
  globalThis.setTimeout = (fn, ms) => {
    const t = { at: nowMs + ms, fn, cleared: false }
    timers.push(t)
    return t
  }
  globalThis.clearTimeout = (t) => {
    if (t && typeof t === 'object') t.cleared = true
  }
  /** 把时钟推到指定毫秒并触发所有到期且未取消的定时器 */
  const advance = (ms) => {
    const target = nowMs + ms
    let guard = 0
    while (guard++ < 1000) {
      const due = timers.filter((t) => !t.cleared && t.at <= target).sort((a, b) => a.at - b.at)[0]
      if (!due) break
      due.cleared = true
      nowMs = due.at
      due.fn()
    }
    nowMs = target
  }
  const restore = () => {
    globalThis.setTimeout = origSetTimeout
    globalThis.clearTimeout = origClearTimeout
    hb.stop()
  }
  return { hb, fires, advance, restore, nowMs: () => nowMs }
}

test('最小唤醒间隔默认 10 分钟（抄上游默认值）', () => {
  assert.equal(DEFAULT_MIN_WAKE_GAP_MIN, 10)
})

test('间隔内不唤醒：第 2 次到点但距上次不足 gap → 不 fire', () => {
  const { hb, fires, advance, restore } = harness({ baselineMs: 60_000, gapMs: 10 * 60_000 })
  try {
    hb.start()
    advance(60_000)            // 第 1 拍：距上次(从没醒过)=Infinity → 放行
    assert.equal(fires.length, 1, '第一次应放行（从没醒过不算违反间隔）')
    advance(5 * 60_000)        // 再推进 5 分钟：后续每一拍都是 baseline=1 分钟
    assert.equal(fires.length, 1, '距上次只过了 5 分钟 < 10 分钟，期间任何一拍都不该 fire')
    advance(6 * 60_000)        // 再推进 6 分钟：距上次已 11 分钟
    assert.equal(fires.length, 2, '过了 10 分钟后应恢复唤醒')
  } finally {
    restore()
  }
})

test('gap=0 时不限制（显式关掉这条）', () => {
  const { hb, fires, advance, restore } = harness({ baselineMs: 60_000, gapMs: 0 })
  try {
    hb.start()
    advance(60_000)
    advance(60_000)
    advance(60_000)
    assert.equal(fires.length, 3, 'gap=0 时每拍都该 fire，与加这条之前一致')
  } finally {
    restore()
  }
})

test('两次 fire 的实际间隔不小于 gap（硬下限，不压缩）', () => {
  const gap = 10 * 60_000
  const { hb, fires, advance, restore } = harness({ baselineMs: 60_000, gapMs: gap })
  try {
    hb.start()
    advance(30 * 60_000)
    assert.ok(fires.length >= 3, `30 分钟里至少该醒 3 次，实际 ${fires.length}`)
    for (let i = 1; i < fires.length; i++) {
      const delta = fires[i] - fires[i - 1]
      assert.ok(delta >= gap, `第 ${i} 与第 ${i - 1} 次之间只隔了 ${delta / 60000} 分钟，小于硬下限 10 分钟`)
    }
  } finally {
    restore()
  }
})

test('窗口"放不下就少醒"：gap 变大时唤醒次数单调不增', () => {
  const run = (gapMs) => {
    const { hb, fires, advance, restore } = harness({ baselineMs: 60_000, gapMs })
    try {
      hb.start()
      advance(60 * 60_000)   // 一小时
      return fires.length
    } finally { restore() }
  }
  const noGap = run(0)
  const tenMin = run(10 * 60_000)
  const thirtyMin = run(30 * 60_000)
  assert.ok(tenMin < noGap, `10 分钟间隔应比不限少：${tenMin} vs ${noGap}`)
  assert.ok(thirtyMin <= tenMin, `30 分钟间隔应不多于 10 分钟：${thirtyMin} vs ${tenMin}`)
  // 上限合理性：一小时里 10 分钟硬下限 → 最多 7 次（含首次）
  assert.ok(tenMin <= 7, `10 分钟硬下限下一小时不该醒超过 7 次，实际 ${tenMin}`)
})

test('nextFireAt 反映的是含 gap 的真实时间（账与事实一致）', () => {
  const { hb, fires, advance, restore } = harness({ baselineMs: 60_000, gapMs: 10 * 60_000 })
  try {
    hb.start()
    advance(60_000)
    assert.equal(fires.length, 1)
    const next = hb.nextFireAt()
    // 距上次 fire 不足 10 分钟，所以下一拍被推到 gap 剩余处
    assert.ok(next - fires[0] >= 10 * 60_000,
      `nextFireAt 应至少在上次 fire 之后 10 分钟，实际 ${(next - fires[0]) / 60000} 分钟`)
  } finally {
    restore()
  }
})

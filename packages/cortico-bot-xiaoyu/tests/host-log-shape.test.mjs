import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { XiaoYuPersona } from '../src/cortico-persona.ts'
import { DreamTick } from '../../cap-state-rhythm/src/dream-tick.ts'

/**
 * 2026-11-04 08:24 线上崩过一次，7799 停了半小时。根因不是做梦，是**日志的形状**：
 * Cortico 的 core.log 是 Logger 对象（info/warn/error(msg, data)），不是 (level, msg) 函数；
 * 旧代码写 `this.core?.log?.('info', msg)`，可选调用挡不住"存在但不是函数"，
 * TypeError 从 DreamTick 的 catch 处理器里冒出去 → 框架按未捕获异常关机。
 * 这三条测试就是那次事故的形状：先证明坑是真的，再证明现在踩不着。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-log-'))

/** 宿主 Logger 的形状：对象、带方法、本身不可调用 */
function loggerCore() {
  const lines = []
  return {
    lines,
    log: {
      info: (m, d) => lines.push(['info', m, d]),
      warn: (m, d) => lines.push(['warn', m, d]),
      error: (m, d) => lines.push(['error', m, d]),
      child() { return this.log },
    },
    pushEvent: () => {},
  }
}

test('旧写法确实会炸：core.log 是对象时，可选调用挡不住 TypeError', () => {
  const core = loggerCore()
  assert.throws(() => core?.log?.('info', '做梦'), /is not a function/)
})

test('persona 的 hostLog 认 Logger 对象：能力包 start 的日志写得出、进程不崩', async () => {
  const dir = tmp()
  const p = new XiaoYuPersona({ homeDir: dir, vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' } })
  const core = loggerCore()
  p.attach(core)
  await p.start()
  try {
    // cap-vision 的 start 会经 host.log 记一条 ffmpeg 状态——这条路径就是当年炸掉的那条
    assert.ok(core.lines.length >= 1, `日志要真的落到宿主 Logger 里，实得 ${JSON.stringify(core.lines)}`)
    assert.ok(core.lines.some(([, m]) => String(m).includes('ffmpeg') || String(m).includes('看画面')),
      '至少有一条是视觉能力包的就绪/降级说明')
    assert.ok(core.lines.every(([lv]) => ['info', 'warn', 'error'].includes(lv)), '级别必须是宿主认识的那三个')
  } finally {
    await p.stop()
  }
})

test('心跳接上了：到点走 core.injectDeferred("tick")，没接上时她永远不会自己醒', async () => {
  const dir = tmp()
  const deferred = []
  const core = { ...loggerCore(), injectDeferred: (kind, textFn) => deferred.push([kind, textFn()]) }
  // 基线给 30ms：真实部署是 5 分钟，这里只为让测试跑得动
  const p = new XiaoYuPersona({ homeDir: dir, vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' }, tickDelayMs: () => 30 })
  p.attach(core)
  // 强制这一拍"该动"：批次 10（F1）之后，不该动时 render 返回 null 是**正确行为**，
  // 而这条测试要守的是"心跳接线了 + 文本内容对"，所以把概率门这一拍按下去。
  const rhythm = p.hub.capabilities.find((c) => c.id === 'state-rhythm')
  const real = rhythm.lifeTick.bind(rhythm)
  rhythm.lifeTick = (next) => ({ ...real(next), shouldAct: true, kind: 'explore', reason: '有点无聊，想找点新鲜的看', urge: 0.7 })
  await p.start()
  try {
    await new Promise((r) => setTimeout(r, 120))
    assert.ok(deferred.length >= 1, '心跳到点必须投一拍（重写时漏接的就是这条：她全天 0 次行动）')
    assert.equal(deferred[0][0], 'tick', '投的是 tick 这条通道')
    assert.match(deferred[0][1], /已安静/)
    // 心跳不只是"醒一下"：投递那一刻要顺带把作息账记上并说出理由
    assert.match(deferred[0][1], /【作息对账】/, `心跳文本要带作息账，实得：${deferred[0][1]}`)
    assert.match(deferred[0][1], /今天已做 \d+ 件|这一拍不动|她想动/, '动或不动都得有说法，不许沉默')
  } finally {
    await p.stop()
  }

  // 不给 tickDelayMs = 主人关了心跳：不该投任何拍
  const none = []
  const p2 = new XiaoYuPersona({ homeDir: tmp() })
  p2.attach({ ...loggerCore(), injectDeferred: (k, f) => none.push([k, f()]) })
  await p2.start()
  try {
    await new Promise((r) => setTimeout(r, 80))
    assert.equal(none.length, 0, '没配心跳就不许自己投拍')
  } finally {
    await p2.stop()
  }
})

test('宿主日志坏成什么样都不能带崩做梦循环（错误处理器不是错误源）', async () => {
  const dir = tmp()
  const lifeFile = path.join(dir, 'life.json')
  fs.writeFileSync(lifeFile, JSON.stringify({ lastActionAt: 0, mode: 'sleep' }))
  let ticks = 0
  const dream = new DreamTick({
    lifeFile,
    intervalMs: 5,
    isAsleep: () => true,
    settle: () => { ticks += 1; throw new Error('结算故意炸（模拟真异常）') },
    dreamDigest: () => null,
    onDream: () => null,
    // 日志本身也坏：直接抛——当年就是这样把 TypeError 顶成未捕获异常的
    log: () => { throw new TypeError('this.core?.log is not a function') },
  })
  dream.start()
  await new Promise((r) => setTimeout(r, 60))
  dream.stop()
  assert.ok(ticks >= 3, `日志坏了循环必须照跑，实得 ${ticks} 次 tick`)
})

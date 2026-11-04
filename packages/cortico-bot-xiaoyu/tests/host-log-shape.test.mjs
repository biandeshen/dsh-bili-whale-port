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

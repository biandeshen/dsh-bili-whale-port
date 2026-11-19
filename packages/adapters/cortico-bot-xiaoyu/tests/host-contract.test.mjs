import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { XiaoYuPersona } from '../src/cortico-persona.ts'

/**
 * 宿主契约形状测试：**按 Cortico 真实调用 Persona 的那几个形状来调**，不按我们以为的形状。
 *
 * 为什么单独一个文件（2026-11-04 线上事故）：
 *   systemSegments 宿主给 `{now, timezone, worlds}`（loop.ts:544 确实给全），
 *   onDelivery 宿主只给 `{events}`（loop.ts:693 `persona.onDelivery?.({ events: [...delivered] })`）。
 *   我们照前者的形状写了后者，于是 `ctx.now.getTime()` 每拍抛 TypeError，
 *   **她每次醒来都拿不到心情与记忆召回**，日志里是一片
 *   「onDelivery 注入失败（state-rhythm/memory）：Cannot read properties of undefined (reading 'getTime')」，
 *   而她看起来"醒着却什么都不做"。
 *   同一次还查出：做梦系统拿 `stateRhythm.isAsleep`（能力包对象上没这个字段，
 *   它是模块级导出）→ "isAsleep is not a function"，**她从来没有真的做过梦**。
 *
 * 这两条测试的价值在于：它们用宿主的形状调，而不是用我们自己的假设调。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-contract-'))

/** 只带 events——和 loop.ts:693 一模一样 */
function hostCore() {
  const injected = []
  const warns = []
  return {
    injected,
    warns,
    log: {
      info: (m) => {},
      warn: (m) => warns.push(String(m)),
      error: (m) => warns.push('error:' + String(m)),
    },
    injectInternal: (text) => injected.push(String(text)),
    pushEvent: () => {},
  }
}

test('onDelivery 按宿主真实形状调（只给 events）：注入必须成功，不许静默丢回忆', async () => {
  const p = new XiaoYuPersona({ homeDir: tmp(), vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' } })
  const core = hostCore()
  p.attach(core)
  await p.start()
  try {
    await p.onDelivery({
      events: [{ type: 'channel.message', source: 'console', text: '小鱼，今晚那段雨声 recordings 怎么样', atMs: Date.now() }],
    })
    assert.equal(core.warns.filter((w) => w.includes('注入失败')).length, 0,
      `一条注入失败都不许有，实得：${JSON.stringify(core.warns)}`)
    assert.ok(core.injected.length >= 1, '她醒来必须带上自动回忆/状态注入，不能空着')
    assert.ok(core.injected.every((t) => t.trim().length > 0), '注入的不能是空串')
  } finally {
    await p.stop()
  }
})

test('systemSegments 仍拿得到 now/timezone（宿主给全的那条路径别被改坏）', async () => {
  const p = new XiaoYuPersona({ homeDir: tmp(), vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' } })
  p.attach(hostCore())
  await p.start()
  try {
    const segs = await p.systemSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
    assert.ok(segs.length >= 2, `前缀至少要有宪法与作息两段，实得 ${segs.length}`)
    assert.ok(segs.some((s) => String(s.title).includes('宪法')))
  } finally {
    await p.stop()
  }
})

test('做梦系统拿到的是函数：isAsleep 不许再从能力包对象上找', async () => {
  const dir = tmp()
  const p = new XiaoYuPersona({ homeDir: dir, vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' } })
  p.attach(hostCore())
  await p.start()
  try {
    const dream = p.dream
    assert.ok(dream, '做梦循环必须挂上（B3 交付的那套）')
    // 直接跑一拍：以前这里抛 "isAsleep is not a function"，异常被 catch 吞掉，
    // 于是"她每晚做梦"这件事在账面上存在、在现实里从没发生过。
    const r = dream.tickOnce()
    assert.ok(r && typeof r === 'object', '一拍结算要返回结构化结果')
    assert.ok(!('error' in r && r.error), `结算不许带错误：${JSON.stringify(r)}`)
  } finally {
    await p.stop()
  }
})

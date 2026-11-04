import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { XiaoYuPersona } from '../src/cortico-persona.ts'

/**
 * 作息账的 nextCheckAt 必须等于**心跳下一拍真正会落的时间**。
 *
 * 2026-11-05 线上实测踩到的：账上写"3 分钟后评估"（nextCheckDelay 的 3–7 分钟随机值），
 * 心跳实际在 10 分钟后（5 分钟基线 × 空拍退避 2×）——**账与事实对不上**，
 * 健康检查据此报假警，还让人以为她断了线。
 *
 * 根因链：lifeTick 的 nextCheckAt 守卫是「传进来的时间 > 账上的 now」，
 * 而心跳的下一拍时间若在**投递时刻**才去问（injectDeferred 的 render 是延迟调的），
 * 拿到的值可能已经过期 → 守卫拒绝 → 退回 3–7 分钟随机值。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-tick-'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 宿主形状的 core：injectDeferred 立刻调 render（真实宿主是投递时才调，这里模拟"立刻"）。 */
function coreStub() {
  const injected = []
  return {
    injected,
    log: { info: () => {}, warn: () => {}, error: () => {} },
    injectInternal: (t) => injected.push(String(t)),
    injectDeferred: (kind, render) => { const t = render(); if (t) injected.push(String(t)) },
    pushEvent: () => {},
  }
}

test('作息账的 nextCheckAt = 心跳下一拍的真时间（不是 3–7 分钟随机值）', async () => {
  const dir = tmp()
  const core = coreStub()
  // 基线 100ms：第一拍落在 100ms；空拍退避后下一拍在 200ms。
  // 若账上写的是 nextCheckDelay 的随机值（180–420s），断言会当场抓到。
  const p = new XiaoYuPersona({
    homeDir: dir,
    vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' },
    tickDelayMs: () => 100,
  })
  p.attach(core)
  await p.start()
  try {
    await wait(400)
    const lifeFile = path.join(dir, 'data', 'persona', 'life.json')
    assert.ok(fs.existsSync(lifeFile), `账要落在 ${lifeFile}`)
    const life = JSON.parse(fs.readFileSync(lifeFile, 'utf8'))
    assert.ok(life.lastCheckAt > 0, '账上要有一拍记录')
    const delta = life.nextCheckAt - life.lastCheckAt
    assert.ok(
      delta >= 150 && delta <= 260,
      `nextCheckAt 必须是心跳退避后的真间隔（约 200ms），实得 ${Math.round(delta)}ms`,
    )
  } finally {
    await p.stop()
  }
})

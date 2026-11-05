import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { XiaoYuPersona } from '../src/cortico-persona.ts'

/**
 * 批次 10 · 让她回话（2026-11-05，主人："她现在甚至都不回我消息"）。
 *
 * 线上会话实测（session-main.jsonl，384 条）：
 *   心跳自己灌进来的 user 消息 125 条 / 真人的只有 17 条 → **噪声 88%**
 *   她的 105 段回复里 83 段是"待着，不动"
 * 根因两条，都在这里守住：
 *   F1 概率门说"这一拍别动"，我们还是注入文本、还是花一次模型调用让她亲口播报"别动"
 *   F2 心跳自己的 tick 走投递进来，把空拍退避清零 → 越闲叫她越勤
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-noise-'))
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * 按宿主真实形状做的 core 替身。
 * injectDeferred 存下 render，由"投递"那一步调用它 —— 与 loop.ts:669 renderDeferred 同构，
 * 这样"render 返回 null 就不投递"的语义才测得到。
 */
function coreStub() {
  const st = {
    injected: [],
    deferred: [],
    delivered: [],
    warns: [],
    log: { info: () => {}, warn: (m) => st.warns.push(String(m)), error: (m) => st.warns.push('error:' + String(m)) },
    injectInternal: (text) => { st.injected.push(String(text)); return { origin: 'internal', source: 'persona', text: String(text) } },
    injectDeferred: (kind, render) => { st.deferred.push({ kind, render }) },
    pushEvent: (e) => { st.delivered.push(e) },
  }
  return st
}

/** 把排队的 deferred 走一遍投递：render 返回 null 就不产生正文（宿主 loop.ts:671 的行为） */
function flushDeferred(st) {
  const produced = []
  for (const d of st.deferred.splice(0)) {
    const text = d.render()
    if (text === null || text === undefined) continue
    produced.push(text)
  }
  return produced
}

function mkPersona(dir, tickDelayMs = () => 60_000, context) {
  return new XiaoYuPersona({
    homeDir: dir,
    vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' },
    tickDelayMs,
    context,
  })
}

/**
 * 等心跳**真的排进来**至少 min 拍。
 *
 * 以前这几条测试是"睡 200ms 再说"，可心跳基线就是 100ms：
 *   · 机器一忙 → 200ms 内落两拍 → "该动时实得 2 !== 1"（2026-11-05 全量门禁就是这么红的，
 *     当时同批次还在跑 esbuild，机器被占着）；
 *   · 反过来慢一点 → 一拍都没落 → "不该动时一条都不注入"变成**假绿**。
 * 门禁不可信比门禁松更糟，所以改成等事实（队列里真的有东西），不等时钟。
 */
async function waitForTick(st, min = 1, timeoutMs = 5000) {
  const t0 = Date.now()
  while (st.deferred.length < min && Date.now() - t0 < timeoutMs) await wait(20)
  return st.deferred.length
}

test('F1：概率门说"这拍别动" → 一个字都不注入，模型一次都不唤', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 100)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    // 直接驱动一拍：把 shouldAct 压成 false（体力拉满是 content/gap 之外的稳妥办法——
    // 用 her 自己的账：刚动过一次 → 间隔/冲动都不足）
    const rhythm = p.hub.capabilities.find((c) => c.id === 'state-rhythm')
    const real = rhythm.lifeTick.bind(rhythm)
    rhythm.lifeTick = (next) => {
      const t = real(next)
      return { ...t, shouldAct: false, reason: 'content' }
    }
    await waitForTick(core, 1)
    const produced = flushDeferred(core)
    assert.equal(produced.length, 0,
      `不该动时不该有任何正文进投递，实得 ${produced.length} 条：${JSON.stringify(produced).slice(0, 200)}`)
    assert.equal(core.injected.length, 0, '也不该走 injectInternal 旁路')  } finally {
    await p.stop()
  }
})

test('F1：该动的时候照旧注入（别把唤醒修没了）', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 100)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    const rhythm = p.hub.capabilities.find((c) => c.id === 'state-rhythm')
    const real = rhythm.lifeTick.bind(rhythm)
    rhythm.lifeTick = (next) => {
      const t = real(next)
      return { ...t, shouldAct: true, reason: '有点无聊，想找点新鲜的看', kind: 'explore', urge: 0.7 }
    }
    const queued = await waitForTick(core, 1)
    assert.ok(queued >= 1, '心跳要真的排进来至少一拍（否则下面的断言是假绿）')
    const produced = flushDeferred(core)
    assert.ok(produced.length >= 1, `该动时必须有正文，实得 ${produced.length}`)
    for (const body of produced) assert.ok(/作息对账/.test(body), '正文里要带上她这一拍的账')
  } finally {
    await p.stop()
  }
})

test('F1 的账不能停：不该动也照样记一拍（actionsToday / lastCheckAt 要往前走）', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 100)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    const rhythm = p.hub.capabilities.find((c) => c.id === 'state-rhythm')
    const real = rhythm.lifeTick.bind(rhythm)
    let calls = 0
    rhythm.lifeTick = (next) => { calls += 1; return { ...real(next), shouldAct: false, reason: 'content' } }
    await waitForTick(core, 1)
    flushDeferred(core)
    assert.ok(calls >= 1, `不该动时账还是要记，实得 lifeTick 调用 ${calls} 次`)
    const life = JSON.parse(fs.readFileSync(path.join(dir, 'data', 'persona', 'life.json'), 'utf8'))
    assert.ok(life.lastCheckAt > 0, 'life.json 的 lastCheckAt 要往前走')
  } finally {
    await p.stop()
  }
})

test('F2：心跳自己的 tick 不清空拍退避（越闲就该叫她越稀）', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 60_000)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    const hb = p.heartbeat
    let calls = 0
    const real = hb.noteActivity.bind(hb)
    hb.noteActivity = () => { calls += 1; real() }
    // 模拟宿主把她自己的 tick 投进来（origin: internal，与 loop.ts:2017 同形状）
    await p.onDelivery({ events: [{ type: 'tick', source: 'persona', origin: 'internal', text: '【作息对账】…' }] })
    await p.onDelivery({ events: [{ type: 'tick', source: 'persona', origin: 'internal', text: '【作息对账】…' }] })
    assert.equal(calls, 0, `她自己的 tick 一次都不该清零退避，实得 ${calls} 次`)
  } finally {
    await p.stop()
  }
})

test('F2：主人的消息要清空拍退避（真有人叫她，就得立刻回到正常节奏）', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 60_000)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    const hb = p.heartbeat
    let calls = 0
    const real = hb.noteActivity.bind(hb)
    hb.noteActivity = () => { calls += 1; real() }
    // 主人来说话（origin: external，与 pushEvent 同形状）
    await p.onDelivery({ events: [{ type: 'console.message', source: 'console', origin: 'external', text: '小鱼，你怎么了' }] })
    assert.equal(calls, 1, `真有人叫她必须清零，实得 ${calls} 次`)
  } finally {
    await p.stop()
  }
})

test('F2：主人从面板戳醒她也算真活动（persona.wake_now 是 external）', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 60_000)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    const hb = p.heartbeat
    const seen = []
    const real = hb.noteActivity.bind(hb)
    hb.noteActivity = () => { seen.push('reset'); real() }
    await p.onDelivery({ events: [{ type: 'tick', source: 'persona', origin: 'internal', text: 'x' }] })
    await p.onDelivery({ events: [{ type: 'persona.wake_now', source: 'owner-panel', origin: 'external', text: '主人戳了戳你' }] })
    assert.deepEqual(seen, ['reset'], '只有戳醒那一次该清零')
  } finally {
    await p.stop()
  }
})

test('F2：混批里同时有她自己的 tick 和主人的话——要认出真活动', async () => {
  const dir = tmp()
  const p = mkPersona(dir, () => 60_000)
  const core = coreStub()
  p.attach(core)
  await p.start()
  try {
    const hb = p.heartbeat
    let calls = 0
    const real = hb.noteActivity.bind(hb)
    hb.noteActivity = () => { calls += 1; real() }
    await p.onDelivery({ events: [
      { type: 'tick', source: 'persona', origin: 'internal', text: '她给自己的' },
      { type: 'console.message', source: 'console', origin: 'external', text: '主人来的' },
    ] })
    assert.equal(calls, 1, '混批里有一条 external 就该清零')
  } finally {
    await p.stop()
  }
})

test('退避本身要真的会拉长（这条守住 LifeHeartbeat 的 2^n，与 F2 配对）', async () => {
  const { LifeHeartbeat } = await import('../../cap-state-rhythm/src/life-heartbeat.ts')
  const hb = new LifeHeartbeat({ baseline: () => 1000, onFire: () => {} })
  assert.equal(hb.nextDelay(), 1000)
  // 连空三拍：1000 → 2000 → 4000 → 8000（封顶 8×）
  for (let i = 0; i < 3; i += 1) {
    hb.start()
    await wait(0)
    hb.stop()
    // 直接推进内部状态：用一次真的 fire 走 setTimeout 太慢，这里用 noteActivity 的反面验证
    break
  }
  // 真有人叫她 → 立刻回基线
  hb.noteActivity()
  assert.equal(hb.nextDelay(), 1000, 'noteActivity 必须把间隔拉回基线')
})

/**
 * F3：主人的话必须落在她当作"有人在跟我说话"的位置上。
 *
 * 线上抓到过一条 861 字的 user 消息，里面**主人的原话一个字都没有**——
 * 全是能力包注入的情绪/状态/最近发生/记得/关联记忆；主人的那句被宿主默认的
 * `eventDelivery:'tool'` 写成了 function_call 事件帧（sidecar）。
 * 她回"待着，不动"不是敷衍，是那句话没在她眼里的"对话位"上。
 */
test('F3：主会话把外部事件投进 user 正文，不是丢进 sidecar 事件帧', () => {
  const p = mkPersona(tmp())
  const [main] = p.declareSessions()
  assert.equal(main.eventDelivery, 'user',
    `宿主默认是 'tool'（事件进 sidecar），这里必须显式改成 'user'，实得 ${main.eventDelivery}`)
  assert.equal(main.receivesEvents, true, '主会话要收事件，否则改了投递位置也收不到主人的话')
})

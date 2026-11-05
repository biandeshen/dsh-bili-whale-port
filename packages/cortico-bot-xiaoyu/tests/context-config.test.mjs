import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { XiaoYuPersona } from '../src/cortico-persona.ts'
import { contextStageConfigGroup, XIAOYU_CONTEXT_DEFAULTS } from '../src/context-config.ts'
import { createXiaoyuBotDefinition } from '../src/cortico-definition.ts'

/**
 * 控制面第 1 层：上下文预算（2026-11-04）。
 *
 * 主人的原话是"上下文长度设不了"。诊断结论不是功能缩水，是**配置面没跟着迁移**：
 * 宿主从 bot 的 `webUi.configGroups` 收拢「配置」页签（src/bot.ts:940），
 * 小鱼一个都没声明，于是她的页面上连配置页签都不生成。
 *
 * 这个文件守两件事：
 *   ① 声明本身形状对（宿主 isConfigGroup 会挑掉形状不对的组）；
 *   ② **旋钮真的有用**——改了预算，她会在超软阈值时提醒、下一批仍超就请求交接。
 *      只声明不消费，等于造了一个改了没反应的摆设，那比没有更坏。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-ctx-'))

test('配置组形状与宿主 isConfigGroup 一致（id / owner / schema.properties 都在）', () => {
  const g = contextStageConfigGroup('xiaoyu')
  assert.equal(g.id, 'xiaoyu')
  assert.equal(g.owner, 'persona')
  assert.equal(g.schema.type, 'object')
  assert.equal(typeof g.schema.title, 'string')
  const keys = Object.keys(g.schema.properties)
  assert.deepEqual(keys.sort(), ['context.firstTurn', 'context.keepRatio', 'context.maxTokens', 'context.softRatio'])
  for (const k of keys) {
    const p = g.schema.properties[k]
    assert.ok(p.title, `${k} 缺 title`)
    assert.ok(['integer', 'number', 'boolean'].includes(p.type), `${k} 的 type 宿主不支持：${p.type}`)
  }
  // 热改标记：改完不用重启
  for (const k of keys) assert.equal(g.schema.properties[k]['x-hot'], true, `${k} 应当是热改项`)
})

test('bot 声明了 persona 配置组（宿主据此生成「配置」页签）', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const parts = def.build({ config: def.defaults(), memoryDir: tmp() })
  const groups = parts.webUi?.configGroups ?? []
  // 2026-11-05 起是两组：上下文预算（这批）+ 心跳间隔（tick-config.test.mjs）
  assert.equal(groups.length, 2, `应当声明两组配置，实得 ${groups.length}`)
  assert.ok(groups.every((g) => g.owner === 'persona'), '都归 persona 所有')
  assert.equal(groups[0].id, 'xiaoyu', '上下文这一组仍叫 xiaoyu（老键位不动）')
})

test('默认配置里带着上下文预算（不是只在页面上的空声明）', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const cfg = def.defaults()
  assert.equal(cfg.context.maxTokens, XIAOYU_CONTEXT_DEFAULTS.maxTokens)
  assert.equal(cfg.context.softRatio, XIAOYU_CONTEXT_DEFAULTS.softRatio)
  assert.equal(cfg.context.keepRatio, XIAOYU_CONTEXT_DEFAULTS.keepRatio)
  assert.equal(cfg.context.firstTurn, false)
})

test('软阈值以下：什么都不做（不许乱提醒）', async () => {
  const p = new XiaoYuPersona({
    homeDir: tmp(),
    vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' },
    context: () => ({ maxTokens: 1000, softRatio: 0.85, keepRatio: 0.3, firstTurn: false }),
  })
  const injected = []
  const handed = []
  p.attach({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    injectInternal: (t) => injected.push(String(t)),
    sessionInfo: () => ({ id: 'main', estTokens: 500, hardTokens: 2000 }),
    requestContextHandoff: () => { handed.push(1); return true },
  })
  await p.start()
  try {
    p.onBatchEnd()
    assert.equal(injected.length, 0, '没超阈值不该注入提醒')
    assert.equal(handed.length, 0, '没超阈值不该请求交接')
  } finally {
    await p.stop()
  }
})

test('超软阈值：先提醒；再超一次才请求交接（提醒与交接都留痕）', async () => {
  const p = new XiaoYuPersona({
    homeDir: tmp(),
    vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' },
    context: () => ({ maxTokens: 1000, softRatio: 0.85, keepRatio: 0.3, firstTurn: false }),
  })
  const injected = []
  const handed = []
  p.attach({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    injectInternal: (t) => injected.push(String(t)),
    sessionInfo: () => ({ id: 'main', estTokens: 950, hardTokens: 2000 }),
    requestContextHandoff: () => { handed.push(1); return true },
  })
  await p.start()
  try {
    p.onBatchEnd()
    assert.equal(injected.length, 1, `超阈值应先提醒一次，实得 ${injected.length}`)
    assert.ok(injected[0].includes('上下文压力'), '提醒里要说明是上下文压力')
    assert.equal(handed.length, 0, '第一次还不该交接')

    p.onBatchEnd()
    assert.equal(handed.length, 1, `仍超就该请求交接，实得 ${handed.length}`)

    // 交接后回到阈值内：提醒状态要复位，下次再超才重新提醒
    injected.length = 0
    p.attach({
      log: { info: () => {}, warn: () => {}, error: () => {} },
      injectInternal: (t) => injected.push(String(t)),
      sessionInfo: () => ({ id: 'main', estTokens: 100, hardTokens: 2000 }),
      requestContextHandoff: () => { handed.push(1); return true },
    })
    p.onBatchEnd()
    assert.equal(injected.length, 0)
    assert.equal(handed.length, 1)
  } finally {
    await p.stop()
  }
})

test('预算改了立刻生效（每拍现读，不缓存）', async () => {
  let maxTokens = 1000
  const p = new XiaoYuPersona({
    homeDir: tmp(),
    vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' },
    context: () => ({ maxTokens, softRatio: 0.85, keepRatio: 0.3, firstTurn: false }),
  })
  const injected = []
  p.attach({
    log: { info: () => {}, warn: () => {}, error: () => {} },
    injectInternal: (t) => injected.push(String(t)),
    sessionInfo: () => ({ id: 'main', estTokens: 950, hardTokens: 2000 }),
    requestContextHandoff: () => true,
  })
  await p.start()
  try {
    p.onBatchEnd()
    assert.equal(injected.length, 1, '950 > 1000×0.85 应当提醒')
    // 主人把预算调大到 100000：950 不再超阈值
    maxTokens = 100000
    injected.length = 0
    p.onBatchEnd()
    assert.equal(injected.length, 0, '调大预算后不该再提醒（说明没有缓存旧值）')
  } finally {
    await p.stop()
  }
})

test('core 不可用时不许抛（宿主在 persona 就绪前可能还没 attach）', async () => {
  const p = new XiaoYuPersona({
    homeDir: tmp(),
    vision: { ffmpegPath: 'C:/fake/ffmpeg.exe' },
    context: () => ({ maxTokens: 1000, softRatio: 0.85, keepRatio: 0.3, firstTurn: false }),
  })
  await p.start()
  try {
    assert.doesNotThrow(() => p.onBatchEnd())
  } finally {
    await p.stop()
  }
})

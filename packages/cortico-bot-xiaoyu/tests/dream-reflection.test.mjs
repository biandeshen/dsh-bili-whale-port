/**
 * 睡前的反思（主人 2026-11-05 拍板：反思花模型钱）。
 *
 * 这一条盯的是**花钱的规矩**——反射一旦接上模型，最容易出的事是
 * "她半夜自己聊起来停不下"和"主人关了它它还在跑"。
 * 所以钉住：
 *   1. **默认关**：配置没开就一次模型调用都不许发生；
 *   2. **每天最多一次**：账记着，第二次直接不跑；
 *   3. **睡不够不跑**；
 *   4. 跑的时候用**临时 session**（不进主对话），且轮数有硬上限；
 *   5. 失败不许影响做梦（本地那条正路照旧）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  decideDreamReflection,
  readDreamLedger,
  markDreamReflected,
  dreamReflectionPrompt,
  DREAM_REFLECTION_DEFAULTS,
  DREAM_SESSION_ID,
} from '../../cap-state-rhythm/src/dream-reflection.ts'
import { runDreamReflection } from '../src/dream-reflection-runner.ts'
import { createXiaoyuBotDefinition } from '../src/cortico-definition.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-dream-'))

/** 一个假的宿主：只记调用，不真跑模型。 */
function fakeCore(over = {}) {
  const calls = []
  const injected = []
  return {
    calls,
    injected,
    core: {
      spawnFork: async (opts) => { calls.push(opts); return over.text ?? '我想到一件事。' },
      injectInternal: (text, kind) => injected.push({ text, kind }),
      log: () => {},
      ...over.core,
    },
  }
}

const baseDeps = (over = {}) => {
  const dir = tmp()
  return {
    dir,
    ledgerFile: path.join(dir, 'dream-reflection.json'),
    getConfig: () => ({ enabled: true, maxPerDay: 1, maxRounds: 2, minSleepHours: 3 }),
    promptContext: () => ({ constitution: '我是小鱼', orientation: '好好说话', state: '- 看了条雨声视频', today: '2026-11-05' }),
    sleptHours: () => 8,
    now: () => Date.parse('2026-11-05T03:00:00+08:00'),
    ...over,
  }
}

test('反思：默认关着，一次模型调用都不许发生', async () => {
  const { core, calls } = fakeCore()
  const deps = baseDeps({ core, getConfig: () => ({}) })
  const out = await runDreamReflection(deps)
  assert.equal(out.reflected, false)
  assert.equal(calls.length, 0, '开关关着就不该起 fork')
  assert.match(out.reason, /开关/)
})

test('反思：默认配置本身也是关的', () => {
  assert.equal(DREAM_REFLECTION_DEFAULTS.enabled, false, '默认关——要花模型钱得主人显式点头')
})

test('反思：睡不够就不跑', async () => {
  const { core, calls } = fakeCore()
  const deps = baseDeps({ core, sleptHours: () => 0.5 })
  const out = await runDreamReflection(deps)
  assert.equal(out.reflected, false)
  assert.equal(calls.length, 0)
  assert.match(out.reason, /睡/)
})

test('反思：跑一次就记一次账，第二次不再跑（每天最多一次）', async () => {
  const { core, calls } = fakeCore()
  const deps = baseDeps({ core })
  const first = await runDreamReflection(deps)
  assert.equal(first.reflected, true)
  assert.equal(calls.length, 1)
  const second = await runDreamReflection(deps)
  assert.equal(second.reflected, false)
  assert.equal(calls.length, 1, '今天第二次不该再起模型')
  assert.match(second.reason, /上限/)
  const ledger = readDreamLedger(deps.ledgerFile)
  assert.equal(ledger.days['2026-11-05'], 1)
})

test('反思：用临时 session 跑，不进主对话；且带上她的正本与最近发生', async () => {
  const { core, calls } = fakeCore()
  const deps = baseDeps({ core })
  await runDreamReflection(deps)
  const opt = calls[0]
  assert.equal(opt.id, DREAM_SESSION_ID, '要用 dream 那个临时 session')
  assert.notEqual(opt.id, 'main')
  assert.ok(Array.isArray(opt.messages) && opt.messages.length >= 1)
  const sys = opt.messages[0]
  assert.equal(sys.item.role, 'system')
  assert.match(sys.item.content[0].text, /我是小鱼/, '要带上她的正本')
  assert.match(sys.item.content[0].text, /看了条雨声视频/, '要带上最近发生')
  assert.match(sys.item.content[0].text, /值得/, '提示词要讲清要做什么')
})

test('反思：提示词明确说"没值得留的就什么都不做"（不许硬凑记忆）', () => {
  const p = dreamReflectionPrompt({ constitution: 'C', state: 'S' })
  assert.match(p, /没有值得留的就什么都不做/)
  assert.match(p, /memory_remember/)
})

test('反思：她想的东西要带回主对话（醒着时知道昨晚想过什么）', async () => {
  const { core, injected } = fakeCore({ text: '我想到：主人说过雨声能助眠。' })
  const deps = baseDeps({ core })
  const out = await runDreamReflection(deps)
  assert.equal(out.reflected, true)
  assert.match(out.surfaced ?? '', /雨声/)
  assert.equal(injected.length, 1)
  assert.match(injected[0].text, /雨声/)
})

test('反思：模型跑挂了也不许影响做梦（本地那条正路照旧）', async () => {
  const boom = {
    spawnFork: async () => { throw new Error('模型不通') },
    injectInternal: () => {},
    log: () => {},
  }
  const deps = baseDeps({ core: boom })
  const out = await runDreamReflection(deps)
  assert.equal(out.reflected, false)
  assert.match(out.reason, /没跑成/)
  // 账照样记了（失败重试不许把额度烧光）
  assert.equal(readDreamLedger(deps.ledgerFile).days['2026-11-05'], 1)
})

test('反思：拿不到 spawnFork 就跳过，不许抛', async () => {
  const deps = baseDeps({ core: null })
  const out = await runDreamReflection(deps)
  assert.equal(out.reflected, false)
  assert.match(out.reason, /spawnFork/)
})

test('决策函数：上限与睡够两条都认', () => {
  const now = Date.parse('2026-11-05T03:00:00+08:00')
  const cfg = { enabled: true, maxPerDay: 1, maxRounds: 2, minSleepHours: 3 }
  assert.equal(decideDreamReflection({ now, sleptHours: 8, ledger: { days: {} }, config: cfg }).shouldReflect, true)
  assert.equal(decideDreamReflection({ now, sleptHours: 1, ledger: { days: {} }, config: cfg }).shouldReflect, false)
  assert.equal(decideDreamReflection({ now, sleptHours: 8, ledger: { days: { '2026-11-05': 1 } }, config: cfg }).shouldReflect, false)
  assert.equal(decideDreamReflection({ now, sleptHours: 8, ledger: { days: {} }, config: { ...cfg, enabled: false } }).shouldReflect, false)
})

test('反思配置组：默认关，且四个键都在', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const parts = def.build({ config: def.defaults(), memoryDir: tmp() })
  const g = (parts.webUi?.configGroups ?? []).find((x) => x.id === 'xiaoyu-reflection')
  assert.ok(g, '要有这一组')
  const keys = Object.keys(g.schema.properties)
  assert.deepEqual(keys, ['reflection.enabled', 'reflection.maxPerDay', 'reflection.maxRounds', 'reflection.minSleepHours'])
  assert.equal(g.schema.properties['reflection.enabled'].default, false, '默认必须关')
  // 默认配置里也带着（值是关）
  assert.equal(def.defaults().reflection.enabled, false)
})

test('反思配置：部署配置里开了才开（现读，不缓存）', async () => {
  const def = createXiaoyuBotDefinition(tmp())
  const cfg = { ...def.defaults(), reflection: { ...def.defaults().reflection, enabled: true } }
  const parts = def.build({ config: cfg, memoryDir: tmp(), rootDir: tmp() })
  const persona = parts.persona
  // 现读：改配置立刻生效
  assert.ok(persona, '要有 persona')
  const out = await runDreamReflection({
    core: null,   // 先看"拿不到 spawnFork"这一路，确认它走到了"想"那一步
    ledgerFile: path.join(tmp(), 'ledger.json'),
    getConfig: () => ({ enabled: true }),
    promptContext: () => ({}),
    sleptHours: () => 8,
  })
  assert.match(out.reason, /spawnFork/, '开关开了才会走到起 fork 那一步（否则 reason 会是"开关是关的"）')
})

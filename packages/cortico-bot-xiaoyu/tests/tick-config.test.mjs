import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createXiaoyuBotDefinition } from '../src/cortico-definition.ts'
import { tickConfigGroup, XIAOYU_TICK_DEFAULTS } from '../src/tick-config.ts'

/**
 * 控制面第 5 组旋钮：心跳间隔（2026-11-05，设计交接 story-4「旋钮全上页面」）。
 *
 * 这条的价值不在"能不能改"，而在**改了之后她的行为立刻跟着变**：
 * `tickDelayMs` 是每拍现读同一个 config 对象的闭包，所以主人在页面上下 5 分钟 → 1 分钟，
 * 下一拍就按 1 分钟排，不用重启。只声明不消费等于摆了个假旋钮——所以这里断言的是行为，不是形状。
 */

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'xiaoyu-tick-'))

test('心跳配置组形状对（宿主 isConfigGroup 会挑掉形状不对的组）', () => {
  const g = tickConfigGroup('xiaoyu')
  assert.equal(g.id, 'xiaoyu')
  assert.equal(g.owner, 'persona')
  assert.equal(g.schema.type, 'object')
  assert.ok(g.schema.title, '页面分组要有标题')
  const keys = Object.keys(g.schema.properties)
  assert.deepEqual(keys, ['tick.intervalMinutes'], '只声明代码里真读的键，别挂改了没反应的旋钮')
  const p = g.schema.properties['tick.intervalMinutes']
  assert.equal(p.type, 'integer')
  assert.ok(p.title, '缺 title 页面上只剩键名')
  assert.equal(p['x-hot'], true, '热改：改完不该等重启')
})

test('默认配置带着心跳间隔（不是只在页面上的空声明）', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const cfg = def.defaults()
  assert.equal(cfg.tick.intervalMinutes, XIAOYU_TICK_DEFAULTS.intervalMinutes)
})

test('bot 一次声明三组配置：上下文预算 + 心跳 + 记忆分层（宿主据此生成「配置」页签）', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const parts = def.build({ config: def.defaults(), memoryDir: tmp() })
  const groups = parts.webUi?.configGroups ?? []
  assert.equal(groups.length, 3, `应当声明三组，实得 ${groups.length}`)
  assert.deepEqual(groups.map((g) => g.schema.title).sort(), ['上下文与交接', '心跳与作息', '记忆分层与遗忘'])
})

/**
 * 组 id 不许撞车。
 *
 * 宿主保存配置是 `POST /api/config { group, values }`，服务端按 `group` 找组、
 * 再用**那一组的 schema** 校验 values（Cortico `src/web/server.ts` 的 POST /api/config）。
 * 两组都用 'xiaoyu' 时，页面点开心跳的保存会被上下文组的 schema 拒掉 → 400，
 * 主人看到的是"这个旋钮改了没反应"。2026-11-05 真浏览器点出来的，不是推出来的。
 */
test('各组配置各自有独立 id（撞车会串组校验，保存直接 400）', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const parts = def.build({ config: def.defaults(), memoryDir: tmp() })
  const groups = parts.webUi?.configGroups ?? []
  const ids = groups.map((g) => g.id)
  assert.deepEqual(ids, ['xiaoyu', 'xiaoyu-tick', 'xiaoyu-memory'])
  assert.equal(new Set(ids).size, ids.length, `配置组 id 重复：${ids.join('、')}`)
  // 每组只管自己的键：跨组重名也说明会串
  const keys = groups.flatMap((g) => Object.keys(g.schema.properties))
  assert.equal(new Set(keys).size, keys.length, `配置键重复：${keys.join('、')}`)
})

test('间隔是每拍现读的：页面上改完不重启就生效', () => {
  const def = createXiaoyuBotDefinition(tmp())
  const config = def.defaults()
  const parts = def.build({ config, memoryDir: tmp() })
  const hb = parts.persona.heartbeat
  assert.ok(hb, '心跳要真的挂上了（重写时漏接的就是这一条）')

  config.tick.intervalMinutes = 5
  assert.equal(hb.nextDelay(), 5 * 60_000, '5 分钟')

  // 主人把间隔调到 1 分钟：不用重建 persona，下一拍就是 1 分钟
  config.tick.intervalMinutes = 1
  assert.equal(hb.nextDelay(), 60_000, '改完立刻按新值排（热改）')

  // 0 = 关掉她自己醒的那一拍；返回 null 时心跳不投递，但会定期回来重读策略
  config.tick.intervalMinutes = 0
  assert.equal(hb.nextDelay(), null, '0 应当等于关闭，而不是退化成 5 分钟')

  // 键整个没了（旧部署的 config.json 没写过 tick）也当作关
  delete config.tick.intervalMinutes
  assert.equal(hb.nextDelay(), null, '缺键不该擅自给她定一个节奏')

  // 再打开：同一份对象，立刻恢复
  config.tick.intervalMinutes = 10
  assert.equal(hb.nextDelay(), 10 * 60_000, '关掉再开也立刻生效')
})

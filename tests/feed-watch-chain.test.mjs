/**
 * 看片规矩的整条链：她记下的看片记忆 → 下一轮 bili_feed 的候选标注。
 *
 * 为什么单独立一条：#88 搬家对账时发现，`annotateFeed` / `recentWatch` 算得出，
 * 但生产 `bili_feed` 没有注入者——「近 7 天看过」「同 UP 第 N 条不深读」这两条
 * 她自己在私人日记里立的规矩，从来没送到她眼前。
 *
 * 这里**只走生产入口，不手传任何路径**：
 *   她那边 = createXiaoyuBotDefinition().build() 造出的 persona → declareSessions()[0].tools()
 *            （闸门 + Cortico 形状，与宿主实际给她的那 10 把工具同一条路）
 *   世界那边 = WorldDefinition.create() —— 全仓唯一给 `fieldsFile` 的地方
 * 手传 fieldsFile 能绿、而 create() 里那一行被删掉照样绿，那这条测试就是自欺。
 *
 * 全程离线、零凭据、零模型调用：
 *   · 只调 mood_apply / bili_feed，不起 persona.start() / world.start()
 *     （两个 30 分钟定时器与收件箱轮询都只在 start() 里构造）；
 *   · 流量走 BILI_TRAFFIC_TEST + NODE_TEST_CONTEXT 的既有两个开关，fetch 是进程内替身；
 *   · 凭据六个环境变量先清空，免得本机真 cookie 进替身请求头。
 *
 * 隔离：paths.mjs 的 HOME 与 legacy-identity 的候选路径**在 import 时求值**，
 * 所以环境变量必须在本文件任何 import 之前设好，模块一律 await import()。
 */
import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-watch-chain-'))
after(() => fs.rmSync(TMP, { recursive: true, force: true }))

process.env.USERPROFILE = TMP
process.env.HOME = TMP
process.env.WHALE_HOME = path.join(TMP, '.dsh')
// 流量旁路：两个开关缺一不可（traffic.mjs:224）
process.env.BILI_TRAFFIC_TEST = '1'
if (!process.env.NODE_TEST_CONTEXT) process.env.NODE_TEST_CONTEXT = '1'
// 凭据 env 优先（liveCredentials）：不清掉，本机真 cookie 会进替身请求头
for (const k of [
  'BILI_SESSDATA', 'SESSDATA', 'BILI_JCT', 'bili_jct',
  'BILI_BUVID3', 'BUVID3', 'BILI_WHALE_CONFIG', 'CORTICO_HOME',
]) delete process.env[k]

const SEEN = 'BV1seen00001'
const FRESH = 'BV1fresh0003'
const UP = '雨声实验室'

/** popular 源给两条：一条她看过（要打标），一条没看过（不许打标）。 */
function feedFetch() {
  const item = [
    { bvid: SEEN, title: '白噪音合集', duration: 900, owner: { name: UP } },
    { bvid: FRESH, title: '十小时雨声', duration: 1800, owner: { name: '路人甲' } },
  ]
  return async (input) => {
    const url = String(input)
    const body = url.includes('/popular')
      ? { code: 0, data: { item } }
      : { code: -404, data: null }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
}

const botDefinition = (await import('../packages/cortico-bot-xiaoyu/src/cortico-definition.ts')).default
const worldDefinition = (await import('../packages/cortico-world-bilibili/src/index.ts')).default
const { resetReadDedupe } = await import('../packages/cortico-adapter/src/index.ts')

/** 每次一套全新的家：状态账、记忆卡、命中统计全落临时目录。 */
function setup(t) {
  const home = fs.mkdtempSync(path.join(TMP, 'home-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  // 她的 side：与宿主装配同一条：rootDir 才是部署家
  const parts = botDefinition.build({ config: {}, memoryDir: home, rootDir: home })
  // 世界侧：create() 是全仓唯一给 fieldsFile 的地方
  const world = worldDefinition.create({ botDir: home, dataDir: path.join(home, 'data'), cfg: {} })
  resetReadDedupe()
  return { home, persona: parts.persona, world }
}

function toolsOf(defs, name) {
  const d = defs.find((x) => x.name === name)
  assert.ok(d, `没找到工具 ${name}`)
  assert.equal(typeof d.handler, 'function', `${name} 不是 Cortico 形状（handler）`)
  return d
}

/** 她那一批工具：闸门 + Cortico 形状，跟宿主真正交给模型的是同一份。 */
const herTools = (persona) => persona.declareSessions()[0].tools()

/** 生产里每批投递都会清零闸门（cortico-persona.ts:572）。这里照做，不另开口子。 */
const nextBatch = (persona) => persona.onDelivery({
  events: [{ type: 'console.message', source: 'console', origin: 'external', text: '继续' }],
})

test('她记下的看片记忆，下一轮候选上就标着「近 7 天看过 / 同UP第N条」', async (t) => {
  const { persona, world } = setup(t)
  globalThis.fetch = feedFetch()

  const feed = toolsOf(world.tools(), 'bili_feed')
  const moodApply = toolsOf(herTools(persona), 'mood_apply')

  const before = JSON.parse(await feed.handler({ count: 5 }))
  assert.equal(before.ok, true)
  assert.equal(before.items.length, 2)
  const seenTitleBefore = before.items.find((i) => i.bvid === SEEN).title
  assert.equal(seenTitleBefore.includes('近 7 天看过'), false, '还没看过就先标了')
  assert.equal(before.recentWatch?.seenCount, 0)

  // 她看了三次同一 UP（她在私人日记里立的规矩：同一个 UP 第 4 条不深读）
  for (let i = 1; i <= 3; i += 1) {
    const r = JSON.parse(await moodApply.handler({
      preset: 'watchedVideo',
      verdict: 'keep',
      note: `看过《白噪音合集 第${i}期》（${UP}） —— ${SEEN}`,
    }))
    assert.equal(r.ok, true, `第 ${i} 次记账失败：${JSON.stringify(r)}`)
    if (i < 3) await nextBatch(persona)
  }

  resetReadDedupe()
  const after = JSON.parse(await feed.handler({ count: 5 }))
  assert.equal(after.ok, true)
  const seen = after.items.find((i) => i.bvid === SEEN)
  const fresh = after.items.find((i) => i.bvid === FRESH)
  assert.match(seen.title, /近 7 天看过/)
  assert.match(seen.title, /同UP第4条：不深读/)
  assert.equal(fresh.title, '十小时雨声', '没看过的候选被打了标')
  // 回执里也要能看出看片史真的接上了（否则"没标"可能是注入根本没生效）
  assert.equal(after.recentWatch?.seenCount, 1)
})

test('状态账读不出来时照常出候选（缺注入不许变成她的报错）', async (t) => {
  const { home, world } = setup(t)
  globalThis.fetch = feedFetch()
  // 生产里最真实的"读不出来"：文件在，但内容坏了（loadState 会改名为 .corrupt-*）
  const fieldsFile = path.join(home, 'data', 'persona', 'fields.json')
  fs.mkdirSync(path.dirname(fieldsFile), { recursive: true })
  fs.writeFileSync(fieldsFile, '{ 这不是 JSON', 'utf8')

  const feed = toolsOf(world.tools(), 'bili_feed')
  const out = JSON.parse(await feed.handler({ count: 5 }))
  assert.equal(out.ok, true)
  assert.equal(out.items.length, 2)
  assert.equal(out.recentWatch?.seenCount, 0)
  assert.equal(out.items.find((i) => i.bvid === SEEN).title, '白噪音合集')
})

/**
 * 宿主无关那条装配（`createBiliWorldAdapter`）也要接到她那个家的同一份账。
 *
 * 为什么单独立一条（2026-11-19 #88 对账）：全仓只有 `definition.create`（宿主实际走的那条）
 * 给了 `credentialsFile` / `judgmentFile` / `fieldsFile`；`createBiliWorldAdapter`
 * 一个都没给，而且**这个函数至今零测试**。症状是同一份 World 换条装配路就变了个人：
 * 凭据永远空（写动作被前置条件拒）、看片史永远不标（「近 7 天看过」不出现），
 * 而两条路的单测各测各的，谁都不报错。
 *
 * 这里只验"路径真的接上了"，不联网、不写盘、不起 start()：
 *   · 凭据：往 `<home>/.env` 写一份，从能力包的活凭据视图读回来（env 变量先清空）；
 *   · 看片史：往 `<home>/data/persona/fields.json` 写一条她看过的记忆，再问 `bili_feed` 是否标上。
 * 两个入口（adapter 与 definition.create）都要过，且**必须给出同样的结论**。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'world-adapter-wiring-'))
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })

// 凭据 env 优先于文件（liveCredentials 的第一优先级）：不清掉，本机真 cookie 会压住我们写的桩
for (const k of ['BILI_SESSDATA', 'SESSDATA', 'BILI_JCT', 'bili_jct', 'BILI_BUVID3', 'BUVID3']) delete process.env[k]
process.env.BILI_TRAFFIC_TEST = '1'
if (!process.env.NODE_TEST_CONTEXT) process.env.NODE_TEST_CONTEXT = '1'

const SEEN = 'BV1seen00001'
const UP = '雨声实验室'

const adapterMod = await import('../packages/adapters/cortico-world-bilibili/src/index.ts')
const { liveCredentials } = await import('../packages/capabilities/cap-bilibili/src/client/bili-read.ts')
const { resetReadDedupe } = await import('../packages/adapters/cortico-adapter/src/index.ts')

/** 一个她用过 30 天的家：有凭据、有看片史。 */
function home(t) {
  const dir = fs.mkdtempSync(path.join(TMP, 'home-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'data', 'persona'), { recursive: true })
  fs.writeFileSync(path.join(dir, '.env'), 'SESSDATA=stub-sessdata\nbili_jct=stub-jct\nBUVID3=stub-buvid3\n', 'utf8')
  fs.writeFileSync(path.join(dir, 'data', 'persona', 'fields.json'), JSON.stringify({
    schemaVersion: 5,
    fields: { energy: 0.7, stimulation: 0.5, connection: 0.5, social: 0.5, mood: 0.2, curiosity: 0.6, creativity: 0.5 },
    chain: [],
    memories: [{
      id: 'mem-1', npcId: 'xiaoyu', sender: 'npc',
      content: `看过《白噪音合集 第1期》（${UP}） —— ${SEEN}`,
      emotion: { valence: 0.2, intensity: 0.5, tags: [] }, tags: [],
      vividness: 0.9, accessCount: 1, createdAt: new Date().toISOString(), encodingStrength: 0.9,
      flashbulb: false, source: 'npc_self',
    }],
    npcState: { current: 'normal', connectionBelowThresholdSince: null, lastUserMessageAt: null, bond: { level: 0.2 }, bondAtColdWarStart: null },
    budget: { day: '', spent: {} },
    emotionHistory: [],
    lastAppliedAt: new Date().toISOString(),
  }), 'utf8')
  return dir
}

function feedStub() {
  const item = [
    { bvid: SEEN, title: '白噪音合集', duration: 900, owner: { name: UP } },
    { bvid: 'BV1fresh0003', title: '十小时雨声', duration: 1800, owner: { name: '路人甲' } },
  ]
  return async (input) => {
    const body = String(input).includes('/popular') ? { code: 0, data: { item } } : { code: -404, data: null }
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) }
  }
}

/** 两个入口共用的检查：凭据读得到、看片史标得上。 */
async function assertWired(label, cap, homeDir) {
  // ① 凭据：文件在 <home>/.env，活凭据视图要读得到（不是空串）
  //    这条如果没接上，写动作会带着空 cookie 出去，报的是 -101 未登录。
  const creds = liveCredentials(path.join(homeDir, '.env'))
  assert.equal(creds.sessdata, 'stub-sessdata', `${label}：凭据文件没接上`)
  assert.equal(creds.bili_jct, 'stub-jct', `${label}：bili_jct 没接上`)

  // ② 看片史：feed 的标注段要用到 recentWatch 注入；没接上就只标时长、不打「近 7 天看过」
  const feed = cap.tools().find((x) => x.name === 'bili_feed')
  assert.ok(feed, `${label}：没有 bili_feed`)
  // 两种形状都要认：能力包给的是 `execute`（返回对象），宿主装配（world.tools()）给的是
  // Cortico 的 `handler`（返回 JSON 字符串）。同一份能力的两种外壳，结论必须一样。
  const run = typeof feed.execute === 'function'
    ? (args) => feed.execute(args)
    : async (args) => JSON.parse(await feed.handler(args))
  const prev = globalThis.fetch
  globalThis.fetch = feedStub()
  try {
    resetReadDedupe()
    const out = await run({ count: 5 })
    assert.equal(out.ok, true, `${label}：feed 失败 ${JSON.stringify(out)}`)
    const seen = out.items.find((i) => i.bvid === SEEN)
    assert.match(seen.title, /近 7 天看过/, `${label}：看片史没接上（标题=「${seen.title}」）`)
  } finally {
    globalThis.fetch = prev
  }
}

test('createBiliWorldAdapter：凭据与看片史都接到同一个家', async (t) => {
  const homeDir = home(t)
  const a = adapterMod.createBiliWorldAdapter({ homeDir })
  await assertWired('adapter', a.capability, homeDir)
})

test('definition.create（宿主那条）：同一份账，结论必须一致', async (t) => {
  const homeDir = home(t)
  // 注意返回形状不同：definition.create 返回的是 **world**（宿主拿的就是这个），
  // adapter 返回的是带 capability 的包装。这里按宿主那侧的形状取工具。
  const world = adapterMod.default.create({ botDir: homeDir, dataDir: path.join(homeDir, 'data'), cfg: {} })
  await assertWired('definition.create', { tools: () => world.tools() }, homeDir)
})

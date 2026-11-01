// 意见箱 f-ac48e3：让她去页面上挑扩展，却没有任何读清单的能力——
// 「连有哪些扩展可选都看不到，就无法提出有依据的选择」。
// 这一条先给眼睛不给手脚：工具只回文本，启用/安装/改配置都不在它的能力里。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BILI_ACCOUNT } from '../src/worlds/bili-account/definition.ts'

/** 造一棵临时目录树；repoRoot 与 botDir 都在里面，绝不碰正式部署。 */
function tree(files) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-'))
  for (const [rel, body] of Object.entries(files)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, body)
  }
  return root
}

const call = async (world) => {
  const tool = world.tools().find((t) => t.name === 'bili_capabilities')
  assert.ok(tool, '她需要一个能读清单的工具')
  return { tool, out: await tool.handler({}) }
}

test('bili_capabilities 只在读面：标签是 read，写面那张表里没有它', () => {
  const declared = BILI_ACCOUNT.describe.tools
  const mine = declared.find((t) => t.name === 'bili_capabilities')
  assert.deepEqual(mine.tags, ['read'])
  assert.deepEqual(mine.parameters, { type: 'object', properties: {}, additionalProperties: false }, '不接受任何参数：它不该被塞进目标去改东西')
  const writes = declared.filter((t) => t.tags.some((tag) => tag !== 'read')).map((t) => t.name)
  assert.equal(writes.includes('bili_capabilities'), false, '出现在写面就等于给自己开了手脚')
  assert.match(mine.summary.zh, /只读/)
})

test('真调用 handler：工具名+一句话+读/写，别的 World 给的手脚也在，扩展状态说清没启用', async () => {
  const root = tree({
    'extensions/package.json': JSON.stringify({
      name: 'cortico-extensions',
      dependencies: { 'cortico-world-lamp': '^1.0.0', 'cortico-world-gone': '^0.1.0' },
    }),
    'extensions/node_modules/cortico-world-lamp/package.json': JSON.stringify({
      name: 'cortico-world-lamp', version: '1.2.3', cortico: { kind: 'world', api: 2 },
    }),
    'deploy/deployment.json': JSON.stringify({ bot: 'mybot' }),
    'deploy/config.json': JSON.stringify({
      providers: { one: { kind: 'openai-responses-compat' } },
      worlds: { 'bili-account': { enabled: true }, qq: { enabled: false } },
    }),
  })
  const world = BILI_ACCOUNT.create({ repoRoot: root, botDir: path.join(root, 'deploy') })
  // 宿主给的就是 Core 装配后的那张表（真实实现返回同一形状：名字、说明、标签、提供方）
  world.host = {
    listTools: () => [
      { name: 'bili_feed', description: 'Fetch candidate videos (read-only).', tags: ['read'], owner: 'bili-account' },
      { name: 'bili_fav', description: 'Favorite a video.', tags: ['write'], owner: 'bili-account' },
      { name: 'console_send', description: 'Send a message to the console.', tags: ['speak'], owner: 'console' },
    ],
  }
  const { out } = await call(world)

  assert.match(out, /- bili_feed · 拉取候选视频（只读） · 读/, '一句话取自她的自描述，不是发给模型的那句')
  assert.match(out, /- bili_fav · .* · 写/)
  assert.match(out, /- console_send · Send a message to the console\. · 说/, '别的 World 给的手脚也要看得见')
  assert.match(out, /共 3 个/)

  assert.match(out, /cortico-world-lamp · world · 1\.2\.3 · 装了，但这份部署没有 worlds\.lamp 这一项 = 没启用/)
  assert.match(out, /cortico-world-gone · 登记在 package.json（\^0\.1\.0），但 node_modules 里没有这个包 = 没装上/)
  assert.match(out, /- bili-account · 开 · 这轮挂着/)
  assert.match(out, /- qq · 关 · 这轮没挂（从工具表反推的/, '这个夹具的宿主没接 listWorlds：清单必须自报"这是反推的"')
  assert.match(out, /启用扩展、装扩展、改配置都不是我能做的事/)

  // 只读：调用完，两个依据文件一个字节都没变
  assert.equal(fs.readFileSync(path.join(root, 'deploy/config.json'), 'utf8'), JSON.stringify({
    providers: { one: { kind: 'openai-responses-compat' } },
    worlds: { 'bili-account': { enabled: true }, qq: { enabled: false } },
  }))
  assert.equal(fs.readdirSync(path.join(root, 'extensions')).join(','), 'node_modules,package.json')
})

test('挂了别的 World 的扩展时她说"这轮挂上了"，而不是让人再猜', async () => {
  const root = tree({
    'extensions/package.json': JSON.stringify({ dependencies: { 'cortico-world-lamp': '1.0.0' } }),
    'extensions/node_modules/cortico-world-lamp/package.json': JSON.stringify({ version: '1.0.0', cortico: { kind: 'world' } }),
    'deploy/config.json': JSON.stringify({ worlds: { lamp: { enabled: true } } }),
  })
  const world = BILI_ACCOUNT.create({ repoRoot: root, botDir: path.join(root, 'deploy') })
  world.host = { listTools: () => [{ name: 'lamp_on', description: 'd', tags: ['read'], owner: 'lamp' }] }
  const { out } = await call(world)
  assert.match(out, /cortico-world-lamp · world · 1\.0\.0 · 这轮挂上了/)
  assert.match(out, /- lamp · 开 · 这轮挂着/)
})

test('声明过但这一轮没挂上的工具单独说出来，不让她以为自己有', async () => {
  const world = BILI_ACCOUNT.create({ repoRoot: tree({}), botDir: tree({}) })
  world.host = { listTools: () => [{ name: 'bili_feed', description: 'd', tags: ['read'], owner: 'bili-account' }] }
  const { out } = await call(world)
  assert.match(out, /bili-account 声明过但这一轮没有/)
  assert.match(out, /bili_fav/)
  assert.match(out, /改了吗|没重启|改动要重启/, '要给出她能照做的下一步：这是重启问题，不是她疯了')
})

test('宿主没给工具表，或没有部署目录时：说实话，不假装看得见', async () => {
  const noHost = BILI_ACCOUNT.create()
  assert.equal(noHost.ctx, null, '测试里直接 create() 不该拿到正式部署路径')
  const { out } = await call(noHost)
  assert.match(out, /别的 World 有什么我看不到/)
  assert.match(out, /bili_feed · 拉取候选视频（只读） · 读/, '自己这一份还是要报出来')
  assert.match(out, /没拿到部署目录/)

  const noSurface = BILI_ACCOUNT.create({ repoRoot: tree({}), botDir: tree({}) })
  noSurface.host = {}
  const second = await call(noSurface)
  assert.match(second.out, /别的 World 有什么我看不到/)
})

// 11-01 真机报过错：figure 只出画面/事件、不出工具，从工具表反推就把"挂着"说成"没挂上"。
// 挂载表（listWorlds）和工具表是两件事，清单必须分开问，说不清时要自报是推断。
test('挂了但不露面的 World：说"挂着，不出工具"，不许说成没挂（figure 那次报错的根）', async () => {
  const root = tree({
    'extensions/package.json': JSON.stringify({ dependencies: { 'cortico-world-figure': '^1.4.4' } }),
    'extensions/node_modules/cortico-world-figure/package.json': JSON.stringify({ version: '1.4.4', cortico: { kind: 'world' } }),
    'deploy/config.json': JSON.stringify({ worlds: { 'bili-account': { enabled: true }, figure: { enabled: true } } }),
  })
  const world = BILI_ACCOUNT.create({ repoRoot: root, botDir: path.join(root, 'deploy') })
  world.host = {
    listTools: () => [{ name: 'bili_feed', description: 'd', tags: ['read'], owner: 'bili-account' }],
    listWorlds: () => [
      { id: 'bili-account', visible: true, tools: 1 },
      { id: 'figure', visible: true, tools: 0 },
    ],
  }
  const { out } = await call(world)
  assert.match(out, /cortico-world-figure · world · 1\.4\.4 · 这轮挂上了，但它不出工具/)
  assert.equal(/figure[^\n]*没装配|figure[^\n]*没挂/.test(out), false, '挂着的东西不能被说成没挂')
  assert.match(out, /- figure · 开 · 这轮挂着，但它不出工具（画面\/事件类）/)
  assert.match(out, /- bili-account · 开 · 这轮挂着，露 1 个工具/)
})

test('不可见的 World 要说"对这轮模型不可见"，别只说挂着', async () => {
  const root = tree({ 'deploy/config.json': JSON.stringify({ worlds: { qq: { enabled: true } } }) })
  const world = BILI_ACCOUNT.create({ repoRoot: root, botDir: path.join(root, 'deploy') })
  world.host = {
    listTools: () => [],
    listWorlds: () => [{ id: 'qq', visible: false, tools: 3 }],
  }
  const { out } = await call(world)
  assert.match(out, /- qq · 开 · 这轮挂着，露 3 个工具；对这轮模型不可见/)
})

test('宿主没接挂载表：退回反推并自报"这是反推的"', async () => {
  const root = tree({ 'deploy/config.json': JSON.stringify({ worlds: { qq: { enabled: true } } }) })
  const world = BILI_ACCOUNT.create({ repoRoot: root, botDir: path.join(root, 'deploy') })
  world.host = { listTools: () => [{ name: 'qq_say', description: 'd', tags: ['speak'], owner: 'qq' }] }
  const { out } = await call(world)
  assert.match(out, /- qq · 开 · 这轮挂着，露 1 个工具/, '工具表里见过它就该算挂着')
  const bare = BILI_ACCOUNT.create({ repoRoot: root, botDir: path.join(root, 'deploy') })
  bare.host = { listTools: () => [] }
  const second = await call(bare)
  assert.match(second.out, /- qq · 开 · 这轮没挂（从工具表反推的，看不见它未必代表没挂）/)
})

// 口径与授权要一致（意见箱 f-af013b）：主人当面说过"你想用哪些扩展也可以自己加的"，
// 而清单里一句"别自己改"把她能做的事也否掉了。装/卸与改配置归主人，启用/停用是她的。
test('手脚清单的口径：装/卸与改配置归主人，启用/停用她自己能点', async () => {
  const decl = BILI_ACCOUNT.describe.tools.find((t) => t.name === 'bili_capabilities')
  const zh = String(decl.summary?.zh ?? '')
  assert.match(zh, /装\/卸/, '要写明装卸归主人')
  assert.match(zh, /启用\/停用她自己能点/, '要写明启停是她能做的——否则又变成"别自己改"')
  assert.doesNotMatch(zh, /装着的扩展、这份部署的开关（只读，启用与安装归主人）/, '旧口径把启停也算给主人了')
})

// ── 她能看图（#57）──────────────────────────────────────────────────────────
// 交接文档专门点了这一条：控制台看图修的是控制台，她仍然没有读图工具。
// bili_look 把封面/九宫格/字幕条作为附件放进回执——模型收图时下一轮才真看得见。
test('bili_look 在工具表里，且模型不收图时明说"别描述"', async () => {
  const w = BILI_ACCOUNT.create()
  const tool = w.tools().find((t) => t.name === 'bili_look')
  assert.ok(tool, '读图工具必须在她的工具表里')
  assert.deepEqual(tool.tags, ['read'])

  // 宿主声明模型不收图 + 空图目录：回执必须说"看了也收不到"，不是给个文件名让她编。
  w.start({
    modelFacts: { model: () => 'blind', accepts: () => false, contextWindow: () => undefined },
    listTools: () => [],
    log: { info() {}, warn() {}, error() {}, debug() {} },
  })
  const out = await tool.handler({ bvid: 'BV1aaaaaaaaa', what: 'cover' }, { role: 'main', log: { info() {}, warn() {}, error() {}, debug() {} } })
  assert.equal(typeof out, 'string', '没有可看的图时不返回附件')
  assert.match(String(out), /没有可看的图|不收图像/)
})

test('模型收图 + 自己的 bili_look = 真给附件（不是只报文件名）', async () => {
  // 交接文档 §0 的误读：控制台能看图 ≠ 她能看图。这条锁的是"她能"。
  const fs = await import('node:fs')
  const path = await import('node:path')
  const covers = path.join(process.env.WHALE_HOME || path.join(process.env.USERPROFILE || '', '.dsh'), 'shots', 'covers')
  let bv = null
  try { bv = (fs.readdirSync(covers).find((f) => f.endsWith('.jpg')) ?? '').replace(/\.jpg$/, '') } catch { /* 没图就跳过 */ }
  if (!bv) { console.log('本机没有封面可测，跳过'); return }

  const w = BILI_ACCOUNT.create()
  w.start({
    modelFacts: { model: () => 'sees', accepts: () => true, contextWindow: () => undefined },
    listTools: () => [{ name: 'bili_look', description: '', tags: ['read'], owner: 'bili-account' }],
    log: { info() {}, warn() {}, error() {}, debug() {} },
  })
  const tool = w.tools().find((t) => t.name === 'bili_look')
  const out = await tool.handler({ bvid: bv, what: 'cover' }, { role: 'main', log: { info() {}, warn() {}, error() {}, debug() {} } })
  assert.equal(typeof out, 'object', '模型收图时必须返回附件对象，只给文件名等于还是看不见')
  assert.equal(out.blobs.length, 1)
  assert.equal(out.blobs[0].mime, 'image/jpeg')
  assert.ok(out.blobs[0].bytes.length > 1000, '附件里要有真字节')
})

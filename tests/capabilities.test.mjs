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
  assert.match(out, /- qq · 关 · 这轮没挂/)
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

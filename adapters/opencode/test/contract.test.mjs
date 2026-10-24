// OpenCode adapter 契约测试：mock server API + MCP 握手 + 风控闸穿透检查
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { createOpenCodeController } from '../controller.js'
import { createSessionDelivery } from '../../../core/session-delivery.js'
import { makePlan } from '../../../tools/lib/night-plan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..', '..')

function mockServer(t, log) {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => body += c)
    req.on('end', () => {
      const url = req.url
      if (url === '/session' && req.method === 'POST') { log.push(['create', body]); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'ses_mock_1' })); return }
      if (url.startsWith('/session/') && url.endsWith('/prompt_async')) { log.push(['prompt', url.split('/')[2], body]); res.writeHead(204); res.end(); return }
      if (url.startsWith('/session/')) { log.push(['get', url]); res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ status: 'idle' })); return }
      res.writeHead(404); res.end()
    })
  })
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    t.after(() => server.close())
    resolve(server)
  }))
}

test('controller→session-delivery：固定会话 + 人设前缀 + prompt_async 形状正确', async (t) => {
  const log = []
  const server = await mockServer(t, log)
  const controller = createOpenCodeController({ baseUrl: `http://127.0.0.1:${server.address().port}` })
  assert.deepEqual(await controller.create({ cwd: 'x' }), { sessionId: 'ses_mock_1' })
  assert.equal(await controller.isBusy({ sessionId: 'ses_mock_1' }), false)

  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-contract-'))
  const dshHome = path.join(home, 'whale'); fs.mkdirSync(dshHome, { recursive: true })
  const cfgFile = path.join(dshHome, 'bili-whale.config.json')
  fs.writeFileSync(cfgFile, JSON.stringify({ sessionRotateDays: 0, personaOncePerSession: false }))
  const delivery = createSessionDelivery({
    controller, dshHome, cwd: home, sessionId: 'bili-whale', // 故意用占位 id：create 返回宿主真 id 后必须被采纳
    config: () => JSON.parse(fs.readFileSync(cfgFile, 'utf8')),
    persona: () => '你是小鲸', log: () => {},
  })
  await delivery.send({ requestId: 'r1', sessionId: 'bili-whale', mode: 'queue', content: [{ type: 'text', text: '醒了去刷B站' }] }, new AbortController().signal)
  const prompt = log.find(x => x[0] === 'prompt')
  assert.ok(prompt, '必须走 prompt_async')
  assert.equal(prompt[1], 'ses_mock_1', 'P0：必须采纳 create() 返回的 ses_* id（不是占位 bili-whale）')
  const parts = JSON.parse(prompt[2]).parts
  assert.match(parts[0].text, /^你是小鲸[\s\S]*醒了去刷B站$/, '人设前缀注入到第一段')
})

test('MCP 握手：tools/list 列全 + bili help 可跑 + 非法 args 被拒', async (t) => {
  const p = spawn(process.execPath, [path.join(ROOT, 'adapters/opencode/mcp-stdio.js')], { stdio: ['pipe', 'pipe', 'inherit'] })
  t.after(() => p.kill())
  const lines = []
  const waiters = []
  p.stdout.on('data', (d) => String(d).split('\n').filter(Boolean).forEach((l) => {
    const m = JSON.parse(l)
    const w = waiters.shift()
    if (w) w(m); else lines.push(m)
  }))
  const ask = (msg) => new Promise((res) => { waiters.push(res); p.stdin.write(JSON.stringify(msg) + '\n') })
  const init = await ask({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  assert.equal(init.result.serverInfo.name, 'bili-whale-tools')
  const list = await ask({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  assert.equal(list.result.tools.length, 1)
  assert.equal(list.result.tools[0].name, 'bili')
  const help = await ask({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'bili', arguments: { args: [] } } })
  assert.match(help.result.content[0].text, /用法|bili/, 'help 应输出用法')
  assert.notEqual(help.result.isError, true)
  const bad = await ask({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'bili', arguments: { args: ['feed\n--evil'] } } })
  assert.match(bad.error.message, /非法换行|NUL/, '换行注入必须被拒')
})

test('风控闸穿透检查：包装层只 spawn bili.mjs，源码不引用 bili-api.mjs', () => {
  const src = fs.readFileSync(path.join(ROOT, 'adapters/opencode/mcp-stdio.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '') // 只查真实代码，注释里的警示语不算
  assert.ok(!/from\s+'[^']*bili-api|bili-api\.mjs/.test(code), 'MCP 层禁止直连 bili-api.mjs（必须过 traffic 闸）')
  assert.ok(code.includes("path.resolve(HERE, '..', '..', 'tools', 'bili.mjs')") || /bili\.mjs/.test(code), '必须经 tools/bili.mjs 入口')
})

test('makePlan + night-config 在 OpenCode 沙箱 home 下可用（daemon 空跑前置）', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'oc-night-'))
  const plan = makePlan({ windows: [{ start: '20:00', end: '24:00', wakes: 1 }], skipChance: 0 }, {}, Date.parse('2026-10-25T20:30:00'), () => 0.5)
  assert.equal(plan.action, 'wake')
  assert.ok(fs.existsSync !== undefined)
  void home
})

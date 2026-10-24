// panel 端到端契约：spawn 真服务 → 鉴权 fail-closed / 新端点形状 / 页面可出
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

async function boot(t) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'panel-test-'))
  const wh = path.join(home, 'whale')
  fs.mkdirSync(wh, { recursive: true }); fs.mkdirSync(path.join(home, '.bili-ai'))
  fs.writeFileSync(path.join(wh, 'bili-whale.config.json'), JSON.stringify({ owner: { mid: '1' }, listen: {} }))
  fs.writeFileSync(path.join(wh, 'whale-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: 'wake', note: 'e2e' }) + '\n')
  fs.writeFileSync(path.join(wh, 'whale-diary.md'), '## 看过\n| 10-25 | BV1 | 标题 | 想法 |\n')
  const port = 18441 + Math.floor(Math.random() * 900)
  const srv = spawn(process.execPath, [path.join(ROOT, 'panel', 'server.js'), '--port', String(port)], {
    env: { ...process.env, WHALE_HOME: wh, BILI_WHALE_CONFIG: path.join(wh, 'bili-whale.config.json'), USERPROFILE: home, HOME: home, ProgramFiles: 'C:\\nonexistent', PANEL_NO_SCHED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => srv.kill('SIGKILL'))
  const token = await new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('panel 启动超时')), 8000)
    let out = ''
    srv.stdout.on('data', (d) => { out += d; const m = out.match(/\?t=([a-f0-9]+)/); if (m) { clearTimeout(to); res(m[1]) } })
    srv.stderr.on('data', (d) => { if (/Error/.test(String(d))) { clearTimeout(to); rej(new Error(String(d).slice(0, 200))) } })
  })
  return { base: `http://127.0.0.1:${port}`, token, home, wh }
}
const get = (base, p, token) => fetch(base + p, { headers: token ? { authorization: 'Bearer ' + token } : {} })

test('无 token 一律 fail-closed（API 503 / 页面 401 引导）', async (t) => {
  const { base } = await boot(t)
  const api = await get(base, '/api/vitals')
  assert.equal(api.status, 503)
  const page = await get(base, '/')
  assert.equal(page.status, 401)
  assert.match(await page.text(), /访问令牌/)
})

test('token 下：vitals/timeline/diary/settings 形状正确（补三缺口的契约）', async (t) => {
  const { base, token } = await boot(t)
  const v = await (await get(base, '/api/vitals', token)).json()
  assert.equal(v.ok, true)
  assert.equal(v.scheduler.ok, false, 'PANEL_NO_SCHED → 时钟状态如实上报，不装活')
  assert.ok(v.traffic.settings.readDaily >= 100)
  const tl = await (await get(base, '/api/timeline?limit=1', token)).json()
  assert.equal(tl.items.length, 1); assert.equal(tl.items[0].kind, 'wake'); assert.equal(tl.next, null)
  const dy = await (await get(base, '/api/diary', token)).json()
  assert.match(dy.owner.text, /## 看过/); assert.equal(dy.private, null)
  const cfg = await (await get(base, '/api/settings', token)).json()
  assert.equal(cfg.config.owner.mid, '1')
  const asset = await get(base, '/assets/whale-girl/manifest.json', token)
  assert.equal(asset.status, 200)
  assert.ok((await asset.json()).states.idle, '序列帧 manifest 必须可读')
  assert.equal((await get(base, '/assets/whale-girl/manifest.json')).status, 503, '资产同样要鉴权')
})

test('页面 HTML 内联可用（零外部资源、含鱼缸与三页签）', async (t) => {
  const { base, token } = await boot(t)
  const r = await fetch(base + '/?t=' + token)
  const html = await r.text()
  assert.match(html, /她的一天/)
  assert.match(html, /headers:\{\.\.\.H,\.\.\.\(opt\.headers\|\|\{\}\)\}/, 'P1：POST 必须合并 Authorization，不能被 opt.headers 覆盖')
  assert.ok(!/<link|src="http|@import/.test(html), '不得引用外部资源')
})

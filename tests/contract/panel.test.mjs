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
  // M1a：注入一条 pending 动态稿，验证它进 vitals 计数与 /api/drafts（以前面板看不见它）
  const drafts = path.join(home, 'm1a-drafts')
  fs.mkdirSync(drafts, { recursive: true })
  fs.writeFileSync(path.join(drafts, '2026-10-30.json'), JSON.stringify({ id: 'dyn-m1a-x', date: '2026-10-30', status: 'pending', text: '面板要看的稿', image: 'x.png', textHash: 't' }))
  const port = 18441 + Math.floor(Math.random() * 900)
  const srv = spawn(process.execPath, [path.join(ROOT, 'panel', 'server.js'), '--port', String(port)], {
    env: { ...process.env, WHALE_HOME: wh, BILI_WHALE_CONFIG: path.join(wh, 'bili-whale.config.json'), USERPROFILE: home, HOME: home, ProgramFiles: 'C:\\nonexistent', WHALE_DRAFTS: drafts },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => srv.kill('SIGKILL'))
  // stderr 必须有人读：全量门禁里 76 个文件并发跑，管道满了会把子进程卡住，
  // 表现出来就是"panel.token 未生成"这种和根因没关系的报错（2026-11-02 就是这么红一次）。
  let errBuf = ''
  srv.stderr.on('data', (d) => { errBuf = (errBuf + d).slice(-4000) })
  srv.on('exit', (code) => { if (code !== 0 && code !== null) errBuf += `\n[server exit ${code}]` })
  const token = await (async () => {
  const tf = path.join(wh, 'panel.token')
  for (let k = 0; k < 120; k++) { try { const v = fs.readFileSync(tf, 'utf8').trim(); if (v) return v } catch {}; await new Promise(r => setTimeout(r, 200)) }
  throw new Error(`panel.token 未生成（端口 ${port} 等 24s）\nstderr:\n${errBuf || '(空)'}`)
})()
  let ready = false
  for (let k = 0; k < 120; k++) { try { const r = await fetch(`http://127.0.0.1:${port}/api/vitals`); if (r.status === 503 || r.status === 200) { ready = true; break } } catch {}; await new Promise(r => setTimeout(r, 150)) }
  if (!ready) throw new Error(`面板 API 未就绪（端口 ${port} 等 18s）\nstderr:\n${errBuf || '(空)'}`)
  return { base: `http://127.0.0.1:${port}`, token, home, wh, port }
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
  assert.equal(v.scheduler.ok, false, 'PANEL_SCHED（默认关） → 时钟状态如实上报，不装活')
  assert.ok(v.traffic.settings.readDaily >= 100)
  // M1a：bubble 的 pending 计数必须含动态稿（以前只有 go-gate → 有稿也说“没事”）
  assert.ok(v.pendingCount >= 1, 'pendingCount 应包含注入的 pending 动态稿，实得 ' + v.pendingCount)
  assert.ok(v.pendingParts && v.pendingParts.dynamic >= 1, 'pendingParts.dynamic 应 ≥1')
  const dr = await (await get(base, '/api/drafts', token)).json()
  assert.equal(dr.ok, true)
  assert.equal(dr.dynamic[0].id, 'dyn-m1a-x')
  assert.equal(dr.needs, 1)
  assert.ok(!JSON.stringify(dr).includes('token'), '/api/drafts 不得返回 token（M1e 不变量）')
  assert.equal((await get(base, '/api/drafts')).status, 503, '/api/drafts 同样要鉴权')
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
  const png = await get(base, '/assets/whale-girl/idle.png?t=' + encodeURIComponent(token), token)
  assert.equal(png.status, 200, 'P0：序列帧 PNG 必须能带 token 加载')
  assert.ok((png.headers.get('content-type')||'').includes('image/png'))
  assert.ok((await get(base, '/assets/%2e%2e/server.js', token)).status >= 400, '编码穿越必须被拒')
})

test('页面 HTML 内联可用（零外部资源、含鱼缸与三页签）', async (t) => {
  const { base, token } = await boot(t)
  const r = await fetch(base + '/?t=' + token)
  const html = await r.text()
  assert.match(html, /她的一天/)
  assert.match(html, /headers:\{\.\.\.H,\.\.\.\(opt\.headers\|\|\{\}\)\}/, 'P1：POST 必须合并 Authorization，不能被 opt.headers 覆盖')
  assert.ok(!/<link|src="http|@import/.test(html), '不得引用外部资源')
})

test('放行入口：无 token 拒绝；有 token 的未知 id 返 ok:false（不真发）', async (t) => {
  const { base, token } = await boot(t)
  const noTok = await fetch(base + '/api/draft-approve', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'dyn-x' }) })
  assert.ok([401, 503].includes(noTok.status), '无 token 必须拒，实得 ' + noTok.status)
  const post = (body) => fetch(base + '/api/draft-approve', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify(body) })
  const r = await (await post({ id: 'dyn-nope-xyz' })).json()
  assert.equal(r.ok, false)
  assert.match(r.error, /找不到草稿/)
  const rj = await (await post({ id: 'dyn-nope-xyz', action: 'reject' })).json()
  assert.equal(rj.ok, false)
  const bad = await fetch(base + '/api/draft-approve', { method: 'GET', headers: { authorization: 'Bearer ' + token } })
  assert.equal(bad.status, 405, 'GET 不给放行')
})

test('意见箱入口：GET 列表可用；resolve 未知 id 返 ok:false（本地，不联网）', async (t) => {
  const { base, token } = await boot(t)
  const fb = await (await get(base, '/api/feedback', token)).json()
  assert.equal(fb.ok, true)
  assert.equal((await get(base, '/api/feedback')).status, 503, '意见箱也要鉴权')
  const r = await fetch(base + '/api/feedback/resolve', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token }, body: JSON.stringify({ id: 'f-nope' }) })
  assert.equal((await r.json()).ok, false)
})

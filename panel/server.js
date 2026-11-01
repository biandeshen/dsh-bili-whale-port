/**
 * whale-panel —— 独立设置/鱼缸面板（阶段 4）。
 *
 *   node panel/server.js [--port 8441]
 *
 * 复用 core/api/routes.js 的 9 条路由（宿主无关），外面套 panel 自己的栅栏：
 *   只绑 127.0.0.1 + Bearer/token fail-closed。
 * 新增三条：/api/vitals（HUD 聚合，补 traffic 余量缺口）、/api/timeline、/api/diary。
 * 生物钟：面板进程自带 startScheduler（controller 默认 OpenCode 端口实现，
 *   设 PANEL_SCHED（默认关）=1 可关，交给 pm2 的 whale-daemon 跑）。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, whaleHome, configPath, credentialsPath } from '../tools/lib/paths.mjs'
import { guardedFetch, trafficGuard } from '../tools/lib/traffic.mjs'
import { makeRoutes } from '../core/api/routes.js'
import { makeExecNode } from '../core/api/support.js'
import { resolveNodeRuntime } from '../core/node-runtime.js'
import { startScheduler } from '../core/scheduler.js'
import { createOpenCodeController } from '../adapters/opencode/controller.js'
import { loadToken, authorized } from './auth.js'
import { timeline, diary, vitals } from './data.js'
import { collectDrafts } from './drafts.mjs'
import { listFeedback, resolveFeedback } from './feedback.mjs'
// 放行入口：approveFromPanel 的 token 只在服务端用，响应永不含 token（2026-10-31）
import { approveFromPanel, reject as rejectDraft } from '../scripts/dynamic-approve.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const pi = process.argv.indexOf('--port')
const rawPort = pi >= 0 ? process.argv[pi + 1] : (process.env.PANEL_PORT || 8447)
const PORT = (() => { const n = Number(rawPort); return Number.isInteger(n) && n >= 1 && n <= 65535 ? n : 8447 })()

let NODE_EXE = null
try { NODE_EXE = resolveNodeRuntime(whaleHome) } catch (e) { globalThis.__biliWhaleNodeError = String(e?.message ?? e) }
const execNode = makeExecNode(() => NODE_EXE)

let schedStatus = { ok: false, reason: '未启动（面板默认只做管理端；时钟由 whale-daemon 负责，PANEL_SCHED=1 可内置）', at: null }
let sched = null
if (process.env.PANEL_SCHED === '1') {
  try {
    let userCfg = {}
    try { userCfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
    sched = startScheduler({ controller: createOpenCodeController() }, {
      whaleHome,
      biliMjs: userCfg.toolsPath || path.join(ROOT, 'tools', 'bili.mjs'),
      cwd: userCfg.home || path.join(whaleHome, 'whale-work'),
      sessionId: 'bili-whale',
      host: 'opencode',
      log: (m) => { try { console.log(m) } catch {} },
    })
    schedStatus = { ok: true, reason: '已启动（每 60 秒 tick）', at: new Date().toISOString() }
  } catch (e) {
    schedStatus = { ok: false, reason: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() }
  }
}

const { routes } = makeRoutes({
  cfgFile: configPath, credFile: credentialsPath, toolsRoot: ROOT,
  home: HOME, whaleHome,
  getSchedStatus: () => schedStatus, execNode, fetch: guardedFetch,
  onConfigSaved: (changed) => { try { sched?.invalidate(changed) } catch {} },
})

const { token } = loadToken(whaleHome)
const extra = {
  '/api/timeline': (req, res) => {
    const u = new URL(req.url, 'http://x')
    json(res, 200, timeline(whaleHome, { cursor: u.searchParams.get('cursor') || 0, limit: u.searchParams.get('limit') || 50 }))
  },
  '/api/diary': (req, res) => json(res, 200, diary(whaleHome)),
  // M1a：动态/回信草稿只读列表（无 token；放行走 CLI）
  '/api/drafts': (req, res) => json(res, 200, collectDrafts({ whaleHome })),
  // 放行入口（2026-10-31 主人要）：浏览器只发 {id,action}，token 全程在服务端（M1e：永远不进响应/浏览器）
  // 她的意见箱（本地 jsonl，只读列表 + 主人侧 resolve）
  '/api/feedback': (req, res) => json(res, 200, listFeedback()),
  '/api/feedback/resolve': async (req, res) => {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'POST only' }); return }
    let body = ''
    for await (const chunk of req) body += chunk
    let b = {}
    try { b = JSON.parse(body || '{}') } catch { json(res, 400, { ok: false, error: '请求体不是 JSON' }); return }
    const r = resolveFeedback(String(b.id ?? ''), 'owner')
    json(res, 200, { ok: r.ok, error: r.error ?? null })
  },
  '/api/draft-approve': async (req, res) => {
    if (req.method !== 'POST') { json(res, 405, { ok: false, error: 'POST only' }); return }
    let body = ''
    for await (const chunk of req) body += chunk
    let b = {}
    try { b = JSON.parse(body || '{}') } catch { json(res, 400, { ok: false, error: '请求体不是 JSON' }); return }
    const id = String(b.id ?? '')
    if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
    if (b.action === 'reject') {
      // #41：拒的时候可以写一句为什么（可留空）。这句话会进因果账，她会读到。
      const r = rejectDraft(id, String(b.why ?? ''))
      json(res, 200, { ok: r.ok, error: r.error ?? null, reason: r.reason ?? null })
      return
    }
    if (!id.startsWith('dyn-')) {
      json(res, 400, { ok: false, error: '暂只支持动态草稿放行（回信稿等 dm 死循环修复上线后接入）' })
      return
    }
    const r = await approveFromPanel({ id, why: String(b.why ?? '') })
    json(res, 200, { ok: r.ok, status: r.status ?? null, error: r.error ?? null, dynId: r.dynId ?? null, outTail: r.outTail ?? '' })
  },
  '/api/avatar': (req, res) => {
    try { const b = fs.readFileSync(path.join(whaleHome, 'avatar.png')); res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=60' }); res.end(b) } catch { json(res, 404, { ok: false, error: '未设置头像：放一张 png 到 ' + path.join(whaleHome, 'avatar.png') }) }
  },
  '/api/vitals': (req, res) => json(res, 200, vitals({ whaleHome, home: HOME, traffic: trafficGuard(), schedStatusGetter: () => schedStatus })),
}

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(obj))
}

const table = new Map()
for (const [p, h] of Object.entries(routes)) {
  table.set(p, h)
  table.set(p.replace('/dsh-bili/api/', '/api/'), h) // panel 前端短别名
}
for (const [p, h] of Object.entries(extra)) table.set(p, h)

const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://x').pathname
  if (pathname === '/' || pathname === '/index.html') {
    if (!authorized(req, token).ok && !/t=/.test(req.url)) {
      res.writeHead(401, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('whale-panel 需要访问令牌：第一次请用 http://127.0.0.1:' + PORT + '/?t=<见 panel.token>' + ' 打开（token 也在 ' + path.join(whaleHome, 'panel.token') + '）')
      return
    }
    const a = authorized(req, token)
    if (!a.ok) { json(res, a.code, { ok: false, error: a.error }); return }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(fs.readFileSync(path.join(HERE, 'views', 'tank.html'), 'utf8'))
    return
  }
  const handler = table.get(pathname)
  if (!handler && pathname.startsWith('/assets/')) {
    const a = authorized(req, token)
    if (!a.ok) { json(res, a.code, { ok: false, error: a.error }); return }
    const base = path.join(HERE, 'assets')
    const f = path.normalize(path.join(base, pathname.slice('/assets/'.length)))
    if (!f.startsWith(base + path.sep)) { json(res, 403, { ok: false, error: '非法资产路径' }); return }
    try {
      const body = fs.readFileSync(f)
      const ext = path.extname(f).toLowerCase()
      res.writeHead(200, { 'Content-Type': ext === '.png' ? 'image/png' : ext === '.json' ? 'application/json; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'max-age=3600' })
      res.end(body)
    } catch { json(res, 404, { ok: false, error: '没有这个资产' }) }
    return
  }
  if (!handler) { json(res, 404, { ok: false, error: '未知路径' }); return }
  const a = authorized(req, token)
  if (!a.ok) { json(res, a.code, { ok: false, error: a.error }); return }
  try { await handler(req, res) } catch (e) { json(res, 500, { ok: false, error: String(e?.message ?? e) }) }
})

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error('[whale-panel] 端口 ' + PORT + ' 已被占用：可能已有一个面板在跑。')
    console.error('  → 直接用浏览器打开 http://127.0.0.1:' + PORT + '/?t=<panel.token>')
    console.error('  → 或双击 start.cmd（会自动复用/换端口）')
  } else console.error('[whale-panel] 启动失败：' + e.message)
  process.exit(2)
})
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[whale-panel] http://127.0.0.1:${PORT}/  （已带 token 自动打开；token 存 ${path.join(whaleHome, 'panel.token')}，勿外传/勿截屏）`)
  console.log(`[whale-panel] home=${whaleHome} · 生物钟=${schedStatus.ok ? '✓ ' + schedStatus.reason : '✗ ' + schedStatus.reason}`)
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { sched?.stop() } catch {}; server.close(); setTimeout(() => process.exit(0), 200).unref() })

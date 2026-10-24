/**
 * whale-panel —— 独立设置/鱼缸面板（阶段 4）。
 *
 *   node panel/server.js [--port 8441]
 *
 * 复用 core/api/routes.js 的 9 条路由（宿主无关），外面套 panel 自己的栅栏：
 *   只绑 127.0.0.1 + Bearer/token fail-closed（取代 DSH requestRejection）。
 * 新增三条：/api/vitals（HUD 聚合，补 traffic 余量缺口）、/api/timeline、/api/diary。
 * 生物钟：面板进程自带 startScheduler（controller 默认 OpenCode 端口实现，
 *   设 PANEL_NO_SCHED=1 可关，交给 pm2 的 whale-daemon 跑）。
 */
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { HOME, DSH_HOME as WHALE_HOME, configPath, credentialsPath } from '../tools/lib/paths.mjs'
import { guardedFetch, trafficGuard } from '../tools/lib/traffic.mjs'
import { makeRoutes } from '../core/api/routes.js'
import { makeExecNode } from '../core/api/support.js'
import { resolveNodeRuntime } from '../core/node-runtime.js'
import { startScheduler } from '../core/scheduler.js'
import { createOpenCodeController } from '../adapters/opencode/controller.js'
import { loadToken, authorized } from './auth.js'
import { timeline, diary, vitals } from './data.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const pi = process.argv.indexOf('--port')
const PORT = Number(pi >= 0 ? process.argv[pi + 1] : (process.env.PANEL_PORT || 8441))

let NODE_EXE = null
try { NODE_EXE = resolveNodeRuntime(WHALE_HOME) } catch (e) { globalThis.__biliWhaleNodeError = String(e?.message ?? e) }
const execNode = makeExecNode(() => NODE_EXE)

let schedStatus = { ok: false, reason: '未启动（PANEL_NO_SCHED=1）', at: null }
let sched = null
if (!process.env.PANEL_NO_SCHED) {
  try {
    let userCfg = {}
    try { userCfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
    sched = startScheduler({ controller: createOpenCodeController() }, {
      dshHome: WHALE_HOME,
      biliMjs: userCfg.toolsPath || path.join(ROOT, 'tools', 'bili.mjs'),
      cwd: userCfg.home || path.join(WHALE_HOME, 'whale-work'),
      sessionId: 'bili-whale',
      log: (m) => { try { console.log(m) } catch {} },
    })
    schedStatus = { ok: true, reason: '已启动（每 60 秒 tick）', at: new Date().toISOString() }
  } catch (e) {
    schedStatus = { ok: false, reason: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() }
  }
}

const { routes } = makeRoutes({
  cfgFile: configPath, credFile: credentialsPath, toolsRoot: ROOT,
  home: HOME, whaleHome: WHALE_HOME,
  getSchedStatus: () => schedStatus, execNode, fetch: guardedFetch,
  onConfigSaved: (changed) => { try { sched?.invalidate(changed) } catch {} },
})

const { token } = loadToken(WHALE_HOME)
const extra = {
  '/api/timeline': (req, res) => {
    const u = new URL(req.url, 'http://x')
    json(res, 200, timeline(WHALE_HOME, { cursor: u.searchParams.get('cursor') || 0, limit: u.searchParams.get('limit') || 50 }))
  },
  '/api/diary': (req, res) => json(res, 200, diary(WHALE_HOME)),
  '/api/vitals': (req, res) => json(res, 200, vitals({ whaleHome: WHALE_HOME, home: HOME, traffic: trafficGuard(), schedStatusGetter: () => schedStatus })),
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
      res.end('whale-panel 需要访问令牌：第一次请用 http://127.0.0.1:' + PORT + '/?t=' + token + ' 打开（token 也在 ' + path.join(WHALE_HOME, 'panel.token') + '）')
      return
    }
    const a = authorized(req, token)
    if (!a.ok) { json(res, a.code, { ok: false, error: a.error }); return }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' })
    res.end(fs.readFileSync(path.join(HERE, 'views', 'tank.html'), 'utf8'))
    return
  }
  const handler = table.get(pathname)
  if (!handler) { json(res, 404, { ok: false, error: '未知路径' }); return }
  const a = authorized(req, token)
  if (!a.ok) { json(res, a.code, { ok: false, error: a.error }); return }
  try { await handler(req, res) } catch (e) { json(res, 500, { ok: false, error: String(e?.message ?? e) }) }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[whale-panel] http://127.0.0.1:${PORT}/?t=${token}`)
  console.log(`[whale-panel] home=${WHALE_HOME} · 生物钟=${schedStatus.ok ? '✓ ' + schedStatus.reason : '✗ ' + schedStatus.reason}`)
})
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { try { sched?.stop() } catch {}; server.close(); setTimeout(() => process.exit(0), 200).unref() })

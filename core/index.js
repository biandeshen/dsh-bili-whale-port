/**
 * adapters 的 DSH 半边（阶段 2 拆分后，本文件只剩三件事）：
 *   1. 信任栅栏：connection.requestRejection + fail-closed（core 路由不含它，DSH 专用）
 *   2. 路由挂载：ctx.webServer.register（路径与行为见 core/api/routes.js）
 *   3. 生物钟生命周期：startScheduler({controller: ctx.sessionController}) + ctx.effect 回收
 *
 * 设置页 UI 的 slots 注册在 core/client.js（同为本 adapter 的客户端半边）。
 * panel / opencode 宿主复用 core/api/routes.js + core/ 的其余部分，不经过本文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { guardedFetch } from '../tools/lib/traffic.mjs'
import { startScheduler } from './scheduler.js'
import { resolveWorkDir } from './work-dir.js'
import { resolveNodeRuntime, nodeEnv } from './node-runtime.js'
import { HOME, whaleHome, configPath, credentialsPath } from '../tools/lib/paths.mjs'
import { makeRoutes } from './api/routes.js'
import { makeExecNode } from './api/support.js'

/** 生物钟状态：{ ok, reason, at } —— 设置页/体检用它回答「时钟是不是活的」 */
let SCHED_STATUS = { ok: false, reason: '未初始化', at: null }

// 真 node 路径（Electron 的 process.execPath 是 Harness.exe ✗ 跑不了 node 脚本）；
// home 解析统一走 paths.mjs（WHALE_HOME → 旧名 DSH_HOME → ~/.dsh）。解析失败不静默回退，
// 原因记在 globalThis.__biliWhaleNodeError，由依赖体检显示真因。
let NODE_EXE = null
try {
  NODE_EXE = resolveNodeRuntime(whaleHome)
} catch (e) {
  globalThis.__biliWhaleNodeError = String(e?.message ?? e)
}
const execNode = makeExecNode(() => NODE_EXE)

const HERE = path.dirname(fileURLToPath(import.meta.url))
const TOOLS_ROOT = path.join(HERE, '..')
// 2026-10-21 修 Issue #6：她的会话工作目录必须是专用小目录，不能用用户主目录 ✗
const WORK_DIR = path.join(whaleHome, 'whale-work')

export default {
  name: 'dsh-bili-whale',
  // ⚠️ 2026-10-18 踩的坑：以前写了两个 inject 键 ✗ → 后者覆盖前者 → sessionController 没注入
  //   → 生物钟每 60 秒静默 return。一个数组写全 ✓
  inject: ['sessionController', 'webServer', 'connection'],
  apply(ctx) {
    /** 写操作只认本机回环：DSH Web 端口若被绑到 0.0.0.0，局域网里任何人都能改 cookie/换主人 mid。 */
    function isLoopbackReq(req) {
      const host = String(req.headers?.host ?? '').toLowerCase()
      const h = host.split(':')[0]
      return h === '127.0.0.1' || h === 'localhost' || h === '[::1]' || h === '::1'
    }

    // P1-1（Kimi 评审 #8）：信任栅栏不可用时必须 fail-closed（写操作尤其），只给静态页面留活路。
    function rejected(req, res, { strict = true } = {}) {
      if (isLoopbackReq(req) === false) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: '只接受本机回环访问' }))
        return true
      }
      try {
        const conn = ctx.get('connection') || ctx.connection
        if (!conn || typeof conn.requestRejection !== 'function') {
          if (!rejected.warned) {
            rejected.warned = true
            console.warn('[bili-whale] 信任栅栏不可用：connection 服务缺失 → 按 fail-closed 处理')
          }
          if (strict) {
            res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
            res.end(JSON.stringify({ ok: false, error: '信任栅栏不可用，拒绝访问（fail-closed）' }))
            return true
          }
          return false
        }
        const code = conn.requestRejection(req)
        if (code === undefined || code === null || code === false) return false
        res.statusCode = typeof code === 'number' ? code : 403
        res.end()
        return true
      } catch (e) {
        if (strict) {
          res.writeHead(503, { 'Content-Type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify({ ok: false, error: '信任栅栏异常，拒绝访问（fail-closed）' }))
          return true
        }
        return false
      }
    }

    let sched = null
    const { routes } = makeRoutes({
      cfgFile: configPath,
      credFile: credentialsPath(),
      toolsRoot: TOOLS_ROOT,
      home: HOME,
      whaleHome,
      getSchedStatus: () => SCHED_STATUS,
      execNode,
      fetch: guardedFetch,
      onConfigSaved: (changed) => { try { sched?.invalidate(changed) } catch {} },
    })

    const disposers = []
    for (const [pathname, handler] of Object.entries(routes)) {
      disposers.push(ctx.webServer.register({
        kind: 'exact',
        path: pathname,
        handler: async (req, res) => {
          if (rejected(req, res)) return
          try { await handler(req, res) } catch (err) {
            try {
              res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
              res.end(JSON.stringify({ ok: false, error: String(err?.message ?? err) }))
            } catch {}
          }
        },
      }))
    }

    // 自主生物钟：时钟起不来以前只 console.warn ✗ → 状态记下来，/deps 带出去 ✓
    try {
      let userCfg = {}
      try { userCfg = JSON.parse(fs.readFileSync(configPath, 'utf8')) } catch {}
      if (userCfg.clock?.enabled === false) {
        // 生物钟交给外部宿主（如 Cortico World）时，插件不再自己排唤醒，避免两套调度撞车
        SCHED_STATUS = { ok: false, reason: '已禁用（clock.enabled=false，调度交给外部宿主）', at: new Date().toISOString() }
      } else {
        const biliMjs = userCfg.toolsPath || path.join(TOOLS_ROOT, 'tools', 'bili.mjs')
        sched = startScheduler({ controller: ctx.sessionController }, {
          whaleHome,
          biliMjs,
          cwd: resolveWorkDir(userCfg.home, WORK_DIR),
          sessionId: 'bili-whale',
          log: (m) => { try { console.log(m) } catch {} },
        })
        SCHED_STATUS = { ok: true, reason: '已启动（每 60 秒 tick）', at: new Date().toISOString() }
      }
    } catch (e) {
      SCHED_STATUS = { ok: false, reason: String(e?.message ?? e).slice(0, 300), at: new Date().toISOString() }
      try { console.warn('[bili-whale] 生物钟启动失败：' + e.message) } catch {}
    }

    ctx.effect(() => () => {
      try { sched?.stop() } catch {}
      for (const d of disposers) { try { d() } catch {} }
    })

    try {
      console.log(`[bili-whale] 设置页已挂载：/dsh-bili/ · 配置 ${configPath}`)
    } catch {}
  },
}

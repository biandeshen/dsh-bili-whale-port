/**
 * whale-daemon —— OpenCode 宿主的常驻生物钟（pm2 / WinSW / systemd / Termux 均可托管）。
 *
 *   环境变量：
 *     WHALE_HOME   她的工作根（默认 ~/.dsh —— 与 DSH 共目录也安全：文件按前缀隔离）
 *     OPENCODE_BASE_URL / OPENCODE_SERVER_PASSWORD  server API 接入（默认 http://127.0.0.1:4096）
 *     BILI_WHALE_CONFIG  配置覆盖（沿用既有）
 *
 *   用法：node daemon.js [--once]   （--once = 只跑一个 tick 就退出，冒烟/定时任务用）
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { startScheduler } from '../../core/scheduler.js'
import { createOpenCodeController } from './controller.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..', '..')

function readCfg() {
  const p = process.env.BILI_WHALE_CONFIG || path.join(process.env.WHALE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || process.env.HOMEDRIVE + process.env.HOMEPATH || '.', '.dsh'), 'bili-whale.config.json')
  try { return { file: p, ...JSON.parse(fs.readFileSync(p, 'utf8')) } } catch { return { file: p } }
}

const ONCE = process.argv.includes('--once')

async function main() {
  const cfg = readCfg()
  const whaleHome = process.env.WHALE_HOME || path.dirname(cfg.file)
  fs.mkdirSync(whaleHome, { recursive: true })
  const controller = createOpenCodeController()
  let sched
  try {
    // 不传 isBusy：OpenCode 的会话状态查询是异步且依赖运行期生成的 ses_* id，
    // 同步端口传 Promise 会被当成"她一直在忙"→ tick 永不执行（复审 P0）。
    // 忙闲由 core 的 8 分钟硬冷却兜底；等 controller 暴露可靠的同步缓存再接回来。
    sched = startScheduler({ controller }, {
      dshHome: whaleHome,
      biliMjs: cfg.toolsPath || path.join(ROOT, 'tools', 'bili.mjs'),
      cwd: cfg.home || path.join(whaleHome, 'whale-work'),
      sessionId: 'bili-whale',
      host: 'opencode',
      log: (m) => console.log(m),
    })
    console.log(`[whale-daemon] 生物钟已启动 · home=${whaleHome} · opencode=${process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096'}`)
  } catch (e) {
    console.error('[whale-daemon] 启动失败：' + e.message)
    process.exitCode = 1
    return
  }
  if (ONCE) {
    await sched.tick()
    sched.stop()
    console.log('[whale-daemon] --once 完成')
    return
  }
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => { try { sched.stop() } catch {}; console.log(`[whale-daemon] ${sig}，时钟已停`); setTimeout(() => process.exit(0), 200).unref() })
  }
}
main().catch((e) => { console.error('[whale-daemon] 未捕获：' + e.message); process.exitCode = 1 })

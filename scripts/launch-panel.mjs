// 一键启动器：端口占用时复用已有面板、换端口或给出人话错误；不再让 start.cmd 直接崩
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const HOME = process.env.WHALE_HOME || path.join(process.env.USERPROFILE || process.env.HOME || '.', '.dsh')
const BASE = (() => { const n = Number(process.env.PANEL_PORT || 8447); return Number.isInteger(n) && n > 0 && n < 65536 ? n : 8447 })()
const tokenFile = path.join(HOME, 'panel.token')
const readToken = () => { try { return fs.readFileSync(tokenFile, 'utf8').trim() } catch { return '' } }

const free = (port) => new Promise((res) => {
  const s = net.connect({ host: '127.0.0.1', port })
  s.once('connect', () => { s.destroy(); res(false) })
  s.once('error', () => res(true))
  setTimeout(() => { s.destroy(); res(false) }, 800)
})
const healthy = async (port, token) => {
  if (!token) return false
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/vitals`, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(1500) })
    return r.status === 200
  } catch { return false }
}
const open = (url) => {
  const cmd = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open'
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url]
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref()
  console.log(`\n[whale] 面板：${url}\n`)
}

const token = readToken()
for (let port = BASE; port < BASE + 10; port++) {
  if (!(await free(port))) {
    if (await healthy(port, token)) { console.log(`[whale] ${port} 已有面板在跑，直接打开`); open(`http://127.0.0.1:${port}/?t=${token}`); process.exit(0) }
    console.log(`[whale] ${port} 被其他程序占用，尝试 ${port + 1}`)
    continue
  }
  fs.mkdirSync(HOME, { recursive: true })
  console.log(`[whale] 启动面板于 127.0.0.1:${port}`)
  const child = spawn(process.execPath, [path.join(ROOT, 'panel', 'server.js'), '--port', String(port)], {
    env: { ...process.env, PANEL_PORT: String(port) }, stdio: 'inherit',
  })
  const waiter = setInterval(() => {
    const t = readToken()
    if (t) { clearInterval(waiter); if (!process.env.WHALE_NO_BROWSER) open(`http://127.0.0.1:${port}/?t=${t}`) }
  }, 400)
  const stop = () => { try { child.kill() } catch {}; clearInterval(waiter) }
  process.on('SIGINT', () => { stop(); process.exit(0) })
  process.on('SIGTERM', () => { stop(); process.exit(0) })
  child.on('exit', (code) => { clearInterval(waiter); process.exit(code ?? 0) })
  break
}

/**
 * 单实例启动器：node scripts/start-cortico.mjs
 * - pid 文件：~/.dsh/bili-whale/control/cortico.pid
 * - 已在跑 → 只调 /api/run/resume，不再开第二个
 * - 没在跑 → 起 OFM 代理（如需）+ Cortico（detached，日志落 control/cortico.log）+ 写 pid + 等健康 + resume
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'

const HOME = process.env.USERPROFILE || process.env.HOME || '.'
const CONTROL = path.join(HOME, '.dsh', 'bili-whale', 'control')
const PID_FILE = path.join(CONTROL, 'cortico.pid')
const LOG_FILE = path.join(CONTROL, 'cortico.log')
const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const PROXY = path.join(HOME, '.dsh', 'ofm-go-proxy', 'proxy.mjs')
const NODE = process.platform === 'win32' ? 'C:/Program Files/nodejs/node.exe' : process.execPath

fs.mkdirSync(CONTROL, { recursive: true })

const alive = (pid) => { try { process.kill(pid, 0); return true } catch { return false } }
/**
 * 本机装了 SteamCommunity 302：它用 hosts 把 GitHub 系域名指到 127.0.0.1:443，并用自己的根证书签发
 * （根证书已在 Windows 信任库里）。Node 默认不读系统证书库，所以扩展市场与 npm 会报
 * UNABLE_TO_GET_ISSUER_CERT_LOCALLY —— 挂代理也解决不了（代理没开时 hosts 仍然生效）。
 * `--use-system-ca` 让 Node 读系统信任库，用不用 Clash 都能出网；该参数是 Node 22.15/23 起才有。
 */
function systemCaFlags(version = process.versions.node) {
  const [major, minor] = String(version).split('.').map(Number)
  return major >= 24 || (major === 23) || (major === 22 && minor >= 15) ? ['--use-system-ca'] : []
}
if (process.argv.includes('--print-flags')) { console.log(systemCaFlags().join(' ')); process.exit(0) }
const CA_FLAGS = systemCaFlags()
const health = async (ms = 1500) => {
  try { const r = await fetch('http://127.0.0.1:7799/', { signal: AbortSignal.timeout(ms) }); return r.ok } catch { return false }
}
const resume = async () => {
  try { await fetch('http://127.0.0.1:7799/api/run/resume', { method: 'POST', signal: AbortSignal.timeout(3000) }) } catch {}
}

let pid = 0
try { pid = Number(fs.readFileSync(PID_FILE, 'utf8').trim()) } catch {}

if (pid && alive(pid) && await health()) {
  await resume()
  console.log(`[start] Cortico 已在运行（pid ${pid}），已发送继续`)
  process.exit(0)
}
if (await health()) {
  await resume()
  console.log('[start] 7799 已有 Cortico 在跑（pid 文件缺失/过期），已发送继续')
  process.exit(0)
}

// OFM 代理
let proxyUp = false
try { const r = await fetch('http://127.0.0.1:18910/v1/responses', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(1200) }); proxyUp = r.status > 0 } catch {}
if (!proxyUp) {
  const fd = fs.openSync(path.join(CONTROL, 'proxy.log'), 'a')
  const p = spawn(NODE, [PROXY], { detached: true, stdio: ['ignore', fd, fd] })
  p.unref()
  console.log('[start] 已启动 OFM 代理（pid ' + p.pid + '）')
  await new Promise((r) => setTimeout(r, 1500))
}

// Cortico
const fd = fs.openSync(LOG_FILE, 'a')
const child = spawn(NODE, [...CA_FLAGS, path.join(CORTICO, 'bin', 'cortico.mjs'), 'mybot', '--port=7799'], {
  cwd: CORTICO, detached: true, stdio: ['ignore', fd, fd],
  // 传给子进程：扩展安装走 pnpm（另一个 node 进程），它也要读系统证书库
  env: { ...process.env, NODE_OPTIONS: [process.env.NODE_OPTIONS, ...CA_FLAGS].filter(Boolean).join(' ').trim() },
})
child.unref()
fs.writeFileSync(PID_FILE, String(child.pid) + '\n')
console.log('[start] Cortico 启动中（pid ' + child.pid + '），日志：' + LOG_FILE)

for (let i = 0; i < 80; i++) {
  if (await health()) break
  await new Promise((r) => setTimeout(r, 500))
}
if (!(await health())) { console.error('[start] 40 秒内未就绪，请查看日志：' + LOG_FILE); process.exit(1) }
await resume()
console.log('[start] 就绪：http://127.0.0.1:7799/（已发送继续）')

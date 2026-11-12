#!/usr/bin/env node
/**
 * 真机部署预检（零依赖）：node scripts/preflight.mjs [--json]
 * 退出码：0 = 可上线（可能有警告）；1 = 有阻塞项。
 * 只读；除临时写权限探测外不修改任何文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { HOME, whaleHome as WHALE_HOME, configPath, credentialsPath } from '../tools/lib/paths.mjs'
import { trafficGuard } from '../tools/lib/traffic.mjs'
import { hostRoot } from './lib/host-root.mjs'

const JSON_OUT = process.argv.includes('--json')
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
const results = []
const add = (level, name, detail) => results.push({ level, name, detail })
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }

const major = Number(process.versions.node.split('.')[0])
add(major >= 20 ? 'ok' : 'fail', 'Node 运行时', `v${process.versions.node}（要求 ≥20）`)

try {
  fs.mkdirSync(WHALE_HOME, { recursive: true })
  const probe = path.join(WHALE_HOME, `.preflight-${process.pid}`)
  fs.writeFileSync(probe, '1'); fs.rmSync(probe)
  add('ok', 'WHALE_HOME 可写', WHALE_HOME)
} catch (e) { add('fail', 'WHALE_HOME 不可写', `${WHALE_HOME}：${e.message}`) }

const cfg = readJson(configPath)
if (!cfg) add('warn', '配置文件缺失', `${configPath}（首次运行会用默认值，建议先在宿主设置页保存一次）`)
else {
  add('ok', '配置文件', configPath)
  if (!String(cfg.owner?.mid ?? '').trim()) add('warn', '主人 mid 未设置', '分享/@ 会发不出去，去宿主「你（主人）」配置里填')
  if (cfg.notify?.type === 'ntfy' || cfg.notify?.type === 'bark') {
    try {
      const u = new URL(cfg.notify.url)
      const local = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(u.hostname)
      add(u.protocol === 'https:' || (u.protocol === 'http:' && local) ? 'ok' : 'fail', '推送地址', `${cfg.notify.type} · ${u.origin}（https 或局域网 http）`)
    } catch { add('fail', '推送地址无效', String(cfg.notify?.url ?? '')) }
  }
}

const cred = readJson(credentialsPath())
if (!cred?.sessdata || !cred?.bili_jct) add('fail', 'B 站凭据缺失（旧家）', `${credentialsPath()}：这是旧家兜底口径；线上真正读的是 <部署家>/xiaoyu/.env，去宿主「连接」页粘贴 cookie`)
else if (String(cred.bili_jct).length !== 32) add('warn', 'bili_jct 长度异常', `长度 ${String(cred.bili_jct).length}，B 站目前 32 位十六进制`)
else add('ok', 'B 站凭据', 'SESSDATA + bili_jct 已就位')

const bili = path.join(ROOT, 'tools', 'bili.mjs')
add(fs.existsSync(bili) ? 'ok' : 'fail', '工具链入口', bili)

try {
  const t = trafficGuard().status()
  // until 是「熔断到期时刻」，过期后 guard 自己就放行了（traffic.mjs:69 比的是 until > now）。
  // 这里不比较就会把三天前的旧熔断报成「熔断中」，让人以为她被拦着。
  const breaking = Number(t.until ?? 0) > Date.now()
  add('ok', '风控状态可读', breaking ? `熔断中至 ${new Date(t.until).toLocaleString()}` : `未熔断 · 账号桶 ${Object.keys(t.accounts ?? {}).length} 个`)
} catch (e) { add('fail', '风控状态损坏', e.message) }

try { add('ok', '宿主代码树', hostRoot()) }
catch (e) { add('fail', '宿主代码树未定位', e.message) }

const deployRoot = process.env.CORTICO_HOME || path.join(HOME, '.xiaoyu-home')
const deployJson = path.join(deployRoot, process.env.CORTICO_BOT || 'xiaoyu', 'deployment.json')
const dep = readJson(deployJson)
if (!dep) add('fail', '线上部署缺失', `${deployJson}：起进程前先备好部署根（见 docs/CORTICO-RUNBOOK.md）`)
else add('ok', '线上部署', `${deployJson} · bot=${dep.bot ?? '(未写)'}`)

const port = 7799
await new Promise((resolve) => {
  const s = net.connect({ host: '127.0.0.1', port })
  s.once('connect', () => { add('warn', `端口 ${port} 已被占用`, '可能已有 Cortico 在跑；确认只有一份时钟，重起只用 scripts/start-cortico.mjs'); s.destroy(); resolve() })
  s.once('error', () => { add('ok', `端口 ${port} 可用`, 'node scripts/start-cortico.mjs 可起'); resolve() })
  setTimeout(() => { s.destroy(); add('ok', `端口 ${port} 探测超时`, '按可用处理'); resolve() }, 800)
})

const fails = results.filter(r => r.level === 'fail')
if (JSON_OUT) { console.log(JSON.stringify({ ok: fails.length === 0, results }, null, 2)) }
else {
  for (const r of results) console.log(`${r.level === 'ok' ? '✓' : r.level === 'warn' ? '⚠️' : '✗'} ${r.name}：${r.detail}`)
  console.log(`\n预检${fails.length ? `失败（${fails.length} 项阻塞）` : '通过'}${results.some(r => r.level === 'warn') ? '，含警告' : ''}。`)
}
process.exitCode = fails.length ? 1 : 0

#!/usr/bin/env node
/**
 * 一键安装/启动：node scripts/setup.mjs [--check]
 * 1) 检查 Node/opencode  2) 建 WHALE_HOME 与默认配置（不覆盖已有）
 * 3) 把 bili MCP 合并进 ~/.config/opencode/opencode.jsonc（先备份）
 * 4) 起 opencode serve（生成密码存 WHALE_HOME/.opencode-password）
 * 5) 起 whale-daemon  6) 起 panel 并打印一次带 token 的地址
 * --check 只做检查与计划，不动任何服务/文件（除读）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { whaleHome as WHALE_HOME } from '../tools/lib/paths.mjs'
import { DEFAULTS } from '../core/api/support.js'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHECK = process.argv.includes('--check')
const PORT = 8447
const OC_PORT = 4096
const log = (s) => console.log(s)
const exists = (p) => { try { fs.accessSync(p) } catch { return false } return true }
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }
const ok = (b) => b ? '✓' : '✗'
let fails = 0
const need = (b, name, detail) => { log(`${ok(b)} ${name}${detail ? '：' + detail : ''}`); if (!b) fails++; return b }

log('🐋 whale 一键安装\n')
const major = Number(process.versions.node.split('.')[0])
need(major >= 20, 'Node 运行时', 'v' + process.versions.node)
const oc = spawnSync(process.platform === 'win32' ? 'where' : 'which', ['opencode'], { encoding: 'utf8' }).stdout?.trim().split(/\r?\n/)[0] || ''
need(!!oc, 'opencode', oc || '未安装（https://opencode.ai 安装后重跑）')
need(exists(path.join(ROOT, 'tools', 'bili.mjs')), '工具链', 'tools/bili.mjs')

// 1) home & config
const cfgFile = path.join(WHALE_HOME, 'bili-whale.config.json')
log(`\n[1/4] 目录与配置：${WHALE_HOME}`)
if (!CHECK) fs.mkdirSync(WHALE_HOME, { recursive: true })
if (exists(cfgFile)) log(`  ✓ 配置已存在，不覆盖：${cfgFile}`)
else {
  log(`  → 写入默认配置：${cfgFile}`)
  if (!CHECK) fs.writeFileSync(cfgFile, JSON.stringify(DEFAULTS, null, 2) + '\n')
}
const creds = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.bili-ai', 'credentials.json')
log(`  ${exists(creds) ? '✓' : '⚠️'} B站 cookie：${exists(creds) ? '已就位' : '还没有（装完在面板里填）'}`)

// 2) MCP 合并（备份原文件）
log('\n[2/4] OpenCode MCP')
const ocDir = path.join(process.env.USERPROFILE || process.env.HOME || '.', '.config', 'opencode')
const ocCfg = path.join(ocDir, 'opencode.jsonc')
const mcpEntry = { type: 'local', command: [process.execPath, path.join(ROOT, 'adapters', 'opencode', 'mcp-stdio.js')], enabled: true }
let parsed = null
if (exists(ocCfg)) {
  try {
    const raw = fs.readFileSync(ocCfg, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
    parsed = JSON.parse(raw)
  } catch { log('  ⚠️ 现有 opencode.jsonc 解析失败（含复杂注释？）→ 跳过自动合并，请按 docs 手动加'); parsed = null }
}
if (parsed) {
  parsed.mcp = parsed.mcp || {}
  parsed.mcp.bili = { ...(parsed.mcp.bili || {}), ...mcpEntry }
  if (!CHECK) {
    const bak = ocCfg + '.bak-' + new Date().toISOString().replace(/[:.]/g, '-')
    fs.copyFileSync(ocCfg, bak); log(`  ✓ 已备份：${bak}`)
    fs.writeFileSync(ocCfg, JSON.stringify(parsed, null, 2) + '\n'); log('  ✓ 已合并 mcp.bili')
  } else log('  → 将合并 mcp.bili（--check 未写入）')
} else if (!exists(ocCfg)) {
  if (!CHECK) { fs.mkdirSync(ocDir, { recursive: true }); fs.writeFileSync(ocCfg, JSON.stringify({ mcp: { bili: mcpEntry } }, null, 2) + '\n') }
  log('  → 新建 opencode.jsonc 并写入 mcp.bili')
}

// 3) opencode serve
log('\n[3/4] OpenCode server')
const passFile = path.join(WHALE_HOME, '.opencode-password')
let pass = exists(passFile) ? fs.readFileSync(passFile, 'utf8').trim() : ''
if (!pass) { pass = 'whale-' + Math.random().toString(36).slice(2, 10); if (!CHECK) fs.writeFileSync(passFile, pass + '\n') }
const basic = 'Basic ' + Buffer.from('opencode:' + pass).toString('base64')
const up = await (async () => { try { const r = await fetch(`http://127.0.0.1:${OC_PORT}/doc`, { headers: { authorization: basic }, signal: AbortSignal.timeout(1500) }); return r.ok } catch { return false } })()
if (up) log(`  ✓ 已在运行：http://127.0.0.1:${OC_PORT}`)
else {
  log(`  → 启动 opencode serve --port ${OC_PORT}（密码存 ${passFile}）`)
  if (!CHECK) {
    const p = spawn(oc || 'opencode', ['serve', '--port', String(OC_PORT)], { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...process.env, OPENCODE_SERVER_PASSWORD: pass } })
    p.unref(); await new Promise((r) => setTimeout(r, 5000))
  }
}

// 4) daemon + panel
log('\n[4/4] 时钟与面板')
const daemonLog = path.join(WHALE_HOME, 'whale-daemon.log')
if (!CHECK) {
  const env = { ...process.env, WHALE_HOME, BILI_WHALE_CONFIG: cfgFile, OPENCODE_BASE_URL: `http://127.0.0.1:${OC_PORT}`, OPENCODE_SERVER_PASSWORD: pass }
  if (exists(creds)) {
    const fd = fs.openSync(daemonLog, 'a')
    const d = spawn(process.execPath, [path.join(ROOT, 'adapters', 'opencode', 'daemon.js')], { cwd: ROOT, detached: true, stdio: ['ignore', fd, fd], env }); d.unref()
    log(`  → whale-daemon 已启动（日志 ${daemonLog}）`)
  } else log('  ⚠️ 没有 B站 cookie → 暂不启动时钟（避免空烧 token）；填好后重跑 setup.cmd')
  const lp = spawn(process.execPath, [path.join(ROOT, 'scripts', 'launch-panel.mjs')], { cwd: ROOT, detached: true, stdio: 'ignore', env: { ...env, PANEL_PORT: String(PORT), WHALE_NO_BROWSER: '1' } }); lp.unref()
  await new Promise((r) => setTimeout(r, 2500))
}
const token = (() => { try { return fs.readFileSync(path.join(WHALE_HOME, 'panel.token'), 'utf8').trim() } catch { return '' } })()
log(`\n${fails ? '✗ 有 ' + fails + ' 项阻塞' : '✓ 安装完成'}\n`)
if (!CHECK) log(`面板： http://127.0.0.1:${PORT}/?t=${token}\n（token 勿截屏外传；关闭：任务管理器结束 node.exe，或 pm2 stop）`)
log(`下一步：打开面板 → 填主人 mid + B站 cookie → 到 20:00–24:00 她自己醒。`)
log(`详细：docs/DEPLOY.md · 排障：docs/RUNBOOK.md`)
process.exitCode = fails ? 1 : 0

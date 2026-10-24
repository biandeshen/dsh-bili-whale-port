/**
 * mcp-stdio —— 把 tools/bili.mjs（40 个 B 站命令）包装成 MCP stdio server。
 *
 * 注册方式（opencode.json）：
 *   "mcp": { "bili": { "type": "local", "command": ["node", "<repo>/adapters/opencode/mcp-stdio.js"], "enabled": true } }
 *
 * 安全契约：
 *   · 只允许 spawn `tools/bili.mjs` —— 禁直连 tools/lib/bili-api.mjs，
 *     所有网络请求必然经过 traffic 风控闸（预算/冷却/熔断/幂等）。
 *   · argv 逐 token 校验（去 NUL/换行，长度上限），无 shell。
 *   · 协议：换行分帧的 JSON-RPC 2.0（initialize / tools/list / tools/call），零依赖。
 */
import readline from 'node:readline'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BILI = path.resolve(HERE, '..', '..', 'tools', 'bili.mjs')
const PROTOCOL_VERSION = '2024-11-05'

const TOOLS = [
  {
    name: 'bili',
    description: 'B 站全家桶 CLI（读：feed/search/comments/subtitles/debrief/video/likes/diary/quota status…；写：comment/dm/fav/dynamic/danmaku…，写命令必须显式 --dry 或 --go）。先跑 `bili help` 看全部命令，再跑 `bili deps --json` 体检。所有请求都过风控预算闸：撞 412/限流会自动暂停，不要重试硬顶。',
    inputSchema: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: 'bili.mjs 的参数数组，例：["feed","--n","6"]；空数组 = 打印帮助' },
        timeoutSec: { type: 'number', description: '可选超时（默认 120 秒，debrief/watch-video 类建议 300）' },
      },
      required: ['args'],
    },
  },
]

function sanitizeArgs(args) {
  if (!Array.isArray(args)) throw new Error('args 必须是字符串数组')
  return args.map((a, i) => {
    const s = String(a)
    if (s.includes('\u0000') || /[\r\n]/.test(s)) throw new Error(`args[${i}] 含非法换行/NUL`)
    if (s.length > 4000) throw new Error(`args[${i}] 超长（>4000）`)
    return s
  })
}

function runBili(args, timeoutSec) {
  const r = spawnSync(process.execPath, [BILI, ...args], {
    encoding: 'utf8', timeout: Math.min(600, Math.max(5, Number(timeoutSec) || 120)) * 1000, windowsHide: true,
  })
  const out = String(r.stdout ?? '') + (r.stderr ? '\n[stderr] ' + String(r.stderr) : '')
  return { text: out || `（无输出，exit=${r.status}）`, isError: r.status !== 0 }
}

function send(msg) { process.stdout.write(JSON.stringify(msg) + '\n') }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }) }
function replyErr(id, message) { send({ jsonrpc: '2.0', id, error: { code: -32000, message } }) }

const rl = readline.createInterface({ input: process.stdin })
rl.on('line', (line) => {
  let m
  try { m = JSON.parse(line) } catch { return }
  const { id, method, params } = m
  if (method === 'initialize') reply(id, { protocolVersion: PROTOCOL_VERSION, capabilities: { tools: {} }, serverInfo: { name: 'bili-whale-tools', version: '0.1.0' } })
  else if (method === 'tools/list') reply(id, { tools: TOOLS })
  else if (method === 'tools/call') {
    try {
      if (params?.name !== 'bili') throw new Error('未知工具：' + params?.name)
      const args = sanitizeArgs(params.arguments?.args ?? [])
      const { text, isError } = runBili(args.length ? args : ['help'], params.arguments?.timeoutSec)
      reply(id, { content: [{ type: 'text', text: text.slice(0, 200_000) }], isError })
    } catch (e) { replyErr(id, String(e?.message ?? e)) }
  } else if (method === 'notifications/initialized') { /* no reply */ }
  else if (id !== undefined) replyErr(id, '不支持的方法：' + method)
})
rl.on('close', () => process.exit(0))

/**
 * 报备（notify）：她每发出一条对外内容，按当前渠道推一句"我发了什么"。
 *
 * 为什么单独一层：
 *   · 渠道由主人在页面 `notify.type` 选，代码不写死任何一种（2026-11-01 主人拍板"要推"）；
 *   · 没配渠道就**不推**，但也不把动作算失败——发都发出去了，报备失败不该反过来说发送错了；
 *   · 同一条内容只报一次：重试、并发、面板与 CLI 同时跑都不该刷屏。
 *
 * 与 `ai-share.mjs` 里的 notifyOnce 的区别：那个是"这条视频暂缓分享"的一次性告警，
 * 判重键是 bvid；这里是动作级报备，判重键是 `${kind}:${id}`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { whalePath } from './paths.mjs'
import { reloadConfig } from './config.mjs'
import { NODE_EXE } from './nodebin.mjs'

const NOTIFY = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'commands', 'notify.mjs')

/** 走同一条通知分发器：渠道与报文格式只有 notify.mjs 一处实现。 */
function sendViaNotify(text, title) {
  execFileSync(NODE_EXE, [NOTIFY, text, '--title', title], { encoding: 'utf8', timeout: 30000, stdio: 'pipe' })
}

/** 报备开关与渠道：只有配了真渠道才算"要推"。 */
const LIVE_TYPES = new Set(['desktop', 'webhook', 'ntfy', 'bark', 'command', 'stdout'])

export function notifyChannel() {
  let cfg = {}
  // 每次现读：页面刚改完通知渠道，这一进程的下一条报备就该走新渠道。
  try { cfg = reloadConfig()?.notify ?? {} } catch { cfg = {} }
  const type = String(cfg.type ?? 'none')
  return { type: LIVE_TYPES.has(type) ? type : 'none', cfg }
}

const ledgerFile = () => whalePath('bili-whale', 'control', 'notified.jsonl')

/** 已经报过这个键了吗；顺带把超过 14 天的旧记录剔掉，别让它无限长。 */
function seenRecently(key) {
  const file = ledgerFile()
  let lines = []
  try { lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean) } catch { return false }
  const cutoff = Date.now() - 14 * 86400_000
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    let e
    try { e = JSON.parse(lines[i]) } catch { continue }
    if (typeof e?.at !== 'number' || e.at < cutoff) continue
    if (e.key === key) return true
  }
  return false
}

function remember(key, ok) {
  const file = ledgerFile()
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, JSON.stringify({ at: Date.now(), key, ok }) + '\n')
  } catch { /* 报备账写不进去不该影响已经发出去的内容 */ }
}

/**
 * 推一条报备。`send(text, title)` 由调用方给（它手里有渠道实现），
 * 这里只负责三件事：渠道是否配了、这条是否已经报过、失败不抛。
 *
 * 返回 `{ notified, skipped, error }`：调用方可以把它写进回执，
 * 但**不要**因为 notified=false 就把这次动作判成失败。
 */
export async function report(kind, id, text, send = sendViaNotify) {
  if (!id) return { notified: false, skipped: 'no-id' }
  const { type } = notifyChannel()
  if (type === 'none') return { notified: false, skipped: 'channel-none' }
  const key = `${kind}:${id}`
  if (seenRecently(key)) return { notified: false, skipped: 'already' }
  try {
    await send(text, `小鱼 · ${kind}`)
    remember(key, true)
    return { notified: true }
  } catch (e) {
    remember(key, false)
    return { notified: false, error: String(e?.message ?? e) }
  }
}

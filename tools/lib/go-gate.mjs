/**
 * go-gate —— 方案三：非分享类写操作（普通评论/收藏/弹幕）的 --go 一律进待审队列，
 * 由主人在 panel「信箱与事件」放行后才真正发出。注入者拿不到主人的点击。
 * 分享链路（comment --share --auto / dm --share）沿用既有评分/额度闸，不经过本文件。
 */
import fs from 'node:fs'
import path from 'node:path'
import { HOME } from './paths.mjs'

const FILE = path.join(HOME, '.bili-ai', 'pending-replies.json')

export function shouldGate(argv, { exemptFlags = [] } = {}) {
  if (!argv.includes('--go')) return false
  return !exemptFlags.some((f) => argv.includes(f))
}

export function queueGo({ argv, kind, who, src, message, oid, bvid }) {
  const items = (() => { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')).items ?? [] } catch { return [] } })()
  const id = Math.random().toString(16).slice(2, 10)
  items.push({ id, at: new Date().toISOString(), kind, who: who || kind, src: src || '', message: message || '', oid: oid ?? '', bvid: bvid ?? '', argv })
  fs.mkdirSync(path.dirname(FILE), { recursive: true })
  fs.writeFileSync(FILE, JSON.stringify({ items }, null, 2) + '\n')
  console.log(`[go-gate] ${kind}（id=${id}）已进待审队列：主人在 panel「信箱与事件」放行后才会发出 ✓`)
  return id
}

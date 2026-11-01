/**
 * go-gate —— 方案三：非分享类写操作（普通评论/收藏/弹幕）的 --go 一律进待审队列，
 * 由主人在 panel「信箱与事件」放行后才真正发出。注入者拿不到主人的点击。
 * 分享链路（comment --share --auto / dm --share）沿用既有评分/额度闸，不经过本文件。
 */
import { readStateText, writeStateText } from './paths.mjs'

const PENDING = 'pending-replies.json'

export function shouldGate(argv, { exemptFlags = [] } = {}) {
  if (!argv.includes('--go')) return false
  return !exemptFlags.some((f) => argv.includes(f))
}

export function queueGo({ argv, kind, who, src, message, oid, bvid, ...extra }) {
  const items = (() => { try { return JSON.parse(readStateText(PENDING)).items ?? [] } catch { return [] } })()
  const id = Math.random().toString(16).slice(2, 10)
  // 结构化字段（含 root/parent/room 等 extra）是放行时重建 argv 的依据：展示什么就执行什么（M1e）
  items.push({ id, at: new Date().toISOString(), kind, who: who || kind, src: src || '', message: message || '', oid: oid ?? '', bvid: bvid ?? '', ...extra, argv })
  writeStateText(JSON.stringify({ items }, null, 2) + '\n', PENDING)
  console.log(`[go-gate] ${kind}（id=${id}）已进待审队列：主人在 panel「信箱与事件」放行后才会发出 ✓`)
  return id
}

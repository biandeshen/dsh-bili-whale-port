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

/**
 * 读不出来就**不许写**：以前这里 catch 成空数组，然后整份写回盘，
 * 一次读错误就把主人排队的放行项静默抹掉。现在只有"文件不存在"才算空队列，
 * 解析失败直接抛出去让调用方停手 —— 丢掉一条待审比悄悄清空整队列好。
 */
function readPending() {
  let text
  try { text = readStateText(PENDING) }
  catch (e) { if (e.code === 'ENOENT') return []; throw e }
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed?.items)) throw new Error(`${PENDING} 里没有 items 数组，拒绝在此基础上追加（会覆盖掉已有条目）`)
  return parsed.items
}

export function queueGo({ argv, kind, who, src, message, oid, bvid, ...extra }) {
  const items = readPending()
  const id = Math.random().toString(16).slice(2, 10)
  // 结构化字段（含 root/parent/room 等 extra）是放行时重建 argv 的依据：展示什么就执行什么（M1e）
  items.push({ id, at: new Date().toISOString(), kind, who: who || kind, src: src || '', message: message || '', oid: oid ?? '', bvid: bvid ?? '', ...extra, argv })
  writeStateText(JSON.stringify({ items }, null, 2) + '\n', PENDING)
  console.log(`[go-gate] ${kind}（id=${id}）已进待审队列：主人在 panel「信箱与事件」放行后才会发出 ✓`)
  return id
}

/**
 * kill switch 唯一读取源（D-22 补做：主人 2026-10-30 图片指令
 * “kill 统一检查也补上，别留口子”，推翻 10-28 的 DECIDED-NO）。
 *
 * 文件位置与 scripts/dynamic-approve.mjs / dm-approve.mjs 同一处：
 *   <whale home>/bili-whale/control/kill
 *
 * 覆盖模型：**不在每个命令里各查一遍**，而是在
 * `tools/lib/traffic.mjs` 的 guarded() 写通道上查——所有 B 站网络请求（comment/fav/
 * danmaku/dm/dynamic-image/edit-dynamic/apiPost、CLI 直接 --go、面板放行、MCP 包装）
 * 都得过这道门；读请求不受影响（急停=停发送，不停读）。
 * approve 层（dynamic-approve/dm-approve）保留更友好的提前拦截，两层同源同文件。
 */
import fs from 'node:fs'
import { dshPath } from './paths.mjs'

/** kill 文件路径（每次调用现算，setHomes 后跟着走）。 */
export const killFile = () => dshPath('bili-whale', 'control', 'kill')

export function isKillOn() {
  try { return fs.existsSync(killFile()) } catch { return false }
}

/**
 * 统一的路径解析（whale home 与用户主目录）。
 *
 * 为什么需要它：宿主半边（core/index.js）读 DSH_HOME，工具链（tools/）此前各自硬编码
 * path.join(HOME, '.dsh')，两边 home 语义一旦不一致就会分叉（配置、生物钟、日记全部错位），
 * 所以所有 tools/ 脚本都从这里取路径，不再本地拼 '.dsh'。
 *
 * 移植期（阶段 1）新增：
 *   · WHALE_HOME —— 非 DSH 宿主（OpenCode daemon / panel / Termux）的规范变量，优先于 DSH_HOME；
 *     DSH_HOME 仍完整生效（双读一版，DSH adapter 零行为变化）。
 *   · setHomes() —— 宿主/测试可在 import 后重设，命名导出为 live binding，消费方自动可见。
 *
 * 保留旧行为：USERPROFILE 优先于 HOME，`BILI_WHALE_CONFIG` 仍可覆盖配置文件位置。
 * 凭据按 OS 用户走 ~/.bili-ai，不随 whale home 漂移。
 */
import os from 'node:os'
import path from 'node:path'

/** 用户主目录（Windows 优先 USERPROFILE，保持与原实现一致）。 */
export const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir() || '.'

function resolveWhaleHome(env = process.env) {
  return env.WHALE_HOME || env.DSH_HOME || path.join(HOME, '.dsh')
}

export let DSH_HOME = resolveWhaleHome()
export let configPath = process.env.BILI_WHALE_CONFIG || path.join(DSH_HOME, 'bili-whale.config.json')

/** 重设 whale home（live binding 传播给所有已 import 的消费方）。 */
export function setHomes({ whaleHome, config } = {}) {
  DSH_HOME = whaleHome || resolveWhaleHome()
  configPath = config || process.env.BILI_WHALE_CONFIG || path.join(DSH_HOME, 'bili-whale.config.json')
}

/** 拼一个位于 whale home 下的路径（历史名 dshPath，语义已是 WHALE_HOME 优先）。 */
export const dshPath = (...parts) => path.join(DSH_HOME, ...parts)

/** 拼一个位于用户主目录下的路径（.bili-ai 等凭据/状态目录用）。 */
export const homePath = (...parts) => path.join(HOME, ...parts)

/** Credentials are per OS user, independent of whale home. */
export const credentialsPath = homePath('.bili-ai', 'credentials.json')

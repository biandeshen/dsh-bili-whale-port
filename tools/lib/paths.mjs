/**
 * 统一的路径解析（whale home 与用户主目录）—— 全仓**唯一**一份 home 优先级实现。
 *
 * 为什么需要它：工具链各处曾各自硬编码 `path.join(HOME, '.dsh')`，与另一边的 home 语义
 * 一旦不一致就会分叉（配置、生物钟、日记全部错位），所以所有脚本都从这里取路径，
 * 不再本地拼 `.dsh`，也不再自己写 `A || B || 默认` 的三级兜底。
 *
 * whale home 优先级（只此一处，见 resolveWhaleHome）：
 *   1. `WHALE_HOME`   —— 规范变量；
 *   2. `DSH_HOME`     —— 旧名，兼容期继续接受（设了就仍生效，不会突然失效）；
 *   3. `<用户主目录>/.dsh` —— 两者都没设时的默认落点。
 * 两者都设时 `WHALE_HOME` 赢。
 *
 * 命名：规范导出是 `whaleHome` / `whalePath`；`DSH_HOME` / `dshPath` 是同一批绑定的
 * 兼容别名（live binding，setHomes() 改一次两个名字都跟着变），只留给历史引用，
 * 新代码一律 import `whaleHome`。
 *
 * 保留旧行为：USERPROFILE 优先于 HOME，`BILI_WHALE_CONFIG` 仍可覆盖配置文件位置。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** 用户主目录（Windows 优先 USERPROFILE，保持与原实现一致）。 */
export const HOME = process.env.USERPROFILE || process.env.HOME || os.homedir() || '.'

/** whale home 的唯一优先级链：WHALE_HOME → DSH_HOME（旧名兼容）→ <HOME>/.dsh。 */
export function resolveWhaleHome(env = process.env) {
  return env.WHALE_HOME || env.DSH_HOME || path.join(HOME, '.dsh')
}

/**
 * 当前 whale home 是否就是默认落点 `<HOME>/.dsh`。
 * 只有"没搬家"的机器才该继续用旧机器上的 legacy 目录（D:/AI/养鱼）——
 * 显式设了 whale home 时，legacy 目录不再参与，否则会跨机器读错草稿。
 */
export function isDefaultWhaleHome(candidate = whaleHome) {
  try { return path.resolve(candidate).toLowerCase() === path.resolve(path.join(HOME, '.dsh')).toLowerCase() }
  catch { return false }
}

export let whaleHome = resolveWhaleHome()
export let configPath = process.env.BILI_WHALE_CONFIG || path.join(whaleHome, 'bili-whale.config.json')

/** 重设 whale home（live binding 传播给所有已 import 的消费方）。 */
export function setHomes({ whaleHome: nextHome, config } = {}) {
  whaleHome = nextHome || resolveWhaleHome()
  configPath = config || process.env.BILI_WHALE_CONFIG || path.join(whaleHome, 'bili-whale.config.json')
}

/** 拼一个位于 whale home 下的路径。 */
export const whalePath = (...parts) => path.join(whaleHome, ...parts)

/** 拼一个位于用户主目录下的路径（.bili-ai 等历史状态目录用）。 */
export const homePath = (...parts) => path.join(HOME, ...parts)

/** Credentials are per OS user, independent of whale home. */
export const credentialsPath = homePath('.bili-ai', 'credentials.json')

/**
 * 旧机器上的固定落点（移植期兼容）。新机器没有这些目录就落 whale home ——
 * 这两个函数是全仓唯一来源（M1a 收口），别再在脚本里散写 `D:/AI/养鱼`。
 * 注意：scripts/hashes.json 冻结的验收脚本里仍有内联 legacy 逻辑（多一道"默认家"判断），
 * 观测结束后重冻时再统一；新代码要旧路径判断请调 isDefaultWhaleHome()，不要自己拼 `.dsh` 比较。
 */
export const LEGACY_DRAFTS = 'D:/AI/养鱼/drafts'
export const LEGACY_IMAGES = 'D:/AI/养鱼/assets/daily'

/** 草稿目录。优先级：WHALE_DRAFTS → 旧路径（存在才用） → whale home。 */
export function draftsDir(env = process.env, { legacy = LEGACY_DRAFTS } = {}) {
  if (env.WHALE_DRAFTS) return env.WHALE_DRAFTS
  if (legacy) { try { if (fs.existsSync(legacy)) return legacy } catch {} }
  return path.join(whaleHome, 'bili-whale', 'drafts')
}

/** 每日立绘目录。优先级：WHALE_IMAGE_DIR / WHALE_IMAGES（两个旧名都认）→ 旧路径 → whale home。 */
export function imagesDir(env = process.env, { legacy = LEGACY_IMAGES } = {}) {
  const e = env.WHALE_IMAGE_DIR || env.WHALE_IMAGES
  if (e) return e
  if (legacy) { try { if (fs.existsSync(legacy)) return legacy } catch {} }
  return path.join(whaleHome, 'bili-whale', 'assets', 'daily')
}

/**
 * 兼容别名（只读出口，别再新增引用）：与 whaleHome / whalePath 是同一个 live binding，
 * setHomes() 之后两个名字一起变；冻结在 scripts/hashes.json 里的验收脚本仍按旧名 import。
 */
export { whaleHome as DSH_HOME, whalePath as dshPath }

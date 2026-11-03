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

/**
 * ── 状态目录（"两个家"归一）───────────────────────────────────────────────
 * 人格状态/配置在 whale home，而 traffic 风控状态、待审队列、凭据、已看账本在
 * `<用户主目录>/.bili-ai` —— 同一个她两份家，备份/搬家/排错都要跑两处。
 *
 * 归一规则（只在此处实现，调用方一律走下面这几个函数，不再自己拼 `.bili-ai`）：
 *   · 新落点 = `<whale home>/bili-ai`：写入永远只落这里；
 *   · 旧落点 = `<用户主目录>/.bili-ai`：**只读兜底**（不改写、不追加）；
 *   · 读"新优先、旧兜底"，写"只落新" —— 同一份状态不会两处各写一半，
 *     旧家那份在下一次写时被整份带进新家后自然退役。
 *   · 两处都读不到时抛 code=ENOENT 并列出两个找过的路径：缺文件是错误，不是空状态。
 *
 * 例外：**credentials.json 不参与归一**，读写都留在旧家（见 credentialsPath()）。
 */

/**
 * 两个落点都**按调用时的 env 解析**，不按 import 时的：
 * 测试是在 import 之后才把 HOME/DSH_HOME 指到临时目录的（静态 import 会被提前求值），
 * 按 import 时求值会让测试写进真机器上的 `~/.dsh` 与 `~/.bili-ai`。
 */
/** 旧落点：`<用户主目录>/.bili-ai`；`BILI_LEGACY_STATE_DIR` 供兼容期与测试覆盖。 */
export function legacyStateDir(env = process.env) {
  return env.BILI_LEGACY_STATE_DIR || path.join(env.USERPROFILE || env.HOME || HOME, '.bili-ai')
}

/** 状态目录的新落点（写入位置）：env 里的 whale home 优先，其次当前 live binding。 */
export function stateDir(env = process.env) {
  return path.join(env.WHALE_HOME || env.DSH_HOME || whaleHome, 'bili-ai')
}

/** 某个状态文件的写入路径 —— 永远是新家。 */
export function statePath(...parts) { return path.join(stateDir(), ...parts) }

/**
 * 旧家兜底的退场日。到期后读列表不再含旧家（旧文件仍在盘上，只是不读了）。
 * 这一条判断只在这里实现：`stateReadPath` 与 `state-roots.resolve()` 都调它，
 * 免得"路径给不给旧家"和"读不读旧家"两处各写一份、到期那天只改了一处。
 */
export const LEGACY_UNTIL = () => process.env.BILI_LEGACY_UNTIL || '2026-12-01'

/** 现在还算不算兼容期内。配错了当没配——宁可继续兜底，也不要某天突然读不到。 */
export function legacyAllowed(now = Date.now()) {
  const until = Date.parse(LEGACY_UNTIL())
  if (Number.isNaN(until)) return true
  return now < until
}

/** 给一次"读到旧家了"的告警只报一次（兼容期结束前要看见还有谁在旧家）。 */
const legacyWarned = new Set()
export function noteLegacyRead(file) {
  const key = String(file)
  if (legacyWarned.has(key)) return
  legacyWarned.add(key)
  console.warn(`[legacy] 读到旧家状态：${key}（退场日 ${LEGACY_UNTIL()}；之后不再读）`)
}

/** 某个状态文件此刻该从哪读：新家存在读新家，否则旧家存在读旧家，都没有则给新家（读出来是 ENOENT）。 */
export function stateReadPath(...parts) {
  const fresh = statePath(...parts)
  try { if (fs.existsSync(fresh)) return fresh } catch {}
  if (!legacyAllowed()) return fresh
  const legacy = path.join(legacyStateDir(), ...parts)
  try {
    if (fs.existsSync(legacy)) { noteLegacyRead(legacy); return legacy }
  } catch {}
  return fresh
}

/** 状态文件是否存在（新家或旧家任一处；兼容期结束后只认新家）。 */
export function stateExists(...parts) {
  try { if (fs.existsSync(statePath(...parts))) return true } catch {}
  if (!legacyAllowed()) return false
  try { return fs.existsSync(path.join(legacyStateDir(), ...parts)) } catch { return false }
}

/**
 * 给"`home` 由外面注入"的老读点用（core/api/routes.js、panel/data.js）：新家优先，
 * 再退到 `<home>/.bili-ai`。这里的 `home` 是**用户主目录**（这两处一直是自己拼
 * `.bili-ai` 的），不是状态目录本身。必须每次调用都重新判——服务启动时定死的话，
 * "启动之后才产生的第一条待审回信"会永远读不到（go-gate 现在往新家写）。
 */
export function stateReadPathFrom(home, ...parts) {
  const fresh = statePath(...parts)
  try { if (fs.existsSync(fresh)) return fresh } catch {}
  if (!legacyAllowed()) return fresh
  const legacy = path.join(home ? path.join(home, '.bili-ai') : legacyStateDir(), ...parts)
  try {
    if (fs.existsSync(legacy)) { noteLegacyRead(legacy); return legacy }
  } catch {}
  return fresh
}

/** 读状态文件（utf8）：新→旧（兼容期内）；两处都没有时抛 code=ENOENT 的错，并列出找过的路径。 */
export function readStateText(...parts) {
  const fresh = statePath(...parts)
  const legacy = path.join(legacyStateDir(), ...parts)
  const tried = legacyAllowed() ? [fresh, legacy] : [fresh]
  for (const p of tried) {
    try {
      const text = fs.readFileSync(p, 'utf8')
      if (p === legacy) noteLegacyRead(p)
      return text
    } catch (e) {
      if (e.code !== 'ENOENT' && e.code !== 'ENOTDIR') throw e
    }
  }
  const err = Error(`读不到 ${parts.join('/')}：${tried.join(' 与 ')} 都不存在`)
  err.code = 'ENOENT'
  throw err
}

/** 写状态文件：先建目录，再落到新家（旧家不会被写）。 */
export function writeStateText(text, ...parts) {
  const target = statePath(...parts)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, text)
  return target
}

/**
 * B 站登录凭据：留在旧家 `~/.bili-ai/credentials.json`，读写都不搬家。
 * 凭据有本仓之外的写入方（主人手工粘 cookie、别的宿主按 OS 用户读同一份）——
 * 一旦本仓把新家的凭据"读优先"起来，手工更新过的旧家那份就会被新家里那份过期副本
 * 压住，登录静默失效。归一只对"所有写入方都走这里"的状态有效，凭据不满足这个前提。
 */
export function credentialsPath(env = process.env) { return path.join(legacyStateDir(env), 'credentials.json') }

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

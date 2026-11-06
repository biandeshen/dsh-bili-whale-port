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
 * ── 行动账（她"做过的事"的账本）────────────────────────────────────────────
 *
 * 2026-11-06 首夜实锤：行动有两本账，搬家前后各写一本：
 *   · 旧账 `<whale home>/bili-whale/causal.jsonl` 的 `kind:'action'` 最后一笔停在 11-03；
 *   · 新账 `<部署家>/<bot>/data/persona/actions.ndjson`（B14 接的只追加流水，每行带
 *     `day`/`activity`/`at`）——搬家后 lifeTick 的行动写这里。
 *
 * 部署家从哪来：`CORTICO_HOME`（宿主部署根，如 `~/.xiaoyu-home`）+ `CORTICO_BOT`（默认 xiaoyu）。
 *
 * **为什么要跟 whale home 一起被隔离**：验收脚本与测试会把 `WHALE_HOME`/`DSH_HOME`
 * 指到临时目录，期望"这个家没有行动 → 观测判 FAIL"。若部署家仍按默认落到真机器的
 * `~/.xiaoyu-home`，脚本会读到**本机真账**——今天有行动 → 误判 PASS。
 * 所以：显式设了 `CORTICO_HOME` 就用它；否则部署家取 **whale home 的同级目录**
 * （`<whale home>/../.xiaoyu-home`），这样隔离家时部署家也跟着隔离。
 * 这条解析只在这里实现，调用方一律走 `actionLedgerPaths()`。
 */
export function deployHome(env = process.env) {
  if (env.CORTICO_HOME) return env.CORTICO_HOME
  const whale = env.WHALE_HOME || env.DSH_HOME || whaleHome
  return path.join(path.dirname(path.resolve(whale)), '.xiaoyu-home')
}

/** 行动账的两本路径：旧 causal（历史）与新 actions.ndjson（现在）。 */
export function actionLedgerPaths(env = process.env) {
  const bot = env.CORTICO_BOT || 'xiaoyu'
  return {
    legacy: path.join(resolveWhaleHome(env), 'bili-whale', 'causal.jsonl'),
    current: path.join(deployHome(env), bot, 'data', 'persona', 'actions.ndjson'),
  }
}

/**
 * ── 当天对外凭据（新架构口径）──────────────────────────────────────────────
 * 旧判据「当天必须有一个 daily draft.json 且 diaryHash 绑定当天日记」依赖的是
 * 旧架构的 daily-draft 产物线。B16 撕封条（发布默认开）+ 统一待放行队列之后，
 * 那条产物线**不再产生**（待放行队列常态为空、动态直发）。
 * 但判据要守的东西没变：「她当天真的留下了对外的东西，而不是只在脑子里转」。
 *
 * 新架构下的等价证据（任一即算当天有对外凭据）：
 *   ① 当天日记页有内容（公开本或私人本，`<部署家>/<bot>/workspace/diary/*.md` 里
 *      出现该日期的小节且小节下有正文）；
 *   ② 待放行队列里有当天的条目（`data/bilibili/pending-queue.json`）。
 *
 * **记忆卡不算**：凌晨的睡眠结算会批量重写 core/active 卡的 mtime（实测 11-04 00:43、
 * 11-05 00:23 各有一批），那是结算副作用不是当天的主动行为——用它当证据会把
 * "结算跑过"误判成"她当天干了事"。
 *
 * 旧 draft.json 若存在，仍然按「绑定当天日记哈希」算最硬的证据（旧口径更严，留着当加分项）。
 */
export function dayEvidencePaths(env = process.env) {
  const bot = env.CORTICO_BOT || 'xiaoyu'
  const root = path.join(deployHome(env), bot)
  return {
    workspace: path.join(root, 'workspace'),
    diary: path.join(root, 'workspace', 'diary'),
    memo: path.join(root, 'workspace', 'memo'),
    pendingQueue: path.join(root, 'data', 'bilibili', 'pending-queue.json'),
    runs: path.join(root, 'data', 'runs'),
  }
}

/**
 * ── 当天有没有自主行动（真实行为证据）──────────────────────────────────────
 *
 * 两本账：
 *   ① `actions.ndjson` —— B14 加的 `life_do` 行动账，每笔带 day/activity/source。
 *      这是**最硬的**证据（她自己按下"我做了这件事"这个按钮）。
 *   ② 运行记录（data/runs 下每个 run 目录里的 toolcalls.jsonl）—— 每次工具调用都落一行（ts/tool）。
 *      这是**兜底**：`life_do` 工具是 2026-11-06 才有的，在那之前她做了事
 *      （11-05：55 次工具调用，feedback_submit 8 / memory_remember 5 / memory_void 10 /
 *      diary_write 2——记忆大扫除与复盘式练习）却没有行动账可写。
 *      只看 ① 会把"记账工具还不存在"误判成"她什么都没干"。
 *
 * ② 只认**自主类工具**：记忆写/删、判断读取、反馈提交、日记写、行动记账、心情标注。
 * 读类工具（diary_read / mood_read / memory_recall）只是回忆，不算行动。
 */
export const AUTONOMY_TOOLS = new Set([
  'life_do', 'memory_remember', 'memory_void', 'journal_judgment_write', 'judgment_read',
  'judgment_adopt', 'feedback_submit', 'diary_write', 'mood_apply', 'bili_seek', 'bili_feed',
  'bili_watch', 'bili_debrief', 'bili_comment', 'bili_dynamic_draft', 'bili_dm_reply',
])

/** 某一天有没有自主工具调用（读运行记录）。 */
export function hasAutonomousCalls(day, env = process.env) {
  const { runs } = dayEvidencePaths(env)
  let dirs = []
  try { dirs = fs.readdirSync(runs) } catch { return false }
  for (const d of dirs) {
    const tc = path.join(runs, d, 'toolcalls.jsonl')
    if (!fs.existsSync(tc)) continue
    let raw = ''
    try { raw = fs.readFileSync(tc, 'utf8') } catch { continue }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      let e = null
      try { e = JSON.parse(line) } catch { continue }
      const ts = String(e?.ts ?? '')
      if (ts.slice(0, 10) !== day) continue
      const tool = String(e?.tool ?? '')
      if (!AUTONOMY_TOOLS.has(tool)) continue
      // 心情标注只在真有事时才有 note，不把空标注算成行动
      if (tool === 'mood_apply') {
        const note = String(e?.args?.note ?? '').trim()
        if (!note) continue
      }
      return true
    }
  }
  return false
}

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

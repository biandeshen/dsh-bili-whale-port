/**
 * 状态根的**唯一**语义表（解耦方案 A0）。
 *
 * 存在的理由：`paths.mjs` 已经有 `statePath/stateReadPath` 这一套，能力够用；
 * 缺的是"每个文件**谁有权写**"这件事没有地方声明。路径统一之后两个进程仍会各写
 * 各的（实测 `traffic-state.json` 新旧两份数值不同），所以这里是路径 + 写者一起说。
 *
 * 规则（方案 A0.6，R1–R5）：
 *   R1 读写分离：写只用 `write`，读按 `read` 顺序探测
 *   R2 凭据写死旧家（写新家会让陈旧副本压住真 cookie，登录静默失效）
 *   R3 草稿取**当前真实在用**的目录，不是"应该在哪"的目录
 *   R4 探测"存在即用"，不因目录不存在改变读取语义
 *   R5 每个文件只有一个写者，或显式 `both-with-lock`
 *
 * 调用方一律走 `resolve(kind)`，不要自己拼 `.bili-ai`。
 */
import fs from 'node:fs'
import path from 'node:path'
import { credentialsPath, draftsDir, legacyStateDir, stateDir, statePath, whaleHome } from './paths.mjs'

/**
 * 写者身份，由进程入口注入：CLI 进程是 `cli`，宿主（World）是 `host`。
 * 未注入时按 `unknown` 处理——`unknown` 写 `both-with-lock` 之外的文件会被拒。
 */
let writer = 'unknown'
export function currentWriter() { return writer }
/** 进程入口调用一次；重复调用以最后一次为准（测试要用）。 */
export function setWriter(who) {
  if (who !== 'cli' && who !== 'host' && who !== 'unknown') throw new Error(`未知写者身份：${who}`)
  writer = who
}

/** 旧家兜底的退场日。到期后读列表不再含旧家（旧文件仍在盘上，只是不读了）。 */
export const LEGACY_UNTIL = process.env.BILI_LEGACY_UNTIL || '2026-12-01'

function legacyStillAllowed(now = Date.now()) {
  const until = Date.parse(LEGACY_UNTIL)
  if (Number.isNaN(until)) return true // 配错了就当没配，宁可继续兜底也不突然读不到
  return now < until
}

/**
 * 每类状态文件一条。`read` 是**探测顺序**（新家优先），`write` 是唯一落点。
 * 表里没有的 key 直接抛错——宁可当场红，不要静默落到某个默认路径。
 */
const KINDS = {
  // —— CLI 独占：所有 HTTP 都经 CLI 发出，宿主不该碰 ——
  'traffic-state': { owner: 'cli' },
  'api-ban': { owner: 'cli' },
  'api-cache': { owner: 'cli' },
  'pending-replies': { owner: 'cli' },
  'dm-quota': { owner: 'cli' },
  'dm-await-state': { owner: 'cli' },
  'await-state': { owner: 'cli' },
  quota: { owner: 'cli' },
  feedback: { owner: 'cli' },
  'likes-sent': { owner: 'cli' },
  'liked-videos': { owner: 'cli' },
  'replied': { owner: 'cli' },
  'commented-videos': { owner: 'cli' },
  'selftest-passed': { owner: 'cli' },
  'once-debug': { owner: 'cli' },

  // —— 宿主独占：只有 World 结算时写 ——
  fields: { owner: 'host', file: 'fields.json' },
  'draft-result': { owner: 'host' },
  'dm-applied': { owner: 'host' },

  // —— 两边都写：必须拿锁，且只追加单行 ——
  causal: { owner: 'both-with-lock' },

  // —— 特殊落点 ——
  credentials: { owner: 'cli', fixedLegacy: true }, // R2：读写都在旧家
  drafts: { owner: 'host', isDir: true },           // R3：当前在用的草稿目录
  runs: { owner: 'host', underWhaleHome: true },    // Core 独占，不在状态目录下
}

/** 把 kind 翻译成文件名；`fields` 这类表里写了 `file` 的用它，其余 `<kind>.json`。 */
function fileNameOf(kind, spec) {
  if (spec.file) return spec.file
  return kind.endsWith('.log') ? kind : `${kind}.json`
}

/**
 * 解析一类的落点与写者。
 *
 * @returns {{ kind: string, owner: string, write: string, read: string[], legacyUntil: string }}
 */
export function resolve(kind, opts = {}) {
  const spec = KINDS[kind]
  if (!spec) {
    throw new Error(`state-roots 不认这个状态类：${kind}（要新增就写进 KINDS 表，别在调用处自己拼路径）`)
  }
  const now = opts.now ?? Date.now()

  // R2：凭据固定在旧家，读写同一条路径。
  if (spec.fixedLegacy) {
    const p = credentialsPath()
    return { kind, owner: spec.owner, write: p, read: [p], legacyUntil: '' }
  }

  // R3：草稿是目录，取"当前真实在用"的那一个。
  if (spec.isDir) {
    const p = draftsDir()
    return { kind, owner: spec.owner, write: p, read: [p], legacyUntil: '' }
  }

  // runs 在 whale home 下，不在状态目录里。
  if (spec.underWhaleHome) {
    const p = path.join(whaleHome, 'bili-whale', 'runs')
    return { kind, owner: spec.owner, write: p, read: [p], legacyUntil: '' }
  }

  const name = fileNameOf(kind, spec)
  const fresh = statePath(name)
  const legacy = path.join(legacyStateDir(), name)
  // R1 + R4：读按"新家优先、旧家兜底"，兜底是否还算数看退场日。
  const read = legacyStillAllowed(now) ? [fresh, legacy] : [fresh]
  return { kind, owner: spec.owner, write: fresh, read, legacyUntil: LEGACY_UNTIL }
}

/**
 * R5 的守卫：这个人有没有权写这一类。
 * `unknown` 只放行两个进程都会碰的那一类（`both-with-lock`），其余一律拒——
 * 与其让一个没说明身份的进程悄悄改状态，不如让它当场失败。
 */
export function assertWriter(kind, who = writer) {
  const spec = KINDS[kind]
  if (!spec) throw new Error(`state-roots 不认这个状态类：${kind}`)
  if (spec.owner === 'both-with-lock') return true
  if (who === spec.owner) return true
  if (who === 'unknown') {
    throw new Error(`${kind} 的写者是 ${spec.owner}，这个进程没说自己是 cli 还是 host（setWriter），拒绝写`)
  }
  throw new Error(`${kind} 只允许 ${spec.owner} 写，当前进程是 ${who}`)
}

/** 读时是否还在用旧家——用于"每读一次旧家记一条 WARN"（A4.2 第 2 条）。 */
export function readHitsLegacy(kind, now = Date.now()) {
  const r = resolve(kind, { now })
  if (r.read.length < 2) return false
  const [fresh, legacy] = r.read
  try { if (fs.existsSync(fresh)) return false } catch { /* 当它没有 */ }
  try { return fs.existsSync(legacy) } catch { return false }
}

/** 表本身，给测试与自检用（只读）。 */
export function kinds() {
  return Object.keys(KINDS)
}

/** 某一类的声明（只读），不解析路径。 */
export function specOf(kind) {
  const spec = KINDS[kind]
  if (!spec) throw new Error(`state-roots 不认这个状态类：${kind}`)
  return { kind, owner: spec.owner }
}

/** 状态目录本身（诊断输出用）。 */
export const stateRoot = () => stateDir()

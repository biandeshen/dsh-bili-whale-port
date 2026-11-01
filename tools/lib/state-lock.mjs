/**
 * 状态文件互斥锁（从 `traffic.mjs` 里提取，通用化）。
 *
 * 为什么要有个原语：读-改-写的状态（先读整份、改一个字段、整份写回）两个进程同时做
 * 会互相覆盖——后写的把先写的那次改动整份抹掉。这种场景必须先拿锁再读。
 *
 * **不要拿它护单行追加**：2026-11-02 实测（三进程各 60 行 / 每行 100KB 并发追加），
 * 600 行全部完整、无撕裂、无丢失——`causal.jsonl` 这种 append-only 单行写入本身就是原子的，
 * 给它加锁只会让写变成"可能超时失败"，是纯损失。锁留给真正的读-改-写。
 *
 * 锁的形状与 `traffic.mjs` 一致：`<target>.lock` 文件里写 pid；pid 已死或文件过旧就
 * 当作陈旧锁清掉——崩溃留下的锁不该永久堵住下一次。
 */
import fs from 'node:fs'
import path from 'node:path'

const DEFAULT_TIMEOUT_MS = 10_000
const STALE_MS = 10_000

export class StateLockError extends Error {
  constructor(message) {
    super(message)
    this.name = 'StateLockError'
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 锁文件是不是陈旧（持有者进程已不在，或文件放了太久）。 */
function stale(lockFile) {
  try {
    const age = Date.now() - fs.statSync(lockFile).mtimeMs
    let pid
    try { pid = JSON.parse(fs.readFileSync(lockFile, 'utf8')).pid } catch { /* 写了一半也当陈旧 */ }
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); return false } catch (e) { return e.code === 'ESRCH' }
    }
    return age > STALE_MS
  } catch {
    return false // 文件刚消失：不当作陈旧，交给下一轮重试
  }
}

/**
 * 拿锁跑 `fn`。`target` 是那个状态文件（锁落在它旁边）。
 *
 * 只用来保护**同一类状态**的写；不要在自己的 `fn` 里再去拿同一把锁。
 */
export async function withStateLock(target, fn, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const lockFile = target + '.lock'
  fs.mkdirSync(path.dirname(lockFile), { recursive: true })
  const deadline = Date.now() + timeoutMs
  let fd
  while (fd === undefined) {
    try {
      fd = fs.openSync(lockFile, 'wx')
      fs.writeFileSync(fd, JSON.stringify({ pid: process.pid, at: Date.now() }))
    } catch (e) {
      if (e.code !== 'EEXIST') throw e
      if (stale(lockFile)) { try { fs.unlinkSync(lockFile) } catch { /* 别人先清了 */ } continue }
      if (Date.now() >= deadline) {
        throw new StateLockError(`拿不到 ${path.basename(target)} 的锁（${timeoutMs}ms 超时）；本次没写，请稍后重试`)
      }
      await sleep(25)
    }
  }
  try {
    return await fn()
  } finally {
    try { fs.closeSync(fd) } catch { /* 已关 */ }
    try { fs.unlinkSync(lockFile) } catch { /* 已删 */ }
  }
}

/**
 * 追加一行到"两边都写"的文件（`causal.jsonl` 就是它）。
 *
 * 单行 append 本身是原子的（实测见文件头），这里加锁**只为了在需要时能排它**，
 * 日常写路径应当直接 `appendFileSync`。真正需要它的是"读整份再改"的写入方。
 */
export async function appendLocked(file, line, opts) {
  return withStateLock(file, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, line.endsWith('\n') ? line : line + '\n')
    return true
  }, opts)
}

/** 需要互斥的状态类。`causal` 不在其中：它只追加单行，不需要锁（理由见文件头实测）。 */
export const LOCKED_KINDS = new Set()

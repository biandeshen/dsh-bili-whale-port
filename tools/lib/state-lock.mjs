/**
 * 状态文件互斥锁（从 `traffic.mjs` 里提取，通用化）。
 *
 * 为什么要有它：`both-with-lock` 那几类状态（`causal.jsonl` 最典型）两个进程都会写。
 * 路径统一只保证"写同一个文件"，不保证"不互相踩"。这里给一个拿锁跑一段逻辑的原语：
 * 拿不到就等，等到超时才放弃，而不是硬写。
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
 * 追加一行到 `both-with-lock` 类文件（`causal.jsonl` 就是它）。
 * 拿锁 + 单次 `appendFileSync`：单行写入不会被别的进程切断。
 */
export async function appendLocked(file, line, opts) {
  return withStateLock(file, () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.appendFileSync(file, line.endsWith('\n') ? line : line + '\n')
    return true
  }, opts)
}

/** 同步版本的表：明确告诉调用方"这个文件两条路都会写"。 */
export const LOCKED_KINDS = new Set(['causal'])

/**
 * 原子写盘（先写临时文件，再改名）——**改名会重试**。
 *
 * 为什么需要重试（2026-11-05 全量门禁红过一次）：
 *   Windows 上 rename 到一个正被别的进程打开的目标文件会抛 EPERM / EACCES / EBUSY
 *   （杀毒软件扫描、搜索索引器、另一个进程刚写过）。
 *   那种失败是**环境噪声**，不是逻辑错误——可它一旦发生，
 *   「写这条记忆」「放行这条草稿」就**静默没落地**（文件没换成功，数据停在旧值）。
 *   于是一次失败让整条路挂掉。
 *
 * 现在：只对"文件被占"这类错误重试几次（退避 25ms 起步），别的错误直接抛
 * （磁盘满、路径不对——重试也没用，早点失败早点看见）。
 */
import fs from 'node:fs'
import path from 'node:path'

/** 等一会儿（同步忙等，只在写盘前的一瞬用，不占事件循环）。 */
function sleepSync(ms: number): void {
  const until = Date.now() + ms
  while (Date.now() < until) { /* 忙等 */ }
}

export interface AtomicWriteOptions {
  /** 重试次数（默认 8） */
  attempts?: number
  /** 首次退避毫秒（默认 25，之后线性增长） */
  backoffMs?: number
}

/**
 * 把 `data` 原子地写到 `file`。
 *
 * @param tmpSuffix 临时文件后缀（默认带 pid + 随机，避免并发写互相踩）
 */
export function atomicWriteFile(file: string, data: string | Uint8Array, opts: AtomicWriteOptions = {}): void {
  const attempts = Math.max(1, opts.attempts ?? 8)
  const backoff = Math.max(1, opts.backoffMs ?? 25)
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2, 8)}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, data)
  let lastErr: unknown = null
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      fs.renameSync(tmp, file)
      return
    } catch (e) {
      lastErr = e
      const code = (e as { code?: string })?.code
      if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY') break
      sleepSync(backoff * (attempt + 1))
    }
  }
  try { fs.unlinkSync(tmp) } catch { /* 临时文件清不掉就算了 */ }
  throw lastErr
}

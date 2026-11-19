/**
 * 写工具的幂等键 —— 抄业界做法，不自己发明。
 *
 * 来源（2026-11-14 搜索结论）：
 *   · "idempotency key must be stable across retries but unique per logical action"
 *     —— 幂等键必须**跨重试稳定**，不能每次随机
 *   · 落地形式：对写入内容取内容指纹（content hash），第二次同内容调用是 no-op 并返回第一次的结果
 *
 * 为什么本仓必须有：实测 `r-20261113-233659-bb8f` 里 23:45 与 23:53 两笔行动**逐字相同**
 * （「翻记忆池找所有收下的视频，看哪条是漏掉的」），间隔 8 分钟。她不知道自己已经记过了。
 *
 * 与"配额的界线"：这里拦的是**同内容重复写入**，不是"她一天能做几件事"。
 * 不同内容的行动永远放行；同样的内容第二次起返回"已记过"并**不扣体力**。
 */
import crypto from 'node:crypto'

/**
 * 归一化后取 sha1 前 16 位。
 * 归一化只做三件（多一件都会误合并）：去首尾空白、连续空白压成一个、忽略大小写。
 * **不做**同义词/近义替换 —— 那会把"看雨"和"听雨"当成一件事，属于替她判断。
 */
export function contentKey(parts: ReadonlyArray<string | undefined | null>): string {
  const norm = parts
    .map((p) => String(p ?? '').trim().replace(/\s+/g, ' ').toLowerCase())
    .filter(Boolean)
    .join('\u0001')
  return crypto.createHash('sha1').update(norm, 'utf8').digest('hex').slice(0, 16)
}

export interface SeenRecord {
  key: string
  at: number
  /** 第一次那笔的结果，重复调用原样返回（业界做法：第二次返回第一次的结果，不是空） */
  result?: unknown
}

/**
 * 一个进程内的"最近写过什么"窗口。
 * 上限按条数（不是时间），因为时间窗在停摆/时钟跳变时会失准。
 */
export class WriteDeduper {
  private readonly map = new Map<string, SeenRecord>()
  // Node 24 原生 TS 不开参数属性（ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX），只能显式声明
  private readonly capacity: number
  constructor(capacity = 64) {
    this.capacity = capacity
  }

  /** 查：命中就返回第一次的记录；没命中返回 null。 */
  lookup(key: string): SeenRecord | null {
    return this.map.get(key) ?? null
  }

  /** 记：超过容量丢最旧的（Map 保持插入序）。 */
  remember(key: string, result?: unknown, at = Date.now()): SeenRecord {
    const rec: SeenRecord = { key, at, result }
    this.map.set(key, rec)
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next()
      if (oldest.done) break
      this.map.delete(oldest.value)
    }
    return rec
  }

  size(): number {
    return this.map.size
  }

  clear(): void {
    this.map.clear()
  }
}

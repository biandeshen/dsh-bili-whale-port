/**
 * 「她还活着吗、停了多久、最近一次成功开口是什么时候」—— 一个只读读数。
 *
 * 为什么必须单独有这一份（第三方 2026-11-13 复核 P2，两次事故的事实链）：
 *   · 2026-11-06 20:19 总线被人工暂停 → 停了 25 小时，没人知道；
 *   · 2026-11-10 00:42 干净关机 → 停了 3 天 22 小时，没人知道。
 * 两次在观察面上都只是「她很安静」——而安静、设计如此、没钱了、进程没起，
 * 是四种完全不同的状态。这一份把它们分开，且**每种状态都带一个"多久了"**。
 *
 * 口径写死在这里，面板与脚本必须一起带出去：
 *   · 「已暂停」＝进程活着但总线暂停（宿主的 run 状态），不是"她不想动"；
 *   · 「已关机」＝进程没了；判断依据是最近活动时间距今超过阈值（阈值由调用方给，
 *     因为宿主机器的时钟、部署的关机习惯都不一样，不在这份里猜）；
 *   · 「余额不足」单独一类：402 不是暂停，**恢复也不会活**——要人充值。
 *
 * 只读：本文件不写任何东西。
 */
import fs from 'node:fs'
import path from 'node:path'

export type LivenessKind = 'running' | 'paused' | 'stopped' | 'no-balance'

export interface LivenessReading {
  kind: LivenessKind
  /** 人话的一句话，面板直接显示 */
  line: string
  /** 距最近一次"有生命迹象"多久（分钟）；null = 没有任何读数 */
  silentMinutes: number | null
  /** 最近一次成功（status 200）模型调用时间 ISO；'' = 今天没有成功调用 */
  lastOkAt: string
  /** 最近一次 402 的时间 ISO；'' = 没撞过 */
  last402At: string
  /** 依据：哪些文件被读了、读到什么（可复现，不许只给结论） */
  basis: string[]
}

const okStatus = (s: unknown) => Number(s) === 200

/** 读 usage.jsonl 的尾部若干条，拿到"最近成功 / 最近 402"。大文件不整读。 */
function tailUsage(file: string, max = 400): Array<Record<string, unknown>> {
  if (!fs.existsSync(file)) return []
  let raw = ''
  try {
    const st = fs.statSync(file)
    const size = Math.min(st.size, 512 * 1024)
    const fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(size)
    fs.readSync(fd, buf, 0, size, st.size - size)
    fs.closeSync(fd)
    raw = buf.toString('utf8')
  } catch {
    return []
  }
  const lines = raw.split('\n').filter(Boolean)
  // 从末尾往前取；第一行可能是被截断的半条
  const out: Array<Record<string, unknown>> = []
  for (let i = lines.length - 1; i >= 0 && out.length < max; i--) {
    try {
      const j = JSON.parse(lines[i])
      if (j && typeof j === 'object') out.push(j)
    } catch {
      // 半条或被并发写坏的行：跳过，不因为一行坏掉就不报数
    }
  }
  return out
}

const tsOf = (r: Record<string, unknown>): number => {
  const direct = Number(r.tsMs ?? NaN)
  if (Number.isFinite(direct)) return direct
  const t = Date.parse(String(r.ts ?? ''))
  return Number.isFinite(t) ? t : NaN
}

/**
 * 从宿主的 `data/instance.lock` 读"进程现在在不在"。
 *
 * lock 里是 `{ pid, startedAt, argv, execPath }`（宿主 `core/instance-lock.ts`）。
 * 这里只做一件事：pid 还活着吗。**不杀、不写、不改锁**——抢锁是宿主的事。
 * 读不到/坏 json → 返回 null（未知），绝不猜成"已关机"。
 */
export function readInstanceLiveness(dataDir: string): { alive: boolean | null; pid: number | null; startedAt: string | null; detail: string } {
  const file = path.join(dataDir, 'instance.lock')
  if (!fs.existsSync(file)) return { alive: null, pid: null, startedAt: null, detail: `${file} 不存在` }
  let j: any
  try {
    j = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (e: any) {
    return { alive: null, pid: null, startedAt: null, detail: `instance.lock 读不动：${String(e?.message ?? e).slice(0, 80)}` }
  }
  const pid = Number(j?.pid ?? 0) || null
  const startedAt = typeof j?.startedAt === 'string' ? j.startedAt : null
  if (!pid) return { alive: null, pid: null, startedAt, detail: 'instance.lock 里没有 pid' }
  let alive: boolean
  try {
    process.kill(pid, 0)
    alive = true
  } catch (e: any) {
    // ESRCH = 没这个进程；EPERM = 有进程但不是我们的（在 Windows 上少见，按活着算更保守）
    alive = e?.code === 'EPERM'
  }
  return { alive, pid, startedAt, detail: `pid ${pid} ${alive ? '活着' : '已不存在'}（起于 ${startedAt ?? '未知'}）` }
}

export function readLiveness(opts: {
  dataDir: string
  /** 进程侧状态：宿主给什么就传什么（'paused' | 'running' | 'stopped' | 未知） */
  processState?: 'running' | 'paused' | 'stopped' | string | null
  /** 距最近活动超过多久判「已关机」（分钟），默认 60 */
  stoppedAfterMinutes?: number
  now?: number
}): LivenessReading {
  const now = opts.now ?? Date.now()
  const stoppedAfter = (opts.stoppedAfterMinutes ?? 60) * 60_000
  const records = tailUsage(path.join(opts.dataDir, 'usage.jsonl'))
  const basis: string[] = []

  let lastOkMs = NaN
  let last402Ms = NaN
  let lastAnyMs = NaN
  for (const r of records) {
    const t = tsOf(r)
    if (!Number.isFinite(t)) continue
    if (!Number.isFinite(lastAnyMs) || t > lastAnyMs) lastAnyMs = t
    if (okStatus(r.status) && (!Number.isFinite(lastOkMs) || t > lastOkMs)) lastOkMs = t
    if (Number(r.status) === 402 && (!Number.isFinite(last402Ms) || t > last402Ms)) last402Ms = t
  }
  basis.push(`usage.jsonl 尾读 ${records.length} 条`)
  if (Number.isFinite(lastOkMs)) basis.push(`最近成功调用 ${new Date(lastOkMs).toISOString()}`)
  if (Number.isFinite(last402Ms)) basis.push(`最近 402 ${new Date(last402Ms).toISOString()}`)

  const lastOkAt = Number.isFinite(lastOkMs) ? new Date(lastOkMs).toISOString() : ''
  const last402At = Number.isFinite(last402Ms) ? new Date(last402Ms).toISOString() : ''
  const silentMinutes = Number.isFinite(lastAnyMs) ? Math.round((now - lastAnyMs) / 60_000) : null

  /**
   * 判定顺序有讲究：
   *   1. 402 比"暂停"更硬——余额不足时就算进程活着、总线也开着，她也说不出口。
   *      所以这一条先判，并且和 processState 无关（402 决定"能不能活"，暂停只决定"愿不愿意动"）。
   *   2. 进程死了（stopped）或很久没有任何读数 → 已关机。
   *   3. 进程活着 + 总线暂停 → 已暂停。
   *   4. 其余 → 运行中。
   */
  const ps = String(opts.processState ?? '').toLowerCase()
  // 进程死活优先看 instance.lock：它是宿主自己写的，比"沉默多久"更硬。
  // 锁里说进程没了 → 已关机；锁读不到（alive=null）→ 退回"沉默太久"的推断，并在 basis 里写明。
  const lock = readInstanceLiveness(opts.dataDir)
  basis.push(`instance.lock：${lock.detail}`)
  const lockSaysDead = lock.alive === false
  const lockSaysAlive = lock.alive === true
  const looksDead = lockSaysDead || (!lockSaysAlive && ps === 'stopped')
    || (!lockSaysAlive && ps !== 'paused' && silentMinutes !== null && silentMinutes * 60_000 > stoppedAfter)

  let kind: LivenessKind
  if (Number.isFinite(last402Ms) && (!Number.isFinite(lastOkMs) || last402Ms > lastOkMs)) {
    kind = 'no-balance'
  } else if (looksDead) {
    kind = 'stopped'
  } else if (ps === 'paused') {
    kind = 'paused'
  } else {
    kind = 'running'
  }

  const dur = (m: number | null) => {
    if (m === null) return '没有任何调用读数'
    if (m < 60) return `${m} 分钟`
    if (m < 48 * 60) return `${Math.floor(m / 60)} 小时`
    return `${Math.floor(m / 1440)} 天 ${Math.floor((m % 1440) / 60)} 小时`
  }
  const lastLine = lastOkAt ? `最近一次成功调用 ${new Date(lastOkAt).toLocaleString('zh-CN')}` : '今天还没有一次成功调用'

  let line: string
  switch (kind) {
    case 'no-balance':
      line = `余额不足（最近 402：${dur(silentMinutes)}前）——**恢复也不会活**，要充值。${lastLine}`
      break
    case 'stopped':
      line = `已关机（已停 ${dur(silentMinutes)}）——进程没在跑，不是"她很安静"。${lastLine}`
      break
    case 'paused':
      line = `已暂停（已停 ${dur(silentMinutes)}）——进程活着但总线暂停，不是"她不想动"。${lastLine}`
      break
    default:
      line = `运行中${silentMinutes === null ? '' : `（最近活动 ${dur(silentMinutes)}前）`}。${lastLine}`
  }

  return { kind, line, silentMinutes, lastOkAt, last402At, basis }
}

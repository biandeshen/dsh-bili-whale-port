/**
 * World 的持久任务队列 —— 唤醒提示不再只活在内存 setTimeout 里。
 *
 * 语义：at-least-once。任务写入磁盘后才推送；推送失败按次重试，5 次进 dead。
 * 进程崩溃重启后，pending 任务会在 boot 时重新投递——重复投递一条提示是可接受的，
 * 丢掉"她想做点什么"的意愿不可接受。
 */
import fs from 'node:fs'
import path from 'node:path'

export type TaskStatus = 'pending' | 'delivered' | 'dead'

export interface QueueTask {
  id: string
  kind: string
  dueAt: number
  text: string
  status: TaskStatus
  attempts: number
  createdAt: string
  deliveredAt?: string
  /** 投递成功后回填的任务 id（用于把这一轮产物和任务对上号） */
  deliveredTaskId?: string
}

const LIMIT = 200
const DEAD_AFTER_ATTEMPTS = 5
const KEEP_MS = 24 * 3600_000

const valid = (t: any): t is QueueTask =>
  t && typeof t === 'object' && typeof t.id === 'string' && typeof t.text === 'string'
  && Number.isFinite(Number(t.dueAt)) && ['pending', 'delivered', 'dead'].includes(t.status)

export function readQueue(file: string): QueueTask[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
    return Array.isArray(raw?.tasks) ? raw.tasks.filter(valid) : []
  } catch { return [] }
}

export function writeQueue(file: string, tasks: QueueTask[]): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = file + '.' + process.pid + '.' + Math.random().toString(36).slice(2, 8) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify({ tasks: tasks.slice(-LIMIT) }, null, 2))
  fs.renameSync(tmp, file)
}

export function newTask(kind: string, text: string, dueAt: number, id?: string): QueueTask {
  return {
    id: id ?? 'task-' + dueAt.toString(36) + '-' + Math.random().toString(36).slice(2, 6),
    kind,
    dueAt,
    text,
    status: 'pending',
    attempts: 0,
    createdAt: new Date(dueAt).toISOString(),
  }
}

export function dueTasks(tasks: QueueTask[], now: number): QueueTask[] {
  return tasks.filter((t) => t.status === 'pending' && t.dueAt <= now)
}

export function markDelivered(tasks: QueueTask[], id: string, at: number): QueueTask[] {
  return tasks.map((t) => t.id === id
    ? { ...t, status: 'delivered' as const, deliveredAt: new Date(at).toISOString(), deliveredTaskId: t.id }
    : t)
}

export function markAttempt(tasks: QueueTask[], id: string): QueueTask[] {
  return tasks.map((t) => {
    if (t.id !== id) return t
    const attempts = t.attempts + 1
    return { ...t, attempts, status: attempts >= DEAD_AFTER_ATTEMPTS ? 'dead' as const : t.status }
  })
}

/** 超过 24h 还没投出去的 pending 直接作废：提示里是当时的状态快照，放久了出来会失真。 */
export function expireStale(tasks: QueueTask[], now: number, maxAgeMs = 24 * 3600_000): QueueTask[] {
  return tasks.map((t) => (t.status === 'pending' && now - t.dueAt > maxAgeMs ? { ...t, status: 'dead' as const } : t))
}

/** 已投递/已死的旧任务保留 24h 便于审计，pending 永不清理。 */
export function prune(tasks: QueueTask[], now: number): QueueTask[] {
  return tasks.filter((t) => t.status === 'pending' || (t.dueAt ?? 0) >= now - KEEP_MS).slice(-LIMIT)
}

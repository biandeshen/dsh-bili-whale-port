/**
 * 待审队列的放行与丢弃。
 *
 * 背景：`go-gate.mjs` 只负责入队，注释里写的"主人在 panel「信箱与事件」放行"那条界面
 * 已随世界页改造退役，于是队列只进不出 —— 实测 2026-11-02：9 条从 10-25 堆到现在，
 * 没有任何入口能把它们发出去，CLI 也只有 drop/take。
 *
 * 本模块补上"放行"这一半：
 *   · 放行 = 原样执行入队时记下的 argv，并在末尾加 `--go`（入队时正是把它剔掉的）
 *   · 执行前必须过三道：kill 开关、待审项仍在队列里、目标文件/凭据仍可用
 *   · 执行后无论成败都从队列移除，并把结果写进随行日志（不静默吞掉失败原因）
 *
 * 只在 CLI 侧使用；World 不可写这个队列（state-roots: pending-replies owner=cli）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { readStateText, writeStateText, credentialsPath } from './paths.mjs'
import { NODE_EXE } from './nodebin.mjs'

const PENDING = 'pending-replies.json'

function readPendingStrict() {
  let text
  try { text = readStateText(PENDING) }
  catch (e) { if (e?.code === 'ENOENT') return []; throw e }
  const parsed = JSON.parse(text)
  if (!Array.isArray(parsed?.items)) {
    throw new Error(`${PENDING} 里没有 items 数组，拒绝在此基础上改动（会覆盖掉已有条目）`)
  }
  return parsed.items
}

function writePending(items) {
  writeStateText(JSON.stringify({ items }, null, 2) + '\n', PENDING)
}

export function listPendingQueue() {
  return readPendingStrict()
}

/** 队列入队时剔掉了 `--go`；放行就是把它加回去。入队前已带 `--go` 的不重复加。 */
export function argvForRelease(item) {
  return item.argv.includes('--go') ? [...item.argv] : [...item.argv, '--go']
}

/**
 * 放行前检查：能做、能不做、为什么不做。
 * 只做"现在能不能执行"的判断，不替人做"该不该发"的决定。
 */
export function preflight(item, opts) {
  if (fs.existsSync(opts.killPath)) return { ok: false, reason: 'kill 开关开着，所有写被拦' }
  if (!Array.isArray(item.argv) || item.argv.length === 0) return { ok: false, reason: '这条没有记录 argv，无法重建命令' }
  if (!fs.existsSync(opts.biliPath)) return { ok: false, reason: `找不到 ${opts.biliPath}` }
  // 先查这一条自己带的资源，再查全局的凭据：报错要指到最具体的那处，
  // 否则"图片没了"会被笼统的"凭据不存在"盖住，修的时候找错方向。
  const i = item.argv.indexOf('--image')
  if (i >= 0) {
    const img = item.argv[i + 1]
    if (!img || !fs.existsSync(img)) return { ok: false, reason: `图片已不在：${img ?? '(未记录)'}` }
  }
  if (!fs.existsSync(credentialsPath())) return { ok: false, reason: '凭据文件不存在' }
  return { ok: true }
}

/**
 * 放行一条：执行 → 从队列摘掉 → 记一次尝试。
 *
 * 失败也要摘掉：留着只会让下一个人再撞一次同样的错。失败原因写进随行日志，
 * 由调用方打印；这条记录本身留在 attempts 里，可回看。
 */
export function releaseOne(item, opts) {
  const pre = preflight(item, opts)
  if (!pre.ok) {
    return { id: item.id, ok: false, exit: -1, out: '', reason: pre.reason }
  }
  if (opts.dry) {
    return { id: item.id, ok: true, exit: 0, out: `[dry] ${NODE_EXE} ${opts.biliPath} ${argvForRelease(item).join(' ')}` }
  }
  const argv = argvForRelease(item)
  const r = spawnSync(NODE_EXE, [opts.biliPath, ...argv], { encoding: 'utf8', timeout: 180000, windowsHide: true })
  const out = ((r.stdout ?? '') + (r.stderr ?? '')).slice(0, 4000)
  // 退出码不够：这条链上的「被拒」也是 exit 0，只在输出里打 ✗（实测 fav：
  // "✗ 不能收：这个 0 天前收过了" 退出码 0）。所以成功要两个条件都满足。
  const refused = /(^|\n)\s*✗/.test(out)
  const exit = r.status ?? -1
  const ok = exit === 0 && !refused
  const reason = ok ? undefined : (refused ? '被规则拒绝（见输出）' : `exit=${exit}`)
  return { id: item.id, ok, exit, out, reason }
}

/**
 * 批量放行。返回每条的结果；队列按结果更新（成功的摘掉，失败的也摘掉但留 attempts）。
 * `dry` 时不执行、不改队列，只报告将要做什么。
 */
export function releaseMany(ids, opts) {
  const items = readPendingStrict()
  const results = []
  const byId = new Map(items.map((x) => [x.id, x]))
  for (const id of ids) {
    const item = byId.get(id)
    if (!item) { results.push({ id, ok: false, exit: -1, out: '', reason: '队列里没有这条（可能已被处理）' }); continue }
    const r = releaseOne(item, opts)
    results.push(r)
    if (opts.dry) continue
    const now = new Date().toISOString()
    const attempt = { at: now, ok: r.ok, ...(r.reason ? { reason: r.reason } : {}) }
    item.attempts = [...(item.attempts ?? []), attempt]
    if (r.ok) {
      // 成功：摘掉，不再占队列
      byId.delete(id)
    } else {
      // 失败：**留在队列里但带 attempts**。原先"失败的也摘掉"是错的——
      // 风控冷却导致的失败本来过一会儿就能重试，摘掉等于把这条永久丢掉，
      // 而且那句话（"不让下一个人再撞一次"）在冷却场景下根本不成立。
      byId.set(id, item)
    }
  }
  if (!opts.dry) {
    writePending([...byId.values()])
  }
  return results
}

/** 丢弃（不执行）。与 reply-draft 的 drop 同义，但用在待审队列上。 */
export function dropMany(ids) {
  const items = readPendingStrict()
  const keep = []
  const dropped = []
  const idset = new Set(ids)
  for (const it of items) {
    if (idset.has(it.id)) dropped.push(it.id)
    else keep.push(it)
  }
  writePending(keep)
  return { dropped, missing: ids.filter((x) => !dropped.includes(x)) }
}

export const pendingPath = () => path.join('(state)', PENDING)

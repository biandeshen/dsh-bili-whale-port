/**
 * 唤醒审计：从她自己的会话记录里还原每一次"醒来"到底调了什么工具。
 *
 *   node scripts/wake-audit.mjs [--last 5] [--json]
 *   node scripts/wake-audit.mjs --usage [--json] [--code-root ../Cortico-up]
 *
 * 只读；用于验证 ORIENTATION 是否被遵守、D-36 是否修好。
 * `--usage` 回答另一个问题：**这 18 个工具她实际用了哪些、哪几次失败、哪几次拿到的是崩栈**。
 * 词表两路（点赞/收藏）以前只有成功才落账，"0 次"分不清"没做"还是"全失败"——就是这条读数补的。
 * 一次唤醒 = 一个 `external_event_frame` 调用，到下一次唤醒或"进程重启"消息为止。
 */
import fs from 'node:fs'
import path from 'node:path'
import { whaleHome, isDefaultWhaleHome, LEGACY_DRAFTS } from '../tools/lib/paths.mjs'

const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const DEFAULT_SESSION = path.join(CORTICO, 'deployments', 'mybot', 'data', 'session-main.jsonl')

const logicalDay = (iso) => new Date(Date.parse(iso)).toLocaleDateString('sv-SE') // 自然日（2026-10-31 拍板）
function draftPath(day) {
  // 与冻结的验收脚本同一套优先级：env 覆盖 → 「家仍是默认落点」且旧目录存在 → whale home
  const dir = process.env.WHALE_DRAFTS || (isDefaultWhaleHome() && fs.existsSync(LEGACY_DRAFTS) ? LEGACY_DRAFTS : path.join(whaleHome, 'bili-whale', 'drafts'))
  return path.join(dir, day + '.json')
}
function readDraft(day) {
  try { return JSON.parse(fs.readFileSync(draftPath(day), 'utf8')) } catch { return null }
}

const FLOW = ['bili_mood_read', 'bili_traffic', 'bili_feed', 'bili_debrief', 'bili_diary_append', 'bili_draft_dynamic']

function textOf(item) {
  return (item?.content ?? []).map((c) => c.text ?? '').join(' ')
}

/** @returns {Array<{at:string, calls:string[], counts:Record<string,number>, event:string, draftOut:string, checks:object, complete:boolean, missing:string[]}>} */
export function auditSession(file) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return [] }
  const rows = raw.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const wakes = []
  let cur = null
  const byId = new Map()

  const close = () => {
    if (!cur) return
    const counts = {}
    for (const c of cur.calls) counts[c] = (counts[c] ?? 0) + 1
    const has = (n) => (counts[n] ?? 0) > 0
    const day = logicalDay(cur.at)
    const draft = readDraft(day)
    const checks = {
      moodRead: has('bili_mood_read'),
      traffic: has('bili_traffic'),
      feed: has('bili_feed'),
      debrief: has('bili_debrief'),
      publicDiary: (cur.publicDiary ?? 0) > 0,
      privateDiary: (cur.privateDiary ?? 0) > 0,
      draftInWake: has('bili_draft_dynamic'),
      draftExists: !!draft,
      moodApply: has('bili_mood_apply'),
    }
    const missing = []
    if (!checks.moodRead) missing.push('mood_read')
    if (!checks.traffic) missing.push('traffic')
    if (!checks.feed) missing.push('feed')
    if (!checks.debrief) missing.push('debrief')
    // 当天已有稿时不必再出；"公开日记"不要求每次醒来都写（草稿闸看的是 24h 新鲜度）
    if (!checks.draftInWake && !checks.draftExists) missing.push('草稿')
    wakes.push({
      at: cur.at,
      day,
      calls: [...new Set(cur.calls)],
      counts,
      event: cur.event,
      draftOut: cur.draftOut,
      draft: draft ? { id: draft.id, status: draft.status, hasDiaryHash: !!draft.diaryHash } : null,
      checks,
      complete: missing.length === 0,
      missing,
    })
    cur = null
  }

  for (const row of rows) {
    const it = row?.item
    const ts = row?.context?.ts
    if (!it || !ts) continue
    if (it.type === 'message' && it.role === 'user') {
      const t = textOf(it)
      if (/进程重启|session 已续上/.test(t)) close()
      continue
    }
    if (it.type === 'function_call') {
      byId.set(it.call_id, it.name)
      if (it.name === 'external_event_frame') {
        close()
        cur = { at: ts, calls: [], publicDiary: 0, privateDiary: 0, event: '', draftOut: '' }
        continue
      }
      if (!cur) continue
      cur.calls.push(it.name)
      if (it.name === 'bili_diary_append') {
        try {
          const a = JSON.parse(it.arguments || '{}')
          if (a.book === 'public') cur.publicDiary += 1
          else if (a.book === 'private') cur.privateDiary += 1
        } catch {}
      }
      continue
    }
    if (it.type === 'function_call_output' && cur) {
      const name = byId.get(it.call_id)
      const out = String(it.output ?? '')
      if (name === 'external_event_frame') cur.event = out.replace(/\s+/g, ' ').slice(0, 220)
      if (name === 'bili_draft_dynamic') cur.draftOut = out.replace(/\s+/g, ' ').slice(0, 200)
    }
  }
  close()
  return wakes
}

/**
 * 回执形状判定：`✗ …` 是拒绝/失败，带堆栈的是**崩栈**（她把 Node 堆栈当工具结果读）。
 * 这两类以前都不落账，所以"她没点过赞"与"她点了四次全失败"在复盘时一模一样。
 *
 * `✗` 只认回执**开头五行**：debrief 的回执里整段是弹幕与评论原文，那里面出现 `✗`、
 * 「点赞失败」都不代表工具失败（实测把 4 次 debrief 冤枉成 3 次失败）。
 */
const HEAD_LINES = 5
export function classifyReceipt(out) {
  const text = String(out ?? '')
  const head = text.split('\n').slice(0, HEAD_LINES).join('\n')
  return {
    failed: /^\s*✗/m.test(head),
    crashed: /(^|\n)\s+at\s+\S+.*?:\d+:\d+/.test(text) || /(^|\n)node:internal\/\S+/.test(text),
  }
}

/** 会话里每个工具实际调了几次、几次失败、几次崩栈；`lastAt` 是最后一次**调用**的时刻。 */
export function usageOf(file) {
  let raw = ''
  try { raw = fs.readFileSync(file, 'utf8') } catch { return { file, rows: 0, perTool: {}, order: [], span: null } }
  const rows = raw.trim().split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
  const perTool = {}
  const byId = new Map()
  let first = null, last = null
  for (const row of rows) {
    const it = row?.item
    const ts = row?.context?.ts
    if (!it) continue
    if (ts) { if (!first) first = ts; last = ts }
    if (it.type === 'function_call' && it.name) {
      byId.set(it.call_id, it.name)
      const rec = (perTool[it.name] ??= { calls: 0, failed: 0, crashed: 0, lastAt: null })
      rec.calls += 1
      if (ts) rec.lastAt = ts
    } else if (it.type === 'function_call_output') {
      const name = byId.get(it.call_id)
      if (!name || !perTool[name]) continue
      const { failed, crashed } = classifyReceipt(it.output)
      if (failed) perTool[name].failed += 1
      if (crashed) perTool[name].crashed += 1
    }
  }
  const order = Object.keys(perTool).sort((a, b) => perTool[b].calls - perTool[a].calls || a.localeCompare(b))
  return { file, rows: rows.length, span: { first, last }, perTool, order }
}

/**
 * 声明了多少工具看代码，不看会话——名单在 Cortico 的 `tool-decls.ts`，这里只读不算第二份。
 * 代码树与数据树在 2026-11-02 之后是分开的两份（代码 `Cortico-up`，部署数据 `Cortico/deployments`）。
 */
export function declaredTools(codeRoot) {
  const f = path.join(codeRoot, 'src', 'worlds', 'bili-account', 'tool-decls.ts')
  try {
    return [...fs.readFileSync(f, 'utf8').matchAll(/^  (bili_[a-z_]+): \{ zh:/gm)].map((m) => m[1]).sort()
  } catch { return null }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (isMain) {
  const argv = process.argv.slice(2)
  const file = (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : (process.env.WAKE_SESSION || DEFAULT_SESSION) })()
  const opt = (k, d) => { const i = argv.indexOf('--' + k); return i >= 0 ? argv[i + 1] : d }

  if (argv.includes('--usage')) {
    const u = usageOf(file)
    const declared = declaredTools(opt('code-root', process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico-up'))
    const never = declared ? declared.filter((n) => !(n in u.perTool)) : null
    const broken = u.order.filter((n) => u.perTool[n].crashed > 0 || u.perTool[n].failed > 0)
    if (argv.includes('--json')) {
      console.log(JSON.stringify({ ...u, declared, neverCalled: never, withFailures: broken }, null, 2))
    } else {
      console.log(`# 工具实际用量 · ${file}`)
      console.log(`会话行 ${u.rows} · 时间范围 ${u.span?.first ?? '?'} → ${u.span?.last ?? '?'}`)
      console.log(`\n调用过（次数 / 失败 / 崩栈）：`)
      for (const n of u.order) {
        const p = u.perTool[n]
        console.log(`  ${String(p.calls).padStart(3)}  ${n}${p.failed ? `  ✗失败 ${p.failed}` : ''}${p.crashed ? `  ⚠崩栈 ${p.crashed}` : ''}`)
      }
      if (!u.order.length) console.log('  （这个会话文件里没有工具调用）')
      console.log('')
      if (declared) console.log(`声明 ${declared.length} 个 · 从没调用过：${never.length ? never.join('、') : '（无）'}`)
      else console.log('声明表读不到（--code-root 指对了吗）：只报实际用量，不算差额')
      if (broken.length) console.log(`要看的：${broken.map((n) => `${n}(${u.perTool[n].failed} 失败/${u.perTool[n].crashed} 崩栈)`).join('、')}`)
    }
    process.exit(0)
  }

  const last = (() => { const i = argv.indexOf('--last'); return i >= 0 ? Number(argv[i + 1]) || 5 : 5 })()
  const all = auditSession(file)
  const rows = all.slice(-last)
  if (argv.includes('--json')) {
    console.log(JSON.stringify({ file, total: all.length, wakes: rows }, null, 2))
  } else {
    console.log(`# 唤醒审计 · ${file}`)
    console.log(`共 ${all.length} 次，显示最近 ${rows.length} 次\n`)
    for (const w of rows) {
      console.log(`${w.at}  [${w.day}]  ${w.complete ? '完整' : '缺：' + w.missing.join('、')}`)
      console.log(`  调用：${w.calls.join(' → ') || '（无）'}`)
      console.log(`  当天草稿：${w.draft ? w.draft.id + ' · ' + w.draft.status + (w.draft.hasDiaryHash ? ' · diaryHash' : ' · 无 diaryHash') : '无'}`)
      if (w.draftOut) console.log(`  本轮草稿：${w.draftOut}`)
    }
  }
  if (argv.includes('--strict')) {
    const lastWake = rows[rows.length - 1]
    if (!lastWake) { console.error('strict: 没有可判定的唤醒'); process.exit(2) }
    if (!lastWake.complete) { console.error('strict: 最近一次唤醒不完整（' + lastWake.missing.join('、') + '）'); process.exit(1) }
  }
  process.exit(0)
}

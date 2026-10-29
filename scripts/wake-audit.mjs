/**
 * 唤醒审计：从她自己的会话记录里还原每一次"醒来"到底调了什么工具。
 *
 *   node scripts/wake-audit.mjs [--last 5] [--json]
 *
 * 只读；用于验证 ORIENTATION 是否被遵守、D-36 是否修好。
 * 一次唤醒 = 一个 `external_event_frame` 调用，到下一次唤醒或"进程重启"消息为止。
 */
import fs from 'node:fs'
import path from 'node:path'

const CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'
const DEFAULT_SESSION = path.join(CORTICO, 'deployments', 'mybot', 'data', 'session-main.jsonl')
const LEGACY_DRAFTS = 'D:/AI/养鱼/drafts'
const USERPROFILE = process.env.USERPROFILE || process.env.HOME || ''
const DSH_HOME = process.env.WHALE_HOME || process.env.DSH_HOME || path.join(USERPROFILE, '.dsh')

const logicalDay = (iso) => new Date(Date.parse(iso) - 4 * 3600_000).toLocaleDateString('sv-SE')
function draftPath(day) {
  const isDefault = path.resolve(DSH_HOME).toLowerCase() === path.resolve(USERPROFILE, '.dsh').toLowerCase()
  const dir = process.env.WHALE_DRAFTS || (isDefault && fs.existsSync(LEGACY_DRAFTS) ? LEGACY_DRAFTS : path.join(DSH_HOME, 'bili-whale', 'drafts'))
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

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (isMain) {
  const argv = process.argv.slice(2)
  const file = (() => { const i = argv.indexOf('--file'); return i >= 0 ? argv[i + 1] : (process.env.WAKE_SESSION || DEFAULT_SESSION) })()
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
  process.exit(0)
}

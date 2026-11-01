/**
 * 她的判断卡（2026-11-01 主人拍板方案 A）。
 *
 * 她写进私人日记的「本轮留下的判断」是叙事：16 个小节里 13 个标题带括号后缀，
 * 没有立场字段，feed 读不了。判断卡是同一件事的结构化版本：
 *
 * append-only：`<whale home>/bili-whale/control/judgment.jsonl`
 *   add    → {id:'j-xxxxxx', kind:'judgment', at, atMs, day, scope, stance, tokens, reason, bvid?, evidence?, status:'proposed'}
 *   adopt  → 追加 {kind:'judgment-adopted', id, at, atMs, by:'owner'}
 *   reject → 追加 {kind:'judgment-rejected', id, at, atMs, by:'owner', why}
 * 折叠规则与意见箱同构：同 id 有 adopted/rejected 行即已了结；原始条目永不删除。
 *
 * 红线（写在代码里，不靠自觉）：
 *   ① 字段白名单：不认识的键直接丢弃，不报错给模型——与 mood_apply 的 custom.source 同一先例；
 *   ② 本模块没有 adopt 的写入入口：`adoptJudgment` 只被世界页的 owner 通道调用，
 *      CLI 只暴露 add/list，工具只暴露 bili_judgment add/list；
 *   ③ 判断卡只能追加 avoid/prefer，永远删不掉主人手写的 preferences.like/dislike；
 *   ④ 采纳结果落在 `preferences.judgments` 一个命名空间里，不碰别的键。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { whalePath, configPath } from './paths.mjs'
import { logicalDay as dayOf } from '../../scripts/day-snapshot.mjs'
import { saveConfigKey } from './config.mjs'

export const JUDGMENT_FILE = whalePath('bili-whale', 'control', 'judgment.jsonl')

export const SCOPES = ['feed', 'draft', 'dm', 'any']
export const STANCES = ['prefer', 'avoid', 'noise']

/** 允许出现在 jsonl 与配置文件里的键；其余一律丢弃。 */
const FIELD_WHITELIST = ['id', 'kind', 'at', 'atMs', 'day', 'scope', 'stance', 'tokens', 'reason', 'bvid', 'evidence', 'expiresAt', 'status', 'by', 'why']

const STOP_WORDS = new Set([
  '这个', '那个', '什么', '自己', '可以', '就是', '一个', '一天', '今天', '昨天', '现在', '其实',
  '不是', '没有', '一下', '一点', '这么', '那么', '还是', '因为', '所以', '但是', '如果', '这样', '那样',
])

/** 主题词：2–12 字、去掉停用词与句尾虚词；切法与 feed 的命中判定同一口径。 */
export function normalizeTokens(raw) {
  const list = Array.isArray(raw) ? raw : String(raw ?? '').split(/[·、,，\s]+/)
  const out = []
  for (const item of list) {
    const t = String(item ?? '').trim()
    if (!t || [...t].length < 2 || [...t].length > 12) continue
    if (STOP_WORDS.has(t)) continue
    if (/[的吗呢吧啊呀嘛了哦哈]$/.test(t)) continue
    if (!out.includes(t)) out.push(t)
  }
  return out.slice(0, 6)
}

function readEntries(file = JUDGMENT_FILE) {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l) } catch { return null } })
      .filter(Boolean)
  } catch { return [] }
}

function pickAllowed(entry) {
  const out = {}
  for (const key of FIELD_WHITELIST) if (entry[key] !== undefined) out[key] = entry[key]
  return out
}

/**
 * 全部判断卡，按状态折叠。`adopted` 的卡同时是 feed 现在真在用的那份。
 * 卡片过期只是不再被 feed 采纳，历史仍在（status 不变），便于回看她当初为什么那么判。
 */
export function listJudgments(file = JUDGMENT_FILE, { status = 'all', limit = 50 } = {}) {
  const entries = readEntries(file)
  const adopted = new Map()
  const rejected = new Map()
  for (const e of entries) {
    if (e.kind === 'judgment-adopted') adopted.set(String(e.id), e)
    if (e.kind === 'judgment-rejected') rejected.set(String(e.id), e)
  }
  const items = entries.filter((e) => e.kind === 'judgment').map((e) => {
    const id = String(e.id)
    const state = adopted.has(id) ? 'adopted' : rejected.has(id) ? 'rejected' : 'proposed'
    return {
      id,
      at: e.at,
      day: e.day,
      scope: SCOPES.includes(e.scope) ? e.scope : 'feed',
      stance: STANCES.includes(e.stance) ? e.stance : 'prefer',
      tokens: normalizeTokens(e.tokens),
      reason: String(e.reason ?? '').slice(0, 200),
      bvid: typeof e.bvid === 'string' ? e.bvid : '',
      expiresAt: Number.isFinite(Number(e.expiresAt)) ? Number(e.expiresAt) : null,
      status: state,
      adoptedAt: adopted.get(id)?.at ?? null,
      rejectedWhy: rejected.has(id) ? String(rejected.get(id)?.why ?? '') : null,
    }
  })
  const filtered = status === 'all' ? items : items.filter((x) => x.status === status)
  return {
    ok: true,
    proposed: items.filter((x) => x.status === 'proposed').length,
    adopted: items.filter((x) => x.status === 'adopted').length,
    total: items.length,
    items: filtered.slice(-limit).reverse(),
  }
}

/**
 * 她提一张卡。立场、作用域、词都要合法；理由 ≥6 字（同收藏的判据：说不清为什么就不记）。
 * 返回的是给人看的一句话，与意见箱的回执风格一致。
 */
export function appendJudgment(input, file = JUDGMENT_FILE) {
  const scope = String(input?.scope ?? 'feed')
  if (!SCOPES.includes(scope)) return { ok: false, error: `scope 只能是 ${SCOPES.join(' / ')}` }
  const stance = String(input?.stance ?? 'prefer')
  if (!STANCES.includes(stance)) return { ok: false, error: `stance 只能是 ${STANCES.join(' / ')}` }
  const tokens = normalizeTokens(input?.tokens)
  if (!tokens.length) return { ok: false, error: 'tokens 至少要有一个 2–12 字的词（停用词不算）' }
  const reason = String(input?.reason ?? '').trim()
  if (reason.length < 6) return { ok: false, error: '理由太短（≥6 字）—— 说不清为什么这样判，就别记成卡' }
  if (reason.length > 200) return { ok: false, error: '理由太长（>200 字），一句话理由就够' }
  const raw = {
    id: 'j-' + crypto.randomBytes(3).toString('hex'),
    kind: 'judgment',
    at: new Date().toISOString(),
    atMs: Date.now(),
    day: dayOf(),
    scope,
    stance,
    tokens,
    reason,
    ...(typeof input?.bvid === 'string' && input.bvid.trim() ? { bvid: input.bvid.trim() } : {}),
    status: 'proposed',
  }
  const entry = pickAllowed(raw)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  return { ok: true, id: entry.id, at: entry.at, tokens, stance, scope }
}

/**
 * 主人采纳。只有世界页的 invoke 能走到这里：没有工具、没有 CLI 子命令。
 * 采纳做的事只有一件——把这张卡并进 `preferences.judgments`，别的键一个不碰。
 */
export function adoptJudgment(id, by = 'owner', file = JUDGMENT_FILE) {
  const target = String(id ?? '').trim()
  if (!target) return { ok: false, error: '缺 id' }
  const card = listJudgments(file, { status: 'proposed' }).items.find((x) => x.id === target)
  if (!card) return { ok: false, error: '没有这条待采纳的卡：' + target }
  const entry = pickAllowed({
    kind: 'judgment-adopted', id: target, at: new Date().toISOString(), atMs: Date.now(),
    by: by === 'owner' ? 'owner' : 'owner',
  })
  fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  const merged = mergeIntoPreferences(card)
  return merged.ok ? { ok: true, id: target, ...merged } : { ok: false, error: merged.error }
}

/** 主人驳回。理由可留空——留空就是留空，不替主人编一个。 */
export function rejectJudgment(id, why = '', file = JUDGMENT_FILE) {
  const target = String(id ?? '').trim()
  if (!target) return { ok: false, error: '缺 id' }
  const card = listJudgments(file, { status: 'proposed' }).items.find((x) => x.id === target)
  if (!card) return { ok: false, error: '没有这条待采纳的卡：' + target }
  const entry = pickAllowed({
    kind: 'judgment-rejected', id: target, at: new Date().toISOString(), atMs: Date.now(),
    by: 'owner', why: String(why ?? '').trim().slice(0, 200),
  })
  fs.appendFileSync(file, JSON.stringify(entry) + '\n')
  return { ok: true, id: target }
}

/** 把卡并进配置的 `preferences.judgments`；同 id 覆盖，其余键整份保留。 */
function mergeIntoPreferences(card) {
  try {
    // 读用户文件本身（不是合并视图）：默认值不该被写进主人的配置里。
    let prefs = {}
    try { prefs = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.preferences ?? {} } catch { prefs = {} }
    const existing = Array.isArray(prefs.judgments) ? prefs.judgments : []
    const next = [
      ...existing.filter((x) => String(x?.id) !== card.id),
      {
        id: card.id,
        scope: card.scope,
        stance: card.stance,
        tokens: card.tokens,
        adoptedAt: new Date().toISOString(),
        ...(card.expiresAt ? { expiresAt: card.expiresAt } : {}),
      },
    ]
    saveConfigKey('preferences.judgments', next)
    return { ok: true, applied: next }
  } catch (e) {
    return { ok: false, error: '写不进配置：' + String(e?.message ?? e) }
  }
}

/**
 * feed 侧的口径：已采纳、未过期的卡拆成两桶，再与主人手写的词表对齐。
 * 冲突时配置赢（主人写的优先），冲突逐条记下来给她看。
 * 直读配置文件而不走 `config()` 的缓存：采纳发生在另一个进程（世界页），
 * 缓存会让下一个 feed 读到旧的那份。
 */
export function activeJudgments(now = Date.now()) {
  let prefs = {}
  try { prefs = JSON.parse(fs.readFileSync(configPath, 'utf8'))?.preferences ?? {} } catch { prefs = {} }
  const all = Array.isArray(prefs.judgments) ? prefs.judgments : []
  const live = all.filter((x) => x && SCOPES.includes(x.scope) && (!x.expiresAt || Number(x.expiresAt) > now))
  const avoid = []
  const prefer = []
  const conflicts = []
  const liked = (Array.isArray(prefs.like) ? prefs.like : []).map((x) => String(x).toLowerCase())
  for (const card of live) {
    if (!['feed', 'any'].includes(card.scope)) continue
    const tokens = normalizeTokens(card.tokens)
    if (!tokens.length) continue
    if (card.stance === 'avoid' || card.stance === 'noise') avoid.push(...tokens)
    else {
      // 主人手写「爱看」里有的词，按主人赢：不让一张卡把主人明确要的排到后面
      const blocked = tokens.filter((t) => liked.some((l) => t.toLowerCase().includes(l) || l.includes(t.toLowerCase())))
      if (blocked.length) conflicts.push({ id: card.id, tokens: blocked, winner: 'preferences.like' })
      for (const t of tokens) if (!blocked.includes(t)) prefer.push(t)
    }
  }
  return { avoid: [...new Set(avoid)], prefer: [...new Set(prefer)], conflicts }
}

/**
 * causal.jsonl 只读投影（M1a）——把 append-only 因果链投成面板事件流条目。
 *
 * 为什么：面板以前读 ~/.dsh/whale-log.jsonl，最后一条停在 10-25（DSH 时代），
 * 而 Cortico World 写的是 ~/.dsh/bili-whale/causal.jsonl —— 主人看不到她的一天。
 *
 * 约定：
 *   · 只读：本模块零写入；
 *   · 时间归一：action 有 atMs（毫秒数），其余是 at（ISO 字符串）→ 统一转 ISO；
 *   · kind 白名单决定**怎么展示**，不是丢弃：未知 kind 原样降级展示
 *     （target=原 kind、note=原始 JSON 截断），新事件不会在面板上静默消失。
 * 输出形状与 whale-log 条目兼容：{ at, kind, target, note }，tank.html 直接吃。
 */
import fs from 'node:fs'
import path from 'node:path'

export const causalFile = (whaleHome) => path.join(whaleHome, 'bili-whale', 'causal.jsonl')

/** action 的 atMs（毫秒，与真值一致）优先；否则解析 at（ISO）。 */
function atOf(e) {
  const ms = Number(e.atMs)
  const t = Number.isFinite(ms) && ms > 0 ? ms : Date.parse(e.at ?? '')
  return Number.isFinite(t) ? new Date(t).toISOString() : null
}

export function normalizeCausalEntry(e) {
  if (!e || typeof e !== 'object' || !e.kind) return null
  // actor 只透传不推断：历史条目没有这个字段，标成"未知"比编一个署名诚实。
  const base = { at: atOf(e), kind: e.kind, target: '', note: '', actor: e.actor ?? null }
  switch (e.kind) {
    case 'action':
      return { ...base, target: e.actionKind ?? '', note: e.reason ?? '' }
    case 'diary':
      return { ...base, target: e.book ?? '', note: `${e.heading ?? ''} · ${e.chars ?? 0}字` }
    case 'watchedVideo':
      return { ...base, note: e.note || e.description || '看了一条' }
    case 'watched':
      return { ...base, target: e.bvid ?? '', note: e.bvid ? `看过 ${e.bvid}` : '看过' }
    case 'draft-result':
      return { ...base, target: e.result ?? '', note: `${e.draftId ?? ''} · ${e.date ?? ''}` }
    case 'draft-result-consumed':
      return { ...base, note: `审批结算 → ${Array.isArray(e.applied) ? e.applied.join('+') : String(e.applied ?? '')}` }
    case 'dm-sent':
      return { ...base, target: e.inboundKey ?? '', note: `回信已发 · ${e.chars ?? 0}字` }
    case 'dm-read-failed':
      return { ...base, note: `读私信失败（≠没人写信）：${String(e.detail ?? '').slice(0, 80)}` }
    case 'discipline-violation':
      return { ...base, note: `违规：${String(e.reason ?? '').slice(0, 80)}` }
    default:
      // 情绪 preset 类（draftApproved/masterReplied/draftRejected/...）带 description
      if (e.description) return { ...base, note: String(e.description).slice(0, 160) }
      return { ...base, target: e.kind, note: JSON.stringify(e).slice(0, 160) }
  }
}

export function readCausalLines(whaleHome) {
  try {
    return fs.readFileSync(causalFile(whaleHome), 'utf8').split('\n').filter(Boolean)
  } catch { return [] }
}

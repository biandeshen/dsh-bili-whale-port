/**
 * WBI 签名（包内唯一一份）。
 *
 * 为什么要单独一个文件：这段 `MIXIN_TAB` + `keyOf` + `md5(qs+mixin)` 此前在
 * `bili-read.ts`（搜索）、`bili-debrief.ts`（字幕）、`tools/diagnostics/whois.mjs`（查昵称）、
 * `tools/commands/dynamic.mjs`（动态翻页）各抄了一份。上游注释自己都写着
 * "各脚本里重复了一份，保持一致；要改就一起改"——那就是等着出错的说法。
 * B 站改一次混淆表，四处要同时改对，漏一处就是"搜索能用而字幕 403"这种半瘫。
 *
 * 算法照线上跑过的那份：
 *   nav 拿 img_url / sub_url → 各取文件名里的 32 位 key → 拼 64 位 →
 *   按 MIXIN_TAB 重排取前 32 位 = mixinKey → 参数按 key 排序、清洗 `!'()*`、
 *   拼 wts → md5(query + mixinKey) = w_rid。
 */
import crypto from 'node:crypto'

export const MIXIN_TAB = [
  46, 47, 18, 2, 53, 8, 23, 32, 15, 50, 10, 31, 58, 3, 45, 35, 27, 43, 5, 49, 33, 9, 42, 19,
  29, 28, 14, 39, 12, 38, 41, 13, 37, 48, 7, 16, 24, 55, 40, 61, 26, 17, 0, 1, 60, 51, 30, 4,
  22, 25, 54, 21, 56, 59, 6, 63, 57, 62, 11, 36, 20, 34, 44, 52,
]

const keyOf = (u: string) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
const clean = (v: unknown) => String(v).replace(/[!'()*]/g, '')

/** nav 响应 → mixinKey（拿不到就返回空串，签名会失效但不抛） */
export function mixinFromNav(navJson: any): string {
  const raw = keyOf(String(navJson?.data?.wbi_img?.img_url ?? '')) + keyOf(String(navJson?.data?.wbi_img?.sub_url ?? ''))
  return MIXIN_TAB.map((i) => raw[i] ?? '').join('').slice(0, 32)
}

/** 用 mixinKey 给参数签名，返回可直接拼到 URL 上的查询串。 */
export function wbiQuery(mixin: string, params: Record<string, string | number>, now: number = Date.now()): string {
  const wts = Math.round(now / 1000)
  const all: Record<string, string | number> = { ...params, wts }
  const q = Object.keys(all).sort()
    .map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(clean(all[k]))}`)
    .join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
}

/**
 * 取 mixinKey：nav 一次即可（同一轮里可复用）。
 * fetchImpl/headers 由调用方给——本模块不假设凭据从哪来，也不自己发网络请求。
 */
export async function loadMixin(fetchImpl: (u: string, init?: any) => Promise<any>, headers: Record<string, string>): Promise<string> {
  const nav = await (await fetchImpl('https://api.bilibili.com/x/web-interface/nav', { headers })).json()
  return mixinFromNav(nav)
}

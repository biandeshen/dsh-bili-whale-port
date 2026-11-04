/**
 * B 站读侧 Typed API（A2 第二批）：feed / search / nav 登录态 / msgfeed 四路。
 *
 * 与 tools/commands/*.mjs 的关系：端点、参数、WBI 签名、解析逻辑照抄原命令（线上跑过的形状），
 * 差别只有——不读 argv、不 process.exit，返回结构化结果；fetch 可注入（测试替身）。
 * debrief/subtitles 涉及 ffmpeg 抽帧与字幕管线，保持走 readHandlers 注入（已有）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { guardedFetch as defaultFetch } from '../platform/traffic.mjs'
import { apiGet } from '../platform/api.mjs'
import { mixinFromNav, wbiQuery } from '../platform/wbi.ts'
import { UA } from './bili-write.ts'

export interface BiliReadContext {
  fetch?: typeof defaultFetch
  cred: { sessdata: string; bili_jct: string; buvid3: string }
}

export function readFetcher(ctx: BiliReadContext): typeof defaultFetch {
  return ctx.fetch ?? defaultFetch
}

export function readHeaders(ctx: BiliReadContext, referer = 'https://www.bilibili.com/'): Record<string, string> {
  return {
    'user-agent': UA,
    referer,
    cookie: `SESSDATA=${ctx.cred.sessdata}; bili_jct=${ctx.cred.bili_jct}; buvid3=${ctx.cred.buvid3 ?? ''}`,
  }
}

export function loadCredentials(credentialsFile: string): { sessdata: string; bili_jct: string; buvid3: string } {
  try {
    const raw = JSON.parse(fs.readFileSync(credentialsFile, 'utf8'))
    return {
      sessdata: String(raw.sessdata ?? ''),
      bili_jct: String(raw.bili_jct ?? ''),
      buvid3: String(raw.buvid3 ?? ''),
    }
  } catch {
    return { sessdata: '', bili_jct: '', buvid3: '' }
  }
}

/** WBI 签名（照抄 tools/lib/bili-api.mjs 的 signWbi 口径，经 apiGet 自动处理）。 */

export interface FeedVideoItem {
  bvid: string
  title: string
  durationSec: number
  up: string
  uri?: string
}

export interface FeedResult {
  ok: boolean
  source: 'popular' | 'ranking' | 'dynamic' | 'none'
  items: FeedVideoItem[]
  error?: string
}

/**
 * 推荐流：popular → ranking → dynamic 三源顺序回落（照抄 feed.mjs 的源顺序），
 * 套用看片偏好（minDurationSec / dislike / exemptUps 的标注由调用方 annotate）。
 */
export async function fetchFeed(ctx: BiliReadContext, opts: { count?: number } = {}): Promise<FeedResult> {
  const fetch = readFetcher(ctx)
  const H = readHeaders(ctx)
  const count = Math.max(1, Math.min(20, opts?.count ?? 10))
  const sources: Array<{ source: FeedResult['source']; url: string; pick: (j: any) => any[] }> = [
    { source: 'popular', url: 'https://api.bilibili.com/x/web-interface/popular?pn=1&ps=20', pick: (j) => j.data?.item ?? j.data?.list ?? [] },
    { source: 'ranking', url: 'https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', pick: (j) => j.data?.list ?? [] },
    { source: 'dynamic', url: 'https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1', pick: (j) => (j.data?.items ?? []).map((x: any) => x.modules?.module_dynamic?.major?.archive).filter(Boolean) },
  ]
  for (const src of sources) {
    try {
      const j = await (await fetch(src.url, { headers: H })).json()
      if (j.code !== 0) continue
      const raw = src.pick(j) ?? []
      const items: FeedVideoItem[] = raw.slice(0, count).map((it: any) => ({
        bvid: String(it.bvid ?? ''),
        title: String(it.title ?? '').replace(/<[^>]+>/g, ''),
        durationSec: Number(it.duration ?? 0),
        up: String(it.owner?.name ?? it.author?.name ?? ''),
        uri: it.uri,
      })).filter((x) => /^BV[0-9A-Za-z]{10}$/.test(x.bvid))
      if (items.length) return { ok: true, source: src.source, items }
    } catch { /* 本源失效，试下一个 */ }
  }
  return { ok: false, source: 'none', items: [], error: '三个源都取不到（热门/排行/动态）' }
}

export interface SearchResult {
  ok: boolean
  items: FeedVideoItem[]
  error?: string
}

/**
 * 搜索：WBI 签名。签名本体已收到 `../platform/wbi.ts`（包内唯一一份），
 * 这里只留"搜索要的那组参数"。
 */
export async function searchVideos(ctx: BiliReadContext, keyword: string, page = 1): Promise<SearchResult> {
  const fetch = readFetcher(ctx)
  const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: readHeaders(ctx) })).json()
  if (nav.code !== 0) return { ok: false, items: [], error: `nav code=${nav.code}（登录态失效？）` }
  const mixinKey = mixinFromNav(nav)
  const qs = wbiQuery(mixinKey, { search_type: 'video', keyword, page })
  const j = await (await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${qs}`, { headers: readHeaders(ctx, 'https://search.bilibili.com/') })).json()
  if (j.code !== 0) {
    return { ok: false, items: [], error: `code=${j.code} ${j.message ?? ''}` }
  }
  const raw = j.data?.result ?? []
  const items: FeedVideoItem[] = raw.slice(0, 20).map((it: any) => ({
    bvid: String(it.bvid ?? ''),
    title: String(it.title ?? '').replace(/<[^>]+>/g, ''),
    durationSec: Number(it.duration ?? 0),
    up: String(it.author ?? ''),
  })).filter((x) => /^BV[0-9A-Za-z]{10}$/.test(x.bvid))
  return { ok: true, items }
}

export interface NavResult {
  ok: boolean
  isLogin: boolean
  mid?: number
  uname?: string
  error?: string
}

/** 登录态检查（nav）：同 verify-bili-read 的口径。 */
export async function checkLogin(ctx: BiliReadContext): Promise<NavResult> {
  const j = await (await readFetcher(ctx)('https://api.bilibili.com/x/web-interface/nav', { headers: readHeaders(ctx) })).json()
  if (j.code !== 0) return { ok: false, isLogin: false, error: `code=${j.code} ${j.message ?? ''}` }
  return { ok: true, isLogin: Boolean(j.data?.isLogin), mid: j.data?.mid, uname: j.data?.uname }
}

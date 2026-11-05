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
import crypto from 'node:crypto'
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

/**
 * 读凭据文件。
 *
 * **两种格式都收**（2026-11-05 线上事故）：
 *   ① JSON：`{"sessdata":"...","bili_jct":"...","buvid3":"..."}`（旧家 `~/.bili-ai/credentials.json` 的形状）
 *   ② env：`NAME=value` 每行一个（宿主 `secretReader` 读的形状，src/core/secrets.ts:16）
 *
 * 为什么必须收两种：同一个文件要同时喂给两条路——
 *   · 读工具走 `credentialsFile`（本函数）
 *   · 写工具走 `ctx.secret('BILI_SESSDATA')`（宿主的 secretReader，只认 `NAME=value`）
 * 以前只认 JSON，于是写工具从同一个文件里读不到东西，而读工具在文件不存在时
 * **静默返回空凭据**——她照常调用，只是带着空 cookie，失败信息还指向风控，
 * 看着像"被 B 站 412 了"，其实是根本没登录。
 */
/**
 * 凭据的三种来源形状，**一份解析**（写侧与读侧必须同一个口径，否则又是一次
 * "读得到写不到"的分裂——2026-11-05 线上就是这么静默匿名了一整天）。
 *
 * 支持：① JSON（旧家 `~/.bili-ai/credentials.json`）；② `NAME=value` 行（宿主 secretReader
 * 同口径，值读到首个空白）；③ 浏览器复制的 Cookie 头 `SESSDATA=..; bili_jct=..; buvid3=..`
 * ——这一种是「连接」页要接的：主人从 DevTools 里整段抄过来。
 */
export interface BiliCredentialKeys {
  sessdata: string
  bili_jct: string
  buvid3: string
}

/** 每个字段认哪些键名（大小写与前缀习惯都在这儿，别在调用点各写一份）。 */
const CRED_ALIASES: Array<[keyof BiliCredentialKeys, string[]]> = [
  ['sessdata', ['BILI_SESSDATA', 'SESSDATA', 'sessdata']],
  ['bili_jct', ['BILI_JCT', 'bili_jct', 'JCT', 'CSRF', 'bili_csrf_token']],
  ['buvid3', ['BILI_BUVID3', 'BUVID3', 'buvid3']],
]

export function parseCredentials(text: string): BiliCredentialKeys {
  const out: BiliCredentialKeys = { sessdata: '', bili_jct: '', buvid3: '' }
  if (!text) return out
  const pairs = new Map<string, string>()
  try {
    const raw = JSON.parse(text)
    if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw)) pairs.set(String(k), String(v ?? ''))
    }
  } catch { /* 不是 JSON，按 k=v 扫 */ }
  if (!pairs.size) {
    for (const m of String(text).matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^\s;,]+)/g)) {
      if (!pairs.has(m[1])) pairs.set(m[1], m[2])
    }
  }
  for (const [field, names] of CRED_ALIASES) {
    for (const n of names) {
      const v = pairs.get(n)
      if (v) {
        out[field] = v
        break
      }
    }
  }
  return out
}

function readTextOrEmpty(file: string): string {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return ''
  }
}

export function loadCredentials(credentialsFile: string): BiliCredentialKeys {
  return parseCredentials(readTextOrEmpty(credentialsFile))
}

/** 进程环境变量优先（与宿主 secretReader 同一条优先级），其次现读文件。 */
function envFirst(names: string[]): string {
  for (const n of names) {
    const v = process.env[n]
    if (v) return v
  }
  return ''
}

/**
 * **活的**凭据视图：每次取都现读。
 *
 * 为什么要它：世界转接头原来是 `create()` 时取一次快照塞进 writeContext，
 * 于是主人在「连接」页换完 cookie，读侧可能已经新了、写侧还在用旧的那份，
 * 表现就是"明明显示已登录，发出去却被 -101 未登录"。凭据这件事**不该需要重启**。
 */
export function liveCredentials(credentialsFile: string): BiliCredentialKeys {
  const file = () => parseCredentials(readTextOrEmpty(credentialsFile))
  return {
    get sessdata() {
      return envFirst(['BILI_SESSDATA', 'SESSDATA']) || file().sessdata
    },
    get bili_jct() {
      return envFirst(['BILI_JCT', 'bili_jct']) || file().bili_jct
    },
    get buvid3() {
      return envFirst(['BILI_BUVID3', 'BUVID3']) || file().buvid3
    },
  }
}

/** 体检用的"能说什么"：值与长度都不说，只给有无 + 短指纹（同一个 cookie 换没换看得出来）。 */
function fingerprint(v: string): string {
  if (!v) return ''
  return crypto.createHash('sha1').update(v, 'utf8').digest('hex').slice(0, 6)
}

export function describeCredentials(cred: BiliCredentialKeys): {
  sessdata: { present: boolean; fp: string }
  bili_jct: { present: boolean; fp: string }
  buvid3: { present: boolean; fp: string }
} {
  const one = (v: string) => ({ present: Boolean(v), fp: fingerprint(v) })
  return { sessdata: one(cred.sessdata), bili_jct: one(cred.bili_jct), buvid3: one(cred.buvid3) }
}

/**
 * 写凭据文件：`NAME=value` 一行一个，**保留文件里其他行**（她的 .env 里还住着别的键）。
 * 传空串表示"这个键不要了"。值只写进文件，绝不进日志、返回值或异常信息。
 */
export function saveCredentials(
  credentialsFile: string,
  patch: Partial<BiliCredentialKeys>,
): { ok: true; written: string[]; removed: string[] } | { ok: false; error: string } {
  const NAMES: Record<keyof BiliCredentialKeys, string> = {
    sessdata: 'BILI_SESSDATA',
    bili_jct: 'BILI_JCT',
    buvid3: 'BILI_BUVID3',
  }
  let lines: string[] = []
  try {
    lines = fs.existsSync(credentialsFile) ? fs.readFileSync(credentialsFile, 'utf8').split(/\r?\n/) : []
  } catch (e) {
    return { ok: false, error: `读不到凭据文件：${String((e as Error)?.message ?? e)}` }
  }
  const written: string[] = []
  const removed: string[] = []
  for (const field of Object.keys(patch) as Array<keyof BiliCredentialKeys>) {
    const name = NAMES[field]
    const value = String(patch[field] ?? '').trim()
    const idx = lines.findIndex((l) => new RegExp(`^[ \\t]*${name}[ \\t]*=`).test(l))
    if (!value) {
      if (idx >= 0) lines.splice(idx, 1)
      removed.push(name)
      continue
    }
    if (idx >= 0) lines[idx] = `${name}=${value}`
    else lines.push(`${name}=${value}`)
    written.push(name)
  }
  const body = lines.join('\n').replace(/\n*$/, '\n')
  try {
    fs.mkdirSync(path.dirname(credentialsFile), { recursive: true })
    const tmp = `${credentialsFile}.${process.pid}.tmp`
    // 0600：她是单用户部署，凭据文件不该被别人读到（Windows 会忽略这段位，不报错就算）
    fs.writeFileSync(tmp, body, { encoding: 'utf8', mode: 0o600 })
    try {
      fs.copyFileSync(credentialsFile, `${credentialsFile}.pre-bind-${Date.now()}`)
    } catch { /* 首次绑定没有旧文件，不需要备份 */ }
    fs.renameSync(tmp, credentialsFile)
  } catch (e) {
    return { ok: false, error: `写不进凭据文件：${String((e as Error)?.message ?? e)}` }
  }
  return { ok: true, written, removed }
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

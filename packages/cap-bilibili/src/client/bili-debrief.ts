/**
 * B 站深读（debrief）Typed API——六路素材备齐：元信息 / 封面 / 官方字幕 / 弹幕热区 / 热评。
 *
 * 与 tools/commands/debrief.mjs 的关系：端点、WBI 签名、deflate 弹幕解压、刷屏波剔除、
 * 时间轴分桶、采样口径回执——全部照抄原命令（线上跑过的形状）。差别只有：
 *   ① 不读 argv、不 process.exit、不 console.log，返回结构化六路素材；
 *   ② 画面抽帧（⑥）不在本模块——那是 ffmpeg 管线 + 模型读图，属 cap-media-studio 的职责；
 *   ③ fetch 可注入。
 */
import zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { guardedFetch as defaultFetch } from '../platform/traffic.mjs'
import { UA } from './bili-write.ts'

export interface DebriefContext {
  /**
   * 可注入的取数函数（默认走 guardedFetch 限流通道）。
   * 替身契约：只需提供 json() / text() / arrayBuffer()，并给 ok 或 status 其中之一
   * ——缺 ok 时按 status<400 判定成功，别指望替身是完整的 Response。
   */
  fetch?: typeof defaultFetch
  cred: { sessdata: string; bili_jct: string; buvid3: string }
}

export interface DanmakuHot {
  fromSec: number
  toSec: number
  realCount: number
  rawCount: number
  hot: boolean
  subtitleAt: string | null
  topTexts: string[]
}

export interface CommentItem {
  like: number
  replies: number
  user: string
  text: string
}

export interface DebriefResult {
  ok: boolean
  /** ① 元信息 */
  meta: {
    bvid: string
    title: string
    up: string
    durationSec: number
    tname: string
    pubdate: string
    stat: { view: number; like: number; favorite: number; coin: number; danmaku: number; reply: number }
    desc: string
  }
  /** ③ 官方字幕（行级 + 时间轴对齐函数所需的原始行） */
  subtitles: { lines: Array<{ from: number; to: number; text: string }>; count: number; hasTrack: boolean }
  /** ④ 弹幕热区（剔刷屏后按桶） */
  danmaku: {
    sampled: number
    claimed: number
    buckets: number
    sampleRatio: string
    spamStripped: number
    spamKeys: string[]
    tops: DanmakuHot[]
    freqTop: Array<{ text: string; count: number }>
  }
  /** ⑤ 热评 */
  comments: CommentItem[]
  error?: string
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`
const norm = (s: string) => s.replace(/[\s\p{P}\p{S}]/gu, '')

export async function fetchDebrief(
  ctx: DebriefContext,
  bvid: string,
  opts: { bucketSec?: number; top?: number; comments?: number } = {},
): Promise<DebriefResult> {
  const fetch = ctx.fetch ?? defaultFetch
  const H = {
    'user-agent': UA,
    referer: `https://www.bilibili.com/video/${bvid}/`,
    cookie: `SESSDATA=${ctx.cred.sessdata}; bili_jct=${ctx.cred.bili_jct}; buvid3=${ctx.cred.buvid3 ?? ''}`,
  }
  const jget = async (u: string) => (await fetch(u, { headers: H })).json()
  const BUCKET = Math.max(10, opts.bucketSec ?? 30)
  const TOP = Math.max(1, opts.top ?? 5)
  const NCOM = Math.max(1, opts.comments ?? 8)
  const fail = (error: string): DebriefResult => ({
    ok: false,
    meta: { bvid, title: '', up: '', durationSec: 0, tname: '', pubdate: '', stat: { view: 0, like: 0, favorite: 0, coin: 0, danmaku: 0, reply: 0 }, desc: '' },
    subtitles: { lines: [], count: 0, hasTrack: false },
    danmaku: { sampled: 0, claimed: 0, buckets: 0, sampleRatio: '未知', spamStripped: 0, spamKeys: [], tops: [], freqTop: [] },
    comments: [],
    error,
  })

  // ① 元信息
  const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
  if (view.code !== 0) return fail(`view 失败 code=${view.code} ${view.message ?? ''}`)
  const d = view.data
  const meta = {
    bvid,
    title: String(d.title ?? ''),
    up: String(d.owner?.name ?? ''),
    durationSec: Number(d.duration ?? 0),
    tname: String(d.tname ?? ''),
    pubdate: new Date((d.pubdate ?? 0) * 1000).toISOString(),
    stat: {
      view: Number(d.stat?.view ?? 0), like: Number(d.stat?.like ?? 0),
      favorite: Number(d.stat?.favorite ?? 0), coin: Number(d.stat?.coin ?? 0),
      danmaku: Number(d.stat?.danmaku ?? 0), reply: Number(d.stat?.reply ?? 0),
    },
    desc: String(d.desc ?? '').replace(/\n+/g, ' / ').slice(0, 300),
  }

  // ③ 官方字幕（WBI 签名）
  const wts = Math.round(Date.now() / 1000)
  const nav = await jget('https://api.bilibili.com/x/web-interface/nav')
  const keyOf = (u: string) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
  const wbiRaw = keyOf(nav.data?.wbi_img?.img_url ?? '') + keyOf(nav.data?.wbi_img?.sub_url ?? '')
  const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
  const mixin = MIXIN_TAB.map((i) => wbiRaw[i]).join('').slice(0, 32)
  const wq = new URLSearchParams({ bvid, cid: String(d.cid), wts: String(wts) }).toString()
  const wSigned = `${wq}&w_rid=${createHash('md5').update(wq + mixin).digest('hex')}`
  const subs = (await jget(`https://api.bilibili.com/x/player/wbi/v2?${wSigned}`))?.data?.subtitle?.subtitles ?? []
  let lines: Array<{ from: number; to: number; text: string }> = []
  if (subs.length) {
    const pick = subs.find((s: any) => s.lan === 'ai-zh') ?? subs.find((s: any) => s.lan === 'zh-CN') ?? subs[0]
    const url = String(pick.subtitle_url).startsWith('http') ? pick.subtitle_url : 'https:' + pick.subtitle_url
    const r = await fetch(url, { headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}/` } })
    // 不依赖 Response 独有字段：注入的替身常常只有 status/text/json，缺 ok 也算成功。
    const got = r.ok !== false && Number((r as any).status ?? 200) < 400
    if (got) {
      // 字幕行按接口原样保留，不按 meta.durationSec 裁剪：
      // AI 字幕的末行 to 常超过视频时长（600s 的视频给到 610s），裁了反而丢掉结尾话。
      try { lines = (JSON.parse(await r.text()).body ?? []).map((l: any) => ({ from: Number(l.from), to: Number(l.to ?? l.from + 3), text: String(l.content) })) } catch {}
    }
  }
  const subAt = (t: number): string | null => {
    if (!lines.length) return null
    let best: { from: number; text: string } | null = null
    for (const l of lines) {
      if (l.from <= t && t <= l.to) return l.text
      if (l.from <= t && (!best || l.from > best.from)) best = l
    }
    return best?.text ?? null
  }

  // ④ 弹幕热区（deflate 解压 + 刷屏剔除 + 分桶）
  let danmaku: Array<{ t: number; text: string }> = []
  try {
    const r = await fetch(`https://comment.bilibili.com/${d.cid}.xml`, { headers: { 'user-agent': UA, referer: `https://www.bilibili.com/video/${bvid}/` } })
    const buf = Buffer.from(await r.arrayBuffer())
    let xml = buf.toString('utf8')
    // 该接口返回不带 content-encoding 头的 deflate 流（fetch 不自动解 → 拿到二进制）
    if (!xml.includes('<d ') && !xml.includes('<i>')) {
      for (const fn of ['inflateRawSync', 'inflateSync', 'gunzipSync', 'brotliDecompressSync']) {
        try { const out = (zlib as any)[fn](buf).toString('utf8'); if (out.includes('<d ') || out.includes('<i>')) { xml = out; break } } catch {}
      }
    }
    danmaku = [...xml.matchAll(/<d p="([^"]*)">([^<]*)<\/d>/g)].map((m) => ({
      t: Number(m[1].split(',')[0]),
      text: m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"'),
    })).filter((x) => Number.isFinite(x.t))
  } catch {}

  const claimed = meta.stat.danmaku
  const keyCounts: Record<string, number> = {}
  for (const x of danmaku) {
    const k = norm(x.text) || '<纯符号>'
    keyCounts[k] = (keyCounts[k] ?? 0) + 1
  }
  const spamKeys = Object.entries(keyCounts).filter(([, c]) => c >= 20 && c / danmaku.length > 0.3).map(([k]) => k)
  const isSpam = (text: string) => { const k = norm(text); return k.length === 0 || spamKeys.some((s) => k.includes(s)) }
  const spamHits = danmaku.filter((x) => isSpam(x.text)).length

  const buckets = new Map<number, { raw: number; real: number }>()
  for (const x of danmaku) {
    const k = Math.floor(x.t / BUCKET) * BUCKET
    if (!buckets.has(k)) buckets.set(k, { raw: 0, real: 0 })
    const b = buckets.get(k)!
    b.raw++
    if (!isSpam(x.text)) b.real++
  }
  const realTotal = [...buckets.values()].reduce((n, b) => n + b.real, 0)
  const avgReal = realTotal / Math.max(1, buckets.size)
  const tops: DanmakuHot[] = [...buckets.entries()]
    .sort((a, b) => b[1].real - a[1].real)
    .slice(0, TOP)
    .map(([k, b]) => {
      const counts: Record<string, number> = {}
      for (const x of danmaku) if (!isSpam(x.text) && x.t >= k && x.t < k + BUCKET) counts[x.text] = (counts[x.text] ?? 0) + 1
      const ranked = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
      return {
        fromSec: k,
        toSec: k + BUCKET,
        realCount: b.real,
        rawCount: b.raw,
        hot: b.real >= avgReal * 1.5,
        subtitleAt: subAt(k + BUCKET / 2),
        topTexts: ranked.map(([t, c]) => (c > 1 ? `${t}×${c}` : t)),
      }
    })
  const all: Record<string, number> = {}
  for (const x of danmaku) if (!isSpam(x.text) && x.text.length >= 2) all[x.text] = (all[x.text] ?? 0) + 1
  const freqTop = Object.entries(all).sort((a, b) => b[1] - a[1]).slice(0, 12).map(([text, count]) => ({ text, count }))
  const ratio = claimed && danmaku.length ? `1/${Math.max(1, Math.round(claimed / danmaku.length))}` : '未知'

  // ⑤ 热评
  const comments: CommentItem[] = []
  try {
    const rep = await jget(`https://api.bilibili.com/x/v2/reply?type=1&oid=${d.aid}&sort=2&ps=${NCOM}&pn=1`)
    for (const r of rep?.data?.replies ?? []) {
      comments.push({
        like: Number(r.like ?? 0),
        replies: Number(r.rcount ?? 0),
        user: String(r.member?.uname ?? ''),
        text: String(r.content?.message ?? '').replace(/\n+/g, ' ').slice(0, 160),
      })
    }
  } catch {}

  return {
    ok: true,
    meta,
    subtitles: { lines, count: lines.length, hasTrack: lines.length > 0 },
    danmaku: {
      sampled: danmaku.length,
      claimed,
      buckets: buckets.size,
      sampleRatio: ratio,
      spamStripped: spamHits,
      spamKeys,
      tops,
      freqTop,
    },
    comments,
  }
}

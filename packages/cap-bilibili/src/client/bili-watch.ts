/**
 * B 站看画面（V-Now 第⑥路）：拿直链 → 流式下载 → 交给 cap-vision 的变化分管道 → 出拼图。
 *
 * 与 tools/commands/bili-watch.mjs 的关系：端点与画质口径照抄原命令
 * （html5+qn=32 会被压到 360p，实测改 platform=pc+qn=80 才拿得到 720p 的普通 mp4 直链；
 * 流式写盘那条也是 2026-10-21 外部审计 #6 修过的——两小时 720p 用
 * Buffer.from(arrayBuffer()) 会顶出 1–2GB 内存峰值）。
 *
 * 换掉的只有取帧方式：原来是"ffmpeg scene 滤镜空跑一遍找切点 + 逐段 -ss 重开 ffmpeg
 * 均匀抽 N 帧"（两趟解码，44 分钟那片实测 ETIMEDOUT），现在是 cap-vision 的单管道
 * 变化分留帧（一趟解码，同素材 58.6 秒出 6 张图，时间轴铺满全片）。
 * 判据、装箱、出图全在 vendor 的上游代码里，本文件只负责"下"和"串起来"。
 */
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { analyzeVideo, type AnalyzeResult, type OfflineOptions } from '../../../cap-vision/src/frame-pipeline.ts'
import { resolveFfmpeg } from '../../../cap-vision/src/ffmpeg.ts'
import { readFetcher, readHeaders, type BiliReadContext } from './bili-read.ts'
import { UA } from './bili-write.ts'

const QN_LABEL: Record<number, string> = { 16: '360P', 32: '480P', 64: '720P', 80: '1080P' }

export interface WatchContext extends BiliReadContext {
  /** mp4 落盘目录 */
  videoDir: string
  /** 拼图落盘目录 */
  sheetDir: string
  /** 注入管道替身（测试用；缺省走 cap-vision 的 analyzeVideo） */
  analyze?: (file: string, opts: OfflineOptions) => Promise<AnalyzeResult>
  /** 分析完是否留着 mp4。默认留——下载来的算原始素材，删不删由主人决定 */
  keepVideo?: boolean
}

export interface WatchResult {
  ok: boolean
  bvid: string
  title: string
  durationSec: number
  /** 服务端实际给的画质（不是我们要的） */
  quality: string
  videoFile: string | null
  videoBytes: number
  visual: AnalyzeResult | null
  /** 画面里每格对齐到的时间窗，供 debrief 与弹幕热区对上 */
  steps: Array<{ fromSec: number; toSec: number; why: string; file: string | null; frames: number }>
  error?: string
  /** 下载完了但看不了（缺 ffmpeg 等）——画面之外的素材仍然可用 */
  degraded?: string
}

const fail = (ctx: WatchContext, bvid: string, error: string, patch: Partial<WatchResult> = {}): WatchResult => ({
  ok: false, bvid, title: '', durationSec: 0, quality: '', videoFile: null,
  videoBytes: 0, visual: null, steps: [], error, ...patch,
})

export async function watchVideo(
  ctx: WatchContext,
  bvid: string,
  opts: { targetFrames?: number; startSec?: number; endSec?: number; fps?: number; maxSheets?: number; timeoutSec?: number } = {},
): Promise<WatchResult> {
  const fetch = readFetcher(ctx)
  const H = readHeaders(ctx)
  const jget = async (u: string) => (await fetch(u, { headers: H })).json()

  // ① 元信息（cid / 时长 / 标题）
  const view = await jget(`https://api.bilibili.com/x/web-interface/view?bvid=${bvid}`)
  if (view.code !== 0) return fail(ctx, bvid, `view 失败 code=${view.code} ${view.message ?? ''}`)
  const cid = Number(view.data?.cid ?? 0)
  const durationSec = Number(view.data?.duration ?? 0)
  const title = String(view.data?.title ?? '')
  if (!cid) return fail(ctx, bvid, 'view 没给 cid')

  // ② 直链（qn=80 + platform=pc 是实测能拿到 720p 普通 mp4 的那组参数）
  const p = await jget(
    `https://api.bilibili.com/x/player/playurl?bvid=${bvid}&cid=${cid}&qn=80&fnval=1&platform=pc&high_quality=1`,
  )
  const url = String(p?.data?.durl?.[0]?.url ?? '')
  const quality = QN_LABEL[Number(p?.data?.quality ?? 0)] ?? String(p?.data?.quality ?? '未知')
  if (!url) return fail(ctx, bvid, `没拿到直链（code=${p?.code} ${p?.message ?? ''}）——有些视频要登录或只有 dash 流`)

  // ③ 流式下载（内存恒定）
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const videoFile = path.join(ctx.videoDir, `${bvid}-${stamp}.mp4`)
  fs.mkdirSync(ctx.videoDir, { recursive: true })
  // 直链是 CDN 自己的签名，带 cookie 反而可能被判定跨站；照抄原命令的 UA + referer
  let r: any
  try {
    r = await fetch(url, { headers: { 'user-agent': UA, referer: 'https://www.bilibili.com/', range: 'bytes=0-' } })
  } catch (e) {
    return fail(ctx, bvid, `下载请求失败：${e instanceof Error ? e.message : String(e)}`)
  }
  if (r.ok === false || Number(r.status ?? 200) >= 400) {
    return fail(ctx, bvid, `下载失败 HTTP ${r.status ?? '?'}`)
  }
  if (!r.body) return fail(ctx, bvid, '下载失败：响应没有 body（无法流式写盘）')
  try {
    await pipeline(Readable.fromWeb(r.body), fs.createWriteStream(videoFile))
  } catch (e) {
    try { fs.rmSync(videoFile, { force: true }) } catch { /* 半截文件留着也没用 */ }
    return fail(ctx, bvid, `下载中断：${e instanceof Error ? e.message : String(e)}`)
  }
  const videoBytes = fs.statSync(videoFile).size

  const base: WatchResult = {
    ok: true, bvid, title, durationSec, quality, videoFile, videoBytes,
    visual: null, steps: [],
  }

  // ④ 变化分管道
  const impl = ctx.analyze ?? analyzeVideo
  // 注入了管道替身就不必找 ffmpeg（测试路径）；真跑时找不到 ffmpeg 只降级，不失败
  const needFfmpeg = ctx.analyze === undefined
  const ff = needFfmpeg ? resolveFfmpeg().path : null
  if (needFfmpeg && !ff) {
    return { ...base, ok: true, degraded: '找不到 ffmpeg：画面这路跳过，其余素材照常' }
  }
  const visual = await impl(videoFile, {
    ffmpegPath: ff ?? undefined,
    durationSec,
    outDir: ctx.sheetDir,
    targetFrames: opts.targetFrames,
    fps: opts.fps,
    maxSheets: opts.maxSheets,
    timeoutMs: opts.timeoutSec ? Math.round(opts.timeoutSec * 1000) : undefined,
    startSec: opts.startSec,
    endSec: opts.endSec,
  })
  if (!visual.ok) {
    return { ...base, ok: true, degraded: `画面这路失败：${visual.error}`, visual }
  }
  if (ctx.keepVideo === false) {
    try { fs.rmSync(videoFile) } catch { /* 被占用就留着，不因此判失败 */ }
  }
  return {
    ...base,
    videoFile: ctx.keepVideo === false ? null : videoFile,
    visual,
    steps: visual.sheets.map((s) => ({
      fromSec: s.fromSec, toSec: s.toSec, why: s.why, file: s.file ?? null, frames: s.frames.length,
    })),
  }
}

/** 把画面步长和弹幕热区对到一起：热区落在哪张图的哪一帧，一次说清。 */
export function alignVisual(
  tops: Array<{ fromSec: number; toSec: number; realCount: number }>,
  steps: WatchResult['steps'],
): Array<{ fromSec: number; toSec: number; realCount: number; sheet: number | null }> {
  if (!steps.length) return tops.map((t) => ({ ...t, sheet: null }))
  return tops.map((t) => {
    const mid = (t.fromSec + t.toSec) / 2
    const hit = steps.findIndex((s) => mid >= s.fromSec && mid <= s.toSec)
    return { ...t, sheet: hit >= 0 ? hit + 1 : null }
  })
}

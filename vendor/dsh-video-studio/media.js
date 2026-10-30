/**
 * 媒体探测与抽帧。
 *
 * 抽帧是这个插件的关键能力：插件本身"看不懂"视频，真正的选段判断由 agent
 * 读图完成，所以抽帧要快、要能按时间点精确定位、要能一次抽多张供模型批量读。
 */

import { mkdirSync, readdirSync, statSync } from 'node:fs'
import { extname, join } from 'node:path'
import { resolveBinaries, run } from './ffmpeg.js'

const VIDEO_EXT = new Set(['.mp4', '.mov', '.mkv', '.avi', '.flv', '.webm', '.m4v', '.wmv', '.ts', '.mpg', '.mpeg', '.3gp'])
const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.flac', '.ogg', '.opus', '.wma'])
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp', '.bmp'])
const SUB_EXT = new Set(['.srt', '.ass', '.ssa', '.vtt'])

export function classifyFile(name) {
  const ext = extname(name).toLowerCase()
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (IMAGE_EXT.has(ext)) return 'image'
  if (SUB_EXT.has(ext)) return 'subtitle'
  return 'other'
}

/**
 * 目录里需要忽略的系统/中间文件。
 * 注意不能简单跳过所有点开头的文件：手机导出的素材经常带前导点
 * （实测有 `.20260911_1mp4.mp4`），一刀切会把真实素材漏掉。
 */
const SKIP_NAMES = new Set([
  'thumbs.db', 'desktop.ini', '.ds_store', '.gitignore', '.gitkeep',
  'icon\r', 'ehthumbs.db',
])
const SKIP_EXT = new Set(['.tmp', '.part', '.crdownload', '.download', '.lnk', '.db', '.ini', '.log'])

/** 列出目录里的素材，跳过系统文件与临时产物。 */
export function listMedia(dir) {
  const out = { video: [], audio: [], image: [], subtitle: [], other: [] }
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch (error) {
    throw new Error(`无法读取目录 ${dir}：${error.message}`)
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (SKIP_NAMES.has(lower)) continue
    if (lower.endsWith('.part') || lower.endsWith('.tmp')) continue
    const full = join(dir, entry.name)
    let size = 0
    try { size = statSync(full).size } catch { continue }
    if (size === 0) continue
    const kind = classifyFile(entry.name)
    if (kind === 'other' && SKIP_EXT.has(extname(entry.name).toLowerCase())) continue
    out[kind].push({ name: entry.name, path: full, size, kind })
  }
  for (const key of Object.keys(out)) out[key].sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  return out
}

function parseRational(value) {
  if (!value || typeof value !== 'string') return undefined
  const [num, den] = value.split('/')
  const n = Number(num)
  const d = den === undefined ? 1 : Number(den)
  if (!Number.isFinite(n) || !Number.isFinite(d) || d === 0) return undefined
  return n / d
}

/** ffprobe 摘要：时长/分辨率/帧率/编码/音轨数。 */
export async function probe(path, config = {}) {
  const { ffprobe } = resolveBinaries(config)
  if (!ffprobe) throw new Error('找不到 ffprobe，请设置 DSH_FFPROBE_PATH 或在配置里指定 ffprobePath')
  const result = await run([
    ffprobe, '-v', 'error', '-print_format', 'json',
    '-show_format', '-show_streams', path,
  ], { timeoutMs: 60_000 })
  if (result.code !== 0) throw new Error(`ffprobe 失败：${result.stderr.trim().slice(0, 300)}`)

  const data = JSON.parse(result.stdout)
  const videos = (data.streams ?? []).filter((s) => s.codec_type === 'video')
  const audios = (data.streams ?? []).filter((s) => s.codec_type === 'audio')
  const subs = (data.streams ?? []).filter((s) => s.codec_type === 'subtitle')
  const v = videos[0]

  return {
    file: path,
    duration: Number(data.format?.duration ?? v?.duration ?? 0),
    sizeMB: Number(((Number(data.format?.size ?? 0)) / 1048576).toFixed(2)),
    width: v?.width ?? 0,
    height: v?.height ?? 0,
    fps: parseRational(v?.r_frame_rate),
    videoCodec: v?.codec_name,
    hasAudio: audios.length > 0,
    audioCodec: audios[0]?.codec_name,
    audioCount: audios.length,
    subtitleCount: subs.length,
    videoStreamCount: videos.length,
  }
}

/**
 * 在指定时间点抽帧。返回生成的文件路径（供模型 read_image 读）。
 * scale 用于控体积：给视觉模型读图不需要原始分辨率。
 */
export async function extractFrames({ input, times, outDir, width = 640, format = 'png', signal, config = {} } = {}) {
  const { ffmpeg } = resolveBinaries(config)
  if (!ffmpeg) throw new Error('找不到 ffmpeg，请设置 DSH_FFMPEG_PATH 或在配置里指定 ffmpegPath')
  if (!Array.isArray(times) || times.length === 0) throw new Error('times 至少要有一个时间点')
  if (times.length > 30) throw new Error(`一次最多抽 30 帧（当前 ${times.length}）`)

  mkdirSync(outDir, { recursive: true })
  const made = []
  for (const raw of times) {
    const t = Number(raw)
    if (!Number.isFinite(t) || t < 0) continue
    const name = `f_${String(t.toFixed(2)).padStart(7, '0')}.${format}`
    const out = join(outDir, name)
    const args = [
      ffmpeg, '-hide_banner', '-loglevel', 'error',
      '-ss', String(t), '-i', input,
      '-frames:v', '1', '-vf', `scale=${width}:-2`,
      '-y', out,
    ]
    const result = await run(args, { timeoutMs: 60_000, signal })
    if (result.code === 0) made.push(out)
  }
  if (made.length === 0) {
    throw new Error(`抽帧全部失败。常见原因：时间点超出视频时长，或输入文件无法解码（${input}）`)
  }
  return made
}

/** 按固定间隔抽帧（用于建立整条素材的内容地图）。 */
export async function extractFramesEvery({ input, outDir, every = 3, maxFrames = 40, width = 640, start = 0, end, signal, config = {} } = {}) {
  const info = await probe(input, config)
  const step = Math.max(0.05, Number(every) || 3)
  const from = Math.max(0, Number(start) || 0)
  const stop = Number.isFinite(Number(end)) ? Number(end) : info.duration
  const times = []
  // 用整数步进累加，避免浮点误差导致少算一帧（曾出现 53.17s / 每 6s 只给出 6 帧）
  for (let index = 0; times.length < maxFrames; index += 1) {
    const t = from + index * step
    if (t > stop - 0.001) break
    times.push(Number(t.toFixed(2)))
    if (index > 10_000) break
  }
  if (times.length === 0) times.push(from)
  return extractFrames({ input, times, outDir, width, signal, config })
}

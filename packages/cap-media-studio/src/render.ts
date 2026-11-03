/**
 * 真实音视频合成管线（复用 tools/media/* 与 vendor/dsh-video-studio，不重复实现）。
 *
 * 与 tools/video-build.mjs 的区别：这是**库函数**，失败返回 `{ ok:false, error }`，
 * 绝不调用 process.exit —— 库里杀进程会让调用方无法 catch（write-refusal.mjs:56 的老毛病）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { resolveBgm } from '../../../tools/media/bgm.mjs'
import { ttsPlan, synthesize, describeTts } from '../../../tools/media/tts.mjs'
import {
  studioConfig,
  resolveTools,
  probeDuration,
  assembleBaseClip,
  make169Base,
  render,
  makeCover,
} from '../../../tools/media/video/studio.mjs'

export const VIDEO_SIZE_LIMITS = { minDuration: 3, maxDuration: 60 }

export interface RenderVideoSliceInput {
  image: string
  text: string
  outDir: string
  slug?: string
  durationSec?: number
  width?: number
  height?: number
  tts?: 'auto' | 'mimo' | 'edge' | 'none'
  voice?: string
  style?: string
  model?: string
  bgm?: string
  bgmVolume?: number
  planOnly?: boolean
  /** ffmpeg/ffprobe 所在目录（默认由 vendor 的 PATH/常见目录探测兜底） */
  binDir?: string
  /** edge-tts 的 venv Scripts 目录 */
  toolsBinDir?: string
  /** CC0 BGM 曲库目录（assets/bgm） */
  bgmDir?: string
  onWarn?: (msg: string) => void
  onProgress?: (msg: string) => void
}

export interface RenderVideoSliceResult {
  ok: boolean
  planOnly: boolean
  out: string | null
  cover916File: string | null
  cover169File: string | null
  duration: number | null
  sizeMB: number | null
  ttsProvider: string | null
  voice: string | null
  voiceSeconds: number | null
  bgm: string | null
  bgmVolume: number | null
  coverBytes: number | null
  cover169Bytes: number | null
  warnings: string[]
  error?: string
}

function fail(msg: string): RenderVideoSliceResult {
  return {
    ok: false,
    planOnly: false,
    out: null,
    cover916File: null,
    cover169File: null,
    duration: null,
    sizeMB: null,
    ttsProvider: null,
    voice: null,
    voiceSeconds: null,
    bgm: null,
    bgmVolume: null,
    coverBytes: null,
    cover169Bytes: null,
    warnings: [],
    error: msg,
  }
}

export function describeTtsStatus(): { mimoKey: string; voices: Record<string, string> } {
  return describeTts()
}

export async function renderVideoSlice(input: RenderVideoSliceInput): Promise<RenderVideoSliceResult> {
  const warn = input.onWarn ?? (() => {})
  const progress = input.onProgress ?? (() => {})

  if (!input.image || !fs.existsSync(input.image)) {
    return fail(`底图不存在: ${input.image}`)
  }
  const lines = String(input.text ?? '')
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 5)
  if (!lines.length) return fail('台词是空的')

  const width = Number(input.width ?? 1080)
  const height = Number(input.height ?? 1920)
  if (!Number.isFinite(width) || !Number.isFinite(height)) return fail('尺寸必须是数字（如 1080x1920）')

  const ttsMode = input.tts ?? 'auto'
  if (!['auto', 'mimo', 'edge', 'none'].includes(ttsMode)) return fail('tts 只支持 auto|mimo|edge|none')

  let duration = Number(input.durationSec ?? 20)
  if (!Number.isFinite(duration)) duration = 20
  duration = Math.max(VIDEO_SIZE_LIMITS.minDuration, Math.min(VIDEO_SIZE_LIMITS.maxDuration, Math.round(duration)))

  const bgmVolume = Math.max(0, Math.min(0.6, Number(input.bgmVolume ?? 0.14) || 0.14))
  const planOnly = Boolean(input.planOnly)

  fs.mkdirSync(input.outDir, { recursive: true })
  const slug = input.slug || 'vid-' + new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const out = path.join(input.outDir, `${slug}.mp4`)
  const cover = path.join(input.outDir, `${slug}-cover.png`)
  const cover169 = path.join(input.outDir, `${slug}-cover-169.png`)
  const base = path.join(input.outDir, `.${slug}.base.mp4`)
  const base169 = path.join(input.outDir, `.${slug}.base169.mp4`)
  const voiceFile = path.join(input.outDir, `.${slug}.voice.mp3`)

  const cleanup = () => {
    for (const f of [base, base169, voiceFile]) {
      try { fs.rmSync(f, { force: true }) } catch {}
    }
  }

  try {
    const scfg = studioConfig({ localBinDir: input.binDir ?? '' })
    const { ffmpeg, ffprobe } = resolveTools(scfg)
    if (!ffmpeg) return fail('找不到 ffmpeg（请把 ffmpeg.exe 放进 bili-whale/bin 或加入 PATH）')
    if (!ffprobe) return fail('找不到 ffprobe')

    // BGM
    let bgmFile: string | null = null
    const bgmArg = input.bgm ?? 'auto'
    if (bgmArg && bgmArg !== 'none') {
      const bgmDir = input.bgmDir
      if (!bgmDir) {
        warn('未提供 bgmDir，本次不配 BGM')
      } else {
        const r = resolveBgm(bgmArg, { dir: bgmDir })
        if (r.error) return fail(r.error)
        bgmFile = r.file
        if (!bgmFile) warn('曲库里没有 mp3，本次只用人声/静音')
      }
    }

    // TTS
    let ttsProvider: string | null = null
    let voiceUsed: string | null = null
    let ttsDuration = 0
    const plan = ttsPlan(ttsMode)
    if (plan.order.length) {
      const voiceArg = input.voice ?? 'auto'
      const r = await synthesize({
        plan,
        text: lines.join('\n'),
        voiceArg,
        outFile: voiceFile,
        style: input.style ?? '请用温柔、轻一点、像夜里说话的语气朗读下面内容。',
        model: input.model ?? 'mimo-v2.5-tts',
        binDir: input.toolsBinDir ?? '',
        onWarn: (m: string) => warn('[tts] ' + m),
      })
      ttsProvider = r.provider
      voiceUsed = r.voice
      ttsDuration = await probeDuration(ffprobe, voiceFile)
      const need = Math.ceil(ttsDuration + 2)
      if (need > duration) {
        duration = Math.min(VIDEO_SIZE_LIMITS.maxDuration, need)
        if (ttsDuration + 2 > VIDEO_SIZE_LIMITS.maxDuration) {
          warn(`旁白 ${ttsDuration.toFixed(1)}s，${VIDEO_SIZE_LIMITS.maxDuration}s 装不下完整收尾，按上限截断`)
        }
      }
    }

    // 1) 基础片段（图 + 人声 + BGM）
    await assembleBaseClip({
      ffmpeg,
      image: input.image,
      voiceFile: ttsProvider ? voiceFile : null,
      bgmFile,
      bgmVolume,
      width,
      height,
      duration,
      out: base,
      fast: planOnly,
    })

    // 2) 渲染（planOnly 只校验 spec，不出成片）
    const res = await render(
      {
        segments: [{ input: base, start: 0, end: duration }],
        width,
        height,
        fps: 30,
        exactDuration: duration,
        textLines: lines,
        ending: 'fade',
        font: 'yahei',
        look: 'none',
        planOnly,
        output: out,
      },
      scfg,
      { onProgress: (m: string) => progress('[video] ' + m) },
    )

    // 3) 封面：竖版 9:16 + 横版 16:9（取 base 不取成片，避免字幕叠两层）
    let coverRes: { bytes?: number } | null = null
    let cover169Res: { bytes?: number } | null = null
    if (!planOnly) {
      // 取帧位置必须给 16:9 底图留满 1 秒：make169Base 用 `-ss at -t 1`，
      // 若 at > duration-1，截出的 base169 会短于 1s，随后 makeCover 在 `-ss 0.5`
      // 取不到帧——ffmpeg 返回 exit 0 却不产文件（实测 3s 片长时 at=2.55 → 0.467s → 失败）。
      const at = Math.max(0, Math.min(duration * 0.85, duration - 1))
      coverRes = await makeCover(
        { video: base, output: cover, lines: [lines[0]], width, height, at, font: 'yahei' },
        scfg,
      )
      await make169Base({ ffmpeg, base, at, out: base169 })
      cover169Res = await makeCover(
        { video: base169, output: cover169, lines: [lines[0]], width: 1280, height: 720, at: 0.5, font: 'yahei' },
        scfg,
      )
    }

    return {
      ok: true,
      planOnly,
      out: planOnly ? null : out,
      cover916File: planOnly ? null : cover,
      cover169File: planOnly ? null : cover169,
      duration: res?.duration ?? duration,
      sizeMB: res?.sizeMB ?? null,
      ttsProvider,
      voice: voiceUsed,
      voiceSeconds: ttsDuration ? Number(ttsDuration.toFixed(2)) : null,
      bgm: bgmFile ? path.basename(bgmFile) : null,
      bgmVolume: bgmFile ? bgmVolume : null,
      coverBytes: coverRes?.bytes ?? null,
      cover169Bytes: cover169Res?.bytes ?? null,
      warnings: res?.warnings ?? [],
    }
  } catch (e: any) {
    return fail(String(e?.message ?? e))
  } finally {
    cleanup()
  }
}

/** TTS 试听：只出人声 mp3，不出成片（不消耗渲染时间）。 */
export async function previewTtsAudio(input: {
  text: string
  voice?: string
  outFile: string
  tts?: 'auto' | 'mimo' | 'edge'
  style?: string
  model?: string
  toolsBinDir?: string
  ffprobePath?: string
  onWarn?: (msg: string) => void
}): Promise<{ ok: true; provider: string; voice: string; outFile: string; seconds: number | null } | { ok: false; error: string }> {
  const clean = String(input.text ?? '').trim()
  if (!clean) return { ok: false, error: '台词是空的' }
  fs.mkdirSync(path.dirname(input.outFile), { recursive: true })
  try {
    const plan = ttsPlan(input.tts ?? 'auto')
    if (!plan.order.length) return { ok: false, error: 'tts=none 无法试听' }
    const r = await synthesize({
      plan,
      text: clean,
      voiceArg: input.voice ?? 'auto',
      outFile: input.outFile,
      style: input.style ?? '请用温柔、轻一点、像夜里说话的语气朗读下面内容。',
      model: input.model ?? 'mimo-v2.5-tts',
      binDir: input.toolsBinDir ?? '',
      onWarn: input.onWarn ?? (() => {}),
    })
    let seconds: number | null = null
    if (input.ffprobePath) {
      try {
        seconds = Number((await probeDuration(input.ffprobePath, input.outFile)).toFixed(2))
      } catch {}
    }
    return { ok: true, provider: r.provider, voice: r.voice, outFile: input.outFile, seconds }
  } catch (e: any) {
    return { ok: false, error: String(e?.message ?? e) }
  }
}

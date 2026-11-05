/**
 * @xiaoyu/cap-media-studio —— 音视频创作能力扩展包（100% 宿主无关）。
 *
 * 默认走**真实合成管线**（`src/render.ts` → tools/media/* + vendor/dsh-video-studio + 本机 ffmpeg），
 * 测试可注入 renderPipeline / ttsPreview 替身。
 *
 * - 模型工具：media_tts_preview、media_video_build
 * - 主人操作台 `media-studio`：listAssets / previewTts / buildVideoDraft
 */
import fs from 'node:fs'
import path from 'node:path'
import type { XiaoyuCapability } from '../../persona-core/src/capability.ts'
import { listBgm, resolveBgm } from './vendor/bgm.mjs'
import { MEDIA_DEFAULTS } from './vendor/media-config.mjs'
import { ttsPlan, describeTts } from './vendor/tts.mjs'
import { loadPromptLibrary, composeImagePrompt, PROMPT_DIR } from './image-prompt.ts'
import {
  renderVideoSlice,
  previewTtsAudio,
  describeTtsStatus,
  VIDEO_SIZE_LIMITS,
  type RenderVideoSliceInput,
  type RenderVideoSliceResult,
} from './render.ts'

export { listBgm, resolveBgm, MEDIA_DEFAULTS, ttsPlan, describeTts, renderVideoSlice, previewTtsAudio, describeTtsStatus, VIDEO_SIZE_LIMITS }
export type { RenderVideoSliceInput, RenderVideoSliceResult }

export interface MediaStudioConfig {
  ttsProvider: 'auto' | 'mimo' | 'edge' | 'none'
  ttsVoice: string
  ttsStyle: string
  ttsModel: string
  bgmDefault: string
  bgmVolume: number
  defaultDurationSec: number
  videoWidth: number
  videoHeight: number
}

export interface VideoDraftRecord {
  id: string
  createdAt: string
  image: string
  text: string
  bgm: string | null
  durationSec: number
  videoFile: string | null
  cover916File: string | null
  cover169File: string | null
  sizeMB: number | null
  ttsProvider: string | null
  voiceSeconds: number | null
  pushedToQueue: boolean
  pendingId?: string
  warnings: string[]
}

export interface MediaStudioCapabilityOptions {
  /** 底图目录（assets/daily） */
  assetsDir: string
  /** 生图提示词库目录（character.txt + form-*.txt + 场景库），默认包内 assets/prompts */
  promptDir?: string
  /** CC0 BGM 曲库目录（assets/bgm） */
  bgmDir: string
  /** 成片输出目录 */
  outputDir: string
  /** ffmpeg / ffprobe 所在目录（默认 bili-whale/bin） */
  binDir?: string
  /** edge-tts venv Scripts 目录 */
  toolsBinDir?: string
  /** 可注入替身（测试用）；缺省走真实管线 */
  renderPipeline?: (input: RenderVideoSliceInput) => Promise<RenderVideoSliceResult>
  ttsPreview?: (input: { text: string; voice?: string; outFile: string }) => Promise<
    { ok: true; provider: string; voice: string; outFile: string; seconds: number | null } | { ok: false; error: string }
  >
  onPushToBiliQueue?: (draft: VideoDraftRecord) => Promise<{ ok: boolean; pendingId?: string }> | { ok: boolean; pendingId?: string }
}

function ffmpegAvailable(binDir?: string): { ffmpeg: string | null; ffprobe: string | null } {
  const exe = (n: string) =>
    binDir ? path.join(binDir, process.platform === 'win32' ? `${n}.exe` : n) : null
  const f = exe('ffmpeg')
  const p = exe('ffprobe')
  return {
    ffmpeg: f && fs.existsSync(f) ? f : null,
    ffprobe: p && fs.existsSync(p) ? p : null,
  }
}

export function createMediaStudioCapability(
  opts: MediaStudioCapabilityOptions,
): XiaoyuCapability<MediaStudioConfig> {
  const indexFile = path.join(opts.outputDir, 'video-drafts.json')

  function readDraftRecords(): VideoDraftRecord[] {
    try {
      const list = JSON.parse(fs.readFileSync(indexFile, 'utf8'))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  function saveDraftRecords(records: VideoDraftRecord[]): void {
    fs.mkdirSync(opts.outputDir, { recursive: true })
    fs.writeFileSync(indexFile, JSON.stringify(records, null, 2), 'utf8')
  }

  function listDailyImages(): string[] {
    if (!fs.existsSync(opts.assetsDir)) return []
    return fs
      .readdirSync(opts.assetsDir)
      .filter((f) => /\.(png|jpe?g|webp)$/i.test(f))
      .sort()
  }

  function resolveImage(image: string): string | null {
    if (fs.existsSync(image)) return image
    const byName = path.join(opts.assetsDir, image)
    return fs.existsSync(byName) ? byName : null
  }

  async function runPreviewTts(params: { text: string; voice?: string }) {
    const cleanText = String(params?.text ?? '').trim()
    if (!cleanText) return { ok: false as const, error: '台词文本不能为空' }
    fs.mkdirSync(opts.outputDir, { recursive: true })
    const outFile = path.join(opts.outputDir, `tts-preview-${Date.now().toString(36)}.mp3`)
    let res: any
    if (opts.ttsPreview) {
      res = await opts.ttsPreview({ text: cleanText, voice: params.voice, outFile })
    } else {
      const { ffprobe } = ffmpegAvailable(opts.binDir)
      res = await previewTtsAudio({
        text: cleanText,
        voice: params.voice,
        outFile,
        toolsBinDir: opts.toolsBinDir,
        ffprobePath: ffprobe ?? undefined,
      })
    }
    // 试听要能**真在页面里播**：宿主没有 `/api/files?path=`（按任意路径取文件的路由不存在，
    // 2026-11-04 实测一律 404 裂图；宿主只有 `/api/blob?handle=`），
    // 所以音频由本包自己出成 data URL，跟 cap-vision 的缩略图一个路子。
    if (res?.ok === false) return res
    const out = String(res?.outFile ?? outFile)
    try {
      const bytes = fs.readFileSync(out)
      return { ...res, ok: true, outFile: out, dataUrl: `data:audio/mpeg;base64,${bytes.toString('base64')}`, bytes: bytes.length }
    } catch (e: any) {
      // 出不来音频就照实说（别给一个播不动的空 src）
      return { ...res, ok: false, error: `试听音频生成不出来：${String(e?.message ?? e)}`, outFile: out }
    }
  }

  async function runBuildVideoDraft(params: {
    image: string
    text: string
    bgmId?: string
    durationSec?: number
    pushToQueue?: boolean
    planOnly?: boolean
  }) {
    const cleanText = String(params?.text ?? '').trim()
    if (!cleanText) return { ok: false as const, error: '视频台词不能为空' }
    const image = resolveImage(String(params?.image ?? ''))
    if (!image) return { ok: false as const, error: `找不到底图: ${params.image}（可用：${listDailyImages().join(', ') || '底图目录为空'}）` }

    const bgmArg = params.bgmId ?? 'auto'
    if (bgmArg !== 'none' && bgmArg !== 'auto') {
      const probe = resolveBgm(bgmArg, { dir: opts.bgmDir })
      if (probe.error) return { ok: false as const, error: probe.error }
    }

    const id = `vid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
    const itemDir = path.join(opts.outputDir, id)
    const durationSec = Math.max(
      VIDEO_SIZE_LIMITS.minDuration,
      Math.min(VIDEO_SIZE_LIMITS.maxDuration, Math.round(Number(params.durationSec ?? MEDIA_DEFAULTS.video.duration))),
    )

    const pipeline = opts.renderPipeline ?? renderVideoSlice
    const [defW, defH] = String(MEDIA_DEFAULTS.video.size).split('x').map((n) => Number(n))
    const res = await pipeline({
      image,
      text: cleanText,
      outDir: itemDir,
      slug: 'video',
      durationSec,
      width: Number.isFinite(defW) ? defW : 1080,
      height: Number.isFinite(defH) ? defH : 1920,
      bgm: bgmArg,
      bgmVolume: MEDIA_DEFAULTS.bgm.volume,
      bgmDir: opts.bgmDir,
      binDir: opts.binDir,
      toolsBinDir: opts.toolsBinDir,
      planOnly: Boolean(params.planOnly),
    })

    if (!res.ok) {
      return { ok: false as const, error: res.error ?? '合成失败', warnings: res.warnings ?? [] }
    }

    const record: VideoDraftRecord = {
      id,
      createdAt: new Date().toISOString(),
      image,
      text: cleanText,
      bgm: res.bgm,
      durationSec: Number(res.duration ?? durationSec),
      videoFile: res.out,
      cover916File: res.cover916File,
      cover169File: res.cover169File,
      sizeMB: res.sizeMB,
      ttsProvider: res.ttsProvider,
      voiceSeconds: res.voiceSeconds,
      pushedToQueue: false,
      warnings: res.warnings ?? [],
    }

    let queueResult: { ok: boolean; pendingId?: string } | undefined
    if (params.pushToQueue && opts.onPushToBiliQueue && res.out) {
      queueResult = await opts.onPushToBiliQueue(record)
      if (queueResult?.ok) {
        record.pushedToQueue = true
        record.pendingId = queueResult.pendingId
      }
    }

    if (!params.planOnly) {
      const all = readDraftRecords()
      all.push(record)
      saveDraftRecords(all)
    }
    return { ok: true as const, draft: record, render: res, queueResult }
  }

  return {
    id: 'media-studio',
    title: '音视频创作工作室',
    kind: 'world',
    configSchema: {
      type: 'object',
      title: '音视频合成配置',
      properties: {
        ttsProvider: { type: 'string', title: 'TTS 语音提供方', enum: ['auto', 'mimo', 'edge', 'none'], default: 'auto', 'x-hot': true },
        ttsVoice: { type: 'string', title: '默认朗读音色', default: '茉莉', 'x-hot': true },
        ttsStyle: { type: 'string', title: '朗读风格指令', default: MEDIA_DEFAULTS.tts.style, multiline: true, 'x-hot': true },
        ttsModel: { type: 'string', title: 'TTS 模型', default: MEDIA_DEFAULTS.tts.model, 'x-hot': true },
        bgmDefault: { type: 'string', title: '默认背景音乐', default: 'auto', 'x-hot': true },
        bgmVolume: { type: 'number', title: '背景音乐音量 (0~0.6)', default: 0.14, minimum: 0, maximum: 0.6, 'x-hot': true },
        defaultDurationSec: { type: 'integer', title: '默认成片时长（秒）', default: 20, minimum: 3, maximum: 60, 'x-hot': true },
        videoWidth: { type: 'integer', title: '成片宽', default: 1080, 'x-hot': true },
        videoHeight: { type: 'integer', title: '成片高', default: 1920, 'x-hot': true },
      },
    },
    defaultConfig: {
      ttsProvider: 'auto',
      ttsVoice: '茉莉',
      ttsStyle: MEDIA_DEFAULTS.tts.style,
      ttsModel: MEDIA_DEFAULTS.tts.model,
      bgmDefault: 'auto',
      bgmVolume: MEDIA_DEFAULTS.bgm.volume,
      defaultDurationSec: MEDIA_DEFAULTS.video.duration,
      videoWidth: 1080,
      videoHeight: 1920,
    },

    tools() {
      return [
        {
          name: 'media_tts_preview',
          summary: '合成一段台词的 TTS 语音试听（默认茉莉音色）',
          description: '输入台词文本，生成本地 mp3 语音文件；MiMo 不可用时自动回退 edge-tts。',
          parameters: {
            type: 'object',
            properties: {
              text: { type: 'string', description: '朗读台词' },
              voice: { type: 'string', description: '可选音色名（默认 茉莉）' },
            },
            required: ['text'],
          },
          mutatesState: true,
          async execute(args: { text: string; voice?: string }) {
            return await runPreviewTts(args)
          },
        },
        {
          name: 'media_video_build',
          summary: '选底图、台词与 CC0 BGM 合成竖屏短视频及 9:16 / 16:9 双封面',
          description: '真实调用本机 ffmpeg 合成成片；pushToQueue=true 时同时送入 B 站待放行队列。',
          parameters: {
            type: 'object',
            properties: {
              image: { type: 'string', description: '底图文件名或绝对路径' },
              text: { type: 'string', description: '朗读与字幕台词（最多 5 行）' },
              bgmId: { type: 'string', description: 'BGM 曲目名片段（如 quiet-room）或 auto / none' },
              durationSec: { type: 'integer', description: '时长秒数（3~60，默认 20）' },
              pushToQueue: { type: 'boolean', description: '是否同时送入 B 站待放行队列' },
            },
            required: ['image', 'text'],
          },
          mutatesState: true,
          async execute(args: { image: string; text: string; bgmId?: string; durationSec?: number; pushToQueue?: boolean }) {
            return await runBuildVideoDraft(args)
          },
        },
      ]
    },

    panels() {
      return [
        {
          id: 'media-studio',
          title: '音视频创作工作台',
          description: '浏览底图与 CC0 BGM 曲库、试听 TTS 语音、一键合成视频草稿并送入 B 站待放行队列',
          methods: {
            listPrompts: {
              name: 'listPrompts',
              verb: 'GET',
              summary: '读生图提示词库：形象正本、形态档、场景清单',
              writable: false,
              invoke(params: { dir?: string } = {}) {
                const lib = loadPromptLibrary(params?.dir ?? opts.promptDir ?? PROMPT_DIR)
                if (!lib) return { ok: false, error: `提示词库缺失（character.txt 不在 ${params?.dir ?? opts.promptDir ?? PROMPT_DIR}）` }
                return { ok: true, scenes: lib.scenes.map((s) => ({ id: s.id, name: s.name })), forms: Object.keys(lib.forms), negativeCount: lib.negative.length }
              },
            },
            composePrompt: {
              name: 'composePrompt',
              verb: 'POST',
              summary: '按场景+形态档组合一份完整正向提示词（形象正本自动带上）',
              writable: true,
              invoke(params: { sceneId: string; form?: string }) {
                const lib = loadPromptLibrary(opts.promptDir ?? PROMPT_DIR)
                if (!lib) return { ok: false, error: '提示词库缺失' }
                return composeImagePrompt(lib, { sceneId: params?.sceneId, form: params?.form })
              },
            },
            listAssets: {
              name: 'listAssets',
              verb: 'GET',
              summary: '列出日常底图、CC0 BGM 曲目、ffmpeg/TTS 工具链可用性与历史成片',
              writable: false,
              invoke() {
                const bins = ffmpegAvailable(opts.binDir)
                return {
                  ok: true,
                  images: listDailyImages(),
                  bgmTracks: listBgm(opts.bgmDir),
                  toolchain: {
                    ffmpeg: bins.ffmpeg,
                    ffprobe: bins.ffprobe,
                    ffmpegReady: Boolean(bins.ffmpeg && bins.ffprobe),
                    tts: describeTtsStatus(),
                  },
                  limits: VIDEO_SIZE_LIMITS,
                  drafts: readDraftRecords().reverse(),
                }
              },
            },
            previewTts: {
              name: 'previewTts',
              verb: 'POST',
              summary: '在面板试听指定台词的 TTS 语音',
              writable: true,
              async invoke(params: { text: string; voice?: string }) {
                return await runPreviewTts(params)
              },
            },
            buildVideoDraft: {
              name: 'buildVideoDraft',
              verb: 'POST',
              summary: '一键合成 1080×1920 视频 + 双封面（planOnly=true 只校验不出片），并可送入 B 站待放行队列',
              writable: true,
              async invoke(params: {
                image: string
                text: string
                bgmId?: string
                durationSec?: number
                pushToQueue?: boolean
                planOnly?: boolean
              }) {
                return await runBuildVideoDraft(params)
              },
            },
          },
        },
      ]
    },
  }
}

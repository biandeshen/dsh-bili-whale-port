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
import { choosePortrait, alternatePortrait, SCENE_LABEL } from './portrait.ts'
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

  /**
   * 立绘缩略：原图 1024×1536 有 ~1.8MB，面板刷新一次扛不住。
   *
   * 缩到 **320 宽的 JPEG**：插画转 JPEG 掉得厉害（PNG 420 宽还有 420KB，
   * JPEG 320 宽只要 ~25KB），面板每次刷新几十 KB，够用。
   * 出 **data URL**：宿主没有按路径取文件的路由（`/api/files?path=` 实测 404 裂图），
   * 所以像 cap-vision 的缩略图那样自己出图。
   */
  async function makePortraitThumb(file: string): Promise<{ dataUrl?: string; error?: string }> {
    const mime = /\.png$/i.test(file) ? 'image/png' : 'image/jpeg'
    const readAsDataUrl = (p: string, m: string): string | undefined => {
      try { return `data:${m};base64,${fs.readFileSync(p).toString('base64')}` } catch { return undefined }
    }
    const bins = ffmpegAvailable(opts.binDir)
    if (!bins.ffmpeg) {
      const raw = readAsDataUrl(file, mime)
      return raw ? { dataUrl: raw } : { error: '立读取不出来' }
    }
    const thumbDir = path.join(opts.outputDir, 'thumbs')
    const out = path.join(thumbDir, path.basename(file).replace(/\.[^.]+$/, '') + '.320.jpg')
    try {
      if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(file).mtimeMs) {
        fs.mkdirSync(thumbDir, { recursive: true })
        const { spawn } = await import('node:child_process')
        await new Promise<void>((resolve, reject) => {
          const c = spawn(bins.ffmpeg as string, [
            '-hide_banner', '-loglevel', 'error', '-y', '-i', file,
            '-vf', 'scale=320:-2', '-q:v', '6', out,
          ], { stdio: ['ignore', 'ignore', 'pipe'] })
          let err = ''
          c.stderr.on('data', (d) => { err += String(d) })
          c.on('error', reject)
          c.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(err.slice(-200) || `ffmpeg ${code}`))))
        })
      }
      const url = readAsDataUrl(out, 'image/jpeg')
      return url ? { dataUrl: url } : { error: '缩略图读不出来' }
    } catch (e: any) {
      const raw = readAsDataUrl(file, mime)
      return raw ? { dataUrl: raw } : { error: String(e?.message ?? e) }
    }
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
            /**
             * 她的状态立绘：按此刻的状态挑一张现成的图（不生成新图）。
             *
             * 为什么要有：那 8 张 `daily-*.png` 本来只是视频底图，但每张画的场景都很明确
             * （深夜窗边 / 雨夜听雨 / 闭眼戴耳机 / 缩在被窝里）——**天生就是"她现在的样子"**。
             * 形态那一项里唯一有价值又不引新引擎的活儿，就是把它们按状态接上。
             *
             * 出 **data URL**：宿主没有按路径取文件的路由（`/api/files?path=` 实测 404），
             * 所以像 cap-vision 的缩略图那样自己出图；原图 1024×1536 有 ~1.8MB，
             * 面板刷新一次扛不住，先缩到 420 宽。
             */
            portrait: {
              name: 'portrait',
              verb: 'GET',
              summary: '按她此刻的状态挑一张立绘（现成的图，不生成），顺带给一句人话',
              writable: false,
              invoke: async (params: { rest?: string; energy?: number; stimulation?: number; actionsToday?: number; pick?: 0 | 1 }) => {
                const choice = choosePortrait({
                  rest: params?.rest as 'asleep' | 'resting' | 'awake' | undefined,
                  energy: Number(params?.energy ?? 0.5),
                  stimulation: Number(params?.stimulation ?? 0.3),
                  actionsToday: Number(params?.actionsToday ?? 0),
                }, params?.pick === 1 ? 1 : 0)
                const abs = path.join(opts.assetsDir, choice.file)
                if (!fs.existsSync(abs)) {
                  return { ok: false, error: `立绘不在了：${choice.file}`, scene: choice.scene, caption: choice.caption }
                }
                const thumb = await makePortraitThumb(abs)
                return {
                  ok: true,
                  file: choice.file,
                  scene: choice.scene,
                  sceneLabel: SCENE_LABEL[choice.scene],
                  caption: choice.caption,
                  ...(thumb.dataUrl ? { dataUrl: thumb.dataUrl } : {}),
                  ...(thumb.error ? { thumbError: thumb.error } : {}),
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

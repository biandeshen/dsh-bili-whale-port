/**
 * @xiaoyu/cap-vision —— 视觉能力扩展包（100% 宿主无关）。
 *
 * 她"看画面"这件事的唯一实现：把一段视频压成几张「画面真的变了」的拼图，
 * 判帧/留帧/装箱/出图用 vendor 进来的 dsh-see-now 变化分管道（Apache-2.0，
 * 见 src/vendor/see-now/VENDORED.md），本包只补两件事：
 *   ① 离线读文件（上游的 capture 面向实时屏幕/摄像头，文件这一路得自己起 ffmpeg）；
 *   ② 按片长配平（上游默认是给 15 秒实时窗口标定的，搬到 44 分钟片子上会挤成一坨）。
 *
 * - 模型工具：see_video
 * - 主人操作台 `vision`：getSnapshot / setTuning / listSheets / cleanupSheets
 *
 * 严禁事项（沿用 persona-core 三条铁律）：不 import cortico/*、不 process.exit、
 * 缺依赖给结构化错误而不是抛——找不到 ffmpeg 时 ok:false + 说明，让她能在日记里
 * 说出"今天看不了画面"，而不是整轮崩掉。
 */
import fs from 'node:fs'
import path from 'node:path'
import type {
  XiaoyuCapability, CapabilityHost, CapabilityPanelDecl, JsonSchema, PanelMethodDecl, StorageUnit,
  ToolRegistration,
} from '../../persona-core/src/capability.ts'
import { analyzeVideo, tuneForDuration, type AnalyzeResult, type OfflineOptions } from './frame-pipeline.ts'
import { resolveFfmpeg, type FfmpegResolved } from './ffmpeg.ts'

export { analyzeVideo, tuneForDuration, resolveFfmpeg }
export type { AnalyzeResult, OfflineOptions, FfmpegResolved }

export interface VisionConfig {
  /** 一条片子大约留多少帧（配平的分母）；帧→图由装箱决定，一般 8 帧左右一张 */
  targetFrames: number
  /** 解码采样率（帧/秒） */
  fps: number
  /** 单次最多出几张图（token 硬预算） */
  maxSheets: number
  /** 单次墙钟上限（秒） */
  timeoutSec: number
  /** 拼图留存天数，超期由 cleanupSheets 清 */
  keepDays: number
  /** 去重地板（0–255 变化分）：循环片/雨声片靠它压下来，见 frame-pipeline 的实测注释 */
  dupMin: number
}

export const VISION_DEFAULTS: VisionConfig = {
  targetFrames: 48,
  fps: 2,
  maxSheets: 12,
  timeoutSec: 240,
  keepDays: 14,
  dupMin: 12,
}

export const visionConfigSchema: JsonSchema = {
  type: 'object',
  title: '视觉（看画面）配置',
  description: '变化分管道的预算与留存。默认值按 44 分钟长片实测标定：48 帧 / 6 张图 / 约 1300 token / 57 秒墙钟。',
  properties: {
    targetFrames: { type: 'number', title: '一条片子留多少帧', description: '越大越细，token 越多；按片长摊成节奏', minimum: 8, maximum: 240, 'x-hot': true },
    fps: { type: 'number', title: '解码采样率（帧/秒）', description: '只影响漏检率，不省解码时间（解码要过一遍全片）', minimum: 0.5, maximum: 12 },
    maxSheets: { type: 'number', title: '单次最多几张图', description: '超出即停管道并标 truncated，是 token 硬预算', minimum: 1, maximum: 60 },
    timeoutSec: { type: 'number', title: '单次最多跑多久（秒）', description: '超时 SIGKILL ffmpeg，已出的图照样交', minimum: 10, maximum: 1800 },
    keepDays: { type: 'number', title: '拼图留几天', description: '过期由操作台「清理拼图」删；原始视频不归本包管', minimum: 1, maximum: 365 },
    dupMin: { type: 'number', title: '去重地板（变化分）', description: '与上一张留下的帧差小于它就不留。雨声/自然循环片这类"一直在微动"的素材，8（上游默认）挡不住重复，实测 44 分钟叶子片留了 49 帧几乎同图；12 是能压下来的最低有效值。想要更多画面就调回 8', minimum: 0, maximum: 60, 'x-hot': true },
  },
}

export interface SeeVideoInput {
  /** 本地视频文件路径（B 站视频先由 cap-bilibili 下载，本包不碰网络） */
  file: string
  /** 视频总时长（秒）；给了就按它配平留帧节奏 */
  durationSec?: number
  startSec?: number
  endSec?: number
  targetFrames?: number
  fps?: number
  maxSheets?: number
  timeoutSec?: number
}

export interface RunRecord {
  at: string
  file: string
  ok: boolean
  sheets: number
  kept: number
  frames: number
  ms: number
  truncated: boolean
  truncatedBy?: string
  error?: string
  files: string[]
}

export interface VisionCapabilityOptions {
  /**
   * 本包自己的数据目录（**调用方给哪就用哪，不再自己加一层**）。
   * 2026-11-04 真浏览器实测踩过：这里曾再 join 一个 'vision'，而转接头已经传
   * `<home>/data/vision`，于是面板读的是 `data/vision/vision/`，
   * 跑过的记录与拼图在页面上全都看不见（runs 空、墙空），而 RPC 单测照样绿。
   */
  dataDir: string
  /** 注入 ffmpeg 路径；缺省按 resolveFfmpeg 的顺序找 */
  ffmpegPath?: string
  /** 注入管道替身（测试用，不打 ffmpeg） */
  analyze?: (file: string, opts: OfflineOptions) => Promise<AnalyzeResult>
  /** 注入查找函数（测试用） */
  resolver?: () => FfmpegResolved
  now?: () => Date
}

const VIDEO_EXT = /\.(mp4|m4v|mkv|webm|flv|mov|ts)$/i

export function createVisionCapability(opts: VisionCapabilityOptions): XiaoyuCapability<VisionConfig> {
  const root = opts.dataDir
  const sheetsDir = path.join(root, 'sheets')
  const configFile = path.join(root, 'config.json')
  const runsFile = path.join(root, 'runs.json')
  const now = opts.now ?? (() => new Date())

  function readConfig(): VisionConfig {
    try {
      const j = JSON.parse(fs.readFileSync(configFile, 'utf8'))
      return { ...VISION_DEFAULTS, ...j }
    } catch {
      return { ...VISION_DEFAULTS }
    }
  }
  function writeConfig(patch: Partial<VisionConfig>): VisionConfig {
    const next = { ...readConfig(), ...patch }
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(configFile, JSON.stringify(next, null, 2) + '\n', 'utf8')
    return next
  }
  function readRuns(): RunRecord[] {
    try {
      const list = JSON.parse(fs.readFileSync(runsFile, 'utf8'))
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }
  function pushRun(rec: RunRecord): void {
    const all = [...readRuns(), rec].slice(-40)
    fs.mkdirSync(root, { recursive: true })
    fs.writeFileSync(runsFile, JSON.stringify(all, null, 2) + '\n', 'utf8')
  }

  function ffmpeg(): { path: string | null; source: string; tried: string[] } {
    if (opts.ffmpegPath) return { path: opts.ffmpegPath, source: '注入', tried: [opts.ffmpegPath] }
    return (opts.resolver ?? resolveFfmpeg)()
  }

  function listSheetFiles(): Array<{ file: string; mtime: string; bytes: number; name: string }> {
    if (!fs.existsSync(sheetsDir)) return []
    return fs.readdirSync(sheetsDir)
      .filter((f) => f.endsWith('.png'))
      .map((f) => {
        const p = path.join(sheetsDir, f)
        const st = fs.statSync(p)
        return { file: p, name: f, mtime: st.mtime.toISOString(), bytes: st.size }
      })
      .sort((a, b) => (a.mtime < b.mtime ? 1 : -1))
  }

  /**
   * 缩略图：800x450 的原图直接塞进页面太沉（一张 ~100KB，六张就是 600KB 的一次刷新），
   * 而且**宿主根本没有按路径取文件的路由**——`/api/files?path=` 那种拼法实测 404 裂图，
   * `/api/blob` 只认工作区句柄，把拼图放进工作区又等于把二进制灌进她的记忆 git。
   * 所以这里自己出图：ffmpeg 缩到 320 宽落在 data 下，面板按 data URL 取，用完即走。
   */
  const thumbDir = path.join(sheetsDir, 'thumbs')
  async function makeThumb(file: string): Promise<{ dataUrl?: string; error?: string }> {
    if (!fs.existsSync(file)) return { error: `拼图不在了：${file}` }
    const out = path.join(thumbDir, path.basename(file, '.png') + '.320.png')
    if (!fs.existsSync(out) || fs.statSync(out).mtimeMs < fs.statSync(file).mtimeMs) {
      const ff = ffmpeg()
      if (!ff.path) return { error: '没有 ffmpeg，出不了缩略图' }
      const { spawn } = await import('node:child_process')
      const r = await new Promise<{ code: number | null; err: string }>((resolve) => {
        fs.mkdirSync(thumbDir, { recursive: true })
        const c = spawn(ff.path as string, ['-hide_banner', '-loglevel', 'error', '-y', '-i', file, '-vf', 'scale=320:-2', out], { stdio: ['ignore', 'ignore', 'pipe'] })
        let err = ''
        c.stderr.on('data', (d: Buffer) => { err = `${err}${d}`.slice(-400) })
        c.on('error', (e) => resolve({ code: -1, err: String(e.message) }))
        c.on('close', (code) => resolve({ code, err }))
      })
      if (r.code !== 0 || !fs.existsSync(out)) return { error: `缩略图生成失败：${r.err.slice(0, 160) || `退出码 ${r.code}`}` }
    }
    return { dataUrl: 'data:image/png;base64,' + fs.readFileSync(out).toString('base64') }
  }

  const emptyStats = {
    frames: 0, kept: 0, cuts: 0, marks: 0, floors: 0, dupSkipped: 0, sheets: 0,
    msDecode: 0, msPipeline: 0, scoreMax: 0, scoreAvg: 0, motionPerSec: 0, overflow: 0,
  }
  const cfg0 = readConfig()
  const baseTuning = {
    width: 800, height: 450, fps: cfg0.fps, maxFrames: 12,
    maxWaitSec: 0, integralSeconds: 0, silentFloorSec: 0, dupMin: cfg0.dupMin, durationSec: null,
  }
  const failStub = (file: string, error: string): AnalyzeResult => ({
    ok: false, source: { file, durationSec: null }, tuning: baseTuning,
    stats: emptyStats, sheets: [], dropped: 0, truncated: false, error,
  })

  async function seeVideo(input: SeeVideoInput): Promise<AnalyzeResult> {
    const cfg = readConfig()
    const file = String(input.file ?? '').trim()
    const record = (r: AnalyzeResult): AnalyzeResult => {
      pushRun({
        at: now().toISOString(),
        file,
        ok: r.ok,
        sheets: r.sheets.length,
        kept: r.stats.kept,
        frames: r.stats.frames,
        ms: r.stats.msDecode,
        truncated: r.truncated,
        ...(r.truncatedBy ? { truncatedBy: r.truncatedBy } : {}),
        ...(r.error ? { error: r.error } : {}),
        files: r.sheets.map((s) => s.file ?? '').filter(Boolean),
      })
      return r
    }

    if (!file) return record(failStub(file, '没给 file（本包不碰网络：B 站视频先用 bili_debrief 下载，把本地路径传进来）'))
    if (!fs.existsSync(file)) return record(failStub(file, `文件不存在：${file}`))
    if (!VIDEO_EXT.test(file)) return record(failStub(file, `看着不像视频文件：${path.basename(file)}（支持 mp4/m4v/mkv/webm/flv/mov/ts）`))

    const ff = ffmpeg()
    if (!ff.path) {
      return record(failStub(file, `找不到 ffmpeg。任选：① winget install ffmpeg；② set FFMPEG=D:\\path\\ffmpeg.exe；③ 放进 ~/.dsh/bili-whale/bin/。找过：${ff.tried.join(' | ')}`))
    }

    const impl = opts.analyze ?? analyzeVideo
    const r = await impl(file, {
      ffmpegPath: ff.path,
      durationSec: input.durationSec,
      startSec: input.startSec,
      endSec: input.endSec,
      targetFrames: input.targetFrames ?? cfg.targetFrames,
      fps: input.fps ?? cfg.fps,
      maxSheets: input.maxSheets ?? cfg.maxSheets,
      dupMin: cfg.dupMin,
      timeoutMs: Math.round((input.timeoutSec ?? cfg.timeoutSec) * 1000),
      outDir: sheetsDir,
    })
    return record(r)
  }

  const tools: ToolRegistration<any, any>[] = [
    {
      name: 'see_video',
      summary: '看一段本地视频：只留「画面真的变了」的那几帧，拼成几张图',
      description: [
        '传入本地视频文件路径，返回若干张拼图（每张 800x450，约 216 token）与每帧的时间点。',
        '判据是逐帧 HSV 变化分（切点/积分/兜底三路），不是等间隔抽样——静段少给、动段多给。',
        '本工具不联网：B 站视频先走 bili_debrief（它会下载并顺手调用这里）。',
        '拿到图路径后用 read_image 看；回执里的 stats 会说明"为什么只出了这几张"。',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          file: { type: 'string', description: '本地视频文件路径' },
          durationSec: { type: 'number', description: '视频总时长（秒）；给了就按它摊开留帧节奏，强烈建议给' },
          startSec: { type: 'number', description: '从第几秒开始看（省略=从头）' },
          endSec: { type: 'number', description: '看到第几秒（省略=到结尾）' },
          targetFrames: { type: 'number', description: `想留多少帧（默认 ${VISION_DEFAULTS.targetFrames}，越大越细越贵）` },
        },
        required: ['file'],
      },
      execute: async (args: SeeVideoInput) => {
        const r = await seeVideo(args)
        if (!r.ok) return { ok: false, error: r.error }
        return {
          ok: true,
          images: r.sheets.map((s) => ({ file: s.file, fromSec: s.fromSec, toSec: s.toSec, why: s.why, frames: s.frames })),
          stats: r.stats,
          tuning: r.tuning,
          truncated: r.truncated,
          ...(r.truncatedBy ? { truncatedBy: r.truncatedBy } : {}),
          hint: '用 read_image 逐张看；每张图左上角有帧号，和 frames[].t 对齐',
        }
      },
    },
  ]

  const panelMethods: Record<string, PanelMethodDecl<any, any>> = {
    getSnapshot: {
      name: 'getSnapshot', verb: 'GET', writable: false,
      summary: '看画面能力现状：ffmpeg、配置、最近跑过哪些、拼图占用',
      invoke: () => {
        const ff = ffmpeg()
        const sheets = listSheetFiles()
        const runs = readRuns().slice(-12).reverse()
        return {
          ffmpeg: { available: Boolean(ff.path), path: ff.path, source: ff.source, tried: ff.tried },
          config: readConfig(),
          defaults: VISION_DEFAULTS,
          // newest 的上限要和面板摆的数量一致：曾经这里截 6 张、stat 报 7 张，
          // 看上去就像"少了一张"（2026-11-04 浏览器复验点名过）
          sheets: { count: sheets.length, bytes: sheets.reduce((n, s) => n + s.bytes, 0), dir: sheetsDir, newest: sheets.slice(0, 12) },
          runs,
          vendor: {
            name: 'dsh-see-now 0.0.10', license: 'Apache-2.0',
            note: '判帧/留帧/装箱/出图全部来自它；本包只加离线文件驱动与按片长配平',
          },
        }
      },
    },
    setTuning: {
      name: 'setTuning', verb: 'POST', writable: true,
      summary: '改预算：留多少帧、最多几张、跑多久、拼图留几天',
      invoke: (patch: Partial<VisionConfig>) => {
        const clean: Partial<VisionConfig> = {}
        for (const k of ['targetFrames', 'fps', 'maxSheets', 'timeoutSec', 'keepDays', 'dupMin'] as const) {
          const v = Number((patch ?? {} as VisionConfig)[k])
          if (Number.isFinite(v)) clean[k] = v as any
        }
        if (!Object.keys(clean).length) throw new Error('没带上可识别的字段（targetFrames/fps/maxSheets/timeoutSec/keepDays）')
        return { config: writeConfig(clean), changed: Object.keys(clean) }
      },
    },
    listSheets: {
      name: 'listSheets', verb: 'GET', writable: false,
      summary: '列出已生成的拼图（按时间新→旧）',
      invoke: ({ limit = 40 }: { limit?: number }) => {
        const n = Math.max(1, Math.min(200, Number(limit) || 40))
        return { dir: sheetsDir, items: listSheetFiles().slice(0, n) }
      },
    },
    sheetThumb: {
      name: 'sheetThumb', verb: 'GET', writable: false,
      summary: '取一张拼图的 320 宽缩略图（data URL；宿主没有按路径取文件的路由，只能自己出图）',
      invoke: async ({ file }: { file: string }) => {
        const abs = String(file ?? '')
        // 只允许本包产物目录里的 png：不给面板变成任意文件读取口
        const rel = path.relative(sheetsDir, abs)
        if (!abs || rel.startsWith('..') || path.isAbsolute(rel) || !abs.endsWith('.png')) {
          throw new Error('只认本包 sheets 目录里的 png')
        }
        return makeThumb(abs)
      },
    },
    cleanupSheets: {
      name: 'cleanupSheets', verb: 'POST', writable: true,
      summary: '删掉超过留存期的拼图（只删本包生成的 png，不碰视频）',
      invoke: ({ olderThanDays, confirm = false }: { olderThanDays?: number; confirm?: boolean } = {}) => {
        const cfg = readConfig()
        const days = Number(olderThanDays) > 0 ? Number(olderThanDays) : cfg.keepDays
        if (!confirm) throw new Error('要 confirm:true 才动手删（这是写操作）')
        const cutoff = now().getTime() - days * 86400000
        const doomed = listSheetFiles().filter((s) => new Date(s.mtime).getTime() < cutoff)
        for (const s of doomed) { try { fs.rmSync(s.file) } catch { /* 正在被看就跳过 */ } }
        return { removed: doomed.length, keptDays: days, bytes: doomed.reduce((n, s) => n + s.bytes, 0) }
      },
    },
  }

  const panels: CapabilityPanelDecl[] = [
    {
      id: 'vision',
      title: '看画面',
      description: '变化分管道的预算与产出：一条片子压成几张图、每张覆盖了哪段时间、ffmpeg 在不在。',
      methods: panelMethods,
    },
  ]

  const storageParts: StorageUnit[] = [
    {
      key: 'vision.config', label: '视觉配置', kind: 'disk', location: configFile,
      note: 'targetFrames/fps/maxSheets/timeoutSec/keepDays',
      stat: () => (fs.existsSync(configFile) ? `${fs.statSync(configFile).size} B` : '用默认值'),
    },
    {
      key: 'vision.sheets', label: '拼图产出', kind: 'disk', location: sheetsDir, danger: true,
      note: '只有 png；原始视频不归本包管',
      stat: () => {
        const s = listSheetFiles()
        return `${s.length} 张 / ${(s.reduce((n, x) => n + x.bytes, 0) / 1024).toFixed(0)} KB`
      },
      clear: () => {
        const s = listSheetFiles()
        for (const x of s) { try { fs.rmSync(x.file) } catch { /* 跳过 */ } }
        return `删了 ${s.length} 张`
      },
    },
    {
      key: 'vision.runs', label: '运行记录', kind: 'disk', location: runsFile,
      note: '最近 40 次：成没成、几张图、多久、为什么截断',
      stat: () => `${readRuns().length} 条`,
    },
  ]

  return {
    id: 'cap-vision',
    title: '看画面（变化分管道）',
    kind: 'internal',
    configSchema: visionConfigSchema,
    defaultConfig: { ...VISION_DEFAULTS },
    storageParts: () => storageParts,
    tools: () => tools,
    panels: () => panels,
    async start(host: CapabilityHost) {
      fs.mkdirSync(sheetsDir, { recursive: true })
      const ff = ffmpeg()
      host.log(
        ff.path ? 'info' : 'warn',
        ff.path ? `看画面就绪：ffmpeg @ ${ff.path}（${ff.source}）` : '看画面不可用：找不到 ffmpeg，see_video 会返回结构化错误',
        { tried: ff.tried },
      )
    },
  }
}

export default createVisionCapability

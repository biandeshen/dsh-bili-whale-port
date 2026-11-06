/**
 * 音视频管线对**本机真 ffmpeg** 的一次实跑（默认零成本：不叫模型、不联网、不进她的账）。
 *
 *   node scripts/verify-media-pipeline.mjs [--out <目录>] [--tts auto|mimo|edge|none] [--push]
 *
 * 为什么要这支脚本（2026-11-06 主人："这个音视频工作室有用吗？"）：
 * `media_video_build` / `media_tts_preview` 在代码与单测里都是"有实现"，
 * 但**这台机器上有没有真的出过一条成片**是另一回事——
 * 查遍 `xiaoyu/data/runs/<run>/toolcalls.jsonl`，两个 media 工具**一次都没被她调过**，
 * 而 `data/media` 里只有底图与 BGM，没有一个 mp4。
 * 于是这条脚本用最直白的方式回答："图 + CC0 BGM + 她的 ffmpeg → 成片在不在"。
 *
 * 三条克制：
 *   ① 默认 `tts=none`：MiMo 欠费（HTTP 402），拿不到钱就不该拿音频；
 *      BGM 用仓库里 CC0 曲库，人声这一路整条跳过（管线支持 `tts:'none'`）。
 *   ② 默认输出到临时目录：**不写** `video-drafts.json`，也不进 B 站待放行队列
 *      ——探针不该在她的工作台账里留下我没跟她说过的一笔。
 *      要真进台账得显式 `--push`，那属于"对外发布"，得主人点头。
 *   ③ 失败照实说：ffmpeg 找不到就报错退出，不拿"设计上能用"糊弄。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { renderVideoSlice } from '../packages/cap-media-studio/src/render.ts'
import { defaultMediaBinDir } from '../packages/cortico-world-media/src/cortico-world.ts'
import { deployHome } from '../packages/cap-bilibili/src/platform/paths.mjs'

const argv = process.argv.slice(2)
const flag = (name, dflt) => {
  const i = argv.indexOf(`--${name}`)
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : (argv.includes(`--${name}`) ? true : dflt)
}

const home = deployHome()
const mediaDir = [path.join(home, 'xiaoyu', 'data', 'media'), path.join(home, 'data', 'media')].find((d) => fs.existsSync(d))
const assetsDir = path.join(mediaDir ?? '', 'assets')
const bgmDir = path.join(mediaDir ?? '', 'bgm')
const binDir = defaultMediaBinDir()
const outDir = String(flag('out', path.join(os.tmpdir(), 'xiaoyu-media-check')))
const tts = String(flag('tts', 'none'))

console.log(`ffmpeg 目录：${binDir}（${fs.existsSync(path.join(binDir, 'ffmpeg.exe')) ? '在' : '**不在**'}）`)
console.log(`底图目录：  ${assetsDir}`)
console.log(`BGM 目录：  ${bgmDir}`)
console.log(`输出目录：  ${outDir}（不写她的 video-drafts.json；--push 才进台账，那是要主人点头的对外动作）`)
console.log(`人声：      tts=${tts}${tts === 'none' ? '（MiMo 欠费，跳过人声；成片仍有 BGM 轨）' : ''}\n`)

const images = fs.existsSync(assetsDir)
  ? fs.readdirSync(assetsDir).filter((f) => /daily-.*\.png$/i.test(f)).sort()
  : []
if (!images.length) {
  console.error('没有可用底图（assets 目录空或不存在）——管线无从验证，如实报失败。')
  process.exit(1)
}
const image = path.join(assetsDir, images[0])

const t0 = Date.now()
const r = await renderVideoSlice({
  image,
  text: '这是本机 ffmpeg 管线的自检片段，不是她要发的内容。',
  outDir,
  slug: 'pipeline-check',
  durationSec: 6,
  bgm: 'auto',
  bgmDir,
  binDir,
  tts,
})

if (!r.ok) {
  console.error(`✗ 合成失败：${r.error}`)
  if (r.warnings?.length) console.error('  warnings: ' + r.warnings.join('；'))
  process.exit(1)
}

const files = [r.out, r.cover916File, r.cover169File].filter(Boolean)
console.log(`✓ 成片出来了（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`)
for (const f of files) {
  const st = fs.existsSync(f) ? fs.statSync(f) : null
  console.log(`  ${st ? `${String(Math.round(st.size / 1024)).padStart(6)} KB` : '  (缺) '}`
    + `  ${typeof f === 'string' ? path.basename(f) : JSON.stringify(f)}`)
}
console.log(`  时长 ${r.duration} 秒 · 体积 ${r.sizeMB} MB · BGM ${r.bgm}（音量 ${r.bgmVolume}）· 人声 ${r.ttsProvider ?? 'none'}`)
if (r.warnings?.length) console.log('  warnings: ' + r.warnings.join('；'))
console.log('\n结论口径：这条 mp4 证明「图 + BGM + 本机 ffmpeg」这一段是真的能出片；')
console.log('        人声（MiMo TTS）与"她自己在面板上点合成"这两段仍未验证——前者欠费，后者要 live 跑起来。')

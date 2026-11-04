/**
 * 看画面管道基准（V-Now 取证用，不参与门禁）。
 *
 *   node scripts/bench-vision.mjs --file=D:\\a.mp4 --duration=2669
 *   node scripts/bench-vision.mjs --file=D:\\a.mp4 --duration=2669 --target=64 --out=C:\\tmp\\sheets
 *
 * 为什么单独一个脚本：判帧管道的产出对不对，只有真素材能证明——合成帧测的是
 * "静止不留、硬切必留"这条逻辑，而"44 分钟的片子要几张图、跑多久、覆盖到第几秒"
 * 是产品预算问题，得实测。2026-11-04 那次实测记在 docs/DECOUPLING-STATUS-2026-11-02.md。
 *
 * 只读：不改仓库状态、不联网、不碰 B 站。
 */
import { analyzeVideo } from '../packages/cap-vision/src/frame-pipeline.ts'
import { resolveFfmpeg } from '../packages/cap-vision/src/ffmpeg.ts'

const arg = (k, d = '') => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${k}=`))
  return hit ? hit.slice(k.length + 3) : d
}

const file = arg('file')
if (!file) {
  console.log('用法：node scripts/bench-vision.mjs --file=<视频路径> [--duration=秒] [--target=帧数] [--out=目录]')
  process.exit(2)
}
const ff = resolveFfmpeg({ repoBinDir: new URL('../bin', import.meta.url).pathname.replace(/^\//, '') })
if (!ff.path) {
  console.error('找不到 ffmpeg，找过：\n  ' + ff.tried.join('\n  '))
  process.exit(3)
}
const durationSec = Number(arg('duration')) || undefined
const outDir = arg('out') || undefined

const t = Date.now()
const r = await analyzeVideo(file, {
  ffmpegPath: ff.path,
  durationSec,
  targetFrames: Number(arg('target')) || undefined,
  timeoutMs: 300000,
  outDir,
})

console.log(`ffmpeg  ${ff.path}  （${ff.source}）`)
console.log(`ok      ${r.ok}${r.error ? ' | ' + r.error : ''}`)
console.log(`墙钟    ${((Date.now() - t) / 1000).toFixed(1)} s   解码 ${r.stats.frames} 帧`)
console.log(`留帧    ${r.stats.kept}（切点 ${r.stats.cuts} / 积分 ${r.stats.marks} / 兜底 ${r.stats.floors} / 去重丢 ${r.stats.dupSkipped}）`)
console.log(`出图    ${r.stats.sheets} 张${outDir ? ' → ' + outDir : '（未落盘）'}  token 估 ${r.stats.sheets * 216}`)
console.log(`变化分  均 ${r.stats.scoreAvg} / 峰 ${r.stats.scoreMax}（REF_SCORE=4 是"中等强度"）`)
if (r.truncated) console.log(`截断    ${r.truncatedBy}`)
console.log(`配平    integral=${r.tuning.integralSeconds}s floor=${r.tuning.silentFloorSec}s wait=${r.tuning.maxWaitSec}s`)
for (const s of r.sheets) {
  console.log(`  #${String(s.index).padStart(2)} ${String(s.fromSec).padStart(7)}→${String(s.toSec).padStart(8)}s  why=${s.why.padEnd(5)} ${String(s.frames.length).padStart(2)} 帧  ${s.file ?? ''}`)
}

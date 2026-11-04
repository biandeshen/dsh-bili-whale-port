import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeFrames, analyzeVideo, tuneForDuration, DEFAULTS, REF_SCORE } from '../src/frame-pipeline.ts'

/**
 * 合成帧：三段静止 + 两次硬切。不碰 ffmpeg，只验"变化分管道"本身。
 * 静止段里逐帧差为 0 → 不该留帧；硬切处 HSV 逐格差远超 cutAbs=12 → 必须留。
 */
const W = 160
const H = 90
const solid = (r, g, b) => Buffer.alloc(W * H * 3, Buffer.from([r, g, b]))
// 10x10 棋盘：与纯色之间是"整幅换画面"级别的差
const checker = (a, b) => {
  const buf = Buffer.alloc(W * H * 3)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const c = (Math.floor(x / 10) + Math.floor(y / 10)) % 2 === 0 ? a : b
      const o = (y * W + x) * 3
      buf[o] = c[0]; buf[o + 1] = c[1]; buf[o + 2] = c[2]
    }
  }
  return buf
}

const A = solid(20, 30, 40)
const B = checker([250, 240, 30], [10, 200, 220])
const C = checker([200, 20, 160], [30, 120, 20])

test('变化分管道：静止不留帧、硬切必留、拼成 PNG', () => {
  // fps=2 → 每帧隔 0.5s；0..9 纯色 A，10..19 棋盘 B，20..29 棋盘 C
  const frames = []
  for (let i = 0; i < 30; i++) frames.push(i < 10 ? A : i < 20 ? B : C)
  const { sheets } = analyzeFrames(30, (i) => frames[i], { width: W, height: H, fps: 2, maxFrames: 12, maxWaitSec: 120 })

  assert.ok(sheets.length >= 1, '至少出一张')
  const all = sheets.flatMap((s) => s.frames)
  const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  assert.ok(sheets.every((s) => s.png.subarray(0, 8).equals(PNG_MAGIC)), '每张都是合法 PNG')

  // 两个切点在 5.0s 和 10.0s
  const ts = all.map((f) => f.t)
  assert.ok(ts.some((t) => Math.abs(t - 5) < 0.6), `5s 附近的硬切要被留住，实得 ${JSON.stringify(ts)}`)
  assert.ok(ts.some((t) => Math.abs(t - 10) < 0.6), `10s 附近的硬切要被留住，实得 ${JSON.stringify(ts)}`)
  // 静止段（0..4.5s 那一整段同色）不该各留一帧：留帧数应远小于总帧数
  assert.ok(all.length <= 6, `30 帧里同画面只该留个位数，实得 ${all.length}`)
  // 每张图的帧都落在它声明的时间窗内
  for (const s of sheets) {
    for (const f of s.frames) {
      assert.ok(f.t >= s.fromSec - 1e-6 && f.t <= s.toSec + 1e-6, '帧时间在窗内')
    }
  }
})

test('变化分打分口径与上游一致（cutAbs/REF_SCORE 没被我改掉）', () => {
  assert.equal(DEFAULTS.cutAbs, 12, '默认切点地板是上游标定值 12（不是 storyboard 的 25，也不是 pace dense 的 7）')
  assert.equal(REF_SCORE, 4, '中等强度 4 分/帧')
  assert.equal(DEFAULTS.queueDepth, 1, '上游默认实时队列 1——我在离线侧显式覆盖成 0')
})

test('analyzeVideo 缺 ffmpeg / 文件不存在都给结构化错误，不抛不 exit', async () => {
  const r1 = await analyzeVideo('whatever.mp4')
  assert.equal(r1.ok, false)
  assert.match(r1.error, /没给 ffmpegPath/)

  const r2 = await analyzeVideo('不存在的文件.mp4', { ffmpegPath: 'ffmpeg' })
  assert.equal(r2.ok, false)
  assert.match(r2.error, /视频文件不存在/)
})

test('按片长配平：只往稀调不往密调，长片铺得开、短片不炸图', () => {  // 没给片长 → 不配平（沿用上游默认，由调用方决定）
  assert.deepEqual(tuneForDuration(null), {})
  assert.deepEqual(tuneForDuration(0), {})

  // 44 分钟：cadence = 2669/48 ≈ 55.6 秒留一帧
  const long = tuneForDuration(2669)
  assert.equal(long.integralSeconds, 55.6)
  assert.equal(long.silentFloorSec, 83.41)
  assert.equal(long.maxWaitSec, 444.83)

  // 64 秒短片：cadence 只有 1.33 秒，比上游默认还密——必须被夹回默认值，
  // 否则一条短片摊成 9 张图 ≈ 1900 token（实测过，这就是砍掉它的理由）
  const short = tuneForDuration(64)
  assert.equal(short.integralSeconds, DEFAULTS.integralSeconds, '不许比上游默认更密')
  assert.equal(short.silentFloorSec, DEFAULTS.silentFloorSec, '兜底同理')
  assert.ok(short.maxWaitSec >= 30 && short.maxWaitSec <= 900, '单张时间窗夹在 30 秒～15 分钟')

  // 单调：片长越长，留帧节奏只会更松
  const a = tuneForDuration(300)
  const b = tuneForDuration(3600)
  assert.ok(b.integralSeconds > a.integralSeconds, `${a.integralSeconds} → ${b.integralSeconds}`)
})

test('去重地板挡住"一直在微动"的循环片：dupMin 12 比 8 留得少', () => {
  // 合成"雨声循环片"的形状：每帧整体亮度只差 10 分（够积分进账，不够算换画面）
  const dim = solid(30, 40, 50)
  const lit = solid(40, 50, 60)
  const loop = (i) => (i % 2 === 0 ? dim : lit)

  const loose = analyzeFrames(60, loop, { width: W, height: H, fps: 2, dupMin: 8 })
  const tight = analyzeFrames(60, loop, { width: W, height: H, fps: 2, dupMin: 12 })

  assert.ok(loose.stats.kept > 1, `地板 8（上游默认）挡不住 10 分的微动，留了 ${loose.stats.kept} 帧`)
  assert.ok(tight.stats.kept < loose.stats.kept, `地板 12 要更少：${tight.stats.kept} < ${loose.stats.kept}`)
  assert.ok(tight.stats.dupSkipped >= loose.stats.dupSkipped, '被挡掉的都记在 dupSkipped 里，不能静默消失')
  // 离线默认必须是 12，不是上游那个 8
  const dflt = analyzeFrames(60, loop, { width: W, height: H, fps: 2 })
  assert.equal(dflt.stats.kept, tight.stats.kept, '不传 dupMin 时走本包的离线默认 12')
})

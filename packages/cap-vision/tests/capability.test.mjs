import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createVisionCapability, VISION_DEFAULTS } from '../src/index.ts'
import { validateCapabilityContract } from '../../persona-core/src/capability.ts'
import { resolveFfmpeg } from '../src/ffmpeg.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'cap-vision-'))

/** 造一条"看着像视频"的文件（内容无所谓，本测试注入 analyze 替身，不碰 ffmpeg） */
function fakeVideo(dir, name = 'a.mp4') {
  const p = path.join(dir, name)
  fs.writeFileSync(p, Buffer.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70]))
  return p
}

const okResult = (file) => ({
  ok: true,
  source: { file, durationSec: 120 },
  tuning: { width: 800, height: 450, fps: 2, maxFrames: 12, maxWaitSec: 20, integralSeconds: 2.5, silentFloorSec: 3.75, durationSec: 120 },
  stats: { frames: 240, kept: 9, cuts: 1, marks: 8, floors: 0, dupSkipped: 3, sheets: 1, msDecode: 900, msPipeline: 40, scoreMax: 30, scoreAvg: 5, motionPerSec: 10, overflow: 0 },
  sheets: [{ index: 1, fromSec: 0, toSec: 118, why: 'end', frames: [{ t: 0, tier: 3, level: 2, via: 'start' }], w: 800, h: 450, png: new Uint8Array([1, 2, 3]), file: path.join(path.dirname(file), 'sheets', 'x.png') }],
  dropped: 0,
  truncated: false,
})

test('cap-vision 满足能力包四件套契约（工具 + 可写面板）', () => {
  const cap = createVisionCapability({ dataDir: tmp(), ffmpegPath: 'ffmpeg' })
  const v = validateCapabilityContract(cap)
  assert.equal(v.ok, true, v.errors.join('; '))
  assert.equal(cap.id, 'cap-vision')
  assert.ok(cap.tools().some((t) => t.name === 'see_video'))
  const panel = cap.panels().find((p) => p.id === 'vision')
  assert.ok(panel.methods.setTuning.writable === true && panel.methods.setTuning.verb === 'POST', '必须真有可写操作台，不许只读黑盒')
})

test('see_video 把配置预算传给管道，并落运行记录', async () => {
  const dir = tmp()
  const file = fakeVideo(dir)
  const seen = []
  const cap = createVisionCapability({
    dataDir: dir,
    ffmpegPath: 'C:/fake/ffmpeg.exe',
    analyze: async (f, o) => { seen.push(o); return okResult(f) },
  })
  await cap.panels()[0].methods.setTuning.invoke({ targetFrames: 24, maxSheets: 3 })
  const tool = cap.tools().find((t) => t.name === 'see_video')
  const r = await tool.execute({ file, durationSec: 120 })
  assert.equal(r.ok, true)
  assert.equal(seen[0].targetFrames, 24, '面板改的预算要真的进到管道参数')
  assert.equal(seen[0].maxSheets, 3)
  assert.equal(seen[0].timeoutMs, 240000, 'timeoutSec 换算成 ms')
  assert.equal(seen[0].outDir, path.join(dir, 'sheets'), '产物落在本包自己的子目录')
  assert.equal(r.images[0].fromSec, 0)
  const runs = JSON.parse(fs.readFileSync(path.join(dir, 'runs.json'), 'utf8'))
  assert.equal(runs.length, 1)
  assert.equal(runs[0].kept, 9)
})

test('缺 ffmpeg / 文件不存在 / 不是视频都返回结构化错误，不抛不 exit', async () => {
  const dir = tmp()
  const tool = createVisionCapability({
    dataDir: dir,
    resolver: () => ({ path: null, source: '未找到', tried: ['C:/x/ffmpeg.exe'] }),
    analyze: async (f) => okResult(f),
  }).tools().find((t) => t.name === 'see_video')

  const r1 = await tool.execute({ file: '' })
  assert.equal(r1.ok, false)
  assert.match(r1.error, /没给 file/)

  const r2 = await tool.execute({ file: path.join(dir, '没有这个.mp4') })
  assert.equal(r2.ok, false)
  assert.match(r2.error, /文件不存在/)

  const txt = path.join(dir, 'a.txt')
  fs.writeFileSync(txt, 'hi')
  const r3 = await tool.execute({ file: txt })
  assert.equal(r3.ok, false)
  assert.match(r3.error, /不像视频/)

  const r4 = await tool.execute({ file: fakeVideo(dir) })
  assert.equal(r4.ok, false)
  assert.match(r4.error, /找不到 ffmpeg/)
  assert.match(r4.error, /C:\/x\/ffmpeg.exe/, '要把找过哪儿说清楚')
})

test('cleanupSheets 不 confirm 就拒绝，只删超期的 png', () => {
  const dir = tmp()
  const cap = createVisionCapability({ dataDir: dir, ffmpegPath: 'ffmpeg', now: () => new Date('2026-11-04T12:00:00Z') })
  const sheets = path.join(dir, 'sheets')
  fs.mkdirSync(sheets, { recursive: true })
  const old = path.join(sheets, 'old.png')
  const fresh = path.join(sheets, 'fresh.png')
  fs.writeFileSync(old, 'x')
  fs.writeFileSync(fresh, 'y')
  const past = (Date.parse('2026-11-04T12:00:00Z') - 40 * 86400000) / 1000
  fs.utimesSync(old, past, past)

  assert.throws(() => cap.panels()[0].methods.cleanupSheets.invoke({ olderThanDays: 14 }), /confirm/)
  const r = cap.panels()[0].methods.cleanupSheets.invoke({ olderThanDays: 14, confirm: true })
  assert.equal(r.removed, 1)
  assert.equal(fs.existsSync(old), false)
  assert.equal(fs.existsSync(fresh), true, '没超期的不许动')
})

test('setTuning 只收白名单字段，坏值不落盘', () => {
  const dir = tmp()
  const cap = createVisionCapability({ dataDir: dir, ffmpegPath: 'ffmpeg' })
  const r = cap.panels()[0].methods.setTuning.invoke({ targetFrames: 30, evil: 'x' })
  assert.deepEqual(r.changed, ['targetFrames'])
  assert.equal(cap.panels()[0].methods.getSnapshot.invoke({}).config.targetFrames, 30)
  assert.throws(() => cap.panels()[0].methods.setTuning.invoke({ nothing: 1 }), /可识别的字段/)
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, 'config.json'), 'utf8'))
  assert.equal(cfg.evil, undefined, '面板不是任意键写盘的口子')
  assert.equal(cfg.keepDays, VISION_DEFAULTS.keepDays, '没改的字段保持默认')
})

test('面板读的就是工具写的那一处：目录不许双重嵌套；缩略图只认本包产物', async () => {
  // 2026-11-04 真浏览器实测：转接头传 <home>/data/vision，包内又加一层 'vision'，
  // 于是 see_video 写的 runs/sheets 落在 data/vision/，面板却去读 data/vision/vision/，
  // 页面上"最近看过什么"和"拼图墙"永远是空的——而单测全绿（因为单测两边都用同一个 dir）。
  // 这条测试故意让 dataDir 与断言分离：跑一次工具，再看面板 getSnapshot 能不能看见。
  const dir = tmp()
  const file = fakeVideo(dir)
  const cap = createVisionCapability({
    dataDir: path.join(dir, 'data', 'vision'),
    ffmpegPath: 'C:/fake/ffmpeg.exe',
    analyze: async (f) => okResult(f),
  })
  await cap.tools()[0].execute({ file, durationSec: 120 })
  const snap = cap.panels()[0].methods.getSnapshot.invoke({})
  assert.equal(snap.runs.length, 1, '运行记录要与工具写盘的同一处')
  assert.equal(snap.sheets.dir, path.join(dir, 'data', 'vision', 'sheets'), '不许再套一层 vision')

  // 缩略图不能变成任意文件读取口
  const thumb = cap.panels()[0].methods.sheetThumb
  await assert.rejects(() => Promise.resolve(thumb.invoke({ file: 'C:/Windows/win.ini' })), /只认本包/)
  await assert.rejects(() => Promise.resolve(thumb.invoke({ file: path.join(dir, 'elsewhere.png') })), /只认本包/)
  await assert.rejects(() => Promise.resolve(thumb.invoke({ file: path.join(snap.sheets.dir, '..', '..', '..', 'secret.png') })), /只认本包/)
})

test('resolveFfmpeg 顺序：env 优先，其次 PATH，再 repo/bin，再 ~/.dsh/bili-whale/bin，最后剪映', () => {
  const EXE = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const PROFILE = process.env.USERPROFILE || os.homedir()
  const p = (...s) => path.join(...s).replace(/\\/g, '/')
  const PATH_EXE = p('/p', EXE)
  const REPO_EXE = p('/repo/bin', EXE)
  const HOME_EXE = p(PROFILE, '.dsh', 'bili-whale', 'bin', EXE)
  const LOCAL = process.env.LOCALAPPDATA || path.join(PROFILE, 'AppData', 'Local')
  const JY_BASE = p(LOCAL, 'JianyingPro', 'Apps')
  const JY_EXE = p(JY_BASE, '7.5', EXE)

  const run = (have, o = {}) => resolveFfmpeg({
    env: { PATH: '/p', LOCALAPPDATA: LOCAL.replace(/\\/g, '/'), ...(o.env || {}) },
    platform: process.platform,
    homedir: PROFILE,
    repoBinDir: o.repoBinDir,
    exists: (x) => have.includes(String(x).replace(/\\/g, '/')),
    readdir: (x) => (String(x).replace(/\\/g, '/') === JY_BASE ? (o.jianying ?? []) : []),
  })

  assert.equal(run([]).path, null, '一处都没有 → null（不抛、不 exit）')
  assert.equal(run(['/w/ffmpeg', PATH_EXE], { env: { FFMPEG: '/w/ffmpeg' } }).path, '/w/ffmpeg', '$FFMPEG 优先')
  assert.equal(run([PATH_EXE]).source, 'PATH')
  assert.equal(run([REPO_EXE, PATH_EXE], { repoBinDir: '/repo/bin' }).source, 'PATH', 'PATH 排在 repo/bin 前面')
  assert.equal(run([REPO_EXE], { repoBinDir: '/repo/bin' }).source, 'repo/bin')
  assert.equal(run([HOME_EXE]).source, '~/.dsh/bili-whale/bin')
  assert.equal(run([JY_EXE], { jianying: ['7.5'] }).source, '剪映')
  assert.ok(run([]).tried.length >= 2, '没找到时 tried 要能说明找过哪儿')
})

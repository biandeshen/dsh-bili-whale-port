import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateCapabilityContract } from '../../persona-core/src/capability.ts'
import { createMediaWorldAdapter } from '../../cortico-world-media/src/index.ts'
import { renderVideoSlice, VIDEO_SIZE_LIMITS } from '../src/render.ts'

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const BGM_DIR = path.join(REPO_ROOT, 'assets', 'bgm')
const DAILY_ASSETS = 'D:/AI/养鱼/assets/daily'
const LOCAL_BIN = path.join(os.homedir(), '.dsh', 'bili-whale', 'bin')

function realToolchainAvailable() {
  let image = null
  if (fs.existsSync(DAILY_ASSETS)) {
    const pngs = fs.readdirSync(DAILY_ASSETS).filter((f) => f.endsWith('.png'))
    // 优先用竖版日常立绘，退回任意 png（contact-sheet.png 是横版拼图，不是她的日常底图）
    image = pngs.find((f) => f.startsWith('daily-')) ?? pngs[0] ?? null
    if (image) image = path.join(DAILY_ASSETS, image)
  }
  return {
    image,
    ffmpeg: fs.existsSync(path.join(LOCAL_BIN, 'ffmpeg.exe')),
    ffprobe: fs.existsSync(path.join(LOCAL_BIN, 'ffprobe.exe')),
    bgm: fs.existsSync(path.join(BGM_DIR, 'quiet-room.mp3')),
  }
}

test('cap-media-studio：契约校验、面板方法与推送队列接线（注入替身，离线确定性）', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-media-fake-'))
  const assetsDir = path.join(dir, 'assets')
  const outputDir = path.join(dir, 'output')
  fs.mkdirSync(assetsDir, { recursive: true })
  fs.writeFileSync(path.join(assetsDir, 'daily-04-goodnight-a.png'), 'PNG', 'utf8')

  const pushed = []
  const world = createMediaWorldAdapter({
    assetsDir,
    bgmDir: BGM_DIR,
    outputDir,
    renderPipeline: async (input) => ({
      ok: true,
      planOnly: false,
      out: path.join(input.outDir, 'video.mp4'),
      cover916File: path.join(input.outDir, 'video-cover.png'),
      cover169File: path.join(input.outDir, 'video-cover-169.png'),
      duration: input.durationSec,
      sizeMB: 0.42,
      ttsProvider: null,
      voice: null,
      voiceSeconds: null,
      bgm: 'quiet-room.mp3',
      bgmVolume: 0.14,
      coverBytes: 1024,
      cover169Bytes: 1024,
      warnings: [],
    }),
    onPushToBiliQueue: (draft) => {
      pushed.push(draft)
      return { ok: true, pendingId: 'q-vid-1' }
    },
  })

  assert.equal(world.id, 'media-studio')
  assert.equal(world.api, 6)
  assert.equal(validateCapabilityContract(world.capability).ok, true)
  assert.equal(world.panels().length, 1)
  assert.equal(world.tools().length, 2)

  // listAssets 读到真实 CC0 曲库（按 catalog.json 声明顺序，不是文件名字母序）与本地底图
  const assets = await world.invokePanel('media-studio', 'listAssets', {})
  assert.equal(assets.ok, true)
  assert.deepEqual(assets.bgmTracks, ['bedroom-window-outlands.mp3', 'quiet-room.mp3', 'colder-air.mp3'])
  assert.ok(assets.images.includes('daily-04-goodnight-a.png'))
  assert.equal(assets.toolchain.tts.mimoKey === 'missing' || assets.toolchain.tts.mimoKey.startsWith('loaded'), true)

  // 底图不存在 → 明确报错，不静默出片
  const badImage = await world.invokePanel('media-studio', 'buildVideoDraft', { image: 'nope.png', text: '测试' })
  assert.equal(badImage.ok, false)
  assert.match(badImage.error, /找不到底图/)

  // 台词为空 → 拒绝
  const emptyText = await world.invokePanel('media-studio', 'buildVideoDraft', { image: 'daily-04-goodnight-a.png', text: '   ' })
  assert.equal(emptyText.ok, false)

  // 正常路径 + 推入 B 站待放行队列
  const built = await world.invokePanel('media-studio', 'buildVideoDraft', {
    image: 'daily-04-goodnight-a.png',
    text: '今晚听雨。\n三十九分钟，没有人说话。\n晚安。',
    bgmId: 'quiet-room',
    durationSec: 20,
    pushToQueue: true,
  })
  assert.equal(built.ok, true)
  assert.equal(built.draft.pushedToQueue, true)
  assert.equal(built.draft.pendingId, 'q-vid-1')
  assert.equal(pushed.length, 1)
  assert.equal(built.draft.bgm, 'quiet-room.mp3')

  // BGM 名字写错 → 把可用清单报出来，而不是静默无配乐
  const badBgm = await world.invokePanel('media-studio', 'buildVideoDraft', {
    image: 'daily-04-goodnight-a.png',
    text: '测试',
    bgmId: 'not-exist-track',
  })
  assert.equal(badBgm.ok, false)
  assert.match(badBgm.error, /找不到 BGM/)
})

test('cap-media-studio：真实 ffmpeg 合成 3 秒成片 + 9:16/16:9 双封面（离线，不用 TTS 凭据）', async (t) => {
  const tc = realToolchainAvailable()
  if (!tc.image || !tc.ffmpeg || !tc.ffprobe || !tc.bgm) {
    t.skip(`真实工具链缺失（image=${Boolean(tc.image)} ffmpeg=${tc.ffmpeg} ffprobe=${tc.ffprobe} bgm=${tc.bgm}）`)
    return
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-media-real-'))
  const res = await renderVideoSlice({
    image: tc.image,
    text: '今晚听雨。\n三十九分钟，没有人说话。',
    outDir,
    slug: 'real-smoke',
    durationSec: VIDEO_SIZE_LIMITS.minDuration,
    tts: 'none',
    bgm: 'quiet-room',
    bgmDir: BGM_DIR,
    binDir: LOCAL_BIN,
  })

  assert.equal(res.ok, true, `真实合成失败: ${res.error}`)
  assert.equal(res.planOnly, false)
  assert.ok(res.out && fs.existsSync(res.out), '成片 mp4 不存在')
  const mp4Bytes = fs.statSync(res.out).size
  assert.ok(mp4Bytes > 50_000, `成片只有 ${mp4Bytes} 字节，不像真视频`)

  // 双封面必须是真 PNG（校验魔数，不看扩展名）
  for (const cover of [res.cover916File, res.cover169File]) {
    assert.ok(cover && fs.existsSync(cover), `封面缺失: ${cover}`)
    const head = fs.readFileSync(cover).subarray(0, 8)
    assert.deepEqual([...head], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], '封面不是真 PNG')
  }
  assert.equal(res.bgm, 'quiet-room.mp3')
  assert.equal(res.ttsProvider, null)

  // 我方中间产物必须清干净（.base.mp4 / .base169.mp4 / .voice.mp3）；
  // vendor 的 .vstudio-tmp 目录由 dsh-video-studio 自建自清（vendor 冻结不改），只要求它为空
  const myLeftovers = fs
    .readdirSync(outDir)
    .filter((f) => /\.(base|base169|voice)\.mp[34]$/.test(f) || f.startsWith('.'))
    .filter((f) => f !== '.vstudio-tmp')
  assert.deepEqual(myLeftovers, [], `留下我方中间文件: ${myLeftovers.join(', ')}`)
  const vendorTmp = path.join(outDir, '.vstudio-tmp')
  if (fs.existsSync(vendorTmp)) {
    assert.deepEqual(fs.readdirSync(vendorTmp), [], 'vendor 临时目录未清空')
  }
})

test('cap-media-studio：planOnly 只校验 spec 不出成片（对应旧 --plan 门禁）', async (t) => {
  const tc = realToolchainAvailable()
  if (!tc.image || !tc.ffmpeg || !tc.ffprobe) {
    t.skip('真实工具链缺失')
    return
  }
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-media-plan-'))
  const res = await renderVideoSlice({
    image: tc.image,
    text: '只校验不出片。',
    outDir,
    slug: 'plan-smoke',
    durationSec: 3,
    tts: 'none',
    bgm: 'none',
    binDir: LOCAL_BIN,
    planOnly: true,
  })
  assert.equal(res.ok, true, `plan 校验失败: ${res.error}`)
  assert.equal(res.planOnly, true)
  assert.equal(res.out, null)
  assert.equal(fs.existsSync(path.join(outDir, 'plan-smoke.mp4')), false)
})

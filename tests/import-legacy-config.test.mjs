// 旧共享配置迁移器（2026-11-06 主人："原本的 B 站配置全部都没迁移过来"）。
// 钉四件事：①默认只报告，一个字节都不写；②--go 才落地且先留 .bak（原件可退）；
// ③只填"部署侧还是代码默认"的空位，人改过的值绝不覆盖；④跑第二遍是幂等的（不再产生新备份）。
// spawn 真子进程 + 真临时目录，不是函数级假动作。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { DEFAULT_WATCH_PREFS } from '../packages/cap-bilibili/src/client/inbox.ts'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPT = path.join(ROOT, 'scripts', 'import-legacy-config.mjs')

const LEGACY = {
  owner: { mid: '233643544', name: '主人', displayName: '鱼片' },
  self: { mid: '497080562', name: '恐怖深海鱼' },
  risk: { writeGapSec: 120, minGapMs: 1500 },
  quota: { shareDaily: 3 },
  permissions: { like: 'self', fav: 'self', dmReply: 'direct', comment: 'self', danmaku: 'self' },
  publish: { draftMode: 'auto', autoDailyCap: 0, autoWindow: '' },
  preferences: {
    like: ['助眠/ASMR', '白噪音/雨声', '轻音乐'],
    dislike: ['带货', '标题党', '引导冥想'],
    keywords: ['助眠', '雨声'],
    judgments: [],
  },
  listen: { comment: false, commentIntervalSec: 60, dm: true, dmIntervalSec: 150, scope: 'both', allDay: false },
  notify: { type: 'none', url: '' },
}

function setup(t, over = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'legacy-import-'))
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  const whale = path.join(home, '.dsh')
  const deploy = path.join(home, '.xiaoyu-home')
  const bili = path.join(deploy, 'xiaoyu', 'data', 'bilibili')
  fs.mkdirSync(whale, { recursive: true })
  fs.mkdirSync(bili, { recursive: true })
  const legacyFile = path.join(whale, 'bili-whale.config.json')
  fs.writeFileSync(legacyFile, JSON.stringify(over.legacy ?? LEGACY, null, 2), 'utf8')
  const cfgFile = path.join(deploy, 'xiaoyu', 'config.json')
  fs.writeFileSync(cfgFile, JSON.stringify({
    displayName: '小鱼',
    worlds: { 'bili-account': { enabled: true }, console: { enabled: true } },
  }, null, 2), 'utf8')
  const prefsFile = path.join(bili, 'watch-prefs.json')
  fs.writeFileSync(prefsFile, JSON.stringify(over.prefs ?? { ...DEFAULT_WATCH_PREFS, exemptUps: [] }, null, 2), 'utf8')
  const trafficFile = path.join(bili, 'traffic-state.json')
  fs.writeFileSync(trafficFile, JSON.stringify(
    over.traffic ?? { writeGapSec: 10, pausedUntil: 0, lastWriteAt: 0, seenFingerprints: [] }, null, 2), 'utf8')
  const policyFile = path.join(bili, 'policy.json')
  fs.writeFileSync(policyFile, JSON.stringify({
    draftMode: 'auto', autoDailyCap: 0, autoWindow: '00:00-24:00',
    like: 'self', fav: 'self', dmReply: 'direct', comment: 'self', danmaku: 'self',
  }, null, 2), 'utf8')
  const env = { ...process.env, BILI_WHALE_CONFIG: legacyFile, CORTICO_HOME: deploy }
  const run = (...args) => spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: 'utf8' })
  const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'))
  return { home, legacyFile, cfgFile, prefsFile, trafficFile, policyFile, env, run, read }
}

test('默认只报告：一个字节都不写', (t) => {
  const s = setup(t)
  const before = ['cfgFile', 'prefsFile', 'trafficFile'].map((k) => fs.readFileSync(s[k], 'utf8'))
  const r = s.run()
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, /只报告，未写入/)
  assert.match(r.stdout, /writeGapSec/)
  const after = ['cfgFile', 'prefsFile', 'trafficFile'].map((k) => fs.readFileSync(s[k], 'utf8'))
  assert.deepEqual(after, before, 'dry-run 不该动任何文件')
  assert.equal(fs.readdirSync(path.dirname(s.trafficFile)).filter((f) => f.includes('.bak-legacy-')).length, 0,
    'dry-run 不该留备份')
})

test('--go 迁的是她的值，且原件先留一份可退', (t) => {
  const s = setup(t)
  const r = s.run('--go')
  assert.equal(r.status, 0, r.stderr)
  const cfg = s.read(s.cfgFile)
  assert.equal(cfg.worlds['bili-account'].identity.ownerMid, '233643544', '主人是谁要落到部署配置')
  assert.equal(cfg.worlds['bili-account'].identity.selfMid, '497080562', '她自己是谁要落到部署配置')
  assert.deepEqual(cfg.worlds['bili-account'].listen, {
    comment: false, commentIntervalSec: 60, dm: true, dmIntervalSec: 150, scope: 'both', allDay: false,
  }, '监听按旧值写（comment 旧值 false 不替她打开，只列进「对不上」）')
  assert.match(r.stdout, /=== 对不上（2）/, 'comment 与 allDay 两处语义变了，必须摆在待拍板区')

  assert.equal(s.read(s.trafficFile).writeGapSec, 120, '写冷却回到她实际跑过的 120 秒')
  const prefs = s.read(s.prefsFile)
  assert.deepEqual(prefs.like, LEGACY.preferences.like, '看片偏好是她攒的那几组，不是代码里我编的')
  assert.deepEqual(prefs.keywords, LEGACY.preferences.keywords)
  assert.deepEqual(prefs.dislike, LEGACY.preferences.dislike, '旧屏蔽表整表进来')
  // 原件可退：三个被改的文件都该有 .bak
  for (const f of [s.cfgFile, s.prefsFile, s.trafficFile]) {
    const baks = fs.readdirSync(path.dirname(f)).filter((x) => x.startsWith(path.basename(f) + '.bak-legacy-'))
    assert.equal(baks.length, 1, `${path.basename(f)} 要留一份备份`)
    assert.notEqual(fs.readFileSync(path.join(path.dirname(f), baks[0]), 'utf8'), fs.readFileSync(f, 'utf8'))
  }
})

test('人改过的值不覆盖：只填空位与"仍是代码默认"的位置', (t) => {
  const s = setup(t, {
    prefs: { like: ['她后来自己加的'], dislike: ['人工词'], keywords: ['人工词'], exemptUps: ['UP1'], minDurationSec: 600 },
    traffic: { writeGapSec: 45, pausedUntil: 0, lastWriteAt: 0, seenFingerprints: [] },
  })
  const r = s.run('--go')
  assert.equal(r.status, 0, r.stderr)
  const prefs = s.read(s.prefsFile)
  assert.deepEqual(prefs.like, ['她后来自己加的'], '面板改过的 like 一个字都不动')
  assert.deepEqual(prefs.keywords, ['人工词'], '面板改过的 keywords 不动')
  assert.deepEqual(prefs.dislike, [...LEGACY.preferences.dislike, '人工词'], 'dislike 取并集：她攒的 + 人工加的，一条不丢')
  assert.deepEqual(s.read(s.trafficFile).writeGapSec, 45, '人把冷却改成 45 秒就保留 45')
  assert.equal(s.read(s.prefsFile).exemptUps[0], 'UP1', '没迁的键不能被写没')
})

test('第二遍幂等：不再写、不再留新备份', (t) => {
  const s = setup(t)
  assert.equal(s.run('--go').status, 0)
  const cfg1 = fs.readFileSync(s.cfgFile, 'utf8')
  const bakCount1 = fs.readdirSync(path.dirname(s.cfgFile)).filter((x) => x.includes('.bak-legacy-')).length
  const r2 = s.run('--go')
  assert.equal(r2.status, 0, r2.stderr)
  assert.equal(fs.readFileSync(s.cfgFile, 'utf8'), cfg1, '第二次不该改 config.json')
  assert.equal(
    fs.readdirSync(path.dirname(s.cfgFile)).filter((x) => x.includes('.bak-legacy-')).length,
    bakCount1, '第二次不该产生新备份',
  )
})

test('旧配置读不到就明说不迁，不硬猜（exit≠0 且一个字都不写）', (t) => {
  const s = setup(t)
  const cfg1 = fs.readFileSync(s.cfgFile, 'utf8')
  fs.rmSync(s.legacyFile)
  const r = s.run('--go')
  assert.notEqual(r.status, 0, '旧配置没了要非零退出')
  assert.match(r.stderr, /旧共享配置读不到/)
  assert.equal(fs.readFileSync(s.cfgFile, 'utf8'), cfg1)
})

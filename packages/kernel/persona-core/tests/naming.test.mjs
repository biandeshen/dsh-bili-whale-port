/**
 * 称呼只有一个来源（2026-11-01 主人问"我想给自己改名，该怎么做"）。
 *
 * 这份是从宿主 tests/naming.test.mjs 搬过来的断言（#88 退役第二份内核前的对账）：
 * 宿主那份测的是 legacy/bili-account-retired 的 diary/tank，本仓对应入口已换成
 * cap-journal 的 diaryDefaultHeader 与转接头的身份桥。
 *
 * 搬家时发现的洞：`setOwnerName` 在本仓**一个生产调用者都没有**——
 * 名字读出来了（legacy-identity / import-legacy-config 都存了 ownerName），
 * 但没人把它交给内核，于是她永远说「鱼片」。最后一条钉的就是这条接线。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ownerName, setOwnerName } from '../src/naming.ts'
import { readMood } from '../src/emotion.ts'
import { buildVoiceBrief } from '../src/voice-brief.ts'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { pickActivities } from '../src/life-activities.ts'
import { diaryDefaultHeader } from '../../../capabilities/cap-journal/src/diary.ts'

const causeMood = (source) => readMood({
  fields: { ...DEFAULT_ATOMIC_FIELDS },
  chain: [{ source, description: source, timestamp: new Date(), fieldChanges: [], effects: [] }],
})

test('默认称呼没被改口：不配 displayName 时沿用「鱼片」', () => {
  assert.equal(ownerName(), '鱼片')
  assert.match(causeMood('draftRejected').inner, /鱼片没让她发那条/)
})

test('改一处称呼，独白 / 禁称表 / 日记抬头一起跟着走', (t) => {
  t.after(() => { setOwnerName('鱼片') })
  setOwnerName('阿鱼')
  assert.equal(ownerName(), '阿鱼')
  assert.match(causeMood('draftRejected').inner, /阿鱼没让她发那条/)
  assert.match(causeMood('masterReplied').inner, /阿鱼回我了/)
  const cold = buildVoiceBrief({
    fields: { ...DEFAULT_ATOMIC_FIELDS }, chain: [], memories: [], npcState: { current: 'cold_war' },
  })
  assert.deepEqual(cold.banned, ['阿鱼', '主人'])
  assert.match(diaryDefaultHeader('public'), /# 鲸鱼日记 · 给阿鱼/)
  assert.equal(diaryDefaultHeader('private'), '# 私人日记 · 偏好校准\n\n')
})

test('活动文案里留的是占位符，不是又硬编码一个名字', () => {
  /**
   * 2026-11-20 修正测法（踩了三次，每次都记下来）：
   *   ① 原来断言"渲染结果不含鱼片"——默认称呼本来就是「鱼片」，正确替换后必然包含，
   *      它把"没硬编码"错测成了"默认称呼不许出现"；
   *   ② 改成"换名前后文案不同"——但 `describe()` 按**小时**取模选模板，
   *      social 那 5 条里只有 1 条带 `{{owner}}`，当前这一小时未必命中它；
   *   ③ 所以必须扫一整天的 24 个小时，看"有没有任何一条会随名字变"。
   *
   * 判据同时钉两头：
   *   · 至少有文案随名字变（说明占位符真的在工作，不是全写死）；
   *   · 一变之后旧名不残留（说明替换是整体替换，不是拼接）。
   */
  const HOUR = 3600_000
  const dayStart = Date.UTC(2026, 0, 1, 0, 0, 0)
  const render = (ms, name) => {
    setOwnerName(name)
    return pickActivities(DEFAULT_ATOMIC_FIELDS, { now: ms, rng: () => 0.5, k: 7 })
      .map((x) => x.description)
  }

  try {
    const BASE = '鱼片'
    const ALT = '阿鱼'
    let changed = 0
    for (let h = 0; h < 24; h++) {
      const ms = dayStart + h * HOUR
      const a = render(ms, BASE)
      const b = render(ms, ALT)
      assert.equal(a.length, 7)
      // 同一时刻、同一个名字渲染两次必须一致（纯函数）
      assert.deepEqual(render(ms, BASE), a, '同一时刻同一名字要稳定')
      for (let i = 0; i < a.length; i++) {
        if (a[i] === b[i]) continue
        changed++
        assert.match(b[i], new RegExp(ALT), '变过的文案里应出现新称呼')
        assert.doesNotMatch(b[i], new RegExp(BASE), '旧称呼不该残留')
      }
    }
    assert.ok(changed > 0, '一整天里至少要有一条文案跟着名字变——全都一样就说明称呼是写死的')
  } finally {
    setOwnerName('鱼片')
  }
})

test('边界：空值/纯空白/超长都不许把名字清空', () => {
  setOwnerName('阿鱼')
  assert.equal(setOwnerName(''), '阿鱼')
  assert.equal(setOwnerName('   '), '阿鱼')
  assert.equal(setOwnerName(undefined), '阿鱼')
  assert.equal(setOwnerName('甲'.repeat(40)).length, 24, '配置来自用户手填，收 24 字')
  setOwnerName('鱼片')
})

// ── 接线：名字必须真的从配置走到内核 ────────────────────────────────
// 只认 displayName：owner.name 是角色标签（线上就是「主人」），当昵称会让她管主人叫"主人"。
const cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-bridge-'))
process.env.BILI_WHALE_CONFIG = path.join(cfgDir, 'bili-whale.config.json')
const writeCfg = (owner) => fs.writeFileSync(process.env.BILI_WHALE_CONFIG, JSON.stringify({ owner }), 'utf8')

test('身份桥只认 displayName，不把角色标签 owner.name 当昵称', async () => {
  const { readLegacyIdentity } = await import('../../../adapters/cortico-world-bilibili/src/legacy-identity.ts')
  writeCfg({ mid: '1', name: '主人' })
  assert.equal(readLegacyIdentity().ownerName ?? '', '', 'owner.name=主人 不许变成昵称')
  writeCfg({ mid: '1', name: '主人', displayName: '阿鱼' })
  assert.equal(readLegacyIdentity().ownerName, '阿鱼')
})

test('装载入口要把配置里的称呼交给内核（否则改名整条断线）', async () => {
  const { createXiaoyuBotDefinition } = await import('../../../adapters/cortico-bot-xiaoyu/src/cortico-definition.ts')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-wire-'))
  setOwnerName('鱼片')
  const def = createXiaoyuBotDefinition(dir)
  def.build({ config: { identity: { ownerName: '阿鱼' } }, memoryDir: dir, rootDir: dir })
  try {
    assert.equal(ownerName(), '阿鱼', '装配完就该认得主人的称呼，不能还叫「鱼片」')
    assert.match(causeMood('draftRejected').inner, /阿鱼没让她发那条/)
  } finally {
    setOwnerName('鱼片')
  }
})
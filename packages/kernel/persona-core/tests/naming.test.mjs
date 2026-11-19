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
   * 2026-11-20 修正测法：原来断言"渲染结果不含鱼片"，可默认称呼本来就是「鱼片」，
   * `{{owner}}` 正确替换之后结果里必然有它——这条断言把"没硬编码"错测成了
   * "默认称呼不许出现"，永远是红的或永远被跳过。
   *
   * 真正要守的是**源头**：模板里有 `{{owner}}` 占位符，且换一个名字之后
   * 同一句会跟着变。所以：
   *   ① 换名前后拿到同一条模板 → 文案里出现的是新名字（说明走的是占位符）；
   *   ② 换名前后的两条 description 必须不同（说明它真的读了称呼，不是写死的）。
   */
  const before = pickActivities(DEFAULT_ATOMIC_FIELDS, { now: Date.now(), rng: () => 0.5, k: 7 })
  setOwnerName('阿鱼')
  const after = pickActivities(DEFAULT_ATOMIC_FIELDS, { now: Date.now(), rng: () => 0.5, k: 7 })
  setOwnerName('鱼片')

  const socialBefore = before.find((x) => x.type === 'social')
  const socialAfter = after.find((x) => x.type === 'social')
  assert.ok(socialBefore && socialAfter, 'social 类活动要在前 7 条里')
  assert.notEqual(socialBefore.description, socialAfter.description,
    '换个称呼文案要跟着变——一样就说明名字是写死的')
  assert.match(socialAfter.description, /阿鱼/, '换名后该出现新称呼')
  assert.doesNotMatch(socialAfter.description, /鱼片/, '换名后旧称呼不该还留在同一句里')
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
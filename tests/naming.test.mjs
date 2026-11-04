// 称呼只有一个来源（2026-11-01 主人问"我想给自己改名，该怎么做"时，它散在 5 处代码里）。
// 配置字段：bili-whale.config.json 的 owner.displayName。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { ownerName, setOwnerName } from '@xiaoyu/persona-core/naming'
import { readMood } from '@xiaoyu/persona-core/emotion'
import { buildVoiceBrief } from '@xiaoyu/persona-core/voice-brief'
import { DEFAULT_ATOMIC_FIELDS } from '@xiaoyu/persona-core/types'
import { pickActivities } from '@xiaoyu/persona-core/life-activities'
import { diaryDefaultHeader } from '../legacy/bili-account-retired/diary.ts'
import { ownerNameFromConfig } from '../legacy/bili-account-retired/tank.ts'

const causeMood = (source) => readMood({
  fields: { ...DEFAULT_ATOMIC_FIELDS },
  chain: [{ source, description: source, timestamp: new Date(), fieldChanges: [], effects: [] }],
})

test('默认称呼没被改口：不配 displayName 时沿用「鱼片」', () => {
  assert.equal(ownerName(), '鱼片')
  assert.match(causeMood('draftRejected').inner, /鱼片没让她发那条/)
})

test('改一处称呼，独白 / 禁称表 / 日记抬头 / 生活活动一起跟着走', (t) => {
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
  // 活动文案里留的是占位符，不是又硬编码一个名字
  const texts = pickActivities(DEFAULT_ATOMIC_FIELDS, { now: Date.now(), rng: () => 0.5, k: 7 })
  assert.ok(texts.every((x) => !x.label.includes('鱼片') && !x.description.includes('鱼片')), '不许再把称呼写死在活动表里')
})

test('边界：空值/纯空白/超长都不许把名字清空', () => {
  setOwnerName('阿鱼')
  assert.equal(setOwnerName(''), '阿鱼')
  assert.equal(setOwnerName('   '), '阿鱼')
  assert.equal(setOwnerName(undefined), '阿鱼')
  assert.equal(setOwnerName('甲'.repeat(40)).length, 24, '配置来自用户手填，收 24 字')
  setOwnerName('鱼片')
})

test('ownerNameFromConfig 只认 displayName，不把角色标签 owner.name 当昵称', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'naming-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify({ owner: { mid: '1', name: '主人' } }), 'utf8')
  assert.equal(ownerNameFromConfig(file), '', 'owner.name=主人 不许变成昵称')
  fs.writeFileSync(file, JSON.stringify({ owner: { mid: '1', name: '主人', displayName: '阿鱼' } }), 'utf8')
  assert.equal(ownerNameFromConfig(file), '阿鱼')
  assert.equal(ownerNameFromConfig(path.join(dir, 'nope.json')), '', '读不到配置 = 空，交给默认称呼')
})

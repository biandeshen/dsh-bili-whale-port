// 意见箱 f-5aaea9：watchedVideo 不查她的结论就写成"喜欢"并塞进长期记忆。
// 三种结论（收 / 不收 / 无从判断）跑真实的 applyEffects → 因果链 → describeState → readMood。
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  emptyState, applyEffects, describeState, readMood, remember, PRESETS, WATCH_VERDICTS,
} from '../src/worlds/bili-account/personaAdapter.ts'

const DAY = 86400_000
const NOW = Date.now()
const FIELDS = ['energy', 'stimulation', 'connection', 'social', 'mood', 'curiosity', 'creativity']

/** 只过了一天、没有任何事件的状态：拿它当"这轮什么都没加"的对照。 */
const baseline = () => applyEffects(emptyState(), [], '对照', { source: 'control', now: NOW + DAY })

function settled(verdict) {
  const v = WATCH_VERDICTS[verdict]
  const s = applyEffects(emptyState(), v.effects, v.description, { source: v.source, now: NOW + DAY })
  return remember(s, '看过《雨声十小时》（雨声实验室） —— BV1aaBBccDD1', { sender: 'npc', source: 'npc_self' })
}

test('判「不收」：账本与「记得」里没有『喜欢』，也不给她抬心情/好奇/刺激', () => {
  const base = baseline()
  const s = settled('drop')
  const ledger = JSON.stringify(s.chain)
  const rendered = describeState(s, 5, { queryText: '今天看了雨声', seed: '2026-10-31' }) + JSON.stringify(readMood(s))
  assert.doesNotMatch(ledger + rendered, /喜欢/, '旧文案「看了一条喜欢的视频」会写进链上')
  assert.equal(s.chain.some((e) => e.source === 'watchedDrop' && /喜欢/.test(e.description)), false)
  for (const f of ['mood', 'curiosity', 'stimulation']) {
    assert.ok(s.fields[f] <= base.fields[f] + 1e-6, f + ' 不该因为"看完了"被抬：' + s.fields[f] + ' vs ' + base.fields[f])
  }
  assert.ok(s.memories.some((m) => m.content === '看过《雨声十小时》（雨声实验室） —— BV1aaBBccDD1'))
  assert.doesNotMatch(JSON.stringify(s.memories), /喜欢/)
})

test('判「无从判断」：不产生任何正向场值加成', () => {
  const base = baseline()
  const s = settled('unclear')
  assert.equal(WATCH_VERDICTS.unclear.effects.every((e) => e.delta <= 0), true, '预设里不能有正 delta')
  for (const f of FIELDS) {
    if (f === 'energy') continue
    assert.ok(s.fields[f] <= base.fields[f] + 1e-6, f + ' 不该因为"看完了"被抬：' + s.fields[f] + ' vs ' + base.fields[f])
  }
  assert.ok(s.fields.energy < base.fields.energy, '看过一条是要花体力的')
})

test('判「收」：正向加成只在这一档发生，链上写的是「看完一条，收了」', () => {
  const base = baseline()
  const s = settled('keep')
  assert.ok(s.fields.mood > base.fields.mood, 'mood ' + s.fields.mood + ' vs ' + base.fields.mood)
  assert.ok(s.fields.curiosity > base.fields.curiosity)
  assert.ok(s.fields.stimulation > base.fields.stimulation)
  assert.ok(s.chain.some((e) => e.source === 'watchedKeep' && e.description === '看完一条，收了'))
  assert.doesNotMatch(describeState(s, 5) + JSON.stringify(s.chain), /喜欢/)
})

test('预设文本与三种结论的成因都不替她下价值结论', () => {
  assert.doesNotMatch(PRESETS.watchedVideo.description, /喜欢/)
  const sources = new Set(['keep', 'drop', 'unclear'].map((v) => WATCH_VERDICTS[v].source))
  assert.equal(sources.size, 3, '三种结论在因果链上要分得开')
  assert.deepEqual(WATCH_VERDICTS.keep.effects, PRESETS.watchedVideo.effects, '「收」就是原来那一档')
})

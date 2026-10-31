/**
 * voiceBrief 的新字段（pace/today/hour/state）与记忆 slot 必须**改变正文**——
 * 这是"产物与人格状态零耦合"那条红队结论的反证：同一段日记，只换状态，正文归一化后互不相同。
 * 全部走真函数 composeDraft，无 mock。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { composeDraft } from '../../scripts/draft-dynamic.mjs'

const DIARY = [
  '## 2026-11-01',
  '',
  '## 看过',
  '',
  '| BV | 标题 | 时长 |',
  '|---|---|---|',
  '| BV1fixture | 夜里便利店的晚风 | 32:00 |',
  '',
  '## 想说',
  '',
  '- 把雨声那段重听了三遍，还是没想好怎么说。',
  '',
].join('\n')

const DATE = '2026-11-01'

function voice(over = {}) {
  return {
    v: 1,
    mood: { label: '快乐', intensity: 0.4, reason: '刚刷到一条好的', cause: 'action' },
    relation: 'normal',
    memories: [],
    banned: [],
    stance: { share: true, because: '有想说的' },
    ...over,
  }
}

const surprise = { id: 'm9', text: '看过《晚风便利店》', why: '一直没被想起', score: 0.9, from: 'npc', days: 40, slot: 'surprise' }
const coreSame = { ...surprise, id: 'm9c', slot: 'core' }

/** 变体表：每个键只动一个状态维度，其余与基线一致。 */
const VARIANTS = {
  baseline: voice(),
  tired: voice({ pace: 'tired' }),
  wired: voice({ pace: 'wired' }),
  today: voice({ today: ['第一次把延时摄影的参数调对了', '给雨声那段配了字幕'] }),
  hourLateNight: voice({ hour: 3 }),
  surpriseSlot: voice({ memories: [surprise] }),
  coreSlot: voice({ memories: [coreSame] }),
  energyLow: voice({ state: { energy: 0.2, social: 0.5, curiosity: 0.5, creativity: 0.5, stimulation: 0.5 } }),
  socialHigh: voice({ state: { social: 0.9, energy: 0.8, curiosity: 0.5, creativity: 0.4, stimulation: 0.5 } }),
  curiosityHigh: voice({ state: { curiosity: 0.9, energy: 0.8, social: 0.5, creativity: 0.4, stimulation: 0.5 } }),
}

const composed = {}
for (const [k, v] of Object.entries(VARIANTS)) {
  const r = composeDraft(DIARY, { date: DATE, voice: v })
  assert.equal(r.ok, true, `${k} 出稿失败：${r.error}`)
  composed[k] = r.text
}

const norm = (s) => String(s).replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]《》<>—…·*-]/g, '')
const multiset = (s) => {
  const m = new Map()
  for (const c of [...norm(s)]) m.set(c, (m.get(c) ?? 0) + 1)
  return m
}
/** 字符多重集差：与 scripts/counterfactual.mjs 同口径，避免"只改标点"被算成差异。 */
const diffChars = (a, b) => {
  const ma = multiset(a); const mb = multiset(b)
  let d = 0
  for (const [c, n] of ma) d += Math.max(0, n - (mb.get(c) ?? 0))
  for (const [c, n] of mb) d += Math.max(0, n - (ma.get(c) ?? 0))
  return d
}

test('耦合可证伪：同一日记，pace/today/hour/slot/state 各变体归一化后两两不同', () => {
  const keys = Object.keys(composed)
  for (let i = 0; i < keys.length; i += 1) {
    for (let j = i + 1; j < keys.length; j += 1) {
      const [a, b] = [keys[i], keys[j]]
      assert.notEqual(norm(composed[a]), norm(composed[b]), `${a} 与 ${b} 归一化后一模一样 → 这个状态没进正文`)
    }
  }
})

test('每个新状态相对基线的正文差异 ≥4 字（与反事实同一判据）', () => {
  for (const [k, text] of Object.entries(composed)) {
    if (k === 'baseline') continue
    assert.ok(diffChars(text, composed.baseline) >= 4, `${k} 与基线只差 ${diffChars(text, composed.baseline)} 字`)
  }
})

test('pace 的措辞可观察：tired 收尾变短，wired 更密更长', () => {
  assert.ok(composed.tired.includes('今天先这样'), composed.tired)
  assert.ok(composed.tired.length <= composed.baseline.length, 'tired 应该更短')
  assert.ok(composed.wired.includes('还想接着说两句'), composed.wired)
  assert.ok(composed.wired.length > composed.baseline.length, 'wired 应该更密')
})

test('today 是"今天做了什么"的具体所指；"今天第一次"要进正文', () => {
  assert.match(composed.today, /今天第一次把延时摄影的参数调对了。/)
  assert.ok(diffChars(composed.today, composed.baseline) >= 8, composed.today)
})

test('hour 只在凌晨/深夜带出时间感，白天不硬塞', () => {
  assert.match(composed.hourLateNight, /这个点还醒着/)
  const noon = composeDraft(DIARY, { date: DATE, voice: voice({ hour: 14 }) })
  assert.equal(noon.ok, true)
  assert.equal(noon.text, composed.baseline, '白天钟点不该改变正文')
})

test('意外槽带出"忽然想起"的语感，与同一条记忆放在 core 槽读起来不同', () => {
  assert.match(composed.surpriseSlot, /忽然想起《晚风便利店》，说不上为什么/)
  assert.match(composed.coreSlot, /记下的《晚风便利店》还在/)
  assert.ok(diffChars(composed.surpriseSlot, composed.coreSlot) >= 4)
})

test('场值进正文，但写成她的口气而不是状态播报', () => {
  for (const text of [composed.energyLow, composed.socialHigh, composed.curiosityHigh]) {
    assert.doesNotMatch(text, /energy|stimulation|curiosity|social|creativity|0\.\d/, '不许把场值原样印进正文')
  }
  assert.match(composed.energyLow, /话说得有点费力/)
  assert.match(composed.socialHigh, /今天想多跟你说两句/)
  assert.match(composed.curiosityHigh, /还想去翻点什么/)
})

test('回归保护：新字段全部缺失时，正文与今天的行为一字不差', () => {
  // 这一条锁住旧产出：voiceBrief 加字段之前，这条日记出的就是这句话
  assert.equal(composed.baseline, '今晚看的是《夜里便利店的晚风》。 把雨声那段重听了三遍，还是没想好怎么说。 今天挺好的。')
})

test('缺字段容错：新字段坏值/缺值一律退回旧行为，不拒稿、不抛、不降级成模板', () => {
  const broken = [
    voice({ pace: 'soggy' }),
    voice({ pace: 'TIRED' }),
    voice({ pace: null }),
    voice({ hour: 99 }),
    voice({ hour: 'abc' }),
    voice({ hour: null }),
    voice({ today: '今天第一次把参数调对了' }),
    voice({ today: [] }),
    voice({ today: [null, '', '   '] }),
    voice({ state: null }),
    voice({ state: '能量低' }),
    voice({ state: { energy: 'x', social: undefined } }),
  ]
  for (const [i, v] of broken.entries()) {
    const r = composeDraft(DIARY, { date: DATE, voice: v })
    assert.equal(r.ok, true, `第 ${i} 组坏值被拒稿：${r.error}`)
    assert.equal(r.text, composed.baseline, `第 ${i} 组坏值没有退回旧行为：${r.text}`)
  }
})

test('正文仍然像说话：≤100 字、无 markdown 星号、无免责声明、不堆 emoji', () => {
  for (const [k, text] of Object.entries(composed)) {
    assert.ok([...norm(text)].length + 4 <= 104, `${k} 超 100 字：${text.length}`)
    assert.ok(text.length <= 100, `${k} 超 100 字：${text}`)
    assert.doesNotMatch(text, /\*\*/, `${k} 漏出 markdown 星号`)
    assert.doesNotMatch(text, /作为AI|作为 AI|人工智能|我无法|语言模型/, `${k} 出现免责声明`)
    assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, `${k} 堆了 emoji`)
  }
})

test('低落 + 新字段：仍然只留一句、无感叹号（旧判据不被新通道冲掉）', () => {
  const r = composeDraft(DIARY, {
    date: DATE,
    voice: voice({ mood: { label: '悲伤', intensity: 0.6, reason: '被拒', cause: 'draftRejected' }, today: ['第一次把延时摄影的参数调对了'], hour: 2, pace: 'tired' }),
  })
  assert.equal(r.ok, true)
  assert.doesNotMatch(r.text, /！/)
  assert.equal(r.text.split('。').filter(Boolean).length, 1, r.text)
})

test('冷战时场值的"跟你说"不出现，禁称仍然替换干净', () => {
  const r = composeDraft(DIARY, {
    date: DATE,
    voice: voice({ relation: 'cold_war', banned: ['鱼片'], state: { social: 0.95, energy: 0.8, curiosity: 0.5, creativity: 0.5, stimulation: 0.5 } }),
  })
  assert.equal(r.ok, true)
  assert.doesNotMatch(r.text, /今天想多跟你说两句/, '冷战时不把"想说给你听"写进正文')
  const withName = composeDraft(
    `## ${DATE}\n\n## 想说\n\n- 鱼片今天没来，我自己把雨声听完了。\n`,
    { date: DATE, voice: voice({ banned: ['鱼片'] }) },
  )
  assert.ok(withName.ok)
  assert.doesNotMatch(withName.text, /鱼片/)
})

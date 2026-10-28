import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { composeDraft, assertVoice, VOICE_REQUIRED, buildText } from '../../scripts/draft-dynamic.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const SCHEMA = JSON.parse(fs.readFileSync(path.join(HERE, '../../scripts/voice.schema.json'), 'utf8'))

const diary = [
  '## 2026-10-29',
  '',
  '## 看过',
  '',
  '| BV | 标题 | 时长 |',
  '|---|---|---|',
  '| BV1test | 雨声 | 45:00 |',
  '',
  '## 想说',
  '',
  '- 今天听了雨。第二句是多余的。',
  '',
].join('\n')

function voice(over = {}) {
  return {
    v: 1,
    mood: { label: '轻快', intensity: 0.3, reason: '刚起身', cause: 'action' },
    relation: 'normal',
    memories: [],
    banned: [],
    stance: { share: true, because: '有想说的' },
    ...over,
  }
}

test('voice.schema.json 的 required 与 assertVoice 使用的列表一致', () => {
  assert.deepEqual([...VOICE_REQUIRED].sort(), [...SCHEMA.required].sort())
})

test('A0：缺 voice 直接拒稿', () => {
  const r = composeDraft(diary, { date: '2026-10-29' })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'voice-missing')
})

test('A0b：坏 voice 拒绝（版本/结构）', () => {
  assert.equal(assertVoice({ ...voice(), v: 2 }), 'voice-version')
  assert.equal(assertVoice({ ...voice(), mood: null }), 'voice-mood')
  const r = composeDraft(diary, { date: '2026-10-29', voice: { ...voice(), v: 2 } })
  assert.equal(r.ok, false)
})

test('A5：stance.share=false 不生成草稿', () => {
  const r = composeDraft(diary, { date: '2026-10-29', voice: voice({ stance: { share: false, because: '不想说' } }) })
  assert.equal(r.ok, false)
  assert.equal(r.error, 'stance-skip')
})

test('A1：readMood 的每个标签都有措辞，未接线的标签直接报错', () => {
  const LABELS = ['警觉', '失落', '想念', '平静', '雀跃', '开心', '满足', '困倦', '好奇', '手痒', '轻快', '安静', '疲惫', '安稳']
  for (const label of LABELS) {
    const r = composeDraft(diary, { date: '2026-10-29', voice: voice({ mood: { label, intensity: 0.3, reason: 'x', cause: 'action' } }) })
    assert.equal(r.ok, true, `${label} 没有接线`)
  }
  const bad = composeDraft(diary, { date: '2026-10-29', voice: voice({ mood: { label: '忧郁', intensity: 0.3, reason: 'x', cause: 'action' } }) })
  assert.equal(bad.ok, false)
  assert.equal(bad.error, 'unmapped-mood')
})

test('A2：同一日记，低落与轻快的产出必须不同（低落只留一句、无感叹号）', () => {
  const low = composeDraft(diary, { date: '2026-10-29', voice: voice({ mood: { label: '失落', intensity: 0.5, reason: '被拒', cause: 'draftRejected' } }) })
  const high = composeDraft(diary, { date: '2026-10-29', voice: voice() })
  assert.equal(low.ok, true); assert.equal(high.ok, true)
  assert.notEqual(low.text, high.text)
  assert.ok(!low.text.includes('！'))
  assert.ok(low.text.split('。').filter(Boolean).length <= 1, '低落时只保留一句')
  assert.ok(high.text.length >= low.text.length)
})

test('A2b：轻快 vs 中性平静 的差异必须 ≥4 字（反事实不可为 0）', () => {
  const high = composeDraft(diary, { date: '2026-10-29', voice: voice() })
  const neutral = composeDraft(diary, {
    date: '2026-10-29',
    voice: voice({ mood: { label: '平静', intensity: 0, reason: '对照', cause: null } }),
  })
  assert.ok(high.ok && neutral.ok)
  const norm = (s) => [...String(s).replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()【】\[\]《》<>—…·-]/g, '')]
  const count = (arr) => { const m = new Map(); for (const c of arr) m.set(c, (m.get(c) ?? 0) + 1); return m }
  const a = count(norm(high.text)); const b = count(norm(neutral.text))
  let diff = 0
  for (const [c, n] of a) diff += Math.max(0, n - (b.get(c) ?? 0))
  for (const [c, n] of b) diff += Math.max(0, n - (a.get(c) ?? 0))
  assert.ok(diff >= 4, `差异只有 ${diff} 字`)
})

test('A5b：冷战禁称生效', () => {
  const text = '今天鱼片没来。我自己听雨。'
  const r = composeDraft(`## 2026-10-29\n\n## 想说\n\n- ${text}\n`, {
    date: '2026-10-29',
    voice: voice({ relation: 'cold_war', banned: ['鱼片', '主人'] }),
  })
  assert.ok(r.ok)
  assert.ok(!r.text.includes('鱼片'))
  assert.ok(!r.text.includes('主人'))
})

test('A4：高分记忆会被回扣，且可追溯到来源', () => {
  const mem = { id: 'm1', text: '看过《竹林雨声》—— BV1test', why: '0.90 鲜活 · 1 天前', score: 0.8 }
  const r = composeDraft(diary, { date: '2026-10-29', voice: voice({ memories: [mem] }) })
  assert.ok(r.ok)
  assert.match(r.text, /竹林雨声/)
})

test('A4b：低分记忆不回扣，不编造', () => {
  const mem = { id: 'm2', text: '看过《无关》', why: '0.1 鲜活', score: 0.2 }
  const r = composeDraft(diary, { date: '2026-10-29', voice: voice({ memories: [mem] }) })
  assert.ok(r.ok)
  assert.doesNotMatch(r.text, /无关/)
})

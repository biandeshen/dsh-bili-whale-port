/**
 * 活动文案里的 {{owner}} 必须被替换掉，不能原样进她的提示词。
 *
 * 搬家对账（#88）发现的洞：宿主 legacy definition.ts:464 做过
 * `.split('{{owner}}').join(ownerName())`，本仓重写后**这一步没了**——
 * TEMPLATES.social[0] 是「翻看以前和{{owner}}的聊天记录…」，
 * describe() 直接把模板原样返回，一路走到 cortico-persona.ts 的唤醒正文。
 * 于是 hour%5===0 且 social 胜出那一拍，她读到的是字面量 `{{owner}}`。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { pickActivities, ACTIVITY_TYPES } from '../src/life-activities.ts'
import { DEFAULT_ATOMIC_FIELDS } from '../src/types.ts'
import { setOwnerName, ownerName } from '../src/naming.ts'

/** 把每一类都逼出来一次：rng 固定 + 扫 24 小时，覆盖 describe 的取模分支。 */
function allDescriptions() {
  const out = []
  for (let h = 0; h < 24; h++) {
    const now = Date.parse('2026-11-02T00:00:00Z') + h * 3_600_000
    for (const a of pickActivities(DEFAULT_ATOMIC_FIELDS, { now, rng: () => 0.5, k: 7 })) out.push(a)
  }
  return out
}

test('七类活动的所有文案都不带未替换的占位符', () => {
  const acts = allDescriptions()
  assert.ok(acts.length >= ACTIVITY_TYPES.length, '取样要覆盖到各类活动')
  const leaked = acts.filter((a) => /\{\{.*?\}\}/.test(`${a.label}${a.description}`))
  assert.deepEqual(leaked.map((a) => a.description), [], '占位符必须在内核里就替换掉')
})

test('social 那条用的是当前称呼，不是写死的名字也不是占位符', (t) => {
  t.after(() => setOwnerName('鱼片'))
  setOwnerName('阿鱼')
  const texts = allDescriptions().map((a) => a.description)
  const chat = texts.filter((s) => s.includes('聊天记录'))
  assert.ok(chat.length, 'social 里那条翻聊天记录的文案要在样本里')
  for (const s of chat) {
    assert.ok(s.includes(ownerName()), `要用当前称呼「${ownerName()}」，实际：${s}`)
    assert.ok(!s.includes('{{owner}}'), '不许把占位符送出去')
  }
})
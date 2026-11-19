// 私信归因：只有"直接对伴侣说的"才算正向事件；引文/转述/代理/否定/边界一律不计
import test from 'node:test'
import assert from 'node:assert/strict'
import { assessConversation } from '../src/conversation-assessment.ts'

test('直接表达：我喜欢你 → affection/direct/content_specific', () => {
  const a = assessConversation('我喜欢你')
  assert.equal(a.directedAct, 'affection')
  assert.equal(a.attribution, 'direct')
  assert.equal(a.effectPolicy, 'content_specific')
  assert.equal(a.responseMode, 'normal')
})

test('引文不算：他说「我喜欢你」 → quoted/none', () => {
  const a = assessConversation('他说「我喜欢你」')
  assert.equal(a.attribution, 'quoted')
  assert.equal(a.effectPolicy, 'none')
  assert.equal(a.reason, 'quoted_content')
})

test('代理传话不算：我朋友让我问你 → third_party/none', () => {
  const a = assessConversation('我朋友让我问你')
  assert.equal(a.attribution, 'third_party')
  assert.equal(a.effectPolicy, 'none')
})

test('否定关系不算：我不喜欢你 → negated_relation/none', () => {
  const a = assessConversation('我不喜欢你')
  assert.equal(a.attribution, 'direct')
  assert.equal(a.effectPolicy, 'none')
  assert.equal(a.reason, 'negated_relation')
})

test('边界指令：别回复我了 → current_reply/boundary/none', () => {
  const a = assessConversation('别回复我了')
  assert.equal(a.boundaryScope, 'current_reply')
  assert.equal(a.responseMode, 'boundary')
  assert.equal(a.effectPolicy, 'none')
})

test('称呼边界：别叫我宝宝 → addressing_style/boundary', () => {
  const a = assessConversation('别叫我宝宝')
  assert.equal(a.boundaryScope, 'addressing_style')
  assert.equal(a.responseMode, 'boundary')
})

test('普通情绪：今天好难过 → sad/direct/content_specific', () => {
  const a = assessConversation('今天好难过')
  assert.equal(a.directedAct, 'sad')
  assert.equal(a.attribution, 'direct')
  assert.equal(a.effectPolicy, 'content_specific')
})

test('转述后的独立转折可以恢复直接语义：他说别回复我，但是我想你', () => {
  const a = assessConversation('他说别回复我，但是我想你')
  assert.equal(a.directedAct, 'affection')
  assert.equal(a.attribution, 'direct')
})

test('讽刺/歧义：呵呵 → uncertain/none', () => {
  const a = assessConversation('呵呵')
  assert.equal(a.attribution, 'uncertain')
  assert.equal(a.effectPolicy, 'none')
})

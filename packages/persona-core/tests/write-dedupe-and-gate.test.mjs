// 止烧：一件事只做一遍。三件事各自钉住（2026-11-14）。
// 事实来源：r-20261113-233659-bb8f 里一件事被拆成 10 次工具调用
// （life_do ×4 / mood_apply ×3 / memory_recall ×3），4 笔行动 / 14 次调用 = 每笔 3.5 次；
// 11-06 是 226 笔 / 3237 次 = 14.3 次/笔。
import test from 'node:test'
import assert from 'node:assert/strict'
import { contentKey, WriteDeduper } from '../src/write-dedupe.ts'
import { ToolCallGate, withToolGate, fingerprint, DEFAULT_TOOL_LIMITS } from '../../cortico-bot-xiaoyu/src/tool-gate.ts'

// ── A. 内容指纹幂等 ────────────────────────────────────────────────

test('A：同样内容得到同样指纹（跨重试稳定）；空白/大小写差异不算新内容', () => {
  assert.equal(contentKey(['life_do', 'explore', '翻记忆池']), contentKey(['life_do', 'explore', '翻记忆池']))
  assert.equal(
    contentKey(['life_do', 'explore', '翻  记忆池 ']),
    contentKey(['life_do', 'explore', '翻 记忆池']),
    '连续空白与首尾空白归一化后应相同',
  )
  assert.notEqual(contentKey(['life_do', 'explore', '翻记忆池']), contentKey(['life_do', 'explore', '看视频']))
})

test('A：同内容第二次命中、不同内容放行', () => {
  const d = new WriteDeduper(4)
  const k = contentKey(['life_do', 'explore', '翻记忆池找收下的视频'])
  assert.equal(d.lookup(k), null, '第一次没有记录')
  d.remember(k, { at: 1 })
  assert.ok(d.lookup(k), '第二次应命中')
  assert.equal(d.lookup(contentKey(['life_do', 'explore', '别的事'])), null)
})

test('A：容量满了丢最旧的，不会无限长', () => {
  const d = new WriteDeduper(2)
  d.remember('a'); d.remember('b'); d.remember('c')
  assert.equal(d.size(), 2)
  assert.equal(d.lookup('a'), null)
  assert.ok(d.lookup('c'))
})

// ── B. 一次行动就该收口 ────────────────────────────────────────────

test('B：同一 (tool,args) 第二次直接拒（she 不知道自己已经做过 = 实测那条 8 分钟重复）', () => {
  const g = new ToolCallGate()
  const a = { activity: 'explore', note: '翻记忆池找所有收下的视频，看哪条是漏掉的' }
  assert.equal(g.check('life_do', a).allow, true, '第一次放行')
  const second = g.check('life_do', a)
  assert.equal(second.allow, false)
  assert.equal(second.code, 'same-call')
  assert.match(second.reason, /同样的参数调用过/)
})

test('B：同工具不同参数也受限（perToolLimit），默认 2 次', () => {
  const g = new ToolCallGate()
  assert.equal(g.check('life_do', { activity: 'explore', note: 'A' }).allow, true)
  assert.equal(g.check('life_do', { activity: 'explore', note: 'B' }).allow, true)
  const third = g.check('life_do', { activity: 'explore', note: 'C' })
  assert.equal(third.allow, false)
  assert.equal(third.code, 'tool-limit')
  assert.equal(DEFAULT_TOOL_LIMITS.perToolLimit, 2)
})

test('B：全局 runLimit 到顶就强制收口，理由要能告诉她', () => {
  const g = new ToolCallGate({ runLimit: 3, perToolLimit: 5, maxSameCall: 5, exitBehavior: 'continue' })
  for (let i = 0; i < 3; i++) assert.equal(g.check('t' + i, { i }).allow, true)
  const d = g.check('t9', { i: 9 })
  assert.equal(d.allow, false)
  assert.equal(d.code, 'run-limit')
  assert.match(d.reason, /现在就收尾/)
})

test('B：reset 后重新计数（跨唤醒不累计 —— 它拦机械重复，不是"今天能做几件事"）', () => {
  const g = new ToolCallGate({ runLimit: 1, perToolLimit: 9, maxSameCall: 9, exitBehavior: 'continue' })
  assert.equal(g.check('a', {}).allow, true)
  assert.equal(g.check('b', {}).allow, false)
  g.reset()
  assert.equal(g.check('b', {}).allow, true, '新一批应重新放行')
  assert.equal(g.stats().total, 1)
})

test('B：闸门包在 tools 外层，被拦的调用不执行原实现（且不抛，抄 continue 语义）', async () => {
  let ran = 0
  const tools = [{ name: 'life_do', execute: () => { ran += 1; return { ok: true } } }]
  const g = new ToolCallGate()
  const [wrapped] = withToolGate(tools, g)
  const r1 = wrapped.execute({ note: 'x' })
  assert.deepEqual(r1, { ok: true })
  const r2 = wrapped.execute({ note: 'x' })
  assert.equal(r2.blocked, true)
  assert.equal(r2.code, 'same-call')
  assert.equal(ran, 1, '第二次不许真的执行')
})

test('B：指纹与参数键序无关（模型换个键序不该绕过闸门）', () => {
  assert.equal(fingerprint('t', { a: 1, b: 2 }), fingerprint('t', { b: 2, a: 1 }))
  assert.notEqual(fingerprint('t', { a: 1 }), fingerprint('t', { a: 2 }))
})

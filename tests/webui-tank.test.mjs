// 世界页契约：小鱼 · 鱼缸（2026-10-31 功能聚合 + 发送策略）——面板清单/写方法不进 GET/策略纯函数
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BILI_ACCOUNT } from '../src/worlds/bili-account/definition.ts'
import { readPolicyLite, policyInWindow, policySet, policyState, autoSentToday } from '../src/worlds/bili-account/tank.ts'

const decl = BILI_ACCOUNT.create().webUi('zh')

test('鱼缸页声明：7 块面板、id 合法且唯一、灯 ≤7', () => {
  assert.equal(decl.label, '小鱼 · 鱼缸')
  const panels = decl.panels ?? []
  assert.deepEqual(panels.map((p) => p.id).sort(), ['diary', 'drafts', 'feedback', 'policy', 'tank', 'timeline', 'vitals'])
  for (const p of panels) assert.match(p.id, /^[a-z0-9-]+$/, `${p.id} id 合法性`)
  assert.equal(new Set(panels.map((p) => p.id)).size, panels.length, 'id 唯一')
  assert.ok((decl.lamps ?? []).length >= 1 && (decl.lamps ?? []).length <= 7, '灯 1–7')
  for (const l of decl.lamps ?? []) assert.ok(['online', 'loading', 'error', 'offline'].includes(l.state))
  assert.ok((decl.badges ?? []).length >= 1)
})

test('写方法只走 POST：approve/reject/resolve 不在 getMethods', () => {
  for (const p of decl.panels ?? []) {
    for (const m of p.getMethods ?? []) assert.equal(m, 'state', `${p.id} 只允许 state 进 GET`)
  }
})

test('invoke 路由：未知面板/未知方法显式拒绝，不静默吞', async () => {
  await assert.rejects(decl.invoke?.('nope', 'state', []), /unknown panel/)
  await assert.rejects(decl.invoke?.('tank', 'bogus', []), /unknown method/)
  // state 是真数据面：本地场值在本机必存在（缺文件时 ok:false 也不抛）
  const st = await decl.invoke?.('tank', 'state', [])
  assert.ok(st && typeof st === 'object' && 'ok' in st, 'tank/state 返回结构')
})

// ── 发送策略（tank.ts 纯函数；写盘只在临时文件里发生，绝不碰真配置） ──────────
test('readPolicyLite：空/野值都收敛到拍板默认', () => {
  assert.deepEqual(readPolicyLite({}), { draftMode: 'review', autoDailyCap: 0, autoWindow: '', like: 'self', fav: 'self', dmReply: 'direct' })
  assert.equal(readPolicyLite({ publish: { draftMode: 'yolo' } }).draftMode, 'review')
  assert.equal(readPolicyLite({ publish: { draftMode: 'auto' }, permissions: { fav: 'review' } }).draftMode, 'auto')
})

test('policySet：临时文件 roundtrip，别的关键配置原样保留', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'policy-'))
  const file = path.join(dir, 'bili-whale.config.json')
  fs.writeFileSync(file, JSON.stringify({ risk: { minGapMs: 1500 }, owner: { mid: '233643544' }, preferences: { like: ['助眠/ASMR'] } }))
  const ok = policySet({ publish: { draftMode: 'auto', autoDailyCap: 2, autoWindow: '10:00-23:00' }, permissions: { like: 'review' } }, file)
  assert.equal(ok.ok, true)
  assert.deepEqual(ok.policy, { draftMode: 'auto', autoDailyCap: 2, autoWindow: '10:00-23:00', like: 'review', fav: 'self', dmReply: 'direct' })
  const back = policyState(file)
  assert.deepEqual(back.policy, ok.policy)
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  assert.equal(raw.risk.minGapMs, 1500, 'risk 节不能被动')
  assert.equal(raw.owner.mid, '233643544', 'owner 节不能被动')
  assert.deepEqual(raw.preferences.like, ['助眠/ASMR'], '偏好不能被动')
  assert.deepEqual(policySet({ publish: { draftMode: 'auto', autoDailyCap: -9 } }, file).policy.autoDailyCap, 0, '非法值写盘前就被收敛')
})

test('policyInWindow + autoSentToday：时段含始不含终/跨午夜；只数今天的 ok', () => {
  assert.equal(policyInWindow(new Date('2026-10-31T10:00:00'), ''), true)
  assert.equal(policyInWindow(new Date('2026-10-31T23:30:00'), '10:00-23:00'), false)
  assert.equal(policyInWindow(new Date('2026-10-31T03:00:00'), '23:00-07:00'), true)
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'causal-'))
  const f = path.join(dir, 'causal.jsonl')
  fs.writeFileSync(f, [
    JSON.stringify({ kind: 'auto-publish', ok: true, at: '2026-10-31T01:00:00.000Z' }),
    JSON.stringify({ kind: 'auto-publish', ok: false, at: '2026-10-31T02:00:00.000Z' }),
    JSON.stringify({ kind: 'auto-publish', ok: true, at: '2026-10-30T02:00:00.000Z' }),
  ].join('\n') + '\n')
  assert.equal(autoSentToday(f, '2026-10-31'), 1)
  assert.equal(autoSentToday(path.join(dir, 'missing.jsonl')), 0, '没账本 = 0，不抛')
})

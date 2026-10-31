// 世界页契约：小鱼 · 鱼缸（2026-10-31 功能聚合 + 发送策略）——面板清单/写方法不进 GET/策略纯函数
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { BILI_ACCOUNT } from '../src/worlds/bili-account/definition.ts'
import { readPolicyLite, policyInWindow, policySet, policyState, autoSentToday, draftForDay, freshAckToken } from '../src/worlds/bili-account/tank.ts'

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
  assert.equal(autoSentToday({ file: f, day: '2026-10-31' }), 1, '只数成功的')
  assert.equal(autoSentToday({ file: f, day: '2026-10-31', attempts: true }), 2, '算上失败尝试才能堵住绕上限')
  assert.equal(autoSentToday({ file: path.join(dir, 'missing.jsonl') }), 0, '没账本 = 0，不抛')
})

test('freshAckToken + draftForDay：只认草稿自带且仍有效的令牌，绝不铸造', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ack-'))
  const whale = path.join(dir, 'whale')
  const drafts = path.join(dir, 'drafts')
  const pend = path.join(whale, 'bili-whale', 'control', 'pending')
  fs.mkdirSync(drafts, { recursive: true }); fs.mkdirSync(pend, { recursive: true })
  // 草稿文件名就是日期（<day>.json 是事实源），draftForDay 只认这一天
  const mk = (day, id, ackId, extra = {}) => {
    fs.writeFileSync(path.join(drafts, day + '.json'), JSON.stringify({ id, date: day, ackId, status: 'pending' }))
    fs.writeFileSync(path.join(pend, ackId + '.json'), JSON.stringify({ token: 'tk-' + ackId, used: false, expiresAt: Date.now() + 3600_000, payload: { draftId: id }, ...extra }))
  }
  mk('2026-10-31', 'dyn-20261031-aaa', 'ack-a')
  assert.equal(freshAckToken(draftForDay('2026-10-31', drafts), whale), 'tk-ack-a', '有效令牌才给')
  mk('2026-11-01', 'dyn-20261101-bbb', 'ack-b', { used: true })
  assert.equal(freshAckToken(draftForDay('2026-11-01', drafts), whale), null, '已用过 = 没有')
  mk('2026-11-02', 'dyn-20261102-ccc', 'ack-c', { expiresAt: Date.now() - 1 })
  assert.equal(freshAckToken(draftForDay('2026-11-02', drafts), whale), null, '过期 = 没有')
  mk('2026-11-03', 'dyn-20261103-ddd', 'ack-d', { payload: { draftId: 'other' } })
  assert.equal(freshAckToken(draftForDay('2026-11-03', drafts), whale), null, '绑定不符 = 没有')
  assert.equal(draftForDay('2026-11-04', drafts), null, '没那天的草稿文件 = null，不去别的草稿兜底')
})

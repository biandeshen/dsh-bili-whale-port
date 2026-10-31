// 世界页契约：小鱼 · 鱼缸（2026-10-31 功能聚合）——面板清单/灯上限/写方法不得进 GET 白名单
import test from 'node:test'
import assert from 'node:assert/strict'
import { BILI_ACCOUNT } from '../src/worlds/bili-account/definition.ts'

const decl = BILI_ACCOUNT.create().webUi('zh')

test('鱼缸页声明：6 块面板、id 合法且唯一、灯 ≤7', () => {
  assert.equal(decl.label, '小鱼 · 鱼缸')
  const panels = decl.panels ?? []
  assert.deepEqual(panels.map((p) => p.id).sort(), ['diary', 'drafts', 'feedback', 'tank', 'timeline', 'vitals'])
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

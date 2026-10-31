// 令牌的取法：宿主自动放行走环境变量，不进 argv（argv 同机可读）。
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveToken } from '../../scripts/dynamic-approve.mjs'

const A = (env = {}) => resolveToken(['node', 'dynamic-approve.mjs', 'approve', 'dyn-20261101-abc', '--token-env', 'CORTICO_ACK_TOKEN', '--go'], env)

test('--token-env 从环境变量取，且优先于 --token', () => {
  assert.equal(A({ CORTICO_ACK_TOKEN: 'T-from-env' }), 'T-from-env')
  assert.equal(resolveToken(['approve', 'x', '--token-env', 'V', '--token', 'T-plain'], { V: 'T-from-env' }), 'T-from-env')
})

test('环境变量缺失/空 → 空串（由 approve 的状态机拒绝，不降级成"无令牌也发"）', () => {
  assert.equal(A({}), '')
  assert.equal(A({ CORTICO_ACK_TOKEN: '' }), '')
})

test('--token 仍可人工使用；两个都没给 → 空串', () => {
  assert.equal(resolveToken(['approve', 'x', '--token', 'T-plain'], {}), 'T-plain')
  assert.equal(resolveToken(['approve', 'x'], {}), '')
})

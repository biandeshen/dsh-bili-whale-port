// 回归：宿主 WorldCtx.log 是 **Logger 对象**（info/warn/error/emit/child），不是函数。
// 2026-11-13 起实例实测：适配器写成 host.log?.(level, msg) → TypeError: host.log is not a function
// → 宿主把 bili-account 世界列入 missing[] 跳过，她的整条 B 站能力静默消失。
// ?. 只挡 undefined，不挡"值不是函数"，所以这条必须用真实的 Logger 形状钉住。
import test from 'node:test'
import assert from 'node:assert/strict'
import { emitHostLog } from '../src/index.ts'

test('Logger 对象形状：按 level 调用对应方法', () => {
  const calls = []
  const logger = {
    info: (m) => calls.push(['info', m]),
    warn: (m) => calls.push(['warn', m]),
    error: (m) => calls.push(['error', m]),
    child: () => logger,
  }
  emitHostLog(logger, 'warn', '冷却中')
  assert.deepEqual(calls, [['warn', '冷却中']])
})

test('Logger 对象缺该方法时退回 emit', () => {
  const calls = []
  const logger = { emit: (level, m) => calls.push([level, m]) }
  emitHostLog(logger, 'error', '炸了')
  assert.deepEqual(calls, [['error', '炸了']])
})

test('函数形状照常（旧宿主 / stub 可能就这么给）', () => {
  const calls = []
  emitHostLog((level, m) => calls.push([level, m]), 'info', '起来了')
  assert.deepEqual(calls, [['info', '起来了']])
})

test('不给日志口时什么都不做，也不抛', () => {
  assert.doesNotThrow(() => emitHostLog(undefined, 'info', 'x'))
  assert.doesNotThrow(() => emitHostLog(null, 'info', 'x'))
})

test('日志本身抛错不许拖垮调用方', () => {
  const logger = { warn: () => { throw new Error('磁盘满了') } }
  assert.doesNotThrow(() => emitHostLog(logger, 'warn', 'x'))
})

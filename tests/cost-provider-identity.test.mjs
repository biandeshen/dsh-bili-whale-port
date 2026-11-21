// 换 provider 之后，旧 provider 的 402 不许继续拦（2026-11-21 真机验收发现）。
//
// 现场：把 activeProvider 从 mimo 换成本地 lmstudio，实例起来第一件事却是
//   「上游不通，心跳退避 2 分钟（额度被拒 402）lastFailure: 2026-11-14」
// 那 141 条 402 全是六天前 mimo 的账。她拿着别人的欠费记录不敢动。
//
// 上轮（记忆域分析②那条）刚把"跨天不许把失败扔掉"修好——那是对的：
// 欠费不会因为过了零点就好。但**换端点是另一回事**：mimo 欠费跟 lmstudio 无关。
//
// 判据：成本账要能按 provider 过滤；换了端点就等于换了一条通道。
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readCostToday } from '../packages/capabilities/cap-state-rhythm/src/cost-today.ts'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prov-'))
const DAY = '2026-11-21'

function row({ instance, model, status, input, at }) {
  return JSON.stringify({
    version: 2,
    attempt: {
      id: 'x', generationId: 'g', ordinal: 0,
      origin: { instance, module: 'openai-responses-compat', model },
      startedAt: at,
      outcome: input ? 'success' : 'failed',
      status,
      meters: { input },
    },
  })
}

test('换了 provider：旧 provider 的 402 不参与新的停摆判定', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  // 六天前 mimo 欠费的旧账
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), [
    row({ instance: 'mimo', model: 'mimo-v2.6-flash', status: 402, input: null, at: '2026-11-14T16:07:00.834Z' }),
  ].join('\n') + '\n', 'utf8')

  // 新端点（lmstudio）今天还没有任何调用
  const c = readCostToday({
    dataDir: dir, basis: 'utc', now: Date.parse(`${DAY}T03:00:00.000Z`),
    provider: 'lmstudio',
  })
  assert.notEqual(c.verdict, 'stalled-auth', 'mimo 的 402 不该让 lmstudio 被判停摆')
  assert.equal(c.verdict, 'quiet', '新端点今天还没调用过 → quiet')
  assert.equal(c.last402At, '', '不该把别的端点的 402 时间报出来')
})

test('同一 provider 的 402 仍然算数（不能因为过滤把真停摆漏掉）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), [
    row({ instance: 'lmstudio', model: 'qwen3.5-9b', status: 402, input: null, at: `${DAY}T01:00:00.000Z` }),
  ].join('\n') + '\n', 'utf8')
  const c = readCostToday({
    dataDir: dir, basis: 'utc', now: Date.parse(`${DAY}T03:00:00.000Z`),
    provider: 'lmstudio',
  })
  assert.equal(c.verdict, 'stalled-auth', '同一个端点的 402 必须继续拦')
})

test('新端点成功调用后 → ok，哪怕老端点还挂着 402', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), [
    row({ instance: 'mimo', model: 'mimo-v2.6-flash', status: 402, input: null, at: '2026-11-14T16:07:00.834Z' }),
    row({ instance: 'lmstudio', model: 'qwen3.5-9b', status: 200, input: 1200, at: `${DAY}T02:00:00.000Z` }),
  ].join('\n') + '\n', 'utf8')
  const c = readCostToday({
    dataDir: dir, basis: 'utc', now: Date.parse(`${DAY}T03:00:00.000Z`),
    provider: 'lmstudio',
  })
  assert.equal(c.verdict, 'ok', '本端点成功过就是通的')
  assert.equal(c.calls, 1, '只数本端点这次')
})

test('不传 provider 时行为与旧版一致（向后兼容，老调用点不受影响）', (t) => {
  const dir = tmp(); t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'usage.jsonl'), [
    row({ instance: 'mimo', model: 'mimo-v2.6-flash', status: 402, input: null, at: '2026-11-14T16:07:00.834Z' }),
  ].join('\n') + '\n', 'utf8')
  const c = readCostToday({ dataDir: dir, basis: 'utc', now: Date.parse(`${DAY}T03:00:00.000Z`) })
  assert.equal(c.verdict, 'stalled-auth', '不传就按全部历史算——老行为不许变')
})

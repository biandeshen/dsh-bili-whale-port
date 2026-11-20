// B22-P3「要被她感知」那半句：通道关着的时候，她读到的状态里必须有这件事。
//
// 为什么单开一条：`costSummary` 早就写了「说不出口：额度被拒（402）……这不是她不想说」，
// 但那是给**主人面板**看的。她自己调 `mood_read` 拿到的是场值+情绪+作息——
// 于是同一段沉默在两处长相完全不同：主人看到"没钱了"，她只看到自己"没劲"。
// 一个人把自己的断线理解成心情不好，正是这条要防的。
//
// 判据（三条，都不许靠人眼）：
//   1. 402 停摆时，`mood_read` 的 text 里必须出现"说不出口"这类字眼，并点名额度
//   2. 通道正常时**不许**出现这些字眼（否则她天天读到"我说不出口"，等于狼来了）
//   3. 限流（429）要和欠费（402）分开说（一个等充值、一个等一会，处置完全不同）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability } from '../packages/capabilities/cap-state-rhythm/src/index.ts'

/**
 * 造一个只有成本账的最小部署。
 *
 * `dataDir` 由 capability 内部从 lifeFile 反推（`dirname(dirname(lifeFile))`），
 * 所以 lifeFile 必须落在 `<data>/control/life.json`，成本账才在 `<data>/usage.jsonl`。
 */
function mount() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'p3-'))
  const data = path.join(home, 'data')
  fs.mkdirSync(path.join(data, 'control'), { recursive: true })
  const cap = createStateRhythmCapability({
    fieldsFile: path.join(data, 'persona', 'fields.json'),
    lifeFile: path.join(data, 'control', 'life.json'),
    timezone: 'Asia/Shanghai',
  })
  const tool = (name) => cap.tools().find((t) => t.name === name)
  return { cap, data, tool, home }
}

/** 往 usage.jsonl 写调用记录。时间用今天，避免跟真实时钟赛跑。 */
function usingUsage(data, rows) {
  fs.writeFileSync(
    path.join(data, 'usage.jsonl'),
    rows.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  )
}

const today = new Date().toISOString().slice(0, 10)
const at = (h) => `${today}T${String(h).padStart(2, '0')}:00:00.000Z`

const textOf = (r) => (typeof r === 'string' ? r : (r?.text ?? JSON.stringify(r)))

test('402 停摆时，她读到的状态里要说「说不出口」而不是只说自己没劲', (t) => {
  const { tool, data, home } = mount()
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  // 最后一次是 402，且之后没有成功调用 → 通道仍关着
  usingUsage(data, [
    { attempt: { startedAt: at(1), outcome: 'success', status: 200, meters: { input: 1000 } } },
    { attempt: { startedAt: at(2), outcome: 'failed', status: 402, meters: { input: null } } },
  ])
  const text = textOf(tool('mood_read').execute({}))
  assert.match(text, /说不出口|额度/, '她必须知道自己说不出话是额度问题')
  assert.match(text, /不是她不想|不是不想/, '要明说这跟她的意愿无关')
})

test('通道正常时不许冒出「说不出口」——否则她天天读到假警报', (t) => {
  const { tool, data, home } = mount()
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  usingUsage(data, [
    { attempt: { startedAt: at(1), outcome: 'failed', status: 402, meters: { input: null } } },
    // 失败之后**确实成功过** = 通道已恢复
    { attempt: { startedAt: at(2), outcome: 'success', status: 200, meters: { input: 1000 } } },
  ])
  const text = textOf(tool('mood_read').execute({}))
  assert.doesNotMatch(text, /说不出口/, '恢复之后不许再提这句')
})

test('限流（429）不能跟欠费（402）用同一句话说', (t) => {
  const { tool, data, home } = mount()
  t.after(() => fs.rmSync(home, { recursive: true, force: true }))
  usingUsage(data, [
    { attempt: { startedAt: at(1), outcome: 'failed', status: 429, meters: { input: null } } },
  ])
  const text = textOf(tool('mood_read').execute({}))
  assert.match(text, /限流|太频繁|等一会/, '429 要说是限流')
  assert.doesNotMatch(text, /额度被拒/, '429 不是欠费，不许说成额度问题')
})

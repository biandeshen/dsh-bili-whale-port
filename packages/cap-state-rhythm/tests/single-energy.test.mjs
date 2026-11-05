/**
 * 同一次请求里她的体力只能有一个值（审计 §1.4）。
 *
 * 主人同屏看到过：SYSTEM 段 `【状态】体力38 刺激80…` 与同批 user 注入 `【状态】体力88 刺激80…`
 * **同时在场**。根因不是算错，是**两条注入路径不同源**：
 *   · 会话级前缀 `contextSegments` —— 宿主整场只建一次（loop.ts:1020 新会话 / :1717 交接），
 *     长会话里它就是旧值；
 *   · 每事件级注入 `onMessageDelivery` —— 每次都重读，是新值。
 *
 * 修法：**场值数字只出现在每事件注入这一条路上**；
 * 会话级前缀只说"数值随每条消息一起到"，不带会过期的数字。
 * 这样同一次请求里只有一个真值，她不会拿到自相矛盾的身体状态。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createStateRhythmCapability } from '../src/index.ts'

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-energy-'))
  const fieldsFile = path.join(dir, 'fields.json')
  const lifeFile = path.join(dir, 'life.json')
  const cap = createStateRhythmCapability({ fieldsFile, lifeFile })
  return { dir, fieldsFile, lifeFile, cap }
}

const NUM_LINE = /【状态】体力\d/

test('会话级前缀不带场值数字（它整场只建一次，会变旧）', async () => {
  const { cap } = setup()
  const segs = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const text = segs.map((s) => s.text).join('\n')
  assert.ok(!NUM_LINE.test(text), `前缀不该带体力数字：${text.match(/【状态】[^\n]*/)?.[0] ?? ''}`)
  assert.match(text, /【状态】/, '还是要有一行状态（只是不带数字）')
  assert.match(text, /具体数值随每条消息一起到/, '要说清数值在哪儿来')
})

test('每事件注入带真值（她每一轮都拿得到自己的体力）', async () => {
  const { cap } = setup()
  const blocks = await cap.onMessageDelivery({
    now: new Date(),
    timezone: 'Asia/Shanghai',
    events: [{ text: '今天下雨了', type: 'console.message' }],
  })
  const text = blocks.join('\n')
  assert.match(text, NUM_LINE, '每事件注入要带场值数字')
  assert.match(text, /体力\d+ 刺激\d+/, '格式照旧（主人看惯了）')
})

test('同一次请求里只有一个真值：前缀无数值，注入有数值，且数值一致', async () => {
  const { cap } = setup()
  const segs = await cap.contextSegments({ now: new Date(), timezone: 'Asia/Shanghai', worlds: [] })
  const blocks = await cap.onMessageDelivery({
    now: new Date(),
    timezone: 'Asia/Shanghai',
    events: [{ text: '在干嘛', type: 'console.message' }],
  })
  const prefixText = segs.map((s) => s.text).join('\n')
  const eventText = blocks.join('\n')
  // 前缀里抓不到数字 → 不可能与注入打架
  assert.ok(!NUM_LINE.test(prefixText))
  const m = eventText.match(/体力(\d+)/)
  assert.ok(m, '注入里要有一个体力值')
  // 而且这个值是此刻的：再读一次应当一样（除非场值真的变了）
  const again = await cap.onMessageDelivery({
    now: new Date(),
    timezone: 'Asia/Shanghai',
    events: [{ text: '在干嘛', type: 'console.message' }],
  })
  assert.match(again.join('\n'), new RegExp(`体力${m[1]}`))
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { buildText, snippetOf } from '../../scripts/draft-dynamic.mjs'

const diary = `# 鲸鱼日记

## 2026-10-29

## 想说

- 29 号的旧内容，不该被 30 号复用。

## 2026-10-30

## 想说

- 09:12 的 Yoga Nidra 段 **六千人给这句话点了赞。** 这是旧段，不该被选中。

## 看过

| 时间 | BV | 标题 | 简介 | 想法 |
| --- | --- | --- | --- | --- |
| 2026-10-29 | BV11Ak4BWEsw | 昨天的雨声 | 旧行 | 不该被 30 号选中 |
| 2026-10-30 | BV1vd4y1y7xj | 【失眠不怕】40min瑜伽休息术，高效补觉，守护早醒/午休/睡前/通宵 - Yoga Nidra（40:01） | 只写了拍摄地在上海 | 看完就完 |

## 想说

- 11:11 的雷雨 283 桶段，这才是今天最后写下的判断。
`

test('buildText：同一天重复「想说」取最后一个，不拿 09:12 旧段出稿', () => {
  const body = buildText(diary, { date: '2026-10-30', max: 120 })
  assert.match(body, /雷雨 283 桶/)
  assert.doesNotMatch(body, /Yoga Nidra 段/)
  assert.doesNotMatch(body, /29 号的旧内容/)
  assert.doesNotMatch(body, /昨天的雨声/)
  assert.match(body, /失眠不怕/)
})

test('buildText：截断落在 ** 中间时补齐闭合，不把 ** 原样发出去', () => {
  const long = '## 2026-10-30\n\n## 想说\n\n- ' + '长'.repeat(80) + '**重点内容**' + '尾'.repeat(30) + '\n'
  const body = buildText(long, { date: '2026-10-30', max: 60 })
  assert.equal((body.match(/\*\*/g) || []).length % 2, 0, body)
})

test('snippetOf：书名在逗号处收短，不截成《…高效补》', () => {
  const s = snippetOf('看过《【失眠不怕】40min瑜伽休息术，高效补觉，守护早醒/午休/睡前/通宵 - Yoga Nidra》（李冉在冥想）', 'npc')
  assert.equal(s, '【失眠不怕】40min瑜伽休息术')
})

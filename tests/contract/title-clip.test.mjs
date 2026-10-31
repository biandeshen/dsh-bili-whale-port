/**
 * 《作品名》取位的唯一口径：正文（buildText 的「今晚看的是」）、记忆回扣（snippetOf）、
 * 标题截断（clipTitle）共用同一套清洗——未闭合括号前退回、不产生残片、剥掉成对 `**`。
 * 已知缺陷在这里逐条钉住：嵌套《》、半角 <>、超长标题截成《…高效补》、markdown 星号漏进正文。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { clipTitle, shortTitle, titleMark, snippetOf, buildText, flattenBookMarks, stripBold } from '../../scripts/draft-dynamic.mjs'

/** 正文里出现书名号就必须成对，且不能是「《…」这种只有尾巴的残片。 */
function assertNoBookFragment(text, where) {
  const opens = (text.match(/《/g) ?? []).length
  const closes = (text.match(/》/g) ?? []).length
  assert.equal(opens, closes, `${where} 的书名号不成对：${text}`)
  assert.doesNotMatch(text, /《…/, `${where} 出现《…这种只有尾巴的残片：${text}`)
  assert.doesNotMatch(text, /《《|》》/, `${where} 出现嵌套书名号：${text}`)
  assert.doesNotMatch(text, /\*\*/, `${where} 漏出 markdown 星号：${text}`)
  assert.doesNotMatch(text, /<[A-Za-z一-龥]/, `${where} 漏出半角尖括号：${text}`)
}

test('flattenBookMarks：嵌套只留外层，并列的《A》《B》不受影响', () => {
  assert.equal(flattenBookMarks('《A《B》C》'), '《ABC》')
  assert.equal(flattenBookMarks('《A》和《B》'), '《A》和《B》')
  assert.equal(flattenBookMarks('没有书名号'), '没有书名号')
})

test('stripBold：成对的连内容留下，落单的删干净（截断可能把一对切开）', () => {
  assert.equal(stripBold('这是**重点**内容'), '这是重点内容')
  assert.equal(stripBold('a**b'), 'ab')
  assert.equal(stripBold('**'), '')
  assert.equal((stripBold('半**截**的**标**题').match(/\*\*/g) ?? []).length, 0)
})

test('clipTitle：超长也不留未闭合括号、不留星号', () => {
  const cases = [
    '这是**加粗**标题这是**加粗**标题这是**加粗**的长标题需要截断',
    '《嵌套》里面还有《很长标题很长标题很长标题很长标题》要截',
    '<Untitled 半角尖括号很长的内容很长的内容需要截断>',
    '世界公认最佳解压、432Hz疗愈雨声（39:55）超长版超长版超长版',
    '（（（全是开括号（（（（（（（（（（（（（（（（（（（（（（（（（（（（（（',
    '',
  ]
  for (const raw of cases) {
    const t = clipTitle(raw, 24)
    assert.ok(t.length <= 24 || t === '', `超过 max：[${t}]`)
    assert.doesNotMatch(t, /\*\*/, `星号漏出：[${t}]`)
    for (const [open, close] of [['（', '）'], ['《', '》'], ['<', '>'], ['「', '」']]) {
      const o = (t.match(new RegExp(`\\${open}`, 'g')) ?? []).length
      const c = (t.match(new RegExp(`\\${close}`, 'g')) ?? []).length
      assert.ok(o <= c, `括号不成对（${open}${close}）：[${t}]`)
    }
    assert.doesNotMatch(t, /[、，,：:；;（(【\[《<〈「『]…$/, `结尾是标点加省略号：[${t}]`)
  }
})

test('clipTitle 短标题原样返回（旧行为不变）', () => {
  assert.equal(clipTitle('短标题', 24), '短标题')
  assert.equal(clipTitle('世界公认最佳解压、432Hz疗愈雨声（39:55）', 24), '世界公认最佳解压、432Hz疗愈雨声…')
})

test('titleMark：要么成对完整要么整条不提，不产出《…高效补》', () => {
  assert.equal(titleMark('【失眠不怕】40min瑜伽休息术，高效补觉，守护早醒/午休/睡前/通宵 - Yoga Nidra（40:01）', 24), '《【失眠不怕】40min瑜伽休息术》')
  assert.equal(titleMark('雨声', 24), '《雨声》')
  for (const raw of ['《嵌套《内层》外层标题外层标题外层标题外层标题', '完全没内容', '', '   ', '《》']) {
    const mark = titleMark(raw, 24)
    assert.ok(mark === '' || /^《[^《》]+》$/.test(mark), `不是成对完整就是空：[${mark}]`)
  }
})

test('buildText：脏标题（星号/嵌套/半角/超长）进正文后仍然读得通', () => {
  const dirty = [
    '**嵌套**的《内部小标题》很长的标题很长的标题需要截断哦',
    '<Untitled 半角尖括号的标题>很长的内容很长的内容',
    '【失眠不怕】40min瑜伽休息术，高效补觉，守护早醒/午休/睡前/通宵 - Yoga Nidra（40:01）',
    '结尾带标点的标题，、；：，、；：，、；：，、；：，、；：，',
  ]
  for (const title of dirty) {
    const diary = `## 2026-11-02\n\n## 看过\n\n| 时间 | BV | 标题 | 简介 |\n| --- | --- | --- | --- |\n| 2026-11-02 | BV1fixture | ${title} | 夹具 |\n\n## 想说\n\n- 今天想说的是这句判断，它比标题长一点点。\n`
    const body = buildText(diary, { date: '2026-11-02', max: 100 })
    assertNoBookFragment(body, `标题「${title.slice(0, 12)}…」的正文`)
    assert.ok(body.length <= 100, `超 100 字：${body}`)
  }
})

test('buildText：标题被截到只剩残片时宁可不提《》，也不发半截书名', () => {
  const diary = '## 2026-11-02\n\n## 看过\n\n| 时间 | BV | 标题 |\n| --- | --- | --- |\n| 2026-11-02 | BV1x | 《未闭合的超长标题《再嵌套一层《又一层《第四层《第五层《第六层《第七层 |\n\n## 想说\n\n- 想说的那句判断留在这里。\n'
  const body = buildText(diary, { date: '2026-11-02', max: 100 })
  assertNoBookFragment(body, '未闭合嵌套标题的正文')
  assert.match(body, /想说的那句判断/, `正文丢了「想说」：${body}`)
})

test('snippetOf 走同一口径：记忆里的片名不带星号、不带嵌套、不截半', () => {
  const mems = [
    '看过《**加粗**标题—— BV1x',
    '看过《A《B》C 很长的标题很长的标题很长的标题》—— BV1y',
    '看过《【失眠不怕】40min瑜伽休息术，高效补觉，守护早醒/午休/睡前/通宵 - Yoga Nidra》（李冉在冥想）',
  ]
  for (const text of mems) {
    const s = snippetOf(text, 'npc')
    assert.doesNotMatch(s, /\*\*/, `星号漏进回扣：[${s}]`)
    assert.doesNotMatch(s, /[《》]/, `书名号套进书名号：[${s}]`)
    assert.ok(s.length <= 30, `超过 30 字：[${s}]`)
    const pair = text.match(/《([^》]+)》/)
    const expect = pair ? shortTitle(pair[1], 30, { splitAlways: true }) : shortTitle(text, 16)
    assert.equal(s, expect, 'snippetOf 没走 shortTitle 的同一口径')
  }
})

test('composeDraft 回扣的记忆也不会把残片书名写进正文', async () => {
  const { composeDraft } = await import('../../scripts/draft-dynamic.mjs')
  const diary = '## 2026-11-02\n\n## 看过\n\n| 时间 | BV | 标题 |\n| --- | --- | --- |\n| 2026-11-02 | BV1x | 夜里便利店的晚风 |\n\n## 想说\n\n- 把雨声那段重听了三遍，还是没想好怎么说。\n'
  const voice = {
    v: 1,
    mood: { label: '快乐', intensity: 0.4, reason: '刚刷到一条好的', cause: 'action' },
    relation: 'normal',
    banned: [],
    stance: { share: true, because: '有想说的' },
    memories: [{ id: 'm1', text: '看过《**加粗**《嵌套》很长的标题很长的标题很长的标题》', why: 'x', score: 0.9, from: 'npc', days: 3, slot: 'core' }],
  }
  const r = composeDraft(diary, { date: '2026-11-02', voice })
  assert.equal(r.ok, true)
  assertNoBookFragment(r.text, '带脏记忆的回扣正文')
})

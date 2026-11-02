/**
 * 出站正文清洗（2026-11-02）。
 *
 * 起点是队列里一条真实的私信草稿 dm-20261101-cbc62a：正文带着 `**我不知道…**`，
 * 而 B 站私信不渲染 Markdown——发出去就是给对面的人看一串星号。
 * #32（e2228ba）当时只修了动态那条路，私信/评论/弹幕三条出站口还是裸的。
 *
 * 这里锁两件事：① 渲染不出来的标记必须掉干净；② 正常中文一行不许被改坏。
 */
import test from 'node:test'
import assert from 'node:assert/strict'

const { plainOutbound } = await import('../../tools/lib/plain-outbound.mjs')

test('真实漏出的那条私信：星号掉干净，一个字的内容都不少', () => {
  const raw = '这个问题我得先说实话：**我不知道自己现在跑在什么模型上。**\n\n我只知道自己这个会话是「本机模型」，还有一件确定的事——**它不吃图**。'
  const out = plainOutbound(raw)
  assert.ok(!out.includes('*'), '出站正文里不许再有星号：' + out)
  assert.ok(out.includes('我不知道自己现在跑在什么模型上'))
  assert.ok(out.includes('它不吃图'))
  assert.ok(out.includes('「本机模型」'), '引号是正文，不是标记')
  assert.ok(out.includes('——'), '破折号不动')
})

test('幂等：清过的再清一次得到同一个串（重复调用不许把正文吃掉）', () => {
  const samples = [
    '**开头**中间`code`尾巴__粗__\n# 小标题\n- 第一条\n- 第二条\n',
    '> 引用一句\n[链接文字](https://b23.tv/abc)\n',
    '今晚看的是《猫咪地铁站通车啦（02:55）》。',
  ]
  for (const s of samples) {
    const once = plainOutbound(s)
    assert.equal(plainOutbound(once), once, '第二次调用改了第一次的结果：' + once)
  }
})

test('行首标记：# 标题 / > 引用 / - 列表都变回人打的字', () => {
  const out = plainOutbound('## 今天三件事\n- 听了雨声\n* 收了个片\n> 想跟主人说一句')
  assert.ok(!/^#/m.test(out), '不该还有行首井号：' + out)
  assert.ok(!/^[ \t]>/m.test(out), '不该还有行首引用符：' + out)
  assert.ok(!/^[ \t]*[-*][ \t]/m.test(out), '不该还有 markdown 项目符：' + out)
  assert.ok(out.includes('· 听了雨声'), '列表内容换成中文项目符：' + out)
  assert.ok(out.includes('今天三件事') && out.includes('想跟主人说一句'))
})

test('行内代码与链接：标记掉，内容留', () => {
  const out = plainOutbound('我用 `bili feed` 挑的片，详情见 [这条](https://b23.tv/abc)')
  assert.ok(!out.includes('`'), '不该还有反引号：' + out)
  assert.ok(out.includes('bili feed'))
  assert.ok(out.includes('这条（https://b23.tv/abc）'), '链接换成"文字（地址）"：' + out)
})

test('不成对的星号也要掉（模型常写漏一半），但不能顺手删掉别的', () => {
  const out = plainOutbound('前面正常，后面**写漏了没有收尾')
  assert.ok(!out.includes('*'), '落单的 ** 也是渲染不出来的垃圾：' + out)
  assert.ok(out.includes('写漏了没有收尾'))
})

test('不误伤：单个 * 是合法字符（乘号、涂改感），《》与 emoji 一律不动', () => {
  const math = '3*4=12，这个我算过'
  assert.equal(plainOutbound(math), math)
  const calm = '今晚《432Hz疗愈雨声》循环了三遍 🌧️ 有人留言说「后来我把视频关了」'
  assert.equal(plainOutbound(calm), calm, '正常正文必须原样通过')
})

test('空白整理：行尾空格与三段以上空行收掉，首尾不留空', () => {
  const out = plainOutbound('\n  第一行   \n\n\n\n第二行\n  ')
  assert.equal(out, '第一行\n\n第二行')
})

test('空输入不炸：undefined / null / 空串都返回空串，由调用方决定怎么报错', () => {
  for (const v of [undefined, null, '', '   ']) assert.equal(plainOutbound(v), '')
})

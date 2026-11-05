/**
 * 「她的一天」的面板行为（设计交接 story-5：早上打开控制台一眼看到她在干嘛）。
 *
 * 钉三件最容易写歪的事：
 *   ① 读数要说人话——「今天做过 3 件」而不是 `actionsToday: 3`，「4 分钟后」而不是原始时间戳；
 *   ② 空态不许和数据并存（上一周在真浏览器里踩过：21 行 = 1 空态 + 20 条）；
 *   ③ 取不到她的话时要**明说取不到**，不许变成"她没说话"——那是把故障伪装成事实。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { dayPanel } from '../../packages/cap-state-rhythm/src/webui/client.ts'

const now = Date.now()

function snapshot(over = {}) {
  return {
    ok: true,
    rest: over.rest ?? 'awake',
    asleep: (over.rest ?? 'awake') === 'asleep',
    resting: (over.rest ?? 'awake') === 'resting',
    mode: over.mode ?? 'auto',
    sleepWindow: { start: '01:00', end: '07:00' },
    mood: { intensity: 0.8999999, label: '兴奋', secondary: [] },
    fields: { energy: 0.7 },
    described: over.described ?? '她心情不错，体力也够。',
    today: {
      day: new Date().toLocaleDateString('sv-SE'),
      actionsToday: over.actionsToday ?? 3,
      lastActionAt: over.lastActionAt ?? now - 5 * 60_000,
      lastCheckAt: now - 60_000,
      nextCheckAt: over.nextCheckAt ?? now + 4 * 60_000,
      nextInMin: over.nextCheckAt ? Math.round((over.nextCheckAt - now) / 60_000) : 4,
    },
    events: over.events ?? [
      {
        atMs: now - 5 * 60_000, type: 'owner_adjust', description: '主人拉了体力',
        source: 'owner_adjust',
        fieldChanges: [{ field: 'energy', from: 0.6, to: 0.8 }],
      },
      { atMs: now - 40 * 60_000, type: 'diary', description: '写了今天的公开日记', source: 'action', fieldChanges: [] },
    ],
    eventCountToday: (over.events ?? [1, 2]).length,
    eventCountAll: 5,
    recentActions: over.recentActions ?? [],
  }
}

function mountDay(snap, history = { records: [] }) {
  // fetch 每次 mount 都重装一个（测试之间是独立进程，留到进程结束没关系）。
  // 之前在这里"用完就还原"，结果点完按钮再刷新一遍时 stub 已经没了，
  // 页面老老实实报"对话记录读不出来"，把回执挤掉——那是测试的假故障，不是产品的。
  globalThis.fetch = async (url) => {
    if (String(url).includes('/api/session/history')) {
      if (history instanceof Error) throw history
      return { ok: true, json: async () => history }
    }
    return { ok: true, json: async () => ({}) }
  }
  const h = mountPanel({
    get: () => (snap ? { ...snap } : null),
    // 与能力包 wakeNowImpl 同形状的回执（这里只当替身，断言的是页面怎么把它写成人话）
    wakeNow: (p = {}) => ({
      ok: true,
      triggeredAt: Date.now(),
      hint: p.hint ?? '',
      mode: 'auto',
      delivered: true,
      receipt: {
        did: [
          '把作息账的「下一拍」拨到了现在',
          '叫她的话已经投进她的收件队列',
          p.hint ? `带上了你的叮嘱：「${p.hint}」` : '没带叮嘱',
        ],
        notYet: '她这一轮具体做了什么，要等下一拍落进因果账；刷新这一页就看得见。',
      },
    }),
  }, { panelId: 'day' })
  dayPanel.mount(h.ctx)
  return {
    h,
    async done() { await settle(12) },
  }
}

/** 按宿主的 .stat 形状取读数：`.k` 是名字，`.v` 是值（中间没有冒号，别按拼出来的句子断言） */
function statValue(h, name) {
  const out = []
  const walk = (el) => {
    if (String(el.className).split(' ').includes('stat')) {
      const kids = { k: '', v: '' }
      for (const c of el.children) {
        if (String(c.className).split(' ').includes('k')) kids.k = c.textContent.trim()
        if (String(c.className).split(' ').includes('v')) kids.v = c.textContent.trim()
      }
      out.push(kids)
    }
    for (const c of el.children) walk(c)
    return out
  }
  const found = walk(h.root).find((s) => s.k === name)
  return found ? found.v : null
}

test('读数说人话：件数、倒计时、百分比，而不是字段名和原始浮点', async () => {
  const { h, done } = mountDay(snapshot())
  await done()
  assert.equal(statValue(h, '今天做过'), '3 件')
  assert.equal(statValue(h, '下一拍'), '4 分钟后')
  assert.equal(statValue(h, '离上次行动'), '5 分钟前')
  assert.equal(statValue(h, '心情强度'), '90%')
  const text = h.root.textContent
  assert.doesNotMatch(text, /actionsToday/, '不该把字段名摊给主人看')
  assert.doesNotMatch(text, /0\.8999/, '不该把原始浮点摊在页面上')
  assert.match(text, /她醒着/)
  assert.match(text, /自然节律/, '模式也要中文')
})

test('三态各有说法：睡着 / 歇着 / 醒着不是一句话糊过去', async () => {
  for (const [rest, expect] of [['asleep', /她睡着了/], ['resting', /她在歇着/], ['awake', /她醒着/]]) {
    const { h, done } = mountDay(snapshot({ rest }))
    await done()
    assert.match(h.root.textContent, expect, `${rest} 应当说成对应那句人话`)
  }
})

test('今天做过的小事：她记下的行动按时间列出来（不只是一句"3 件"）', async () => {
  const { h, done } = mountDay(snapshot({
    actionsToday: 2,
    recentActions: [
      { at: now - 10 * 60_000, activity: 'exercise', label: '动一动', note: '原地跑了一小会儿' },
      { at: now - 2 * 3_600_000, activity: 'reflect', label: '想想事' },
    ],
  }))
  await done()
  const text = h.root.textContent
  assert.match(text, /今天做过的小事/)
  assert.match(text, /动一动/)
  assert.match(text, /原地跑了一小会儿/)
  assert.match(text, /10 分钟前/)
  assert.doesNotMatch(text, /今天还没有记过一笔/, '有行动回执时不许再铺空态')
})

test('没有行动回执时把话说清：空着不丢人，假数更坏', async () => {
  const { h, done } = mountDay(snapshot({ actionsToday: 0, recentActions: [] }))
  await done()
  assert.match(h.root.textContent, /今天还没有记过一笔/)
})

test('有流水时不出现空态文案（回归：空态行与数据行并存）', async () => {
  const { h, done } = mountDay(snapshot())
  await done()
  assert.doesNotMatch(h.root.textContent, /今天还没有记录/, '有两条事件时不该铺空态')
  assert.match(h.root.textContent, /主人拉了体力/)
  assert.match(h.root.textContent, /写了今天的公开日记/)
})

test('今天什么都没有时才说"今天还没有记录"', async () => {
  const { h, done } = mountDay(snapshot({ events: [], actionsToday: 0 }))
  await done()
  assert.match(h.root.textContent, /今天还没有记录/)
})

test('她最近说了什么：取到就引用，取不到就明说是取不到', async () => {
  const { h, done } = mountDay(snapshot(), {
    records: [
      { ts: new Date(now - 3 * 60_000).toISOString(), item: { type: 'message', role: 'assistant', content: [{ type: 'text', text: '今天那条雨声的片子我看了三遍。' }] } },
      { ts: new Date(now - 2 * 60_000).toISOString(), item: { type: 'message', role: 'user', content: [{ type: 'text', text: '主人的话不该出现在她的发言里' }] } },
      { ts: new Date(now - 60_000).toISOString(), item: { type: 'message', role: 'assistant', content: [{ type: 'text', text: '要不要我把那条也发出去？' }] } },
    ],
  })
  await done()
  const text = h.root.textContent
  assert.match(text, /要不要我把那条也发出去/)
  assert.match(text, /今天那条雨声的片子/)
  assert.doesNotMatch(text, /主人的话不该出现/, '只引她自己的话，别把主人的话混进"她说了什么"')

  const broken = mountDay(snapshot(), new Error('404 未授权'))
  await broken.done()
  assert.match(broken.h.root.textContent, /对话记录读不出来/, '取不到要明说')
  assert.doesNotMatch(broken.h.root.textContent, /还没开口/, '不许把故障写成"她没说话"')
})

test('来源列说中文：她账上真出现过的值不能再摊英文，缺来源也不许印出 undefined', async () => {
  const { h, done } = mountDay(snapshot({
    events: [
      { atMs: now - 60_000, type: 'wake', description: '被人叫醒了一拍', source: 'wake', fieldChanges: [] },
      { atMs: now - 120_000, type: 'rest', description: '她歇了一会儿', source: 'rest', fieldChanges: [] },
      { atMs: now - 180_000, type: 'watchedKeep', description: '看完一条，收了', source: 'watchedKeep', fieldChanges: [] },
      { atMs: now - 240_000, type: 'watchedDrop', description: '看完一条，没收', source: 'watchedDrop', fieldChanges: [] },
      { atMs: now - 300_000, type: 'watchedUnclear', description: '看完一条，没判断出来', source: 'watchedUnclear', fieldChanges: [] },
      { atMs: now - 360_000, type: 'old_entry', description: '一条没写来源的旧账', fieldChanges: [] },
    ],
    eventCountToday: 6,
  }))
  await done()
  const text = h.root.textContent
  for (const cn of ['被人叫醒了', '她歇了一会儿', '看完一条，收了', '看完一条，没收', '看完一条，没判断出来']) {
    assert.match(text, new RegExp(cn), `来源列应当翻成中文（这些值她账上真在写）：缺 ${cn}`)
  }
  assert.match(text, /没记来源/, '缺 source 的旧条目要有中文说法')
  assert.doesNotMatch(text, /undefined/, 'String(undefined) 会印出 "undefined" 这个词，不能出现在页面上')
})

test('「戳醒她」不弹确认（可重复、不对外写），但回执要说清做了什么、还没看到什么', async () => {
  const { h, done } = mountDay(snapshot())
  await done()
  const poke = h.findButton('戳醒她')
  assert.ok(poke, '落地页要有这一颗')
  const inputs = []
  const walkIn = (el) => { if (el.tagName === 'INPUT') inputs.push(el); for (const c of el.children) walkIn(c) }
  walkIn(h.root)
  const hint = inputs.find((i) => String(i.placeholder).includes('叮嘱'))
  assert.ok(hint, '要有叮嘱输入框')
  hint.value = '先回那条私信'

  const before = h.confirms.length
  await h.click(poke)
  await done()
  assert.equal(h.confirms.length, before, '这一颗不该弹确认层（confirm fatigue 是要付钱的）')
  const call = h.calls.filter((c) => c.method === 'wakeNow').at(-1)
  assert.deepEqual(call.args[0], { hint: '先回那条私信' })
  const text = h.msgText()
  assert.match(text, /把作息账的「下一拍」拨到了现在/, '回执要写做了什么')
  assert.match(text, /带上了你的叮嘱/, '回执要确认叮嘱进去了')
  assert.match(text, /还没看到：.*因果账/, '回执不许承诺"她这一轮会说什么"')
  assert.equal(h.textareas().length >= 0, true)
  const hintAfter = []
  const walkAfter = (el) => { if (el.tagName === 'INPUT') hintAfter.push(el); for (const c of el.children) walkAfter(c) }
  walkAfter(h.root)
  assert.equal(hintAfter.find((i) => String(i.placeholder).includes('叮嘱')).value, '', '戳完要清掉叮嘱框')
})

test('这一页把控制入口指回鱼缸，自己不放滑块', async () => {
  const { h, done } = mountDay(snapshot())
  await done()
  const btns = []
  const walk = (el) => { if (el.tagName === 'BUTTON') btns.push(el.textContent.trim()); for (const c of el.children) walk(c) }
  walk(h.root)
  assert.deepEqual(btns, ['👉 戳醒她，跑一轮'], `落地页只该有这一颗按钮，实得 ${btns.join('、')}`)
  assert.match(h.root.textContent, /鱼缸/)
  assert.match(h.root.textContent, /待放行改稿台/)
})

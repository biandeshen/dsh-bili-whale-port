/**
 * 版本历史的「回滚到此」——面板上以前没有这颗键（设计走查 story-7：描述里承诺"可回退"，
 * 页面上只有"看改动"）。后端 `rollback` 与 `checkpoint` 一直是全的，缺的是入口。
 *
 * 回滚是丢数据的操作（`reset --hard <tag>` + `clean -fd`），所以这里同时钉：
 *   · 没有存档点时不许假装能回滚；
 *   · 确认层必须写清丢什么、未跟踪文件也会被清、有未提交改动时要点名；
 *   · 取消就一条请求都不发。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mountPanel, settle } from '../helpers/panel-harness.mjs'
import { memoryCenterPanel } from '../../packages/cap-memory/src/webui/client.ts'

function historyRes(over = {}) {
  return {
    ok: true,
    status: {
      available: true,
      repo: true,
      dirty: over.dirty ?? false,
      head: 'abc1234',
      lastCommit: null,
      // 形状照 packages/cap-memory/tests/git-history.test.mjs 里真 git 返回的 checkpoints
      // （CheckpointInfo：name/message/hash/date）。这里别再凭想象造字段——上一版照 `tags: string[]`
      // 之外的想象写成对象，离线全绿、线上渲染出 `undefined`。
      checkpoints: over.checkpoints ?? [
        { name: 'checkpoint0', message: '出厂基线', hash: 'aaa0000', date: '2026-11-01T10:00:00+08:00' },
        { name: '改雨声偏好前', message: '改雨声偏好前', hash: 'bbb1111', date: '2026-11-05T08:00:00+08:00' },
      ],
    },
    log: [
      { hash: 'abc1234', author: '小鱼', message: 'memory: 记下「今天那条雨声」' },
      { hash: 'def5678', author: 'owner', message: 'memory: 修改「主人喜欢雨声」' },
    ],
  }
}

function mountHist(res) {
  const state = { rollbacks: [] }
  const h = mountPanel({
    list: () => ({ ok: true, counts: { total: 0, core: 0, active: 0, archived: 0, voided: 0 }, items: [] }),
    history: (p = {}) => {
      if (p?.diffOf) return { ok: true, diff: `diff of ${p.diffOf}` }
      return { ...res }
    },
    rollback: (p = {}) => {
      state.rollbacks.push({ ...p })
      if (p?.confirm !== true) return { ok: false, error: '回滚会丢弃该 checkpoint 之后的所有记忆与日记改动，需显式传 confirm: true' }
      return { ok: true, rolledBackTo: p.name }
    },
  }, { panelId: 'memory-center' })
  memoryCenterPanel.mount(h.ctx)
  return { h, state }
}

const openHistory = async (h) => {
  await h.click(h.findButton('查看版本历史'))
}

test('存档点列出来了，每个都带一颗「回滚到这里」', async () => {
  const { h } = mountHist(historyRes())
  await settle()
  await openHistory(h)
  assert.match(h.root.textContent, /存档点与回滚/)
  assert.match(h.root.textContent, /出厂基线/)
  assert.ok(!h.root.textContent.includes('undefined'), '字段读空不许漏成 "undefined" 字样（上一版线上就是这样）')
  const btns = []
  const walk = (el) => { if (el.tagName === 'BUTTON') btns.push(el.textContent.trim()); for (const c of el.children) walk(c) }
  walk(h.root)
  assert.equal(btns.filter((t) => /回滚到这里/.test(t)).length, 2, `两个存档点该有两颗键，实得 ${btns.join('、')}`)
  // commit 行仍然只有"看改动"，不冒充可回滚的目标
  assert.ok(btns.includes('看改动'))
})

test('回滚要确认，且确认层写清丢什么；取消就一条请求都不发', async () => {
  const { h, state } = mountHist(historyRes())
  await settle()
  await openHistory(h)
  const back = (() => {
    const found = []
    const walk = (el) => { if (el.tagName === 'BUTTON' && /回滚到这里/.test(el.textContent)) found.push(el); for (const c of el.children) walk(c) }
    walk(h.root)
    return found[1]   // 第二个存档点
  })()
  assert.ok(back)
  h.confirmAnswer = false
  await h.click(back)
  const modal = h.confirms.at(-1)
  assert.match(String(modal.title), /checkpoint0|改雨声偏好前/)
  const bodyText = modal.body.textContent
  assert.match(bodyText, /整个工作区/, '要说清回滚的范围是工作区（记忆 + 日记）')
  assert.match(bodyText, /未跟踪的文件/, 'checkoutTag 会 clean -fd，这句不能藏')
  assert.match(bodyText, /不会被动到/, '因果账/待放行队列不在里面，也要一并说清，免得主人以为全没了')
  assert.equal(state.rollbacks.length, 0, '取消就不该发回滚')
  assert.equal(h.calls.filter((c) => c.method === 'rollback').length, 0)
})

test('有未提交改动时，确认层必须点名它也会被丢掉', async () => {
  const { h } = mountHist(historyRes({ dirty: true }))
  await settle()
  await openHistory(h)
  const back = (() => {
    const found = []
    const walk = (el) => { if (el.tagName === 'BUTTON' && /回滚到这里/.test(el.textContent)) found.push(el); for (const c of el.children) walk(c) }
    walk(h.root)
    return found[0]
  })()
  h.confirmAnswer = true
  await h.click(back)
  assert.match(h.confirms.at(-1).body.textContent, /未提交的改动/)
})

test('答应回滚才发请求，且带上 confirm:true', async () => {
  const { h, state } = mountHist(historyRes())
  await settle()
  await openHistory(h)
  const back = (() => {
    const found = []
    const walk = (el) => { if (el.tagName === 'BUTTON' && /回滚到这里/.test(el.textContent)) found.push(el); for (const c of el.children) walk(c) }
    walk(h.root)
    return found[1]
  })()
  h.confirmAnswer = true
  await h.click(back)
  assert.deepEqual(state.rollbacks, [{ name: '改雨声偏好前', confirm: true }])
})

test('没有存档点时不许假装能回滚', async () => {
  const { h } = mountHist(historyRes({ checkpoints: [] }))
  await settle()
  await openHistory(h)
  assert.match(h.root.textContent, /还没有存档点/)
  const btns = []
  const walk = (el) => { if (el.tagName === 'BUTTON') btns.push(el.textContent.trim()); for (const c of el.children) walk(c) }
  walk(h.root)
  assert.equal(btns.filter((t) => /回滚到这里/.test(t)).length, 0)
})

/**
 * 后端万一又退回去（或浏览器里还缓存着旧产物、拿到只有名字的数组），
 * 页面要么照旧显示"没有存档点"，要么显示得出来但不许给一颗会发 undefined 的键。
 */
test('拿到只有名字的旧形状时，不给会发 undefined 的按钮', async () => {
  const stale = historyRes()
  stale.status.checkpoints = undefined
  stale.status.tags = ['checkpoint0', '改雨声偏好前']
  const { h, state } = mountHist(stale)
  await settle()
  await openHistory(h)
  const btns = []
  const walk = (el) => { if (el.tagName === 'BUTTON') btns.push(el.textContent.trim()); for (const c of el.children) walk(c) }
  walk(h.root)
  assert.equal(btns.filter((t) => /回滚到这里/.test(t)).length, 0, '名字形状不该长出回滚键')
  assert.ok(!h.root.textContent.includes('undefined'), '更不能渲染出 undefined')
  assert.equal(state.rollbacks.length, 0)
})

test('存档点缺名字时只亮说明、不给回滚键', async () => {
  const { h, state } = mountHist(historyRes({
    checkpoints: [
      { name: '', message: '这条没有名字', hash: 'ccc2222', date: '2026-11-05T09:00:00+08:00' },
      { name: '有名字的', message: '有名字的', hash: 'ddd3333', date: '2026-11-05T09:30:00+08:00' },
    ],
  }))
  await settle()
  await openHistory(h)
  assert.match(h.root.textContent, /无名存档点/)
  const btns = []
  const walk = (el) => { if (el.tagName === 'BUTTON') btns.push(el.textContent.trim()); for (const c of el.children) walk(c) }
  walk(h.root)
  assert.equal(btns.filter((t) => /回滚到这里/.test(t)).length, 1, '只有带名字的那条能给键')
  assert.ok(!h.root.textContent.includes('undefined'))
  assert.equal(state.rollbacks.length, 0)
})

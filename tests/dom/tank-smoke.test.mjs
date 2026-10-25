// 零依赖 DOM 冒烟：执行 tank.html 的内联脚本（能捕获 ReferenceError/半改名残留）
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import vm from 'node:vm'
import { fileURLToPath } from 'node:url'

const html = fs.readFileSync(fileURLToPath(new URL('../../panel/views/tank.html', import.meta.url)), 'utf8')
const code = html.match(/<script>([\s\S]*?)<\/script>/)[1]

const data = {
  '/api/vitals': {
    shares: 1, sharesMax: 3, pendingCount: 0, today: '10-25',
    scheduler: { ok: false, reason: '面板不跑时钟（DSH 负责）' }, plan: null,
    traffic: {
      remaining: { readHour: 10, readDay: 50, writeHour: 2, writeDay: 5 },
      settings: { readHourly: 20, readDaily: 100, writeHourly: 5, writeDaily: 10 },
      pausedUntil: null, streak: 0,
    },
  },
  '/api/status': { repliedPeople: 2 },
  '/api/timeline?limit=60': { items: [{ at: '2026-10-25T20:00:00Z', kind: 'wake', note: 'e2e' }] },
  '/api/diary': { owner: { updatedAt: 'x', bytes: 9, text: '## 看过' }, private: null },
  '/api/settings': { config: { owner: { mid: '1' }, night: {} }, credentials: { hasSess: true, hasJct: true } },
  '/api/pending': { items: [] },
  '/api/persona': { text: '' },
  '/assets/whale-girl/manifest.json': {},
}

const els = new Map()
const el = (id) => els.get(id) ?? els.set(id, {
  id, textContent: '', innerHTML: '', value: '', hidden: false, dataset: {}, clientWidth: 150,
  style: {}, classList: { add() {}, remove() {}, toggle() {} },
  setAttribute() {}, remove() {},
}).get(id)

const ctx = vm.createContext({
  location: { search: '?t=tok' }, URLSearchParams, Date, Math, JSON, Promise, console,
  setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
  document: {
    getElementById: el,
    querySelectorAll: () => [],
    body: { classList: { toggle() {} } },
    addEventListener() {},
  },
  Image: class { set src(_v) { this.onload?.() } },
  fetch: async (p) => ({ ok: true, status: 200, json: async () => data[p] ?? {} }),
})

test('tank 内联脚本可执行，关键区域被真实填充（无 ReferenceError）', async () => {
  assert.doesNotThrow(() => vm.runInContext(code, ctx, { filename: 'tank.html' }))
  await new Promise((r) => setTimeout(r, 120))
  assert.doesNotMatch(el('clock').textContent, /^✗/, '不得落入 fail() 降级：' + el('clock').textContent)
  assert.match(el('traffic').innerHTML, /读 ·/, '预算区应被填充')
  assert.match(el('story').innerHTML, /wake/, '事件流应被填充')
  assert.match(el('d1').innerHTML, /## 看过/, '日记区应被填充')
  assert.ok(el('bub').textContent.length > 0, '气泡应有文案')
})

test('token 无效时给出人话提示而非永远"载入中"', async () => {
  const els2 = new Map()
  const el2 = (id) => els2.get(id) ?? els2.set(id, { id, textContent: '', innerHTML: '', value: '', hidden: false, dataset: {}, clientWidth: 150, style: {}, classList: { add() {}, remove() {}, toggle() {} }, setAttribute() {}, remove() {} }).get(id)
  const ctx2 = vm.createContext({
    location: { search: '' }, URLSearchParams, Date, Math, JSON, Promise, console,
    setTimeout: () => 0, setInterval: () => 0, clearInterval: () => {},
    document: { getElementById: el2, querySelectorAll: () => [], body: { classList: { toggle() {} } }, addEventListener() {} },
    Image: class { set src(_v) { this.onload?.() } },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ ok: false }) }),
  })
  vm.runInContext(code, ctx2, { filename: 'tank.html' })
  await new Promise((r) => setTimeout(r, 120))
  assert.match(el2('clock').textContent, /令牌/, '应提示 token 问题')
  assert.match(el2('story').textContent, /令牌|加载失败/, '事件流不应停在载入中')
})

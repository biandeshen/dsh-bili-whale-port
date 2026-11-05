/**
 * 面板客户端的无头测试台（零依赖）。
 *
 * 为什么要它：`src/webui/client.ts` 是浏览器代码，之前只能靠真浏览器点一遍。
 * 真浏览器该继续用（视觉与宿主行为最终以它为准），但**行为契约**——点一下到底发了几次请求、
 * 发的什么参数、确认没答应时是不是真的什么都没发生——这些可以离线断言，
 * 也只有离线断言才能在每次改动后重复跑。
 *
 * 这里实现的 `ui` 按 Cortico `src/web/client/ui/*` 的真实形状来（按钮走 addEventListener、
 * `disable()` 记录原值、`confirm()` 任何关闭路径都返回 false），
 * 不是一次性的假控件：假控件写宽了，测试就会绿在生产环境里骗人。
 */

class FakeEl {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase()
    this.children = []
    this.parent = null
    this.style = {}
    this.dataset = {}
    this.attrs = {}
    this.listeners = new Map()
    this.disabled = false
    this.value = ''
    this.checked = false
    this.className = ''
    this._text = ''
    const self = this
    this.classList = {
      _set: new Set(),
      add(...c) { c.forEach((x) => self.classList._set.add(x)) },
      remove(...c) { c.forEach((x) => self.classList._set.delete(x)) },
      toggle(c) { self.classList._set.has(c) ? self.classList._set.delete(c) : self.classList._set.add(c) },
      contains(c) { return self.classList._set.has(c) },
    }
  }

  get textContent() {
    // 真实 DOM：自己的文本节点 + 子节点的文本，串在一起。
    // （早先这里写成"有子节点就只数子节点"，结果 `el.textContent = 正文; el.append(警示行)`
    //  之后正文在假 DOM 里凭空消失——确认层少一段正文，测试却绿着。）
    const own = this.children.map((c) => (c && typeof c.textContent === 'string' ? c.textContent : ''))
    return this._text + own.join('')
  }

  set textContent(v) {
    for (const c of this.children) c.parent = null
    // 赋 textContent 在 DOM 里是"把自己的孩子换成一个文本节点"；这里把旧的**元素**孩子清掉，
    // 文本本身记在 _text，等价且不丢信息。
    this.children = []
    this._text = String(v ?? '')
  }

  append(...nodes) {
    for (const n of nodes) {
      if (n === null || n === undefined || typeof n === 'string') continue
      n.parent = this
      this.children.push(n)
    }
  }

  appendChild(n) { this.append(n); return n }
  appendChildren(...n) { this.append(...n) }
  replaceChildren(...nodes) {
    for (const c of this.children) c.parent = null
    this.children = []
    this.append(...nodes)
  }
  remove() {
    if (!this.parent) return
    const i = this.parent.children.indexOf(this)
    if (i >= 0) this.parent.children.splice(i, 1)
    this.parent = null
  }
  setAttribute(k, v) { this.attrs[k] = String(v) }
  getAttribute(k) { return this.attrs[k] }
  /**
   * 真实 DOM 有 `isConnected`（是否还挂在文档树上），假 DOM 必须也有：
   * 未保存闸门靠它区分"还在屏上"与"已被重画摘掉"，缺了这个属性测试就会漏判。
   */
  get isConnected() {
    let n = this
    while (n.parent) n = n.parent
    return n._root === true
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, [])
    this.listeners.get(type).push(fn)
  }
  removeEventListener(type, fn) {
    const arr = this.listeners.get(type) ?? []
    const i = arr.indexOf(fn)
    if (i >= 0) arr.splice(i, 1)
  }
  focus() {}

  /** 测试用：当前 DOM 里的全部文本（含读数行），用来断言"页面上写了什么" */
  allText() { return this.textContent }
}

const tick = () => new Promise((r) => setTimeout(r, 0))
/** 面板刷新是 async 链（guard → call → 渲染），微任务一趟不够 */
export async function settle(times = 6) {
  for (let i = 0; i < times; i++) await tick()
}

/**
 * 造一台面板运行时。
 *
 * @param handlers `method` → (args) => 返回值 | Promise，或返回 undefined 走默认
 * @returns ctx / ui / 调用流水 / 控制 confirm 与 prompt 的开关
 */
export function mountPanel(handlers = {}, opts = {}) {
  const calls = []
  const confirms = []
  const harness = {
    calls,
    confirms,
    /** 下一次确认层的答案：true=答应，false=取消 */
    confirmAnswer: true,
    /** window.prompt 的返回值序列（拒稿理由这类） */
    prompts: [],
  }

  function makeUi() {
    const ui = {
      h: (tag, cls, text) => {
        const el = new FakeEl(tag)
        if (cls) el.className = cls
        if (text !== undefined && text !== null) el.textContent = String(text)
        return el
      },
      esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
      sheet: ({ title, desc }) => {
        const el = ui.h('div', 'sheet')
        const body = ui.h('div', 'sheetbody')
        const head = ui.h('h3', null, title ?? '')
        const note = ui.h('div', 'note')
        el.append(head)
        let descEl = null
        if (desc) { descEl = ui.h('div', 'sh-desc', desc); el.append(descEl) }
        el.append(body)
        return { el, body, note, desc: descEl }
      },
      section: (title, description) => ui.h('div', 'section', `${title}${description ? ` — ${description}` : ''}`),
      actions: () => ui.h('div', 'actions'),
      button: (label, bopts = {}) => {
        const el = new FakeEl('button')
        el.textContent = label
        el.variant = bopts.variant
        if (bopts.onClick) el.addEventListener('click', (ev) => bopts.onClick(ev))
        return el
      },
      pill: (text, tone) => ui.h('span', `pill ${tone ?? 'plain'}`, text),
      chip: (text, tone) => ui.h('span', `chip ${tone ?? 'plain'}`, text),
      msgline: (text, bad) => {
        const el = ui.h('div', bad ? 'msgline bad' : 'msgline', text ?? '')
        return el
      },
      placeholder: (text) => ui.h('div', 'placeholder', text),
      input: (iopts = {}) => {
        const el = new FakeEl('input')
        el.value = iopts.value ?? ''
        el.placeholder = iopts.placeholder ?? ''
        el.disabled = Boolean(iopts.disabled)
        return el
      },
      select: (sopts = {}) => {
        const el = new FakeEl('select')
        el.value = sopts.value ?? ''
        el.options = (sopts.options ?? []).map((o) => (typeof o === 'string' ? { value: o, label: o } : o))
        return el
      },
      textarea: (topts = {}) => {
        const el = new FakeEl('textarea')
        el.value = topts.value ?? ''
        el.rows = topts.rows ?? 3
        return el
      },
      checkbox: (label, copts = {}) => {
        const input = new FakeEl('input')
        input.checked = Boolean(copts.checked)
        input.addEventListener('click', () => {
          input.checked = !input.checked
          copts.onChange?.(input.checked)
        })
        const el = ui.h('label', 'check', label)
        el.append(input)
        return { el, input, get checked() { return input.checked }, setChecked: (v) => { input.checked = v } }
      },
      field: (label, control) => { const el = ui.h('label', 'field', label); el.append(control); return el },
      segmented: (items, segopts = {}) => {
        const el = ui.h('div', 'segwrap')
        const handle = {
          el,
          value: segopts.value ?? '',
          setValue(v) { handle.value = String(v) },
        }
        for (const raw of items ?? []) {
          const item = typeof raw === 'string' ? { value: raw, label: raw } : raw
          const b = ui.button(item.label ?? item.value, {
            onClick: () => {
              // 宿主：点已选中的那颗不触发回调
              if (handle.value === item.value) return
              handle.value = item.value
              segopts.onSelect?.(item.value)
            },
          })
          el.append(b)
        }
        return handle
      },
      table: (topts = {}) => {
        const el = ui.h('div', 'tablewrap')
        const body = ui.h('tbody')
        el.append(body)
        return {
          el,
          body,
          clear(empty) { body.replaceChildren(); if (empty) body.append(ui.h('tr', 'placeholder', empty)) },
          addRow: (cells) => {
            const tr = ui.h('tr')
            for (const c of cells ?? []) {
              const td = ui.h('td')
              if (c && typeof c === 'object' && typeof c.tagName === 'string') td.append(c)
              else if (c && typeof c === 'object' && ('el' in c || 'text' in c)) {
                if (c.el) td.append(c.el); else td.textContent = String(c.text ?? '')
              } else td.textContent = c === null || c === undefined ? '' : String(c)
              tr.append(td)
            }
            body.append(tr)
            return tr
          },
        }
      },
      kv: (rows) => {
        const el = ui.h('table', 'kv')
        for (const r of rows ?? []) {
          const tr = ui.h('tr')
          const a = ui.h('td', 'k', r.k)
          const b = ui.h('td', 'v')
          if (r.v && typeof r.v === 'object') b.append(r.v); else b.textContent = String(r.v ?? '')
          tr.append(a, b)
          el.append(tr)
        }
        return el
      },
      // 宿主形状（data.ts 的 stat）：.stat 里是 .k 与 .v 两个子节点，中间没有冒号。
      // 早先这里写成 `${k}: ${v}`，测试就会去匹配一个页面上根本不存在的分隔符。
      stat: (item) => {
        const el = ui.h('div', item.accent ? 'stat accent' : 'stat')
        el.append(ui.h('div', 'k', String(item.k)))
        const v = ui.h('div', 'v')
        if (item.v && typeof item.v === 'object') v.append(item.v)
        else v.textContent = String(item.v ?? '')
        el.append(v)
        return el
      },
      statgrid: (items) => {
        const el = ui.h('div', 'statgrid')
        for (const i of items ?? []) el.append(ui.stat(i))
        return el
      },
      toast: (text) => {
        ui._toasts.push(text)
        return { dispose() {} }
      },
      _toasts: [],
      confirm: (copts) => {
        // 宿主把 body 节点原样挂进弹层；测试要看得见"确认层里到底写了什么"
        confirms.push(copts)
        return Promise.resolve(harness.confirmAnswer)
      },
      busy: () => ({ dispose() {} }),
      // 宿主的 disable()：先记原值再置 true，dispose 幂等恢复——顺序写错就会把按钮永久弄死，
      // 所以这里也照原样实现，不图省事
      disable: (...els) => {
        const saved = els.flat().map((el) => ({ el, was: Boolean(el.disabled) }))
        for (const s of saved) s.el.disabled = true
        let done = false
        return { dispose() { if (done) return; done = true; for (const s of saved) s.el.disabled = s.was } }
      },
    }
    return ui
  }

  const ui = makeUi()
  const root = ui.h('div', 'panel-root')
  root._root = true
  const ac = new AbortController()

  const ctx = {
    pageId: opts.pageId ?? 'world:xiaoyu',
    panelId: opts.panelId ?? 'test',
    language: 'zh-CN',
    root,
    signal: ac.signal,
    ui,
    async invoke(method, args) {
      calls.push({ method, args })
      const h = handlers[method]
      if (!h) return { ok: true }
      const out = await h(...(Array.isArray(args) ? args : [args]))
      if (out instanceof Error) throw out
      return out
    },
  }

  harness.ui = ui
  harness.ctx = ctx
  harness.root = root

  // window.prompt：拒稿理由走的是原生 prompt；测试按 prompts 队列给答案。
  // 浏览器里"按取消"返回的是 **null**（不是 undefined），假控件必须照这个来，
  // 否则生产代码只防 null 就会在测试里假装通过。
  globalThis.window = globalThis.window ?? {}
  globalThis.window.prompt = () => (harness.prompts.length ? harness.prompts.shift() : null)
  globalThis.document = globalThis.document ?? {
    body: new FakeEl('body'),
    createElement: (tag) => new FakeEl(tag),
    addEventListener() {},
    removeEventListener() {},
  }

  harness.click = async (el) => {
    for (const fn of el.listeners.get('click') ?? []) await fn({})
    await settle()
  }
  /** 只触发不等收尾：用来断言"请求还在飞的当口"按钮是什么状态 */
  harness.fire = (el) => (el.listeners.get('click') ?? []).map((fn) => Promise.resolve(fn({})))
  /** 按标签文字找按钮（浅遍历当前 DOM） */
  harness.findButton = (label) => {
    const walk = (el) => {
      if (el.tagName === 'BUTTON' && String(el.textContent).includes(label)) return el
      for (const c of el.children) { const hit = walk(c); if (hit) return hit }
      return null
    }
    return walk(root)
  }
  harness.msgLine = () => {
    const all = harness.msgLines()
    return all.length ? all[all.length - 1] : null
  }
  /** 一个面板里可能有多条消息行（面板自己的 msg + 嵌在区块里的提示），全给出去自己挑。 */
  harness.msgLines = () => {
    const out = []
    const walk = (el) => {
      if (el.className && String(el.className).split(' ').includes('msgline')) out.push(el)
      for (const c of el.children) walk(c)
    }
    walk(root)
    return out
  }
  harness.msgText = () => harness.msgLines().map((m) => m.textContent).join('\n')
  harness.textareas = () => {
    const out = []
    const walk = (el) => { if (el.tagName === 'TEXTAREA') out.push(el); for (const c of el.children) walk(c) }
    walk(root)
    return out
  }
  harness.unmount = () => ac.abort()
  return harness
}

/** 造一条待放行队列项（字段照 write-gate.ts 的 PendingQueueItem，别自创） */
export function pendingItem(over = {}) {
  const now = new Date().toISOString()
  return {
    id: 'q-dynamic-1',
    kind: 'dynamic',
    intent: 'self',
    target: {},
    text: '今天想说的是原来的那句',
    bodyHash: 'aaaa1111bbbb2222',
    token: 'ack-x',
    createdAt: now,
    updatedAt: now,
    status: 'pending',
    ...over,
  }
}

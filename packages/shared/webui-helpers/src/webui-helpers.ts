/**
 * 浏览器端面板的共享辅助（只依赖 Cortico 的 ui 契约，不 import 任何 Node 模块）。
 *
 * 这一层解决三件重复的事：
 *   ① 调用数据面并把错误显示成一行消息（不抛栈）；
 *   ② 面板刷新（mount 时拉一次，之后由调用方决定何时再拉）；
 *   ③ 常见控件的组装（带标签的输入、下拉、按钮行、状态行）。
 */

/**
 * 浏览器端控件的宿主原语最小形状（真源是 Cortico `src/web/client/ui/index.ts` 的 `createWebUi`，
 * 接口声明在 `src/web/shared/client-panel.ts`）。
 *
 * 这里**照抄宿主的真实签名**，不是随手写的近似形状：上一版把 `segmented` 的参数顺序、
 * `input` 的回调名都写错了，而本仓没有 tsc 门禁（Node 24 只剥类型不检查），
 * 于是类型错了没人报警——类型这时候是**给人和 agent 读的合同**，写错比不写更坏。
 * 只声明我们用得到的那些，缺的原语到宿主接口页查，别脑补。
 */
export interface PanelUi {
  h(tag: string, cls?: string | null, text?: string | null): HTMLElement
  esc(s: unknown): string
  sheet(opts: { title: string; en?: string; desc?: string }): { el: HTMLElement; body: HTMLElement; note: HTMLElement; desc: HTMLElement | null }
  section(title: string, description?: string): HTMLElement
  actions(): HTMLElement
  button(label: string, opts?: { variant?: 'plain' | 'primary' | 'danger' | string; size?: 'sm' | 'md'; onClick?: (ev?: MouseEvent) => void | Promise<void> }): HTMLButtonElement
  pill(text: string, tone?: 'on' | 'off' | 'plain' | string): HTMLElement
  chip(text: string, tone?: 'plain' | 'warn' | 'accent' | string): HTMLElement
  msgline(text?: string, bad?: boolean): HTMLElement
  placeholder(text: string): HTMLElement
  input(opts?: { value?: string; placeholder?: string; type?: 'text' | 'number' | 'password' | 'search' | 'date'; min?: number; max?: number; step?: number; disabled?: boolean; cls?: string; onInput?: (v: string) => void; onChange?: (v: string) => void; onCommit?: (v: string) => void }): HTMLInputElement
  select(opts?: { options?: Array<string | { value: string; label?: string }>; value?: string; disabled?: boolean; onInput?: (v: string) => void; onChange?: (v: string) => void }): HTMLSelectElement
  textarea(opts?: { value?: string; placeholder?: string; rows?: number; disabled?: boolean; onInput?: (v: string) => void; onChange?: (v: string) => void; onCommit?: (v: string) => void }): HTMLTextAreaElement
  checkbox(label: string, opts?: { checked?: boolean; disabled?: boolean; title?: string; onChange?: (v: boolean) => void }): { el: HTMLElement; input: HTMLInputElement; checked: boolean; setChecked(v: boolean): void }
  field(label: string, control: HTMLElement): HTMLElement
  /** 宿主是 (items, opts)，选中值通过 `seg.value` 读；`setValue` 不触发 onSelect。 */
  segmented(items: ReadonlyArray<string | { value: string; label?: string }>, opts?: { value?: string; size?: 'sm' | 'md'; onSelect?: (v: string) => void }): { el: HTMLElement; value: string; setValue(v: string): void }
  table(opts?: { head?: string[]; maxHeight?: string }): { el: HTMLElement; body: HTMLElement; clear(empty?: string): void; addRow(cells: Array<string | number | HTMLElement | { text?: string | number | null; el?: HTMLElement; cls?: string } | null | undefined>): HTMLElement }
  kv(rows: ReadonlyArray<{ k: string; v: string | number | HTMLElement | null | undefined }>): HTMLElement
  stat(item: { k: string; v: string | number; accent?: boolean }): HTMLElement
  statgrid(items?: ReadonlyArray<{ k: string; v: string | number; accent?: boolean }>): HTMLElement
  /** 一行提示，屏幕下沿、自动消失；同一面板只留一条。 */
  toast(text: string, tone?: 'ok' | 'bad'): { dispose(): void }
  /**
   * 模态确认。**取消 / Esc / 点遮罩 / 面板卸载都 resolve false**，所以"没答应"只有一条路。
   * `body` 给节点时原样挂入——要显示正文预览就得给节点（字符串那一路不保留换行）。
   */
  confirm(opts: { title: string; body?: string | HTMLElement; danger?: boolean; ok?: string }): Promise<boolean>
  /** 整页阻塞遮罩（等长任务），返回 Disposable。 */
  busy(title: string, text?: string): { dispose(): void }
  /** 局部禁用一组控件，dispose() 各自恢复原值。 */
  disable(...els: HTMLElement[]): { dispose(): void }
}

/** Cortico 的 WebUiPanelContext 的最小形状（宿主侧同名接口在 client-panel.ts）。 */
export interface PanelCtx {
  readonly pageId: string
  readonly panelId: string
  readonly language: string
  readonly root: HTMLElement
  readonly signal: AbortSignal
  readonly ui: PanelUi
  invoke(method: string, args?: unknown): Promise<unknown>
}

/**
 * 统一的数据面调用：出错时写进消息行而不是抛栈。
 *
 * 注意 args 必须是**数组**：宿主的面板 invoke 收的是位置参数数组
 * （Cortico src/web/server.ts 的 postPanel 会校验 Array.isArray(body.args)）。
 * 这里把对象自动包成 [obj]，避免各处手写数组时漏。
 */
export async function call<T = any>(
  ctx: PanelCtx,
  msg: HTMLElement,
  method: string,
  args?: unknown,
): Promise<T | null> {
  try {
    msg.textContent = ''
    const payload = args === undefined ? undefined : (Array.isArray(args) ? args : [args])
    const out = await ctx.invoke(method, payload)
    return out as T
  } catch (e) {
    msg.textContent = String(e instanceof Error ? e.message : e)
    msg.classList.add('bad')
    return null
  }
}

/**
 * 一次性动作按钮：确认 → 准备 → 调数据面 → 刷新 → 把失败原因写在消息行里。
 *
 * 参数可以是固定值，也可以是 argsFactory —— 点击那一刻才计算（比如把当前滑块值带上）。
 * 注意：不要用 `btn.onclick = ...` 覆盖，宿主 UI 的按钮绑定走 addEventListener，
 * 覆盖 onclick 属性不会生效（实测踩过：按钮仍按原始参数发请求）。
 *
 * 三个防护是这批补上的（设计走查 story-2「按按钮不再赌运气」）：
 *   ① `busy`：点击即禁用 + 换文案，连点两次不会发两次请求；
 *   ② `confirm`：不可逆/对外写的操作先弹确认层，**取消那条路什么都不做**；
 *   ③ `preRun`：发请求前的准备动作（如"先把没保存的正文存下去"），
 *      返回一句话就是中止原因——请求不发，但那句话照样进消息行。
 */
export function actionButton(
  ctx: PanelCtx,
  ui: PanelCtx['ui'],
  msg: HTMLElement,
  label: string,
  method: string,
  args?: unknown,
  opts: {
    variant?: string
    /** 动作做完之后的收尾。拿到数据面的返回值——要"按 id 局部更新"而不是整列表重建的，就从这里取。 */
    after?: (result: unknown) => void | Promise<void>
    /** 点击时动态取参数（优先于 args） */
    argsFactory?: () => unknown
    /**
     * 危险操作：先确认再执行。body/warn 给函数时点击那一刻才求值（要读当前输入框）。
     * 整个规格也可以给函数——"要不要确认"常常取决于当下值（档位从紧改松才问）。
     */
    confirm?: ConfirmSpec | (() => ConfirmSpec | null | undefined)
    /** 请求发出前的准备；返回一句话 = 中止原因（不发请求），返回空 = 继续。 */
    preRun?: () => string | null | undefined | Promise<string | null | undefined>
    /** 执行中的按钮文案，缺省「〈原文〉…」。 */
    busyLabel?: string
  } = {},
): HTMLButtonElement {
  let running = false
  const btn = ui.button(label, {
    variant: opts.variant,
    onClick: async () => {
      // 重入闸门：一次点击还没结束就再点，等于把同一个动作发两遍（放行会发两条动态）
      if (running) return
      running = true
      const originalLabel = btn.textContent ?? label
      // 用宿主的 disable()：它先记下原本的 disabled 再置 true，dispose 幂等恢复。
      // 自己先 `btn.disabled = true` 再调它就坏了——它会把 true 记成"原值"，恢复后按钮永久死掉。
      const restore = ui.disable
        ? ui.disable(btn)
        : (() => {
            btn.disabled = true
            return { dispose: () => { btn.disabled = false } }
          })()
      btn.textContent = opts.busyLabel ?? `${originalLabel}…`
      // 失败原因先存着，等 after 的刷新做完再写回去：refresh() 里那句 call() 开头就
      // msg.textContent=''，当场写的错误会被自己的刷新擦掉——2026-11-04 真浏览器实测：
      // 「删掉超期的」没勾确认，后端 500 正确拒了，页面上却一个字都没显示，
      // 用户只能以为按钮坏了。
      let failure: string | null = null
      let result: unknown = undefined
      try {
        // 确认放在清空消息行之前：取消 = 这一屏什么都没发生过
        const spec = typeof opts.confirm === 'function' ? opts.confirm() : opts.confirm
        if (spec && !(await askConfirm(ui, spec))) return

        if (opts.preRun) {
          const why = await opts.preRun()
          if (why) failure = String(why)
        }
        if (failure === null) {
          msg.textContent = ''
          msg.classList.remove('bad')
          try {
            // 参数也算在 try 里：算错参数不该让整次点击静默失败（实测踩过：argsFactory 抛错
            // 会冒泡成未捕获错误，请求发不出去，页面看不出任何原因）。
            const payload = opts.argsFactory ? opts.argsFactory() : args
            result = await ctx.invoke(method, payload === undefined ? undefined : (Array.isArray(payload) ? payload : [payload]))
            // 服务端用 {ok:false,...} 表达"没做"（如闸门拒），要显示出来而不是当成成功
            if (result && typeof result === 'object' && (result as any).ok === false) {
              failure = String((result as any).error ?? (result as any).reason ?? '操作没成功')
            }
          } catch (e) {
            failure = String(e instanceof Error ? e.message : (e as any)?.error ?? e)
          }
          // 返回值交给 after：能按 id 局部更新的就不必整列表重建（走查 story-3）
          await opts.after?.(result)
        }
        if (failure !== null) {
          msg.textContent = failure
          msg.classList.add('bad')
        }
      } finally {
        running = false
        try { restore.dispose() } catch { /* 面板已卸载，原控件早就不在了 */ }
        btn.textContent = originalLabel
      }
    },
  })
  return btn
}

/** 确认层规格。 */
export interface ConfirmSpec {
  title?: string
  /** 点下去会发生什么——把后果写全，放行这类还要带上正文预览。 */
  body: string | (() => string)
  /** 不可撤回之类的提醒，走宿主警示色。 */
  warn?: string | (() => string)
  danger?: boolean
  /** 确认键文字，缺省「确认」。 */
  ok?: string
}

/**
 * 弹宿主的模态确认。
 *
 * 不用 window.confirm：它塞不下"发出去的就是这一段"的正文预览，也换不掉按钮文案，
 * 而宿主的 `ui.confirm` 已经把取消/Esc/点遮罩/面板卸载四条路统一成 false。
 * 正文给**节点**（宿主的字符串那一路不保留换行，草稿一换行就糊成一行）。
 */
export async function askConfirm(ui: PanelCtx['ui'], spec: ConfirmSpec): Promise<boolean> {
  const body = typeof spec.body === 'function' ? spec.body() : spec.body
  const warn = typeof spec.warn === 'function' ? spec.warn() : spec.warn
  const node = ui.h('div')
  node.style.whiteSpace = 'pre-wrap'
  node.textContent = body
  if (warn) {
    const line = ui.msgline(warn, true)
    line.style.whiteSpace = 'pre-wrap'
    node.append(line)
  }
  return await ui.confirm({
    title: spec.title ?? '确认这一步？',
    body: node,
    danger: spec.danger,
    ok: spec.ok,
  })
}

/**
 * 未保存输入的登记簿（story-3「打字打一半不再蒸发」）。
 *
 * 面板刷新是整块 replaceChildren()，输入框连带你刚打的字一起没了——
 * 以前没有任何提示。这里不追求"保住草稿"（那要存 localStorage），
 * 只求**别静默丢**：脏了就先问一句，你说丢才丢。
 *
 * 用法：每次重建完列表调用 `watch(输入框, () => 已存档的那份文本)`，
 * 刷新入口先 `if (!(await guard())) return`。
 */
export function createDirtyGuard(ui: PanelCtx['ui']): {
  /** 登记一个输入框；返回"不再盯着它"的收尾函数（保存成功时只该摘掉自己那一个）。 */
  watch(el: { value: string }, saved: () => string): () => void
  reset(): void
  dirty(): Array<{ el: { value: string }; preview: string }>
  /** 没有脏 → true；有脏 → 问一句，答应丢掉才 true（点取消 false，调用方就别刷新）。 */
  guard(): Promise<boolean>
} {
  const watched: Array<{ el: { value: string }; saved: () => string }> = []
  return {
    watch(el, saved) {
      const entry = { el, saved }
      watched.push(entry)
      return () => {
        const i = watched.indexOf(entry)
        if (i >= 0) watched.splice(i, 1)
      }
    },
    reset() {
      watched.length = 0
    },
    dirty() {
      const out: Array<{ el: { value: string }; preview: string }> = []
      // 从 DOM 上摘下来的输入框不算数：它已经不在这一屏上了，谈不上"丢掉"。
      // 按 id 局部重画一张卡片时，旧的那份登记要随之失效，否则会一直拦着刷新。
      for (let i = watched.length - 1; i >= 0; i--) {
        const w = watched[i]
        if ((w.el as any).isConnected === false) {
          watched.splice(i, 1)
          continue
        }
        if (w.el.value !== w.saved()) {
          const preview = w.el.value.slice(0, 30)
          out.push({ el: w.el, preview })
        }
      }
      return out
    },
    async guard() {
      const d = this.dirty()
      if (!d.length) return true
      return await askConfirm(ui, {
        title: '有还没保存的修改',
        body: `这些地方你改过字还没存档（共 ${d.length} 处）：\n${d.map((x) => `· ${x.preview}${x.preview.length >= 30 ? '…' : ''}`).join('\n')}`,
        warn: '刷新会把它们清掉。要留着改就先点取消，保存好再刷新。',
        ok: '丢掉并刷新',
      })
    },
  }
}

/**
 * 输入防抖：打字过程中别每敲一个字就发一次搜索。
 *
 * 宿主的 `onInput` 是 input 事件——中文输入法组词期间也在跳，
 * 300ms 是"手停了才算说完"的粗粒度，不是调出来的数。
 */
export function debounce(fn: () => void | Promise<void>, ms = 300): { run(): void; cancel(): void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  return {
    run() {
      if (timer !== null) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void fn()
      }, ms)
    },
    cancel() {
      if (timer !== null) clearTimeout(timer)
      timer = null
    },
  }
}

/**
 * 数值滑块 + 数字框联动。
 *
 * 为什么不用 ui.input({type:'range'})：宿主的输入器只认 text/number/password/search/date
 * （Cortico src/web/shared/client-panel.ts:387），传 'range' 会退化成原生滑块而取值口径变成 0~100，
 * 与我们 0~1 的场值口径不一致。所以滑块自己用原生 input[type=range] 建，数字框用宿主的 number。
 */
export function sliderField(
  ui: PanelCtx['ui'],
  label: string,
  value: number,
  opts: { min?: number; max?: number; step?: number; onChange?: (v: number) => void } = {},
): { el: HTMLElement; get: () => number } {
  const min = opts.min ?? 0
  const max = opts.max ?? 1
  const step = opts.step ?? 0.01
  const range = document.createElement('input')
  range.type = 'range'
  range.min = String(min)
  range.max = String(max)
  range.step = String(step)
  range.value = String(value)
  range.style.flex = '1'
  range.setAttribute('aria-label', label)

  const num = ui.input({ value: String(value), type: 'number', min, max, step })

  const sync = (v: number) => {
    const clamped = Math.max(min, Math.min(max, Number.isFinite(v) ? v : min))
    range.value = String(clamped)
    num.value = String(clamped)
    opts.onChange?.(clamped)
  }
  range.addEventListener('input', () => sync(Number(range.value)))
  num.addEventListener('input', () => sync(Number(num.value)))

  const wrap = ui.h('div')
  wrap.style.display = 'flex'
  wrap.style.gap = '8px'
  wrap.style.alignItems = 'center'
  const labelEl = ui.field(label, range)
  labelEl.style.flex = '1'
  wrap.append(labelEl, num)
  return {
    el: wrap,
    get: () => Number(num.value),
  }
}

/** 文本输入 + 按钮：返回读当前值的函数。 */
export function textField(
  ui: PanelCtx['ui'],
  label: string,
  value: string,
  placeholder?: string,
): { el: HTMLElement; get: () => string } {
  const input = ui.input({ value, placeholder })
  return { el: ui.field(label, input), get: () => input.value }
}

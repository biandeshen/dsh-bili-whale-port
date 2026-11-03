/**
 * 浏览器端面板的共享辅助（只依赖 Cortico 的 ui 契约，不 import 任何 Node 模块）。
 *
 * 这一层解决三件重复的事：
 *   ① 调用数据面并把错误显示成一行消息（不抛栈）；
 *   ② 面板刷新（mount 时拉一次，之后由调用方决定何时再拉）；
 *   ③ 常见控件的组装（带标签的输入、下拉、按钮行、状态行）。
 */

/** Cortico 的 WebUiPanelContext 的最小形状（见 Cortico src/web/shared/client-panel.ts:39）。 */
export interface PanelCtx {
  readonly pageId: string
  readonly panelId: string
  readonly language: string
  readonly root: HTMLElement
  readonly signal: AbortSignal
  readonly ui: {
    h(tag: string, ...cls: string[]): HTMLElement
    esc(s: unknown): string
    sheet(opts: { title: string; en?: string; desc?: string }): { el: HTMLElement; body: HTMLElement }
    section(title: string, description?: string): HTMLElement
    actions(): HTMLElement
    button(label: string, opts?: { variant?: string; title?: string; onClick?: () => void }): HTMLButtonElement
    pill(text: string, tone?: string): HTMLElement
    chip(text: string, tone?: string): HTMLElement
    msgline(text?: string, bad?: boolean): HTMLElement
    placeholder(text: string): HTMLElement
    input(opts?: { value?: string; placeholder?: string; type?: string; min?: number; max?: number; step?: number; onInput?: (v: string) => void }): HTMLInputElement
    select(opts?: { options?: Array<string | { value: string; label: string }>; value?: string; onChange?: (v: string) => void }): HTMLSelectElement
    textarea(opts?: { value?: string; placeholder?: string; rows?: number; onInput?: (v: string) => void }): HTMLTextAreaElement
    checkbox(label: string, opts?: { checked?: boolean; onChange?: (v: boolean) => void }): { el: HTMLElement; input: HTMLInputElement; checked: boolean }
    field(label: string, control: HTMLElement): HTMLLabelElement
    segmented(opts?: { options?: Array<string | { value: string; label: string }>; value?: string; onChange?: (v: string) => void }): { el: HTMLElement; setValue?: (v: string) => void }
    table(opts?: { head?: string[]; onRow?: (row: HTMLElement) => void }): { el: HTMLElement; body: HTMLElement; clear(): void; addRow(cells: Array<string | HTMLElement>): HTMLElement }
    kv(rows: ReadonlyArray<[string, string]>): HTMLElement
    stat(item: { k: string; v: string | number; accent?: boolean }): HTMLElement
    statgrid(items?: ReadonlyArray<{ k: string; v: string | number; accent?: boolean }>): HTMLElement
  }
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
 * 一次性动作按钮：点完自动刷新并把结果显示在消息行里。
 *
 * 参数可以是固定值，也可以是 argsFactory —— 点击那一刻才计算（比如把当前滑块值带上）。
 * 注意：不要用 `btn.onclick = ...` 覆盖，宿主 UI 的按钮绑定走 addEventListener，
 * 覆盖 onclick 属性不会生效（实测踩过：按钮仍按原始参数发请求）。
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
    after?: () => void | Promise<void>
    /** 点击时动态取参数（优先于 args） */
    argsFactory?: () => unknown
  } = {},
): HTMLButtonElement {
  return ui.button(label, {
    variant: opts.variant,
    onClick: async () => {
      msg.textContent = ''
      msg.classList.remove('bad')
      try {
        // 参数也算在 try 里：算错参数不该让整次点击静默失败（实测踩过：argsFactory 抛错
        // 会冒泡成未捕获错误，请求发不出去，页面看不出任何原因）。
        const payload = opts.argsFactory ? opts.argsFactory() : args
        const out = await ctx.invoke(method, payload === undefined ? undefined : (Array.isArray(payload) ? payload : [payload]))
        // 服务端用 {ok:false,...} 表达"没做"（如闸门拒），要显示出来而不是当成成功
        if (out && typeof out === 'object' && (out as any).ok === false) {
          msg.textContent = String((out as any).error ?? (out as any).reason ?? '操作没成功')
          msg.classList.add('bad')
        }
      } catch (e) {
        msg.textContent = String(e instanceof Error ? e.message : e)
        msg.classList.add('bad')
      }
      await opts.after?.()
    },
  })
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

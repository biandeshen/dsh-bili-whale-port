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
    checkbox(label: string, opts?: { checked?: boolean; onChange?: (v: boolean) => void }): { el: HTMLElement; control: HTMLInputElement }
    field(label: string, control: HTMLElement): HTMLLabelElement
    segmented(opts?: { options?: Array<string | { value: string; label: string }>; value?: string; onChange?: (v: string) => void }): { el: HTMLElement; setValue?: (v: string) => void }
    table(opts?: { head?: string[]; onRow?: (row: HTMLElement) => void }): { el: HTMLElement; body: HTMLElement; clear(): void; addRow(cells: Array<string | HTMLElement>): HTMLElement }
    kv(rows: ReadonlyArray<[string, string]>): HTMLElement
    stat(item: { k: string; v: string | number; accent?: boolean }): HTMLElement
    statgrid(items?: ReadonlyArray<{ k: string; v: string | number; accent?: boolean }>): HTMLElement
  }
  invoke(method: string, args?: unknown): Promise<unknown>
}

/** 统一的数据面调用：出错时写进消息行而不是抛栈。 */
export async function call<T = any>(
  ctx: PanelCtx,
  msg: HTMLElement,
  method: string,
  args?: unknown,
): Promise<T | null> {
  try {
    msg.textContent = ''
    const out = await ctx.invoke(method, args)
    return out as T
  } catch (e) {
    msg.textContent = String(e instanceof Error ? e.message : e)
    msg.classList.add('bad')
    return null
  }
}

/** 一次性动作按钮：点完自动刷新并把结果显示在消息行里。 */
export function actionButton(
  ctx: PanelCtx,
  ui: PanelCtx['ui'],
  msg: HTMLElement,
  label: string,
  method: string,
  args?: unknown,
  opts: { variant?: string; after?: () => void | Promise<void> } = {},
): HTMLButtonElement {
  const btn = ui.button(label, {
    variant: opts.variant,
    onClick: async () => {
      btn.disabled = true
      try {
        await ctx.invoke(method, args)
        msg.textContent = ''
        msg.classList.remove('bad')
      } catch (e) {
        msg.textContent = String(e instanceof Error ? e.message : e)
        msg.classList.add('bad')
      } finally {
        btn.disabled = false
        await opts.after?.()
      }
    },
  })
  return btn
}

/** 数字输入 + 滑块联动：返回读当前值的函数。 */
export function sliderField(
  ui: PanelCtx['ui'],
  label: string,
  value: number,
  opts: { min?: number; max?: number; step?: number; onChange?: (v: number) => void } = {},
): { el: HTMLElement; get: () => number } {
  const min = opts.min ?? 0
  const max = opts.max ?? 1
  const step = opts.step ?? 0.01
  const input = ui.input({ value: String(value), type: 'range', min, max, step })
  const num = ui.input({ value: String(value), type: 'number', min, max, step })
  const sync = (v: number) => {
    input.value = String(v)
    num.value = String(v)
    opts.onChange?.(v)
  }
  input.addEventListener('input', () => sync(Number(input.value)))
  num.addEventListener('input', () => sync(Number(num.value)))
  const wrap = ui.h('div')
  wrap.style.display = 'flex'
  wrap.style.gap = '8px'
  wrap.append(ui.field(label, input), num)
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

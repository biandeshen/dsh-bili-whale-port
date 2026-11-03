/**
 * 鱼缸与作息遥控台（浏览器端面板）。
 *
 * 这是主人最常看的一页：她的 6 条场值与心情能看、能直接拖滑块改；能一键戳醒她；
 * 能切作息模式（自然 / 强制休息 / 保持清醒）。
 * 所有写操作都落到服务端的方法上，改完立刻回读确认（不靠"点了应该成功"）。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, sliderField } from '../../../cortico-adapter/src/webui-helpers.ts'

const FIELDS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: 'energy', label: '体力', min: 0, max: 1 },
  { key: 'stimulation', label: '刺激', min: 0, max: 1 },
  { key: 'connection', label: '想念', min: 0, max: 1 },
  { key: 'social', label: '社交', min: 0, max: 1 },
  { key: 'curiosity', label: '好奇', min: 0, max: 1 },
  { key: 'creativity', label: '创作', min: 0, max: 1 },
]

export const tankPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '鱼缸与作息遥控台',
      en: 'fishbowl and rhythm remote',
      desc: '看她此刻的状态，直接调她的场值、戳醒她、切她的作息。改完立刻回读确认。',
    })
    root.appendChild(card.el)

    const msg = ui.msgline()
    const stats = ui.h('div')
    const controls = ui.h('div')
    const actions = ui.actions()
    card.body.append(stats, controls, actions, msg)

    const sliders = new Map<string, { el: HTMLElement; get: () => number }>()

    async function refresh() {
      const snap = await call<any>(ctx, msg, 'getSnapshot')
      if (!snap) return
      stats.replaceChildren()
      const mood = snap.mood ?? {}
      stats.append(
        ui.statgrid([
          { k: '情绪', v: String(mood.primary ?? '—') },
          { k: '强度', v: String(mood.intensity ?? '—') },
          { k: '作息', v: snap.asleep ? '睡着了' : '醒着' },
          { k: '模式', v: String(snap.mode ?? 'auto') },
        ]),
      )
      if (mood.reason) {
        const line = ui.h('div')
        line.style.margin = '8px 0'
        line.textContent = `成因：${mood.reason}`
        stats.append(line)
      }

      controls.replaceChildren()
      sliders.clear()
      for (const f of FIELDS) {
        const current = Number(snap.fields?.[f.key] ?? 0)
        const s = sliderField(ui, f.label, current, { min: f.min, max: f.max })
        sliders.set(f.key, s)
        controls.append(s.el)
      }

      actions.replaceChildren()
      const patch = () => {
        const out: Record<string, number> = {}
        for (const [k, s] of sliders.entries()) out[k] = s.get()
        return out
      }
      const save = actionButton(ctx, ui, msg, '保存场值修改', 'setFields', undefined, {
        variant: 'primary',
        argsFactory: () => [{ patch: patch() }],
        after: refresh,
      })
      actions.append(save)

      const hint = ui.input({ placeholder: '可选：顺路叮嘱她一句（如"去看看收件箱"）' })
      const wake = actionButton(ctx, ui, msg, '⚡ 立即戳醒她', 'wakeNow', undefined, {
        variant: 'primary',
        argsFactory: () => [{ hint: hint.value }],
        after: refresh,
      })
      actions.append(wake)

      const modeRow = ui.h('div')
      modeRow.style.margin = '12px 0'
      const seg = ui.segmented(
        [
          { value: 'auto', label: '自然节律' },
          { value: 'force_sleep', label: '强制休息' },
          { value: 'force_awake', label: '保持清醒' },
        ],
        { value: String(snap.mode ?? 'auto') },
      )
      modeRow.append(ui.field('作息模式', seg.el))
      const applyMode = actionButton(ctx, ui, msg, '切换作息模式', 'setMode', undefined, {
        argsFactory: () => [{ mode: seg.value }],
        after: refresh,
      })
      actions.append(modeRow, applyMode)
    }

    void refresh()
  },
}

export default { panels: { tank: tankPanel } }

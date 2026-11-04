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

/** 场值是 0–1 的量，但 `0.9606346078812088` 糊在脸上不是给人看的数（批次 10 体验小修）。 */
const pct = (n: unknown): string => {
  const v = Number(n)
  return Number.isFinite(v) ? `${Math.round(v * 100)}%` : '—'
}

/**
 * 因果账的 source 翻成人话。
 *
 * 只翻**代码里确实存在**的那些值（persona-core / state-store 里 grep 得出来的），
 * 认不出来就原样留着——编一个看着像的中文名，比留英文更容易骗人。
 */
const SOURCE_CN: Record<string, string> = {
  owner_adjust: '主人手调',
  decay: '时间流逝',
  action: '她自己行动',
  watched: '看了片子',
  inbound: '有人来找她',
  risk: '风控/风险',
  silence: '主人没出声',
  npc_self: '她自己',
  masterReplied: '主人回话',
  masterSilentDay: '主人整天没来',
  draftApproved: '稿子放行',
  draftRejected: '稿子被拒',
  trafficPaused: '风控熔断',
  keep: '判定：留',
  drop: '判定：丢',
  unclear: '判定：说不清',
}
const sourceCn = (s: unknown): string => {
  const k = String(s ?? '')
  return SOURCE_CN[k] ?? (k || '—')
}

const MODE_CN: Record<string, string> = {
  auto: '自然节律',
  force_sleep: '强制休息',
  force_awake: '保持清醒',
}
const modeCn = (m: unknown): string => MODE_CN[String(m)] ?? String(m ?? '—')

/** 下一次评估还有多久——倒计时比一个绝对时间戳有用得多。 */
const countdown = (nextCheckAt: unknown): string => {
  const ms = Number(nextCheckAt) - Date.now()
  if (!Number.isFinite(ms)) return '—'
  if (ms <= 0) return '就这一会儿'
  const min = Math.round(ms / 60_000)
  if (min < 1) return '不到 1 分钟'
  if (min < 60) return `${min} 分钟后`
  return `${Math.floor(min / 60)} 小时 ${min % 60} 分后`
}

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
      const life = snap.life ?? {}
      stats.append(
        ui.statgrid([
          { k: '情绪', v: String(mood.primary ?? '—') },
          { k: '强度', v: pct(mood.intensity) },
          { k: '作息', v: snap.rest === 'asleep' ? '睡着了' : snap.rest === 'resting' ? '累了，歇着' : '醒着' },
          { k: '模式', v: modeCn(snap.mode) },
          // 「今天做了几件 / 下一拍什么时候」是主人最想第一眼看到、后端却一直白 giving 的两个数
          { k: '今天做过', v: `${Number(life.actionsToday ?? 0)} 件` },
          { k: '下一拍', v: countdown(life.nextCheckAt) },
        ]),
      )
      if (mood.secondary && Array.isArray(mood.secondary) && mood.secondary.length) {
        const line = ui.h('div')
        line.style.margin = '6px 0'
        line.textContent = `还掺着：${mood.secondary.join('、')}${mood.inner ? `；面上：${mood.inner}` : ''}`
        stats.append(line)
      }
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

      // 睡着时段：累了歇着 ≠ 睡着了，两件事分开给主人控
      const sleepRow = ui.h('div')
      sleepRow.style.margin = '12px 0'
      const win = snap.sleepWindow
      const startIn = ui.input({ value: win ? String(win.start) : '01:00', placeholder: '01:00' })
      const endIn = ui.input({ value: win ? String(win.end) : '07:00', placeholder: '07:00' })
      const setInputsEnabled = (on: boolean) => {
        startIn.disabled = !on
        endIn.disabled = !on
      }
      setInputsEnabled(Boolean(win))
      const sleepSeg = ui.segmented(
        [
          { value: 'on', label: '按时段判睡' },
          { value: 'off', label: '关掉时段（只按闲多久）' },
        ],
        { value: win ? 'on' : 'off', onSelect: (v) => setInputsEnabled(v === 'on') },
      )
      const applySleep = actionButton(ctx, ui, msg, '设定睡着时段', 'setSleepWindow', undefined, {
        argsFactory: () => [sleepSeg.value === 'off' ? { off: true } : { start: startIn.value.trim(), end: endIn.value.trim() }],
        after: refresh,
      })
      sleepRow.append(
        ui.field('几点睡', startIn),
        ui.field('几点醒', endIn),
      )
      const restNow = snap.rest === 'asleep' ? '她现在睡着'
        : snap.rest === 'resting' ? '她有点累，在歇着（不做梦，体力慢慢回）'
        : '她醒着'
      const restPill = ui.pill(`【${restNow}】`, snap.rest === 'asleep' ? 'on' : undefined)
      actions.append(restPill, sleepRow, sleepSeg.el, applySleep)

      /**
       * 她最近发生过什么（批次 10 · F8）。
       *
       * 后端 `getSnapshot` 一直把 `recentChain`（最近 20 条因果账）带回来，**前端零引用**——
       * 也就是说她的生活轨迹你本来就能在这一页看见，只是没人画。
       * 这不是锦上添花：§1.5（召回僵化）和 §1.6（验收残留进了她记忆）
       * 这两件事，有了这条流你自己就发现了，不必等我写进审计文档。
       */
      const chain = Array.isArray(snap.recentChain) ? snap.recentChain : []
      const flowTitle = ui.section('她最近发生过什么', '因果账最近 20 条，新→旧。她说过什么、动过什么、你怎么调的，都在这张表里。')
      const flow = ui.table({ head: ['时间', '发生了什么', '来源'], maxHeight: 'calc(100vh - 300px)' })
      const when = (c: any): string => {
        const ms = Number(c.atMs ?? Date.parse(String(c.timestamp ?? '')))
        return Number.isFinite(ms)
          ? new Date(ms).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
          : '—'
      }
      const one = (n: unknown): string => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : String(n ?? '—'))
      const what = (c: any): string => String(c.description ?? c.type ?? '—')
        + (Array.isArray(c.fieldChanges) && c.fieldChanges.length
          ? `（${c.fieldChanges.map((f: any) => `${f.field} ${one(f.from)}→${one(f.to)}`).join('，')}）`
          : '')
      // clear(带话) 会铺一行跨列空态；**只有真的没数据时才给它话**，
      // 否则空态行会和后面的记录并排站着（写完在浏览器里才发现，21 行 = 1 空态 + 20 条）。
      flow.clear(chain.length ? undefined : '账上还没有记录——她今天没动过，也没人调过她。')
      for (const c of chain) flow.addRow([when(c), what(c), sourceCn(c.source)])
      actions.append(flowTitle, flow.el)
    }

    void refresh()
  },
}

export default { panels: { tank: tankPanel } }

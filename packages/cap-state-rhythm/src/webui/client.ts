/**
 * 鱼缸与作息遥控台（浏览器端面板）。
 *
 * 这是主人最常看的一页：她的 6 条场值与心情能看、能直接拖滑块改；能一键戳醒她；
 * 能切作息模式（自然 / 强制休息 / 保持清醒）。
 * 所有写操作都落到服务端的方法上，改完立刻回读确认（不靠"点了应该成功"）。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, sliderField, createDirtyGuard } from '../../../cortico-adapter/src/webui-helpers.ts'

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
  // 下面五个是**对着她真账补的**（2026-11-05）：这几类来源代码里真在写
  // （state-store 的 presets 与 wake/rest 路径），但表里没有，
  // 于是因果账的「来源」列摊出英文原词。查她账上的实际值，而不是猜有哪些值。
  watchedKeep: '看完一条，收了',
  watchedDrop: '看完一条，没收',
  watchedUnclear: '看完一条，没判断出来',
  wake: '被人叫醒了',
  rest: '她歇了一会儿',
}
const sourceCn = (s: unknown): string => {
  // null/undefined 先兜住：`String(undefined)` 是 "undefined"，它既非空也 truthy，
  // 于是页面上会实实在在印出「undefined」这个词（她账上真有这样的旧条目）。
  if (s === null || s === undefined || s === '') return '没记来源'
  const k = String(s)
  return SOURCE_CN[k] ?? k
}

const MODE_CN: Record<string, string> = {
  auto: '自然节律',
  force_sleep: '强制休息',
  force_awake: '保持清醒',
}
const modeCn = (m: unknown): string => MODE_CN[String(m)] ?? String(m ?? '—')

/** 「2026-11-05 07:20」这种写法比原始毫秒时间戳好读，也比 toISOString 的 UTC 诚实。 */
const when = (c: any): string => {
  const ms = Number(c.atMs ?? Date.parse(String(c.timestamp ?? '')))
  return Number.isFinite(ms)
    ? new Date(ms).toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    : '—'
}

const one = (n: unknown): string => (typeof n === 'number' ? String(Math.round(n * 100) / 100) : String(n ?? '—'))

/** 一条因果账翻成一句人话：动作 + 如果改了场值就把"从多少到多少"写在后面。 */
const what = (c: any): string => String(c.description ?? c.type ?? '—')
  + (Array.isArray(c.fieldChanges) && c.fieldChanges.length
    ? `（${c.fieldChanges.map((f: any) => `${f.field} ${one(f.from)}→${one(f.to)}`).join('，')}）`
    : '')

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

/** 多久以前——与 countdown 相反的方向，别混用：把过去的时间塞进倒计时会说出"就这一会儿"。 */
const ago = (at: unknown): string => {
  const ms = Date.now() - Number(at)
  if (!Number.isFinite(ms) || ms < 0) return '—'
  const min = Math.round(ms / 60_000)
  if (min < 1) return '就在刚才'
  if (min < 60) return `${min} 分钟前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} 小时 ${min % 60} 分前`
  return `${Math.floor(h / 24)} 天 ${h % 24} 小时前`
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
      // 强制模式要能"到点自己回来"：主人戳一下"保持清醒"是临时意思，
      // 不是让她从此再不睡（以前 mode 一落盘就永久生效，她夜里被叫醒就再也睡不着）。
      const expiryIn = ui.input({ type: 'number', min: 0, step: 5, placeholder: '分钟（0 = 不限时）' })
      const modeExpiresAt = Number(snap.modeExpiresAt ?? 0)
      expiryIn.value = modeExpiresAt > 0 ? String(Math.max(1, Math.round((modeExpiresAt - Date.now()) / 60_000))) : '0'
      modeRow.append(ui.field('强制多久后自动回到自然节律', expiryIn))
      const applyMode = actionButton(ctx, ui, msg, '切换作息模式', 'setMode', undefined, {
        argsFactory: () => [{ mode: seg.value, expiresInMinutes: Number(expiryIn.value) || 0 }],
        after: refresh,
      })
      actions.append(modeRow, applyMode)
      if (modeExpiresAt > 0) {
        const exp = ui.h('div')
        exp.style.margin = '4px 0'
        exp.textContent = `当前强制模式到 ${new Date(modeExpiresAt).toLocaleString()} 为止，到点自动回到自然节律。`
        actions.append(exp)
      }

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
      // clear(带话) 会铺一行跨列空态；**只有真的没数据时才给它话**，
      // 否则空态行会和后面的记录并排站着（写完在浏览器里才发现，21 行 = 1 空态 + 20 条）。
      flow.clear(chain.length ? undefined : '账上还没有记录——她今天没动过，也没人调过她。')
      for (const c of chain) flow.addRow([when(c), what(c), sourceCn(c.source)])
      actions.append(flowTitle, flow.el)
    }

    void refresh()
  },
}

/**
 * 「她的一天」——主人打开控制台第一眼的那页（设计交接 story-5）。
 *
 * 三个问题一屏答完：**她现在在干什么 / 今天做过什么 / 刚才说了什么**。
 * 口吻是生活不是运维：写「今天做过 3 件」而不是 `actionsToday=3`，
 * 写「4 分钟后自己醒一次」而不是 `nextCheckAt=1793834109409`。
 *
 * 这一页只读：拉滑块、戳醒、改睡眠时段在「鱼缸」，节奏在「配置」。
 * 同一件事不开放第二个入口，免得两边状态对不上。
 */
export const dayPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '她的一天',
      en: 'her day',
      desc: '她现在在干什么、今天做过什么、最近说了什么。要动手去「鱼缸」，改节奏去「配置」。',
    })
    root.appendChild(card.el)

    const msg = ui.msgline()
    const nowBox = ui.h('div')
    nowBox.style.margin = '8px 0'
    const statBox = ui.h('div')
    const pokeBox = ui.h('div')
    pokeBox.style.margin = '10px 0'
    const guard = createDirtyGuard(ui)
    const pokeHint = ui.input({ placeholder: '（可选）叮嘱她一句' })
    guard.watch(pokeHint, () => '')
    /**
     * 戳醒她：与「鱼缸」同一份实现，回执说清**做了什么、还没看到什么**。
     * 不加确认层——她能取消、可重复，也不对外写；确认疲劳是要付钱的。
     */
    const poke = actionButton(ctx, ui, msg, '👉 戳醒她，跑一轮', 'wakeNow', undefined, {
      variant: 'primary',
      argsFactory: () => [{ hint: pokeHint.value.trim() }],
      after: async (r: any) => {
        if (!r || r.ok === false) return undefined
        const rec = r.receipt ?? {}
        const lines = [
          '这一拍做了：',
          ...(Array.isArray(rec.did) ? rec.did.map((x: string) => `  · ${x}`) : []),
          rec.notYet ? `还没看到：${rec.notYet}` : '',
        ].filter(Boolean)
        pokeHint.value = ''
        // 回执要**刷完再写**：refresh 开头会把消息行清空，先写就等于没写
        // （同一个坑在 actionButton 的失败路径上记过一次）。
        await refresh()
        msg.textContent = lines.join('\n')
      },
    })
    pokeBox.append(ui.field('叫醒她', pokeHint), poke)
    const flowBox = ui.h('div')
    const wordsBox = ui.h('div')
    const links = ui.actions()
    card.body.append(nowBox, statBox, pokeBox, flowBox, wordsBox, links, msg)

    const jump = (href: string, label: string) => {
      const a = ui.h('a', null, label)
      a.setAttribute('href', href)
      a.style.marginRight = '10px'
      return a
    }
    links.append(
      jump('#/provider/world%3Abili-account/drafts-queue', '→ 待放行改稿台'),
      jump('#/provider/world%3Abili-account/preferences', '→ 看片偏好'),
      jump('#/provider/persona%3Axiaoyu/tank', '→ 鱼缸（要动手在这儿）'),
    )

    /**
     * 她最近说了什么：读宿主那份 transcript 账（`/api/session/history`，只追加、从不剪枝，
     * 交接/清空都动不到它）。这是宿主自己的只读接口，不是我们另起的一套真相；
     * 拿不到就老实说拿不到，不假装"她没说话"。
     */
    async function loadWords() {
      wordsBox.replaceChildren(ui.section('她最近说了什么', '来自对话记录（只追加的那本账），新→旧最多 5 句。'))
      let list: any[] = []
      try {
        const r = await fetch('/api/session/history?limit=80', { credentials: 'same-origin' })
        const j: any = await r.json()
        list = (j?.records ?? [])
          .filter((x: any) => x?.item?.type === 'message' && x?.item?.role === 'assistant')
          .slice(-5)
          .reverse()
      } catch (e) {
        wordsBox.append(ui.msgline(`对话记录读不出来：${String((e as any)?.message ?? e)}（她的话还在，只是这一页取不到）`, true))
        return
      }
      if (!list.length) {
        wordsBox.append(ui.placeholder('这一截记录里她还没开口。'))
        return
      }
      for (const rec of list) {
        const text = (rec.item?.content ?? [])
          .map((c: any) => (typeof c?.text === 'string' ? c.text : ''))
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim()
        if (!text) continue
        const line = ui.h('div')
        line.style.margin = '6px 0'
        line.style.whiteSpace = 'pre-wrap'
        const meta = ui.h('span')
        meta.style.opacity = '0.6'
        meta.style.marginRight = '8px'
        meta.textContent = when(rec)
        line.append(meta, ui.chip(`「${text.slice(0, 160)}${text.length > 160 ? '…' : ''}」`, 'plain'))
        wordsBox.append(line)
      }
    }

    async function refresh() {
      // 这一页不重建输入框（叮嘱框建一次），所以登记不重置：重置等于把保护摘了
      if (!(await guard.guard())) return
      const s = await call<any>(ctx, msg, 'get', {})
      if (!s) return
      const today = s.today ?? {}
      const restCn = s.rest === 'asleep' ? '她睡着了' : s.rest === 'resting' ? '她在歇着（累了，慢慢回血）' : '她醒着'
      nowBox.replaceChildren(ui.pill(`${restCn}｜${modeCn(s.mode)}`, s.rest === 'asleep' ? 'off' : 'on'))
      if (s.described) {
        const d = ui.h('div')
        d.style.margin = '6px 0'
        d.textContent = String(s.described)
        nowBox.append(d)
      }
      statBox.replaceChildren(ui.statgrid([
        { k: '今天做过', v: `${Number(today.actionsToday ?? 0)} 件`, accent: true },
        { k: '离上次行动', v: Number(today.lastActionAt) > 0 ? ago(today.lastActionAt) : '今天还没动过' },
        { k: '下一拍', v: countdown(today.nextCheckAt) },
        { k: '心情强度', v: pct((s.mood ?? {}).intensity) },
      ]))

      const events = Array.isArray(s.events) ? s.events : []
      flowBox.replaceChildren(ui.section('今天发生过什么', `因果账里属于今天的 ${events.length} 条（新→旧）。`))
      const flow = ui.table({ head: ['时间', '发生了什么', '来源'] })
      // 空态只在真的没有时铺话；带数据的刷新不许留下占位行（浏览器实测踩过）
      flow.clear(events.length ? undefined : (Number(today.actionsToday ?? 0) > 0
        ? '账上没有流水条目，但她今天动过——这一条值得去「鱼缸」核对因果账。'
        : '今天还没有记录。她没动，也没人调过她。'))
      for (const c of events) flow.addRow([when(c), what(c), sourceCn(c.source)])
      flowBox.append(flow.el)
      await loadWords()
    }

    void refresh()
  },
}

export default { panels: { day: dayPanel, tank: tankPanel } }

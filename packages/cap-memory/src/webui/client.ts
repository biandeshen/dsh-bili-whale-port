/**
 * 记忆管理中心（浏览器端面板）。
 *
 * 解决"记忆为什么不可查、不可控"：四层卡片全量可检索，可直接塞一条记忆给她、
 * 在线改错字、调鲜活度、置顶进核心常驻、一键作废与恢复，还能看版本历史并回滚。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, textField, createDirtyGuard, debounce } from '../../../cortico-adapter/src/webui-helpers.ts'

/** 浏览器全局里用到的那一个（作废理由 / 存档点名字走原生 prompt，取消返回 null）。 */
declare const window: { prompt: (text: string, value?: string) => string | null }

const TIERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'core', label: '核心常驻' },
  { id: 'active', label: '近期活跃' },
  { id: 'archived', label: '远期归档' },
  { id: 'voided', label: '已作废' },
]

/** 层级英文名给她主人看没意义（走查 story-8：枚举中文化） */
function tierCn(t: unknown): string {
  return TIERS.find((x) => x.id === t)?.label ?? String(t ?? '未知')
}

/** 鲜活度是 0~1 的浮点，页面上写 0.8999999 不如写 90% */
function pct(v: unknown): string {
  const n = Number(v)
  if (!Number.isFinite(n)) return '—'
  return `${Math.round(Math.max(0, Math.min(1, n)) * 100)}%`
}

export const memoryCenterPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '记忆管理中心',
      en: 'memory center',
      desc: '她记住了什么，你能查、能改、能塞、能作废、能恢复。改完立刻回读确认。',
    })
    root.appendChild(card.el)

    const msg = ui.msgline()
    // 每张卡三个输入框，刷新整列表就会把它们一起抹掉——登记进未保存闸门（走查 story-3）
    const guard = createDirtyGuard(ui)
    const tierRow = ui.h('div')
    tierRow.style.margin = '8px 0'
    const search = ui.input({ placeholder: '搜正文 / 标签 / id' })
    const listBox = ui.h('div')
    const createBox = ui.h('div')
    const histBox = ui.h('div')
    card.body.append(tierRow, ui.field('搜索', search), listBox, createBox, histBox, msg)

    let tier = 'all'

    const tierSeg = ui.segmented(
      TIERS.map((t) => ({ value: t.id, label: t.label })),
      // 切档必须重新取数：原来这里只赋值不刷新，点「核心常驻」列表根本不动（真点一次才发现）
      { value: tier, onSelect: (v) => { tier = v; void refresh() } },
    )
    tierRow.append(tierSeg.el)

    async function refresh() {
      if (!(await guard.guard())) return
      const res = await call<any>(ctx, msg, 'list', { tier, query: search.value.trim() || undefined })
      if (!res) return
      guard.reset()
      listBox.replaceChildren()
      const head = ui.h('div')
      head.style.margin = '10px 0 4px'
      head.textContent = `共 ${res.counts?.total ?? 0} 条（核心 ${res.counts?.core ?? 0} / 活跃 ${res.counts?.active ?? 0} / 归档 ${res.counts?.archived ?? 0} / 作废 ${res.counts?.voided ?? 0}）`
      listBox.append(head)

      for (const card0 of res.items ?? []) {
        const slot = ui.h('div')
        listBox.append(slot)
        drawCard(slot, card0)
      }
    }

    /**
     * 一张卡片一个 slot：改完只重画这一张（走查 story-3「记忆列表按 id 局部更新」）。
     *
     * 原来每次保存都 `refresh()` 整列表重建，代价不只是多一次请求——
     * 你在这张卡上打的字、别的卡上没保存的字，全跟着一起没了。
     * 只有"这条已经不属于当前这一档"（置顶/移出/作废改了 tier）才真的需要重新取数。
     */
    function drawCard(slot: HTMLElement, card0: any) {
      const box = ui.sheet({
        title: card0.content?.slice(0, 40) || card0.id,
        desc: `#${card0.id} · ${tierCn(card0.tier)} · 鲜活 ${pct(card0.vividness)} · 被想起 ${card0.accessCount ?? 0} 次`,
      })
      const meta = ui.h('div')
      meta.style.margin = '6px 0'
      meta.textContent = `标签：${(card0.tags ?? []).join('、') || '（无）'}　${card0.voidReason ? `作废理由：${card0.voidReason}` : ''}`
      const acts = ui.actions()

      const content = ui.textarea({ value: card0.content ?? '', rows: 3 })
      const vivid = ui.input({ value: String(card0.vividness ?? 0.9), type: 'number', min: 0, max: 1, step: 0.05 })
      const tags = ui.input({ value: (card0.tags ?? []).join(','), placeholder: '标签，逗号分隔' })
      // 先挂上再登记：dirty 闸门靠 isConnected 区分"还在屏上"与"已被重画摘掉"
      slot.replaceChildren(box.el)
      guard.watch(content, () => card0.content ?? '')
      guard.watch(vivid, () => String(card0.vividness ?? 0.9))
      guard.watch(tags, () => (card0.tags ?? []).join(','))

      /** 存成功就用返回值同步这张卡，只重画它；不属于当前筛选了才重新取数 */
      const syncOrRefresh = (r: any) => {
        if (!r || r.ok === false) return undefined
        if (r.card) Object.assign(card0, r.card)
        if (tier !== 'all' && card0.tier !== tier) return refresh()
        return drawCard(slot, card0)
      }

      const save = actionButton(ctx, ui, msg, '保存修改', 'update', undefined, {
        argsFactory: () => [{
          id: card0.id,
          content: content.value,
          tags: tags.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
          vividness: Number(vivid.value),
        }],
        after: syncOrRefresh,
      })
      acts.append(save)

      if (card0.tier !== 'core' && card0.tier !== 'voided') {
        const pin = actionButton(ctx, ui, msg, '⭐ 置顶进核心', 'update', undefined, {
          argsFactory: () => [{ id: card0.id, tier: 'core' }],
          // 进核心 = 她每一轮都带着这条，是行为改变；设计把"置顶核心"列进必须确认的名单
          confirm: {
            title: '确认把这条放进核心常驻？',
            body: () => `「${String(card0.content ?? '').slice(0, 60)}」\n\n核心常驻会出现在她每一轮的上下文里，占预算也影响她说什么。`,
            warn: '想撤出来用「移出核心」，随时可以做。',
            ok: '确认置顶',
          },
          after: syncOrRefresh,
        })
        acts.append(pin)
      }
      if (card0.tier === 'core' && card0.tier !== 'voided') {
        const demote = actionButton(ctx, ui, msg, '📥 移出核心', 'update', undefined, {
          argsFactory: () => [{ id: card0.id, tier: 'active' }],
          after: syncOrRefresh,
        })
        acts.append(demote)
      }
      if (card0.tier !== 'voided') {
        let voidReason = ''
        const voidBtn = actionButton(ctx, ui, msg, '🚫 作废', 'void', undefined, {
          variant: 'danger',
          preRun: async () => {
            const why = window.prompt('作废理由（至少 6 个字，会留痕）', '主人在记忆面板确认这条记错了')
            if (why === null || why === undefined) return '没填理由，已取消作废'
            voidReason = why
            return null
          },
          argsFactory: () => [{ id: card0.id, reason: voidReason }],
          after: syncOrRefresh,
        })
        acts.append(voidBtn)
      } else {
        const restore = actionButton(ctx, ui, msg, '↩ 恢复', 'restore', undefined, {
          argsFactory: () => [{ id: card0.id, targetTier: 'active' }],
          after: syncOrRefresh,
        })
        acts.append(restore)
      }

      box.body.append(meta, ui.field('正文', content), ui.field('鲜活度', vivid), ui.field('标签', tags), acts)
    }

    // ── 新增：塞一条记忆给她 ──
    const newContent = ui.textarea({ placeholder: '你想让她记住什么？', rows: 2 })
    const newTags = ui.input({ placeholder: '标签，逗号分隔（可选）' })
    const newCore = ui.checkbox('直接放进核心常驻（她每一轮都记得）')
    const newActs = ui.actions()
    const addBtn = actionButton(ctx, ui, msg, '＋ 塞一条记忆给她', 'create', undefined, {
      variant: 'primary',
      argsFactory: () => [{
        content: newContent.value.trim(),
        tags: newTags.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
        tier: newCore.checked ? 'core' : 'active',
        sender: 'player',
      }],
      after: async () => {
        newContent.value = ''
        newTags.value = ''
        await refresh()
      },
    })
    newActs.append(addBtn)
    createBox.append(ui.h('h3'), ui.field('正文', newContent), ui.field('标签', newTags), newCore.el, newActs)

    // ── 版本历史与回滚 ──
    const histActs = ui.actions()
    const loadHist = actionButton(ctx, ui, msg, '查看版本历史', 'history', undefined, { after: () => renderHist() })
    histActs.append(loadHist)
    histBox.append(histActs)

    async function renderHist() {
      const res = await call<any>(ctx, msg, 'history', { limit: 20 })
      if (!res) return
      histBox.replaceChildren(histActs)
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `工作区版本历史：${res.status?.repo ? '已建仓' : '未建仓'}${res.status?.head ? ` · HEAD ${res.status.head}` : ''}${res.status?.dirty ? ' · 有未提交改动' : ''}`
      histBox.append(head)
      const table = ui.table({ head: ['提交', '作者', '说明', '操作'] })
      for (const c of res.log ?? []) {
        const diff = actionButton(ctx, ui, msg, '看改动', 'history', undefined, {
          argsFactory: () => [{ diffOf: c.hash }],
          after: async () => { await renderDiff(c.hash) },
        })
        table.addRow([c.hash, c.author, c.message?.slice(0, 40) ?? '', diff])
      }
      histBox.append(table.el)
    }

    async function renderDiff(hash: string) {
      const res = await call<any>(ctx, msg, 'history', { diffOf: hash })
      if (!res) return
      const pre = ui.h('pre')
      pre.style.maxHeight = '320px'
      pre.style.overflow = 'auto'
      pre.style.whiteSpace = 'pre-wrap'
      pre.textContent = res.diff ?? ''
      histBox.append(pre)
    }

    const cp = actionButton(ctx, ui, msg, '打一个存档点（checkpoint）', 'checkpoint', undefined, {
      argsFactory: () => [{
        name: window.prompt('存档点名（字母数字/中文）', '手动存档') ?? '',
        message: window.prompt('存档点说明', '') ?? '',
      }],
      after: renderHist,
    })
    histActs.append(cp)

    // 300ms 防抖：原来每敲一个字就发一次全量搜索（中文输入法组词期间也在跳）
    const searchDebounced = debounce(() => { void refresh() }, 300)
    search.addEventListener('input', () => { searchDebounced.run() })
    void refresh()
  },
}

export default { panels: { 'memory-center': memoryCenterPanel } }

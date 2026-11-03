/**
 * 记忆管理中心（浏览器端面板）。
 *
 * 解决"记忆为什么不可查、不可控"：四层卡片全量可检索，可直接塞一条记忆给她、
 * 在线改错字、调鲜活度、置顶进核心常驻、一键作废与恢复，还能看版本历史并回滚。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, textField } from '../../../cortico-adapter/src/webui-helpers.ts'

const TIERS: Array<{ id: string; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'core', label: '核心常驻' },
  { id: 'active', label: '近期活跃' },
  { id: 'archived', label: '远期归档' },
  { id: 'voided', label: '已作废' },
]

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
      { value: tier, onSelect: (v) => { tier = v } },
    )
    tierRow.append(tierSeg.el)

    async function refresh() {
      const res = await call<any>(ctx, msg, 'list', { tier, query: search.value.trim() || undefined })
      if (!res) return
      listBox.replaceChildren()
      const head = ui.h('div')
      head.style.margin = '10px 0 4px'
      head.textContent = `共 ${res.counts?.total ?? 0} 条（核心 ${res.counts?.core ?? 0} / 活跃 ${res.counts?.active ?? 0} / 归档 ${res.counts?.archived ?? 0} / 作废 ${res.counts?.voided ?? 0}）`
      listBox.append(head)

      for (const card0 of res.items ?? []) {
        const box = ui.sheet({ title: card0.content?.slice(0, 40) || card0.id, desc: `#${card0.id} · ${card0.tier} · 鲜活 ${Number(card0.vividness ?? 0).toFixed(2)} · 被想起 ${card0.accessCount ?? 0} 次` })
        const meta = ui.h('div')
        meta.style.margin = '6px 0'
        meta.textContent = `标签：${(card0.tags ?? []).join('、') || '（无）'}　${card0.voidReason ? `作废理由：${card0.voidReason}` : ''}`
        const acts = ui.actions()

        const content = ui.textarea({ value: card0.content ?? '', rows: 3 })
        const vivid = ui.input({ value: String(card0.vividness ?? 0.9), type: 'number', min: 0, max: 1, step: 0.05 })
        const tags = ui.input({ value: (card0.tags ?? []).join(','), placeholder: '标签，逗号分隔' })

        const save = actionButton(ctx, ui, msg, '保存修改', 'update', undefined, {
          argsFactory: () => [{
            id: card0.id,
            content: content.value,
            tags: tags.value.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean),
            vividness: Number(vivid.value),
          }],
          after: refresh,
        })
        acts.append(save)

        if (card0.tier !== 'core' && card0.tier !== 'voided') {
          const pin = actionButton(ctx, ui, msg, '⭐ 置顶进核心', 'update', undefined, {
            argsFactory: () => [{ id: card0.id, tier: 'core' }],
            after: refresh,
          })
          acts.append(pin)
        }
        if (card0.tier === 'core' && card0.tier !== 'voided') {
          const demote = actionButton(ctx, ui, msg, '📥 移出核心', 'update', undefined, {
            argsFactory: () => [{ id: card0.id, tier: 'active' }],
            after: refresh,
          })
          acts.append(demote)
        }
        if (card0.tier !== 'voided') {
          const voidBtn = actionButton(ctx, ui, msg, '🚫 作废', 'void', undefined, {
            variant: 'danger',
            argsFactory: () => [{ id: card0.id, reason: window.prompt('作废理由（至少 6 个字，会留痕）', '主人在记忆面板确认这条记错了') ?? '' }],
            after: refresh,
          })
          acts.append(voidBtn)
        } else {
          const restore = actionButton(ctx, ui, msg, '↩ 恢复', 'restore', undefined, {
            argsFactory: () => [{ id: card0.id, targetTier: 'active' }],
            after: refresh,
          })
          acts.append(restore)
        }

        box.body.append(meta, ui.field('正文', content), ui.field('鲜活度', vivid), ui.field('标签', tags), acts)
        listBox.append(box.el)
      }
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

    search.addEventListener('input', () => { void refresh() })
    void refresh()
  },
}

export default { panels: { 'memory-center': memoryCenterPanel } }

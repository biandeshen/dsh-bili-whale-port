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
    const recallBox = ui.h('div')
    // diff 单独一个容器：每次「看改动」只显示最新一份，不往历史区里叠
    const diffBox = ui.h('div')
    card.body.append(tierRow, ui.field('搜索', search), listBox, createBox, recallBox, histBox, diffBox, msg)

    let tier = 'all'

    const tierSeg = ui.segmented(
      TIERS.map((t) => ({ value: t.id, label: t.label })),
      // 切档必须重新取数：原来这里只赋值不刷新，点「核心常驻」列表根本不动（真点一次才发现）
      { value: tier, onSelect: (v) => { tier = v; void refresh() } },
    )
    tierRow.append(tierSeg.el)

    // ── 核心常驻审阅（只提示，不自动动她的记忆）──
    const reviewBox = ui.h('div')
    card.body.append(reviewBox)
    const reviewBtn = actionButton(ctx, ui, msg, '🔍 审一下核心常驻', 'coreReview', undefined, {
      after: (r: any) => { if (r && r.ok !== false) renderReview(r) },
    })
    reviewBox.append(reviewBtn)

    /** 渲染审阅结果：每条一个提示 + 一颗「退下来」（移到 active，不删）。 */
    function renderReview(res: any) {
      const items: any[] = res?.items ?? []
      const c = res?.counts ?? {}
      reviewBox.replaceChildren(reviewBtn)
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `核心常驻共 ${res?.total ?? 0} 条 · `
        + `从没被想起 ${c.unused ?? 0} 条（其中超过 ${res?.staleDays ?? 14} 天没被想起的 ${c.longUnused ?? 0} 条）· `
        + `同主题重复 ${c.duplicateTopic ?? 0} 条 · 像某次具体经过的 ${c.specificEvent ?? 0} 条`
      reviewBox.append(head)
      const note = ui.h('div')
      note.style.margin = '4px 0'
      note.style.opacity = '0.8'
      note.textContent = '这些只是提示，不会自动改她的记忆。退下来 = 移到「近期活跃」（不删，git 里有历史）。'
      reviewBox.append(note)
      if (!items.length) {
        reviewBox.append(ui.placeholder('核心常驻是空的。'))
        return
      }
      const table = ui.table({ head: ['这条', '想起', '活了', '提示', '操作'] })
      for (const it of items) {
        const hints: string[] = []
        if (it.longUnused) hints.push(`从没被想起（${it.ageDays} 天）`)
        else if (it.unused) hints.push('从没被想起')
        if (it.sameTopic?.length) hints.push(`同主题还有 ${it.sameTopic.length} 条`)
        if (it.specificEvent) hints.push('像某一次的具体经过')
        const demote = actionButton(ctx, ui, msg, '退下来', 'update', undefined, {
          variant: 'danger',
          argsFactory: () => [{ id: it.id, tier: 'active' }],
          confirm: {
            title: '确认把这条从核心常驻退下来？',
            body: `这条：${String(it.content ?? '').slice(0, 60)}\n\n退下来之后：她不再每一轮都带着它（要靠关键词撞上才会想起），`
              + '原文还在「近期活跃」里，随时能放回去；git 里有历史。',
            warn: '核心常驻是她每一轮都记得的那几条——退下来不是删，是不再每轮都带。',
            ok: '确认退下来',
          },
          after: (r: any) => {
            if (r && r.ok !== false) {
              msg.textContent = '已退到「近期活跃」（没删，随时能放回去）'
              void refresh()
            }
          },
        })
        table.addRow([
          String(it.content ?? '').slice(0, 40),
          `${it.accessCount ?? 0} 次`,
          `${it.ageDays ?? 0} 天`,
          hints.join('；') || '（没看出问题）',
          hints.length ? demote : '—',
        ])
      }
      reviewBox.append(table.el)
    }

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

    // ── 召回解释：她为什么想起这条（四因子摊开给人看）──
    recallBox.append(ui.section('召回解释', '写一句当时的情境，我照着她那套打分算一遍：哪条会被想起、'
      + '是被关键词、鲜活度、情绪还是新鲜度拽出来的，各占多少分。'))
    const recallInput = ui.input({ placeholder: '当时在想什么？（例如：雨声 助眠 白噪音）' })
    const recallOut = ui.h('div')
    const recallBtn = actionButton(ctx, ui, msg, '🧮 算一算', 'recallExplain', undefined, {
      variant: 'primary',
      argsFactory: () => [{ text: recallInput.value.trim(), limit: 10 }],
      after: async (r: any) => { if (r && r.ok !== false) renderRecall(r) },
    })
    const recallActs = ui.actions()
    recallActs.append(recallBtn)
    recallBox.append(ui.field('情境', recallInput), recallActs, recallOut)

    /** 一个因子画成一条：标签 + 占比条 + 贡献分。 */
    function factorBar(label: string, raw: number, weight: number, contribution: number): HTMLElement {
      const row = ui.h('div')
      row.style.display = 'flex'
      row.style.alignItems = 'center'
      row.style.gap = '6px'
      row.style.margin = '2px 0'
      const name = ui.h('span')
      name.textContent = label
      name.style.width = '72px'
      name.style.flex = 'none'
      const track = ui.h('div')
      track.style.flex = '1'
      track.style.height = '8px'
      track.style.background = 'rgba(127,127,127,0.18)'
      track.style.borderRadius = '4px'
      track.style.overflow = 'hidden'
      const fill = ui.h('div')
      fill.style.height = '100%'
      // 条的长度按"贡献分占总分权重上限的比例"画，这样四根条能横向比
      fill.style.width = `${Math.max(0, Math.min(100, Math.round((contribution / Math.max(weight, 0.0001)) * 100)))}%`
      fill.style.background = 'var(--accent, #6aa9ff)'
      track.append(fill)
      const val = ui.h('span')
      val.textContent = `原值 ${pct(raw)} · 贡献 ${contribution.toFixed(3)}`
      val.style.width = '160px'
      val.style.flex = 'none'
      val.style.textAlign = 'right'
      row.append(name, track, val)
      return row
    }

    function renderRecall(res: any) {
      const items: any[] = res?.items ?? []
      const weights = res?.weights ?? {}
      recallOut.replaceChildren()
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `候选池 ${res?.poolSize ?? 0} 条 · 排出 ${items.length} 条 · `
        + `权重：关键词 ${weights.keyword ?? '—'} / 鲜活 ${weights.vivid ?? '—'} / 情绪 ${weights.mood ?? '—'} / 新鲜 ${weights.recency ?? '—'}`
      recallOut.append(head)
      if (!items.length) {
        recallOut.append(ui.placeholder('没有匹配上的记忆。换几个词试试，或者去「塞一条记忆给她」。'))
        return
      }
      for (const it of items) {
        const box = ui.h('div')
        box.style.margin = '8px 0'
        box.style.padding = '8px'
        box.style.border = '1px solid rgba(127,127,127,0.25)'
        box.style.borderRadius = '6px'
        const title = ui.h('div')
        title.textContent = `${it.content?.slice(0, 60) ?? it.id}　总分 ${Number(it.score ?? 0).toFixed(3)}`
        const why = ui.h('div')
        why.style.margin = '4px 0'
        why.textContent = (it.why ?? []).join(' · ')
        const f = it.factors ?? {}
        box.append(title, why)
        box.append(factorBar('关键词', f.keyword, weights.keyword ?? 0.4, f.contributions?.keyword ?? 0))
        box.append(factorBar('鲜活度', f.vivid, weights.vivid ?? 0.3, f.contributions?.vivid ?? 0))
        box.append(factorBar('情绪', f.mood, weights.mood ?? 0.15, f.contributions?.mood ?? 0))
        box.append(factorBar('新鲜度', f.recency, weights.recency ?? 0.15, f.contributions?.recency ?? 0))
        recallOut.append(box)
      }
    }

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
      const dirty = Boolean(res.status?.dirty)
      head.textContent = `工作区版本历史：${res.status?.repo ? '已建仓' : '未建仓'}${res.status?.head ? ` · HEAD ${res.status.head}` : ''}${dirty ? ' · 有未提交改动' : ''}`
      histBox.append(head)

      /**
       * 存档点（annotated tag）才是能回滚到的地方——commit 不是，
       * 因为回滚走的是 `reset --hard <tag>` + `clean -fd`（后端 checkoutTag 的既有语义）。
       * 这一块以前没有：面板写着"可回退"，页面上却没有那颗键（设计走查 story-7 的"承诺过不能用"）。
       */
      const checkpoints: Array<{ name: string; message?: string; hash?: string; date?: string }> = res.status?.checkpoints ?? []
      const tagBox = ui.h('div')
      tagBox.style.margin = '8px 0'
      tagBox.append(ui.section('存档点与回滚', checkpoints.length
        ? `${checkpoints.length} 个存档点。回滚会丢掉它之后的记忆与日记改动，并把未跟踪的文件一并清掉。`
        : '还没有存档点。先点「打一个存档点」再谈回滚——没有存档点的"回滚"是不存在的承诺。'))
      for (const t of checkpoints) {
        const row = ui.h('div')
        row.style.display = 'flex'
        row.style.gap = '8px'
        row.style.alignItems = 'center'
        row.style.margin = '4px 0'
        const label = ui.h('span')
        label.textContent = `${t.name || '（无名存档点）'}${t.date ? ` · ${new Date(t.date).toLocaleString()}` : ''}${t.message && t.message !== t.name ? ` · ${t.message}` : ''}`
        // 名字拿不到就不给按钮：宁缺毋滥——按钮发一个 undefined 的存档点名，只会让她看到一句看不懂的报错。
        const back = t.name ? actionButton(ctx, ui, msg, '⏮ 回滚到这里', 'rollback', undefined, {
          variant: 'danger',
          argsFactory: () => [{ name: t.name, confirm: true }],
          confirm: {
            title: `确认回滚到存档点「${t.name}」？`,
            body: () => `这会把她整个工作区（记忆 + 日记）重置到这个存档点的样子：\n`
              + `· ${t.name} 之后的所有改动丢掉\n`
              + `· 未跟踪的文件也会被清掉\n`
              + (dirty ? '· 现在工作区还有未提交的改动，也会一并丢掉\n' : '')
              + `\n因果账、待放行队列、她的会话记录不在这个目录里，不会被动到。`,
            warn: '这是丢数据的操作。想留后路就先点「打一个存档点」再回滚。',
            danger: true,
            ok: '确认回滚',
          },
          after: async (r: any) => {
            if (r && r.ok !== false) {
              await refresh()
              await renderHist()
            }
          },
        }) : null
        row.append(label, ...(back ? [back] : []))
        tagBox.append(row)
      }
      histBox.append(tagBox)

      const table = ui.table({ head: ['提交', '作者', '说明', '操作'] })
      for (const c of res.log ?? []) {
        const diff = actionButton(ctx, ui, msg, '看改动', 'history', undefined, {
          argsFactory: () => [{ diffOf: c.hash }],
          after: async (r: any) => {
            if (r && r.ok !== false) await renderDiff(c.hash)
          },
        })
        table.addRow([c.hash, c.author, c.message?.slice(0, 40) ?? '', diff])
      }
      histBox.append(table.el)
    }

    /**
     * 看一次改动，**只留最新的一份**。
     *
     * 以前每次点「看改动」都往页面里 append 一个 <pre>，连点几次就叠几份 diff，
     * 越往下越旧、越难认——主人想找"上次那条改了什么"得在一堆 diff 里翻。
     * 现在先把旧的清掉，只显示当前这一条；commit 行还在表里，想看哪条再点哪条。
     */
    async function renderDiff(hash: string) {
      const res = await call<any>(ctx, msg, 'history', { diffOf: hash })
      if (!res) return
      diffBox.replaceChildren()
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `改动详情：${hash}`
      const pre = ui.h('pre')
      pre.style.maxHeight = '320px'
      pre.style.overflow = 'auto'
      pre.style.whiteSpace = 'pre-wrap'
      pre.textContent = res.diff ?? ''
      diffBox.append(head, pre)
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

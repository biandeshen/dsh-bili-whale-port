/**
 * 日记、判断卡工作台与意见箱分诊台（浏览器端面板）。
 *
 * 解决三件"操作不了"的事：
 *   ① 日记只能读不能改（她写错日期、格式烂，主人在页面上干瞪眼）→ 在线 Markdown 编辑并落盘；
 *   ② 审美判断卡没有独立视图（她自己也抱怨"只能从日记正文里捞"）→ 表格 + 可改结论；
 *   ③ 意见箱 51 条全塞在日记面板里，按钮只有硬编码 resolve:true 的「写批复并解决」
 *      （2026-11-05 审计 D2/D9/D10：无分页无筛选、批复与结案分不开、空的规则值照发）
 *      → 拆成独立的 `feedback-triage` tab：总览行 + 状态/严重度/是否自对治筛选 + 分页 +
 *        批复与结案分离 + 规则类型下拉（只给后端真认的 dislike / keyword / exemptUp）。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, createDirtyGuard } from '../../../cortico-adapter/src/webui-helpers.ts'

export const journalBoardPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '日记与判断卡',
      en: 'diary and judgment cards',
      desc: '读她的两本日记并在线改；看她的审美判断卡。她的意见在「意见箱分诊台」tab 处理。',
    })
    root.appendChild(card.el)

    const msg = ui.msgline()
    const diaryBox = ui.h('div')
    const judgeBox = ui.h('div')
    card.body.append(diaryBox, judgeBox, msg)

    // ── 日记 ──
    const bookSeg = ui.segmented(
      [
        { value: 'public', label: '公开本' },
        { value: 'private', label: '私人本' },
      ],
      { value: 'public' },
    )
    const dateInput = ui.input({ placeholder: '日期 YYYY-MM-DD（留空看最近一页）' })
    const diaryActs = ui.actions()
    const diaryBox2 = ui.h('div')
    diaryBox.append(ui.h('h3'), bookSeg.el, ui.field('日期', dateInput), diaryActs, diaryBox2)

    /** 现在看第几页（0 起）。后端本来就支持分页，页面以前不传，所以永远停在第一页。 */
    let diaryPage = 0

    async function loadDiary(page?: number) {
      if (typeof page === 'number') diaryPage = Math.max(0, page)
      const res = await call<any>(ctx, msg, 'getDiary', {
        book: (bookSeg as any).value ?? 'public',
        date: dateInput.value.trim() || undefined,
        page: diaryPage,
      })
      if (!res) return
      diaryBox2.replaceChildren()
      const totalPages = Math.max(1, Math.ceil((res.totalDays ?? 0) / 7))
      const meta = ui.h('div')
      meta.style.margin = '6px 0'
      meta.textContent = `共 ${res.totalDays} 天 / ${res.totalChars} 字 · 第 ${(res.page ?? diaryPage) + 1} / ${totalPages} 页 · `
        + `本页：${(res.dates ?? []).join('、') || '（空）'}`
      diaryBox2.append(meta)

      const view = ui.h('div')
      view.style.whiteSpace = 'pre-wrap'
      view.style.maxHeight = '320px'
      view.style.overflow = 'auto'
      view.textContent = res.body ?? ''
      diaryBox2.append(view)

      // ── 翻页 ──
      // 后端早就支持 page（paginateDiary），页面以前不传，等于永远只看第一页；
      // 她的日记本子有几十天，主人只能看到最近 7 天，且按钮上写着"往前翻"却没得翻。
      const pager = ui.actions()
      const prev = ui.button('← 上一页', { onClick: async () => { await loadDiary(diaryPage - 1) } })
      const next = ui.button('下一页 →', { onClick: async () => { await loadDiary(diaryPage + 1) } })
      ;(prev as HTMLButtonElement).disabled = diaryPage <= 0
      ;(next as HTMLButtonElement).disabled = !res.hasMore
      pager.append(prev, next)
      diaryBox2.append(pager)

      // ── 只读 / 编辑分离 ──
      // 以前只读视图和 textarea 并排摆着：主人进来先看到一个大文本框，
      // 分不清哪块是"她的原文"、哪块是"我改的"，手一抖就整段覆盖。
      // 现在默认只读，要改先点「✏️ 编辑这段」，编辑框和保存键才出现。
      const editWrap = ui.h('div')
      const startEdit = ui.button('✏️ 编辑这段', {
        onClick: () => {
          if (editWrap.children.length) return
          const edit = ui.textarea({ value: res.body ?? '', rows: 8 })
          const editActs = ui.actions()
          const save = actionButton(ctx, ui, msg, '💾 保存并提交（按当前内容覆盖）', 'saveDiarySection', undefined, {
            variant: 'primary',
            argsFactory: () => [{
              book: (bookSeg as any).value ?? 'public',
              date: dateInput.value.trim() || (res.dates ?? [])[0],
              markdown: edit.value,
            }],
            after: async () => {
              // 存完回到只读态：编辑区收起来，免得"保存了还显示着编辑框"让人以为没存
              editWrap.replaceChildren()
              await loadDiary(diaryPage)
            },
          })
          const cancel = ui.button('取消编辑', { onClick: () => editWrap.replaceChildren() })
          editActs.append(save, cancel)
          editWrap.append(ui.field('改这里会覆盖当天整段', edit), editActs)
        },
      })
      diaryBox2.append(startEdit, editWrap)
    }

    const loadDiaryBtn = actionButton(ctx, ui, msg, '读取日记', 'getDiary', undefined, {
      after: async () => { diaryPage = 0; await loadDiary(0) },
    })
    diaryActs.append(loadDiaryBtn)

    // ── 判断卡 ──
    async function loadJudgments() {
      const res = await call<any>(ctx, msg, 'listJudgments', {})
      if (!res) return
      judgeBox.replaceChildren(ui.h('h3'))
      const meta = ui.h('div')
      meta.style.margin = '6px 0'
      meta.textContent = `共 ${res.total} 张（待采纳 ${res.proposed} · 已采纳 ${res.adopted} · 已驳回 ${res.rejected}）`
      judgeBox.append(meta)
      const table = ui.table({ head: ['结论', '主题词', '理由', '状态', '操作'] })
      for (const j of res.items ?? []) {
        const sel = ui.select({
          options: [
            { value: 'keep', label: '收' },
            { value: 'drop', label: '不收' },
            { value: 'unclear', label: '无从判断' },
          ],
          value: j.verdict,
        })
        const note = ui.input({ value: j.reason ?? '' })
        const save = actionButton(ctx, ui, msg, '保存', 'upsertJudgment', undefined, {
          argsFactory: () => [{ id: j.id, verdict: sel.value, note: note.value }],
          after: loadJudgments,
        })
        table.addRow([sel, (j.tokens ?? []).join('、'), note, j.status, save])
      }
      judgeBox.append(table.el)
      const reload = actionButton(ctx, ui, msg, '刷新判断卡', 'listJudgments', undefined, { after: loadJudgments })
      judgeBox.append(reload)
    }
    judgeBox.append(ui.h('h3'))

    void loadDiary()
    void loadJudgments()
  },
}

/** 每页 10 条（设计 story-6 口径），与数据层 FEEDBACK_DEFAULT_PAGE_SIZE 同值；浏览器 bundle 不 import Node 侧模块，所以这里写死并留注。 */
const TRIAGE_PAGE_SIZE = 10

/** 规则去向只列后端真认的三种（见 judgments-feedback.ts 的 convertRule.kind）。「转偏好词」「转待办」后端没有落点，不假装能做。 */
const RULE_KINDS = [
  { value: 'dislike', label: '转屏蔽词（她不再看这类）' },
  { value: 'keyword', label: '转搜索关键词' },
  { value: 'exemptUp', label: '转 UP 主豁免名单' },
]

/** `at` 是 ISO 串，页面上只留「日期 时间」这一眼能读完的长度。 */
function shortTime(at: unknown): string {
  return String(at ?? '').replace('T', ' ').slice(0, 16)
}

export const feedbackTriagePanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '意见箱分诊台',
      en: 'issue box triage',
      desc: '她自己提的意见按「未解决 → high → 新的」排。批复与结案分开：可以先只回一句而不结案。',
    })
    root.appendChild(card.el)

    const msg = ui.msgline()
    // 刷新是整块重建：批复输入框打到一半，切个筛选就没了（走查 story-3）
    const guard = createDirtyGuard(ui)
    const overview = ui.h('div')
    const filterRow = ui.h('div')
    const listBox = ui.h('div')
    const pagerRow = ui.actions()
    overview.style.margin = '6px 0'
    filterRow.style.display = 'flex'
    filterRow.style.flexWrap = 'wrap'
    filterRow.style.gap = '10px'
    filterRow.style.alignItems = 'center'
    filterRow.style.marginBottom = '10px'
    card.body.append(overview, filterRow, listBox, pagerRow, msg)

    // ── 筛选状态（数据面还会再归一化一次：page≥1、pageSize 夹 1..100、未知 severity 退 all） ──
    let status = 'open'
    let severity = 'all'
    let onlyUnself = false
    let page = 1

    const statusSeg = ui.segmented(
      [
        { value: 'open', label: '未解决' },
        { value: 'resolved', label: '已解决' },
        { value: 'all', label: '全部' },
      ],
      {
        value: status,
        onSelect: (v: string) => {
          status = v
          page = 1
          void refresh()
        },
      },
    )
    const severitySeg = ui.segmented(
      [
        { value: 'all', label: '严重度：全部' },
        { value: 'high', label: '只看 high' },
        { value: 'low', label: '只看 low' },
      ],
      {
        value: severity,
        onSelect: (v: string) => {
          severity = v
          page = 1
          void refresh()
        },
      },
    )
    const unselfBox = ui.checkbox('只看她未自对治', {
      checked: false,
      title: '勾上＝藏掉她已经自己绕过去的条目，只留真需要主人拍板的',
      onChange: (v: boolean) => {
        onlyUnself = v
        page = 1
        void refresh()
      },
    })
    filterRow.append(statusSeg.el, severitySeg.el, unselfBox.el)

    const prevBtn = ui.button('← 上一页', {
      onClick: () => {
        if (page <= 1) return
        page -= 1
        void refresh()
      },
    })
    const nextBtn = ui.button('下一页 →', {
      onClick: () => {
        page += 1
        void refresh()
      },
    })
    const pageInfo = ui.h('span')
    // 刷新只要重新取数：actionButton 会先发一次请求再 after 刷一遍，等于双查
    const reloadBtn = ui.button('↻ 刷新', { onClick: () => void refresh() })
    pagerRow.append(prevBtn, pageInfo, nextBtn, reloadBtn)

    /**
     * 一条意见的三个动作都走这里：只批复 / 批复并结案 / 转规则。
     *
     * 流程（校验 → 发请求 → 刷新 → 失败原因在刷新之后写回）由共享的 `actionButton` 承担，
     * 这里不另写一份：那种"每个面板各抄一遍按钮逻辑"正是 31 处调用点各修各的起因。
     * 校验放在 `preRun`：空的批复、空的规则值发出去只会给她写一条没内容的记录（审计 D10），
     * 没过就只写消息行、一条请求都不发。busy 态、防连点、失败写回也一并从那里来。
     */
    function triageButton(
      label: string,
      opts: {
        variant?: string
        build: () => Record<string, unknown> | string
        /** 存成功之后把这一行的"存档口径"更新掉，免得刚写完就被"你有没保存的修改"再拦一道 */
        onSaved?: (res: any) => void
      },
    ): HTMLButtonElement {
      let payload: Record<string, unknown> | null = null
      return actionButton(ctx, ui, msg, label, 'replyFeedback', undefined, {
        variant: opts.variant,
        preRun: async () => {
          const built = opts.build()
          if (typeof built === 'string') return built
          payload = built
          return null
        },
        argsFactory: () => payload,
        after: (res) => {
          if (res && (res as any).ok !== false) opts.onSaved?.(res)
          return refresh()
        },
      })
    }

    function renderEntry(f: any): HTMLElement {
      const box = ui.sheet({
        title: f.issue || f.id,
        desc: `#${f.id} · ${f.day || '（无日期）'} ${shortTime(f.at)}`,
      })
      const meta = ui.h('div')
      meta.style.display = 'flex'
      meta.style.flexWrap = 'wrap'
      meta.style.gap = '6px'
      meta.style.alignItems = 'center'
      meta.append(
        ui.pill(f.severity === 'high' ? 'high' : 'low', f.severity === 'high' ? 'on' : 'plain'),
        ui.pill(
          f.resolved ? `已结案${f.resolvedBy ? `（${f.resolvedBy}）` : ''}` : '未结案',
          f.resolved ? 'off' : 'plain',
        ),
      )
      if (f.selfHandled) meta.append(ui.pill('她已对治', 'plain'))
      box.body.append(meta)

      if (f.note) {
        const n = ui.h('div')
        n.style.whiteSpace = 'pre-wrap'
        n.style.margin = '6px 0'
        n.textContent = `她自己给的对治：${f.note}`
        box.body.append(n)
      }
      if (f.ownerReply) {
        const r = ui.h('div')
        r.style.whiteSpace = 'pre-wrap'
        r.style.margin = '6px 0'
        r.textContent = `主人已批复：「${f.ownerReply}」`
        box.body.append(r)
      }
      if (f.convertedRule) {
        const r = ui.h('div')
        r.style.margin = '6px 0'
        r.textContent = `已转规则：${f.convertedRule.kind} ＝ ${f.convertedRule.value}`
        box.body.append(r)
      }

      const reply = ui.textarea({
        value: f.ownerReply ?? '',
        placeholder: '给她的批复（下一轮自动注入给她）',
        rows: 2,
      })
      const acts = ui.actions()
      const ruleKind = ui.select({ options: RULE_KINDS, value: 'dislike' })
      const ruleValue = ui.input({ placeholder: '词 / UP 主名（必填）' })
      // 这两个框登记进未保存闸门：存档口径分别是"她已经收到的批复"和"空"
      guard.watch(reply, () => f.ownerReply ?? '')
      guard.watch(ruleValue, () => '')
      /** 存成功之后对齐存档口径：批复进模型、规则值清掉，不然下一次刷新必被"未保存"拦一道 */
      const markSaved = (res: any) => {
        if (typeof res?.ownerReply === 'string') f.ownerReply = res.ownerReply
        if (res?.resolved) f.resolved = true
        ruleValue.value = ''
      }
      acts.append(
        triageButton('💬 只写批复（不结案）', {
          build: () => {
            const text = reply.value.trim()
            if (!text) return '批复是空的——只批复不结案时总得写一句，我没有发请求。'
            return { id: f.id, ownerReply: text, resolve: false }
          },
          onSaved: markSaved,
        }),
        triageButton('✓ 批复并结案', {
          variant: 'primary',
          build: () => {
            const params: Record<string, unknown> = { id: f.id, resolve: true }
            const text = reply.value.trim()
            if (text) params.ownerReply = text
            return params
          },
          onSaved: markSaved,
        }),
        ruleKind,
        ruleValue,
        triageButton('➕ 转成过滤规则（不结案）', {
          build: () => {
            const value = ruleValue.value.trim()
            if (!value) return '转规则要给内容（屏蔽词、搜索词或 UP 主名），空值我没有发请求。'
            const params: Record<string, unknown> = {
              id: f.id,
              resolve: false,
              convertRule: { kind: ruleKind.value, value },
            }
            const text = reply.value.trim()
            if (text) params.ownerReply = text
            return params
          },
          onSaved: markSaved,
        }),
      )
      box.body.append(reply, acts)
      return box.el
    }

    async function refresh() {
      if (!(await guard.guard())) return
      const params: Record<string, unknown> = { status, severity, page, pageSize: TRIAGE_PAGE_SIZE }
      if (onlyUnself) params.selfHandled = false
      const res = await call<any>(ctx, msg, 'listFeedback', params)
      if (!res) return
      // 下面整块重建：登记簿跟着清空，由 renderEntry 重新登记新的输入框
      guard.reset()

      // replaceChildren 会把分段控件与勾选框从 DOM 上摘下来，所以每次刷新先原样挂回去
      // （cap-bilibili 同款做法：先 replaceChildren(seg.el) 再补别的）
      filterRow.replaceChildren(statusSeg.el, severitySeg.el, unselfBox.el)

      page = Number(res.page ?? 1) || 1
      const size = Number(res.pageSize ?? TRIAGE_PAGE_SIZE) || TRIAGE_PAGE_SIZE
      const filtered = Number(res.filteredCount ?? (res.items ?? []).length) || 0
      const pages = Math.max(1, Math.ceil(filtered / size))
      overview.textContent =
        `${res.total ?? 0} 条 · 未解决 ${res.openCount ?? 0} · high ${res.highCount ?? 0}` +
        `（其中未解决 ${res.highOpenCount ?? 0}） · 她已对治 ${res.selfHandledCount ?? 0}` +
        ` · 当前筛选 ${filtered} 条`

      // 空态：这一档真的没有条目才铺占位；行容器用普通 div 自己管
      // （ui.table 的 clear 占位行会和已加进去的数据行并存，上一周真浏览器实测踩过）。
      listBox.replaceChildren()
      const rows = res.items ?? []
      if (!rows.length) {
        listBox.append(ui.placeholder(filtered === 0 ? '这一档没有要处理的意见。' : '这一页没有条目，翻回去看看。'))
      } else {
        for (const f of rows) listBox.append(renderEntry(f))
      }
      prevBtn.disabled = page <= 1
      nextBtn.disabled = !res.hasMore
      pageInfo.textContent = `第 ${page} / ${pages} 页`
    }

    void refresh()
  },
}

export default {
  panels: {
    'journal-board': journalBoardPanel,
    'feedback-triage': feedbackTriagePanel,
  },
}

/**
 * 日记、判断卡与意见箱工作台（浏览器端面板）。
 *
 * 解决三件"操作不了"的事：
 *   ① 日记只能读不能改（她写错日期、格式烂，主人在页面上干瞪眼）→ ���线 Markdown 编辑并落盘；
 *   ② 审美判断卡没有独立视图（她自己也抱怨"只能从日记正文里捞"）→ 表格 + 可改结论；
 *   ③ 意见箱只能标"已解决" → 写主人批复（下一轮自动注入给她）或一键转成看片过滤规则。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton } from '../../../cortico-adapter/src/webui-helpers.ts'

export const journalBoardPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '日记、判断卡与意见箱',
      en: 'diary, judgment cards and issue box',
      desc: '读她的两本日记并在线改；看她的审美判断卡；给她的意见写批复或转成规则。',
    })
    root.appendChild(card.el)

    const msg = ui.msgline()
    const diaryBox = ui.h('div')
    const judgeBox = ui.h('div')
    const fbBox = ui.h('div')
    card.body.append(diaryBox, judgeBox, fbBox, msg)

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

    async function loadDiary() {
      const res = await call<any>(ctx, msg, 'getDiary', {
        book: (bookSeg as any).value ?? 'public',
        date: dateInput.value.trim() || undefined,
      })
      if (!res) return
      diaryBox2.replaceChildren()
      const meta = ui.h('div')
      meta.style.margin = '6px 0'
      meta.textContent = `共 ${res.totalDays} 天 / ${res.totalChars} 字 · 本页：${(res.dates ?? []).join('、') || '（空）'}${res.hasMore ? '（还有更多，往前翻）' : ''}`
      diaryBox2.append(meta)

      const view = ui.h('div')
      view.style.whiteSpace = 'pre-wrap'
      view.style.maxHeight = '320px'
      view.style.overflow = 'auto'
      view.textContent = res.body ?? ''
      diaryBox2.append(view)

      const edit = ui.textarea({ value: res.body ?? '', rows: 8 })
      const editActs = ui.actions()
      const save = actionButton(ctx, ui, msg, '💾 保存并提交（按当前内容覆盖）', 'saveDiarySection', undefined, {
        variant: 'primary',
        argsFactory: () => [{
          book: (bookSeg as any).value ?? 'public',
          date: dateInput.value.trim() || (res.dates ?? [])[0],
          markdown: edit.value,
        }],
        after: loadDiary,
      })
      editActs.append(save)
      diaryBox2.append(edit, editActs)
    }

    const loadDiaryBtn = actionButton(ctx, ui, msg, '读取日记', 'getDiary', undefined, { after: loadDiary })
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

    // ── 意见箱 ──
    async function loadFeedback() {
      const res = await call<any>(ctx, msg, 'listFeedback', { status: 'all' })
      if (!res) return
      fbBox.replaceChildren(ui.h('h3'))
      const meta = ui.h('div')
      meta.style.margin = '6px 0'
      meta.textContent = `共 ${res.total} 条，未解决 ${res.openCount} 条`
      fbBox.append(meta)
      for (const f of res.items ?? []) {
        const box = ui.sheet({ title: f.issue?.slice(0, 40) || f.id, desc: `#${f.id} · ${f.severity}${f.selfHandled ? '·她已对治' : ''} · ${f.resolved ? `已解决(${f.resolvedBy})` : '未解决'}` })
        const reply = ui.textarea({ value: f.ownerReply ?? '', placeholder: '给她的批复（下一轮自动注入）', rows: 2 })
        const acts = ui.actions()
        const replyBtn = actionButton(ctx, ui, msg, '💬 写批复并解决', 'replyFeedback', undefined, {
          variant: 'primary',
          argsFactory: () => [{ id: f.id, ownerReply: reply.value, resolve: true }],
          after: loadFeedback,
        })
        const ruleInput = ui.input({ placeholder: '转成看片过滤词（可选）' })
        const ruleBtn = actionButton(ctx, ui, msg, '➕ 一键转成屏蔽词并解决', 'replyFeedback', undefined, {
          argsFactory: () => [{ id: f.id, ownerReply: reply.value, resolve: true, convertRule: { kind: 'dislike', value: ruleInput.value.trim() } }],
          after: loadFeedback,
        })
        acts.append(replyBtn, ruleBtn)
        box.body.append(reply, ruleInput, acts)
        fbBox.append(box.el)
      }
      const reload = actionButton(ctx, ui, msg, '刷新意见箱', 'listFeedback', undefined, { after: loadFeedback })
      fbBox.append(reload)
    }
    fbBox.append(ui.h('h3'))

    void loadDiary()
    void loadJudgments()
    void loadFeedback()
  },
}

export default { panels: { 'journal-board': journalBoardPanel } }

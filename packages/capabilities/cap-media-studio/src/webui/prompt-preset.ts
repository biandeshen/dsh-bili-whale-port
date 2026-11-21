/**
 * 生图提示词预设（浏览器端面板）。
 *
 * 主人点名要的：分条开关 / 实时预览 / token 估算 / 变量插值 / 重置 /
 * 预设保存列举删除 / 导入导出。竞品对标：SillyTavern 的 Prompt Manager
 * （拖拽排序、Role、Triggers、Depth）与 Open WebUI 的三层覆盖。
 *
 * 这一版做到"够用且有据"：
 *   · 每段来源一个开关，勾掉即从预览里消失
 *   · 预览框显示的就是**最终送出去的那段字**（后端 composeFromSelection 的 preview）
 *   · 字符数与 token 估算并排显示，改一个开关立刻重算
 *   · 变量从后端拿（today/season 等），面板只做展示与提示
 *   · 存预设 = 存这一整套选择；同名覆盖提示，不静默堆
 *
 * 没做的（写在这儿免得误以为有）：拖拽改顺序（顺序由拼法决定，不是用户可排的）、
 * 按生成类型触发（我们只有"生图"一种用途）。
 */
import type { PanelCtx } from '../../../../shared/webui-helpers/src/webui-helpers.ts'
import { call, actionButton, createDirtyGuard } from '../../../../shared/webui-helpers/src/webui-helpers.ts'

/** 浏览器全局里用到的：剪贴板（复制提示词）与选区（无剪贴板权限时帮他选中）。 */
declare const navigator: { clipboard?: { writeText: (t: string) => Promise<void> } }
declare const window: { getSelection: () => { removeAllRanges(): void; addRange(r: unknown): void } | null }
declare const document: { createRange: () => { selectNodeContents(n: unknown): void } }

/** 五个开关的显示名与说明。key 必须与后端 PromptSelection 的布尔键一致。 */
const TOGGLES = [
  { key: 'style', label: '风格头', hint: '横竖版与画风那句。关掉后画风完全交给形象正本与场景。' },
  { key: 'formOn', label: '形态档', hint: '2.5 头身等几何设定。关掉就按形象正本的原比例。' },
  { key: 'character', label: '形象正本', hint: '鲸鱼娘的全部识别特征。关掉她可能就不像她了——慎用。' },
  { key: 'scene', label: '场景', hint: '深夜/雨声/耳机等。关掉只有人物、没有环境。' },
  { key: 'negative', label: '负面', hint: '猫耳/兔耳/暖色等红线。关掉出图可能踩到形象禁忌。' },
] as const

const KEY_TO_LABEL: Record<string, string> = Object.fromEntries(TOGGLES.map((t) => [t.key, t.label]))

export const promptPresetPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '生图提示词预设',
      en: 'prompt presets',
      /**
       * 描述必须诚实（2026-11-21 面板审计改）。
       *
       * 原文写的是"预览框里的就是最后会送出去的那段字"——**那句是假的**：
       * 本包不生出图（`grep composeFromSelection` 除本文件外只有这里的预览调用），
       * 8 张底图是预生成素材。这段提示词的真实用途是**导出成文本，拿去外部出图工具**。
       * 把"会送出去"写成承诺，等于让人以为在这儿点几下就能出新图。
       */
      desc: '每段可单独开关，拼好后复制出去用（本包不自己出图——8 张底图是现成素材）。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const box = ui.h('div')
    card.body.append(box, msg)

    const guard = createDirtyGuard(ui)
    let mounted = false
    /** 当前选择（与后端 PromptSelection 同形）；刷新时以"已保存的那份"为基线。 */
    let sel: any = null
    let vars: Record<string, string> = {}

    async function refresh() {
      if (mounted && !(await guard.guard())) return
      guard.reset()
      const res = await call<any>(ctx, msg, 'listPrompts', {})
      if (!res?.ok) {
        box.replaceChildren(ui.pill(String(res?.error ?? '取不到提示词库'), 'on'))
        return
      }
      sel = { ...res.selection }
      vars = res.vars ?? {}
      box.replaceChildren()

      // 顶部：库概况
      box.append(ui.statgrid([
        { k: '场景', v: (res.scenes ?? []).length },
        { k: '形态档', v: (res.forms ?? []).length },
        { k: '负面项', v: res.negativeCount ?? 0 },
      ]))

      // 场景 / 形态档
      const sceneSel = ui.select({
        options: (res.scenes ?? []).map((s: any) => ({ value: s.id, label: s.name || s.id })),
        value: sel.sceneId,
        onChange: (v) => { sel.sceneId = v; void preview() },
      })
      const formSel = ui.select({
        options: (res.forms ?? []).map((f: string) => ({ value: f, label: f })),
        value: sel.form ?? 'chibi',
        onChange: (v) => { sel.form = v; void preview() },
      })

      // 五个开关
      const toggleRow = ui.h('div')
      const boxes: Array<{ sync: () => void }> = []
      for (const t of TOGGLES) {
        const cb = ui.checkbox(t.label, {
          checked: Boolean(sel[t.key]),
          title: t.hint,
          onChange: (v) => { sel[t.key] = v; void preview() },
        })
        boxes.push({ sync: () => cb.setChecked(Boolean(sel[t.key])) })
        toggleRow.append(cb.el)
      }

      // 预览区：字符 / token / 正文
      const stats = ui.h('div')
      const previewBox = ui.h('div')
      previewBox.style.cssText = 'white-space:pre-wrap;border:1px solid var(--line,#ddd);border-radius:8px;padding:10px;margin-top:8px;max-height:280px;overflow:auto;font-size:12px;line-height:1.7;user-select:text;'

      const partsBox = ui.h('div')
      partsBox.style.marginTop = '8px'

      /** 上一次预览成功的正文——"复制"按钮读它，保证复制到的就是屏幕上那份。 */
      let lastPrompt = ''

      async function preview() {
        const r = await call<any>(ctx, msg, 'composePrompt', { ...sel })
        partsBox.replaceChildren()
        if (!r?.ok) {
          lastPrompt = ''
          previewBox.textContent = String(r?.error ?? '组合失败')
          stats.replaceChildren()
          return
        }
        // 头部统计
        stats.replaceChildren(ui.statgrid([
          { k: '字符', v: r.chars ?? 0 },
          { k: 'token 估算', v: r.tokens ?? 0 },
          { k: '启用段', v: (r.parts ?? []).filter((p: any) => p.enabled).length },
        ]))
        lastPrompt = String(r.preview ?? r.prompt ?? '')
        previewBox.textContent = lastPrompt
        // 分段明细：哪几段在场、各占多少字
        const t = ui.table({ head: ['来源', '状态', '字符'] })
        for (const p of r.parts ?? []) {
          t.addRow([
            KEY_TO_LABEL[p.kind] ?? p.label ?? p.kind,
            p.enabled ? '启用' : '已关',
            p.enabled ? String((p.text ?? '').length) : '—',
          ])
        }
        partsBox.append(t.el)
      }

      /**
       * 真正的出口（面板审计补的）。
       *
       * 这一段提示词的用途本来就是"复制出去、贴进外部出图工具"——
       * 之前面板只显示不给出路，等于把最后一步扔给主人手抄。
       * 复制走 `navigator.clipboard`，失败时退回"选中正文让他自己 Ctrl+C"，
       * 不假装成功（有些环境没有剪贴板权限）。
       */
      const copyBtn = ui.h('button', 'btn', '📋 复制这段提示词')
      copyBtn.onclick = async () => {
        if (!lastPrompt) {
          msg.textContent = '还没有可复制的提示词（先选场景）'
          return
        }
        try {
          await (navigator as any).clipboard.writeText(lastPrompt)
          msg.textContent = `已复制 ${lastPrompt.length} 个字符，去外部出图工具粘上就行。`
        } catch {
          // 没有剪贴板权限：帮他选中正文，让他自己按 Ctrl+C。不谎报成功。
          const range = document.createRange()
          range.selectNodeContents(previewBox)
          const selRange = window.getSelection()
          selRange?.removeAllRanges()
          selRange?.addRange(range)
          msg.textContent = '这个环境不给剪贴板权限；正文已选中，按 Ctrl+C 复制。'
        }
      }

      // 预设区
      const presetBox = ui.h('div')
      const presetName = ui.input({ placeholder: '给这套起个名字，例如「雨夜深蓝」', type: 'text' })

      async function loadPresets() {
        const r = await call<any>(ctx, msg, 'listPresets', {})
        presetBox.replaceChildren()
        const list = r?.presets ?? []
        if (r?.note) presetBox.append(ui.pill(String(r.note), 'on'))
        if (!list.length) {
          presetBox.append(ui.pill('还没有保存过预设', 'plain'))
          return
        }
        const t = ui.table({ head: ['名字', '场景', '开关', '操作'] })
        for (const p of list) {
          const on = TOGGLES.filter((tt) => p.selection?.[tt.key]).map((tt) => tt.label).join('·') || '全关'
          const ops = ui.h('div')
          const apply = ui.h('button', 'btn', '套用')
          apply.onclick = () => {
            /**
             * 套用要做三件事，缺一件就"看起来变了其实没变"（面板审计③）：
             *   1. 换掉内存里的选择        ← 原来只有这个
             *   2. 把下拉框的**显示值**也换  ← sceneSel.value 直接赋值不触发 onChange，
             *     但原生 HTMLSelectElement 的 .value 是双向的，所以显示会同���；
             *     危险在于**不能靠它触发副作用**——以后谁加一行依赖 onChange 的逻辑就会漏。
             *   3. 重算预览 + 清脏基线      ← 套用等于"这就是我要的"，不该再被脏问话
             */
            sel = { ...p.selection }
            sceneSel.value = sel.sceneId
            formSel.value = sel.form ?? 'chibi'
            for (const b of boxes) b.sync()
            /**
             * 基线跟着挪到"刚套用的这套"——否则套用之后立刻被自己的脏守卫拦。
             * 注意这里**不能**用 `guard.reset()`：它会连名字框/导入框的监视一起清掉，
             * 那两个之后就不再算脏了（这是 reset 的语义，不是 bug）。
             */
            savedKey = selectionKey()
            void preview()
            msg.textContent = `已套用「${p.name}」。这就是当前这套；点上面「复制」拿走，或再改。`
          }
          const del = ui.h('button', 'btn', '删除')
          del.onclick = async () => {
            const ok = await ui.confirm({ title: `删除预设「${p.name}」？`, danger: true, ok: '删除' })
            if (!ok) return
            const d = await call<any>(ctx, msg, 'deletePreset', { id: p.id })
            if (d?.ok) { await loadPresets(); msg.textContent = `已删除「${p.name}」` }
          }
          ops.append(apply, del)
          t.addRow([p.name, p.selection?.sceneId ?? '', on, ops])
        }
        presetBox.append(t.el)
      }

      const saveBtn = actionButton(ctx, ui, msg, '💾 保存为预设', 'savePreset', undefined, {
        argsFactory: () => [{ name: presetName.value.trim(), selection: { ...sel } }],
        after: async () => { presetName.value = ''; await loadPresets() },
      })

      const resetBtn = ui.h('button', 'btn', '↺ 重置为默认（全开）')
      resetBtn.onclick = () => {
        for (const t of TOGGLES) sel[t.key] = true
        for (const b of boxes) b.sync()
        void preview()
        msg.textContent = '已重置为默认（五段全开）。这只改了画面上的选择，没保存就还没落盘。'
      }

      // ── 三层覆盖：把当前这套设成"部署默认"，或清回代码包基线 ──
      const deployRow = ui.actions()
      const setDeploy = ui.h('button', 'btn', '📌 设为部署默认（长期生效）')
      setDeploy.onclick = async () => {
        const r = await call<any>(ctx, msg, 'setDeployOverride', { selection: { ...sel } })
        if (r?.ok) msg.textContent = '已设为部署默认：以后打开这一页、她出图，都从这套开始。'
      }
      const clearDeploy = ui.h('button', 'btn', '🧹 清掉部署默认（回代码基线）')
      clearDeploy.onclick = async () => {
        const ok = await ui.confirm({
          title: '清掉部署默认？',
          body: '会回到代码包自带的基线（五段全开）。已保存的命名预设不受影响。',
          ok: '清掉',
        })
        if (!ok) return
        const r = await call<any>(ctx, msg, 'clearDeployOverride', {})
        if (r?.ok) { await refresh(); msg.textContent = '已清掉部署默认，现在是代码基线。' }
      }
      deployRow.append(setDeploy, clearDeploy)

      // 导入导出
      const ioTa = ui.textarea({ placeholder: '粘贴要导入的 JSON（或先点「导出」把内容复制走）', rows: 5 })
      const exportBtn = ui.h('button', 'btn', '⬇ 导出到下面的框')
      exportBtn.onclick = async () => {
        const r = await call<any>(ctx, msg, 'exportPresets', {})
        ioTa.value = JSON.stringify(r, null, 2)
        msg.textContent = '已导出。全选复制走就能换台机器导回。'
      }
      const importBtn = ui.h('button', 'btn', '⬆ 导入框里的内容')
      importBtn.onclick = async () => {
        let payload: unknown
        try {
          payload = JSON.parse(ioTa.value)
        } catch (e: any) {
          msg.textContent = `导入失败：不是合法 JSON（${String(e?.message ?? e).slice(0, 60)}）`
          return
        }
        const r = await call<any>(ctx, msg, 'importPresets', { payload })
        if (r?.ok) {
          await loadPresets()
          msg.textContent = `导入完成：新增 ${r.added} 条、覆盖 ${r.replaced} 条`
        } else {
          msg.textContent = String(r?.error ?? '导入失败')
        }
      }
      const ioRow = ui.actions()
      ioRow.append(exportBtn, importBtn)

      // 复制按钮自己一行——它是这一页的**出口**，不该混在其它按钮里
      const copyRow = ui.actions()
      copyRow.append(copyBtn)

      // 变量提示
      const varHint = ui.pill(
        `可用变量：${Object.keys(vars).map((k) => `{{${k}}}`).join(' ') || '（无）'}`,
        'plain',
      )

      box.append(
        ui.field('场景', sceneSel),
        ui.field('形态档', formSel),
        ui.field('分段开关', toggleRow),
        varHint,
        // 标签改成实话：本包不出图，"拿走出"才是它的出路（面板审计①）
        ui.field('预览（复制出去用）', previewBox),
        copyRow,
        stats,
        ui.field('分段明细', partsBox),
        ui.h('h3', null, '预设'),
        ui.field('新预设名', presetName),
        saveBtn,
        resetBtn,
        ui.h('h3', null, '三层覆盖（run > 部署默认 > 代码基线）'),
        deployRow,
        presetBox,
        ui.h('h3', null, '导入 / 导出'),
        ioTa,
        ioRow,
      )

      /**
       * 脏跟踪（2026-11-21 面板审计②改）。
       *
       * 原来只盯名字框和导入框，理由是"开关变化是快速试，不算脏"——**那是错的**：
       * 五个开关 + 两个下拉框正是这一页最常调的东西，刷新时静默丢掉最难发现。
       * 现在把"当前这套选择"整体当成脏值：拿 `selectionKey(sel)` 与基线比，
       * 只要开关或下拉变过，刷新前就会问一句。
       */
      const selectionKey = () => JSON.stringify(sel)
      let savedKey = selectionKey()
      guard.watch({ get value() { return selectionKey() } } as { value: string }, () => savedKey)
      guard.watch(presetName, () => '')
      guard.watch(ioTa, () => '')

      await preview()
      await loadPresets()
      mounted = true
    }

    void refresh()
  },
}

export default { panels: { 'prompt-preset': promptPresetPanel } }

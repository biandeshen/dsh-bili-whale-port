/**
 * 她的眼睛（cap-vision 浏览器端面板）。
 *
 * 三块：眼睛现在好不好使（ffmpeg）→ 最近看过什么（运行记录）→ 想看多细（预算）。
 * 文案按"她在看"来写，不按"后台配置"来写：一条片子摊成几张图、哪些帧被当成重复丢掉，
 * 都是她看片时的动作，不是运维指标。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, sliderField } from '../../../cortico-adapter/src/webui-helpers.ts'

const secs = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} 分 ${Math.round(n % 60)} 秒` : `${Math.round(n)} 秒`)

export const visionPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '她的眼睛',
      en: 'vision',
      desc: '看一条片子时，画面只留「真的变了」的那几帧，摊成几张图。这里能看她的眼睛好不好使、最近看过什么、想看多细。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const box = ui.h('div')
    card.body.append(box, msg)

    async function refresh() {
      const res = await call<any>(ctx, msg, 'getSnapshot', {})
      if (!res) return
      box.replaceChildren()

      // ── 眼睛状态
      const ff = res.ffmpeg ?? {}
      const eye = ui.statgrid([
        { k: '眼睛', v: ff.available ? '好使' : '看不见', accent: true },
        { k: '拼图', v: `${res.sheets?.count ?? 0} 张` },
        { k: '占地方', v: `${((res.sheets?.bytes ?? 0) / 1024).toFixed(0)} KB` },
      ])
      box.append(eye)
      if (!ff.available) {
        box.append(ui.pill('找不到 ffmpeg，画面这一路会跳过，字幕弹幕照常', 'on'))
        const where = ui.h('div')
        where.style.opacity = '0.7'
        where.textContent = `找过：${(ff.tried ?? []).join(' ｜ ')}`
        box.append(where)
      } else {
        const src = ui.h('div')
        src.style.opacity = '0.7'
        src.textContent = `ffmpeg 来自 ${ff.source}`
        box.append(src)
      }

      // ── 想看多细（预算）
      const cfg = res.config ?? {}
      const head = ui.section('她想看到多细', '数值越大越细，也越贵：一条片子摊成几张图、每张约 216 token。')
      const frames = sliderField(ui, '一条片子留多少帧', Number(cfg.targetFrames ?? 48), { min: 8, max: 240, step: 4 })
      const dup = sliderField(ui, '多像算重复（去重地板）', Number(cfg.dupMin ?? 12), { min: 0, max: 60, step: 1 })
      const keep = sliderField(ui, '拼图留几天', Number(cfg.keepDays ?? 14), { min: 1, max: 120, step: 1 })
      const save = actionButton(ctx, ui, msg, '保存', 'setTuning', undefined, {
        variant: 'primary',
        argsFactory: () => [{ targetFrames: frames.get(), dupMin: dup.get(), keepDays: keep.get() }],
        after: refresh,
      })
      const hint = ui.h('div')
      hint.style.opacity = '0.7'
      hint.textContent = '去重地板：雨声、自然循环那类画面一直在微动的片子，调高它才会真的少给重复图；调回 8 会看得更细但很费。'
      head.append(frames.el, dup.el, keep.el, hint)
      box.append(head, save)

      // ── 最近看过什么
      const runsHead = ui.section('最近看过什么', '只记她真正跑过的：成没成、几张图、多久、为什么截断。')
      const table = ui.table({ head: ['什么时候', '看的什么', '结果', '摊成', '花了'] })
      for (const r of (res.runs ?? []).slice(0, 10)) {
        const when = new Date(r.at).toLocaleString()
        const what = String(r.file ?? '').split(/[\\/]/).pop() ?? ''
        const result = !r.ok ? `没成：${String(r.error ?? '').slice(0, 40)}` : r.truncated ? `看了 ${secs(r.ms)}（截断：${r.truncatedBy}）` : `看了 ${secs(r.ms)}`
        table.addRow([when, what, result, `${r.sheets} 张 / 留 ${r.kept} 帧`, secs((r.ms ?? 0) / 1000)])
      }
      if (!(res.runs ?? []).length) table.addRow(['—', '她还没用眼睛看过片子', '—', '—', '—'])
      runsHead.append(table.el)
      box.append(runsHead)

      // ── 拼图墙
      const wall = ui.section('她留下的拼图', '每张图左上角有帧号，对应那条片子里的时间点。')
      const grid = ui.h('div')
      grid.style.display = 'grid'
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))'
      grid.style.gap = '10px'
      for (const s of (res.sheets?.newest ?? []).slice(0, 6)) {
        const cell = ui.h('a')
        cell.href = `/api/files?path=${encodeURIComponent(s.file)}`
        cell.target = '_blank'
        cell.style.display = 'block'
        const img = ui.h('img')
        img.src = `/api/files?path=${encodeURIComponent(s.file)}`
        img.style.width = '100%'
        img.style.borderRadius = '6px'
        img.alt = s.name
        const cap = ui.h('div')
        cap.style.fontSize = '12px'
        cap.style.opacity = '0.75'
        cap.textContent = `${new Date(s.mtime).toLocaleString()} · ${(s.bytes / 1024).toFixed(0)} KB`
        cell.append(img, cap)
        grid.append(cell)
      }
      if (!(res.sheets?.newest ?? []).length) {
        const empty = ui.h('div')
        empty.textContent = '还没有拼图。'
        grid.append(empty)
      }
      wall.append(grid)
      box.append(wall)

      // ── 清理（写操作，要勾一下才按得动）
      const danger = ui.section('清理', '只删本面板生成的拼图 png，原始视频不归这里管。')
      const confirm = ui.checkbox('我确认要删掉超期的拼图')
      const clean = actionButton(ctx, ui, msg, '删掉超期的', 'cleanupSheets', undefined, {
        argsFactory: () => [{ olderThanDays: Number(cfg.keepDays ?? 14), confirm: confirm.checked }],
        after: refresh,
      })
      danger.append(confirm.el, clean)
      box.append(danger)
    }

    void refresh()
  },
}

export default { panels: { vision: visionPanel } }

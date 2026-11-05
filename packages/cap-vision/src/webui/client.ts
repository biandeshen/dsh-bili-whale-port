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
      const runsHead = ui.section('最近看过什么', '只记她真正跑过的：成没成、几张图、多久、为什么截断。'
        + '画面统计那一列是"为什么只留这几帧"——变化弱、太重复、切得少，都看得出来。')
      const table = ui.table({ head: ['什么时候', '看的什么', '结果', '摊成', '画面统计', '重跑'] })
      for (const r of (res.runs ?? []).slice(0, 10)) {
        const when = new Date(r.at).toLocaleString()
        const what = String(r.file ?? '').split(/[\\/]/).pop() ?? ''
        const result = !r.ok ? `没成：${String(r.error ?? '').slice(0, 40)}` : r.truncated ? `看了 ${secs(r.ms)}（截断：${r.truncatedBy}）` : `看了 ${secs(r.ms)}`
        // 画面统计：切点 / 重复丢掉 / 最强帧分 / 每秒变化
        const st = r.stats ?? null
        const statText = st
          ? `切 ${st.cuts} · 重复丢 ${st.dupSkipped} · 最强 ${st.scoreMax} · 每秒 ${st.motionPerSec}`
          : '（这遍没记）'
        // 重跑：调完预算立刻用同一条片子再跑一遍（本地文件，不联网）
        const rerun = actionButton(ctx, ui, msg, '↻ 重跑', 'rerun', undefined, {
          argsFactory: () => [{ file: r.file, confirm: true }],
          confirm: {
            title: '确认用当前预算重跑这一遍？',
            body: `片子：${what}\n\n会用现在页面上这套预算（留多少帧、多像算重复）重新判一遍并出图。`
              + '只动本地文件，不联网、不发任何东西。',
            ok: '确认重跑',
          },
          after: refresh,
        })
        table.addRow([when, what, result, `${r.sheets} 张 / 留 ${r.kept} 帧`, statText, rerun])
      }
      if (!(res.runs ?? []).length) table.addRow(['—', '她还没用眼睛看过片子', '—', '—', '—', '—'])
      runsHead.append(table.el)
      box.append(runsHead)

      // ── 拼图墙
      const all = res.sheets?.newest ?? []
      const wall = ui.section('她留下的拼图', `共 ${all.length} 张，这里摆最近 12 张；每张左上角有帧号，对应那条片子里的时间点。点开是新标签看原图。`)
      const grid = ui.h('div')
      grid.style.display = 'grid'
      grid.style.gridTemplateColumns = 'repeat(auto-fill, minmax(220px, 1fr))'
      grid.style.gap = '10px'
      const newest = all.slice(0, 12)
      for (const s of newest) {
        // 宿主的图片出口只有 /api/blob?handle=（没有按任意路径取文件的路由，
        // 2026-11-04 实测 ?path= 那种拼法一律 404 裂图），而把拼图塞进工作区
        // 等于把二进制灌进她的记忆 git。所以缩略图由本包自己出：sheetThumb → data URL。
        const cell = ui.h('div')
        cell.style.display = 'block'
        const img = ui.h('img')
        img.style.width = '100%'
        img.style.borderRadius = '6px'
        img.alt = s.name
        const cap = ui.h('div')
        cap.style.fontSize = '12px'
        cap.style.opacity = '0.75'
        cap.textContent = `${new Date(s.mtime).toLocaleString()} · ${(s.bytes / 1024).toFixed(0)} KB`
        cell.append(img, cap)
        grid.append(cell)
        // 懒取：取不到就把文件名留着，不摆裂图；取到了套一层链接，点开看原图
        void ctx.invoke('sheetThumb', [{ file: s.file }])
          .then((r: any) => {
            if (!r?.dataUrl) {
              img.remove()
              cap.textContent = `${s.name}（缩略图出不了：${r?.error ?? '未知'}）`
              return
            }
            img.src = r.dataUrl
            // 大图的 href 不能用 data: URL——Chrome 直接拦 data: 的顶层导航
            // （2026-11-04 实测：点三下不开标签，defaultPrevented 还是 false，
            // 页面代码看不出问题）。换成同字节的 blob URL 就能开，面板卸载时回收。
            const bin = atob(String(r.dataUrl).slice(String(r.dataUrl).indexOf(',') + 1))
            const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
            const blobUrl = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }))
            ctx.signal.addEventListener('abort', () => URL.revokeObjectURL(blobUrl), { once: true })
            const a = ui.h('a')
            a.href = blobUrl
            a.target = '_blank'
            a.rel = 'noopener'
            a.title = s.name
            a.append(img)
            cell.prepend(a)
          })
          .catch((e: any) => { img.remove(); cap.textContent = `${s.name}（${String(e?.message ?? e)}）` })
      }
      if (!newest.length) {
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

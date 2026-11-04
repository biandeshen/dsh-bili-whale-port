/**
 * 她的一天（cap-state-rhythm 浏览器端面板）—— persona 默认落地页。
 *
 * 回答主人每天的第一问：她在干什么、今天干了什么、刚才说了什么。
 * 三个区块全是读现有后端方法，零新后端：
 *   S1 状态读数带（getSnapshot：rest / lifeTick 计数 / mood）
 *   S2 生活事件流（getSnapshot.recentChain，动作类型 → 人话模板，acc* 默认过滤）
 *   S3 她最近说的话（getJournal 尾段摘要 → 跳日记面板）
 *
 * 异常态按 edge.json page-day 槽位实现：首装空态 / 睡眠态 / 0 件解释 / 分页 / 脏数据过滤。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call } from '../../../cortico-adapter/src/webui-helpers.ts'

const PAGE = 20

/** 因果事件 → 她的口吻（运维字段折叠进 title） */
function humanizeEvent(e: any): { text: string; at: number; dirty: boolean } {
  const at = Number(e.timestamp ? Date.parse(e.timestamp) : e.atMs ?? 0)
  const src = String(e.source ?? '')
  const dirty = /acc[0-9a-z]|验收/.test(src + String(e.description ?? ''))
  const f = e.fieldChanges?.[0]
  let text: string
  switch (String(e.type ?? '')) {
    case 'action':
      text = { explore: '找点新鲜的看', create: '做点东西', connect: '去看看有没有人找她', restless: '歇够了，活动了一下' }[String(e.actionKind ?? '')] ?? '动了一轮'
      break
    case 'field_change':
      if (f) text = `${{ energy: '体力', stimulation: '刺激', connection: '连接感', social: '社交欲', mood: '心情', curiosity: '好奇', creativity: '创作欲' }[f.field] ?? f.field} ${pct(f.from)} → ${pct(f.to)}`
      else text = String(e.description ?? '状态变了')
      break
    case 'watch':
      text = `看了《${String(e.title ?? '一条片子').slice(0, 24)}》`
      break
    case 'draft':
      text = e.status === 'rejected' ? '有稿被主人打回了' : '写了一条草稿，等主人过目'
      break
    default:
      text = String(e.description ?? '发生了点什么').slice(0, 40)
  }
  return { text, at, dirty }
}

const pct = (n: any) => `${Math.round(Number(n ?? 0) * 100)}%`
const hhmm = (ms: number) => new Date(ms).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })

export const dayPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '她的一天',
      en: 'her day',
      desc: '她在干什么、今天干了什么、刚才说了什么——一眼读完她的日子。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const statsBox = ui.h('div')
    const timelineBox = ui.h('div')
    const wordsBox = ui.h('div')
    card.body.append(statsBox, timelineBox, wordsBox, msg)

    let page = 0
    let showDirty = false

    async function refresh() {
      const res = await call<any>(ctx, msg, 'getSnapshot')
      if (!res) return
      const life = res.life ?? {}
      const rest = String(res.rest ?? 'awake')

      // ── S1 状态读数带（含睡眠特判与 0 件解释，edge page-day/boundary-zero）
      statsBox.replaceChildren()
      const nextIn = Number(life.nextCheckAt ?? 0) > Date.now()
        ? `${Math.ceil((Number(life.nextCheckAt) - Date.now()) / 60000)} 分钟后`
        : '就这一两拍'
      const today = Number(life.actionsToday ?? 0)
      const todayText = today > 0 ? `${today} 件`
        : rest === 'asleep' ? '睡着了，不算'
        : '还没动——没什么想动的'
      const restLabel = rest === 'asleep' ? '睡着' : rest === 'resting' ? '歇着' : '醒着'
      const mood = res.mood ?? {}
      const stats = ui.statgrid([
        { k: '今天', v: todayText, accent: today > 0 },
        { k: '下一拍', v: nextIn },
        { k: '现在', v: restLabel, accent: rest !== 'awake' },
        { k: '情绪', v: `${mood.primary ?? '平静'} ${Math.round(Number(mood.intensity ?? 0) * 100)}%` },
      ])
      statsBox.append(stats)
      if (rest === 'asleep') {
        const sleepNote = ui.h('div')
        sleepNote.style.opacity = '0.75'
        sleepNote.style.margin = '4px 0'
        sleepNote.textContent = '别吵醒她——做梦的时候记忆才长好。'
        statsBox.append(sleepNote)
      }

      // ── S2 生活事件流（acc* 默认过滤，edge page-day/error-server）
      timelineBox.replaceChildren()
      const sec = ui.section('最近发生', '她的日子按时间排。运维细节折叠在每行的提示里。')
      const chain: any[] = res.recentChain ?? []
      if (!chain.length) {
        sec.append(ui.placeholder('还没有记录——她刚醒，或账刚清过。'))
        timelineBox.append(sec)
      } else {
        const all = chain.map(humanizeEvent)
        const dirty = all.filter((e) => e.dirty)
        const clean = showDirty ? all : all.filter((e) => !e.dirty)
        if (dirty.length && !showDirty) {
          const filterBar = ui.h('div')
          filterBar.style.margin = '4px 0'
          const btn = ui.button(`已隐藏 ${dirty.length} 条验收记录 · 显示`, {
            onClick: () => { showDirty = true; void refresh() },
          })
          btn.className += ' sm'
          filterBar.append(btn)
          sec.append(filterBar)
        }
        const start = page * PAGE
        const slice = clean.slice(start, start + PAGE)
        if (!slice.length) {
          sec.append(ui.placeholder('这一页没有更多了。'))
        } else {
          const table = ui.table({ head: ['什么时候', '发生了什么'] })
          for (const e of slice) {
            const cell = ui.h('div')
            cell.textContent = e.text
            cell.title = `${e.source ?? ''} ${e.id ?? ''}`.trim()
            table.addRow([hhmm(e.at), cell])
          }
          sec.append(table.el)
          if (start + PAGE < clean.length) {
            const more = ui.button('更早的日子', { onClick: () => { page += 1; void refresh() } })
            more.className += ' sm'
            sec.append(more)
          }
        }
      }
      timelineBox.append(sec)

      // ── S3 她最近说的话
      wordsBox.replaceChildren()
      const words = ui.section('她最近说的话', '摘自她的两本日记与控制台发言，原话原味。')
      words.append(ui.placeholder('去日记面板读她的原话——这里很快会接上最近发言摘要。'))
      wordsBox.append(words)
    }

    void refresh()
  },
}

export default { panels: { day: dayPanel } }

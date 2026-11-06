/**
 * 音视频创作工作台（浏览器端面板）。
 *
 * 浏览底图与 CC0 曲库、试听 TTS 语音、一键合成竖屏短视频与双封面，
 * 并可把成片送进 B 站待放行队列。
 *
 * 脏守卫（2026-11-06 主人"逐个按钮检查"扫出来的 R4）：这一页有台词框与时长输入，
 * 而刷新是 `box.replaceChildren()` 整块重建——以前点「合成视频草稿」后 `after: refresh`
 * 会把刚写的台词一起冲掉，主人辛苦打的字**静默丢失**。现在：脏了先问一句，
 * 答应丢掉才重建，取消就保留原样。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, createDirtyGuard } from '../../../cortico-adapter/src/webui-helpers.ts'

export const mediaStudioPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '音视频创作工作台',
      en: 'media studio',
      desc: '选底图、写台词、试听配音、一键出片并送进待放行队列。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const box = ui.h('div')
    card.body.append(box, msg)

    const guard = createDirtyGuard(ui)
    let mounted = false

    async function refresh() {
      // 首次挂载没有脏可言；之后每次整块重建前都要问一句（点取消＝不刷新，保住字）
      if (mounted && !(await guard.guard())) return
      guard.reset()
      const res = await call<any>(ctx, msg, 'listAssets', {})
      if (!res) return
      const tc = res.toolchain ?? {}
      box.replaceChildren()

      const stats = ui.statgrid([
        { k: '底图', v: (res.images ?? []).length },
        { k: 'CC0 曲目', v: (res.bgmTracks ?? []).length },
        { k: 'ffmpeg', v: tc.ffmpegReady ? '可用' : '不可用' },
        { k: 'TTS', v: tc.tts?.mimoKey === 'missing' ? '缺凭据' : '可用' },
      ])
      box.append(stats)
      if (!tc.ffmpegReady) {
        const warn = ui.pill('找不到 ffmpeg，出不了片', 'on')
        box.append(warn)
      }

      const imageSel = ui.select({
        options: (res.images ?? []).map((f: string) => ({ value: f, label: f })),
        value: (res.images ?? [])[0] ?? '',
      })
      const bgmSel = ui.select({
        options: [
          { value: 'auto', label: '自动（曲库第一首）' },
          ...(res.bgmTracks ?? []).map((f: string) => ({ value: f, label: f })),
          { value: 'none', label: '不用 BGM' },
        ],
        value: 'auto',
      })
      const script = ui.textarea({ placeholder: '要念的台词（最多 5 行）', rows: 3 })
      const dur = ui.input({ value: '20', type: 'number', min: 3, max: 60 })
      /**
       * 登记脏值守卫：基线取"这一屏刚建好时的值"，不是空串——
       * 底图/时长是下拉与默认值，主人只改了台词也会被算脏，这是对的（那是他打的字）。
       */
      const base = {
        script: script.value,
        dur: dur.value,
        image: imageSel.value,
        bgm: bgmSel.value,
      }
      guard.watch(script, () => base.script)
      guard.watch(dur, () => base.dur)
      guard.watch(imageSel, () => base.image)
      guard.watch(bgmSel, () => base.bgm)

      // 试听：一次点击只合成一次。
      // 以前 after 里又调了一次 ctx.invoke('previewTts')，等于每点一下 TTS 跑两遍
      // （白烧一次额度，还可能两份不同的音频）。after 拿到的就是第一次的结果。
      const ttsBtn = actionButton(ctx, ui, msg, '🔊 试听配音', 'previewTts', undefined, {
        argsFactory: () => [{ text: script.value.trim() }],
        after: async (r: any) => {
          const dataUrl = r?.dataUrl
          if (!dataUrl) {
            ui.msgline(r?.error ? String(r.error) : '试听音频没出来', Boolean(r?.error))?.remove?.()
            return
          }
          const audio = ui.h('audio')
          audio.controls = true
          audio.src = dataUrl
          // 每次试听换掉上一段（不然页面上摞一排 audio，主人不知道哪段是刚点的）
          for (const old of [...box.querySelectorAll?.('audio') ?? []]) old.remove?.()
          box.append(audio)
        },
      })

      const buildBtn = actionButton(ctx, ui, msg, '🎬 合成视频草稿', 'buildVideoDraft', undefined, {
        variant: 'primary',
        argsFactory: () => [{
          image: imageSel.value,
          text: script.value.trim(),
          bgmId: bgmSel.value,
          durationSec: Number(dur.value),
        }],
        after: () => refresh(),
      })

      box.append(
        ui.field('底图', imageSel),
        ui.field('背景音乐', bgmSel),
        ui.field('台词', script),
        ui.field('时长（秒）', dur),
        ttsBtn,
        buildBtn,
      )

      const drafts = ui.h('div')
      drafts.style.margin = '12px 0'
      drafts.append(ui.h('h3'))
      for (const d of res.drafts ?? []) {
        const line = ui.h('div')
        line.textContent = `${new Date(d.createdAt).toLocaleString()} · ${d.text?.slice(0, 24) ?? ''} · ${d.sizeMB ?? '?'} MB${d.pushedToQueue ? ' · 已进待放行队列' : ''}`
        drafts.append(line)
      }
      box.append(drafts)

      // 看片页 ↔ 看画面页：视觉那条线（cap-vision 的拼图与看片记录）在 persona 页，
      // 这里补一条跳转，省得主人为了看"她当时看见了什么"再翻导航。
      const links = ui.actions()
      const toVision = ui.h('a', null, '→ 看画面（她看片时看见的）')
      toVision.setAttribute('href', '#/provider/persona%3Axiaoyu/vision')
      toVision.style.marginRight = '10px'
      const toPrefs = ui.h('a', null, '→ 看片偏好与屏蔽词')
      toPrefs.setAttribute('href', '#/provider/world%3Abili-account/preferences')
      links.append(toVision, toPrefs)
      box.append(links)
      mounted = true
    }
    void refresh()
  },
}

export default { panels: { 'media-studio': mediaStudioPanel } }

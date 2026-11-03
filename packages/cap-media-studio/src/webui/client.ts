/**
 * 音视频创作工作台（浏览器端面板）。
 *
 * 浏览底图与 CC0 曲库、试听 TTS 语音、一键合成竖屏短视频与双封面，
 * 并可把成片送进 B 站待放行队列。
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton } from '../../../cortico-adapter/src/webui-helpers.ts'

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

    async function refresh() {
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

      const ttsBtn = actionButton(ctx, ui, msg, '🔊 试听配音', 'previewTts', undefined, {
        argsFactory: () => [{ text: script.value.trim() }],
        after: async () => {
          const r = await ctx.invoke('previewTts', [{ text: script.value.trim() }]).catch(() => null)
          const outFile = (r as any)?.outFile
          if (!outFile) return
          const audio = ui.h('audio')
          audio.controls = true
          audio.src = `/api/files?path=${encodeURIComponent(outFile)}`
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
        after: refresh,
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
    }
    void refresh()
  },
}

export default { panels: { 'media-studio': mediaStudioPanel } }

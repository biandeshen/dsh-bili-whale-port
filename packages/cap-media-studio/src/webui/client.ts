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

      const ttsBtn = actionButton(ctx, ui, msg, '🔊 试听配音', 'previewTts', undefined, { after: () => {} })
      ttsBtn.onclick = async () => {
        const text = script.value.trim()
        if (!text) {
          msg.textContent = '先写台词'
          msg.classList.add('bad')
          return
        }
        try {
          msg.textContent = '正在合成…'
          const r = await ctx.invoke('previewTts', [{ text }])
          msg.textContent = `试听已生成：${(r as any)?.provider ?? ''} ${(r as any)?.voice ?? ''} ${(r as any)?.seconds ?? ''} 秒`
          msg.classList.remove('bad')
          const audio = ui.h('audio')
          audio.controls = true
          audio.src = `data:audio/mpeg;base64,${(r as any)?.outFile ? '' : ''}`
          if ((r as any)?.outFile) {
            audio.src = `/api/files?path=${encodeURIComponent((r as any).outFile)}`
            box.append(audio)
          }
        } catch (e) {
          msg.textContent = String(e instanceof Error ? e.message : e)
          msg.classList.add('bad')
        }
      }

      const buildBtn = actionButton(ctx, ui, msg, '🎬 合成视频草稿', 'buildVideoDraft', undefined, { variant: 'primary', after: refresh })
      buildBtn.onclick = async () => {
        const text = script.value.trim()
        if (!text) {
          msg.textContent = '先写台词'
          msg.classList.add('bad')
          return
        }
        try {
          msg.textContent = '正在合成（可能要几十秒）…'
          const r = await ctx.invoke('buildVideoDraft', [{
            image: imageSel.value,
            text,
            bgmId: bgmSel.value,
            durationSec: Number(dur.value),
          }])
          const d = (r as any)?.draft
          msg.textContent = d ? `成片已生成：${d.videoFile}（${d.sizeMB ?? '?'} MB）` : '合成没成功'
          msg.classList.remove('bad')
        } catch (e) {
          msg.textContent = String(e instanceof Error ? e.message : e)
          msg.classList.add('bad')
        }
        await refresh()
      }

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

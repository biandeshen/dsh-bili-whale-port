/**
 * B 站四大操作台（浏览器端面板）：
 *   inbox        四路收件箱与指派（让她回这条 / 忽略 / 拉黑）
 *   drafts-queue 统一待放行与改稿（在线改字自动重算哈希、打回重写、点单写稿）
 *   preferences  看片偏好与过滤规则（可视化标签增删）
 *   gate-policy  安全闸、配额与风控总控（一键急杀、8 档位、配额、冷却、412 解除）
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton } from '../../../cortico-adapter/src/webui-helpers.ts'

const INBOX_KINDS = [
  { id: 'all', label: '全部' },
  { id: 'dm', label: '私信' },
  { id: 'reply', label: '评论回复' },
  { id: 'mention', label: '@提及' },
  { id: 'like', label: '收到的赞' },
]

export const inboxPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: 'B 站收件箱与指派',
      en: 'bilibili inbox',
      desc: '她收到什么你都能看，并能直接指派：让她回这条、忽略已读、或拉黑这个号。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const listBox = ui.h('div')
    card.body.append(listBox, msg)

    let kind = 'all'
    const seg = ui.segmented(
      INBOX_KINDS.map((k) => ({ value: k.id, label: k.label })),
      { value: kind, onSelect: (v) => { kind = v } },
    )
    listBox.append(seg.el)

    async function refresh() {
      const res = await call<any>(ctx, msg, 'list', { kind, unreadOnly: false })
      if (!res) return
      listBox.replaceChildren(seg.el)
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `未读 ${res.unreadCount ?? 0} 条 · 共 ${(res.items ?? []).length} 条${(res.blockedUids ?? []).length ? ` · 已拉黑 ${res.blockedUids.length} 个号` : ''}`
      listBox.append(head)

      for (const it of res.items ?? []) {
        const box = ui.sheet({
          title: `${it.who ?? '某人'}：${String(it.text ?? '').slice(0, 40)}`,
          desc: `${it.kind} · ${new Date(it.atMs).toLocaleString()}${it.read ? ' · 已读' : ' · 未读'}${it.assignedAction ? ` · 已指派：${it.assignedAction}` : ''}`,
        })
        const acts = ui.actions()
        const hint = ui.input({ placeholder: '可选：给她的叮嘱' })

        const reply = actionButton(ctx, ui, msg, '👉 让她回这条', 'assignAction', undefined, {
          variant: 'primary',
          argsFactory: () => [{ itemKey: it.key, action: 'ask_her_reply', ownerHint: hint.value }],
          after: refresh,
        })
        const ignore = actionButton(ctx, ui, msg, '✓ 忽略已读', 'assignAction', undefined, {
          argsFactory: () => [{ itemKey: it.key, action: 'ignore' }],
          after: refresh,
        })
        const block = actionButton(ctx, ui, msg, '🚫 拉黑此人', 'assignAction', undefined, {
          variant: 'danger',
          argsFactory: () => [{ itemKey: it.key, action: 'block_user' }],
          after: refresh,
        })
        acts.append(reply, ignore, block)
        box.body.append(hint, acts)
        listBox.append(box.el)
      }
    }
    void refresh()
  },
}

export const draftsQueuePanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '统一待放行与改稿台',
      en: 'pending drafts and edits',
      desc: '动态草稿、私信草稿、待审评论、待审弹幕都在这里。改字后自动续签令牌，可直接放行。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const listBox = ui.h('div')
    card.body.append(listBox, msg)

    const orderBox = ui.h('div')
    orderBox.style.margin = '10px 0'
    const orderInput = ui.input({ placeholder: '点单：BV 号（可选）+ 你要她写什么' })
    const orderBtn = actionButton(ctx, ui, msg, '＋ 点单让她写一条', 'requestNew', undefined, {
      variant: 'primary',
      argsFactory: () => [{ kind: 'dynamic', prompt: orderInput.value.trim() }],
      after: async () => { orderInput.value = ''; await refresh() },
    })
    orderBox.append(ui.field('点单', orderInput), orderBtn)

    async function refresh() {
      const res = await call<any>(ctx, msg, 'list', {})
      if (!res) return
      listBox.replaceChildren(orderBox)
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `待放行 ${res.count ?? 0} 条`
      listBox.append(head)

      for (const it of res.items ?? []) {
        const box = ui.sheet({
          title: `${it.kind} · ${String(it.text ?? '').slice(0, 40)}`,
          desc: `#${it.id} · ${new Date(it.createdAt).toLocaleString()} · 哈希 ${String(it.bodyHash).slice(0, 8)}`,
        })
        const edit = ui.textarea({ value: it.text ?? '', rows: 5 })
        const acts = ui.actions()

        const save = actionButton(ctx, ui, msg, '💾 保存修改（自动续签）', 'updateDraft', undefined, {
          argsFactory: () => [{ id: it.id, text: edit.value }],
          after: refresh,
        })
        const release = actionButton(ctx, ui, msg, '✓ 放行发布', 'release', undefined, {
          variant: 'primary',
          argsFactory: () => [{ id: it.id }],
          after: refresh,
        })
        const reject = actionButton(ctx, ui, msg, '✗ 拒掉', 'reject', undefined, {
          variant: 'danger',
          argsFactory: () => [{ id: it.id, reason: window.prompt('拒稿理由（她会看到，并可让她照着重写）', '写得太空泛') ?? '', askRewrite: true }],
          after: refresh,
        })
        acts.append(save, release, reject)
        box.body.append(edit, acts)
        listBox.append(box.el)
      }
    }
    void refresh()
  },
}

export const preferencesPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '看片偏好与过滤规则',
      en: 'watch preferences',
      desc: '喜欢什么、讨厌什么、屏蔽哪些词、关注哪些 UP 主豁免、短视频跳过阈值——不用再翻 JSON。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const box = ui.h('div')
    card.body.append(box, msg)

    async function refresh() {
      const res = await call<any>(ctx, msg, 'get', {})
      if (!res) return
      const p = res.prefs ?? {}
      box.replaceChildren()

      const mkList = (label: string, key: string, hint: string) => {
        const wrap = ui.h('div')
        wrap.style.margin = '10px 0'
        const input = ui.input({ placeholder: hint })
        const add = ui.button('添加', {
          onClick: async () => {
            const v = input.value.trim()
            if (!v) return
            const cur: string[] = Array.isArray(p[key]) ? [...p[key]] : []
            if (cur.includes(v)) {
              msg.textContent = '已经在里面了'
              return
            }
            cur.push(v)
            input.value = ''
            await ctx.invoke('set', [{ [key]: cur }]).catch((e) => {
              msg.textContent = String(e instanceof Error ? e.message : e)
            })
            await refresh()
          },
        })
        const list = ui.h('div')
        list.style.margin = '6px 0'
        for (const item of p[key] ?? []) {
          const chip = ui.chip(String(item))
          const rm = ui.button('×', {
            onClick: async () => {
              const cur: string[] = (p[key] ?? []).filter((x: string) => x !== item)
              await ctx.invoke('set', [{ [key]: cur }]).catch((e) => {
                msg.textContent = String(e instanceof Error ? e.message : e)
              })
              await refresh()
            },
          })
          const row = ui.h('span')
          row.style.display = 'inline-flex'
          row.style.alignItems = 'center'
          row.style.gap = '4px'
          row.style.marginRight = '8px'
          row.append(chip, rm)
          list.append(row)
        }
        wrap.append(ui.field(label, input), add, list)
        return wrap
      }

      box.append(
        mkList('喜欢的话题 / 分区', 'like', '例：传统艺术与手艺'),
        mkList('讨厌的话题 / 屏蔽词', 'dislike', '例：引导冥想'),
        mkList('搜索关键词', 'keywords', '例：雨声'),
        mkList('关注 UP 主豁免名单', 'exemptUps', '例：某位 UP 主'),
      )

      const dur = ui.input({ value: String(p.minDurationSec ?? 600), type: 'number', min: 0, step: 60 })
      const saveDur = ui.button('保存跳过阈值（秒）', {
        onClick: async () => {
          await ctx.invoke('set', [{ minDurationSec: Number(dur.value) }]).catch((e) => {
            msg.textContent = String(e instanceof Error ? e.message : e)
          })
          await refresh()
        },
      })
      box.append(ui.field('短于多少秒的片子直接跳过', dur), saveDur)
    }
    void refresh()
  },
}

const POLICY_FIELDS: Array<{ key: string; label: string; options: string[] }> = [
  { key: 'draftMode', label: '动态草稿发布', options: ['review', 'auto'] },
  { key: 'comment', label: '评论', options: ['review', 'self'] },
  { key: 'danmaku', label: '弹幕', options: ['review', 'self'] },
  { key: 'dmReply', label: '私信回信', options: ['direct', 'queue'] },
  { key: 'like', label: '点赞', options: ['self', 'review'] },
  { key: 'fav', label: '收藏', options: ['self', 'review'] },
]

export const gatePolicyPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '安全闸、配额与风控',
      en: 'safety gates and quotas',
      desc: '一键急刹、8 个发送档位、每日自主/分享配额、写冷却秒数、412 风控熔断解除。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const box = ui.h('div')
    card.body.append(box, msg)

    async function refresh() {
      const res = await call<any>(ctx, msg, 'get', {})
      if (!res) return
      const policy = res.policy ?? {}
      const quota = res.quota ?? {}
      const traffic = res.traffic ?? {}
      box.replaceChildren()

      const killBox = ui.h('div')
      killBox.style.margin = '10px 0'
      const killBtn = ui.button(res.killOn ? '🛑 急刹已开启（点此解除）' : '🛑 一键急刹（停止一切对外写）', {
        variant: res.killOn ? '' : 'danger',
        onClick: async () => {
          try {
            msg.textContent = ''
            await ctx.invoke('set', [{ killOn: !res.killOn }])
          } catch (e) {
            msg.textContent = String(e instanceof Error ? e.message : e)
            msg.classList.add('bad')
          }
          await refresh()
        },
      })
      killBox.append(killBtn)
      if (res.killOn) {
        const warn = ui.pill('急刹生效中：她现在发不出任何东西', 'on')
        killBox.append(warn)
      }
      box.append(killBox)

      const stats = ui.statgrid([
        { k: '今日自主', v: `${quota.usedSelf ?? 0}/${quota.selfCap ?? 0}` },
        { k: '今日分享', v: `${quota.usedShare ?? 0}/${quota.shareCap ?? 0}` },
        { k: '写冷却', v: `${traffic.writeGapSec ?? 0}s` },
        { k: '412 熔断', v: traffic.pausedUntil > Date.now() ? `剩 ${Math.ceil((traffic.pausedUntil - Date.now()) / 60000)} 分钟` : '未触发' },
      ])
      box.append(stats)

      const clearPause = ui.button('解除 412 风控暂停', {
        onClick: async () => {
          await ctx.invoke('set', [{ clearTrafficPause: true }]).catch((e) => {
            msg.textContent = String(e instanceof Error ? e.message : e)
          })
          await refresh()
        },
      })
      box.append(clearPause)

      for (const f of POLICY_FIELDS) {
        const sel = ui.select({ options: f.options, value: String(policy[f.key] ?? f.options[0]) })
        const save = ui.button('保存', {
          onClick: async () => {
            try {
              msg.textContent = ''
              await ctx.invoke('set', [{ policy: { [f.key]: sel.value } }])
            } catch (e) {
              msg.textContent = String(e instanceof Error ? e.message : e)
              msg.classList.add('bad')
            }
            await refresh()
          },
        })
        const row = ui.h('div')
        row.style.margin = '6px 0'
        row.append(ui.field(f.label, sel), save)
        box.append(row)
      }

      const selfCap = ui.input({ value: String(quota.selfCap ?? 12), type: 'number', min: 0 })
      const shareCap = ui.input({ value: String(quota.shareCap ?? 3), type: 'number', min: 0 })
      const gap = ui.input({ value: String(traffic.writeGapSec ?? 10), type: 'number', min: 0 })
      const saveQuota = ui.button('保存配额与冷却', {
        onClick: async () => {
          try {
            msg.textContent = ''
            await ctx.invoke('set', [{
              quota: { selfCap: Number(selfCap.value), shareCap: Number(shareCap.value) },
              writeGapSec: Number(gap.value),
            }])
          } catch (e) {
            msg.textContent = String(e instanceof Error ? e.message : e)
            msg.classList.add('bad')
          }
          await refresh()
        },
      })
      box.append(
        ui.field('每日自主上限', selfCap),
        ui.field('每日分享上限', shareCap),
        ui.field('写操作最小冷却（秒）', gap),
        saveQuota,
      )
    }
    void refresh()
  },
}

export default {
  panels: {
    inbox: inboxPanel,
    'drafts-queue': draftsQueuePanel,
    preferences: preferencesPanel,
    'gate-policy': gatePolicyPanel,
  },
}

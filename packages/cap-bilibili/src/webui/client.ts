/**
 * B 站四大操作台（浏览器端面板）：
 *   inbox        四路收件箱与指派（让她回这条 / 忽略 / 拉黑）
 *   drafts-queue 统一待放行与改稿（在线改字自动重算哈希、打回重写、点单写稿）
 *   preferences  看片偏好与过滤规则（可视化标签增删）
 *   gate-policy  安全闸、配额与风控总控（一键急杀、8 档位、配额、冷却、412 解除）
 */
import type { PanelCtx } from '../../../cortico-adapter/src/webui-helpers.ts'
import { call, actionButton, createDirtyGuard } from '../../../cortico-adapter/src/webui-helpers.ts'

/**
 * 浏览器全局里我们真正用到的那一个。
 * `declare` 只写合同不产生运行时代码：仓里没有 DOM 库的类型可抄，
 * 而离线测试台（tests/helpers/panel-harness.mjs）会在 globalThis 上放一个同名替身，
 * 取消时返回 null——跟真浏览器一致。
 */
declare const window: { prompt: (text: string, value?: string) => string | null }

const INBOX_KINDS = [
  { id: 'all', label: '全部' },
  { id: 'dm', label: '私信' },
  { id: 'reply', label: '评论回复' },
  { id: 'mention', label: '@提及' },
  { id: 'like', label: '收到的赞' },
]

/** 队列项的写种类别——枚举值来自 write-gate.ts 的 WriteKind，别在这里发明新值。 */
const WRITE_KIND_CN: Record<string, string> = {
  dynamic: '动态',
  'edit-dynamic': '改动态',
  comment: '评论',
  danmaku: '弹幕',
  dm: '私信',
  like: '点赞',
  fav: '收藏',
}

function kindCn(k: unknown): string {
  return WRITE_KIND_CN[String(k)] ?? String(k ?? '未知')
}

/** 「3 分钟前」这种说法，比 2026-11-05T02:13:44.881Z 好读（走查 story-8）。 */
function agoText(iso: unknown): string {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return '时间未知'
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return '刚刚'
  if (s < 3600) return `${Math.floor(s / 60)} 分钟前`
  if (s < 86400) return `${Math.floor(s / 3600)} 小时前`
  return `${Math.floor(s / 86400)} 天前`
}

function queueDesc(it: any): string {
  return `#${it.id} · ${kindCn(it.kind)} · 写好 ${agoText(it.createdAt)} · 上次改动 ${agoText(it.updatedAt)} · 哈希 ${String(it.bodyHash).slice(0, 8)}`
}

/**
 * 档位枚举里"不需要主人点头"的那一侧。
 * 值域来自 write-gate.ts 的 needsApproval：draftMode review/auto、
 * comment/danmaku/like/fav review/self、dmReply direct/queue。
 */
const LOOSERTIER = new Set(['auto', 'self', 'direct'])

function tierCn(v: string): string {
  return v === 'review' ? '先看再发'
    : v === 'queue' ? '排队等你放行'
    : v === 'auto' ? '自动发'
    : v === 'self' ? '她自己做主'
    : v === 'direct' ? '收到就直接回'
    : String(v)
}

/** 改松了到底会发生什么——把这句话写在确认层里，而不是让主人去猜档位名。 */
function describeLoosen(key: string, value: string): string {
  if (key === 'draftMode') return '她写的动态不再进待放行队列，直接发到 B 站。'
  if (key === 'dmReply') return '她回私信不再排队等你放行，收到就发。'
  if (key === 'comment' || key === 'danmaku') return '她发的评论/弹幕不再需要你点头。'
  if (key === 'like' || key === 'fav') return '她的点赞/收藏不再走你的复核。'
  return `这类动作变成「${tierCn(value)}」。`
}

/** 放行确认层的"撤不回"要说对地方：私信不是公开动态，别写同一句话糊弄两种后果。 */
function releaseWarn(kind: unknown): string {
  const k = String(kind ?? '')
  if (k === 'dm') return '发进对方的私信箱，撤不回（私信删得掉，但对方可能已经看到）。'
  if (k === 'comment' || k === 'danmaku') return '公开出现在那条视频下面，别人看得见；删得掉，但传播撤不回。'
  if (k === 'like' || k === 'fav') return '会出现在她的公开空间里（点赞/收藏列表），撤不回的是"被人看到"这件事。'
  return '对外发布，撤不回（只能事后编辑或删除）。这条会出现在她的公开动态里。'
}

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
    // 刷新前先看有没有没提交的叮嘱：面板是整块重建的，打字打一半就没了（走查 story-3）
    const guard = createDirtyGuard(ui)

    let kind = 'all'
    const seg = ui.segmented(
      INBOX_KINDS.map((k) => ({ value: k.id, label: k.label })),
      { value: kind, onSelect: (v) => { kind = v; void refresh() } },
    )
    listBox.append(seg.el)

    async function refresh() {
      if (!(await guard.guard())) return
      const res = await call<any>(ctx, msg, 'list', { kind, unreadOnly: false })
      if (!res) return
      guard.reset()
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
        guard.watch(hint, () => '')

        const reply = actionButton(ctx, ui, msg, '👉 让她回这条', 'assignAction', undefined, {
          variant: 'primary',
          argsFactory: () => [{ itemKey: it.key, action: 'ask_her_reply', ownerHint: hint.value }],
          after: refresh,
        })
        const ignore = actionButton(ctx, ui, msg, '✓ 忽略已读', 'assignAction', undefined, {
          argsFactory: () => [{ itemKey: it.key, action: 'ignore' }],
          after: refresh,
        })
        // 拉黑改的是她真实的人际账，而且当场生效在平台侧——先确认，且后端也要 confirm:true
        const block = actionButton(ctx, ui, msg, '🚫 拉黑此人', 'assignAction', undefined, {
          variant: 'danger',
          argsFactory: () => [{ itemKey: it.key, action: 'block_user', confirm: true }],
          confirm: {
            title: '确认拉黑这个号？',
            body: () => `对方：${it.who ?? '某人'}（uid ${it.uid ?? '未知'}）\n最后一条：${String(it.text ?? '').slice(0, 60)}`,
            warn: '她会在 B 站真正屏蔽这个人，并且这条消息会被标成已读。屏蔽名单可以在这里放回来，但对方的观感撤不回。',
            danger: true,
            ok: '确认拉黑',
          },
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
    const guard = createDirtyGuard(ui)

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
      if (!(await guard.guard())) return
      const res = await call<any>(ctx, msg, 'list', {})
      if (!res) return
      guard.reset()
      listBox.replaceChildren(orderBox)
      const head = ui.h('div')
      head.style.margin = '8px 0'
      head.textContent = `待放行 ${res.count ?? 0} 条`
      listBox.append(head)

      for (const it of res.items ?? []) {
        const box = ui.sheet({
          // 标题不放正文预览了：正文一保存就跟标题对不上（要看的就是输入框那一份）
          title: `${kindCn(it.kind)}草稿`,
          desc: queueDesc(it),
        })
        const edit = ui.textarea({ value: it.text ?? '', rows: 5 })
        // 存档口径 = 队列里那份正文；输入框不等于它就是"有还没保存的话"
        guard.watch(edit, () => it.text ?? '')
        const acts = ui.actions()

        /** 把后端刚存的那份（清洗过 + 重算哈希 + 续签令牌）回写到这一行，不重建整列表。 */
        const applySaved = (r: any): boolean => {
          if (!r || r.ok === false) return false
          const item = r.item ?? {}
          it.text = String(item.text ?? edit.value)
          it.bodyHash = String(item.bodyHash ?? it.bodyHash)
          it.updatedAt = String(item.updatedAt ?? it.updatedAt)
          edit.value = it.text
          if (box.desc) box.desc.textContent = queueDesc(it)
          return true
        }

        const save = actionButton(ctx, ui, msg, '💾 保存修改（自动续签）', 'updateDraft', undefined, {
          argsFactory: () => [{ id: it.id, text: edit.value }],
          after: (r) => {
            if (applySaved(r)) msg.textContent = '已保存并续签令牌，放行时发的就是输入框这一段'
          },
        })
        /**
         * ★ 这批最贵的一个坑（走查 F1）：
         * 原来「✓ 放行发布」只发 `{ id }`，发的是**队列里存的旧正文**。
         * 主人改完字直接点放行 → 改的动作被静默丢弃 → B 站收到改前的稿子 → 撤不回来。
         * 现在：正文有改动就先自动存档（updateDraft 重算哈希续签令牌），存不住就中止放行。
         */
        const release = actionButton(ctx, ui, msg, '✓ 放行发布', 'release', undefined, {
          variant: 'primary',
          argsFactory: () => [{ id: it.id }],
          preRun: async () => {
            const typed = edit.value
            if (typed === it.text) return null
            const saved = await call<any>(ctx, msg, 'updateDraft', { id: it.id, text: typed })
            if (!applySaved(saved)) {
              return String(saved?.error ?? '正文没存住') + '，已中止放行（否则发到 B 站的是你改之前的旧稿）'
            }
            return null
          },
          confirm: {
            title: '确认发到 B 站？',
            body: () => `发出去的就是下面这一段（${kindCn(it.kind)} · #${it.id}）：\n\n${edit.value}`,
            warn: () => releaseWarn(it.kind),
            ok: '确认发布',
          },
          after: refresh,
        })
        // 拒稿用 window.prompt 收理由——那本身就是一道确认，不再叠第二层弹层（confirm fatigue）
        let rejectReason = ''
        const reject = actionButton(ctx, ui, msg, '✗ 拒掉', 'reject', undefined, {
          variant: 'danger',
          preRun: async () => {
            const why = window.prompt('拒稿理由（她会看到，并可让她照着重写）', '写得太空泛')
            // 原生 prompt 取消时给 null；这里连 undefined 一起防住（宿主哪天换实现不至于变成"空理由也发出去"）
            if (why === null || why === undefined) return '没填理由，已取消拒稿'
            rejectReason = why
            return null
          },
          argsFactory: () => [{ id: it.id, reason: rejectReason, askRewrite: true }],
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
    // 命中统计单独一个容器，放在 box 外面：refresh() 会清空 box（重建词表），
    // 统计那块要能活下来，不然每次改词表统计就闪没了。
    const hitsBox = ui.h('div')
    card.body.append(box, hitsBox, msg)
    const guard = createDirtyGuard(ui)

    async function refresh() {
      if (!(await guard.guard())) return
      const res = await call<any>(ctx, msg, 'get', {})
      if (!res) return
      const p = res.prefs ?? {}
      guard.reset()
      box.replaceChildren()

      const mkList = (label: string, key: string, hint: string) => {
        const wrap = ui.h('div')
        wrap.style.margin = '10px 0'
        const input = ui.input({ placeholder: hint })
        const cur = (): string[] => (Array.isArray(p[key]) ? [...p[key]] : [])
        // 添加框是"发出去就清空"的，不该被别的刷新顺手抹掉：登记成"存档 = 空"
        guard.watch(input, () => '')

        const add = actionButton(ctx, ui, msg, '添加', 'set', undefined, {
          preRun: async () => {
            const v = input.value.trim()
            if (!v) return '先写要加的词'
            if (cur().includes(v)) return '已经在里面了'
            return null
          },
          argsFactory: () => [{ [key]: [...cur(), input.value.trim()] }],
          // 存成功才清空输入框并重建列表：失败时把主人刚写的词留着，列表也没变，不必刷
          after: (r) => {
            if (!r || (r as any).ok === false) return
            input.value = ''
            return refresh()
          },
        })
        const list = ui.h('div')
        list.style.margin = '6px 0'
        for (const item of p[key] ?? []) {
          const chip = ui.chip(String(item))
          // 走查 story-2 把"删偏好词"列进要确认的名单：删的是她看片时的实际行为，
          // 虽然能加回来，但"她刚因为这个多看了两条"这种后果看不见。
          const rm = actionButton(ctx, ui, msg, '×', 'set', undefined, {
            argsFactory: () => [{ [key]: cur().filter((x) => x !== String(item)) }],
            confirm: {
              title: `确认从「${label}」里删掉？`,
              body: `要删的是：${String(item)}`,
              warn: '删了她看片时就不再按这条过滤；想反悔得重新加回来，中间这段时间已经生效。',
              ok: '确认删除',
            },
            after: refresh,
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

      const baseDur = String(p.minDurationSec ?? 600)
      const dur = ui.input({ value: baseDur, type: 'number', min: 0, step: 60 })
      guard.watch(dur, () => baseDur)
      const saveDur = actionButton(ctx, ui, msg, '保存跳过阈值（秒）', 'set', undefined, {
        preRun: async () => (Number.isFinite(Number(dur.value)) && Number(dur.value) >= 0 ? null : '阈值得是个不小于 0 的秒数'),
        argsFactory: () => [{ minDurationSec: Number(dur.value) }],
        after: refresh,
      })
      box.append(ui.field('短于多少秒的片子直接跳过', dur), saveDur)

      await renderHits()
    }

    /**
     * 规则命中统计（审计 §2.6 缺失项）。
     *
     * 这一块存在的理由很实在：10-31 她连报三次"词表未生效"，而"dislike 拦下 N 条"
     * 以前只打在 CLI 的 stdout 里——面板上看不见规则有没有生效，你就没法判断
     * 是词写窄了还是匹配没跑到。现在每个词各拦下几条、时长阈值跳过几条、
     * 一共扫过多少条都摆在页面上，还留几条命中样本用来核对**是不是误伤**。
     *
     * 单独一个容器：刷新统计时只换它的内容，不会摞出第二份。
     */
    async function renderHits() {
      const res = await call<any>(ctx, msg, 'hits', {})
      if (!res || res.ok === false) return
      const h = res.hits ?? {}
      const words: Array<{ word: string; count: number; inUse: boolean }> = Array.isArray(h.words) ? h.words : []
      const samples: Array<{ at: string; kind: string; word: string; title: string }> = Array.isArray(h.samples) ? h.samples : []

      hitsBox.replaceChildren()
      const sec = ui.h('div')
      sec.style.margin = '12px 0'
      sec.append(ui.section('规则命中统计', '规则真的拦下过什么。她报"词表未生效"时，先来这里看数字。'))

      const stat = ui.statgrid([
        { k: '扫过内容', v: `${h.scanned ?? 0} 条` },
        { k: '屏蔽词命中', v: `${Object.values(h.dislike ?? {}).reduce((a, b) => a + Number(b || 0), 0)} 条` },
        { k: '太短跳过', v: `${h.tooShort ?? 0} 条` },
        { k: '最近统计', v: h.updatedAt ? String(h.updatedAt).replace('T', ' ').slice(0, 16) : '还没有' },
      ])
      sec.append(stat)

      if (!h.everScanned) {
        sec.append(ui.placeholder('还没有扫过任何内容，统计是空的。等她实际看过片，这里才会有数字——'
          + '现在显示 0 不等于"规则没生效"，只等于"还没跑过"。'))
      }

      if (words.length) {
        const table = ui.table({ head: ['屏蔽词', '拦下几条', '还在用？'] })
        for (const w of words) {
          table.addRow([w.word, String(w.count ?? 0), w.inUse ? '是' : '已删（历史命中）'])
        }
        sec.append(table.el)
      }

      if (samples.length) {
        const t2 = ui.table({ head: ['时间', '哪条规则', '被拦下的内容'] })
        for (const s of samples) {
          t2.addRow([String(s.at ?? '').replace('T', ' ').slice(5, 16), s.word, s.title ?? ''])
        }
        sec.append(t2.el)
      }

      const acts = ui.actions()
      const reload = actionButton(ctx, ui, msg, '刷新统计', 'hits', undefined, { after: renderHits })
      const reset = actionButton(ctx, ui, msg, '清零统计', 'resetHits', undefined, {
        variant: 'danger',
        confirm: {
          title: '确认把命中统计清零？',
          body: '清掉的是"每个屏蔽词拦下过几条"这些计数，不是词表本身，也不影响她现在的过滤行为。'
            + '清零后要等下一次真的扫内容才有新数字。',
          ok: '确认清零',
        },
        after: renderHits,
      })
      acts.append(reload, reset)
      sec.append(acts)
      hitsBox.append(sec)
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
    const guard = createDirtyGuard(ui)

    async function refresh() {
      if (!(await guard.guard())) return
      const res = await call<any>(ctx, msg, 'get', {})
      if (!res) return
      const policy = res.policy ?? {}
      const quota = res.quota ?? {}
      const traffic = res.traffic ?? {}
      const paused = Number(traffic.pausedUntil ?? 0) > Date.now()
      const remainMin = paused ? Math.ceil((Number(traffic.pausedUntil) - Date.now()) / 60000) : 0
      guard.reset()
      box.replaceChildren()

      const killBox = ui.h('div')
      killBox.style.margin = '10px 0'
      const killIsOn = Boolean(res.killOn)
      const killBtn = actionButton(ctx, ui, msg,
        killIsOn ? '🛑 急刹已开启（点此解除）' : '🛑 一键急刹（停止一切对外写）',
        'set', [{ killOn: !killIsOn }], {
          variant: killIsOn ? '' : 'danger',
          // 踩刹车不用问；松开刹车才问——解除之后她立刻恢复对外写。
          confirm: killIsOn ? {
            title: '确认解除急刹？',
            body: '解除之后她会按现有档位立刻恢复一切对外写：动态、评论、弹幕、私信回复、点赞、收藏。',
            warn: paused ? '现在还在 412 熔断窗口里——急刹松了她也发不出去，那是另一道闸。' : undefined,
            danger: true,
            ok: '确认解除',
          } : undefined,
          after: refresh,
        })
      killBox.append(killBtn)
      if (killIsOn) {
        const warn = ui.pill('急刹生效中：她现在发不出任何东西', 'on')
        killBox.append(warn)
      }
      box.append(killBox)

      const stats = ui.statgrid([
        { k: '今日自主', v: `${quota.usedSelf ?? 0}/${quota.selfCap ?? 0}` },
        { k: '今日分享', v: `${quota.usedShare ?? 0}/${quota.shareCap ?? 0}` },
        { k: '写冷却', v: `${traffic.writeGapSec ?? 0}s` },
        { k: '412 熔断', v: paused ? `剩 ${remainMin} 分钟` : '未触发' },
      ])
      box.append(stats)

      if (paused) {
        const why = ui.msgline(`熔断原因：${traffic.pauseReason || '未记录（这条熔断比"记录原因"早）'}`, true)
        why.style.whiteSpace = 'pre-wrap'
        box.append(why)
      }

      const clearPause = actionButton(ctx, ui, msg, '解除 412 风控暂停', 'set',
        [{ clearTrafficPause: true, confirm: true }], {
          variant: 'danger',
          confirm: {
            title: '确认手动解除 412 熔断？',
            body: () => `熔断原因：${traffic.pauseReason || '未记录（这条熔断比"记录原因"早）'}\n剩余时间：约 ${remainMin} 分钟\n\n这道闸是平台给她上的保护，不是坏了的开关。`,
            warn: '提前解除等于在她可能仍被风控的状态下立刻恢复对外写，很可能反复撞 412。',
            danger: true,
            ok: '仍要解除',
          },
          after: refresh,
        })
      clearPause.disabled = !paused
      box.append(clearPause)

      for (const f of POLICY_FIELDS) {
        const cur = String(policy[f.key] ?? f.options[0])
        const sel = ui.select({ options: f.options.map((o) => ({ value: o, label: tierCn(o) })), value: cur })
        // 只有关紧的那一端往松的方向改才问（review→直接发 = 把审核这道闸拆掉）；
        // 同值保存和往更紧改都别弹层，confirm fatigue 是真实成本（走查 story-2 的风险条）。
        const unwatchSel = guard.watch(sel, () => cur)
        const save = actionButton(ctx, ui, msg, '保存', 'set', undefined, {
          argsFactory: () => [{ policy: { [f.key]: sel.value } }],
          // 点击那一刻才知道他选了哪一档：往下拉松了才问，收紧或同值别弹层
          confirm: () => (LOOSERTIER.has(sel.value) && sel.value !== cur) ? {
            title: `确认把「${f.label}」改成${tierCn(sel.value)}？`,
            body: `改完之后这类动作不再等你放行：${describeLoosen(f.key, sel.value)}`,
            warn: '她会自动对外发，出了错撤不回。想反悔就再改回「先看再发」。',
            danger: true,
            ok: '确认改松',
          } : undefined,
          after: (r) => {
            if (!r || (r as any).ok === false) return
            unwatchSel()
            return refresh()
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
      const baseQuota = { selfCap: selfCap.value, shareCap: shareCap.value, gap: gap.value }
      const unwatchQuota = [
        guard.watch(selfCap, () => baseQuota.selfCap),
        guard.watch(shareCap, () => baseQuota.shareCap),
        guard.watch(gap, () => baseQuota.gap),
      ]
      const saveQuota = actionButton(ctx, ui, msg, '保存配额与冷却', 'set', undefined, {
        argsFactory: () => [{
          quota: { selfCap: Number(selfCap.value), shareCap: Number(shareCap.value) },
          writeGapSec: Number(gap.value),
        }],
        // 存成功 = 这三个数已经存档，摘掉它们自己的登记（别的行有没有保存的照旧要问）
        after: (r) => {
          if (!r || (r as any).ok === false) return
          for (const off of unwatchQuota) off()
          return refresh()
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

/**
 * 连接与凭据：粘贴 cookie → 先向 B 站校验身份 → 通过了才落盘。
 *
 * 三条规矩写死在这里：
 *   ① 页面上**永不回显凭据值**（体检只给有无 + 指纹）；
 *   ② 粘进去的内容用完就清掉，不留在输入框里等下次刷新；
 *   ③ 绑定与解绑都要确认——换号等于换了她对外说话的那张嘴。
 */
export const connectionPanel = {
  mount(ctx: PanelCtx) {
    const { ui, root } = ctx
    const card = ui.sheet({
      title: '连接与凭据',
      en: 'connection & credentials',
      desc: '她登录在哪个号上、凭据齐不齐；换号就粘贴新的，校验通过才写盘。',
    })
    root.appendChild(card.el)
    const msg = ui.msgline()
    const box = ui.h('div')
    card.body.append(box, msg)
    const guard = createDirtyGuard(ui)

    async function refresh() {
      if (!(await guard.guard())) return
      const res = await call<any>(ctx, msg, 'get', {})
      if (!res) return
      box.replaceChildren()

      const live = res.live ?? {}
      const state = ui.h('div')
      state.style.margin = '8px 0'
      const who = live.isLogin
        ? ui.pill(`已登录：${live.uname ?? '（没名字）'} · mid ${live.mid ?? '?'}`, 'on')
        : ui.pill(`未登录：${live.error ?? 'B 站说没登录'}`, 'off')
      state.append(who)
      box.append(state)

      const keys = ui.h('div')
      keys.style.margin = '6px 0'
      const pres = res.present ?? {}
      const cell = (label: string, k: any) =>
        `${label} ${k?.present ? `已填（${k.fp}）` : '缺'}`
      keys.textContent = `凭据：${cell('SESSDATA', pres.sessdata)}　${cell('bili_jct', pres.bili_jct)}　${cell('buvid3', pres.buvid3)}`
        + (res.credentialsFile ? `　文件：${res.credentialsFile}` : '')
      box.append(keys)

      const last = res.lastKnown
      if (last?.boundAt) {
        const l = ui.h('div')
        l.style.margin = '6px 0'
        l.textContent = `上次绑定：${last.uname || '（无名）'} · mid ${last.mid || '?'} · ${new Date(last.boundAt).toLocaleString()}`
          + (last.verified ? '' : ' · 当时没验通过')
          + (res.stale && last.mid && String(live.mid ?? '') !== String(last.mid) ? '　⚠ 现在探到的号与上次不一样' : '')
        box.append(l)
      }

      const paste = ui.textarea({ placeholder: '从浏览器 DevTools 复制整段 Cookie 粘这里（含 SESSDATA / bili_jct / buvid3）', rows: 4 })
      guard.watch(paste, () => '')
      const allowBad = ui.checkbox('没验通也保存（网络不通时才用，会写明未校验）', { checked: false })
      const acts = ui.actions()

      const bind = actionButton(ctx, ui, msg, '🔌 校验并绑定这个号', 'bindCookie', undefined, {
        variant: 'primary',
        argsFactory: () => [{ cookie: paste.value, confirm: true, allowUnverified: allowBad.checked }],
        confirm: {
          title: '换成这个号？',
          body: '我们会先拿这段 cookie 问一次 B 站「这是谁」，验不过就一个字节都不写。\n通过后她的登录身份会换掉，文件里其他键不动，旧值会留一份带时间戳的备份。',
          warn: '换号会让她的对外发言看起来"像变了个人"；历史记忆与日记不会跟着搬过来。',
          ok: '校验并替换',
        },
        // 用完就清：粘贴过的 cookie 不该继续躺在输入框里
        after: (r: any) => {
          paste.value = ''
          allowBad.setChecked(false)
          if (r && r.ok !== false) {
            const id = r.identity ?? {}
            msg.textContent = `已绑定：${id.uname || '（无名）'} · mid ${id.mid || '?'}${r.changedAccount ? '（换了号）' : ''}${r.verified ? '' : '（未校验）'}`
          }
          return refresh()
        },
      })
      const unbind = actionButton(ctx, ui, msg, '🔓 解绑（退回未登录）', 'unbindCookie', undefined, {
        variant: 'danger',
        argsFactory: () => [{ confirm: true }],
        confirm: {
          title: '确认解绑？',
          body: '她会退回未登录身份：读侧受限，写侧被闸门挡下，直到你重新绑定。',
          warn: '这一步不删文件里的其他键，只去掉那三项。',
          danger: true,
          ok: '确认解绑',
        },
        after: refresh,
      })
      acts.append(bind, unbind)
      box.append(ui.field('新 cookie', paste), allowBad.el, acts)
    }

    const reload = actionButton(ctx, ui, msg, '↻ 重新体检', 'get', undefined, { after: refresh })
    box.append(reload)
    void refresh()
  },
}

export default {
  panels: {
    inbox: inboxPanel,
    'drafts-queue': draftsQueuePanel,
    preferences: preferencesPanel,
    'gate-policy': gatePolicyPanel,
    connection: connectionPanel,
  },
}

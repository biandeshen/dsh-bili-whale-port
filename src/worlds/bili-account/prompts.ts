/**
 * 她这一轮看到哪些话：状态描述、今天有没有出稿、上一条草稿的审批反馈、
 * 看完视频要记的事、以及"我此刻有什么手脚"。
 *
 * 全是纯函数或只在 whale home 上读写文件，不碰 World 类、不发请求。
 */
import fs from 'node:fs'
import path from 'node:path'
import { describeStateWithTrace, applyRecall, saveState, remember, rememberFirst, applyEffects, PRESETS } from './personaAdapter.ts'
import { dayKey } from '@xiaoyu/persona-core/rhythm'
import { FIELDS_FILE, PUBLIC_DIARY, resolveDraftsDir } from './paths.ts'

/** 从 debrief 回执里抠出能当记忆的内容：标题 + UP 主。解析不出来就返回空。 */
export function parseDebriefMemory(receipt: string): { title: string; up: string } | null {
  const text = String(receipt ?? '')
  const title = (text.match(/^标题:\s*(.+)$/m) || [])[1]
  if (!title) return null
  const up = (text.match(/^UP:\s*(\S+)/m) || [])[1] ?? ''
  return { title: title.trim().slice(0, 120), up: up.trim() }
}

/**
 * 看完一条视频就记一条。记忆不写进去，「有连续记忆」就只是文档里的话：
 * 她第二天看到的是空 memories，describeState 也不会带出任何往事。
 * 编码强度按当时的刺激量（Yerkes-Dodson 峰在 0.6），所以特别上头的片子记得更牢。
 */
export function rememberWatch(state: any, receipt: string, bvid: string): any {
  const parsed = parseDebriefMemory(receipt)
  if (!parsed) return state
  const content = `看过《${parsed.title}》` + (parsed.up ? `（${parsed.up}）` : '') + ` —— ${bvid}`
  return remember(state, content, {
    sender: 'npc',
    intensity: Math.max(0.1, Math.min(1, state.fields.stimulation)),
    tags: [],
    source: 'npc_self',
  })
}

/** 公开日记的尾部：给"记得"当情境词，让召回跟今天写的事有关，而不是永远最鲜活三条。 */
export function diaryTail(n = 2000): string {
  try { return fs.readFileSync(PUBLIC_DIARY, 'utf8').slice(-n) } catch { return '' }
}

/**
 * 策略切成 auto 时她该看到什么。纯函数，便于不碰真日记文件也能锁住措辞。
 * 存在的理由：7799 本机免口令，任何本地进程都能 POST 改策略；盲改必须留下她自己也读得到的痕迹。
 */
export function exportPolicyNotice(policy: { draftMode?: string; autoDailyCap?: number; autoWindow?: string }): { heading: string; body: string } | null {
  if (policy?.draftMode !== 'auto') return null
  const cap = Number(policy.autoDailyCap) > 0 ? `${policy.autoDailyCap} 条` : '不限'
  const win = String(policy.autoWindow ?? '').trim() || '不限'
  return {
    heading: '策略变了',
    body: `发送策略被切到 auto：从现在起我的草稿不等主人点头就会发出去（每日上限 ${cap}，时段 ${win}）。`
      + `\n- 这不是我改的，我也改不了：只有这台机器上的进程能这么写。`
      + `\n- 如果主人没打算让我自动发，去「发送策略」改回人工审核，或者拉 kill。`,
  }
}

/**
 * 给她的状态描述，并把这一轮**真的想起来**的记忆写回（accessCount +1、鲜活度上升）。
 * 面板的只读路径不走这里——看她的状态不该改变她的记忆。
 */
export function statePrompt(state: any, opts: { queryText?: string; seed?: string } = {}): string {
  const { text, recalledIds } = describeStateWithTrace(state, 5, opts)
  if (recalledIds.length) saveState(FIELDS_FILE, applyRecall(state, recalledIds))
  return text
}

/** 今天是否已经出过草稿（多醒几轮时不重复出稿）。 */
export function todayDraftLine(): string {
  try {
    const date = dayKey(Date.now())
    const d = JSON.parse(fs.readFileSync(path.join(resolveDraftsDir(), date + '.json'), 'utf8'))
    const zh: Record<string, string> = { pending: '等你审批', 'dry-run': '试发过', sent: '已发出', rejected: '被拒', cooldown: '冷却中', failed: '失败' }
    return `今天已经出过草稿（${d.id} · ${zh[d.status] ?? d.status}）——这一轮不用再出稿，写日记、看看就好。`
  } catch { return '' }
}

/**
 * 自我修正的落地：审批结果由 dynamic-approve.mjs 写进 causal（kind=draft-result），
 * 这里在醒来时**由代码**结算成 draftApproved / draftRejected 并落盘。
 * 不指望模型自觉调 mood_apply —— 它不调，被拒稿就永远不影响她下次的选择。
 */
export function consumeDraftResults(state: any, entries: any[], cursor: number): { state: any; consumedAt: number; applied: string[] } {
  const fresh = entries
    .filter((e) => e && e.kind === 'draft-result' && Number.isFinite(Date.parse(String(e.at))) && Date.parse(String(e.at)) > cursor)
    .sort((a, b) => Date.parse(String(a.at)) - Date.parse(String(b.at)))
  if (!fresh.length) return { state, consumedAt: cursor, applied: [] }
  let next = state
  const applied: string[] = []
  const RESULT_LINE: Record<string, string> = {
    sent: '主人把我那条草稿发出去了',
    rejected: '主人没让发那条草稿',
    failed: '那条草稿想发没发出去（网络/风控），不是主人拒的',
    cooldown: '那条草稿还在本地冷却，暂时发不了',
  }
  for (const e of fresh) {
    // 一次审批只影响一次心情；同一批里取最近一条，避免积压的旧稿一次性灌爆场值
    const preset = e.result === 'sent' ? 'draftApproved' : e.result === 'rejected' ? 'draftRejected' : null
    if (preset) applied.push(preset)
    // 四种结果都进记忆：以前 failed/cooldown 等于没发生，她既记不住"发不出去"，也不会去查原因。
    // 只有第一次点亮 flashbulb，之后同类结果是重复刺激，不该一直"刻在心里"。
    const base = RESULT_LINE[String(e.result)]
    // #41：她要从被拒里学习，光知道"没通过"学不到东西。理由来自主人放行/拒绝时写的那句
    // （dsh 把它记进 draft-result 因果账）。没写就如实说没写，绝不替主人编一个原因。
    const reason = String((e as any).reason ?? '').trim()
    const line = base ? (reason ? `${base}（主人的理由：${reason}）` : (e.result === 'rejected' ? `${base}（主人没写理由——别替他想一个）` : base)) : ''
    if (line) next = rememberFirst(next, `${line}（${e.draftId ?? ''}）`, `draft-${e.result}`, { sender: 'npc', intensity: 0.6, source: 'npc_self' })
  }
  const last = applied[applied.length - 1]
  if (last) {
    next = applyEffects(next, PRESETS[last].effects, PRESETS[last].description + `（${fresh[fresh.length - 1].draftId ?? ''}）`, { source: last })
  }
  return { state: next, consumedAt: Date.parse(String(fresh[fresh.length - 1].at)), applied }
}

/** 上一条草稿的审批结果，如果她还没用 mood_apply 消化，就在醒来时提醒一次。 */
export function latestDraftFeedback(state: any): string {
  try {
    const drafts = fs.readdirSync(resolveDraftsDir()).filter((f) => f.endsWith('.json')).map((f) => {
      try { return JSON.parse(fs.readFileSync(path.join(resolveDraftsDir(), f), 'utf8')) } catch { return null }
    }).filter(Boolean)
    const done = drafts
      .filter((d: any) => d.status === 'sent' || d.status === 'rejected')
      .sort((a: any, b: any) => Date.parse(b.result?.at || b.rejectedAt || 0) - Date.parse(a.result?.at || a.rejectedAt || 0))[0]
    if (!done) return ''
    const at = Date.parse(done.result?.at || done.rejectedAt || '')
    const last = [...state.chain].reverse().find((e: any) => e.source === 'draftApproved' || e.source === 'draftRejected')
    if (last && last.timestamp.getTime() >= at) return ''
    // #41：提醒里也带理由——她醒来第一眼看到的就该是"主人为什么没让发"。
    const why = String((done as any).rejectReason ?? '').trim()
    const note = String((done as any).ownerNote ?? '').trim()
    return done.status === 'sent'
      ? `上次那条草稿（${done.id}）主人放行了${note ? `，他说：「${note}」` : ''}——记得用 bili_mood_apply {"preset":"draftApproved"} 记下来。`
      : `上次那条草稿（${done.id}）主人没让发${why ? `，理由：「${why}」` : '（他没写理由，别自己编一个）'}——用 bili_mood_apply {"preset":"draftRejected"} 记下来，想想是不是选题偏了。`
  } catch { return '' }
}

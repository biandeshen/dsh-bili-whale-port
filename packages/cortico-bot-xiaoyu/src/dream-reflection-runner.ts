/**
 * 睡前的反思 —— 真正跑起来的那一段（主人 2026-11-05 拍板：反思花模型钱）。
 *
 * 规矩（写在最前面，改代码前先看这段）：
 *   · **默认关**。要花这笔钱得主人显式打开（配置项 `reflection.enabled`）。
 *   · **每天最多一次**（`reflection.maxPerDay`，默认 1）。
 *   · **轮数硬上限**（`reflection.maxRounds`，默认 2）：跑不完就收线，不许自己聊下去。
 *   · **只碰她自己**：临时 session、只有她的记忆/日记工具、不碰 B 站、不发任何对外内容。
 *   · **失败不许影响做梦**：本地结算（沉记忆 + 遗忘叙事）照旧跑。
 *   · **账要留痕**：今天想了几次、上次什么时候想的，都写进 `dream-reflection.json`。
 *
 * 用的是宿主现成的 `spawnFork`：起一个**临时 session**（不进主对话、不进会话历史），
 * 走同一套模型与用量账（成本页看得见），工具循环由她自己的记忆/日记工具执行。
 * 所以"她写下的记忆"是**真的写进她的记忆卡与日记**，走同一套 git 记账——
 * 不是把一段文字贴到她的面板上。
 */
import {
  DREAM_SESSION_ID,
  DREAM_REFLECTION_DEFAULTS,
  decideDreamReflection,
  dreamReflectionPrompt,
  markDreamReflected,
  readDreamLedger,
  type DreamReflectionConfig,
} from '../../cap-state-rhythm/src/dream-reflection.ts'

/** 宿主那条 message 记录的最小形状（我们不 import 宿主模块：只对齐形状）。 */
interface CtxRecord {
  version: 2
  item: {
    type: 'message'
    id: string
    status: 'completed'
    role: 'system' | 'user' | 'assistant'
    content: Array<{ type: 'input_text' | 'output_text'; text: string; annotations?: unknown[] }>
  }
  context: Record<string, unknown>
}

/** 造一条消息记录（照宿主 protocol/open-responses/context.ts 的形状）。 */
function message(role: 'system' | 'user' | 'assistant', text: string): CtxRecord {
  return {
    version: 2,
    item: {
      type: 'message',
      id: `msg_${Math.random().toString(36).slice(2, 12)}`,
      status: 'completed',
      role,
      content: role === 'assistant'
        ? [{ type: 'output_text', text, annotations: [] }]
        : [{ type: 'input_text', text }],
    },
    context: {},
  }
}

export interface ReflectionRunnerDeps {
  /** 宿主的 CoreApi（拿 spawnFork / injectInternal） */
  core: {
    spawnFork?: (opts: any) => Promise<string>
    injectInternal?: (text: string, kind?: string) => void
    log?: (level: string, msg: string, meta?: unknown) => void
  } | null
  /** 反思账的文件 */
  ledgerFile: string
  /** 现读配置（主人在「配置」页改完立刻生效） */
  getConfig: () => Partial<DreamReflectionConfig>
  /** 她的正本与状态（拼提示词用） */
  promptContext: () => {
    constitution?: string
    orientation?: string
    state?: string
    archived?: string
    today?: string
  }
  /** 这一觉睡了多久（小时） */
  sleptHours: () => number
  /** 现在几点（可注入，便于测试） */
  now?: () => number
}

export interface ReflectionOutcome {
  reflected: boolean
  reason: string
  /** 模型最后那段正文（截断后） */
  surfaced?: string
}

/**
 * 跑一次睡前反思。
 *
 * **返回"没想"也是一种结果**——原因要写清楚，主人能查"她为什么今晚没想"，
 * 而不是"她好像什么都没干"。
 */
export async function runDreamReflection(deps: ReflectionRunnerDeps): Promise<ReflectionOutcome> {
  const now = deps.now?.() ?? Date.now()
  const config: DreamReflectionConfig = { ...DREAM_REFLECTION_DEFAULTS, ...(deps.getConfig?.() ?? {}) }
  const ledger = readDreamLedger(deps.ledgerFile)
  const decision = decideDreamReflection({
    now,
    sleptHours: deps.sleptHours(),
    ledger,
    config,
  })
  if (!decision.shouldReflect) {
    deps.core?.log?.('info', `今晚不反思：${decision.reason}`)
    return { reflected: false, reason: decision.reason }
  }

  const core = deps.core
  if (!core || typeof core.spawnFork !== 'function') {
    const reason = '拿不到宿主的 spawnFork（框架还没把 CoreApi 交过来），这一晚跳过'
    deps.core?.log?.('warn', `睡前反思跳过：${reason}`)
    return { reflected: false, reason }
  }

  const ctx = deps.promptContext()
  const prompt = dreamReflectionPrompt(ctx)
  const rounds = Math.max(1, Math.min(4, Math.floor(config.maxRounds)))
  // 记一次**尝试**（不是成功）：跑了就算一次，防止失败重试把额度烧光。
  markDreamReflected(deps.ledgerFile, now)

  try {
    const text = await core.spawnFork({
      id: DREAM_SESSION_ID,
      messages: [message('system', prompt)],
      // 轮数硬上限：宿主按 session 声明的 rounds 走，这里再兜一层收线提示
      capNote: `(这一晚的反思用满了 ${rounds} 轮被收线了；已经落盘的部分有效，剩下没想完的。)`,
      wrapUpHint: '收线：值得留的现在就写完，没值得留的就到此为止。',
    })
    const surfaced = String(text ?? '').trim()
    // 她想的东西**已经在工具调用里写进记忆卡与日记了**（fork 带的是她的真工具）。
    // 这里只把最后那段话带回来，让她醒着的时候知道"我昨晚想过什么"。
    if (surfaced && surfaced !== '(nothing)') {
      core.injectInternal?.(`[睡眠] 昨晚我想了这件事：${surfaced.slice(0, 400)}`, 'dream')
    }
    deps.core?.log?.('info', `睡前反思完成（${surfaced ? '有话' : '没写什么'}）`)
    return { reflected: true, reason: '想了一遍', ...(surfaced ? { surfaced } : {}) }
  } catch (e: any) {
    const reason = `反思没跑成：${String(e?.message ?? e)}`
    deps.core?.log?.('warn', `睡前反思失败（不影响做梦）：${reason}`)
    return { reflected: false, reason }
  }
}

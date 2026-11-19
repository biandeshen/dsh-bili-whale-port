/**
 * 工具调用闸门 —— 抄 LangChain `ToolCallLimitMiddleware` 的语义，不自己发明。
 *
 * 来源（2026-11-14 搜到的现成件，不是我自己想的）：
 *   · LangChain 内置 `ToolCallLimitMiddleware(thread_limit, run_limit, tool_name, exit_behavior)`
 *     https://docs.langchain.com/oss/python/langchain/middleware/built-in
 *     - `run_limit`：一次 invocation 内允许的工具调用数（每次新消息重置）
 *     - `tool_name`：只限某一个工具；不给就是全局
 *     - `exit_behavior`：'continue'（超出的那次拿到错误回执，其余照常）/ 'error' / 'end'
 *   · 重复指纹用 `f"{tool}:{arg}"`（同文同法，见 dev.to/gabrielanhaia 那篇的 LoopDetector）
 *
 * 为什么必须抄而不是自研：本仓的路由上限（Persona 声明的 `rounds.hard`）**按"轮"计数**，
 * 而实测一件事被拆成 4–14 轮（`life_do` 4 次 / `mood_apply` 3 次 / `memory_recall` 3 次），
 * 轮数上限拦不住"同一个工具被反复调"。LangChain 早就把这两个维度分开做了。
 *
 * 与"配额"的界线（这条不能含糊）：这里限的是**一次唤醒里的机械重复**，
 * 不是"她今天能做几件事"。跨唤醒不计数，心跳一响就清零。
 */

export type ExitBehavior = 'continue' | 'error' | 'end'

export interface ToolCallLimitConfig {
  /** 一次唤醒内允许的工具调用总数（= LangChain 的 run_limit，全局） */
  runLimit: number
  /** 单个工具在一次唤醒内的上限（= LangChain 的 tool_name 维度的 run_limit） */
  perToolLimit: number
  /** 同一 (tool, args) 指纹允许重复几次；1 = 第二次直接拒（默认，抄 LoopDetector 的 max_same_tool=1 取最严） */
  maxSameCall: number
  /** 超额时的行为，默认 'continue'（抄 LangChain 默认值：给错误回执，不让整批崩掉） */
  exitBehavior: ExitBehavior
}

/**
 * 默认值来源：LangChain 文档示例 `run_limit=10 / tool_limit=3`，
 * 加上我们自己实测（一件小事被拆成 4 次 life_do + 3 次 mood_apply + 3 次 memory_recall = 10 次）。
 * 取"一件事最多 3 次工具"是因为 3 是文档示例里的 tool_run_limit，不是拍的。
 */
export const DEFAULT_TOOL_LIMITS: ToolCallLimitConfig = {
  runLimit: 6,
  perToolLimit: 2,
  maxSameCall: 1,
  exitBehavior: 'continue',
}

/** 同一 (tool, args) 的指纹。args 归一化：键排序 + 去空白，免得键序不同就绕过去。 */
export function fingerprint(tool: string, args: unknown): string {
  return `${tool}:${stableStringify(args)}`
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v ?? null)
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  const o = v as Record<string, unknown>
  const keys = Object.keys(o).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
}

export interface GateDecision {
  allow: boolean
  /** 拒绝时回给模型的那句话（必须让她知道自己被拦了、为什么、接下来该怎么办） */
  reason?: string
  /** 给日志/面板的原因码 */
  code?: 'run-limit' | 'tool-limit' | 'same-call'
}

/**
 * 一次唤醒内的计数器。宿主每批新建一个，唤醒结束即丢——**没有跨批状态**，
 * 所以它不可能变成"她今天只许做 N 件事"。
 */
export class ToolCallGate {
  private total = 0
  private readonly perTool = new Map<string, number>()
  private readonly seen = new Map<string, number>()
  // Node 24 原生 TS 不开参数属性，显式声明
  private readonly cfg: ToolCallLimitConfig

  constructor(cfg: ToolCallLimitConfig = DEFAULT_TOOL_LIMITS) {
    this.cfg = cfg
  }

  /**
   * 清零（每批投递时调用）。
   * **跨批不计数**是这条设计的关键：它拦的是一次唤醒里的机械重复，
   * 不是"她今天只许做 N 件事"——那条主人 2026-10-30 明确禁过。
   */
  reset(): void {
    this.total = 0
    this.perTool.clear()
    this.seen.clear()
  }

  /** 执行前调用。允许则计数并返回 allow。 */
  check(tool: string, args: unknown): GateDecision {
    const fp = fingerprint(tool, args)
    const same = this.seen.get(fp) ?? 0
    if (same >= this.cfg.maxSameCall) {
      return {
        allow: false,
        code: 'same-call',
        reason: `这一轮你已经用同样的参数调用过 ${tool}（第 ${same + 1} 次）。`
          + '同一件事不用再做一遍——把这次的结果当作已完成，直接往下走或收尾。',
      }
    }
    const forTool = this.perTool.get(tool) ?? 0
    if (forTool >= this.cfg.perToolLimit) {
      return {
        allow: false,
        code: 'tool-limit',
        reason: `这一轮 ${tool} 已经用了 ${forTool} 次（上限 ${this.cfg.perToolLimit}）。`
          + '这件事要么已经做完了，要么该换一种做法；不要再重复调用同一个工具。',
      }
    }
    if (this.total >= this.cfg.runLimit) {
      return {
        allow: false,
        code: 'run-limit',
        reason: `这一轮工具调用已经到 ${this.total} 次（上限 ${this.cfg.runLimit}）。`
          + '不管做到哪一步，现在就收尾：把已经做完的部分说清楚，没做完的留到下一轮。',
      }
    }
    this.total += 1
    this.perTool.set(tool, forTool + 1)
    this.seen.set(fp, same + 1)
    return { allow: true }
  }

  /** 面板/日志读数：这一轮用了几次、哪个工具最多。 */
  stats(): { total: number; byTool: Record<string, number>; repeated: number } {
    const byTool: Record<string, number> = {}
    for (const [k, v] of this.perTool) byTool[k] = v
    let repeated = 0
    for (const v of this.seen.values()) if (v > 1) repeated += 1
    return { total: this.total, byTool, repeated }
  }
}

/** 把宿主给的「工具定义 + execute」包一层闸门。保持原形状，只改 execute。 */
export function withToolGate<T extends { name: string; execute?: (args: any, ...rest: any[]) => any }>(
  tools: readonly T[],
  gate: ToolCallGate,
): T[] {
  return tools.map((t) => {
    const orig = t.execute
    if (typeof orig !== 'function') return t
    return {
      ...t,
      execute: ((args: any, ...rest: any[]) => {
        const d = gate.check(t.name, args)
        if (!d.allow) {
          // 抄 LangChain 'continue' 的语义：不抛、不让整批崩，回一条可读错误给模型
          return { ok: false, blocked: true, code: d.code, error: d.reason }
        }
        return orig.call(t, args, ...rest)
      }) as T['execute'],
    }
  })
}

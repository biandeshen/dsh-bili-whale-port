/**
 * B 站整域的 Cortico World 实现（kind: "world", api: 6, id: "bili-account"）。
 *
 * 这一层是薄转接头：把 @xiaoyu/cap-bilibili 的能力包翻译成 Cortico 的 World 契约。
 * 平台细节（BV 号、wbi、412 风控）全在包里，不出包。
 */
import {
  toCorticoToolDef,
  toCorticoPanelDecl,
  invokePanelMethod,
  type CorticoToolDef,
  type CorticoPanelDecl,
} from '../../cortico-adapter/src/index.ts'
import { createBilibiliCapability, type BilibiliCapabilityOptions, type BilibiliReadHandlers } from '../../cap-bilibili/src/index.ts'
import { listJudgments } from '../../cap-journal/src/judgments-feedback.ts'

/** Cortico WorldHost 的最小形状（只用 pushEvent 与日志）。 */
export interface CorticoWorldHost {
  pushEvent(e: {
    type: string
    source: string
    senderKey?: string
    text?: string
    meta?: Record<string, unknown>
    atMs?: number
  }, opts?: Record<string, unknown>): void
  log?: (level: 'info' | 'warn' | 'error', msg: string) => void
}

export interface BiliWorldOptions extends BilibiliCapabilityOptions {
  /** World id；默认 bili-account（沿用现有配置键，零迁移） */
  id?: string
  label?: string
  /**
   * 她的判断卡来源（只读，f-aa12d0 ③ 好奇心队列）。
   * 转接头层允许认识 journal：bilibili 能力包不反向依赖 journal，
   * 由这里把 `listJudgments` 适配成 tokens 供给 `bili_seek.fromJudgment`。
   */
  judgmentFile?: string
}

export function createBiliWorld(opts: BiliWorldOptions) {
  const id = opts.id ?? 'bili-account'
  const label = opts.label ?? '小鱼 · B站账号'
  // 判断卡 → tokens 供给（f-aa12d0 ③）：只读适配。转接头层认识 journal 合法
  // （bilibili 能力包本身不反向依赖 journal）。读不到就当没有——bili_seek 的
  // fromJudgment 分支会自己说"没接上"，keyword 直捞不受影响。
  let keptJudgmentTokens: BilibiliReadHandlers['keptJudgmentTokens'] | undefined
  if (opts.judgmentFile) {
    keptJudgmentTokens = () => {
      try {
        return listJudgments(opts.judgmentFile!, { verdict: 'keep', limit: 200 })
          .items.map((j) => ({ tokens: [...(j.tokens ?? [])], status: j.status, verdict: j.verdict }))
      } catch {
        return []
      }
    }
  }
  const cap = createBilibiliCapability({
    ...opts,
    ...(keptJudgmentTokens ? { readHandlers: { ...(opts.readHandlers ?? {}), keptJudgmentTokens } } : {}),
  })

  const world = {
    id,
    label,

    /** 工具表：16 个（感知 9 + 行动 7），全部进程内调用，不 spawn CLI。 */
    tools(): CorticoToolDef[] {
      return cap.tools().map((t) => toCorticoToolDef(t as never))
    },

    /** 4 个主人操作台：收件箱指派 / 统一待放行改稿 / 看片偏好 / 安全闸总控。 */
    webUi(language?: string) {
      const panels = cap.panels().map((p) => toCorticoPanelDecl(p as never))
      return {
        label,
        panels,
        invoke: (panel: string, method: string, args: unknown[]) =>
          invokePanelMethod(cap.panels() as never, panel, method, args),
      }
    },

    /** 环境提示词变量：把当前 B 站状态（档位 / 待放行 / 未读）交给模板渲染。 */
    envPromptVars(): Record<string, string> | null {
      try {
        const policy = cap.gate.readPolicy()
        const pending = cap.gate.listQueue('pending').length
        const unread = cap.store.listInbox({ kind: 'all', unreadOnly: true }).length
        return {
          'bili.policy': `动态=${policy.draftMode} 评论=${policy.comment} 弹幕=${policy.danmaku} 私信=${policy.dmReply} 点赞=${policy.like} 收藏=${policy.fav}`,
          'bili.queue': `待主人放行 ${pending} 条`,
          'bili.inbox': `收件箱未读 ${unread} 条`,
          'bili.kill': cap.gate.isKillOn() ? '急刹已开启，任何对外写都会被拦下' : '',
        }
      } catch {
        return null
      }
    },

    /** 挂载：把能力包接到宿主的事件通道（收件箱/待放行变化都靠它唤醒她）。 */
    async start(host: CorticoWorldHost): Promise<void> {
      cap.start?.({
        homeDir: opts.dataDir,
        dataDir: opts.dataDir,
        workspaceDir: opts.dataDir,
        pushEvent: (ev) => {
          host.pushEvent({
            type: ev.type,
            source: ev.source,
            senderKey: ev.source,
            text: ev.text,
            meta: ev.meta,
            atMs: ev.atMs,
          })
        },
        log: (level, msg, meta) => host.log?.(level, `${msg}${meta ? ' ' + JSON.stringify(meta) : ''}`),
      })
    },

    async stop(): Promise<void> {
      await cap.stop?.()
    },
  }

  return { definition: { id, label, defaults: () => ({ enabled: true, ...cap.defaultConfig }) }, world, capability: cap }
}

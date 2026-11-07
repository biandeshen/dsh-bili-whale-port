/**
 * Cortico 适配层：把宿主无关的 XiaoyuCapability 翻译成 Cortico 的 ToolDef / WorldPanelDecl / Persona。
 *
 * 这一层只有胶水，没有业务逻辑——它存在的唯一理由是"Cortico 认这套形状"。
 * 换任何别的宿主，只要写同样形状的适配器，5 个能力包一行都不用动。
 *
 * 注意：这里用本地声明的最小结构类型（不 import cortico/*），
 * 这样本包自身仍是宿主无关的；真正的类型一致性由 cortico-* 转接头在编译期对齐。
 */

/** Cortico ToolDef 的最小形状（见 Cortico src/core/types.ts:182,261）。 */
export interface CorticoToolDef {
  name: string
  description: string
  parameters: Record<string, unknown>
  tags: readonly string[]
  handler: (args: Record<string, unknown>, ctx: any) => Promise<string>
}

/** Cortico WorldPanelDecl 的最小形状（见 Cortico src/core/types.ts:790）。 */
export interface CorticoPanelDecl {
  id: string
  title: string
  description?: string
  getMethods?: readonly string[]
}

/**
 * 同一入参的重复**读**，不再重送全文（2026-11-07 #3 成本止血）。
 *
 * 为什么要掐在这里：`toCorticoToolDef` 是所有能力包工具进宿主的唯一漏斗，
 * 而今天实测的最大两块成本就是重复读自己的东西——
 * `diary_read` 172 次只有 **17 种入参**（同一种平均读 10.1 遍）、占成本 **34.7%**；
 * `memory_recall` 59 次 / 13 种，占 16.2%。而她每次开口都要把**整个会话窗口**重送一遍，
 * 所以一次早间的全文回灌会在后面几百次调用里反复计费。
 *
 * 三条边界，缺一条就会变成"替她决定看什么"：
 *   ① 只碰读工具（`mutatesState` 为假的才 dedupe），写路径一个字都不动；
 *   ② 只换"内容真的一模一样"的那次重复：比对指纹，日记有新写入 → 指纹变 → 照常给全文；
 *   ③ 留了明说的逃生口：参数带 `again:true` / `rerun:true` 直接给全文。
 *      这是"省重复"，不是"消音"——她的候选、她想读什么的自由都没被收窄（#64 里也钉了这条）。
 */
const READ_DEDUPE_MAX = 200
/** 小于这个长度的返回不值得 dedupe（省下的是噪声，不是成本）。 */
const READ_DEDUPE_MIN_BYTES = 400
const seenReads = new Map<string, string>()

/** 进程内重置（测试与"主人让她重看一遍"用）。 */
export function resetReadDedupe(): void {
  seenReads.clear()
}

/** djb2 + 长度：判"和上次一模一样"够用，且不在返回里暴露任何内容。 */
function fingerprint(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36) + ':' + text.length
}

/** 能力包工具 → Cortico ToolDef。 */
export function toCorticoToolDef(tool: {
  name: string
  summary: string
  description: string
  parameters: Record<string, unknown>
  mutatesState?: boolean
  execute: (args: any) => Promise<unknown> | unknown
}): CorticoToolDef {
  return {
    name: tool.name,
    description: tool.description || tool.summary,
    parameters: tool.parameters as Record<string, unknown>,
    tags: tool.mutatesState ? ['act'] : ['read'],
    handler: async (args: Record<string, unknown>) => {
      const out = await tool.execute(args ?? {})
      const raw = typeof out === 'string' ? out : JSON.stringify(out ?? null)
      if (tool.mutatesState) return raw
      const wantsAgain = args?.again === true || args?.rerun === true
      if (!wantsAgain && raw.length >= READ_DEDUPE_MIN_BYTES) {
        // 入参就是键：读工具的语义是"同样的问题给同样的答案"，答案没变才值得省
        const key = tool.name + '|' + JSON.stringify(args ?? {})
        const fp = fingerprint(raw)
        const last = seenReads.get(key)
        if (last === fp) {
          // LRU：最近用过的往后放，满了从最旧开始丢（丢了的后果只是下次再给一次全文）
          seenReads.delete(key)
          seenReads.set(key, fp)
          while (seenReads.size > READ_DEDUPE_MAX) seenReads.delete(seenReads.keys().next().value as string)
          return JSON.stringify({
            deduped: true,
            unchanged: true,
            bytes: raw.length,
            note: `这一份和 ${tool.name} 上一次同入参的返回完全一样（${raw.length} 字符），`
              + '全文已在会话里，不再重复展开。要重看就在参数里加 again:true；'
              + '想看别的内容请换 date / heading / 关键词。',
          })
        }
        seenReads.set(key, fp)
        while (seenReads.size > READ_DEDUPE_MAX) seenReads.delete(seenReads.keys().next().value as string)
      }
      return raw
    },
  }
}

/** 能力包面板 → Cortico WorldPanelDecl（GET 方法开放给 HTTP GET，其余只收 POST）。 */
export function toCorticoPanelDecl(panel: {
  id: string
  title: string
  description: string
  methods: Record<string, { name: string; verb: 'GET' | 'POST'; summary: string; writable: boolean; invoke: (params: any) => Promise<unknown> | unknown }>
}): CorticoPanelDecl {
  const getMethods = Object.values(panel.methods)
    .filter((m) => m.verb === 'GET')
    .map((m) => m.name)
  return {
    id: panel.id,
    title: panel.title,
    description: panel.description,
    ...(getMethods.length ? { getMethods } : {}),
  }
}

/**
 * 面板方法调用路由：面板找不到 / 方法找不到都要给出可读错误，而不是 500。
 */
export async function invokePanelMethod(
  panels: ReadonlyArray<{
    id: string
    methods: Record<string, { name: string; verb: 'GET' | 'POST'; writable: boolean; invoke: (params: any) => Promise<unknown> | unknown }>
  }>,
  panelId: string,
  method: string,
  args: unknown,
): Promise<unknown> {
  const panel = panels.find((p) => p.id === panelId)
  if (!panel) {
    throw new Error(`Unknown panel "${panelId}"（可用：${panels.map((p) => p.id).join(', ') || '无'}）`)
  }
  const m = panel.methods[method]
  if (!m) {
    throw new Error(`Unknown method "${panelId}.${method}"（可用：${Object.keys(panel.methods).join(', ')}）`)
  }
  const params = Array.isArray(args) ? (args[0] ?? {}) : (args ?? {})
  return await m.invoke(params)
}

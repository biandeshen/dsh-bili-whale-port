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
      return typeof out === 'string' ? out : JSON.stringify(out ?? null)
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

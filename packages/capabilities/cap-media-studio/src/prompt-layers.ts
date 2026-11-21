// 三层覆盖（中投入 2，对标 Open WebUI 的 per-model / per-account / per-chat）。
//
// 我们这里对应的三层是：
//   base     —— 代码包里的提示词库（assets/prompts/*.txt），谁都不许改，升级会覆盖
//   deploy   —— 部署家里的一份覆盖（<dataDir>/prompts/overrides.json），主人调好长期用
//   run      —— 单次调用传进来的选择，只影响这一次
//
// 优先级（与 Open WebUI 的"参数"口径一致，越靠前越优先）：
//   run > deploy > base
//
// 注意与 Open WebUI 的一处**故意不同**：它那边"模型级 system prompt 是追加、不被覆盖"，
// 我们这里 base 只提供"有哪些段"的默认值，不提供"必须先发"的内容——
// 因为我们的 base 是提示词原料，不是固定前缀。要追加固定前缀应该是新加一段来源，
// 而不是在三层里叠字符串。
import fs from 'node:fs'
import path from 'node:path'
import type { PromptSelection } from './image-prompt.ts'
import { DEFAULT_SELECTION } from './image-prompt.ts'
import { normalizeSelection } from './prompt-presets.ts'

export const OVERRIDES_FILE = 'overrides.json'

export interface Overrides {
  /** 部署家那份长期覆盖；null = 没有设过，用 base */
  deploy?: PromptSelection
}

function overridesPath(dataDir: string): string {
  return path.join(dataDir, 'prompts', OVERRIDES_FILE)
}

export function readOverrides(dataDir: string): { overrides: Overrides; note?: string } {
  const file = overridesPath(dataDir)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { overrides: {} }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { overrides: {}, note: `覆盖文件不是合法 JSON，已忽略：${file}` }
  }
  const obj = parsed as Record<string, unknown>
  const out: Overrides = {}
  if (obj?.deploy !== undefined) {
    const r = normalizeSelection(obj.deploy)
    if (r.ok) out.deploy = r.value
    else return { overrides: {}, note: `覆盖文件里的 deploy 不合格已忽略：${r.error}` }
  }
  return { overrides: out }
}

export function writeOverrides(dataDir: string, overrides: Overrides): void {
  const file = overridesPath(dataDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify(overrides, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** 清掉部署层（回到 base）。base 本身无法被清。 */
export function clearDeployOverride(dataDir: string): void {
  fs.rmSync(overridesPath(dataDir), { force: true })
}

export interface ResolveInput {
  /** 单次调用传的选择（可为部分字段） */
  run?: Partial<PromptSelection>
  /** 代码包的默认（一般就是 DEFAULT_SELECTION，带上具体 sceneId） */
  base?: PromptSelection
}

export interface ResolvedSelection {
  selection: PromptSelection
  /** 每一层各自贡献了什么，给面板显示"这个值是谁定的" */
  layers: { name: 'base' | 'deploy' | 'run'; present: boolean }
}

/**
 * 合并三层。只做"有就用、没有就往下落"——
 * 不做深比较也不做差分，因为 selection 的每个字段都是独立旋钮，天然可叠。
 */
export function resolveSelection(dataDir: string, input: ResolveInput = {}): ResolvedSelection {
  const { overrides } = readOverrides(dataDir)
  const base = input.base ?? DEFAULT_SELECTION
  const deployed = overrides.deploy
  const merged: PromptSelection = {
    ...base,
    ...(deployed ? pickSelection(deployed) : {}),
    ...(input.run ? pickSelection(input.run) : {}),
  }
  return {
    selection: merged,
    layers: [
      { name: 'base', present: true },
      { name: 'deploy', present: Boolean(deployed) },
      { name: 'run', present: Boolean(input.run && Object.keys(input.run).length) },
    ],
  }
}

/** 只挑 selection 认识的字段，防外部对象把脏键带进合并结果。 */
function pickSelection(v: Record<string, unknown> | PromptSelection): Partial<PromptSelection> {
  const src = v as Record<string, unknown>
  const out: Partial<PromptSelection> = {}
  if (typeof src.sceneId === 'string' && src.sceneId) out.sceneId = src.sceneId
  if (typeof src.form === 'string' && src.form) out.form = src.form
  for (const k of ['style', 'formOn', 'character', 'scene', 'negative'] as const) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean
  }
  if (typeof src.refNote === 'string') out.refNote = src.refNote
  return out
}

export { overridesPath }

// 提示词预设的存取层（中投入 1：保存 / 命名 / 列表 / 删除 / 导入导出）。
//
// 设计取舍，都写在这儿免得后来人重推一遍：
//
// 1. **存在哪**：`<dataDir>/prompts/presets.json`。不放包内——包内是代码，
//    升级会覆盖；主人存的预设必须留在部署家里。
//
// 2. **JSON 的形状是契约**：`{ version: 1, presets: [{ id, name, selection, createdAt, updatedAt, note? }] }`
//    导出就是原样一份，导入按 id 合并（**同 id 覆盖、不重复堆积**）。
//
// 3. **导入不许信外部文件**：只收已知字段、未知字段丢弃、类型不对直接拒绝并说明哪一条坏。
//    宁可拒收也不能让一个手改坏的 json 把整份预设列表写烂。
import fs from 'node:fs'
import path from 'node:path'
import type { PromptSelection } from './image-prompt.ts'

export const PRESETS_VERSION = 1
export const PRESETS_FILE = 'presets.json'

export interface PromptPreset {
  id: string
  name: string
  selection: PromptSelection
  createdAt: string
  updatedAt: string
  note?: string
}

export interface PresetStore {
  version: number
  presets: PromptPreset[]
}

const EMPTY: PresetStore = { version: PRESETS_VERSION, presets: [] }

function presetsPath(dataDir: string): string {
  return path.join(dataDir, 'prompts', PRESETS_FILE)
}

/** 只认这几个字段；其余一律丢掉（防手改文件把脏东西带进来）。 */
const SELECTION_KEYS = ['sceneId', 'form', 'style', 'formOn', 'character', 'scene', 'negative', 'refNote'] as const
const BOOL_KEYS = ['style', 'formOn', 'character', 'scene', 'negative'] as const

/** 校验并规范化一条 selection；不合格返回原因。 */
export function normalizeSelection(input: unknown): { ok: true; value: PromptSelection } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: 'selection 不是对象' }
  const raw = input as Record<string, unknown>
  if (typeof raw.sceneId !== 'string' || !raw.sceneId) return { ok: false, error: 'selection.sceneId 必须是非空字符串' }
  const value: PromptSelection = {
    sceneId: raw.sceneId,
    form: typeof raw.form === 'string' && raw.form ? raw.form : 'chibi',
    style: true, formOn: true, character: true, scene: true, negative: true,
  }
  for (const k of BOOL_KEYS) {
    if (raw[k] === undefined) continue
    if (typeof raw[k] !== 'boolean') return { ok: false, error: `selection.${k} 必须是布尔值` }
    value[k] = raw[k] as boolean
  }
  if (raw.refNote !== undefined) {
    if (typeof raw.refNote !== 'string') return { ok: false, error: 'selection.refNote 必须是字符串' }
    value.refNote = raw.refNote
  }
  return { ok: true, value }
}

function normalizePreset(input: unknown, idx: number): { ok: true; value: PromptPreset } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: false, error: `第 ${idx + 1} 条不是对象` }
  const raw = input as Record<string, unknown>
  if (typeof raw.id !== 'string' || !raw.id.trim()) return { ok: false, error: `第 ${idx + 1} 条缺 id` }
  if (typeof raw.name !== 'string' || !raw.name.trim()) return { ok: false, error: `第 ${idx + 1} 条缺 name` }
  const sel = normalizeSelection(raw.selection)
  if (!sel.ok) return { ok: false, error: `第 ${idx + 1} 条（${raw.name}）：${sel.error}` }
  const now = new Date().toISOString()
  return {
    ok: true,
    value: {
      id: raw.id.trim(),
      name: raw.name.trim(),
      selection: sel.value,
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now,
      ...(typeof raw.note === 'string' && raw.note ? { note: raw.note } : {}),
    },
  }
}

/**
 * 读整份预设。**坏文件当作空的**（不抛），但把原因带回去——
 * 静默忽略坏文件等于"我存的预设凭空消失"，那比报错更难查。
 */
export function readPresets(dataDir: string): { store: PresetStore; note?: string } {
  const file = presetsPath(dataDir)
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { store: { ...EMPTY, presets: [] } }
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { store: { ...EMPTY, presets: [] }, note: `预设文件不是合法 JSON，已按空处理：${file}` }
  }
  const obj = parsed as Record<string, unknown>
  const list = Array.isArray(obj?.presets) ? obj.presets : []
  const presets: PromptPreset[] = []
  const bad: string[] = []
  list.forEach((p, i) => {
    const r = normalizePreset(p, i)
    if (r.ok) presets.push(r.value)
    else bad.push(r.error)
  })
  return {
    store: { version: PRESETS_VERSION, presets },
    ...(bad.length ? { note: `有 ${bad.length} 条预设不合格已跳过：${bad.slice(0, 3).join('；')}` } : {}),
  }
}

/** 整份写回（原子写：先写临时文件再 rename，断电不会留半个文件）。 */
export function writePresets(dataDir: string, store: PresetStore): void {
  const file = presetsPath(dataDir)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  try {
    fs.writeFileSync(tmp, JSON.stringify({ version: PRESETS_VERSION, presets: store.presets }, null, 2) + '\n', 'utf8')
    fs.renameSync(tmp, file)
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

/** 存一条（同 id 覆盖）。返回写入后的整份。 */
export function upsertPreset(dataDir: string, preset: Partial<PromptPreset> & { name: string; selection: PromptSelection }): { ok: true; store: PresetStore; preset: PromptPreset } | { ok: false; error: string } {
  const sel = normalizeSelection(preset.selection)
  if (!sel.ok) return { ok: false, error: sel.error }
  const name = String(preset.name ?? '').trim()
  if (!name) return { ok: false, error: 'name 不能为空' }
  const { store } = readPresets(dataDir)
  const now = new Date().toISOString()
  const id = (preset.id ?? '').trim() || `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
  const idx = store.presets.findIndex((p) => p.id === id)
  const next: PromptPreset = {
    id,
    name,
    selection: sel.value,
    createdAt: idx >= 0 ? store.presets[idx].createdAt : now,
    updatedAt: now,
    ...(preset.note ? { note: String(preset.note) } : {}),
  }
  if (idx >= 0) store.presets[idx] = next
  else store.presets.push(next)
  writePresets(dataDir, store)
  return { ok: true, store, preset: next }
}

export function deletePreset(dataDir: string, id: string): { ok: true; store: PresetStore } | { ok: false; error: string } {
  const { store } = readPresets(dataDir)
  const idx = store.presets.findIndex((p) => p.id === id)
  if (idx < 0) return { ok: false, error: `没有这个预设：${id}` }
  store.presets.splice(idx, 1)
  writePresets(dataDir, store)
  return { ok: true, store }
}

/**
 * 导入：接受"整份 store"或"纯数组"两种形状（导出的就是前者，手写的常是后者）。
 * 同 id 覆盖；名字重复但 id 不同则**保留两条**——重名是主人的自由，不该被悄悄合并。
 */
export function importPresets(dataDir: string, payload: unknown): { ok: true; store: PresetStore; added: number; replaced: number } | { ok: false; error: string } {
  const obj = payload as Record<string, unknown>
  const list = Array.isArray(payload) ? payload : Array.isArray(obj?.presets) ? obj.presets : null
  if (!list) return { ok: false, error: '导入内容的形状不对：要 {presets:[...]} 或 [...]' }
  const incoming: PromptPreset[] = []
  const bad: string[] = []
  list.forEach((p, i) => {
    const r = normalizePreset(p, i)
    if (r.ok) incoming.push(r.value)
    else bad.push(r.error)
  })
  if (bad.length) return { ok: false, error: `有 ${bad.length} 条不合格，整批未导入：${bad.slice(0, 3).join('；')}` }
  const { store } = readPresets(dataDir)
  let added = 0
  let replaced = 0
  for (const p of incoming) {
    const idx = store.presets.findIndex((x) => x.id === p.id)
    if (idx >= 0) {
      store.presets[idx] = p
      replaced += 1
    } else {
      store.presets.push(p)
      added += 1
    }
  }
  writePresets(dataDir, store)
  return { ok: true, store, added, replaced }
}

/** 导出（就是整份 store，可直接存成文件再导回来）。 */
export function exportPresets(dataDir: string): PresetStore {
  return readPresets(dataDir).store
}

export { presetsPath }

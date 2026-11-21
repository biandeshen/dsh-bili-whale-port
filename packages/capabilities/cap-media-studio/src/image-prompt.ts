/**
 * 生图提示词组装（V1 素材管线 · 形象正本收编）。
 *
 * 形象正本 = assets/prompts/character.txt（鲸鱼娘 Whale-chan 全部识别特征），
 * 形态档 = form-chibi.txt（2.5 头身，身份特征不变只改几何），
 * 场景库 = assets/prompts/NN-*.txt（深夜/雨声/耳机/晚安等 8 景），
 * negative.txt = 禁用项（猫耳/兔耳/暖色等形象红线）。
 *
 * 组合公式与 D:/AI/养鱼/tools/build-prompts.mjs 逐字一致（那是已出片的形状），
 * 本模块只把它变成可被能力包调用的纯函数。
 *
 * 2026-11-21 扩成"提示词预设系统"（主人拍板：小投入 5 条 + 中投入 3 条）：
 *   · 分条开关：每一段来源（风格头/形态/形象正本/场景/负面/参考图注）可单独关
 *   · 变量插值：{{owner}} {{today}} {{mood}} … 从运行状态取，未知变量原样保留
 *   · 实时预览：composeFromSelection 返回的 preview 就是最终送出去的那段
 *   · token 估算：estimateTokens，可复算
 *   · 重置为默认：DEFAULT_SELECTION
 * **旧公式不许动**：全开时必须与 composeImagePrompt 逐字一致，有测试钉着。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/** 正本与场景库的默认落点（包内 assets/prompts/）。 */
export const PROMPT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'prompts')

const STYLE_HEADER = '竖版插画，日系赛璐璐平涂风格，粗描边线稿，上色干净简洁。'

function readSafe(file: string): string | null {
  try {
    return fs.readFileSync(file, 'utf8').trim()
  } catch {
    return null
  }
}

export interface PromptLibrary {
  character: string
  forms: Record<string, string>
  scenes: Array<{ id: string; name: string; text: string }>
  negative: string[]
}

/** 读入整座提示词库（character / forms / scenes / negative）。 */
export function loadPromptLibrary(dir: string = PROMPT_DIR): PromptLibrary | null {
  const character = readSafe(path.join(dir, 'character.txt'))
  if (!character) return null
  const negative = (readSafe(path.join(dir, 'negative.txt')) ?? '')
    .split(/[,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const forms: Record<string, string> = {}
  const scenes: Array<{ id: string; name: string; text: string }> = []
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith('.txt')) continue
    const body = readSafe(path.join(dir, f)) ?? ''
    if (/^form-.*\.txt$/.test(f)) {
      forms[f.replace(/^form-/, '').replace(/\.txt$/, '')] = body
    } else if (/^\d\d-.*\.txt$/.test(f)) {
      scenes.push({ id: f.replace(/\.txt$/, ''), name: f.replace(/^\d\d-/, '').replace(/\.txt$/, ''), text: body })
    }
  }
  return { character, forms, scenes, negative }
}

// ── 分条选择 ─────────────────────────────────────────────────────────

/**
 * 一整套提示词该由哪几段组成、每段开不开。
 *
 * 为什么单独抽成一个对象而不是直接用参数：面板要能"读回当前选择"再渲染开关，
 * 只有参数就没法表达"现在是哪一套"。这也是预设保存/导入导出的单位。
 */
export interface PromptSelection {
  sceneId: string
  /** 形态档名，默认 chibi */
  form?: string
  /** 风格头（横竖版/画风那句）——关掉就完全听形象正本与场景的 */
  style: boolean
  /** 形态档（2.5 头身等几何） */
  formOn: boolean
  /** 形象正本（鲸鱼娘识别特征） */
  character: boolean
  /** 场景段 */
  scene: boolean
  /** 负面段（避免出现…） */
  negative: boolean
  /** 追加在末尾的参考图注（img2img 锚点） */
  refNote?: string
}

/** 全开 = 旧公式。改这里的默认值等于改出片效果，测试会拦。 */
export const DEFAULT_SELECTION: PromptSelection = {
  sceneId: '',
  form: 'chibi',
  style: true,
  formOn: true,
  character: true,
  scene: true,
  negative: true,
}

export type PartKind = 'style' | 'form' | 'character' | 'scene' | 'negative' | 'refNote'

export interface PromptPart {
  kind: PartKind
  label: string
  text: string
  enabled: boolean
}

/** 四类来源的当前状况（面板渲染开关用）。 */
export function listParts(lib: PromptLibrary, sel: PromptSelection): PromptPart[] {
  const scene = lib.scenes.find((s) => s.id === sel.sceneId)
  const formKey = sel.form ?? 'chibi'
  const form = lib.forms[formKey] ?? ''
  return [
    { kind: 'style', label: '风格头（横竖版/画风）', text: STYLE_HEADER, enabled: sel.style },
    { kind: 'form', label: `形态档：${formKey}`, text: form, enabled: sel.formOn },
    { kind: 'character', label: '形象正本（鲸鱼娘识别特征）', text: lib.character, enabled: sel.character },
    { kind: 'scene', label: `场景：${scene?.name ?? sel.sceneId}`, text: scene?.text ?? '', enabled: sel.scene },
    { kind: 'negative', label: `负面（${lib.negative.length} 项）`, text: negativeLine(lib), enabled: sel.negative },
    ...(sel.refNote ? [{ kind: 'refNote' as const, label: '参考图注', text: sel.refNote, enabled: true }] : []),
  ]
}

function negativeLine(lib: PromptLibrary): string {
  return `补充要求：避免出现 ${lib.negative.join('、')}。`
}

// ── 变量插值 ─────────────────────────────────────────────────────────

/**
 * `{{name}}` 插值。**未知变量原样保留**——静默清空会让提示词悄悄变短，
 * 而"她今天的话怎么怪怪的"最难查到那一层。
 */
export function interpolate(text: string, vars: Record<string, string> = {}): string {
  return text.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key: string) => (key in vars ? String(vars[key]) : whole))
}

// ── token 估算 ───────────────────────────────────────────────────────

/**
 * 粗估 token 数。不追求精确（真值要过 tokenizer），只求"可复算 + 量级对"：
 *   · CJK 字符按 1 token 计
 *   · 其余按 4 字符 1 token 计
 * 这比"字符数 × 常数"更贴近中英混排的实况，且同输入必然同输出。
 */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    if (/[\u3400-\u9FFF\u3040-\u30FF\uFF00-\uFFEF]/.test(ch)) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

// ── 组合 ─────────────────────────────────────────────────────────────

export interface ComposeOptions {
  sceneId: string
  /** 形态档名（form-chibi / form-standee…），默认 chibi */
  form?: string
  /** 形象参考图 URL/img2img 时的锚点说明（追加在末尾） */
  refNote?: string
}

export type ComposeResult =
  | {
      ok: true
      /** 最终会送出去的那段字（= preview） */
      prompt: string
      preview: string
      sceneId: string
      parts: PromptPart[]
      chars: number
      tokens: number
    }
  | { ok: false; error: string }

/**
 * 组合一份完整的正向提示词（与 build-prompts.mjs 逐字同公式）。
 * 保留这个签名是为了老调用方与老测试不动——它等价于"全开的 composeFromSelection"。
 */
export function composeImagePrompt(lib: PromptLibrary, opts: ComposeOptions): { ok: true; prompt: string; sceneId: string } | { ok: false; error: string } {
  const r = composeFromSelection(lib, { ...DEFAULT_SELECTION, sceneId: opts.sceneId, form: opts.form, refNote: opts.refNote })
  if (!r.ok) return r
  return { ok: true, prompt: r.prompt, sceneId: r.sceneId }
}

/**
 * 按一套选择拼提示词。**返回的 preview 就是最终 prompt**——面板拿它渲染预览，
 * 看到的必然是发出去的那段，不许另拼一份。
 */
export function composeFromSelection(
  lib: PromptLibrary,
  sel: PromptSelection,
  vars: Record<string, string> = {},
): ComposeResult {
  const scene = lib.scenes.find((s) => s.id === sel.sceneId)
  if (!scene) {
    return { ok: false, error: `没有这个场景：${sel.sceneId}（可用：${lib.scenes.map((s) => s.id).join('、')}）` }
  }
  const formKey = sel.form ?? 'chibi'
  const form = lib.forms[formKey]
  if (sel.formOn && !form) {
    return { ok: false, error: `没有这个形态档：form-${formKey}（可用：${Object.keys(lib.forms).join('、')}）` }
  }
  const parts = listParts(lib, sel).map((p) => ({ ...p, text: interpolate(p.text, vars) }))

  /**
   * 拼法必须与旧公式逐字一致（全开时）。
   *
   * 旧写法是 `[STYLE, form, '', character, '', scene, '', negative].join('\n')`，
   * 展开后是：`STYLE\nform\n\ncharacter\n\nscene\n\nnegative`（refNote 用单个 \n 追加）。
   * 注意**风格头与形态档之间只有一个换行**，其余段之间是两个——照抄，别"整理"。
   */
  const head = [sel.style ? STYLE_HEADER : '', sel.formOn ? (form ?? '') : ''].filter((s) => s.trim()).join('\n')
  const body = [
    sel.character ? interpolate(lib.character, vars) : '',
    sel.scene ? interpolate(scene.text, vars) : '',
    sel.negative ? interpolate(negativeLine(lib), vars) : '',
  ].filter((s) => s.trim()).join('\n\n')
  const ref = sel.refNote ? interpolate(sel.refNote, vars) : ''

  let prompt = [head, body].filter((s) => s.trim()).join('\n\n')
  if (ref.trim()) prompt += (prompt ? '\n' : '') + ref
  return {
    ok: true,
    prompt,
    preview: prompt,
    sceneId: scene.id,
    parts,
    chars: prompt.length,
    tokens: estimateTokens(prompt),
  }
}

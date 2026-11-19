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

export interface ComposeOptions {
  sceneId: string
  /** 形态档名（form-chibi / form-standee…），默认 chibi */
  form?: string
  /** 形象参考图 URL/img2img 时的锚点说明（追加在末尾） */
  refNote?: string
}

/** 组合一份完整的正向提示词（与 build-prompts.mjs 逐字同公式）。 */
export function composeImagePrompt(lib: PromptLibrary, opts: ComposeOptions): { ok: true; prompt: string; sceneId: string } | { ok: false; error: string } {
  const scene = lib.scenes.find((s) => s.id === opts.sceneId)
  if (!scene) {
    return { ok: false, error: `没有这个场景：${opts.sceneId}（可用：${lib.scenes.map((s) => s.id).join('、')}）` }
  }
  const formKey = opts.form ?? 'chibi'
  const form = lib.forms[formKey]
  if (!form) {
    return { ok: false, error: `没有这个形态档：form-${formKey}（可用：${Object.keys(lib.forms).join('、')}）` }
  }
  const parts = [
    STYLE_HEADER,
    form,
    '',
    lib.character,
    '',
    scene.text,
    '',
    `补充要求：避免出现 ${lib.negative.join('、')}。`,
  ]
  if (opts.refNote) parts.push(opts.refNote)
  return { ok: true, prompt: parts.join('\n'), sceneId: scene.id }
}

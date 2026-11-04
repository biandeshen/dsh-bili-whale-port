/**
 * 她此刻有什么手脚：装配好的工具表 + 已装扩展 + 这份部署的开关。
 *
 * 全部来自磁盘与 Core 的只读查询，输出是给人看的文本；启用、安装、改配置都不在这件事
 * 的能力范围里，所以这份清单不给任何写路径。
 */
import path from 'node:path'
import { readInstalled } from '../../src/extensions.ts'
import type { ToolDescribe } from '../../src/core/types.ts'
import { readJsonSafe } from './paths.ts'

/** Core 给的工具表条目；owner 是提供方（World id 或 'persona'）。 */
export interface AssembledTool { name: string; description: string; tags: readonly string[]; owner: string }

const TAG_TEXT: Record<string, string> = { read: '读', write: '写', speak: '说', act: '动', flow: '排', snapshot: '快照' }
const tagLine = (tags: readonly string[]): string => (tags.map((t) => TAG_TEXT[t] ?? t).join('·') || '没标')

/** 包名里的类别段：`cortico-world-<id>` 这类命名是约定，加载器认的是包导出的 id，所以这里只当推测。 */
const PKG_ID = /^(?:@[^/]+\/)?cortico-(?:world|provider|bot)-([a-z0-9][a-z0-9._-]*)$/

export function capabilityText(src: {
  /** 宿主没接入 listTools 时为 null：只能报自己声明的那一份，并说明看不见别的 World。 */
  assembled: readonly AssembledTool[] | null
  /** Core 的装配表（id + 可见性 + 它自己声明的工具数）；宿主没接 listWorlds 时为 null，退回从工具表反推并自报是推断。 */
  worlds: readonly { id: string; visible: boolean; tools: number }[] | null
  /** 本 World 的自描述（名字 + 给人看的一句话 + 标签）。 */
  mine: readonly ToolDescribe[]
  extDir: string
  configFile: string | null
}): string {
  const zh = new Map<string, string>()
  for (const t of src.mine) {
    const s = t.summary
    const line = (typeof s === 'string' ? s : (s?.zh ?? s?.en) ?? t.description).split('\n')[0].trim()
    zh.set(t.name, line)
  }
  const out: string[] = [
    '【我的手脚 · 只读清单】',
    '（这份清单我只能用眼睛看：启用扩展、装扩展、改配置都不是我能做的事，只有主人在 WebUI 里做。）',
    '',
  ]

  out.push('一、这一轮真的能调的工具')
  if (src.assembled) {
    const grouped = new Map<string, AssembledTool[]>()
    for (const t of src.assembled) {
      const list = grouped.get(t.owner)
      if (list) list.push(t)
      else grouped.set(t.owner, [t])
    }
    out.push(`（共 ${src.assembled.length} 个；标签：读=不改东西，其余（写/说/动/排/快照）都会动东西或留下记录）`)
    for (const [owner, tools] of grouped) {
      out.push(`〔${owner}〕`)
      for (const t of tools) out.push(`- ${t.name} · ${zh.get(t.name) ?? t.description.split('\n')[0].trim()} · ${tagLine(t.tags)}`)
    }
    const missing = src.mine.filter((t) => !src.assembled!.some((a) => a.name === t.name))
    if (missing.length) out.push(`〔bili-account 声明过但这一轮没有〕${missing.map((t) => t.name).join('、')} —— World 被停用，或改了配置没重启。`)
  } else {
    out.push(`（共 ${src.mine.length} 个，只有我这个 World 的：宿主没给整份工具表，别的 World 有什么我看不到）`)
    for (const t of src.mine) out.push(`- ${t.name} · ${zh.get(t.name) ?? t.description} · ${tagLine(t.tags)}`)
  }

  const cfg = src.configFile ? readJsonSafe(src.configFile) : null
  const mountedByTools = new Set((src.assembled ?? []).map((t) => t.owner))
  const mountTable = new Map((src.worlds ?? []).map((w) => [w.id, w]))
  // 宿主没接挂载表时才退回"从工具表反推"，并且必须自报这是推断：只出画面/事件的 World
  // 在工具表里根本不存在，反推会把"挂着"说成"没挂"（11-01 figure 实测报错过一次）。
  const inferredMount = src.worlds == null
  /** 这个 World 这轮挂没挂：挂载表优先；没表时只能看它在工具表里露过面没有。 */
  const isMounted = (id: string): boolean => mountTable.has(id) || (inferredMount && mountedByTools.has(id))
  /** 它露了几个工具：null = 说不清（既没挂载表，工具表里也没见过它）。 */
  const toolCount = (id: string): number | null => mountTable.get(id)?.tools ?? (mountedByTools.has(id) ? 1 : null)
  const mountLine = (id: string): string => {
    if (!isMounted(id)) return inferredMount ? '这轮没挂（从工具表反推的，看不见它未必代表没挂）' : '这轮没装配'
    const n = toolCount(id)
    const vis = mountTable.get(id)?.visible
    return `这轮挂着${n ? `，露 ${n} 个工具` : '，但它不出工具（画面/事件类），工具表里看不见它'}${vis === false ? '；对这轮模型不可见' : ''}`
  }
  const providerKinds = new Set<string>(Object.values((cfg?.providers ?? {}) as Record<string, any>).map((p) => String(p?.kind ?? '')))
  const activeBot = src.configFile ? String(readJsonSafe(path.join(path.dirname(src.configFile), 'deployment.json'))?.bot ?? '') : ''
  const worldSwitches = new Map<string, boolean>()
  for (const [id, section] of Object.entries((cfg?.worlds ?? {}) as Record<string, any>)) {
    if (section && typeof section === 'object' && typeof (section as any).enabled === 'boolean') worldSwitches.set(id, (section as any).enabled)
  }

  out.push('', `二、装在这台机器上的扩展（${src.extDir}）`)
  let deps: Array<{ name: string; spec: string }> | null = null
  try {
    deps = readInstalled(src.extDir)
  } catch (e: any) {
    out.push(`- 读不到这个目录的 package.json：${String(e?.message ?? e)}`)
  }
  if (deps && deps.length === 0) out.push('- 一个都没有：这份部署没装扩展，能用的只有仓内自带的 World 与 Provider。')
  for (const d of deps ?? []) {
    const pkg = readJsonSafe(path.join(src.extDir, 'node_modules', ...d.name.split('/'), 'package.json'))
    if (!pkg) {
      out.push(`- ${d.name} · 登记在 package.json（${d.spec}），但 node_modules 里没有这个包 = 没装上，需要主人重装`)
      continue
    }
    const kind = String((pkg.cortico as any)?.kind ?? '类别不明')
    const guess = PKG_ID.exec(d.name)?.[1] ?? ''
    let state: string
    if (kind === 'world' && guess) {
      if (isMounted(guess)) state = toolCount(guess) ? '这轮挂上了（它给我的工具就在上面那张表里）' : '这轮挂上了，但它不出工具（画面/事件类），所以工具表里看不到它'
      else if (worldSwitches.get(guess) === true) state = `配置里 worlds.${guess}.enabled=true，但这轮没装配：改动要重启，或它加载失败`
      else if (worldSwitches.get(guess) === false) state = `装了，但这份部署没启用（worlds.${guess}.enabled=false）`
      else state = `装了，但这份部署没有 worlds.${guess} 这一项 = 没启用`
    } else if (kind === 'provider' && guess) {
      state = providerKinds.has(guess) ? '有端点在用它' : `装了，但没有端点选它（providers 里没有 kind=${guess}）`
    } else if (kind === 'bot') {
      state = activeBot && activeBot === d.name ? '这份部署正在用它' : `装了，但这份部署的代码包是「${activeBot || '未记'}」`
    } else {
      state = '装了；包名推不出 id（或不认识这个类别），启用与否要主人到扩展页看'
    }
    out.push(`- ${d.name} · ${kind} · ${pkg.version ?? '版本不明'} · ${state}`)
  }

  out.push('', '三、这份部署的 World 开关（config.json 的 worlds.*）')
  if (!src.configFile) out.push('- 没拿到部署目录（ctx 缺席），读不到 config.json')
  else if (!cfg) out.push(`- 读不到 ${src.configFile}（这份部署还没写过配置文件）`)
  else if (worldSwitches.size === 0) out.push('- config.json 里没有 worlds 段：哪些 World 挂上由 bot 的默认值决定（这轮挂上的见第一节〔〕分组）')
  for (const [id, on] of worldSwitches) out.push(`- ${id} · ${on ? '开' : '关'} · ${mountLine(id)}`)

  // 口径按能力事实写：装/卸扩展、改配置归主人；**启用/停用**主人让她自己在扩展页点。
  // 以前这里一句"别自己改"把后者也否掉了，跟她被明确告知的授权相反（f-af013b）。
  out.push('', `（来源：工具表=Core 这一轮装配的结果；扩展=${path.join(src.extDir, 'package.json')}；开关=${src.configFile ?? '无'}。`
    + '装/卸扩展和改配置归主人；启用或停用某个已装的扩展，主人让过她自己到扩展页点。'
    + '想试某个扩展、或哪一项看起来该开，先在 bili_feedback 里写一句，让主人知道。）')
  return out.join('\n')
}

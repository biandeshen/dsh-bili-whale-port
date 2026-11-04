/**
 * 找 ffmpeg 在哪（cap-vision 自带，不 import 仓库外的东西——能力包必须宿主无关）。
 *
 * 上游 dsh-see-now 的 binaries.js 找的是 DSH 桌面版的摆法
 * （$DSH_HOME/tools/ffmpeg/bin、$DSH_HOME/bin），跟本仓这条线不一样。
 * 顺序照 **tools/lib/ffmpeg.mjs**（线上跑过的那份）抄：
 *   ① $FFMPEG 显式指定 → ② PATH → ③ <仓库>/bin → ④ ~/.dsh/bili-whale/bin
 *   → ⑤ 本机剪映自带（%LOCALAPPDATA%/JianyingPro/Apps/<版本>/ffmpeg.exe，版本号在路径里要扫目录）
 *
 * 与那份的差别只有一点：这里返回 `{path, source, tried}` 而不抛错、不 exit——
 * 找不到时由调用方变成结构化错误（能力包里没有 process.exit 的位置），
 * `tried` 一起带出去，报错时能说清"我找过哪些地方"。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface FfmpegResolved {
  path: string | null
  /** 命中来源（env / PATH / 具体目录），没找到时是「未找到」 */
  source: string
  /** 依次探过的位置（最多留 8 条，够人看出规律） */
  tried: string[]
}

export interface ResolveOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  homedir?: string
  /** 仓库根的 bin/ 目录（发布时随包放的静态构建） */
  repoBinDir?: string
  exists?: (p: string) => boolean
  readdir?: (p: string) => string[]
}

export function resolveFfmpeg(o: ResolveOptions = {}): FfmpegResolved {
  const env = o.env ?? process.env
  const platform = o.platform ?? process.platform
  const home = o.homedir ?? os.homedir()
  const exists = o.exists ?? ((p: string) => {
    try { return fs.statSync(p).isFile() } catch { return false }
  })
  const readdir = o.readdir ?? ((p: string) => { try { return fs.readdirSync(p) } catch { return [] } })
  const EXE = platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const tried: string[] = []
  const probe = (cand: string | undefined, source: string): FfmpegResolved | null => {
    if (!cand) return null
    tried.push(cand)
    return exists(cand) ? { path: cand, source, tried: tried.slice(-8) } : null
  }

  // ① 用户明确指定
  const r1 = probe(env.FFMPEG, 'env:FFMPEG')
  if (r1) return r1

  // ② PATH
  for (const d of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (!d) continue
    const r = probe(path.join(d, EXE), 'PATH')
    if (r) return r
  }

  // ③ 仓库 bin/
  const r3 = probe(o.repoBinDir ? path.join(o.repoBinDir, EXE) : undefined, 'repo/bin')
  if (r3) return r3

  // ④ 用户自己丢进来的那份
  const profile = env.USERPROFILE || env.HOME || home
  const r4 = probe(path.join(profile, '.dsh', 'bili-whale', 'bin', EXE), '~/.dsh/bili-whale/bin')
  if (r4) return r4

  // ⑤ 剪映自带（仅本机便利：那份不可再分发）
  const base = path.join(env.LOCALAPPDATA || '', 'JianyingPro', 'Apps')
  for (const v of readdir(base)) {
    const r = probe(path.join(base, v, EXE), '剪映')
    if (r) return r
  }

  return { path: null, source: '未找到', tried: tried.slice(-8) }
}

/**
 * dsh-video-studio —— ffmpeg 执行层。
 *
 * 设计要点（都是本项目踩过坑之后定下来的）：
 * 1. 不走宿主 subprocess 服务：dsh-ffmpeg@0.4.1 用 ctx.subprocess.spawn 裸引用调用，
 *    在 DSH 0.1.5-rc.2 上抛 "Cannot read properties of undefined (reading
 *    'selectContainmentMode')"，十个工具全废。这里直接用 node:child_process。
 * 2. ffmpeg 二进制自动探测：PATH 找不到时扫常见安装目录（winget 的路径带版本号，
 *    不能写死），也支持 DSH_FFMPEG_PATH / 配置项覆盖。
 * 3. 全部参数以 argv 数组传递，不经过 shell，用户输入无法注入命令。
 */

import { spawn } from 'node:child_process'
import { closeSync, existsSync, openSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, delimiter, join } from 'node:path'

/** 在 PATH 中查找可执行文件。 */
function findOnPath(command, env) {
  const pathValue = env.PATH ?? env.Path ?? ''
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const dir of pathValue.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const candidate = join(dir, command + ext)
      try {
        if (statSync(candidate).isFile()) return candidate
      } catch {}
    }
  }
  return undefined
}

/** winget / gyan / 便携包的常见落点，按深度有限地扫一层版本目录。 */
function scanCommonLocations(name) {
  const exe = process.platform === 'win32' ? `${name}.exe` : name
  const roots = []
  const local = process.env.LOCALAPPDATA
  const home = process.env.USERPROFILE ?? process.env.HOME
  if (local) {
    roots.push(join(local, 'Microsoft', 'WinGet', 'Links'))
    roots.push(join(local, 'Microsoft', 'WinGet', 'Packages'))
  }
  if (home) {
    roots.push(join(home, 'scoop', 'shims'))
    roots.push(join(home, 'scoop', 'apps'))
  }
  roots.push('C:\\ffmpeg', 'C:\\ProgramData\\chocolatey\\bin', '/usr/local/bin', '/opt/homebrew/bin')

  const tryDir = (dir, depth) => {
    if (depth > 3) return undefined
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return undefined
    }
    // 先直接看本层
    for (const entry of entries) {
      if (entry.isFile() && entry.name.toLowerCase() === exe.toLowerCase()) {
        return join(dir, entry.name)
      }
    }
    // 再看 bin/ 子目录（winget 包结构是 <包名>/<版本>/bin/ffmpeg.exe）
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const sub = join(dir, entry.name)
      if (entry.name.toLowerCase() === 'bin') {
        const hit = join(sub, exe)
        try {
          if (statSync(hit).isFile()) return hit
        } catch {}
      }
      const found = tryDir(sub, depth + 1)
      if (found) return found
    }
    return undefined
  }

  for (const root of roots) {
    try {
      if (!existsSync(root)) continue
    } catch {
      continue
    }
    const found = tryDir(root, 0)
    if (found) return found
  }
  return undefined
}

/**
 * 解析 ffmpeg / ffprobe 路径。
 * 优先级：显式配置 > 环境变量 > PATH > 常见安装目录。
 */
export function resolveBinaries(config = {}) {
  const env = process.env
  const wantFfmpeg = config.ffmpegPath || env.DSH_FFMPEG_PATH || env.FFMPEG_PATH
  const wantFfprobe = config.ffprobePath || env.DSH_FFPROBE_PATH || env.FFPROBE_PATH

  const ffmpeg = (wantFfmpeg && existsSync(wantFfmpeg) ? wantFfmpeg : undefined)
    ?? findOnPath('ffmpeg', env)
    ?? scanCommonLocations('ffmpeg')
  const ffprobe = (wantFfprobe && existsSync(wantFfprobe) ? wantFfprobe : undefined)
    ?? findOnPath('ffprobe', env)
    ?? scanCommonLocations('ffprobe')
    ?? (ffmpeg ? join(ffmpeg, '..', process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe') : undefined)

  return {
    ffmpeg,
    ffprobe: ffprobe && existsSync(ffprobe) ? ffprobe : undefined,
    searched: { config: Boolean(wantFfmpeg), path: Boolean(findOnPath('ffmpeg', env)), scanned: Boolean(scanCommonLocations('ffmpeg')) },
  }
}

/**
 * 运行一个进程并收集输出。argv 数组、无 shell。
 *
 * 为什么用"文件式 stdio"而不是管道：
 *   受限环境下 node 的管道 stdio spawn 会直接抛 EPERM
 *   （实测：pipe → EPERM，ignore/file → 正常）。虽然 DSH 宿主进程通常不受此限，
 *   但插件要在各种环境下都能跑，所以统一把子进程输出重定向到临时文件再读回。
 *   代价是一次额外的文件读写，收益是不依赖运行环境的 stdio 策略。
 *
 * @returns {Promise<{code:number, stdout:string, stderr:string}>}
 */
export async function run(argv, options = {}) {
  const tag = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const outFile = join(tmpdir(), `dsh-video-studio-${tag}.out`)
  const errFile = join(tmpdir(), `dsh-video-studio-${tag}.err`)
  let outFd
  let errFd
  try {
    outFd = openSync(outFile, 'w')
    errFd = openSync(errFile, 'w')
  } catch (error) {
    try { if (outFd !== undefined) closeSync(outFd) } catch {}
    throw new Error(`无法创建临时输出文件：${error.message}`)
  }

  const cleanup = () => {
    try { closeSync(outFd) } catch {}
    try { closeSync(errFd) } catch {}
    try { rmSync(outFile, { force: true }) } catch {}
    try { rmSync(errFile, { force: true }) } catch {}
  }

  return new Promise((resolve, reject) => {
    let child
    let aborted = false
    try {
      child = spawn(argv[0], argv.slice(1), {
        cwd: options.cwd ?? process.cwd(),
        env: options.env ?? process.env,
        stdio: ['ignore', outFd, errFd],
        windowsHide: true,
      })
    } catch (error) {
      cleanup()
      reject(new Error(`无法启动 ${argv[0]}：${error.code ?? error.message}`))
      return
    }

    let settled = false
    const finish = (fn) => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      let stdout = ''
      let stderr = ''
      try { stdout = readFileSync(outFile, 'utf8') } catch {}
      try { stderr = readFileSync(errFile, 'utf8') } catch {}
      cleanup()
      fn(stdout, stderr)
    }

    const timer = options.timeoutMs
      ? setTimeout(() => {
          try { child.kill('SIGKILL') } catch {}
          finish((_o, e) => reject(new Error(`${basename(argv[0])} 超时（${options.timeoutMs}ms）：${e.trim().slice(-400)}`)))
        }, options.timeoutMs)
      : undefined

    child.on('error', (error) => {
      finish((_o, e) => reject(new Error(`无法启动 ${argv[0]}：${error.code ?? error.message}${e ? ` — ${e.slice(0, 200)}` : ''}`)))
    })
    if (options.signal) {
      const onAbort = () => {
        aborted = true
        try { child.kill('SIGKILL') } catch {}
      }
      if (options.signal.aborted) onAbort()
      else options.signal.addEventListener('abort', onAbort, { once: true })
    }
    child.on('close', (code) => {
      // 被取消时要明确区分于正常结束：否则"半成品文件 + exit 0"会被上层当成渲染成功，
      // 表现为"文件存在但时长不对"这种极难定位的现象。
      finish((stdout, stderr) => {
        if (aborted) reject(new Error('已取消：进程被终止，输出不完整'))
        else resolve({ code: code ?? -1, stdout, stderr })
      })
    })
  })
}

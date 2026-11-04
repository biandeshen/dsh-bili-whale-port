/** 可注入的子进程执行器：kill switch 在 spawn 前拦截，便于单测与演练。 */
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'

export interface RunnerDeps {
  nodePath: string
  biliPath: string
  killPath: string
  spawn?: typeof spawnSync
  exists?: (p: string) => boolean
}

export function makeRunner(deps: RunnerDeps) {
  const spawn = deps.spawn ?? spawnSync
  const exists = deps.exists ?? fs.existsSync
  return (args: string[], timeout = 180000) => {
    if (exists(deps.killPath)) return { status: -2, out: '[blocked] kill switch is on' }
    const r = spawn(deps.nodePath, [deps.biliPath, ...args], { encoding: 'utf8', timeout })
    return { status: r.status ?? -1, out: (String(r.stdout || '') + String(r.stderr || '')).slice(0, 12000) }
  }
}

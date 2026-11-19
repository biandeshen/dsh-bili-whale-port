/** 子进程跑外部二进制（ffmpeg/edge-tts 等）：超时杀、收 stdout/stderr，永不抛。 */
import { spawn } from 'node:child_process'

export function runBin(bin, args, timeoutMs = 120_000) {
  return new Promise((resolve) => {
    const p = spawn(bin, args, { windowsHide: true })
    let err = ''
    let stdout = ''
    const t = setTimeout(() => { try { p.kill() } catch {} }, timeoutMs)
    p.stdout?.on('data', (d) => { stdout += String(d) })
    p.stderr.on('data', (d) => { err += String(d) })
    p.on('close', (code) => { clearTimeout(t); resolve({ code, stdout, stderr: err }) })
    p.on('error', (e) => { clearTimeout(t); resolve({ code: -1, stdout, stderr: String(e) }) })
  })
}

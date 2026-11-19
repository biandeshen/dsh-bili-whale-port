/**
 * BGM 选择器（M1c 抽自 video-build）：assets/bgm/catalog.json 为序，文件兜底。
 *
 * resolveBgm(value, { dir }) →
 *   { file: string|null, error: string|null }   // none/auto 命中无曲 / 找不到 = error 带可用清单
 * auto = 目录里第一首（catalog 顺序，缺 catalog 时按文件名排序）；
 * 名字可给曲目名或文件名片段（大小写不敏感）；给完整路径也可。
 */
import fs from 'node:fs'
import path from 'node:path'

export function listBgm(dir) {
  if (!fs.existsSync(dir)) return []
  const files = fs.readdirSync(dir).filter((f) => /\.mp3$/i.test(f)).sort()
  try {
    const cat = JSON.parse(fs.readFileSync(path.join(dir, 'catalog.json'), 'utf8'))
    const byFile = new Map((cat.tracks ?? []).map((t, i) => [t.file, i]))
    return files.sort((a, b) => {
      const ia = byFile.has(a) ? byFile.get(a) : Infinity
      const ib = byFile.has(b) ? byFile.get(b) : Infinity
      return ia !== ib ? ia - ib : a.localeCompare(b)
    })
  } catch {
    return files
  }
}

export function resolveBgm(value, { dir }) {
  if (!value || value === 'none') return { file: null, error: null }
  const files = listBgm(dir)
  if (value === 'auto') return { file: files.length ? path.join(dir, files[0]) : null, error: null }
  if (fs.existsSync(value)) return { file: value, error: null }
  const hit = files.find((f) => f.toLowerCase().includes(String(value).toLowerCase()))
  if (hit) return { file: path.join(dir, hit), error: null }
  return { file: null, error: `找不到 BGM：${value}（可用：${files.join(', ') || '目录里没有 mp3'}）` }
}

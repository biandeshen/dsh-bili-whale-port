/**
 * 构建各能力包的浏览器端面板产物（dist/webui.js）。
 *
 *   node scripts/build-webui.mjs                # 构建全部带 src/webui/client.ts 的包
 *   node scripts/build-webui.mjs <包名>          # 只构建某几个
 *
 * 产物必须是单文件 ESM：Cortico 扩展只声明一个 cortico.webUiClient 路径（dist/webui.js），
 * 浏览器端 import 不了包里的其它文件（也不会有 Node 模块可用）。
 */
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PACKAGES_DIR = path.join(ROOT, 'packages')

/**
 * 优先用底座（`host/cortico`）里的 esbuild（走 JS API，不依赖 .CMD 可执行文件——
 * Windows 上 .bin/esbuild 是 shell 脚本，execFileSync 会 ENOENT）。
 *
 * 2026-11-20：底座已搬进仓内 `host/cortico`（单仓），原来的 `../Cortico-up` 不再存在。
 *
 * `ESBUILD_LIB` 仍是逃生口：底座的 .pnpm 被清空时用它指到机器上任意一份能用的 esbuild，
 * 别为了一个打包器把整个门禁卡死。只按 JS API 加载，不执行任何二进制。
 */
async function loadEsbuild() {
  const candidates = [
    process.env.ESBUILD_LIB || '',
    path.join(ROOT, 'host', 'cortico', 'node_modules', 'esbuild', 'lib', 'main.js'),
    path.join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
  ].filter(Boolean)
  for (const c of candidates) {
    if (fs.existsSync(c)) {
      const mod = await import(pathToFileURL(c).href)
      return mod.default ?? mod
    }
  }
  throw new Error('找不到 esbuild（试过 ESBUILD_LIB / host/cortico/node_modules/esbuild 与本仓 node_modules/esbuild）')
}

/**
 * 找到所有"带浏览器面板"的包。
 *
 * 2026-11-19 #90 分层后 packages 不再平铺（kernel/ capabilities/ adapters/ shared/），
 * 所以不能只 readdir 一层——那样一个都找不到，构建会"成功"但什么都没产出。
 * 这里按两层找：packages/<层>/<包>/，并保留对旧平铺布局的容忍（万一还没搬完）。
 */
function targets() {
  const only = process.argv.slice(2).filter((a) => !a.startsWith('-'))
  const found = []
  for (const layer of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!layer.isDirectory()) continue
    const layerDir = path.join(PACKAGES_DIR, layer.name)
    const hasPkgJson = fs.existsSync(path.join(layerDir, 'package.json'))
    if (hasPkgJson) { found.push(layer.name); continue } // 旧平铺布局
    for (const pkg of fs.readdirSync(layerDir, { withFileTypes: true })) {
      if (pkg.isDirectory() && fs.existsSync(path.join(layerDir, pkg.name, 'package.json'))) found.push(pkg.name)
    }
  }
  const picked = only.length ? found.filter((n) => only.includes(n)) : found
  return picked.filter((n) => fs.existsSync(path.join(pkgDirOf(n), 'src', 'webui', 'client.ts')))
}

/** 包名 → 包目录（分层或平铺都认）。 */
function pkgDirOf(name) {
  const flat = path.join(PACKAGES_DIR, name)
  if (fs.existsSync(path.join(flat, 'package.json'))) return flat
  for (const layer of fs.readdirSync(PACKAGES_DIR, { withFileTypes: true })) {
    if (!layer.isDirectory()) continue
    const p = path.join(PACKAGES_DIR, layer.name, name)
    if (fs.existsSync(path.join(p, 'package.json'))) return p
  }
  throw new Error(`找不到包 ${name}`)
}

const esbuild = await loadEsbuild()
const built = []
/** --dev: 不压缩，浏览器报错时堆栈能指到具体 .ts 行 */
const dev = process.argv.includes('--dev')

for (const name of targets()) {
  const pkgDir = pkgDirOf(name)
  const entry = path.join(pkgDir, 'src', 'webui', 'client.ts')
  const outfile = path.join(pkgDir, 'dist', 'webui.js')
  fs.mkdirSync(path.dirname(outfile), { recursive: true })

  await esbuild.build({
    entryPoints: [entry],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    minify: !dev,
    legalComments: 'none',
    sourcemap: dev ? 'inline' : false,
  })

  // 只给扩展包（声明了 cortico.kind 的）补 webUiClient：能力包不是扩展包，
  // 它们的面板由所属扩展包合并后统一声明（一个扩展包只能有一个 webUiClient）。
  //
  // A4 版本缓存自动化：宿主的扩展 asset URL 是 /assets/extensions/<包>/<版本>/<文件>，
  // 版本不变浏览器永远拿旧 bundle（实测踩坑：改了代码页面不更新）。把产物内容哈希写进
  // patch 位——内容变了哈希变、版本自动 bump；内容没动版本不变、缓存继续有效。
  const pkgFile = path.join(pkgDir, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'))
  const isExtension = Boolean(pkg.cortico?.kind)
  if (isExtension) {
    const hash = createHash('sha256').update(fs.readFileSync(outfile)).digest('hex').slice(0, 8)
    const [maj, min, pat] = String(pkg.version ?? '0.0.0').split('.')
    if (pat !== hash) {
      pkg.version = `${maj}.${min}.${hash}`
      fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
    }
    if (!pkg.cortico.webUiClient) {
      pkg.cortico.webUiClient = 'dist/webui.js'
    }
    pkg.files = [...new Set([...(pkg.files ?? []), 'dist', 'src'])].sort()
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  } else if (pkg.cortico?.webUiClient) {
    delete pkg.cortico.webUiClient
    fs.writeFileSync(pkgFile, JSON.stringify(pkg, null, 2) + '\n', 'utf8')
  }
  built.push(`${name} → ${path.relative(ROOT, outfile)} (${fs.statSync(outfile).size} B, v${pkg.version}${isExtension ? '，已声明 webUiClient' : '，能力包不声明'})`)
}

console.log(built.length ? built.join('\n') : '没有需要构建的 webui 产物')

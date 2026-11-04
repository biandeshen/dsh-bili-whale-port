/**
 * .mjs 里不许出现 TypeScript 语法（2026-11-05，本会话第三次踩同一个坑才补的门禁）。
 *
 * 踩法很固定：在 `.mjs` 里写 `as const` / 类型标注 / 泛型，
 * `node --test` 或 `node scripts/x.mjs` 一跑就 `SyntaxError: Unexpected identifier 'as'`。
 * 前两次都是跑起来才发现，浪费一轮。这类"语言层不匹配"是纯静态可查的，没有理由靠人记住。
 *
 * 只查**只有 TS 才有、JS 里必然报错**的形状，不碰 `?.` / `??` / 私有字段这些合法语法。
 * 用法：node scripts/check-mjs-syntax.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
/** 构建产物与依赖目录不进扫描。 */
const SKIP = new Set(['node_modules', 'dist', '.git', '.qoder'])

/**
 * 每条都是一个正则 + 一句"为什么会错"。
 *
 * 只保留**在 JS 里绝不可能合法**的形状。第二版加过一条"参数位置的类型标注"
 * `(a: string, b)`，但它和合法的对象字面量 `{ neverCalled: never }` 逐字符同形——
 * 不解析语法树没法区分，于是拿 `{ a, neverCalled: never }` 一测就误报。
 * **误报的门禁等于没有门禁**（下一轮就有人来加白名单），所以这条删了：
 * 本会话三次真踩的坑全是 `as const`，那一类是纯文本可判的，留着。
 */
const RULES = [
  { re: /\bas\s+(const|never|unknown|any|satisfies)\b/, why: 'TS 的 as 断言，JS 不认' },
  { re: /function\s+[\w$]*\s*<\s*[A-Z]\w*\s*>/, why: 'TS 函数泛型' },
  { re: /^\s*(interface|type)\s+[A-Z]\w*\s*[<{=]/m, why: 'TS 声明关键字' },
  { re: /^\s*(?:private|protected|public)\s+(?:readonly\s+)?[a-zA-Z_$][\w$]*\s*[=(]/m, why: 'TS 构造器参数属性 / 可见性修饰符' },
  { re: /\)\s*:\s*(?:string|number|boolean|void|unknown)\b/, why: '返回值类型标注' },
]

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (e.name.endsWith('.mjs')) out.push(p)
  }
  return out
}

/**
 * 扫之前先把注释和字符串抠掉。
 *
 * 第一版没做这步，28 处"命中"全是误报：JSDoc 的 `@returns {{ keep: boolean }}`、
 * CLI 用法行里的 `<BV>` / `<HOME>` 占位符、连本文件自己注释里的 `as const` 都被抓。
 * **误报一次，下次就有人加白名单绕过整条门禁**——所以宁可只查真代码。
 * 做法保守：只把注释与字符串整体换成等长空白（保行号），不猜语法。
 */
function stripCommentsAndStrings(src) {
  let out = ''
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    const two = src.slice(i, i + 2)
    if (two === '/*') {
      const end = src.indexOf('*/', i + 2)
      const stop = end < 0 ? n : end + 2
      out += src.slice(i, stop).replace(/[^\n]/g, ' ')
      i = stop
      continue
    }
    if (two === '//') {
      let j = i
      while (j < n && src[j] !== '\n') j += 1
      out += ' '.repeat(j - i)
      i = j
      continue
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === c) { j += 1; break }
        j += 1
      }
      // 模板字符串里可能有 ${...} 真代码，但那不是 TS 语法，整段空白掉不会漏掉本门禁要抓的东西
      out += src.slice(i, j).replace(/[^\n]/g, ' ')
      i = j
      continue
    }
    out += c
    i += 1
  }
  return out
}

const files = walk(ROOT)
const bad = []
for (const file of files) {
  const text = stripCommentsAndStrings(fs.readFileSync(file, 'utf8'))
  for (const { re, why } of RULES) {
    const m = re.exec(text)
    if (!m) continue
    const line = text.slice(0, m.index).split('\n').length
    bad.push(`${path.relative(ROOT, file)}:${line}  ${why}  →  ${m[0].trim().slice(0, 60)}`)
  }
}

if (bad.length) {
  console.log(`.mjs 语法门禁　发现 ${bad.length} 处 TypeScript 语法（跑起来必炸）`)
  for (const b of bad) console.log('  ✗ ' + b)
  console.log('\n改法：删掉断言/标注（.mjs 是纯 JS），或把文件改成 .ts 由 --experimental-strip-types 跑。')
  process.exit(1)
}
console.log(`.mjs 语法门禁　${files.length} 个 .mjs 文件，无 TS 语法混入`)

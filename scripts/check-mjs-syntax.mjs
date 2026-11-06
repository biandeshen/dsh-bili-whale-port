/**
 * .mjs 里不许出现 TypeScript 语法（2026-11-05，本会话第三次踩同一个坑才补的门禁）。
 *
 * 踩法很固定：在 `.mjs` 里写 `as const` / 类型标注 / 泛型，
 * `node --test` 或 `node scripts/x.mjs` 一跑就 `SyntaxError: Unexpected identifier 'as'`。
 * 前两次都是跑起来才发现，浪费一轮。这类"语言层不匹配"是纯静态可查的，没有理由靠人记住。
 *
 * 只查**只有 TS 才有、JS 里必然报错**的形状，不碰 `?.` / `??` / 私有字段这些合法语法。
 * 第二遍不查规则、直接 `node --check` 每个文件（见文件末尾为什么要加这一遍）。
 * 用法：node scripts/check-mjs-syntax.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
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
  /**
   * 下面两条是 2026-11-05 又踩两次之后补回来的（`.mjs` 里写了 `(h: any) =>` 和 `const out: any[] =`）。
   *
   * 上一版删掉"参数标注"这条是对的：`{ a: never }` 与 `(a: never)` 逐字符同形，纯文本判不了。
   * 这两条不一样——要求 **`)` 后面紧跟 `=>`**、以及 **`const/let` 名字后面直接跟冒号**，
   * 合法 JS 里都写不出来（对象字面量不可能变成箭头参数的收尾括号；`const x` 后面只能是 `=`）。
   */
  {
    re: /\(\s*[a-zA-Z_$][\w$]*\s*:\s*(?:any|unknown|never|string|number|boolean|void|object|symbol|\w+(?:<[^()]*>)?(?:\[\])?)\s*\)\s*=>/,
    why: '箭头参数上的 TS 类型标注（要求右括号紧跟 =>，所以不会撞上对象字面量）',
  },
  {
    re: /\b(?:const|let|var)\s+[a-zA-Z_$][\w$]*\s*:\s*(?:any|unknown|never|string|number|boolean|void|[A-Z]\w*|[{[])/,
    why: '变量声明上的 TS 类型标注（JS 里 const 名字后面只能跟 =）',
  },
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
/**
 * 第二遍：真解析（`node --check`）。
 *
 * 上面那套正则只抓"TS 语法混进 .mjs"，抓不到**纯 JS 但语法就错**的文件。
 * 2026-11-06 就踩过一次：JSDoc 里写了一个带通配符的路径（星号紧跟斜杠），
 * 那一下把块注释提前关掉，后面整段注释被当代码解析，直到真去 `node scripts/x.mjs` 才炸——
 * 而"跑起来才知道"正是本门禁存在的理由要消灭的东西。
 * 解析错误没法靠文本规则穷举，所以直接问 node 自己。
 */
const parseBad = []
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
  if (r.status === 0) continue
  const first = String(r.stderr ?? '').split('\n').find((l) => l.trim()) ?? '解析失败'
  parseBad.push(`${path.relative(ROOT, file)}  ${first.trim().slice(0, 160)}`)
}

if (parseBad.length) {
  console.log(`.mjs 解析门禁　发现 ${parseBad.length} 个文件 node --check 过不去`)
  for (const b of parseBad) console.log('  ✗ ' + b)
  console.log('\n最常见成因：块注释里出现了"星号+斜杠"的组合（比如写带通配符的路径），把注释提前关掉。')
  console.log('改法：注释里的通配路径写成 dir/<run>/file 这种形式。')
  process.exit(1)
}
console.log(`.mjs 语法门禁　${files.length} 个 .mjs 文件，无 TS 语法混入，且逐个 node --check 通过`)

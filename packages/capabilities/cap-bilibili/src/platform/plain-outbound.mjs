/**
 * 出站正文清洗：她写给真人的每一句话，都必须是「一个真人打出来的字」。
 *
 * 为什么单独一份：模型很爱在正文里带 Markdown（`**加粗**`、`#`、`` ` ``、`- 列表`），
 * 而 B 站的动态、评论、弹幕、私信**一律不渲染 Markdown**——读者看到的就是原始符号。
 * 2026-11-02 从队列里捞出来的实证（dm-20261101-cbc62a）：
 *
 *   「这个问题我得先说实话：**我不知道自己现在跑在什么模型上。**」
 *
 * 这一条要是发出去，对面那个人一眼看出对面是机器人——比任何"AI 声明"都直接。
 * 动态那条路早就有清洗（`compose.mjs` 的 stripBold 链，e2228ba / #32），但当时只修了
 * 动态，私信 / 评论 / 弹幕三条出站口一直是裸的。这里补齐，并且做成**幂等**的后置闸：
 * 上游有没有清过都不影响结果，重复调用得到同一个串。
 *
 * 纪律：只做「去掉渲染不出来的标记」这一件事。
 * 不截断、不改标点风格、不动单个 `*`（乘法、涂改感都是合法用法）、不动《》与 emoji。
 */

/** 成对的强调标记（***x*** / **x** / __x__）→ x。 */
function dropEmphasis(s) {
  return s
    .replace(/\*\*\*\s*([\s\S]+?)\s*\*\*\*/g, '$1')
    .replace(/\*\*([\s\S]+?)\*\*/g, '$1')
    .replace(/__([\s\S]+?)__/g, '$1')
}

/** 行首标记：# 标题、> 引用、- / * 列表项（列表换成中文项目符，不丢内容）。 */
function dropLineMarks(s) {
  return s
    .replace(/^[ \t]*#{1,6}[ \t]*/gm, '')
    .replace(/^[ \t]{0,3}>[ \t]?/gm, '')
    .replace(/^([ \t]*)[-*][ \t]+(?=\S)/gm, '$1· ')
}

/** 行内代码与链接：`x` → x，[文字](链接) → 文字（链接）。 */
function dropCodeAndLinks(s) {
  return s
    .replace(/`{1,3}([^`]+?)`{1,3}/g, '$1')
    .replace(/\[([^\]]+?)\]\(([^)\s]+?)\)/g, '$1（$2）')
}

function tidyWhitespace(s) {
  return s
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * 把一段可能带 Markdown 的正文压成纯文本。幂等：`plainOutbound(plainOutbound(x)) === plainOutbound(x)`。
 * @returns {string} 清洗后的正文（可能为空串，调用方自己决定怎么报"正文是空的"）
 */
export function plainOutbound(text) {
  const s = String(text ?? '')
  if (!s) return ''
  // 去掉成对标记后可能留下落单的 **（模型写漏一半），最后再扫一遍；
  // 只扫 **（两个及以上），单个 * 一律不碰。
  const out = tidyWhitespace(dropLineMarks(dropCodeAndLinks(dropEmphasis(s))))
  return out.includes('**') ? tidyWhitespace(dropLineMarks(dropCodeAndLinks(dropEmphasis(out.replace(/\*{2,}/g, ''))))) : out
}

/**
 * 词表命中率复量（默认离线：不联网、不读运行时状态、不碰 B 站）。
 *
 * 为什么入仓：这个复量原来只活在某次会话的临时目录里，仓库中找不到，
 * 于是「词表不再是噪声」这句话无法被第二个人跑出来。现在它是一份仓内 fixture + 一个函数。
 *
 * 量的是两件事，同一批片名、同一批反馈语料，只换抽词规则：
 *   · 现规则 learnTokens —— 中文按标点切成 ≤6 字词组、稿子只认《书名号》
 *   · 旧规则 legacyTokens —— 正文按 3/4-gram 滑窗切碎（2026-10-31 复核前的实现）
 * 旧规则之所以被判为噪声：随便一个片名都能撞上词表里的某个碎片，加分等于没加分。
 *
 *   node scripts/wordlist-hit-check.mjs          # 人读输出
 *   node scripts/wordlist-hit-check.mjs --json   # 机器读
 */
import { collectLearnedTokens } from '../tools/lib/feed-feedback.mjs'

/** 28 条测试夹具片名（全部带【夹具】前缀，不是任何真实视频）。 */
export const FIXTURE_TITLES = [
  '【夹具】雨声助眠白噪音四十分钟',
  '【夹具】便利店关东煮的做法与汤底',
  '【夹具】延时摄影城市夜空第一集',
  '【夹具】猫咪开罐头的一瞬间反应',
  '【夹具】一个人的晚餐煎鱼配柠檬',
  '【夹具】老式收音机里的评书片段',
  '【夹具】深夜出租车司机聊自己女儿',
  '【夹具】把键盘改成静音轴的全过程',
  '【夹具】山间小溪实拍无剪辑',
  '【夹具】旧手机改造成电子相册',
  '【夹具】冬天的第一锅羊肉汤',
  '【夹具】图书馆闭馆前的十分钟',
  '【夹具】给阳台装自动浇水装置',
  '【夹具】菜市场收摊后的对话',
  '【夹具】用画笔画一片海的分层',
  '【夹具】台风来临前的海面实况',
  '【夹具】旧书店里翻到的一九八零年画册',
  '【夹具】把房间重新布置只留一张桌',
  '【夹具】凌晨四点的早餐店后厨',
  '【夹具】地铁末班车上的乘客群像',
  '【夹具】雪落了一夜的小区院子',
  '【夹具】手冲咖啡的第三翻试做',
  '【夹具】修好一把二十年的木椅子',
  '【夹具】养鱼的水缸长出水草的过程',
  '【夹具】把日记读给外婆听',
  '【夹具】乡间小路的雨季记录',
  '【夹具】厨房里的十分钟快炒',
  '【夹具】海边栈桥的日落延时',
]

/** 夹具反馈语料：三路信号（被赞、收藏、已放行发送的稿子）+ 一条 pending（不该被学）。 */
export const FIXTURE_FEEDBACK = {
  ownerName: '',
  likedEvents: [
    { videoTitle: '【夹具】主人放的雨声助眠白噪音', comment: '听着像真的在下雨，睡前放一圈' },
    { videoTitle: '【夹具】延时摄影城市夜空教程', comment: '参数讲得挺细，我照着试了' },
    { videoTitle: '【夹具】手冲咖啡的进阶喝法', comment: '原来粉水比才是关键' },
  ],
  favItems: [
    { title: '【夹具】便利店关东煮汤底配方', reason: '想学着熬一次' },
    { title: '【夹具】山间小溪实拍无剪辑', reason: '安静，适合写日记时放' },
    { title: '【夹具】猫咪开罐头的一瞬间', reason: '想看一百遍' },
  ],
  sentDrafts: [
    { status: 'sent', text: '今晚看的是《山间小溪实拍》。水声比昨天清楚。' },
    { status: 'sent', text: '《雨声助眠白噪音》听了两遍，还是没想好怎么说。' },
    { status: 'pending', text: '这条不该进词表：猫罐头开罐的声音' },
  ],
}

/** 旧规则（复核前）：整段正文按 3/4-gram 滑窗切碎。留着只为一并复量它有多少无差别命中。 */
export function legacyTokens(text) {
  const s = String(text ?? '').replace(/\s+/g, '')
  const out = new Set()
  for (const n of [3, 4]) {
    for (let i = 0; i + n <= s.length; i += 1) out.add(s.slice(i, i + n))
  }
  return [...out]
}

/** 【夹具】是这批片名的标签，不是内容：语料与片名都在进词表/比对前剥掉它。 */
export function stripFixtureMark(s) {
  return String(s ?? '').replace(/【夹具】\s*/g, '').trim()
}

/** 词表（现规则走 collectLearnedTokens 的真实管线；legacy=true 复量旧规则）。 */
export function wordlistOf(feedback = FIXTURE_FEEDBACK, { legacy = false } = {}) {
  const clean = (arr, fields) => arr.map((x) => Object.fromEntries(fields.map((f) => [f, typeof x[f] === 'string' ? stripFixtureMark(x[f]) : x[f]])))
  const fb = {
    ownerName: feedback.ownerName ?? '',
    likedEvents: clean(feedback.likedEvents ?? [], ['videoTitle', 'comment']),
    favItems: clean(feedback.favItems ?? [], ['title', 'reason']),
    sentDrafts: clean(feedback.sentDrafts ?? [], ['text']).map((d, i) => ({ ...d, status: (feedback.sentDrafts ?? [])[i]?.status })),
  }
  if (!legacy) return collectLearnedTokens(fb)
  const texts = [
    ...fb.likedEvents.map((e) => `${e.videoTitle} ${e.comment}`),
    ...fb.favItems.map((x) => `${x.title} ${x.reason}`),
    ...fb.sentDrafts.map((d) => String(d.text ?? '')),
  ]
  return [...new Set(texts.flatMap((t) => legacyTokens(t)))]
}

/** 词表 × 片名表 → 命中（词表里的词作为子串出现在片名正文里即命中）。 */
export function hitCheck({ titles = FIXTURE_TITLES, words } = {}) {
  const list = [...(words ?? [])]
  const hits = titles
    .map((title) => {
      const body = stripFixtureMark(title)
      const matched = list.filter((w) => w && body.includes(w))
      return matched.length ? { title, matched } : null
    })
    .filter(Boolean)
  return {
    total: titles.length,
    wordCount: list.length,
    hitCount: hits.length,
    rate: titles.length ? Number((hits.length / titles.length).toFixed(4)) : 0,
    hits,
  }
}

export function report(feedback = FIXTURE_FEEDBACK, titles = FIXTURE_TITLES) {
  return {
    titles: titles.length,
    current: hitCheck({ titles, words: wordlistOf(feedback) }),
    legacy: hitCheck({ titles, words: wordlistOf(feedback, { legacy: true }) }),
  }
}

if (process.argv[1] && process.argv[1].endsWith('wordlist-hit-check.mjs')) {
  const out = report()
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(out, null, 2))
  } else {
    const line = (label, r) => `${label}：词表 ${r.wordCount} 个词，命中 ${r.hitCount}/${r.total} 条片名（${(r.rate * 100).toFixed(1)}%）`
    console.log('离线复量：夹具片名 × 词表命中（不联网）')
    console.log('  ' + line('现规则（词组级 + 稿子只认《》）', out.current))
    console.log('  ' + line('旧规则（3/4-gram 滑窗）', out.legacy))
    for (const [label, r] of [['现规则命中样例', out.current], ['旧规则命中样例', out.legacy]]) {
      console.log(`  ${label}：`)
      if (!r.hits.length) console.log('    （无）')
      for (const h of r.hits.slice(0, 5)) console.log(`    · ${h.title} ← ${h.matched.join(' / ')}`)
    }
    const worse = out.legacy.hitCount - out.current.hitCount
    console.log(`  差值：旧规则比现规则多无差别命中 ${worse} 条${worse > 0 ? ' → 词表不再是噪声' : ' → 需要重新检查抽词规则'}`)
  }
}

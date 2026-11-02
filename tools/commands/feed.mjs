import { guardedFetch as fetch } from '../lib/traffic.mjs'
import { keepCandidate, snapshotRow, numOf, dislikeHit } from '../lib/feed-quality.mjs'
import { collectLearnedTokens, likedEventsFromLedger, favItemsFromLedger } from '../lib/feed-feedback.mjs'
import { activeJudgments } from '../lib/judgment.mjs'
// 选题器：照"她自己的偏好"挑今天该看什么。**只读**，不产生任何对外动作。
//
// 用法: node feed.mjs [--n 6] [--per 2] [--pool 30] [--allow-seen]
// 数据来源：~/.dsh/whale-diary.md 的「爱看」一行（偏好关键词）+「看过的」表格（防重复）
//          + commented-videos.md（已评论过的视频也排除）
//          + ~/.dsh/bili-whale/fields.json 近 7 天观看记录（f-a2142e：真正排除已看项）
//
// 为什么这么做（2026-10-14 主人定的方向）：主人要的是"有日子的鱼"，
// 所以"看什么"不该由别人喂，而该由她自己的偏好决定 —— 偏好写在日记里，这个脚本只负责照它去捞。
import fs from 'node:fs'
import path from 'node:path'
import { config } from '../lib/config.mjs'
import crypto from 'node:crypto'
import { whalePath, whaleHome, draftsDir, stateReadPath, statePath, credentialsPath } from '../lib/paths.mjs'
import { appendCausal } from '../lib/causal.mjs'


const argv = process.argv.slice(2)
const opt = {}
for (let i = 0; i < argv.length; i += 1) {
  if (argv[i].startsWith('--')) opt[argv[i].slice(2)] = argv[i + 1]?.startsWith('--') ? true : argv[++i] ?? true
}
const N = Number(opt.n ?? 6)
const PER = Number(opt.per ?? 2)
// 2026-10-22 调（主人问「feed 是不是筛得太严」）：不是严 ✗ 是池子太小 ✗
//   实测同一时刻：pool=30 → 只出 3 条且全是碎屑 ✗
//                 pool=60 → 出满 5 条，两条 AI 工具相关 + 两条猫咪 + 一条大肥鱼 ✓
//   代价：每个关键词多抓几条（搜索请求数不变 ✓ 只是每页多取几条 ✓）
const POOL = Number(opt.pool ?? 60)

const HOME = (process.env.USERPROFILE || process.env.HOME || '/')
const diary = whalePath('whale-diary.md')
// 2026-10-18：审计表挪到 `~/.bili-ai/` ✓（原来写死作者机器路径 ✗ 换机器就写不进去，静默失效 ✗）
const audit = stateReadPath('commented-videos.md')

// ── 偏好：统一配置首选，日记「爱看」只在配置为空时兜底 ────────────────────
// 「看过」名单：三源合并（f-a2142e，2026-11-01 意见箱）──────────────────────
//   旧版只从日记 + 评论审计表取"看过"，她每轮看完落在 fields.json 记忆里的
//   观看记录没接进来 → 已看过的片子照样当新候选排第一（她 10-30 被 BV1Sw41187j4
//   重推、10-31 同类再现）。现在：日记 + 审计表 + 近 7 天观看记录，默认排除；
//   --allow-seen 显式放回，放回的行内标 [已看过]，不再让"排除"变成不可逆的瞎猜。
let prefs = [...(config().preferences?.like ?? [])]   // 偏好来自统一配置（首选）
let prefsFrom = '统一配置'
let dislike = [...(config().preferences?.dislike ?? [])]
// 判断卡（方案 A）：主人采纳过的卡才生效；avoid 并入硬拦，prefer 只加权。
// 主人的 like/dislike 永远优先——冲突时配置赢，冲突逐条写进快照给她看。
const judgment = activeJudgments()
dislike = [...new Set([...dislike, ...judgment.avoid])]
const seenDiary = new Set()
const seenAudit = new Set()
const seenWatched = new Set()
try {
  const text = fs.readFileSync(diary, 'utf8')
  const m = text.match(/^-\s*\*\*爱看\*\*：(.+)$/m)
  // 兼容旧写法：日记里若仍写着「爱看」，只在配置没给偏好时兜底（日记应回归纯叙事）
  if (m && !prefs.length) { prefs = m[1].split(/[·、,，]/).map((s) => s.trim()).filter(Boolean); prefsFrom = '日记兜底' }
  for (const bv of text.matchAll(/\bBV[0-9A-Za-z]{10}\b/g)) seenDiary.add(bv[0])
} catch { console.log('（读不到日记，用默认偏好）') }
try {
  for (const bv of fs.readFileSync(audit, 'utf8').matchAll(/\bBV[0-9A-Za-z]{10}\b/g)) seenAudit.add(bv[0])
} catch { /* 没有审计表也无妨 */ }
try {
  // fields.json 的记忆行形如「看过《…》（UP） —— BV…」；7 天窗与她 10-31 的口径一致
  // （世界侧 annotateFeed 的 recentWatch 也是 7 天），窗口外的仍由日记/审计表兜着。
  const fj = JSON.parse(fs.readFileSync(whalePath('bili-whale', 'fields.json'), 'utf8'))
  const cut = Date.now() - 7 * 86400000
  for (const mem of (fj.memories ?? [])) {
    const at = Date.parse(String(mem?.createdAt ?? ''))
    if (!Number.isFinite(at) || at < cut) continue
    for (const bv of String(mem?.content ?? '').matchAll(/\bBV[0-9A-Za-z]{8,}\b/g)) seenWatched.add(bv[0])
  }
} catch { /* 没有 fields.json = 还没有观看记录 */ }
const seen = new Set([...seenDiary, ...seenAudit, ...seenWatched])
const ALLOW_SEEN = opt['allow-seen'] === true

const cred = JSON.parse(fs.readFileSync(credentialsPath(), 'utf8'))
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
const H = { 'user-agent': UA, referer: 'https://search.bilibili.com/', cookie: `SESSDATA=${cred.sessdata}; bili_jct=${cred.bili_jct}; buvid3=${cred.buvid3}` }
const MIXIN_TAB = [46,47,18,2,53,8,23,32,15,50,10,31,58,3,45,35,27,43,5,49,33,9,42,19,29,28,14,39,12,38,41,13,37,48,7,16,24,55,40,61,26,17,0,1,60,51,30,4,22,25,54,21,56,59,6,63,57,62,11,36,20,34,44,52]
const keyOf = (u) => u.slice(u.lastIndexOf('/') + 1, u.lastIndexOf('.'))
const nav = await (await fetch('https://api.bilibili.com/x/web-interface/nav', { headers: H })).json()
const mixin = MIXIN_TAB.map((i) => (keyOf(nav.data?.wbi_img?.img_url ?? '') + keyOf(nav.data?.wbi_img?.sub_url ?? ''))[i]).join('').slice(0, 32)
const wbi = (p) => {
  const wts = Math.round(Date.now() / 1000)
  const q = Object.keys({ ...p, wts }).sort().map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(String(k === 'wts' ? wts : p[k]).replace(/[!'()*]/g, ''))}`).join('&')
  return `${q}&w_rid=${crypto.createHash('md5').update(q + mixin).digest('hex')}`
}
const secs = (s) => { const p = String(s).split(':').map(Number); return p.length === 2 ? p[0] * 60 + p[1] : p[0] * 3600 + p[1] * 60 + p[2] }

// 2026-10-22：搜索关键词也要用切出来的短词 ✗ 不能拿「鬼畜与怀旧向剪辑」整句去搜（搜不出东西 ✗）
//   规则：每个偏好取一个最能搜到东西的词 —— 有分段就取第一段（鬼畜 ✓ / 怀旧 ✓），
//        整句没有连接词可切的（如「B站生态八卦」）就取中文双字（八卦 ✓）
const JOIN_WORDS = /[\s·,，、/]+|与|和|及|向|的|类/
function partsOf(p) {
  return [...new Set(String(p).split(JOIN_WORDS).map((x) => x.trim()).filter((x) => x.length >= 2))]
}
function searchKeywordOf(p) {
  const parts = partsOf(p)
  // 只有切出【多个】短段才算真切开 ✓
  // 「B站生态八卦」切完还是一整块 ✗ 那就不能拿整句去搜（搜不出东西 ✗）
  if (parts.length > 1) return parts[0]
  if (parts.length === 1 && parts[0].length < 4) return parts[0]
  const grams = []
  const all = String(p)
  for (let i = 0; i + 2 <= all.length; i += 1) {
    const bg = all.slice(i, i + 2)
    if (/^[\u4e00-\u9fa5]{2}$/.test(bg)) grams.push(bg)
  }
  return grams[grams.length - 1] ?? String(p)
}
const searchKeywords = [...new Set(prefs.slice(0, 6).map(searchKeywordOf))]

// 2026-10-23 改（主人：feed 27 秒太久 ✗）：
//   以前 6 个词 × 2 种排序 = 12 次搜索 ✗ 加上请求保护层的 1500ms → 18 秒 ✗
//   现在每个词只搜一种排序，按词交替 click / pubdate ✓ → 6 次 ✓
//   （两种排序都还覆盖着 ✓ 只是每个词只取一种 ✓ 池子小一点但候选够了 ✓）
// 2026-10-23：搜索结果按「关键词+排序」缓存 10 分钟 ✓
//   动机：一晚她可能跑两次 feed ✗ 第二次完全一样 ✓ 没必要再打 6 次请求 ✓
//   10 分钟够短，不会让她一直看同一批东西 ✓
// 缓存是纯派生物：读新家、读不到再读旧家，写永远落新家。
const SEARCH_CACHE_READ = stateReadPath('feed-search-cache.json')
const SEARCH_CACHE_WRITE = statePath('feed-search-cache.json')
const SEARCH_TTL_MS = 10 * 60 * 1000
async function searchCached(kw, order) {
  const key = kw + '|' + order
  let store = {}
  try { store = JSON.parse(fs.readFileSync(SEARCH_CACHE_READ, 'utf8')) } catch {}
  const hit = store[key]
  if (hit && Date.now() - Number(hit.at ?? 0) < SEARCH_TTL_MS) return hit.data
  const j = await (await fetch(`https://api.bilibili.com/x/web-interface/wbi/search/type?${wbi({ search_type: 'video', keyword: kw, order, page: 1 })}`, { headers: H })).json()
  if (j && j.code === 0) {
    store[key] = { at: Date.now(), data: j }
    // 只留最近 40 条，别无限长 ✓
    const keys = Object.keys(store)
    if (keys.length > 40) { keys.sort((a,b) => (store[a].at??0) - (store[b].at??0)); for (const k of keys.slice(0, keys.length - 40)) delete store[k] }
    try { fs.mkdirSync(path.dirname(SEARCH_CACHE_WRITE), { recursive: true }); fs.writeFileSync(SEARCH_CACHE_WRITE, JSON.stringify(store)) } catch {}
  }
  return j
}
const pool = []
for (const [kwIndex, kw] of searchKeywords.entries()) {
  for (const order of [kwIndex % 2 === 0 ? 'click' : 'pubdate']) {
    try {
      const j = await searchCached(kw, order)
      for (const it of (j?.data?.result ?? []).slice(0, Math.ceil(POOL / Math.max(1, searchKeywords.length)) + 4)) {
        pool.push({
          bv: it.bvid, t: String(it.title).replace(/<[^>]+>/g, ''), d: secs(it.duration),
          dm: Number(it.danmaku ?? 0), play: Number(it.play ?? 0), up: it.author, kw,
        })
      }
    } catch { /* 这个词没结果就跳过 */ }
    await new Promise((r) => setTimeout(r, 300))
  }
}

// ── #3 更多来源（2026-10-18 加，Kimi 评审指出：只搜关键词 = 只刷"搜索"，不是刷 B 站）
//   --source search（默认）| popular（热门）| rank（排行榜）| all（三个都要）
const SOURCE_HOT = String((process.argv.find((a) => a.startsWith('--source=')) ?? '').split('=')[1] ?? '')
  || (process.argv.includes('--source') ? String(process.argv[process.argv.indexOf('--source') + 1] ?? 'all') : 'all')
async function fetchPopular() {
  const j = await (await fetch('https://api.bilibili.com/x/web-interface/popular?pn=1&ps=20', { headers: H })).json()
  for (const it of (j?.data?.list ?? [])) {
    pool.push({ bv: it.bvid, t: String(it.title ?? '').replace(/<[^>]+>/g, ''), d: Number(it.duration ?? 0),
      dm: Number(it.stat?.danmaku ?? 0), play: Number(it.stat?.view ?? 0), up: it.owner?.name ?? '', kw: '热门' })
  }
}
async function fetchRank() {
  const j = await (await fetch('https://api.bilibili.com/x/web-interface/ranking/v2?rid=0&type=all', { headers: H })).json()
  for (const it of (j?.data?.list ?? []).slice(0, 20)) {
    pool.push({ bv: it.bvid, t: String(it.title ?? '').replace(/<[^>]+>/g, ''), d: Number(it.duration ?? 0),
      dm: Number(it.stat?.danmaku ?? 0), play: Number(it.stat?.view ?? 0), up: it.owner?.name ?? '', kw: '排行' })
  }
}
// 关注的人发了什么（2026-10-18 加）：真人才会"刷关注"——只搜关键词等于只刷"搜索"，不像人
async function fetchFollowing() {
  const j = await (await fetch('https://api.bilibili.com/x/polymer/web-dynamic/v1/feed/all?type=video&page=1', { headers: H })).json()
  if (j?.code !== 0) throw new Error(`code=${j?.code} ${j?.message ?? ''}`)
  for (const it of (j?.data?.items ?? [])) {
    const a = it?.modules?.module_author
    const ar = it?.modules?.module_dynamic?.major?.archive
    if (!ar?.bvid) continue
    const dt = String(ar.duration_text ?? '')          // 形如 "05:23"
    const p = dt.split(':').map(Number)
    const secs = p.length === 2 ? p[0] * 60 + p[1] : p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0
    pool.push({ bv: ar.bvid, t: String(ar.title ?? '').replace(/<[^>]+>/g, ''), d: secs,
      // B3（2026-10-30 她的 OPS）：快照实锤此处 play 曾落成 NaN（快照显示 null）、dm 恒为 0 ——
      // 关注片密度全失真、排序/下限全按假数据走。stat 可能是 '1.2万' 字符串 → numOf 解析，坏值归 0（fail-closed）。
      dm: numOf(ar.stat?.dm ?? ar.stat?.danmaku), play: numOf(ar.stat?.view ?? ar.stat?.play), up: a?.name ?? '', kw: '关注' })
  }
}
// 源取不到以前只在 stdout 说一句，账上一条不留（f-340915：2026-11-02 三个源同时失效，
// 她看到的是"候选池突然变小"，主人看到的是"一切正常"）。降级要落一条 feed-degraded，
// ops-day 才顶得出来；每条回执也带上当时的池子大小。
const sourceFails = []
try { if (SOURCE_HOT === 'popular' || SOURCE_HOT === 'all') await fetchPopular() } catch (e) { sourceFails.push({ src: '热门', why: String(e?.message ?? e).slice(0, 80) }); console.error('（热门源取不到，跳过）') }
try { if (SOURCE_HOT === 'rank' || SOURCE_HOT === 'all') await fetchRank() } catch (e) { sourceFails.push({ src: '排行', why: String(e?.message ?? e).slice(0, 80) }); console.error('（排行源取不到，跳过）') }
try { if (SOURCE_HOT === 'following' || SOURCE_HOT === 'all') await fetchFollowing() } catch (e) { sourceFails.push({ src: '关注', why: String(e?.message ?? e).slice(0, 80) }); console.error(`（关注源取不到，跳过：${String(e.message).slice(0, 60)}）`) }
if (sourceFails.length) {
  appendCausal(whaleHome, {
    kind: 'feed-degraded',
    sources: sourceFails.map((x) => x.src),
    why: sourceFails.map((x) => `${x.src}：${x.why}`).join(' | ').slice(0, 240),
    poolSize: pool.length,
    atMs: Date.now(),
  })
  console.error(`⚠ 取数降级：${sourceFails.map((x) => x.src).join('、')} 源失败（当前池子 ${pool.length} 条）—— 已记 feed-degraded 账`)
}
console.error(`[来源] ${SOURCE_HOT === 'all' ? '搜索 + 热门 + 排行 + 关注' : SOURCE_HOT === 'popular' ? '热门' : SOURCE_HOT === 'rank' ? '排行' : SOURCE_HOT === 'following' ? '关注' : '搜索'}`)

// ── 反馈回流（2026-10-20 加，主人定：B 也做）────────────────────────────
//   点赞账本 likes-sent.json 与收藏账本 favorites.json 是 `like` / `fav` 真写下的两个文件，
//   回流只读这两份 + 已发稿。三路都是结构化字段（标题、理由、书名号），不从散文整句学。
//   读路径走 `stateReadPath`：状态目录归一之后旧家仍是只读兜底，写永远落新家。
const likesItems = (() => {
  try { return JSON.parse(fs.readFileSync(stateReadPath('likes-sent.json'), 'utf8')).items ?? [] } catch { return [] }
})()
const favItems = (() => {
  try { return JSON.parse(fs.readFileSync(stateReadPath('favorites.json'), 'utf8')).items ?? [] } catch { return [] }
})()
// 点赞每条账目同时是"偏好素材"和"已赞过的 BV"；两处曾经各读一遍同一个文件，而且读的是
// 没人写的 feedback.json —— 于是点赞从来没进过词表。
const likedEvents = likedEventsFromLedger({ items: likesItems })
const favBVs = new Set(favItemsFromLedger({ items: favItems }).map((x) => x.bv))
const likedBVs = new Set(likesItems.filter((x) => x?.bv).map((x) => x.bv))
// B4（2026-10-30 她的 OPS）：回流源加第三路 —— 主人放行且已发送的动态草稿；
// 抽词规则整体挪进 tools/lib/feed-feedback.mjs（纯函数、带测试），这里只取数。
let sentDrafts = []
try {
  const dd = draftsDir()
  sentDrafts = fs.readdirSync(dd)
    .filter((f) => f.endsWith('.json')).sort().slice(-14)
    .map((f) => {
      try { const d = JSON.parse(fs.readFileSync(path.join(dd, f), 'utf8')); return d?.status === 'sent' ? d : null } catch { return null }
    })
    .filter(Boolean)
} catch { /* 没有草稿目录 = 还没发过稿 */ }
const ownerName = String(config().owner?.name ?? '')
const learnedTokens = collectLearnedTokens({ likedEvents, favItems, sentDrafts, ownerName })
const learnedHitsOf = (title) => learnedTokens.filter((tok) => title.toLowerCase().includes(tok)).length
// 判断卡的 prefer：与学到的词同一数量级，封顶 2.5——它调排序，不压倒主人词表的 4 分命中。
const judgedHitsOf = (title) => judgment.prefer.filter((tok) => title.includes(tok)).length
// 每条命中 +2.5，最多 +7.5（不压过偏好命中的主权重 ✓）
const boostOf = (title) => Math.min(7.5, learnedHitsOf(title) * 2.5) + Math.min(2.5, judgedHitsOf(title) * 2.5)

// ── 偏好命中与排序（2026-10-20 重写，主人定：不要对高播放量有偏向 ✗）────────────
//   旧：弹幕密度 + log10(播放)×3  → 大 UP 的爆款永远霸榜 ✗
//   新：log10(1+弹幕密度)×3 + 偏好命中×4 + 反馈学习×2.5（封顶 7.5）→ 播放量彻底移出 ✓
//   为什么密度要取 log：不取时"92 秒 15027 弹幕"那条得 163 分，偏好加满也压不过 ✗（实测）
// 2026-10-22 修（主人发现「鬼畜」「B站生态八卦」从来命中不了）：
//   旧切法只认 空格/顿号/斜杠 → 「鬼畜与怀旧向剪辑」切不开 ✗ 变成 8 字长 token
//   → 标题里必须原样出现这 8 个字 → 永远不命中 ✗
//   新切法两步：
//     ① 按分隔符 + 连接词（与 和 及 向 的 类）切开 → 鬼畜 / 怀旧 / 剪辑 ✓
//     ② 切完还 ≥4 字的长块（如「B站生态八卦」）→ 补 2 字滑动窗 → B站 / 八卦 ✓
//   ⚠️ 滑动窗只用于【命中判断】✓ 搜索关键词只用 ① 的词（搜「态八」是垃圾 ✗）
function tokensOf(p) {
  const parts = partsOf(p)
  const extra = []
  for (const part of parts) {
    if (part.length < 4) continue
    for (let i = 0; i + 2 <= part.length; i += 1) {
      const bg = part.slice(i, i + 2)
      if (/^[\u4e00-\u9fa5]{2}$/.test(bg)) extra.push(bg)   // 只收纯中文双字（否则 Live2D 会切出 Li/iv 这种垃圾 ✗）
    }
  }
  return [...new Set([String(p), ...parts, ...extra])]
}

const prefTokens = prefs.map((p) => ({
  label: p,
  tokens: tokensOf(p),   // 2026-10-22：长标签也能切碎 ✓
}))
const hitsOf = (title) => prefTokens.filter((p) => p.tokens.some((tok) => title.includes(tok))).map((p) => p.label)
const densityOf = (x) => Math.log10(1 + x.dm / Math.max(30, x.d))
// 2026-10-20：排除她自己的视频（实测刷到过自己的《大肥鱼成精了》✗ 别让自己看自己）
const selfName = String(config().self?.name ?? "")
// 2026-10-22 加（主人问「feed 是不是筛得太严」）：不是严 ✗ 是【没有质量下限】✗
//   实测：候选池 66 条 → 只出 3 条，其中 2 条是 0/1 播放的碎屑 ✓
//   注意：这不是给播放量加权 ✗（那条是主人 10-20 明确否掉的）
//   只是丢掉「几乎无人看过」的：播放<300 且 弹幕<3 ✓
// 2026-10-29（D-31 团队裁决）：收回「多偏好命中 ≥2 免检」的口子 ✗
//   实测被绕过：播放 1 / 弹幕 0 的当日新片命中「白噪音+助眠」照样进来 ✓
//   300/3 是 10-22 已有的规则，这次不新增数值；关注流例外（她订阅的人不算平台碎屑）
//   判定与快照在 tools/lib/feed-quality.mjs（纯函数，可单测）
const dropped = []
const droppedDislike = []
const uniq = [...new Map(pool.map((x) => [x.bv, x])).values()]
  .filter((x) => (ALLOW_SEEN || !seen.has(x.bv)) && !likedBVs.has(x.bv) && !favBVs.has(x.bv))
  .filter((x) => !(selfName && String(x.up ?? "").includes(selfName)))
  .filter((x) => {
    const d = dislikeHit(x.t, dislike)
    if (d) droppedDislike.push({ ...x, _dislike: d })
    return !d
  })
  .filter((x) => {
    const d = keepCandidate(x)
    if (!d.keep) dropped.push(x)
    return d.keep
  })
for (const x of uniq) x._seen = seen.has(x.bv)
const scoreOf = (x) => densityOf(x) * 3 + hitsOf(x.t).length * 4 + boostOf(x.t)
uniq.sort((a, b) => scoreOf(b) - scoreOf(a))
for (const x of uniq) { x._hits = hitsOf(x.t); x._score = scoreOf(x) }

// 多样性：同一"命中和类"最多 PER 条；完全没命中的最多 1 条（防凑数 ✗）
const kindUsed = {}
const diversified = []
for (const x of uniq) {
  const key = x._hits.length ? x._hits.join('+') : '__none__'
  kindUsed[key] = kindUsed[key] ?? 0
  // 2026-10-22：以前「完全没命中偏好的」只留 1 条 ✗
//   实测：66 条候选里绝大多数标题不含偏好词 → 全落进 __none__ → 只放 1 条出来 ✗
//   → 候选池 66 条却只给 3 条 ✓ 现在放到 3 条（配合上面的质量下限，不会进碎屑 ✓）
  if (kindUsed[key] >= (x._hits.length ? PER : 3)) continue
  kindUsed[key] += 1
  diversified.push(x)
}

console.log(`偏好（来自${prefsFrom}）: ${prefs.join(' · ')}`)
console.log(`判断卡（已采纳）: avoid ${judgment.avoid.length} 个词 · prefer ${judgment.prefer.length} 个词${judgment.conflicts.length ? ` · 与你的词表冲突 ${judgment.conflicts.length} 条（按你的来）` : ''}`)
console.log(`反馈回流: 被赞 ${likedEvents.length} 条 · 她收藏 ${favItems.length} 条 · 已发稿 ${sentDrafts.length} 条 → 学会 ${learnedTokens.length} 个主题词`)
console.log(`已看过（日记 ${seenDiary.size} + 评论审计 ${seenAudit.size} + 近 7 天观看记录 ${seenWatched.size} → 去重 ${seen.size} 个 BV）：${ALLOW_SEEN ? '--allow-seen 显式放回，行内标 [已看过]' : '默认排除'}`)
console.log(`候选池: ${pool.length} 条 → ${ALLOW_SEEN ? '去重后' : '去重去已看后'} ${uniq.length} 条（质量下限丢掉 ${dropped.length} 条 · dislike 拦下 ${droppedDislike.length} 条）\n`)
// 池子里**有什么、各多少**：她要回答"是我不喜欢，还是池子里根本没有"。
// 只看名字与条数、不含正文——这不是多看内容，是让她知道供给长什么样（f-74c622）。
{
  const byKw = new Map()
  for (const x of uniq) {
    const k = String(x.kw || '未标注')
    byKw.set(k, (byKw.get(k) ?? 0) + 1)
  }
  const parts = [...byKw.entries()].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`)
  console.log(`池子里的门类（去重后 ${uniq.length} 条）：${parts.length ? parts.join(' · ') : '空'}`)
  // 她要的那几类特别点名：没有也要说没有，别让她自己去猜"是不是被我筛掉了"。
  const want = ['ASMR', '人声', '纯音乐', '钢琴', '助眠']
  const missing = want.filter((w) => !parts.some((p) => p.includes(w)))
  if (missing.length) console.log(`  其中没出现在池子里的：${missing.join('、')}（是供给没有，不是你不喜欢）`)
  if (droppedDislike.length) console.log(`  另：被 dislike 拦下 ${droppedDislike.length} 条（这些进了池子但没给你看）`)
}
if (droppedDislike.length) console.log(`  dislike 命中样例: ${droppedDislike.slice(0, 3).map((x) => `${x._dislike}←「${String(x.t).slice(0, 20)}」`).join(' · ')}`)
console.log(`今天可以看这几条（每词最多 ${PER} 条，共 ${N} 条）：`)
const perKw = {}
let shown = 0
for (const x of diversified) {
  if (shown >= N) break
  perKw[x.kw] = perKw[x.kw] ?? 0
  // 多样性已在上一步做过 → 这里不再二次限流 ✓
  perKw[x.kw] += 1; shown += 1
  console.log(`  ${String(shown).padStart(2)}. ${x.bv}  ${String(x.d).padStart(4)}s  弹幕${String(x.dm).padStart(7)}  播放${String(x.play).padStart(9)}  ${x.t.slice(0, 40)}  @${x.up} ${x._hits.length ? "[" + x._hits.join("+") + "]" : ""}${x._seen ? " [已看过]" : ""}`)
}
console.log('\n看完跑：node bili.mjs debrief <BV>   → 然后把"想法"写进日记的「想说」区（不发）')

// ── 候选快照（2026-10-29 加，D-31 证据缺口）────────────────────────────
//   D-31 吵不清的原因之一：只有"她最后看了什么"，没有"平台给了她什么"。
//   快照只写本地、只读字段（无 cookie/凭据），供 day-report / 复盘查"是不是碎屑"。
try {
  const day = new Date(Date.now()).toLocaleDateString('sv-SE') // 自然日
  const dir = whalePath('bili-whale', 'feed')
  fs.mkdirSync(dir, { recursive: true })
  const rows = [
    ...uniq.map((x, i) => snapshotRow(x, { keep: true, why: keepCandidate(x).why }, i + 1)),
    ...dropped.map((x) => snapshotRow(x, { keep: false, why: keepCandidate(x).why })),
  ]
  const file = path.join(dir, day + '.json')
  fs.writeFileSync(file + '.' + process.pid + '.tmp', JSON.stringify({
    at: new Date().toISOString(), day, prefs, pool: pool.length, kept: uniq.length, dropped: dropped.length,
    judgments: { avoid: judgment.avoid, prefer: judgment.prefer, conflicts: judgment.conflicts }, rows,
  }, null, 1))
  fs.renameSync(file + '.' + process.pid + '.tmp', file)
} catch (e) { console.error(`（候选快照没写成：${String(e.message).slice(0, 80)}）`) }

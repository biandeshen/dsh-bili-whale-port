/**
 * core/api/routes.js —— 宿主无关的路由表（阶段 2 从 index.js 抽出，行为逐字保留）。
 *
 * makeRoutes(deps) 返回 [{ path, handler }]：
 *   · dsh adapter 用 ctx.webServer.register 挂上，并在外层套 requestRejection 信任栅栏；
 *   · whale-panel 用自带 http 服务挂上，外层套 Bearer token + loopback 校验；
 *   · 「她的一天」另加 /api/timeline、/api/diary 两条只读路由（panel 数据源，阶段 4 接通后入表）。
 *
 * deps = { cfgFile, credFile, toolsRoot, home, whaleHome, getSchedStatus, execNode, fetch, onConfigSaved }
 *   · getSchedStatus() → {ok,reason,at}（时钟状态由各宿主自己的 scheduler 上报）
 *   · onConfigSaved(schedulingChanged) → 让宿主把新配置立刻生效（invalidate 计划）
 */
import fs from 'node:fs'
import path from 'node:path'
import { json, readBody, isLoopbackReq, merge, DEFAULTS, KNOWN_CONFIG_KEYS } from './support.js'

const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null } }

export function makeRoutes(deps) {
  const { cfgFile, credFile, toolsRoot, home, whaleHome, getSchedStatus, execNode, onConfigSaved = () => {} } = deps

  const readConfig = () => {
    const user = readJson(cfgFile) ?? {}
    return { ...merge(DEFAULTS, user), __hasUserFile: Object.keys(user).length > 0 }
  }
  const writeConfig = (next) => {
    fs.mkdirSync(path.dirname(cfgFile), { recursive: true })
    fs.writeFileSync(cfgFile, JSON.stringify(next, null, 2) + '\n')
  }
  const credState = () => {
    try {
      const c = JSON.parse(fs.readFileSync(credFile, 'utf8'))
      return { present: true, hasSess: !!c.sessdata, hasJct: !!c.bili_jct, hasBuvid: !!c.buvid3 }
    } catch { return { present: false, hasSess: false, hasJct: false, hasBuvid: false } }
  }
  const resolveBiliMjs = () => readConfig().toolsPath || path.join(toolsRoot, 'tools', 'bili.mjs')

  const PERSONA_FILE = path.join(home, '.bili-ai', 'persona.md')
  const PENDING = path.join(home, '.bili-ai', 'pending-replies.json')

  const guard = (req, res) => {
    if (isLoopbackReq(req) === false) { json(res, 403, { ok: false, error: '只接受本机回环访问' }); return true }
    return false
  }

  const routes = {}

  routes['/dsh-bili/api/settings'] = async (req, res) => {
    if (req.method === 'GET') { json(res, 200, { ok: true, config: readConfig(), credentials: credState(), configPath: cfgFile }); return }
    if (guard(req, res)) return
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    const body = JSON.parse(await readBody(req) || '{}')
    const cur = readConfig()
    delete cur.__hasUserFile
    const incoming = (body && typeof body.config === 'object' && body.config) || body || {}
    const KNOWN = new Set(KNOWN_CONFIG_KEYS)
    const filtered = {}
    for (const [k, v] of Object.entries(incoming)) if (KNOWN.has(k)) filtered[k] = v
    const next = merge(cur, filtered)
    const rotateDays = Number(next.sessionRotateDays)
    if (!Number.isFinite(rotateDays) || rotateDays < 0 || rotateDays > 365 || typeof next.personaOncePerSession !== 'boolean') {
      json(res, 400, { ok: false, error: '会话轮换天数须为 0–365；人设去重须为布尔值' }); return
    }
    next.sessionRotateDays = rotateDays
    const n = next.night
    if (!Array.isArray(n.windows) || !n.windows.length) { json(res, 400, { ok: false, error: '至少要有一个作息窗口' }); return }
    n.maxWakesPerDay = Math.min(12, Math.max(0, Number(n.maxWakesPerDay ?? 0) || 0))
    n.skipChance = Math.min(0.95, Math.max(0, Number(n.skipChance) || 0))
    n.minGapMin = Number.isFinite(Number(n.minGapMin)) ? Math.max(1, Number(n.minGapMin)) : 10
    n.maxVideos = Math.min(20, Math.max(1, Number(n.maxVideos) || 5))
    const sd = Number(next.quota.shareDaily)
    next.quota.shareDaily = Number.isFinite(sd) ? Math.min(20, Math.max(0, sd)) : 3
    writeConfig(next)
    const schedulingChanged = ['windows', 'skipChance', 'maxVideos', 'minGapMin'].some(key => JSON.stringify(cur.night?.[key]) !== JSON.stringify(next.night?.[key]))
    try { onConfigSaved(schedulingChanged) } catch {}
    json(res, 200, { ok: true, config: next, warn: next.quota.shareDaily > 3 ? '分享条数 >3：看起来会像刷量，平台可能限流/封号' : null })
  }

  routes['/dsh-bili/api/cookie'] = async (req, res) => {
    if (guard(req, res)) return
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    const b = JSON.parse(await readBody(req) || '{}')
    const pick = (raw, key) => {
      let v = String(raw ?? '').trim()
      const m = v.match(new RegExp('(?:^|;)\\s*' + key + '=([^;]+)', 'i'))
      if (m) return m[1].trim()
      v = v.replace(new RegExp('^' + key + '\\s*=', 'i'), '')
      v = v.replace(/^["'\s]+|["';\s]+$/g, '')
      return v
    }
    const sessdata = pick(b.sessdata, 'SESSDATA')
    const bili_jct = pick(b.bili_jct, 'bili_jct')
    const buvid3 = pick(b.buvid3, 'buvid3')
    const problems = []
    if (!sessdata) problems.push('SESSDATA 空着（它是 HttpOnly，document.cookie 读不到 ✗ 必须 F12 → Application → Cookies 手动复制）')
    else if (sessdata.length < 20) problems.push('SESSDATA 太短（长度 ' + sessdata.length + '）—— 大概只复制到一半')
    if (!bili_jct) problems.push('bili_jct 空着')
    else if (!/^[0-9a-fA-F]{32}$/.test(bili_jct)) problems.push('bili_jct 格式不对（长度 ' + bili_jct.length + '，B站 目前是 32 位十六进制）—— 可能复制截断，或粘到了别的字段')
    const buvid3LooksOdd = buvid3 && !/^[0-9A-Za-z]{6,}-[0-9A-Za-z-]{18,}$/.test(buvid3)
    if (problems.length) {
      json(res, 400, {
        ok: false,
        error: '凭据有问题，没写入：\n  · ' + problems.join('\n  · ') +
          '\n\n正确做法：浏览器打开 bilibili.com → F12 → Application（应用）→ Cookies → https://www.bilibili.com' +
          '\n逐个双击 Value 复制（SESSDATA 和 bili_jct 两个都要）✓ 别用 document.cookie ✗',
      })
      return
    }
    fs.mkdirSync(path.dirname(credFile), { recursive: true })
    fs.writeFileSync(credFile, JSON.stringify({ sessdata, bili_jct, buvid3 }, null, 2) + '\n')
    try { fs.chmodSync(credFile, 0o600) } catch {}
    let whoNow = null, navCode = null, navMsg = '', navErr = null
    try {
      const navRes = await deps.fetch('https://api.bilibili.com/x/web-interface/nav', {
        headers: { 'user-agent': 'Mozilla/5.0', referer: 'https://www.bilibili.com/', cookie: `SESSDATA=${sessdata}; bili_jct=${bili_jct}; buvid3=${buvid3}` },
      })
      const navJson = await navRes.json().catch(() => ({}))
      navCode = navJson?.code ?? null
      navMsg = String(navJson?.message ?? '')
      if (navJson?.data?.isLogin && navJson.data.mid) {
        whoNow = { mid: String(navJson.data.mid), name: String(navJson.data.uname ?? '') }
        const cur = readConfig()
        writeConfig({ ...cur, self: whoNow })
      }
    } catch (e) { navErr = String(e?.message ?? e).slice(0, 120) }
    json(res, 200, {
      ok: true,
      warn: buvid3LooksOdd ? '⚠️ buvid3 格式有点怪（不影响使用，想要的话重新复制一次）' : null,
      detail: whoNow
        ? `已写入 ✓ 当前登录：${whoNow.name}（mid ${whoNow.mid}）`
        : '已写入，但 B站 不认这个 cookie ✗'
          + (navCode != null ? `（nav 返回 code=${navCode}${navMsg ? ' ' + navMsg : ''}）` : '')
          + (navErr ? `（请求失败：${navErr}）` : '')
          + ' —— 最常见两个原因：\n  · SESSDATA 复制时截断了（它很长，双击 Value 全选再复制）\n  · 复制自别的浏览器 / 无痕窗口，已经失效\n  重新打开 bilibili.com 复制一次【SESSDATA 和 bili_jct 两个都重抄】✓',
      self: whoNow,
    })
  }

  routes['/dsh-bili/api/persona'] = async (req, res) => {
    if (guard(req, res)) return
    if (req.method === 'GET') {
      let text = ''
      try { text = fs.readFileSync(PERSONA_FILE, 'utf8') } catch {}
      let updatedAt = null
      try { updatedAt = fs.statSync(PERSONA_FILE).mtime.toISOString() } catch {}
      json(res, 200, { ok: true, text, bytes: Buffer.byteLength(text, 'utf8'), updatedAt })
      return
    }
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    const b = JSON.parse(await readBody(req) || '{}')
    const text = String(b.text ?? '')
    if (text.length > 20000) { json(res, 400, { ok: false, error: '太长（上限 20000 字），人设不用写论文 ✗' }); return }
    try {
      fs.mkdirSync(path.dirname(PERSONA_FILE), { recursive: true })
      fs.writeFileSync(PERSONA_FILE, text, 'utf8')
      try { fs.chmodSync(PERSONA_FILE, 0o600) } catch {}
    } catch (e) { json(res, 500, { ok: false, error: '写入失败：' + String(e?.message ?? e).slice(0, 120) }); return }
    const bytes = Buffer.byteLength(text, 'utf8')
    json(res, 200, {
      ok: true, bytes,
      detail: text.trim() ? '✓ 已注入（' + bytes + ' 字节）—— 从下一次唤醒开始生效 ✓' : '✓ 已清空 —— 她回到只有「设置里的人设」那几行 ✓',
    })
  }

  routes['/dsh-bili/api/deps'] = async (req, res) => {
    const cfg = readConfig()
    const tools = cfg.toolsPath || path.join(toolsRoot, 'tools', 'bili.mjs')
    if (!fs.existsSync(tools)) {
      json(res, 200, { ok: false, error: `找不到 bili.mjs：${tools}（在设置里填「工具目录」）`, items: [], scheduler: getSchedStatus() })
      return
    }
    execNode([tools, 'deps', '--json'], { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      try {
        const parsed = JSON.parse(String(stdout || '{}'))
        let selfNow = null
        try {
          const ck = (parsed.items ?? []).find((it) => it.name === 'B站 cookie')
          const m = String(ck?.detail ?? '').match(/已登录：(.+?)（mid (\d+)）/)
          if (m) {
            selfNow = { name: m[1], mid: m[2] }
            const cur = readConfig()
            if (String(cur.self?.mid ?? '') !== selfNow.mid || String(cur.self?.name ?? '') !== selfNow.name) writeConfig({ ...cur, self: selfNow })
          }
        } catch {}
        let selftestPassed = false
        try { selftestPassed = fs.existsSync(path.join(home, '.bili-ai', 'selftest-passed.json')) } catch {}
        json(res, 200, { ok: !!parsed.ok, items: parsed.items ?? [], node: parsed.node, self: selfNow, selftestPassed, scheduler: getSchedStatus() })
      } catch {
        json(res, 200, { ok: false, error: String(stderr || err?.message || 'deps 跑失败').slice(0, 300), items: [] })
      }
    })
  }

  routes['/dsh-bili/api/pending'] = async (req, res) => {
    if (guard(req, res)) return
    let items = []
    try { items = JSON.parse(fs.readFileSync(PENDING, 'utf8')).items ?? [] } catch {}
    json(res, 200, { ok: true, items })
  }

  routes['/dsh-bili/api/pending/reject'] = async (req, res) => {
    if (guard(req, res)) return
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    const b = JSON.parse(await readBody(req) || '{}')
    const id = String(b.id ?? '')
    if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
    execNode([resolveBiliMjs(), 'reply-draft', 'drop', id], { timeout: 20000, windowsHide: true }, (err, stdout) => {
      if (!err) {
        try {
          fs.appendFileSync(path.join(whaleHome, 'whale-log.jsonl'),
            JSON.stringify({ at: new Date().toISOString(), kind: 'reply-rejected', target: null, note: `主人否掉了草稿 ${id}${b.reason ? '：' + String(b.reason).slice(0, 80) : ''}` }) + '\n')
        } catch {}
      }
      json(res, 200, { ok: !err, out: String(stdout ?? '').slice(0, 300) })
    })
  }

  routes['/dsh-bili/api/pending/approve'] = async (req, res) => {
    if (guard(req, res)) return
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    const b = JSON.parse(await readBody(req) || '{}')
    const id = String(b.id ?? '')
    if (!id) { json(res, 400, { ok: false, error: '需要 id' }); return }
    const bili = resolveBiliMjs()
    let cfgNow = {}
    try { cfgNow = readConfig() } catch {}
    execNode([bili, 'reply-draft', 'take', id], { timeout: 20000, windowsHide: true }, (err, stdout) => {
      let item = null
      try { item = JSON.parse(String(stdout ?? '')) } catch {}
      if (!item) { json(res, 400, { ok: false, error: '队列里没有这条（可能已经发过）' }); return }
      // go-gate 项：重放原始 argv 并补 --go（普通评论/收藏/弹幕统一走待审）
      if (item.argv) {
        execNode([bili, ...item.argv, '--go'], { timeout: 120000, windowsHide: true }, (e2, out2, err2) => {
          const text = String(out2 ?? '')
          const ok = !e2 && /code=0/.test(text)
          try { fs.appendFileSync(path.join(whaleHome, 'whale-log.jsonl'), JSON.stringify({ at: new Date().toISOString(), kind: ok ? 'reply-sent' : 'reply-failed', target: item.who, note: `${ok ? '主人放行' : '发送失败'} · ${item.kind} · ${String(item.message).slice(0, 60)}` }) + '\n') } catch {}
          json(res, 200, { ok, out: text.slice(-600), err: String(err2 ?? '').slice(0, 400) })
        })
        return
      }
      const args = ['comment', '--oid', item.oid, '--root', item.root, '--parent', item.parent,
        '--message', item.message, '--auto', ...(cfgNow.listen?.oncePerPerson !== false ? ['--once-per-person'] : []), '--go']
      if (item.bvid) args.push('--bvid', item.bvid)
      execNode([bili, ...args], { timeout: 120000, windowsHide: true }, (e2, out2, err2) => {
        const text = String(out2 ?? '')
        const ok = !e2 && /code=0/.test(text)
        const rpid = (text.match(/rpid=(\d+)/) ?? [])[1] ?? null
        try {
          fs.appendFileSync(path.join(whaleHome, 'whale-log.jsonl'),
            JSON.stringify({ at: new Date().toISOString(), kind: ok ? 'reply-sent' : 'reply-failed', target: item.who || item.parent, note: `${ok ? '主人批准并发出' : '发送失败'} · ${String(item.message).slice(0, 60)}` }) + '\n')
        } catch {}
        if (!ok) {
          try {
            const back = ['reply-draft', 'add', '--oid', item.oid, '--message', item.message]
            if (item.bvid) back.push('--bvid', item.bvid)
            if (item.root) back.push('--root', item.root)
            if (item.parent) back.push('--parent', item.parent)
            if (item.who) back.push('--who', item.who)
            if (item.src) back.push('--src', item.src)
            execNode([bili, ...back], { timeout: 20000, windowsHide: true }, () => {})
            console.error('[pending/approve] 发送失败，草稿已放回队列：' + id)
          } catch (e) { console.error('[pending/approve] 放回草稿也失败：' + e.message) }
        }
        json(res, 200, { ok, rpid, out: text.slice(-600), err: String(err2 ?? '').slice(0, 400) })
      })
    })
  }

  routes['/dsh-bili/api/notify-test'] = async (req, res) => {
    if (guard(req, res)) return
    if (req.method !== 'POST') { json(res, 405, { ok: false }); return }
    const cfg = readConfig()
    const tools = cfg.toolsPath || path.join(toolsRoot, 'tools', 'bili.mjs')
    const notifyMjs = path.join(path.dirname(tools), 'commands', 'notify.mjs')
    if (!fs.existsSync(notifyMjs)) { json(res, 200, { ok: false, error: `找不到 notify.mjs：${notifyMjs}` }); return }
    execNode([notifyMjs, '--test'], { timeout: 60_000, windowsHide: true }, (err, stdout, stderr) => {
      json(res, 200, { ok: !err, out: String(stdout ?? '').slice(0, 800), err: String(stderr ?? '').slice(0, 800), type: cfg.notify?.type ?? 'none' })
    })
  }

  routes['/dsh-bili/api/status'] = async (req, res) => {
    const quota = readJson(path.join(home, '.bili-ai', 'quota.json')) ?? { log: [] }
    const today = new Date().toLocaleDateString('sv-SE')
    const todays = (quota.log ?? []).filter((x) => new Date(x.at).toLocaleDateString('sv-SE') === today)
    const night = readJson(path.join(whaleHome, 'whale-night.json'))
    const replied = readJson(path.join(home, '.bili-ai', 'replied.json'))
    json(res, 200, {
      ok: true, today,
      shares: todays.filter((x) => x.share).length,
      sharesMax: readConfig().quota?.shareDaily ?? 3,
      commentsToday: todays.length,
      repliedPeople: Object.keys(replied?.byUid ?? {}).length,
      plan: night ? { date: night.date, action: night.action, atText: night.atText ?? null, wakes: Number(night.wakes ?? 0), windows: night.usedWindows ?? [] } : null,
    })
  }

  return { routes, readConfig, writeConfig }
}

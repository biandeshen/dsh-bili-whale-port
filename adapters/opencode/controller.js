/**
 * opencodeController —— AgentSessionPort 的 OpenCode 实现（零依赖，裸 HTTP）。
 *
 * 对应关系（官方 server API：opencode serve，OpenAPI 见 /doc）：
 *   create({sessionId})  → POST /session                 （server 自己生成 id，返回之；
 *                          session-delivery 轮换时传入的 uuid 被忽略，语义同桌面宿主：
 *                          create() 返回 { sessionId }，分不出新建/复用）
 *   prompt(request)      → POST /session/:id/prompt_async （204 立即返回；她干活不阻塞时钟）
 *   isBusy()             → GET  /session/:id 的 status    （端口可选项；缺省时 core 用冷却兜底）
 *
 * 鉴权：OPENCODE_SERVER_PASSWORD 走 Basic（opencode serve 默认无密码，建议部署时设置）。
 * 若想改用官方 @opencode-ai/sdk：把下面的 fetch 换成 client.session.* 即可，接口形状一致。
 */
export function createOpenCodeController({ baseUrl = process.env.OPENCODE_BASE_URL || 'http://127.0.0.1:4096', password = process.env.OPENCODE_SERVER_PASSWORD || '', fetchFn = globalThis.fetch } = {}) {
  const headers = { 'content-type': 'application/json' }
  if (password) headers.authorization = 'Basic ' + Buffer.from(`opencode:${password}`).toString('base64')
  async function req(method, p, body) {
    const r = await fetchFn(baseUrl + p, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30_000) })
    if (!r.ok && r.status !== 204) {
      const t = await r.text().catch(() => '')
      throw new Error(`opencode server ${method} ${p} → HTTP ${r.status} ${t.slice(0, 160)}`)
    }
    return r
  }
  return {
    kind: 'opencode',
    async create({ sessionId: _ignored, cwd }) {
      const r = await req('POST', '/session', { title: 'bili-whale', cwd })
      const j = await r.json().catch(() => ({}))
      if (!j?.id) throw new Error('opencode POST /session 未返回会话 id')
      return { sessionId: j.id }
    },
    async prompt({ sessionId, content }, _signal) {
      await req('POST', `/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        parts: content.map((c) => ({ type: 'text', text: c.text ?? String(c) })),
      })
    },
    async isBusy({ sessionId }) {
      try {
        const r = await req('GET', `/session/${encodeURIComponent(sessionId)}`)
        const j = await r.json().catch(() => ({}))
        return j?.status === 'busy' || j?.status === 'working'
      } catch { return false }
    },
  }
}

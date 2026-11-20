# WebUI 写接口的同源防护：现状、缺口与正确修法（2026-11-20）

## 一、背景：一个真实事故

2026-11-01 01:23，**本机一个不带 `Origin` 头的盲 POST** 把
`publish.draftMode` 从 `review` 改成了 `auto`——那一格决定她能不能自己往外发。

根因：上游的同源闸门（`isForeignOrigin`）对"**没有 Origin 头**"是**放行**的：

```ts
function isForeignOrigin(origin, hostHeader, allowedHosts) {
  if (typeof origin !== 'string' || origin === '') return false;   // ← 缺 Origin = 不是外人
  ...
}
```

而 curl / Node / Python **根本不发 `Origin` 头**。所以本机任何进程都能盲改她的配置。

## 二、我们曾怎么处理，以及为什么那条路不能走

我们曾加过一道中间件（提交 `08d6c2d`，"改她人生的写接口只认浏览器同源请求"）：

```js
const LIFE_CONFIG_WRITE = /^\/api\/(config|prompts(#)?|extensions\/(install|...)|worlds\/(activation|restart)|webui\/)/
app.use((req, res, next) => { /* 无 Origin 的配置写 → 403 */ })
```

**它是有效的，但它在宿主源码里。** 2026-11-20 把宿主恢复成纯上游时，这段被一并 revert 了
（`950118c`）——这是清理时的失误：把一个**安全修复**当成了"我们的功能"删掉。

实测确认：**上游 HEAD 里没有这段**（`grep -c isLifeConfigWrite` = 0）。

> 结论：宿主源码里不留我们的任何改动，包括安全加固。
> 否则一次 `git pull` 就回到"魔改版本"，这正是要避免的。

## 三、正确修法：用上游自带的能力，不改一行代码

上游本来就有**第四道闸**——WebUI 访问密码：

```ts
// src/web/auth.ts
get enabled(): boolean { return this.password !== ''; }

// src/web/server.ts:1261
private authorized(req) {
  return !this.auth.enabled || this.auth.verify(cookieValue(req.headers.cookie, SESSION_COOKIE));
}

// 全局中间件（src/web/server.ts 约 :1655）
app.use((req, res, next) => {
  if (this.authorized(req)) { next(); return; }
  if (req.method === 'GET' && (req.path === '/' || req.path === '/index.html')) { this.serveLogin(res); return; }
  res.setHeader(WEBUI_AUTH_HEADER, 'required');
  res.status(401).json({ error: ... loginRequired });
});
```

**它是全局的**：只要密码非空，所有未登录请求一律 401 —— 包括那个盲 POST。
比我们原来那道"只拦配置写"的中间件**覆盖更宽**。

### 实测（跑的是上游真实代码，不是读文档）

```
没设密码时 enabled = false   → 盲 POST 会通过（这就是那个洞）
设了密码后 enabled = true
无 Cookie 的 verify("") = false    → 未登录 401
密码正确 login() = true
签发 token 后 verify(token) = true → 登录后放行
密码错误 login() = false
```

复现方式：用宿主检出的 `tsx` 直接 new 一个 `WebUiAuth` 跑上面五步。

## 四、当前状态（2026-11-20 21:0x 实测）

| 检查项 | 结果 |
|---|---|
| 部署 `~/.xiaoyu-home/xiaoyu/.env` | 存在，**未设** `CORTICO_WEB_PASSWORD` |
| `config.json` 的 `web` 段 | `{"port":7798}`，**无 password** |
| 7799 端口 | **没在监听**（暴露面为零） |

**结论：洞还在，但现在没人能碰**——实例没跑。所以不必急着改线上。

## 五、什么时候必须开，怎么开

**开启时机**：下次真正启动她（7799 起来）之前。一旦 WebUI 在监听，"本机任何进程盲改配置"就成立。

**开法**（二选一，零代码）：

```bash
# ① 部署 .env（推荐，不进 Git）
echo 'CORTICO_WEB_PASSWORD=<一串随机字符>' >> ~/.xiaoyu-home/xiaoyu/.env

# ② 或略 写进 config.json 的 web.password
```

重启生效（启动时读一次）。

**代价（上游文档 `docs/WEBUI-AUTH-2026-11.md` 已写明）**：

- 每次开控制台要走登录页；令牌不过期，改密码或登出才失效
- 两条工具链脚本（resume / shutdown）要先 `POST /api/auth/login` 拿 Cookie；
  它们本来就能读同一份 `.env`
- 明文 HTTP 下密码与 Cookie 在途中可读；公网使用要放在终结 HTTPS 的反向代理后面

## 六、Topology 提示（这条容易看错）

`worlds.console.pin` **不是**接口认证。它只是消息正文里的标记串
`[console|PIN:xxxxxx]`，给 Persona 与操作员认"这条来自哪台控制台"用；
HTTP 层没有任何地方读它。六位数字不设到期、也不参与请求校验。

## 七、遗留判断（不做的部分）

- **不往宿主源码打补丁**：一次 `git pull` 就没了，且把宿主变成魔改版。
- **不做扩展层的中间件**：宿主没有给扩展暴露请求钩子
  （`BotDefinition` / `WorldDefinition` / `WorldContext` 都没有；`CognitionRequest` 是认知接口，不是 HTTP）。
- **密码挡不住同机进程**：同机进程可以先 `GET /` 再带 `Origin`，也拿得到别的信息。
  上游文档明确说"这不是安全边界"。它挡的是**不带 Origin 的盲写**——也就是 11-01 那次事故的形态。

## 八、复现与验收

```bash
# 验证密码机制真的生效（用宿主自己的 tsx 跑上游真实类）
# → 输出应当是：没密码 enabled=false；有密码 enabled=true；verify("")=false；login 正确 true / 错误 false

# 验证上游确实没有我们那道中间件
grep -c isLifeConfigWrite host/cortico/src/web/server.ts   # 应为 0

# 验证当前部署没设密码
grep -c CORTICO_WEB_PASSWORD ~/.xiaoyu-home/xiaoyu/.env     # 应为 0
grep -c password ~/.xiaoyu-home/xiaoyu/config.json          # 应为 0（或只在无关位置）
```

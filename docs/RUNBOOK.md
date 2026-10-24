# RUNBOOK —— 给 AI 执行的真机部署手册

> 目标读者：接手的 AI/工程师。**每一步先验证再操作**；遇到 `✗` 停下报告，不要猜。
> 禁止：调大轮询/预算、把 panel 暴露公网、向公开仓库推送、删除 `~/.bili-ai` 或日记。
> 需要用户操作的点标【人工】；其余可由 AI 执行。

## 0. 开场自检（AI 先跑）

```bash
cd <repo>
git status -sb                 # 必须无未提交改动；默认分支 port/core-opencode-panel
npm test                       # 期望 122/122
node scripts/preflight.mjs     # 期望无 ✗；OpenCode 部署加 OPENCODE_WANTED=1
```

判据：`git log -1` 含 `feat(deploy)` 或更新；测试非 122 立即停止并报告。

## 1. DSH 部署（需 DSH 桌面端）

1. 【人工】确认 DSH 已安装并能打开；版本对应 0.4.6 宿主能力。
2. 安装：`dsh plugin --profile desktop add link:<repo 绝对路径>`
3. 【人工】打开 DSH → 设置 → 养鱼：
   - 点「保存」一次（生成 `~/.dsh/bili-whale.config.json`）
   - 填「主人 mid」；写 cookie（SESSDATA 必须 F12 → Application → Cookies 手动复制）
4. AI 验证（只读）：
   ```bash
   node tools/commands/deps.mjs --json          # 期望 items 全 ok
   cat ~/.dsh/whale-night.json                  # 看 action/atMs
   tail -n 20 ~/.dsh/whale-log.jsonl 2>/dev/null
   ```
5. 成功证据：`/deps` 里 `scheduler.ok=true`；窗口内出现 `已投递 wake`；`whale-diary.md` 更新。
6. 失败处置：
   - scheduler.ok=false → 读 `reason`；多为找不到 node（设 `DSH_NODE` 指向真实 node.exe）。
   - 设置页 404 → `cordis.patch.yml` 的 `name` 必须等于包名 `dsh-bili-whale`。

## 2. whale-panel

```bash
node panel/server.js --port 8447
# 输出里含 http://127.0.0.1:8447/?t=<token>；token 也在 <WHALE_HOME>/panel.token
```

【人工】浏览器打开 `?t=` 链接，验收：
- 鱼缸出现鲸鱼娘序列帧（网络请求应带 `?t=`；失败自动回到 SVG）
- 「养鱼设置」改一项 → 保存 → 刷新仍在
- 「发条测试推送」按配置的 ntfy/bark/webhook 到达
- 待审草稿：**只放行测试内容**，避免真发到 B 站

AI 验证：`curl -s http://127.0.0.1:8447/api/vitals -H "authorization: Bearer <token>"`，期望 `ok:true`；无 token 期望 503。
远程访问：**只用 SSH 隧道** `ssh -L 8447:127.0.0.1:8447 <host>`；不要改绑 0.0.0.0。

## 3. OpenCode

1. `opencode serve --port 4096`，并设置 `OPENCODE_SERVER_PASSWORD`（daemon 用 Basic）。
2. 在 `~/.config/opencode/opencode.json` 注册 MCP：
   ```jsonc
   { "mcp": { "bili": { "type": "local",
     "command": ["node", "<repo>/adapters/opencode/mcp-stdio.js"], "enabled": true } } }
   ```
3. 分离 home（**不要与 DSH 共用**，否则抢 `whale-night/whale-session`）：
   ```powershell
   set WHALE_HOME=%USERPROFILE%\.whale-opencode
   set BILI_WHALE_CONFIG=%WHALE_HOME%\bili-whale.config.json
   set OPENCODE_WANTED=1
   node scripts/preflight.mjs
   ```
   把 DSH 的配置与 `~/.bili-ai` 拷过来（凭据按 OS 用户共享即可）。
4. 起时钟：`pm2 start adapters/opencode/daemon.js --name whale`；`pm2 logs whale --lines 50`
5. 【人工】通过 `scripts/evaluate.sh full` 的清单等到一个窗口，验收：
   - `prompt_async` 被 server 接收（server 日志/事件）
   - agent 调 `bili` 工具完成 feed/私信
   - `node tools/bili.mjs traffic status` 显示预算扣减
   - 日记/事件流更新
6. 失败处置：投递 404 → 检查是否采纳 `ses_*`（本仓库已修）；tick 不跑 → 是否误传异步 `isBusy`（已修）；连不上 → `OPENCODE_BASE_URL`/密码。
7. 回滚：`pm2 stop whale`；计划状态保留，重启自动补觉。

## 4. 手机 Termux（可选）

按 [TERMUX.md](TERMUX.md)。AI 只做只读核对：`node -v`、`WHALE_HOME` 是否独立、`pm2 list` 是否只有 whale、`curl 127.0.0.1:8447` 是否 401/200。
【人工】装 Termux(F-Droid)、Termux:Boot、ntfy App；确认只跑一个时钟。

## 5. 统一验收证据（交给 AI 汇总）

```bash
git log -1 --oneline
npm test | tail -3
node scripts/preflight.mjs --json
node tools/bili.mjs traffic status
node tools/commands/whale-night.mjs status
tail -n 5 "$WHALE_HOME/whale-log.jsonl"
```
期望：测试 122 全过；preflight ok；traffic 有余量；night 有 today 计划；log 有 wake/reply 事件。

## 6. 故障速查

| 现象 | 先查 | 处理 |
|---|---|---|
| 面板空白/无鱼 | 浏览器 Network 里 png 是否 503/403 | 确认 URL 带 `?t=`；token 是否最新 |
| 设置保存 503 | 是否带 Bearer | 用面板页面操作，勿手写无 token 的 curl |
| 时钟不醒 | `/api/vitals.scheduler.ok`、`whale-night.json` | 检查 DSH_NODE/WHALE_NODE；窗口与时间 |
| 投递 404 | 会话 id | 确认分支 ≥ `b688e8a`（采纳 ses_* 修复） |
| 412/429 | traffic status | 等熔断，别重试；默认值勿调大 |
| 重复唤醒 | 是否两个时钟 | 停掉 panel `PANEL_SCHED` 或 daemon 其一 |
| push/pull 超时 | 网络 | 重试；或配 SSH-443（需人工加 key） |

## 7. 给 AI 的启动指令（可直接粘贴）

> 你接手 dsh-bili-whale 移植版（仓库 `<repo>`，分支 port/core-opencode-panel）。先读 docs/CURRENT.md 与 docs/DEPLOY.md，再按 docs/RUNBOOK.md 执行：先跑第 0 节自检并把结果贴给我；任何 `✗` 停下说明原因。只做当前阶段，不调大风控参数、不暴露公网、不向公开仓库推送；需要我人工操作的步骤先告诉我再等确认。

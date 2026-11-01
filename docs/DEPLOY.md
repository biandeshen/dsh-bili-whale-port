# 真机部署清单（DSH / OpenCode / 面板 / 手机）

> 预检先行：`node scripts/preflight.mjs`（OpenCode 部署加 `OPENCODE_WANTED=1`）。`✗` 不解决不要上线。

### 最快路径：双击 setup.cmd

自动完成：建配置 → 合并 OpenCode MCP（备份原文件）→ 起 opencode serve（密码存 `WHALE_HOME/.opencode-password`）→ 起面板；**有 cookie 才启动时钟**（避免空烧 token）。填完 cookie 后重跑一次即可。

# 共同前提

```bash
node scripts/run-mjs-tests.mjs  # 全量回归：判据是 fail 0（本文 2026-11-01 复跑 321 pass / 0 fail / EXECUTED=60；条数随提交变化）
node scripts/preflight.mjs    # 节点/凭据/风控/端口/推送/OpenCode
```

- 一个 home 只跑**一个时钟**：DSH 用 `~/.dsh`，OpenCode 用 `~/.whale-opencode`，手机用 `~/.whale`。
- 凭据只写入一次：panel「B 站 cookie」；`SESSDATA` 必须 F12 手动复制。
- 风控默认值不要调大；新号先读 README 顶部警告。

## A. DSH

1. `dsh plugin --profile desktop add link:E:\WorkSpace_Qoder\dsh-bili-whale`
2. 设置 → 养鱼：保存一次；`依赖体检` 全绿；写入 cookie。
3. 给她的会话「完全访问」权限，并在 工作区→未分组 里能找到。
4. 证据：`/deps` 的 scheduler.ok=true；到窗口后 `whale-log.jsonl` 出现 wake；日记更新。

## B. OpenCode

1. `opencode serve --port 4096`，设置 `OPENCODE_SERVER_PASSWORD`。
2. `opencode.json` 注册 MCP（见 `adapters/opencode/README.md`）。
3. `set WHALE_HOME=%USERPROFILE%\.whale-opencode`，`OPENCODE_WANTED=1 node scripts/preflight.mjs`。
4. `pm2 start adapters/opencode/daemon.js --name whale`。
5. 证据：server 会话收到 `prompt_async`；agent 调 `bili` 工具；`node tools/bili.mjs traffic status` 预算扣减。

## C. 面板

> **先看现行界面**：日常用的是 Cortico WebUI 的「小鱼 · 鱼缸」世界页 `http://127.0.0.1:7799/#/provider/world%3Abili-account`（7 块页签，含待审稿 ✓放行/✗拒掉）。`panel/server.js` 的 8447/8448 端口**已退役**（`docs/CURRENT.md` 2026-10-31 条目、`docs/ARCHITECTURE-2026-11.md` §4），下面是遗留调试路径，只在你确实要单独起它时才做。

1. `node panel/server.js --port 8447`，浏览器打开日志里的 `?t=` 链接（token 也在 `WHALE_HOME/panel.token`）。
2. 默认只绑 127.0.0.1；远程用 Tailscale **不行**（loopback 校验）→ 用 SSH 隧道：`ssh -L 8447:127.0.0.1:8447 <host>`。
3. 改一次设置 → 「发条测试推送」→ 待审草稿里放行一条（会真实发出，注意别点到测试视频）。
4. 鲸鱼娘：manifest 可读则显示序列帧（`?t=` 必须自动带上）；资产加载失败应自动回到 SVG。

## D. 手机（Termux）

按 [TERMUX.md](TERMUX.md)：F-Droid Termux → node/pm2/opencode → `WHALE_HOME=~/.whale` → ntfy → Termux:Boot → `termux-wake-lock`。

## 回滚

- 停时钟：`pm2 stop whale` / DSH 里禁用插件。
- 恢复计划：`node tools/commands/whale-night.mjs plan` 或面板改一次作息触发重算。
- 误发：`comment-del` 删评论；私信无法撤回（默认只发主人，风险低）。

# CURRENT —— 工作恢复入口（移植工程）

> 惯例借鉴 AMpath：新会话/新机器从这里接上，不用翻聊天记录。

## 现在到哪了

- 分支 `port/core-opencode-panel`，4 个检查点提交（阶段0-2 / 阶段2 / 阶段3 / 阶段4）。
- `npm test` **122/122 绿**（上游 110 + 快照回归 + 路由契约 + OpenCode adapter 契约 + panel e2e）。
- 已完成：core 化、AgentSessionPort、WHALE_HOME/WHALE_NODE、notify ntfy/bark、tick-catchup、路由抽取、OpenCode adapter（daemon+MCP）、whale-panel（含鱼缸视图）。
- 未完成（按计划顺序）：
  1. client.js 的 schema/render 拆分（当前面板用 JSON 编辑器替代；DSH 设置页未动、回归全绿）
  2. CodeBuddy adapter（二期；`@tencent-ai/agent-sdk` `query({resume})` 已调研）
  3. 真机端到端：DSH 装载冒烟 + opencode serve 真投递（需要用户操作）
  4. 视觉打磨：md→tokens.css 管道、鲸鱼娘多帧状态机（现单帧+闭眼/昼夜）

## 一分钟接上

```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale
npm test                         # 全量回归
node scripts/preflight.mjs        # 部署预检（凭据/风控/端口/OpenCode）
bash scripts/evaluate.sh quick   # 快速验收剧本
# 真机上线按 docs/DEPLOY.md 走；交给 AI 执行用 docs/RUNBOOK.md
node panel/server.js --port 8447 # 鱼缸面板（浏览器打开启动日志里的 ?t= 地址）
node adapters/opencode/daemon.js --once   # 时钟冒烟（窗口外应零投递）
```

## 约定

- **行为冻结**：改调度/预算/路由前先对 `docs/BASELINE.md`；快照不一致必须 `--update` 并在提交信息说明原因。
- **凭据**：只进 `~/.bili-ai/`，任何端点不回显；panel 默认 127.0.0.1 + token，禁外暴（远程走 Tailscale）。
- **AMpath 借用**：私有仓库、无 LICENSE——只搬了纯函数与契约思路，**发布前必须移除 `core/ports/temporal.mjs` 的注释外引用并自查**。
- **上游纪律**：写操作仍强制 `--dry/--go`；MCP 包装层不得绕过 `tools/bili.mjs`。

## 文件地图

```
core/            scheduler/session-delivery/api（宿主无关）
core/ports/      temporal（AMpath 移植件）
adapters/opencode/  daemon.js controller.js mcp-stdio.js（接入见其 README）
panel/           server.js auth.js data.js views/tank.html
tools/           40 个 B 站命令 + traffic 风控（未动契约）
tests/contract/  路由/panel 契约；tests/scheduler-snapshot.test.mjs 行为快照
docs/            BASELINE.md / TERMUX.md
```

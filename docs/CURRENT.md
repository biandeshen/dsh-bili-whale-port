# CURRENT —— 工作恢复入口（移植工程）

> 惯例借鉴 AMpath：新会话/新机器从这里接上，不用翻聊天记录。
> **架构与能力清单看 [BLUEPRINT.md](./BLUEPRINT.md)（唯一真相源）**；本文件只记"现在到哪、怎么起来"。

## 现在到哪了

- **2026-10-29：D0 完成。** Cortico 已 `git init`（`3e8ccd5`，1164 文件，无密钥入库）；`days/<D>/` 快照 + append-only ticks + `day-report` 已可用；看门狗已常驻并注册 HKCU 自启（`WhaleDayWatchdog`）；`draft-dynamic` 读不到日记现在**显式失败**并记录 `diaryHash`；`npm test` 改为动态发现（23 文件 / 145 测试）。执行记录：`evidence/D0-2026-10-29.md`；排期：`ROADMAP-2026-10-29.md`。
- **2026-10-29：D1 完成。** `buildText` 能取真实日记的 BV 标题、保留全部「想说」bullet；`readMood` 补 `action` 成因、阈值 0.25→0.2，真实场值从恒「平静」变为「轻快」。`npm test` 147/147、World 11/11、`tsc` 0、drill 33/33。记录：`evidence/D1-2026-10-29.md`。下一步 D2：`buildVoiceBrief` + `voice.schema.json` + `buildText` 必填 voice。

- **2026-10-27：宿主已统一到 Cortico。** DSH 插件的时钟在本机停用（`clock.enabled=false` + `night.windows=[]`，面板与 `/deps` 仍在）；HKCU `WhaleDraft`（21:30 nightly-scheduler）已删除。Cortico World 改为**状态驱动的醒/睡**（无固定 21:40；无聊/想他/累 + 抖动决定，单日 ≤3 次，冷战/连续失约会自动收敛），见 `Cortico/persona-core/src/rhythm.ts` 与 `docs/CORTICO-PATCHES.md` 第 11 条。
- 分支 `port/core-opencode-panel`，4 个检查点提交（阶段0-2 / 阶段2 / 阶段3 / 阶段4）。
- `npm test` **145/145 绿**；drill **33/33**；persona-core 单测 **17**；World 单测 **10**；`tsc --noEmit` 0 错。（数字每次改动都要重跑，别抄这里）
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

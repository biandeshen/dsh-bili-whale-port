# PR: port — core + OpenCode adapter + whale-panel（含三轮团队评审修复）

> 分支 `port/core-opencode-panel` ← 基于上游 `3e11454`（0.4.6）。范围：把 DSH 专用插件改造成多宿主可插拔结构，并补回独立管理界面。**不含** CodeBuddy adapter 与真机端到端。

## 变更概要

| 领域 | 内容 |
|---|---|
| 结构 | `lib/` → `core/`；新增 `adapters/dsh`（逻辑上，路由抽取）、`adapters/opencode`、`panel/`；路由抽为宿主无关 `core/api/routes.js` |
| 端口 | `AgentSessionPort`：`create/prompt/isBusy`，scheduler 改收 `{controller,isBusy}`；采纳 `create()` 返回的宿主会话 id |
| 可移植 | `WHALE_HOME`/`WHALE_NODE` 双读（`DSH_HOME` 兼容）；唤醒提示词按宿主切换 `node bili.mjs` ↔ `bili` 工具；tick-catchup 补觉留痕 |
| 推送 | `notify` 新增 `ntfy`/`bark`（https/局域网校验），设置页同步 |
| OpenCode | `whale-daemon`（pm2/`--once`）+ 40 命令 MCP 包装（白名单只进 `tools/bili.mjs`）+ 接入 README |
| panel | 独立 http 服务，Bearer token fail-closed；`/api/vitals`、`/api/timeline`（游标分页）、`/api/diary` 补三缺口；鱼缸界面 + 鲸鱼娘序列帧（CC BY-NC-SA，见 docs/CREDITS.md） |
| 测试 | 122 项：110 上游回归 + 调度器快照（10 种子×100 tick）+ 路由契约 + OpenCode 契约 + panel e2e |

## 三轮团队评审与修复

| 编号 | 级别 | 问题 | 处置 |
|---|---|---|---|
| R1 | P0 | `session-delivery` 未采纳 `create()` 返回的 `ses_*`，OpenCode 每 tick 造孤儿会话 | 已修，契约测试锁定 |
| R2 | P0 | daemon 传入异步 `isBusy`，Promise 恒真导致生物钟永不 tick | 端口异步化 + await；daemon 暂不传，靠 8 分钟冷却 |
| R3 | P1 | panel 前端 POST 被 `opt.headers` 覆盖丢 Authorization | 已修 + 页面断言 |
| R4 | P1 | daemon 与 panel 双调度器抢状态 | panel 默认不带时钟（`PANEL_SCHED=1` 才内置） |
| R5 | P2 | fetch 无超时；MCP 截断无标记；Bearer 非常量时间；`package.files` 缺新目录 | 已修 |
| R6 | 待办 | 迟到判定按 tick 起点而非投递时刻；迟到只 console 未入事件流 | 记入 backlog |
| R7 | 待办 | core 仍有 DSH 残留：会话文件 mtime 探测、`nodeEnv(DSH_HOME)`、两套设置 UI | 后续 PR：端口补齐 / schema 单源 |

架构评审评分 **3/5**：方向成立，但 core 尚未完全中立；结论为**不可直接合入上游**，需真机验证。

## 验证

```
npm test                        # 122/122
bash scripts/evaluate.sh partial # 语法门 + daemon --once + MCP 握手
```
- DSH：设置页/路由/生物钟与上游逐项核对等价（P2：403/503 少 Cache-Control）
- panel：无 token API 503、页面 401；`/assets/*` 同样鉴权
- 资产：15 状态帧条 + manifest 可读；缺失时自动回落到内联 SVG

## 已知风险 / 未完成

1. **真机未验收**：DSH 装载、`opencode serve` 真实唤醒一次（需人工在场）。
2. CodeBuddy adapter 未实现（`@tencent-ai/agent-sdk` resume 方案已调研）。
3. AMpath 借用件为私有仓库（无 LICENSE），发布前须清理。
4. 角色图形 CC BY-NC-SA 4.0：仅个人非商用，署名见 `docs/CREDITS.md`。

## 提交序列

`af6fc2c` 阶段0-2 → `05a2b3a` 路由抽取 → `1e3c47f` OpenCode adapter → `12b9d1a` panel → `6a6f8bd` 文档/剧本 → `b688e8a` 评审修复 →（本 PR 末提交：序列帧接入 + PR 描述）

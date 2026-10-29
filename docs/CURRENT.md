# CURRENT —— 工作恢复入口（移植工程）

> 惯例借鉴 AMpath：新会话/新机器从这里接上，不用翻聊天记录。
> **架构与能力清单看 [BLUEPRINT.md](./BLUEPRINT.md)（唯一真相源）**；本文件只记"现在到哪、怎么起来"。

## 现在到哪了

- **2026-10-29：C2 计划窗口（主人批准）。** 10-30 01:00 `c2-window stop`（arm + 停 Cortico/看门狗），09:00 `start`（用 10-29 最后一条真实 tick 收尾 + 起服务），10-31 04:15 `verify`。计时器 pid 205156（wait）/ 204908（verify-at）；日志 `control/c2-window.log`。10-29 已有合规稿 `dyn-20261029-8e3377`（20:51 重启轮补齐），今晚窗口可以执行；skip 保护仍在。取消与睡过日界的处理见 `evidence/C2-DECISION-2026-10-29.md` 末节。
- **2026-10-29：行动观察器。** `action-watch.mjs`（pid 179304，到 23:04）盯着 `causal.jsonl`；她一下次行动后等 10 分钟，自动跑 `wake-audit --strict` + `day-report`，写 `days/<D>/wake-<HHMM>.json`。只读，不改行为。

- **2026-10-29：D0 完成。** Cortico 已 `git init`（`3e8ccd5`，1164 文件，无密钥入库）；`days/<D>/` 快照 + append-only ticks + `day-report` 已可用；看门狗已常驻并注册 HKCU 自启（`WhaleDayWatchdog`）；`draft-dynamic` 读不到日记现在**显式失败**并记录 `diaryHash`；`npm test` 改为动态发现（23 文件 / 145 测试）。执行记录：`evidence/D0-2026-10-29.md`；排期：`ROADMAP-2026-10-29.md`。
- **2026-10-29：D1 完成。** `buildText` 能取真实日记的 BV 标题、保留全部「想说」bullet；`readMood` 补 `action` 成因、阈值 0.25→0.2，真实场值从恒「平静」变为「轻快」。`npm test` 147/147、World 11/11、`tsc` 0、drill 33/33。记录：`evidence/D1-2026-10-29.md`。下一步 D2：`buildVoiceBrief` + `voice.schema.json` + `buildText` 必填 voice。
- **2026-10-29：D2 完成。** 情绪判定下沉 `persona-core/emotion.ts`（单源）；新增 `buildVoiceBrief`（L3 纯函数）与 `voice.schema.json`；`composeDraft` 缺 voice 拒稿、A1 标签全覆盖、低落只留一句、冷战略称、高分记忆可溯源回扣；World 写 `control/voice-<day>.json` 并带 `--voice`。dsh `npm test` 156/156（24 文件）、drill 34/34、`tsc` 0。记录：`evidence/D2-2026-10-29.md`。下一步 D3：G3a 进度门（整理已完成/未完成与证据）。
- **2026-10-29：G3a 通过（进度门，不转段）。** D4 补了 `check-consumers`、`npm run gates`、`tsc` 覆盖 `persona-core`、A3 真实快照断言。证据：`evidence/G3A-2026-10-29.md`。
- **2026-10-29：D5 canary 1/3。** 重启测试通过（杀 5988/23252 → 重启 113084 → health 5 项全过；`life.json` 前进、`actionsToday=0` 无重复行动）。期间修掉 `day-snapshot` 误读遗留 `rhythm.json` 的问题。C2（长时间离线）/C3（模型 410）未做，未进 G3b。记录：`evidence/D5-CANARY-2026-10-29.md`。
- **2026-10-29：C3 通过、C2 口径裁决、反事实工具就绪。** C3 用死端口 `18911` 注入模型故障：重试 ×7、草稿 0 新增、状态可读；恢复后 health 全过。C2 裁决为「≥8h 真实关机 + 跨 04:00 + 一次强制终止 + 时钟回拨」，待真实关机验证。新增 `scripts/counterfactual.mjs`（真 voice vs 中性 voice，10-28 实测差异 6 字）并在看门狗里每日自动生成。记录：`evidence/C2-DECISION-2026-10-29.md`。
- **2026-10-29：M3 收口 + 观测缺陷清理。** ①人设单一来源（D-19）：`CONSTITUTION`=她是谁、`ORIENTATION`=这一轮做什么，`~/.bili-ai/persona.md` 降为带警告的 DSH 遗留镜像，显示名=小鱼，health 增两段前缀漂移门；②行动账本启动时按 append-only 因果链对账（D-32）；③看门狗跨日用前一天最后一条 tick 收尾 `state.end`（D-34，10-28 不回填）；④审批成功判定必须有 `dyn_id`（D-23）；⑤私信回信链路上线：`bili_dm_reply` 只写草稿，`scripts/dm-approve.mjs` 一次性 token 才发（默认 dry，冷却退回）；⑥`npm test` 197/197（33 文件）、Cortico 103/103（12 文件）、`tsc` 0；⑦G3b 草稿日记哈希改为按当天任一 tick 绑定（D-35）；⑧唤醒语裁决：看的部分不能跳、草稿默认可拒须留原因、当天已有稿不重复（D-36，**待“无稿日”验证**）；新增 `scripts/wake-audit.mjs` 还原每次唤醒的工具序列，并据此更正“自然唤醒从不写稿”的误判；⑨C2 改为要求 tick 时间线里真实空窗 ≥8h 且跨 04:00（D-37），arm 后不关机不再假通过。G3b 现状：C1/C3 PASS、**C2 PENDING**、连续 3 天反事实 PENDING；10-28 反事实 6 字但草稿缺 `diaryHash`，判不过。证据：`evidence/D-19-PERSONA-2026-10-29.md`、`D-32-LEDGER-2026-10-29.md`、`D-34-DAY-CLOSE-2026-10-29.md`、`D-35` 见 `G3B-DIARY-BIND-2026-10-29.md`、`D-36-WAKE-RULING-2026-10-29.md`、`C2-DECISION-2026-10-29.md`、`M3-DM-REPLY-2026-10-29.md`。
- **2026-10-29：G3b 就绪审计上线。** `node scripts/g3b-check.mjs` 当前输出：C1 PASS / C3 PASS / **C2 PENDING** / 连续 3 天反事实 **PENDING**。观测期用 `node scripts/observation-status.mjs` 查 K1(11/14)/K2(9/14)/K3(3 天非平静)；未开始会显式提示。canary 状态在 `control/canary.json`。**启动观测必须走 `node scripts/observation-start.mjs`：G3b 未就绪会拒绝，防止误开 14 天窗口。**
- **2026-10-29：目标完成审计器。** `npm run audit:goal` 把目标拆成 G3b / 观测窗口 / K1 / K2 / K3 五项，当前 4 项 PENDING；只有全部 PASS 才算目标达成，不接受"测试全绿"替代。
- **2026-10-29：观测操作卡。** `docs/OBSERVATION-PROTOCOL.md` 固定了每天 20–30 分钟的检查、污染定义、允许的运维与停止条件；G3b 全绿后用 `node scripts/observation-start.mjs` 开窗。
- **2026-10-29：日界统一到 04:00。** `rhythm.dayKey`、`diary_append`、`todayDraftLine`、草稿 voice 文件全部用同一日界；此前 life 在午夜清零、快照按 04:00 统计，跨 00:00 会把一天算两次。重启后 `life.day=2026-10-28`（00:51 属前一天），health 通过，drill 34/34（测试自身也改为 04:00）。

- **2026-10-27：宿主已统一到 Cortico。** DSH 插件的时钟在本机停用（`clock.enabled=false` + `night.windows=[]`，面板与 `/deps` 仍在）；HKCU `WhaleDraft`（21:30 nightly-scheduler）已删除。Cortico World 改为**状态驱动的醒/睡**（无固定 21:40；无聊/想他/累 + 抖动决定，单日 ≤3 次，冷战/连续失约会自动收敛），见 `Cortico/persona-core/src/rhythm.ts` 与 `docs/CORTICO-PATCHES.md` 第 11 条。
- 分支 `port/core-opencode-panel`，4 个检查点提交（阶段0-2 / 阶段2 / 阶段3 / 阶段4）。
- `npm test` **197/197**（33 文件，2026-10-29）；drill **34/34**；Cortico 套件 **103/103**（12 文件）；`tsc --noEmit` 0 错。（数字每次改动都要重跑，别抄这里）
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

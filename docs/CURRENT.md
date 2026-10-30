# CURRENT —— 工作恢复入口（移植工程）

> 惯例借鉴 AMpath：新会话/新机器从这里接上，不用翻聊天记录。
> **架构与能力清单看 [BLUEPRINT.md](./BLUEPRINT.md)（唯一真相源）**；本文件只记"现在到哪、怎么起来"。

## 现在到哪了

- **2026-10-30：V1 视频切片本地成片通过（未接线）。** 20s/1080×1920/h264+aac，MiMo TTS（`mimo-v2.5-tts`，音色茉莉，7.04s）+ CC0 BGM（AERIS `quiet-room`，0.14），9:16 + 16:9 两张封面；`tools/video-build.mjs` 走 vendor/dsh-video-studio（MIT）。只写 `~/.dsh/bili-whale/media/_smoke/`，不接 World、不投稿。证据卡 `docs/evidence/V1-VIDEO-SMOKE-2026-10-30.md`；BGM 曲库与许可见 `assets/bgm/README.md`；模块化边界与观测后拆分计划见 `docs/MODULARITY-2026-10-30.md`。
- **2026-10-30 主人拍板（两问）**：①观测期“禁改码”细化为**只冻结 live**——禁合并、禁为加载新代码重启；dev 分支照常推进，观测结束一次性合并；②验收加 **K4 体验复盘项**（连续 7 天私信有来有回、成稿对得上当日情绪、无日记日期错位），**只复盘不卡验收**。协议原文已改：`OBSERVATION-PROTOCOL.md` §2/§3/§6、ROADMAP §4。
- **2026-10-30：C2 通过（canary 3/3 齐）。** 01:09:24 arm → 09:12:07 恢复，tick 空窗 **8.05h**、跨 04:00；health 5 项全过；10-29/30 day-report 均通过。`c2-result.json.ok=true`、`canary.json.C2=pass`。G3b 只剩连续 3 天：10-29 全绿；10-30 自然 action 11:11、草稿 `dyn-20261030-741fdf`，cf 等 10-31 04:05；10-31 待发生。证据 `evidence/C2-DECISION-2026-10-29.md`、`days/2026-10-30/wake-1111.json`。
- **2026-10-29：行动观察器。** `action-watch.mjs`（pid 207048，到 10-30 15:06）盯着 `causal.jsonl`；她下一次行动后等 10 分钟，自动跑 `wake-audit --strict` + `day-report`，写 `days/<D>/wake-<HHMM>.json`。只读，不改行为；覆盖 C2 09:00 恢复后的第一轮。

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

- **2026-10-27：宿主已统一到 Cortico。** DSH 插件的时钟在本机停用（`clock.enabled=false` + `night.windows=[]`，面板与 `/deps` 仍在）；HKCU `WhaleDraft`（21:30 nightly-scheduler）已删除。Cortico World 改为**状态驱动的醒/睡**（无聊/想他/累 + 抖动决定），见 `Cortico/persona-core/src/rhythm.ts` 与 `docs/CORTICO-PATCHES.md` 第 11 条。**2026-10-30 主人裁决：无每日行动上限、无最小间隔**（`MAX_ACTIONS_PER_DAY=Infinity`、`MIN_GAP_MS=0`），靠体力/事件自然收敛，不用打卡式约束。
- 分支 `port/core-opencode-panel`，4 个检查点提交（阶段0-2 / 阶段2 / 阶段3 / 阶段4）。
- `npm test` **212/212**（37 文件，2026-10-30）；drill **34/34**；Cortico 套件 **112/112**；`tsc --noEmit` 0 错。（数字每次改动都要重跑，别抄这里）
- 已完成：core 化、AgentSessionPort、WHALE_HOME/WHALE_NODE、notify ntfy/bark、tick-catchup、路由抽取、OpenCode adapter（daemon+MCP）、whale-panel（含鱼缸视图）。
- 未完成（按计划顺序）：
  1. client.js 的 schema/render 拆分（当前面板用 JSON 编辑器替代；DSH 设置页未动、回归全绿）
  2. CodeBuddy adapter（二期；`@tencent-ai/agent-sdk` `query({resume})` 已调研）
  3. 真机端到端：DSH 装载冒烟 + opencode serve 真投递（需要用户操作）
  4. 视觉打磨：md→tokens.css 管道、鲸鱼娘多帧状态机（现单帧+闭眼/昼夜）

## 她现在过得怎么样（2026-10-30 实测）

- **节奏**：10-30 只有 1 次自然行动（11:11 restless），之后 5 个多小时在待机；每 3–7 分钟评估一次，场值不够就不动。10-29 也是 1 次行动；10-28 没有行动。不是定时打卡。
- **一次行动里**：traffic → feed → debrief（可能多条）→ 读/写两本日记 → 有需要才出稿 → dm_read → end。她的大头时间在 B 站弹幕/评论上做判断，不在聊天。
- **她的产出**：公开日记「看过/想说」+ 私人「本轮留下的判断」是主要可读内容；10-30 写的是雷雨声 283 个桶的分析（“我不会挑，但我算得清”）。动态 `dyn-20261030-741fdf` 已于 2026-10-30 17:07 发出（B 站动态 id `1264923003190247429`）；10-28/29 两条旧稿仍 pending，未补发。记录 `docs/evidence/DYNAMIC-2026-10-30.md`。
- **界面**：7799 是 Cortico 操作台（系统提示词/工具调用/token/World 总览），不是伴侣界面；“B站账号”详情页没有面板。8447 鱼缸面板未运行；它的时间线读 `whale-log.jsonl`（最后 2026-10-25），看不到她现在的 `causal.jsonl`。动态草稿的审批仍走 `scripts/dynamic-approve.mjs`，面板只显示 go-gate 待审。
- **真实对话通道**：B 站私信。`bili_dm_read` 只读，回信要 `bili_dm_reply` 入队 + 主人审批；控制台是带 PIN 的后台，不是日常聊天。
- **已知缺陷**：私人日记 10-30 09:12/11:11 的内容落到了 `## 2026-10-29`（日期错位，她自己在日记里记了）；公开日记同一天出现两个 `## 想说`，`buildText` 取第一个，导致 10-30 稿用了 09:12 的 Yoga Nidra，而不是 11:11 的雷雨 283 桶；已发稿还有一个未闭合 `**` 和被截书名。原因待查，观测期不修。
- **团队分析**：六席短板与设计见 [TEAM-GAP-ANALYSIS-2026-10-30.md](TEAM-GAP-ANALYSIS-2026-10-30.md)；DSH/大肥鱼开源件核查见 [PLUGIN-RADAR-2026-10-30.md](PLUGIN-RADAR-2026-10-30.md)。结论：不装 DSH 插件、不引第二宿主，借 `dsh-dafeiyu-life` 的信息架构和 `dsh-bili-scroll` 的日报设计；先修内容完整性，再做只读“她的一天”，最后拆媒体供应商。

## 接下来（观测结束后，按顺序）

1. **M1d 内容完整性 ✅ 已合 live（2026-10-30）**：日记重复 heading/日期、`buildText` 选段、`snippetOf` 截断与未闭合 markdown；先修再出新稿。
2. **M1e 审批加固 ✅ 已合 live（2026-10-30，含 kill 统一检查·D-22 翻案）**：token 不进 stdout/模型、argv 重建、动态审批 textHash+draftId、kill 全覆盖；在此之前不做一键审批。
3. **M1a 可观测（只读部分 ✅ 已合 live，2026-10-30）**：panel 改读 `causal.jsonl`（缺失回退 whale-log），`/api/drafts` 只读展示动态/回信草稿，bubble 三队列合计；资产根收口进 `paths.draftsDir/imagesDir`。`存在感`微行为层（两次 B 站 action 之间的“她在”状态）是行为改动，留观测后。
4. **M1b ✅ 已合 live（2026-10-30）**：`tools/lib/credentials/` 注册表（mimo + bilibili，describe 不含 secret，缺 key fail-closed）；资产根已在 M1a 收口。**M1c**（TTS/BGM/渲染器适配层 + `config.media`）是下一个。
5. **行动密度 Drive v2**：加 create/social 驱动，分离“存在感”与“B 站 action”；先 10 天模拟再定阈值。**不要只把 `CHECK_PROB` 拉到 1**。
6. **M2/M3**：草稿 publisher/DM 回信可见/通知；形象、语音、视频接 World；V2 出片/剪映。

观测期（11-01 起）不改码；10-31 是 G3b 最后数据日，11-01 04:05 后才可能过门。

## 一分钟接上

```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale
npm test                         # 全量回归
node scripts/preflight.mjs        # 部署预检（凭据/风控/端口/OpenCode）
bash scripts/evaluate.sh quick   # 快速验收剧本
# 真机上线按 docs/DEPLOY.md 走；交给 AI 执行用 docs/RUNBOOK.md
node panel/server.js --port 8447 # 鱼缸面板（浏览器打开启动日志里的 ?t= 地址）
node adapters/opencode/daemon.js --once   # 时钟冒烟（窗口外应零投递）
# V1 出片（本地，不投稿）：MiMo TTS + CC0 BGM + 双封面
node tools/video-build.mjs --image "D:/AI/养鱼/assets/daily/daily-04-goodnight-a.png" \
  --text $'今晚听雨。\n三十九分钟，没有人说话。\n晚安。' --duration 20
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
tools/video-build.mjs  V1 出片 CLI（MiMo/Edge TTS + CC0 BGM + vendor 渲染/封面）
assets/bgm/      3 首 CC0 BGM + LICENSE + README（可整包替换）
vendor/          dsh-video-studio（MIT，6 文件）、dsh-autocut（MIT，lib 15 文件）
tests/contract/  路由/panel 契约；tests/scheduler-snapshot.test.mjs 行为快照
docs/            BASELINE.md / TERMUX.md；现状看 CURRENT.md，模块边界看 MODULARITY-2026-10-30.md
```

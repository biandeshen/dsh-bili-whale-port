# REUSE-MATRIX —— 自有仓库复用矩阵

> v1 · 2026-10-28 · 依据：三路只读盘点（`~/.qoder/tmp/REUSE/01-architecture.md`、`02-capability.md`、`03-governance.md`）+ 本机核实。
> 原则：**先看分支再看默认分支**（本次实测：多数仓库代码确实在 `codex/*`，但也有三个 `main` 就是最新实码）。
> 判定档位：`直接用` / `抄实现` / `抄协议` / `抄设计` / `抄模板` / `只作参考` / `不可用`
> **许可红线**：无 LICENSE = 只能本地自用，**不得随任何形式的发布带走**；AGPL = 分发即传染。

## 0. 总表

| 仓库 | 实际是什么 | 代码在哪 / 最近 | 许可 | 对我们的用途 | 形态 | 成本 |
|---|---|---|---|---|---|---|
| **bili-cli** | Python B站 Agent CLI（已 fork） | `main`（1.2.1，10-26），非骨架 | MIT | **M3 私信：子进程插件优先**；P2 元数据契约；M4 字段映射 | 插件 / 备选重写 | 0.5 天 / 1 天 |
| **ai-trpg-engine** | 全栈 AI TRPG 单体，内含"确定性内核 + LLM 叙述" | `main`（08-30，上游已停维护） | **AGPL-3.0** | 事实包/禁止字段/后验校验；确定性记忆召回 | 抄设计 + 重写 | 召回 1–2 天；叙述层 2–4 天 |
| **creator-ops-agent** | TS 内容运营骨架（Fastify+SQLite），**无调度器** | `codex/operation-feedback-loop`（10-27） | 无 | 能力三态、审批≠执行、CAS 语义、账号隔离 | 抄设计 | 0.5–1 天（只落文档/字段） |
| **Cyrene-Agent** | Electron+TS Live2D 伴侣 | `master`（07-16） | MIT | **L5 首选**：渲染层可剥 | 抄实现 | 1–2 天（换模型+接事件桥） |
| **video-summarizer** | B站/YouTube 音频→转录→总结 | `codex/fix-*`（10-24） | 无 | 字幕兜底 + ASR 流程 | 只作参考 | — |
| **desktop-pet** | Electron+PIXI Live2D 原型 | `master`（08-08） | 无 + Live2D 重分发条款 | 渲染骨架参考 | 只作参考 | 不可发布 |
| **airi** | Vue3 monorepo，能力最全 | `main`（08-08），531MB / 46 分支 | MIT | 功能参考 / 库级取用 | 只作参考 | 过重 |
| **minicpm-o-voice-manager** | MiniCPM-o 音色克隆**控制台** | `main`（08-29） | 无 | 音色流水线参考 | 只作参考 | 绑 GPU |
| **BilibiliDown** | Java GUI 下载器 | `dev` 停在 2025-01 | Apache-2.0 | 与我们无关 | 不可用 | — |
| **AMPath-WorldModel** | 用对话数据训练 NPC 预测器的研究管线 | `master`（06-27） | 无 | 无 EmergentDimension 实现 | 只作参考 | — |
| **AMPath-MEE** | 265 行最小场值实验脚本 | `master`（06-25） | 无 | LLM-as-user 实验脚手架 | 抄脚手架 | 0.5 天 |
| **TrueWorld** | 宏观世界/反事实模拟器 | `main`（10-03） | 无 | 领域不重叠 | 只作参考 | 不建议 |
| **project-atlas** | 文档地图 CLI（真代码） | `main` v0.6.0 | 无 | 管我们的 4 份文档 | 直接用 | 2–4h |
| **decisionctl** | 决策生命周期 CLI（六态 + 原子 supersede） | `main` | 无 | 管待拍板/否决/替代 | 直接用或抄状态机 | 4–8h |
| **AI-Engineering-Orchestrator** | 流程文档 + 一个 Agent Skill | `main` | 无 | 五维评估、九维可证伪审查、`pass/revise/replan/blocked` | 抄模板 | 1–2h |
| **strategy-council** | 议案产品，实现在 codex 分支 | `codex/council-complete-product` | 无 | 5 角色卡 / 5 方法卡 / R-VERIFY | 抄模板 | 1–2h |
| **self-hosted-runner-ops** | 已有机器队管理脚本 | `main` | 无 | 绕 Actions 额度 | 暂缓 | 4–8h |
| **openclaw-backup** | 个人工作区备份 | `master` | 无 | 其 `check-docs` 指向不存在脚本 | 不可用 | — |
| **zhijing** | 意图澄清产品 | `main` | 无 | `node --test tests/*.test.mjs` 的现成写法 | 抄命令行 | 0.5h |

## 1. 三条"立刻能用"（本周）

### 1.1 M3 私信读取（最高价值；**插件优先**，2026-10-28 修订）

> 原先写的是"抄协议、Node 重写 150–250 行"。主人指出：**CLI 可以当插件用，不必抄代码**。按 `ARCHITECTURE.md` §2.3 的判定树，只读/低频走插件，因此 M3 默认方案改为 **A. 子进程插件**，重写降为备选。

**A. 插件方案（默认，约 0.5 天）**
- 命令（已核实存在于 bili-cli `main`）：
  - `bili dm list [--unread] [--limit N]` → `{"items":[{talker_id, unread_count, last_msg, auto_reply}]}`
  - `bili dm read <uid|owner> [--limit N]` → 按时间顺序的消息 JSON（`from: me|them`、`text`、`type`）
  - **永不带 `--mark-read`**：它是 `POST update_ack`（`dm.py:182-186`），会改变远端状态。
- 凭据：bili-cli 读 `%APPDATA%\bili-cli\credential.json`，**支持 `BILI_CLI_HOME` 覆盖**；我们建受管目录（不进 git），**单向**同步（我们→插件）。
  ⚠ **必须先补 `dedeuserid`**：我们的 `tools/lib/cred.mjs:33-37` 只返回三个字段，而 bili-cli `dm.py:172` 靠 `dedeuserid` 判断 `from`；缺了它会把"她发的"全判成"主人发的"→ `connection` 假上涨、M3 验收假通过。取法：调 nav 接口拿 mid 并缓存。
  ⚠ 调用前后对 `credential.json` 做 sha256 比对，变化即 `CRED_ROTATED`（防插件偷偷刷新 cookie）。
- 运行时：Python ≥3.10；`pipx install` 或 `pip install -e`。
- 环境：`PYTHONUTF8=1`、`PYTHONIOENCODING=utf-8`、`NO_COLOR=1`（Windows 管道默认 cp936，不设会乱码）。
- 失败语义：`ENOENT→PLUGIN_MISSING`、退出 2→`BAD_ARGS`、超时→`TIMEOUT`、非 JSON→`BAD_OUTPUT`、`-101→AUTH_EXPIRED`、`-352/412→RISK_PAUSED`（并写回 `traffic-state.until`）。
  **读取失败一律 `{ok:false}`，空数组只在 canary（`bili me`）通过时才算 `OK_EMPTY`**；失败时 L3 不得应用 delta、不得重置 `lastContactAt`。
- 断言：解析前检测 U+FFFD（乱码）；对 `from` 分布断言 `me` 与 `them` 都出现过。
- 我们这边：新增 `tools/commands/dm-read.mjs` **约 80–120 行**——spawn + 超时 + JSON 归一 + 错误映射；**不 ack、不发**。
- 风险：依赖 `bilibili-api-python==17.4.2` 已归档（pin 死），协议若变则失效 → 记入 `PORT-LEDGER.md` 的依赖指纹，失效时切换 B。
- **轮询必须原生**：M3 的 60s 轮询不进插件（`ARCHITECTURE.md` §2.3 判定树），插件只用于低频读取/人工触发。

**B. 重写方案（备选，约 1 天）**
- 接口已核到字段级（`get_sessions` / `fetch_session_msgs` / `new_sessions`），Node 重写 150–250 行 + 测试；无 Python 依赖、错误语义统一、可与 `traffic` 读预算直接打通。
- 触发条件：A 失效、或我们要求所有读取都走同一个预算账本（bili-cli 自带 `guard.py` 只限写，读不受我们的预算管）。

**共同约束**：只读；`msg_source=8` 是 B 站自动回复，**不能算主人已回**；`session_ts` 是微秒 → `lastContactAt = session_ts/1e6`。


### 1.2 测试真的跑起来（治 D-10）
- `zhijing` 的 `package.json` 用的就是 `node --test tests/*.test.mjs` —— 与 `ARCHITECTURE.md` §11.3 一致，可直接照搬并加"发现=执行"断言。
- 本地 `.githooks/pre-push` 调 `npm run gates`，不依赖 Actions 额度。

### 1.3 文档与决策收口
- `project-atlas`（v0.6.0，真 CLI）：`atlas check` 能拒绝"未被节点引用的活文档"，正好逼我们把 17 份收成 4 份（CURRENT / BLUEPRINT / ARCHITECTURE / PROCESS）。**2–4h**。
- `decisionctl`：六态 `proposed/active/rejected/retired/superseded` + `rejected` 是终态不可复活——**正好治我 10-27 那次"把待办写成已否决"**。要么直接用（4–8h），要么只抄状态机进 `ISSUES.md`（0.5h）。
  **建议先抄状态机**：跨语言 CLI 引进来是额外依赖，而我们的病在语义不在工具。

## 2. 设计级复用（不抄代码）

### 2.1 ai-trpg-engine 的三条边界（AGPL，只能 clean-room 重写）
1. **事实包 → 渲染器**：内核拥有事实（含 CAS、幂等键、outbox、可恢复事件流），LLM 只拿**投影后的事实包**。
   → 我们 M0 用模板完全成立，但模板必须吃 `voiceBrief`；将来换模型复用同一份 fact packet。
2. **禁止字段表**：上游 `narrative.py` 明确禁止把 `hp/position/permission/roll/seed/outcome` 等喂给叙述模型，并规定"裁决带是约束，不能把失败叙述成成功"。
   → 我们要有对应表：`token / ackId / 文件路径 / 内部字段名 / 审批状态机` 一律不得进正文。
3. **确定性记忆召回**（`memory_recall.py`，210 行，无向量库）：最近 3 轮全量 + 高重要度长期不遗忘 + 上下文提及即召回 + 其余用 `sha256(id:turn)` 派生骰子按阈值决定"模糊记得"。
   → **这条直接解决我们"永远最早三条"**，移植 150–250 行、无需 SQLite。

### 2.2 creator-ops-agent 的四条语义（无许可，只借概念）
- 能力三态 `available / unavailable / unimplemented`：比"有接口=有能力"诚实，建议写进 `BLUEPRINT.md` §3 的状态列。
- **审批 ≠ 平台授权 ≠ 执行成功**，三层各自留 receipt。
- `task / operation_run / operation_event` + `expectedStatus` CAS：给我们 `world-task` 的持久化字段参考。
- 账号范围隔离 `global / account:<id> / project:<id>`。
- **它没有调度器**（文档明写 "Scheduled wake/resume loop not implemented"）→ 我们的 `world-task` 方案不可被它替代。

## 3. L5 皮套（待 Q-02 拍板）
- **Cyrene-Agent（MIT）** 是唯一许可干净的候选：`src/renderer/live2d/manager.ts`（317 行）+ `interaction.ts` + `mouth-sync.ts` 提供 `playAction(motion/expression)`、口型、点击穿透；剥掉它的 orchestrator 与 5k 行 main 后接 Cortico 事件桥即可。
- `desktop-pet` 用的是 Live2D Cubism，有重分发条款且无 LICENSE → **不可随项目发布**。
- `airi` 有 `packages/stage-ui-live2d` 真正的库，但整仓 531MB / 46 分支，只作参考。
- 模型资产要换：Cyrene 自带的是崩铁昔涟，另行许可。

## 4. 明确不可用 / 暂缓
- **BilibiliDown**：GUI 下载器，停更于 2025-01，不解决私信/投稿/互动。
- **openclaw-backup**：`.pre-commit-config.yaml` 指向不存在的 `scripts/check_docs.py`，只剩形态参考。
- **AMPath-WorldModel / AMPath-MEE**：**都没有 EmergentDimension 实现**（MEE 文档明确不含）。→ 见 §6。
- **TrueWorld**：宏观世界模拟，与伴侣/账号运营不重叠。
- **self-hosted-runner-ops**：能绕 Actions 额度，但需常开机器 + 管理员权限；本地 pre-push 已能兜住，排第二批。

## 5. 许可台账（决定将来能否开源）

| 许可 | 仓库 | 约束 |
|---|---|---|
| MIT | bili-cli、Cyrene-Agent、airi、Cortico、dsh-bili-whale(上游) | 可自用、可随开源（保留版权声明） |
| Apache-2.0 | BilibiliDown | 可用（本项目用不上） |
| **AGPL-3.0** | ai-trpg-engine | **只能 clean-room 重写设计**；拷代码会让整个项目被迫 AGPL |
| **无 LICENSE** | creator-ops-agent、project-atlas、decisionctl、AI-Engineering-Orchestrator、strategy-council、video-summarizer、minicpm、desktop-pet、AMPath 系、TrueWorld、openclaw-backup、zhijing | **仅本地自用**；发布前必须替换或取得授权 |
| 特殊 | Live2D Cubism（desktop-pet 内嵌） | 有重分发条款，不可随包发布 |

**结论**：将来若要开源，能带走的只有我们自己写的代码 + MIT/Apache 部分；**AMpath 内核、所有治理模板、L5 皮套素材都带不走**，要么重写要么换许可。

## 6. 对两个待拍板的影响

- **Q-01 EmergentDimension**：**上游没有任何可用实现**（WorldModel 是训练管线，MEE 明确不含）。选"做"= 从零实现，成本最高；建议先选"暂缓"，等 M0–M4 跑通再评估。
- **Q-03 A/C（MemoryWeaver 精华）**：`ai-trpg-engine` 的确定性召回提供了一个**比 MemoryWeaver 更贴合我们规模**的中间态（200–2000 条、无向量库、可复现）。建议 M4 先落这个，把 MemoryWeaver 的图谱/演化留到确有需求再做。

## 7. 与 ARCHITECTURE 的对应

| ARCHITECTURE | 本矩阵供给 |
|---|---|
| §4.6 M3 传感器 | bili-cli 私信协议（§1.1） |
| §4.4 记忆检索 | ai-trpg-engine `memory_recall` 设计（§2.1.3） |
| §3 输出链路 | ai-trpg-engine 事实包/禁止字段（§2.1.1–2） |
| §4.5 持久任务 | creator-ops-agent 的 CAS/事件形状（§2.2），**调度器仍需自建** |
| §7 门禁与治理 | project-atlas、decisionctl、AI-Engineering-Orchestrator、strategy-council、zhijing（§1.2–1.3） |
| §9 L5 / Q-02 | Cyrene-Agent（§3） |

## 8. DSH 插件生态（2026-10-28 新增，来源：主人给的 DeepSeek 分享）

> 分享原文描述的是一套"大鲸鱼"自主运营的 DSH 插件栈。**它们是 DSH 插件，不是 Cortico World**——不能直接加载，但多数核心可剥成库或子进程。已逐个核实存在性、许可与耦合度。

| 插件 | 来源 / 版本 | 许可 | 与 DSH 的耦合 | 我们怎么用 | 阶段 |
|---|---|---|---|---|---|
| **dsh-video-studio** | npm `0.4.3`（仓库 `litao36253/dsh-video-studio` 为空，包本身完整） | **MIT** | **核心零耦合**：`render.js / media.js / cover.js / ffmpeg.js` 不引用 `ctx`，纯 Node + ffmpeg，零运行时依赖（Node ≥22，仅 Windows） | **vendor 6 个核心文件 + LICENSE** 到 `tools/vendor/dsh-video-studio@0.4.3/`（包 `exports` 只暴露 `"."`，不能 `npm i` 后 import 内部路径），再包成我们的 `video-build` 子命令 | P2 |
| **dsh-bili-workbench** | `xiaweihuaniubi/dsh-bili-workbench`（2★，10-27） | **MIT** | 拆成两半：`client.js` 是 DSH web UI；**`bili-op/` 是独立引擎**（`gen.mjs/tts.mjs/build.mjs`，脚本→配音→渲染→封面，**不自动发布**，仅依赖 sharp） | **子进程插件**：直接跑 `bili-op` 流水线；它自己也用 spawn 调 `bili` CLI | P2 |
| **dsh-autocut** | `lolistlisa/dsh-autocut` v0.3.0（1★） | **MIT** | 入口 `index.js` 绑 `@deepseek-ai/dsh-tools`；`lib/`（timeline/export/render/sound）可能可剥 | 二期：先评估剥 `lib/timeline` + 剪映草稿导出；否则只借设计 | P2 后 |
| **dsh-voice** | npm `0.4.3`（`STARDUSTLC666/dsh-voice`） | **MIT** | 入口绑 DSH 运行时（`engines.dsh>=0.2.1-rc.3`，依赖 `@stardustlc/dsh-updates`、ws、undici）；**但核心里 `edge-tts.js` / `stt.js` 的 ctx 引用数为 0，可剥** | 优先直接走 Edge-TTS；若要 STT 再 vendor `edge-tts.js`/`stt.js`（需实测依赖） | P3 |
| **dsh-whale-maid**（多实现） | `lov0vo` / `yefeng7531`(9★) / `Sun-L1` | 各异 | 精灵图 + 状态机，DSH web UI 内嵌 | L5 备选；我们已有 Cyrene（MIT）渲染层 | P3 |

**同域其它候选**（供 P2 比较）：`q253595422/dsh-imagegen-video`（64★，图+视频无限画布）、`fengyungithub/dsh-short-video-studio`（34★，ComfyUI）、`hackerFish/dsh-video-studio`（鲸影，六段导演流水线）。

**接入原则（与 ARCHITECTURE §2.3 一致）**
- 只取**能脱离 DSH 宿主运行**的部分：库（`dsh-video-studio` 核心）或子进程（`bili-op`）；**不引入 DSH 插件生命周期**。
- 写操作（投稿）仍必须过我们的 `traffic + ack` 闸；`bili-op` 默认"不自动发布"正好符合。
- **一处不照抄**：分享里说"默认勾选含 AI 生成内容声明"——主人 2026-10-28 已明确不做 AI 标识，我们不采用该默认。
- **署名**：分享确认鲸鱼娘是基于 UP 主「上善无形」的原创角色「溟月」的二创，与我们 `CREDITS.md` 的 CC BY-NC-SA 记录一致，发布时必须保留署名。


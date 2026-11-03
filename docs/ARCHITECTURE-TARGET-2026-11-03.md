# ARCHITECTURE-TARGET-2026-11-03 —— 现架构实测图 + 终版重写方案（万物皆能力扩展 ＋ 宿主可插拔 ＋ 全功能可操作）

> **本文是重写方向的唯一依据（2026-11-03 主人拍板定稿）**。
> **本文管三件事**：① 现在的架构到底是什么形状、病根在哪（全部现数，带文件与行数）；② 理想的目标架构长什么样（**5 个宿主无关的平级能力包 `cap-*` + 薄转接头对接 Cortico 插座**，连 Cortico 自身都可插拔）；③ 每个能力包必须给主人补齐哪些**可查、可改、可控的操作台**（消灭只读黑盒）。
> **注意**：本文是架构设计蓝图，不是排期表；主人下令开工哪一块之前，不构成自动开工凭据。原 `PLAN-2026-11-03.md` 已作废删除（需历史原文见 `git show 36147ed:docs/PLAN-2026-11-03.md`）。

---

## 0. 现状盘点：现在有几个代码体（2026-11-03 实测）

| 代码体 | 位置 | 规模 | 归属 |
|---|---|---|---|
| Core | `Cortico-up/src/core/` | 42 个 .ts / 9,551 行 | 上游 Pal-AI-Lab (MIT) |
| WebUI | `src/web/` | 298 个 .ts / 38,155 行 | 上游 |
| Providers | `src/providers/` | 79 个 .ts / 8,109 行 | 上游 |
| 扩展装载 | `src/extensions/` | 18 个 .ts / 2,543 行 | 上游 |
| 上游内建 worlds | `src/worlds/` 共 161 / 66,199 行 | minecraft 47,703 · bilibili(直播) 6,727 · qq 5,226 · console 1,285 · websearch 1,070 | 上游，不是我们的 |
| **她的 World** | `src/worlds/bili-account/` | **17 个 .ts / 4,008 行** | 我们的，**却塞在框架检出里** |
| **她的人格纯函数** | `persona-core/` | 16 个 .ts / 2,054 行 | 我们的，寄居在框架 workspace |
| **她借用的宿主** | `bots/cormini/` | 34 个 .ts / 6,222 行 | **上游参考 bot**（`deployment.json` 写 `{"bot":"cormini"}`） |
| **她的手（第二仓）** | `dsh-bili-whale/` | **43 条 CLI** + `tools/lib` + `tools/drafts` + 41 个 `scripts/` + 80 个测试文件 | 上游 Alterssss 移植线 |

---

## 1. 现架构的七处病根（每处都有实测证据）

1. **产品代码寄居在上游框架检出里**。`src/worlds/bili-account`（4,008 行）直接改了上游 `src/worlds/index.ts:18`；跟上游对账（`master…upstream/main` 实测落后 436 个提交）时，产品代码和框架底座搅在同一棵树里。
2. **「小鱼这个人」被错误塞进了「B 站插件」里（跨渠道失魂的根源）**。因为当初偷懒直接借用上游 `bot=cormini`，手上只有 `bili-account` World 能写代码，结果把她的**六条场值（`fields.json`）、情绪计算（`readMood`）、昼夜作息循环（`life-stages.ts`）、两本日记（`diary.ts`）**全塞进了 B 站 World。后果已实测（`CURRENT.md:27`）：在控制台（`world:console`）跟她说话时不带她的场值与记忆，"鱼缸里的她"和"跟你聊天的她"分裂成两个人；一旦停用 B 站 World，她连心跳和日记都一起消失。
3. **两套记忆互不相认，且对主人是黑盒**。`bili-account/*.ts` 对框架 Memory 的引用为 **0 次**。她的情绪记忆存在 `C:\.dsh\bili-whale\fields.json` 的 `memories` 数组里（实测 60 条，`personaAdapter.ts:215` 硬截断 200 条），而 `cormini` 的工作区记忆在 `workspace/`。不仅她自己抱怨"判断结果没有独立视图，只能从日记正文里捞"（意见箱 `f-d99d64`），主人在网页上也**根本查不到、改不了这 60 条记忆**。
4. **把同一个 B 站能力劈成「World + dsh CLI」两半，靠 `spawn argv` 字符串通信**。`runner.ts:13-20` 用 `spawnSync('node', ['tools/bili.mjs', ...args])` 跨进程调第二仓。原本就是同一个 B 站扩展能力，却叠了两层壳、分在两个仓，所有参数防注入、`--token-env`、靠输出里找 `✗` 判断失败（因被拒时退出码仍为 0，`pending-queue.mjs:85`），全是在交这条伪边界的税。
5. **B 站能力面只暴露了一小半（43 条命令只挂了 18 个工具）**。差集 25 条能力里：**入站只有私信一条**（`definition.ts:824`）；`tools/lib/msgfeed.mjs` 已实现"回复我的 / @我的"、`likes.mjs:41` 已实现"收到的赞"，CLI 侧有调用（`comment-await.mjs:23`、`comment-digest.mjs:18`），但 **World 侧零调用**（她完全听不见评论回复、@ 和赞）；`bili_comment` / `bili_danmaku` / `bili_dynamic_edit` 在 `tool-decls.ts` 里 **0 命中**。
6. **三个盘四处家**。代码在 `E:\WorkSpace_Qoder\`（且 `Cortico-up` 是 `Cortico` 的 git worktree）；状态散在 `C:\.dsh\bili-ai\`、`C:\.bili-ai\`、`C:\.dsh\bili-whale\`；素材与草稿在 `D:\AI\养鱼\`；会话与工作区在 `Cortico\deployments\mybot\`。
7. **主人控制面 90% 是只读看板（「那么多东西都操作不了」）**：
   - **鱼缸只读**：看得到她场值低或困倦，但页面上**不能手动拉滑块调场值/心情、不能一键戳醒她立即跑一轮、不能切作息模式**；
   - **记忆不可查不可改**：网页上没有她的情绪记忆列表，不能搜、不能手动塞一条记忆、不能改错字、不能在页面上一键作废/置顶；
   - **日记与判断卡不可改**：她在日记里写错日期（如 10-30 写进 10-29），页面上没有编辑器可改；判断卡连独立页面都没有；
   - **B 站收件箱空白**：网页上看不到谁评论回复了她、谁 @ 了她、谁私信了她，也没法指派她"回这条 / 忽略这条"；
   - **待审稿不能改字**：草稿有错别字或多余符号，页面上只能「✓放行 / ✗拒掉」，没有编辑框（且去改源文件会被 `dynamic-approve.mjs:51-57` 的 `textHash` 校验锁死拒发）；
   - **意见箱与偏好割裂**：她提的意见只能点"已解决"，不能直接写主人批复或一键转成屏蔽词/偏好规则。

---

## 2. 目标架构核心设计：万物皆能力扩展（`XiaoyuCapability`）＋ 连宿主都可插拔

### 2.1 三条核心铁律（主人裁决，不再打开）

1. **万物皆能力扩展，按业务域聚合成整块，不按「感知/表达/行动」横切**：
   状态与作息、记忆、日记与判断、B 站、音视频创作，本质上全都是平级的能力扩展（`XiaoyuCapability`）。B 站就是完整的一块（含看片、四路收件箱、发动态/评论/弹幕/私信、点赞收藏、安全闸），绝不再拆成多个碎片插件，也绝不保留独立 `dsh CLI` 第二层。
2. **核心资产 100% 宿主无关（连 Cortico 本身也是可插拔插座）**：
   5 个能力包（`cap-*`）内部**绝不直接 `import 'cortico/*'`**，只实现我们自己的 `XiaoyuCapability` 接口。对接 Cortico 只靠最外层极薄的「专用转接头」（每个 50–100 行胶水代码）。将来 Cortico 升级契约或彻底换掉 Cortico 底座，5 个能力包一行代码不用动。
3. **没有只读黑盒——每个能力扩展强制自带完整可写的主人操作台（`panel`）**：
   任何一个能力扩展必须同时交付四件套：**`store`（管自己的数据）+ `context/event`（对她的注入与唤醒）+ `tools`（给她的工具）+ `panel`（给主人的可读写控制面板）**。

### 2.2 整体架构图（三层：宿主无关能力层 → 薄转接头层 → Cortico 插座层）

```
┌─────────────────────────────────────────────────────────────────────────┐
│                第一层：你的核心资产（100% 宿主无关，零 Cortico 依赖）        │
│                                                                         │
│   @xiaoyu/persona-core（纯函数内核：情绪公式 / 召回打分 / 节奏计算 + 统一契约）│
│     ▲               ▲               ▲               ▲               ▲   │
│  ┌──┴───────────┐┌──┴───────────┐┌──┴───────────┐┌──┴───────────┐┌──┴───────────┐
│  │ 扩展 1        ││ 扩展 2        ││ 扩展 3        ││ 扩展 4        ││ 扩展 5        │
│  │ cap-state-   ││ cap-memory   ││ cap-journal  ││ cap-bilibili ││ cap-media-   │
│  │ rhythm       ││              ││              ││ (含原dsh全量) ││ studio       │
│  │ 状态与作息    ││ 四层记忆库    ││ 日记/判断/意见││ B站整块+安全闸││ 音视频创作    │
│  └──────┬───────┘└──────┬───────┘└──────┬───────┘└──────┬───────┘└──────┬───────┘
└─────────┼───────────────┼───────────────┼───────────────┼───────────────┼───────┘
          │               │               │               │               │
          ▼               ▼               ▼               ▼               ▼
┌─────────────────────────────────────────────────┐┌──────────────┐┌──────────────┐
│ 第二层：Cortico 专用薄转接头（仅此处 import cortico）││ 转接头 B      ││ 转接头 C      │
│                                                 ││ cortico-     ││ cortico-     │
│   转接头 A：cortico-bot-xiaoyu (kind=bot, api=7) ││ world-       ││ world-       │
│   （"一拖三转接坞"：汇聚全渠道前缀、onDelivery、    ││ bilibili     ││ media        │
│     全局唯一生活 tick 与 Persona/Memory 面板）     ││ (world,api=6)││ (world,api=6)│
└────────────────────────┬────────────────────────┘└──────┬───────┘└──────┬───────┘
                         │                                │               │
                         ▼ (唯一 bot 大脑插孔)              ▼ (world 外部插孔)▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│                第三层：Cortico 宿主底座插座（100% 纯净上游，随时可换）              │
└─────────────────────────────────────────────────────────────────────────────────┘
```

### 2.3 统一的 `XiaoyuCapability` 四件套契约

定义在 `@xiaoyu/persona-core/src/capability.ts` 中，5 个能力包全部实现同一接口：

```ts
export interface XiaoyuCapability<TConfig = unknown> {
  /** 能力唯一标识：'state-rhythm' | 'memory' | 'journal' | 'bilibili' | 'media-studio' */
  readonly id: string;
  readonly title: string;

  /** ① 配置与默认值（JSON Schema 声明，自动渲染到面板，支持热更新） */
  readonly configSchema: JsonSchema;
  readonly defaultConfig: TConfig;

  /** ② 数据与生命周期（独立文件/目录，不与别的扩展抢同一个 JSON） */
  start?(host: CapabilityHost): Promise<void> | void;
  stop?(): Promise<void> | void;
  storageParts?(): StorageUnit[];

  /** ③ 对她的上下文注入（system 前缀段 + 收到消息时的动态召回/状态注入） */
  contextSegments?(ctx: TurnContext): Promise<PrefixBlock[]>;
  onMessageDelivery?(ctx: DeliveryContext): Promise<string[]>;

  /** ④ 给她的手脚（模型可调用的工具声明与进程内 Typed 执行函数） */
  tools(): ToolRegistration[];

  /** ⑤ 给主人的操作台（硬性标配：暴露读/写/动作 RPC 方法与前端视图） */
  panels(): CapabilityPanelDecl[];
}
```

---

## 3. 五个平级能力扩展包的边界与主人操作台规格

### 3.1 `cap-state-rhythm`（状态与作息扩展）

- **职责边界**：管理 6 条场值（体力 `energy` / 刺激 `stimulation` / 想念 `longing` / 社交 `social` / 好奇 `curiosity` / 创作 `creative`）、计算当前情绪（`readMood`）、运行**全局唯一的昼夜唤醒循环（`lifeTick`）**。
- **数据落点**：`<home>/data/persona/fields.json`（只存 6 场值 + `lastAppliedAt`）与 `runtime.json`（当前作息阶段、近期状态变迁链 `chain`）。
- **给她的工具**：`mood_read`（读当前场值与心情）、`mood_apply`（事件引起场值变化）。
- **给主人的操作台【鱼缸与作息遥控台】**：
  1. **场值实时滑块与心情覆盖**：6 条场值不仅能看，每条旁边直接带滑块与 `+ / -` 微调按钮，改完点保存立即写回 `fields.json`；
  2. **作息遥控按钮**：**「⚡ 立即戳醒她（马上跑一轮唤醒）」**、**「🌙 强制休息 / ☀️ 恢复自然作息」**；
  3. **节律参数热改**：唤醒评估间隔（默认 3–7 分钟）、各场值自然衰减/恢复速率，直接在面板表单里改。

### 3.2 `cap-memory`（记忆系统扩展）

- **职责边界**：管理她的四层长期与短期记忆（`core` 核心常驻 / `active` 近期活跃 / `archived` 远期归档 / `voided` 已作废），在每次收到任何渠道消息时（经 `onMessageDelivery`）结合当前 `mood` 自动执行 `recallMemories()` 打分召回，并支持每日衰减结算（`settle`）。
- **数据落点**：`<home>/workspace/memo/{core,active,archived,voided}/<id>.md`（单条记忆为带 front-matter 的 Markdown 卡片，底层由 Git 版本化留痕，彻底废除旧 `fields.json` 里硬截断 200 条的黑盒数组）。
- **给她的工具**：`memory_remember`（记一笔，支持 `flashbulb` 首次里程碑）、`memory_recall`（主动按词翻旧账）、`memory_void`（点名作废一条错误记忆并留理由）。
- **给主人的操作台【记忆管理中心】**（彻底解决"记忆为什么不可查、不可控"）：
  1. **全量可视化列表与检索**：按四层页签（核心 / 活跃 / 归档 / 已作废）、按标签、按关键词全文搜索；每张卡片明示鲜活度（`vividness`）、被想起次数（`accessCount`）、创建时间、来源；
  2. **「+ 塞一条记忆给她」**：主人直接在页面输入正文、打标签、选层级（比如直接塞进 `core` 常驻），保存后她下一轮立刻记得；
  3. **在线编辑与层级调动**：点开任意一条记忆直接改错别字、调鲜活度权重、一键「置顶进核心常驻」或「降级归档」；
  4. **一键作废与恢复**：勾选或点一下即可作废（移入 `voided/`），误作废的可在 `voided` 页签一键恢复。

### 3.3 `cap-journal`（日记、判断卡与意见箱扩展）

- **职责边界**：管理她的公开日记、私人日记、看片审美判断卡（`judgments`）、以及她向主人提的意见箱（`feedback`）。
- **数据落点**：`<home>/workspace/diary/{public,private}.md`、`<home>/workspace/judgments.md`、`<home>/data/persona/feedback.jsonl`。
- **给她的工具**：`diary_read`、`diary_write`（按日期与小节幂等更新/追加）、`judgment_read`、`judgment_write`、`feedback_submit`。
- **给主人的操作台【日记、判断与意见工作台】**：
  1. **两本日记在线编辑器**：按日期树/小节浏览公开与私人日记，支持全文搜索；点「编辑」直接在网页 Markdown 编辑器里改内容或修错位日期，保存时自动提交一次工作区 Git 记录；
  2. **审美判断卡独立视图**（解决意见箱 `f-d99d64`）：表格展示她看过的每个视频/UP 主、结论（`keep / drop / unclear`）、打分与理由；主人可在页面上筛选、搜索、直接修改她的判断或加备注；
  3. **意见箱闭环操作**：每条她提的意见旁，除了「标为已解决」，新增**「写主人批复（下一轮注入给她）」**和**「一键转成看片屏蔽词 / 偏好规则」**。

### 3.4 `cap-bilibili`（B 站整域扩展——收编原 dsh 全部 43 条命令，零 `spawn`）

- **职责边界**：所有跟 B 站平台相关的入站感知、浏览看片、出站表达与互动、以及不可逆写动作的单点安全把关链，整块聚在此包内。**彻底取消独立的 `dsh CLI` 进程调用层**，原 43 条命令全部改为包内进程级 Typed API（仅保留一个薄壳 `src/cli.ts` 供命令行手工排障）。
- **内部四大模块**：
  1. **`inbox.ts`（四路入站合一）**：把私信（`dm-await`）、回复我的（`msgfeed/reply`）、@我的（`msgfeed/at`）、收到的赞（`msgfeed/like`）收口为统一的 `InboxClient.peek/ack`。轮询到新互动时主动向宿主推事件帧唤醒她，不再等她自己想起来去翻。
  2. **`client/{feed,watch,publish,interact}.ts`（全量 B 站手脚 Typed API）**：
     - 感知工具：`bili_inbox_read`、`bili_inbox_ack`、`bili_feed`、`bili_debrief`（视频+弹幕+热评）、`bili_subtitles`、`bili_search`、`bili_comments` / `bili_thread`、`bili_whois`、`bili_dynamic_recent`。
     - 行动工具：`bili_dynamic_draft`、`bili_dynamic_edit`、`bili_comment`（发/回评论）、`bili_danmaku`（发弹幕）、`bili_dm_reply`（回私信）、`bili_like`、`bili_fav`。
  3. **`domain/gate/WriteGate.ts`（唯一不可逆写把关链）**：所有对外写动作强制走同一入口（详见 §5）。
  4. **`config.ts`（策略、额度与偏好 Schema）**：8 个发送档位、额度、冷却、看片偏好全部声明为 JSON Schema。
- **给主人的四大操作台**：
  1. **【B 站四路收件箱与指派台】**：实时列出私信、评论回复、@、赞四路消息及她是否已读；主人可在任意一条旁直接点：**「👉 让她回这条（可附主人叮嘱）」「✍️ 我替她拟草稿」「✓ 标为已读忽略」「🚫 拉黑此用户」**；
  2. **【统一待放行与改稿工作台】**：把动态草稿、私信回信草稿、待审评论、待审弹幕合并进**同一个队列**；每条支持：**直接在线编辑正文（保存时自动重算 `bodyHash` 并续签一次性令牌，彻底解决改一个错别字就被哈希校验拒发的卡点）**、**换配图**、**填理由打回重写**、**「✓ 一键放行」**，以及**主人手动输入 BV 号/话题点「让她现在写一条」**；
  3. **【看片偏好与过滤规则台】**：可视化增删 `like`（喜欢分区/话题）、`dislike`（讨厌词）、`keywords`（搜索词）、关注 UP 主豁免名单、短于 N 分钟跳过阈值，随改随生效；
  4. **【安全闸、配额与风控总控台】**：8 个发送档位下拉框（`draftMode / like / fav / dmReply / comment / danmaku / autoDailyCap / autoWindow`）、每日自主/分享配额、写间隔冷却秒数、**「🛑 一键急刹（kill）」开关**、412 风控熔断倒计时与手动解除按钮。

### 3.5 `cap-media-studio`（音视频创作扩展）

- **职责边界**：把 `video-build`（MiMo TTS 茉莉音色 + CC0 BGM 曲库 + `dsh-video-studio` 视频与 9:16 / 16:9 双封面合成）封装为独立能力扩展。
- **给她的工具**：`media_tts_preview`、`media_video_build`。
- **给主人的操作台【音视频工作台】**：选日常底图、改朗读台词、选 BGM 曲目与音量、点「🔊 试听 TTS 语音」、点「🎬 合成视频草稿并送入 B 站待放行队列」。

---

## 4. Cortico 专用薄转接头（怎么把 5 个能力包插上 Cortico 主板）

Cortico 宿主只定义了 `bot`（唯一大脑插孔，契约版本 `api: 7`）和 `world`（外部环境插孔，契约版本 `api: 6`，见 `Cortico-up/src/extensions/manifest.ts:23-27`）两类功能插槽。我们用两个极薄的转接头包完成对接：

### 4.1 `cortico-bot-xiaoyu`（`kind: "bot", api: 7`）—— 对内「一拖三转接坞」

- **挂载的三个能力包**：`cap-state-rhythm`、`cap-memory`、`cap-journal`。
- **为什么这三个必须插在 `bot` 转接坞上（契约硬约束）**：
  1. 只有 `Persona.systemSegments()` 和 `Persona.onDelivery()`（`src/core/types.ts:1018, 1031`）能看到**所有渠道**（控制台聊天、B 站私信、未来的桌宠/QQ）进来的消息，并在她回答前注入同一份心情与召回记忆——这直接根治"鱼缸里的她和控制台里的她不是同一个人"；
  2. 框架规定 `World` 绝不写 `Memory`（`AGENTS.md` 边界 3），只有 `Persona` 持有 `memoryDir` 与 `BlobStore`；
  3. `BotParts.onStart`（参考 `bots/corti-soulmate/index.ts:83-89`）是框架原生的昼夜心跳入口，挂在这里天然保证全局只有一个生活 `tick`。

### 4.2 `cortico-world-bilibili` 与 `cortico-world-media`（`kind: "world", api: 6`）—— 对外插头

- `cortico-world-bilibili` 将 `cap-bilibili` 包装为 `WorldDefinition`（World ID 沿用 `bili-account`：删掉 `Cortico/src/worlds/index.ts:18` 的内建注册即可释放该 ID，现有配置键 `worlds.bili-account` 与路由零迁移；注意不能叫 `bilibili`，该 ID 已被上游直播 World 预占，`src/launcher.ts:173-175`）。
- `cortico-world-media` 将 `cap-media-studio` 包装为独立 `WorldDefinition`（可在 WebUI 世界页随时单独开关）。

---

## 5. 唯一不可逆写把关链（`WriteGate`）

这是全系统唯一不可绕过的对外写通道（位于 `cap-bilibili/src/domain/gate/`），修掉现状里"点赞/收藏不过 quota、弹幕过 quota 不记账、评论/弹幕/动态成功不写 causal、待放行队列裂成两套"四个漏洞：

```
任何 B 站写动作 (dynamic / edit-dynamic / comment / danmaku / dm / like / fav)
  └─ WriteGate.execute(action)
       ① kill 急刹检查（入口判一次 + 网络写前再判一次，防入队后开急刹的时间差）
       ② 档位判定（读 config.ts 唯一策略源）
            └─ 若需人工放行 → WriteGate.enqueue(action) 进统一待放行队列 → 返回 needs-approval
       ③ 内容判据（独立小模块：@主人校验 / 30天同人去重 / 收藏五判据 / 私信7天回信窗）
       ④ quota 额度检查（自主额度 / 分享额度）
       ⑤ traffic 冷却 / 预算 / 412 风控熔断 / url+bodyHash 防重发指纹
       ⑥ 真实网络写（plainOutbound 清洗在 WriteAction 构造处一次性完成）
       ⑦ 单点记账 causal.jsonl（成功记 <kind>，失败记 <kind>-failed + stage:'gate'|'transport'|'platform'）
```

统一退出码语义：`0` 成功 · `2` 闸门/策略/配额拒 · `3` 前置条件缺失 · `4` 传输层/冷却/412 风控拒 · `5` 素材不合法 · `6` 平台业务码拒（`code != 0`）· `-2` `kill` 急刹拦截。

---

## 6. 仓库与磁盘终态布局（1 个产品仓 ＋ 1 个可搬迁数据目录）

1. **宿主底座 `Cortico/`**：移除 `src/worlds/bili-account` 与 `persona-core`，恢复 100% 纯净上游，仅通过 `extensions/` 挂载我们的转接头包。
2. **唯一产品代码仓 `xiaoyu/`（单仓 `pnpm-workspace`，取代双仓横跳）**：
   ```
   xiaoyu/
   ├── pnpm-workspace.yaml
   └── packages/
       ├── persona-core/            ← @xiaoyu/persona-core（纯函数 + XiaoyuCapability 契约）
       ├── cap-state-rhythm/        ← 扩展 1：状态与作息 + 鱼缸遥控面板
       ├── cap-memory/              ← 扩展 2：四层记忆库 + 记忆增删改查面板
       ├── cap-journal/             ← 扩展 3：日记/判断卡/意见箱 + 在线编辑与批复面板
       ├── cap-bilibili/            ← 扩展 4：B 站整域（含原 dsh 43 命令）+ 四大操作台
       ├── cap-media-studio/        ← 扩展 5：音视频创作 + 试听合成面板
       ├── cortico-bot-xiaoyu/      ← Cortico 薄转接头 A（kind=bot, api=7）
       └── cortico-world-bilibili/  ← Cortico 薄转接头 B（kind=world, api=6, id=bili-account）
   ```
3. **唯一数据与部署目录 `xiaoyu-home/`（路径由配置声明，可整体备份搬迁，收掉三盘四家）**：
   ```
   xiaoyu-home/
   ├── deployment.json              ← {"bot": "cortico-bot-xiaoyu"}
   ├── config.json                  ← 唯一配置源（唯一 owner，消灭双份默认声明）
   ├── .env                         ← 凭据（仅本机可读）
   ├── prompts/                     ← CONSTITUTION.md · ORIENTATION.md
   ├── workspace/                   ← Git 版本化的内容根
   │   ├── MEMORY.md
   │   ├── memo/{core,active,archived,voided}/
   │   ├── diary/{public,private}.md
   │   ├── judgments.md
   │   └── blobs/
   └── data/
       ├── persona/                 ← fields.json · runtime.json · feedback.jsonl
       ├── bilibili/                ← causal.jsonl · traffic-state.json · quota.json · pending-queue.json
       └── media/                   ← assets/daily/*.png · drafts/<date>.json
   ```

---

## 7. 落地原则（新旧并行、一步到位、绝不返工）

1. **不做「先在旧架构用 `spawn argv` 补工具、再搬进新包重写一遍」的双份工**：新能力（四路收件箱、评论/弹幕工具、各可写操作面板）直接在新的 `cap-*` 扩展包里按 Typed API 一步写好。
2. **不断现网 live**：现有 `Cortico-up`（7799 端口）在旁边照常运行不动；新包在独立目录、副本数据树与备用端口（如 7798）完成开发、自动化测试与主人真浏览器走查验收后，再一次性切换正式环境。
3. **未审不落仓、未批不开工**：任何阶段性代码动手前，先由主人指定本次要动哪一个包。

---

## 8. 现有 16,015 行代码与 444 项测试逐文件复用映射表（施工对照单）

> **铁律：不丢任何一条已验证的业务细节与历史修复。** 动手搬迁任何一个包时，必须逐行核对下表列出的「历史已修细节」，严禁退化。

### 8.1 `Cortico-up/persona-core/src/`（16 个文件 / 2,054 行 → 100% 原样进 `packages/persona-core/`）

| 现有文件 | 行数 | 必须保留的已实现能力与细节 | 目标落点 |
|---|---|---|---|
| `emotion.ts` | 170 | `readMood` 含 `action` 成因、阈值已由 0.25 调为 `0.2`（D1 修复） | `packages/persona-core/src/emotion.ts` |
| `emotion-projection.ts` | 83 | 场值到情绪向量的投影计算 | `packages/persona-core/src/emotion-projection.ts` |
| `rhythm.ts` | 130 | 状态驱动的醒/睡/待机评估（`MAX_ACTIONS_PER_DAY=Infinity`、`MIN_GAP_MS=0`，靠体力/事件自然收敛，日界 `00:00`） | `packages/persona-core/src/rhythm.ts` |
| `npc-state-machine.ts` | 183 | 状态机转移与持续时间计算 | `packages/persona-core/src/npc-state-machine.ts` |
| `life-activities.ts` | 118 | 日常微活动生成（称呼只读 `naming.ts`） | `packages/persona-core/src/life-activities.ts` |
| `decay.ts` | 113 | 场值与记忆鲜活度随时间纯函数衰减 | `packages/persona-core/src/decay.ts` |
| `effect-bus.ts` | 129 | 事件对 6 场值的增减叠加与上下界夹紧 | `packages/persona-core/src/effect-bus.ts` |
| `budget.ts` | 84 | 体力/精力预算计算 | `packages/persona-core/src/budget.ts` |
| `memory.ts` | 172 | `Memory` 条目构建、闪光灯记忆判定、作废章字段 | `packages/persona-core/src/memory.ts` |
| `retrieval.ts` | 212 | `recallMemories()` 打分 `0.40*关键词+0.30*vividness+0.15*情绪贴合+0.15*新近`，`core / surprise` 双槽与 `why[]` 解释 | `packages/persona-core/src/retrieval.ts` |
| `voice-brief.ts` | 140 | `buildVoiceBrief`（L3 纯函数，A1 标签全覆盖、低落只留一句、冷战略称） | `packages/persona-core/src/voice-brief.ts` |
| `causal-chain.ts` | 234 | 短期因果链构建与最近成因摘要 | `packages/persona-core/src/causal-chain.ts` |
| `conversation-assessment.ts` | 124 | 对话互动后的状态与印象评估 | `packages/persona-core/src/conversation-assessment.ts` |
| `naming.ts` | 17 | `owner.displayName` 唯一称呼收口（不回落角色标签 `owner.name`） | `packages/persona-core/src/naming.ts` |
| `types.ts` + `index.ts` | 145 | 全部核心类型与导出（新增 `capability.ts` 声明 `XiaoyuCapability` 接口） | `packages/persona-core/src/{types,capability,index}.ts` |

### 8.2 `Cortico-up/src/worlds/bili-account/`（17 个文件 / 4,139 行 → 按职责拆入 4 个能力包）

| 现有文件 | 行数 | 必须保留的历史修复与核心逻辑 | 目标落点 |
|---|---|---|---|
| `life-stages.ts` | 97 | 生活循环五阶段纯函数（对账→睡着恢复→决策→动作成本→记账） | `packages/cap-state-rhythm/src/life-stages.ts` |
| `personaAdapter.ts` (上半：场值/状态段) | ~240 | `loadState/saveState` 原子写 + `.bak` 坏文件恢复；`watchedVideo` 的 `verdict: keep/drop/unclear` 三值（仅 `keep` 给正加成） | `packages/cap-state-rhythm/src/state-store.ts` |
| `personaAdapter.ts` (下半：记忆段) | ~220 | `remember`、`rememberFirst`（仅第一次点亮 flashbulb）、`voidMemory`（唯一命中+理由≥6字）、`applyRecall`（鲜活度升+计数+1） | `packages/cap-memory/src/memory-ops.ts`（结合 `GitWorkspaceMemory`） |
| `diary.ts` | 321 | `upsertDiarySection`（按日期块幂等替换/追加、清理历史重复 heading）、按天/按节/summary 检索 | `packages/cap-journal/src/diary.ts` |
| `dm.ts` + `dm-reply.ts` | 134 | 私信列表解析；**B 站 10 位秒时间戳转毫秒修复**；`max(lastDmReadAt, lastInboundAt)` 7 天回信窗口 | `packages/cap-bilibili/src/client/dm.ts` |
| `gates.ts` + `causal-io.ts` + `task-queue.ts` | 167 | 出稿前纪律闸（debrief/日记新鲜度）、`causal.jsonl` 宿主侧写入、at-least-once 持久化任务队列 | `packages/cap-bilibili/src/domain/{discipline,causal,task-queue}.ts` |
| `config-store.ts` + `paths.ts` | 231 | **8 个发送策略档位读写（含 `comment`/`danmaku`）**、测试上下文拒写生产配置护栏（11-01 事故修复）、`DSH_HOME` 路径解析 | `packages/cap-bilibili/src/config.ts` |
| `definition.ts` + `tool-decls.ts` + `prompts.ts` + `capability.ts` | 1,372 | 工具声明与执行绑定、**被拒的稿不再算"今天已有稿"而提示照理由重写**（`7ccd96b`）、`auto` 生效强制写私人日记通知 | 对内状态/日记段进 `cap-state-rhythm` / `cap-journal`；B 站段进 `cap-bilibili` |
| `tank.ts` + `webui/client.ts` | 1,336 | 现有面板后端数据聚合与前端 DOM（含评论/弹幕策略下拉、待放行队列放行/丢弃按钮、58 项配置总览） | 拆入各包 `src/panel/`，并按 §10 升级为全可写控件 |
| `runner.ts` | 21 | `spawnSync` 调外部 CLI | **唯一废弃删除**（改为进程内 Typed 函数调用） |

### 8.3 `dsh-bili-whale/`（70+ 个文件 / 9,822 行 + 80 个测试文件 → 收编入包，消灭双仓）

| 现有模块 / 目录 | 行数 | 必须保留的历史修复与核心逻辑 | 目标落点 |
|---|---|---|---|
| `tools/lib/{traffic,quota-gate,kill,go-gate,go-rebuild,pending-queue,publish-policy,plain-outbound,write-refusal,state-lock}.mjs` | 917 | 412 风控自动暂停、`url+body` 操作指纹防重发、`ack` 令牌绑 `draftId+textHash`、`plainOutbound` 去 `**` 与未闭合书名号、写失败不崩栈且记 `<kind>-failed` | `packages/cap-bilibili/src/domain/gate/`（合成唯一 `WriteGate`） |
| `tools/drafts/{compose,store,publishers/bilibili-dynamic}.mjs` | 665 | `composeDraft` 吃 `voice` 与记忆 slot（10 状态变体产出两两不同）、嵌套书名号提取修复、图文与纯文字发布唯一实现 | `packages/cap-bilibili/src/drafts/` |
| `tools/lib/msgfeed.mjs` + `tools/commands/{comment-await,comment-digest,likes,dm-await}.mjs` | 430 | 回复我的 / @我的 / 收到的赞 / 私信四路收件箱底层拉取与楼层最新正文解析 | `packages/cap-bilibili/src/client/inbox.ts` |
| `tools/lib/{dm-send-core,dm-drafts,dm-history,feed-quality,feed-feedback,cred,report}.mjs` + 其余 `tools/commands/*.mjs` | ~5,400 | 推荐流 `[短于10分钟：跳过]` / `[同UP第N条：不深读]` 标注、点赞 30 天本地账去重防 toggle 取消、收藏五判据、`dynamic recent` 翻页核验 | `packages/cap-bilibili/src/client/{feed,watch,publish,interact}.ts` + 薄壳 `src/cli.ts` |
| `tools/lib/{judgment,feedback}.mjs` + `tools/commands/{diary,judgment,feedback}.mjs` | 527 | 判断卡读写、意见箱折叠统计规则（`70f58f1` 已解决项不再点亮未解决灯） | `packages/cap-journal/src/` |
| `tools/media/{tts,bgm,video/studio,config}.mjs` + `tools/video-build.mjs` + `vendor/dsh-video-studio` + `assets/bgm/` | ~600+ | MiMo TTS（`mimo-v2.5-tts` 茉莉音色）+ CC0 BGM 曲库 + 9:16/16:9 双封面与视频合成 | `packages/cap-media-studio/` |
| `core/ports/temporal.mjs` | 54 | 时间窗口纯函数 | 并入 `packages/persona-core/`（移除 AMpath 注释引用） |
| `adapters/opencode/` | — | OpenCode 宿主 daemon + MCP 适配器 | `packages/adapter-opencode/`（第二宿主插座） |
| `core/scheduler.js` + `panel/server.js` | 986 | 10-27 已停用的旧打卡器与 10-31 已退役的 8447 独立面板 | 移入 `legacy/` 归档封存 |
| `tests/**/*.test.mjs`（80 个文件 / 444 项测试） | — | 全套契约测试、权限档位、草稿耦合、私信时效等 | **继续使用 `node:test` 运行**（不改写为 vitest，100% 继承 444 项回归门禁） |

---

## 9. 多仓库收口方案与存量真实数据无损接管表

### 9.1 本地 4 处目录与 2 个 GitHub 仓库的处置

| 位置 | 现状 | 收口动作 |
|---|---|---|
| `E:\WorkSpace_Qoder\dsh-bili-whale`（远端 `biandeshen/dsh-bili-whale-port`） | 当前 CLI 仓（含 240+ 提交、`port-0.5.2` tag、80 测试文件、全部 `docs/`） | **原地升级为唯一主力产品仓**：根下建 `pnpm-workspace.yaml` 与 `packages/`，承接全部 8 个包（`persona-core` + 5 个 `cap-*` + 2 个 `cortico-*` 转接头），历史与测试零丢失 |
| `E:\WorkSpace_Qoder\Cortico-up` | `Cortico` 的 git worktree，当前跑着 7799 现网 live | **施工期保持运行不动**；新包在备用端口验通并切换后，卸载该 worktree 目录 |
| `E:\WorkSpace_Qoder\Cortico`（远端 `biandeshen/Cortico-local`） | 宿主主仓（master） | 切换完成后，删掉里面寄居的 `src/worlds/bili-account` 与 `persona-core`，恢复为 **100% 纯净上游 Cortico 插座**，通过 `extensions/` 软链加载 `dsh-bili-whale/packages/cortico-*` |
| `E:\WorkSpace_Qoder\_retired-2026-11-02` 與 `AMpath` | 退役工作树备份（41M）与早期参考仓 | `_retired` 按约留至 `2026-11-09` 后删除；`AMpath` 移出工作区归档 |

### 9.2 存量真实数据无损接管映射表（她半个月攒下的记忆、日记、账本一条不丢）

迁移脚本遵循 `migrate-state-roots.mjs` 规范：**默认 `--dry` 只打印差异 → `--apply` 原子复制转换并记 `ledger.json`（原文件原封不动保留做备份）→ `--rollback <id>` 随时一键回退**。

| 存量真实数据（现状位置与实测规模） | 装的是什么 | 新架构接管方式与目标位置 |
|---|---|---|
| `C:\Users\Administrator\.dsh\bili-whale\fields.json`（71 KB） | ① 6 条场值 `fields` + `lastAppliedAt`；② **60 条情绪记忆 `memories[]`**；③ **68 条因果链 `chain[]`** + `npcState/budget/emotionHistory` | 一拆三（无损）：<br>① 6 场值 → `<home>/data/persona/fields.json`<br>② 60 条记忆 → 逐条转为 `<home>/workspace/memo/{core,active,voided}/<id>.md`（`flashbulb:true` 进 `core/`，`voided:true` 进 `voided/`，其余进 `active/`，front-matter 完整保留全部 11 个字段）<br>③ 68 条链与状态机 → `<home>/data/persona/runtime.json` |
| `C:\Users\Administrator\.dsh\whale-diary.md`（50 KB）与 `whale-diary-private.md`（65 KB） | 她写下的全部公开日记与私人日记 | 原样迁入 `<home>/workspace/diary/public.md` 与 `private.md`，并做初始 Git commit |
| `Cortico\deployments\mybot\workspace\`（10 文件 / 2.4 MB） | `CONSTITUTION.md`、`judgments.md`（4 KB）、`handoffs/`、`blobs/` | 原样迁入 `<home>/workspace/` 与 `<home>/prompts/` |
| `C:\Users\Administrator\.dsh\bili-whale\causal.jsonl`（207 行 / 54 KB） | 全部历史行为因果审计账 | 原样迁入 `<home>/data/bilibili/causal.jsonl` |
| `C:\Users\Administrator\.dsh\bili-ai\{traffic-state,dm-quota,favorites,pending-replies,dm-await-state}.json` | 风控状态、点赞/收藏去重账、待放行队列、私信游标 | 原样迁入 `<home>/data/bilibili/` |
| `C:\Users\Administrator\.dsh\bili-whale\days\2026-*` | 每日首末状态快照与反事实评测基线 | 原样迁入 `<home>/data/persona/days/`，`counterfactual.mjs` 兼容新旧两种格式 |
| `D:\AI\养鱼\assets\daily\*.png` 与 `drafts\*.json` | 日常配图素材与历史动态草稿 | 路径由 `config.json` 声明（可直接指向 `D:\AI\养鱼\` 原地不动，或迁入 `<home>/data/media/`） |

---

## 10. 五大能力扩展的主人操作台 RPC 接口与前端控件规格表

> **硬性验收标准**：以下每一个 RPC 方法都必须在真浏览器里点通、改完落盘、刷新后数值保持，绝不允许只画静态 DOM 或留空按钮。

### 10.1 `cap-state-rhythm` 面板：`tank`（鱼缸与作息遥控台）

| 方法名 (`invoke`) | 入参 | 作用与落盘动作 | 前端必须渲染的交互控件 |
|---|---|---|---|
| `getSnapshot` (GET) | `{}` | 返回 6 场值、当前情绪与成因、当前作息阶段（醒/睡/待机）、下次评估倒计时、最近 20 条状态变迁链 | 鱼缸头像、心情徽章、6 条带数值的场值进度条、最近变迁时间线 |
| `setFields` (POST) | `{ patch: Partial<Fields>, note?: string }` | 直接修改 1~6 条场值（`0.0 ~ 1.0`），写回 `fields.json` 并在 `chain` 记一笔 `owner_adjust` | 每条场值旁配**可拖动滑块 + `-0.1 / +0.1` 步进按钮 +「保存修改」** |
| `wakeNow` (POST) | `{ hint?: string }` | 立即中断当前 `setTimeout` 等待，马上触发一轮 `lifeTick`（可选附带一句主人提示，如"去看看收件箱"） | 醒目的 **「⚡ 立即戳醒她（马上跑一轮）」** 按钮 + 可选叮嘱输入框 |
| `setMode` (POST) | `{ mode: 'auto' \| 'force_sleep' \| 'force_awake' }` | 切换作息模式（自然节律 / 强制休息不外出 / 保持清醒） | 三档分段开关（Segmented Control） |

### 10.2 `cap-memory` 面板：`memory-center`（记忆管理中心）

| 方法名 (`invoke`) | 入参 | 作用与落盘动作 | 前端必须渲染的交互控件 |
|---|---|---|---|
| `list` (GET) | `{ tier?: 'all'\|'core'\|'active'\|'archived'\|'voided', query?: string, tag?: string }` | 检索并返回记忆卡片列表（含 `id/content/tags/vividness/accessCount/createdAt/flashbulb/voidedReason`） | 顶部**搜索框 + 四层页签切换 + 标签过滤胶囊**；卡片列表展示全部元数据 |
| `create` (POST) | `{ content: string, tags: string[], tier: 'core'\|'active', vividness?: number }` | 主人直接新建一条记忆写入 `workspace/memo/<tier>/<id>.md` 并自动 Git commit | **「+ 塞一条记忆给她」** 弹窗/表单（正文框、标签输入、是否置入核心常驻开关） |
| `update` (POST) | `{ id: string, content?: string, tags?: string[], vividness?: number, tier?: 'core'\|'active'\|'archived' }` | 修改已有记忆正文、标签、鲜活度权重，或在 `core / active / archived` 之间移动文件 | 每张记忆卡片上的 **「编辑正文/标签」「⭐ 置顶进核心」「📥 归档」** 按钮与鲜活度滑块 |
| `void` (POST) | `{ id: string, reason: string }` | 作废一条错误记忆（`voided: true` 并移入 `memo/voided/`） | 卡片上的 **「🚫 作废」** 按钮（点击输入理由） |
| `restore` (POST) | `{ id: string, targetTier?: 'active'\|'core' }` | 将误作废的记忆从 `memo/voided/` 恢复回 `active/` 或 `core/` | `已作废` 页签下的 **「↩ 恢复」** 按钮 |

### 10.3 `cap-journal` 面板：`journal-board`（日记、判断卡与意见箱工作台）

| 方法名 (`invoke`) | 入参 | 作用与落盘动作 | 前端必须渲染的交互控件 |
|---|---|---|---|
| `getDiary` (GET) | `{ book: 'public'\|'private', date?: string, query?: string }` | 按本（公开/私人）、按日期块或关键词读取日记内容与日期目录树 | 左侧**日期列表树 + 公开/私人切换 + 搜索框**，右侧日记渲染视图 |
| `saveDiarySection` (POST) | `{ book: 'public'\|'private', date: string, heading?: string, markdown: string }` | 在线修改某天（或整块）日记正文，修错位日期或格式，原子写入并生成 Git commit | 日记右上角 **「✏️ 在线编辑」** 切换为 Markdown 编辑框 + **「💾 保存并提交」** |
| `listJudgments` (GET) | `{ verdict?: 'keep'\|'drop'\|'unclear', query?: string }` | 读取 `judgments.md` 结构化列表（视频 BV / UP 主 / 结论 / 理由 / 时间） | **【审美判断卡】独立页签**：表格视图 + `keep/drop/unclear` 筛选器 |
| `upsertJudgment` (POST) | `{ id: string, verdict: 'keep'\|'drop'\|'unclear', note: string }` | 主人修改或新增一条判断卡结论 | 判断卡表格行内的**结论下拉框 + 备注编辑 + 保存** |
| `listFeedback` (GET) | `{ status?: 'open'\|'resolved'\|'all' }` | 按折叠去重规则列出她的意见箱条目 | **【意见箱】独立页签**：未解决/已解决筛选、连报次数角标 |
| `replyFeedback` (POST) | `{ id: string, ownerReply?: string, resolve: boolean, convertRule?: { kind: 'dislike'\|'keyword'\|'exemptUp', value: string } }` | 标为已解决、写入**主人批复**（下一轮自动注入她的上下文），或一键把她的抱怨转成看片过滤规则 | 每条意见下的 **「💬 写批复并解决」「➕ 一键转屏蔽词/偏好规则」「✓ 仅标已解决」** |

### 10.4 `cap-bilibili` 面板：四大操作台（`inbox` · `drafts-queue` · `preferences` · `gate-policy`）

| 面板 / 方法名 | 入参 | 作用与落盘动作 | 前端必须渲染的交互控件 |
|---|---|---|---|
| `inbox.list` (GET) | `{ kind?: 'all'\|'dm'\|'reply'\|'mention'\|'like', unreadOnly?: boolean }` | 列出四路收件箱条目（发送者、内容、关联 BV/楼层、时间、她是否已读/已回） | **【B 站收件箱】页签**：私信/回复/@/赞四路筛选 + 未读高亮列表 |
| `inbox.assignAction` (POST) | `{ itemKey: string, action: 'ask_her_reply'\|'ignore'\|'block_user', ownerHint?: string }` | 指派她回复该条消息（可附主人叮嘱推入唤醒事件）、直接标已读忽略、或拉黑该 UID | 每条消息右侧：**「👉 让她回这条」「✓ 忽略已读」「🚫 拉黑」** |
| `queue.list` (GET) | `{}` | 统一返回所有待放行项（**动态草稿 + 私信草稿 + 待审评论 + 待审弹幕**四合一） | **【统一待放行与改稿台】页签**：分类徽章、正文、配图预览、创建时间 |
| `queue.updateDraft` (POST) | `{ id: string, text: string, imagePath?: string }` | **在线修改待审草稿的正文或配图，并自动重算 `bodyHash` 续签一次性令牌**（改字后直接可发，不再报错） | 每条待审项自带**可编辑文本框 + 配图更换器 +「保存修改」** |
| `queue.release` (POST) | `{ id: string }` | 校验最新 `bodyHash` 后经 `WriteGate` 立即发布，记 `causal.jsonl` | **「✓ 放行发布」** 按钮 |
| `queue.reject` (POST) | `{ id: string, reason: string, askRewrite: boolean }` | 拒掉该条待审项；若勾选 `askRewrite` 则把拒稿理由注入她下一轮让她重写 | **「✗ 拒掉 / 打回重写」** 按钮 + 理由输入框 |
| `queue.requestNew` (POST) | `{ kind: 'dynamic'\|'comment', bvid?: string, prompt: string }` | 主人主动点单：指定一个 BV 号或话题，让她写一篇动态或评论草稿进队列 | 面板顶部 **「+ 点单让她写一条」** 快捷栏 |
| `prefs.get / prefs.set` | `{ like: string[], dislike: string[], keywords: string[], exemptUps: string[], minDurationSec: number }` | 读写看片偏好、屏蔽词、关注 UP 主豁免名单、短视频跳过阈值 | **【看片偏好与过滤】页签**：胶囊标签增删器（点 `×` 删、回车加）+ 时长数字框 |
| `gate.get / gate.set` | `{ policy, quota, traffic, killOn: boolean }` | 读写 8 个发送策略档位、每日自主/分享配额、写冷却秒数、急刹开关、手动解除 412 风控暂停 | **【安全闸与风控】页签**：**顶部红色「🛑 一键急刹 (Kill)」大开关** + 412 状态条与「解除冷却」按钮 + 8 个档位下拉框 + 配额/冷却输入框 |

### 10.5 `cap-media-studio` 面板：`media-studio`（音视频工作台）

| 方法名 (`invoke`) | 入参 | 作用与落盘动作 | 前端必须渲染的交互控件 |
|---|---|---|---|
| `listAssets` (GET) | `{}` | 列出可选日常底图（`assets/daily/*.png`）、CC0 BGM 曲库、已生成的音视频产物 | 底图缩略图网格 + BGM 下拉选择器 + 历史成片列表 |
| `previewTts` (POST) | `{ text: string, voice?: string }` | 调 MiMo TTS 生成试听音频并返回本地试听流 URL | 台词多行输入框 + **「🔊 试听语音」** 播放器 |
| `buildVideoDraft` (POST) | `{ image: string, text: string, bgmId: string, durationSec: number }` | 合成 1080×1920 视频 + 9:16/16:9 双封面，并可一键推入 `cap-bilibili` 待放行队列 | **「🎬 合成视频草稿」** 按钮 + 视频预览播放器 + **「送入待放行队列」** 按钮 |

---

## 11. 分包施工顺序（等你下令开工时按此顺序逐包交付）

每一包都在 `E:\WorkSpace_Qoder\dsh-bili-whale\packages\` 下独立建包、独立过测试，**全程不碰现网 7799 进程，直到第 5 步你在备用端口真浏览器验收满意后才切 live**：

1. **Step 1 · 地基包 `@xiaoyu/persona-core`**：把 16 个纯函数文件（2,054 行）迁入 `packages/persona-core/`，补上 `XiaoyuCapability` 统一契约定义 `capability.ts`，跑通全部纯函数单测。
2. **Step 2 · 三个对内能力包（`cap-state-rhythm` + `cap-memory` + `cap-journal`）+ 薄转接头 `cortico-bot-xiaoyu`**：按 §8.2 迁入状态、四层记忆、日记/判断/意见箱代码，按 §10.1–10.3 实现三个全可写操作面板，写好存量数据无损迁移脚本（`--dry` 预演通过）。
3. **Step 3 · 对外大包 `cap-bilibili` + 薄转接头 `cortico-world-bilibili`**：按 §8.3 收编 dsh 全部 43 条命令为进程内 Typed API，接通四路收件箱事件唤醒、补齐 `bili_comment`/`bili_danmaku`/`bili_dynamic_edit`、收口唯一 `WriteGate`，按 §10.4 实现四大操作台，原 80 个 `node:test` 测试文件全绿。
4. **Step 4 · 音视频包 `cap-media-studio` + 薄转接头 `cortico-world-media`**：迁入 `tools/media/*` 与 `vendor/dsh-video-studio`，实现 §10.5 试听与合成工作台。
5. **Step 5 · 备用端口（7798）整机联调与真浏览器走查 → 一键切 live → 清理旧工作树**：在 7798 端口挂齐全部扩展，逐项点通 §10 的所有写按钮与滑块，主人验收点头后切回 7799 正式环境，卸载 `Cortico-up` 冗余工作树。




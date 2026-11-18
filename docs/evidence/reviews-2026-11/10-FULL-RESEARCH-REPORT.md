# 小鱼项目 · 全面分析研究报告 v1

> 第三方评审 · 2026-11-14
> **来源说明**：本文每条结论都标了档位。**已验证**＝本组自己跑命令/读代码得出；**仅自述**＝文档或 commit 声称、本组未独立复核；**未查清**＝查过但证据不足，不填。
> **纪律**：不把"感觉"写成结论；不把一次采样外推成全量；不把"我搜不到"当成"不存在"（本轮已犯过两次，见 §8）。

---

## 0. 一句话

**她有 33 把工具、7 个能跑通的功能、786 次零报错的工具调用。真正的问题不在功能多少，而在三处「接管层」：模型看不见 B 站（提示词缺失）、一件小事被拆成十几轮模型调用（调度）、每轮背 71 万 token（上下文从不裁剪）。这三处修完之前，加任何新功能都是往漏水的桶里加水。**

---

## 1. 架构实况（已验证）

### 1.1 四层结构

```
宿主 Cortico-up（Pal-AI-Lab/Cortico 的 fork，你有 233 次提交）
   ├─ 你挂的 world：bili-account / media-studio / console / qq
   └─ 你挂的 bot：cortico-bot-xiaoyu
        ├─ persona-core（内核：场值/作息/检索/活动/契约，2565 行，跨包依赖 0）
        ├─ 4 个能力包（capability）：
        │    cap-state-rhythm 2694 行 / cap-memory 2509 / cap-journal 1834 / cap-vision 1363
        ├─ 2 个 world 包：
        │    cortico-world-bilibili 363 行（内含 cap-bilibili 5700 行的能力）
        │    cortico-world-media 202 行（内含 cap-media-studio 1120 行）
        └─ cortico-adapter 517 行（UI 契约与 helper，**import 语句 0 条** = 不反向依赖宿主）
```

### 1.2 接口纯度：这一关是真的过了（已验证）

| 判据 | 实测 |
|---|---|
| 能力包禁止 import 宿主 | `capability.ts` 头注写明三条铁律，含"严禁 import `cortico/*`" |
| UI 是否反向依赖 | `cortico-adapter/src/*.ts` **import 语句 0 条**；面板靠 `PanelCtx` 注入 `ui` |
| 谁发起模型调用 | 能力包与转接头里搜 `core.complete/chat/llm/generate`、`invokeModel`、`submitMessage` **全部 0 命中** → 模型由宿主发起 |
| 换转接头成本 | 服务端 0 行；带面板与数据家约定约 18–20 处 |

**结论**：最难的一关（接口纯度）已经过了，这不是宣传话术。

### 1.3 但"可插拔"没落地（已验证）

- 宿主 `extensions/package.json:5-7` 写死 `link:E:/WorkSpace_Qoder/...` 绝对路径；
- `build-webui.mjs:24` 构建时**借宿主自己的** `node_modules/esbuild`；
- 无 `engines`，Node 20+/22+/22.15+ 三处口径互斥；
- **内核有两份**：`Cortico-up/persona-core/src`（16 .ts）与本仓（21 .ts）同时被解析，15 文件字节级不同；
- **没有任何一次在第二个宿主上跑过**。`ec2a39d` 已判定只差 B 段（删宿主副本 + 防分叉门禁），标注"需批准"，至今未批。

### 1.4 依赖面（你问过"为什么赖别人"）

| 依赖 | 归属 | 能不能甩掉 |
|---|---|---|
| 宿主 Cortico | `Pal-AI-Lab/Cortico`（Phant），你的 fork 有 233 次提交 | 甩不掉，也不该甩：她靠插件挂在上面，宿主可独立升级 |
| 上游 dsh-bili-whale | `Alterssss/dsh-bili-whale`（MIT），你是移植分支 | 甩不掉：产品点子与 29 个命令的范式来自它 |
| `vendor/dsh-autocut`、`vendor/dsh-video-studio` | 上游侧工具 | 可以甩，但要先确认真身在哪 |
| **AMpath 借用件** | `docs/CREDITS.md:20` 自写"私有仓库、无 LICENSE，仅自用" | **已随旧树删除**（`core/ports/temporal.mjs` 在 `b2e9fe7` 里删掉了）✅ |
| 检索权重 0.40/0.30/0.15/0.15 | 出处是仓外的 AMpath | **无依据，是本仓自定**，specs 里应标清 |

---

## 2. 功能清点：33 把工具，7 个真能用（已验证）

### 2.1 全量工具表

| 域 | 工具 | 在不在 | 模型看得见 | 跑通过 |
|---|---|---|---|---|
| 内务 13 | `mood_read` `mood_apply` `life_do` `memory_remember` `memory_recall` `memory_void` `diary_read` `diary_write` `judgment_read` `judgment_write` `judgment_revisit` `feedback_submit` `see_video` | ✅ | ✅ | 部分 |
| B 站 18 | `bili_feed` `bili_search` `bili_watch` `bili_debrief` `bili_subtitles` `bili_comments` `bili_danmaku` `bili_whois` `bili_seek` `bili_inbox_read` `bili_inbox_ack` `bili_like` `bili_fav` `bili_comment` `bili_dynamic_draft` `bili_dynamic_recent` `bili_dynamic_edit` `bili_dm_reply` | ✅ | **⚠️ 需复核** | ❌ 0 次 |
| 出片 2 | `media_tts_preview` `media_video_build` | ✅ | **⚠️ 需复核** | ❌ 0 个 mp4 |

### 2.2 实测调用分布（13 个 run 的 `toolcalls.jsonl` 全量）

```
mood_apply 247 · life_do 230 · diary_read 175 · memory_recall 79 · memory_void 19
feedback_submit 9 · memory_remember 9 · diary_write 6 · mood_read 2 · judgment_read 1
bili_* 0 · media_* 0 · see_video 0 · judgment_write 0
```

**786 次调用，失败 0 次。** 单功能质量没问题，问题是**只有 10 个工具被用过，且全在内务**。

### 2.3 有实物产出的

| 产物 | 实测 |
|---|---|
| 私人日记 | 77,467 字节 / 12 小节，最后写入 11-13 23:40 ✅ |
| 公开日记 | 59,272 字节 / **48 小节**，但**停在 11-06 02:11** ⚠️ |
| 抽帧拼图 | **87 张** ✅（视觉管线真的跑通过） |
| 行动账 | 230 笔 ✅ |
| **mp4 成片** | **0 个** ❌ |
| **动态/评论/私信** | **0 条**（`dynId=0`、`kind:dynamic=0`、`lastWriteAt=0`）❌ |

### 2.4 B 站工具为什么一次没调用（这是本轮最重要的发现）

**先纠正我自己的一个判断**：我先前说"world 的工具接不进模型"，**不准确**。宿主 `core/types.ts:928` 的 World 契约白纸黑字："**工具定义和用法由 World 提供**"——world 的 tools 是**宿主直接挂给模型**的，不走 bot 的 `describe.tools`。日志那句 `工具不在 describe.tools 里,照常生效` 只是"未声明但可用"的提示，**不代表不可用**。

那真正缺的是**第二半句**：契约原文是「工具**定义和用法**由 World 提供；**使用时机与跨工具指导写入环境提示词**」。

而线上 `~/.xiaoyu-home/xiaoyu/prompts/` 里**只有两个文件**：

```
CONSTITUTION.md
ORIENTATION.md
```

**没有任何 world 的环境提示词文件。** 也就是说：她手里有 18 把 B 站工具，但**没有一句话告诉她什么时候该用、该按什么顺序用**。加上她的日程是"起床→伸展→翻日记→记一笔"，没有任何东西把她推向 B 站。

> 档位：工具可用性 = **已验证**（World 契约原文 + 宿主 `undeclared-names.ts:54` 的告警语义）；提示词缺失 = **已验证**（`prompts/` 目录只有两个文件）；"因此她不用" = **推断**，未做对照实验（如临时补一份 envPrompt 看她是否开始用）。这条要落地必须实测。

---

## 3. 烧钱的三层机制（已验证）

### 3.1 第一层：一件小事被拆成十几轮（**这是主因**）

一个 run 的真实工具序列：

```
diary_write → life_do → memory_recall → life_do → mood_apply →
memory_remember → mood_apply → memory_recall → life_do → mood_apply →
memory_recall → life_do
```

`life_do` ×4、`mood_apply` ×3、`memory_recall` ×3 —— **全为同一件小事**。

| 日期 | 行动笔数 | 模型调用 | 每笔摊 |
|---|---|---|---|
| 11-06 | 226 | 3237 | **14.3 次调用 / 2.3M token** |
| 11-13 | 4 | 14 | **3.5 次调用 / 2.1M token** |

**每做一件小事，要来回叫模型 3.5–14 次。**

### 3.2 第二层：每轮背 71 万 token，且从不裁剪

- `token-anatomy --date=2026-11-13`：调用 16 次，**p50 714,854 / p90 716,293 / p99 716,488** —— 三个数几乎相等 = **每次顶在上限**。
- 线上 `config.json:39 maxTokens = 500000`，代码默认 `64000`。
- 会话正本 `session-main.jsonl` = **1,542,101 字符**，其中「本轮关联记忆」出现 **680 次**。
- 一次 run 里那条 `【上下文压力】约 712992 token，超过软阈值 425000` **自己报了三次**（712992 / 715166 / 715333），**报完照发**。

### 3.3 第三层：为什么"限额"没拦住（这个才是"配置有个屁用"的答案）

宿主 `Cortico-up/src/protocol/open-responses/tokens.ts:17`：

```ts
return Math.ceil(cjk * 0.6 + other * 0.3)
```

对中文按 **0.6** 折算。用真实会话正本算：658,268 汉字 →

| 算式 | 结果 |
|---|---|
| 宿主 0.6 / 0.3 | 660,111 token |
| 1.0 / 0.3（更接近真实 tokenizer） | 923,418 token |
| **偏差** | **低估 29%（1.40 倍）** |

**所以配置 50 万上限，在估算器眼里从来没被突破过，于是不裁剪、不拒绝、原样发出 71.6 万。** `ca48a69` 那次"取 min、只收紧"接对了接口，但接的是一把短 29% 的尺子。

> 一次量化：**12 次成功调用、8.57M token、12 分钟**——这是主人补的余额被烧光的全过程。

---

## 4. 三个结构性缺陷（跨维）

1. **声称与实现之间没有门禁。** 观测窗 K1/K2/K3 至今 0（且锚点每次现算）、`prefs.like` 读取点 0、`gitSha` 100% null（已修）、断言不存在的 `go-gate.mjs`（已修）、`disposable 24 类只用 12 类`却 EXIT=0（未修）。
2. **家目录有新旧两套并存**，严重到骗过了评审席位（一个席位读了 `~/.dsh/bili-whale` 旧家就判"备份不存在"）。`7bf9198` 已把脚本改成"缺 `CORTICO_ROOT` 明确报错"，方向对。
3. **没有"价值"这一层观测。** 有成本读数、有行动账，但没有任何东西回答"她这一天的产出值不值得"。14 天观测窗设计出来就是为了这个，至今没跑。

---

## 5. 与上游的差距（"抄都不会抄"的实证）

上游 `Alterssss/dsh-bili-whale` 有 **29 个命令**：

```
ai-share bili-watch comment-await comment-del comment-digest comment comments
danmaku-await danmaku debrief deps diary dm-await dm dynamic-image dynamic
edit-dynamic fav feed likes notify quota reply-draft search selftest
subtitles traffic video-content whale-night
```

**我们移植了几乎全部能力**（18 把 `bili_*` 覆盖了动态/评论/弹幕/私信/赞/藏/订阅/搜索/配额/字幕/复盘）。**不是没抄。**

差距在**三个"上游有、我们没有"的机制**（已验证，出自 `upstream/main:lib/client.js` 的 FIELDS）：

| 上游机制 | 它解决什么 | 我们的现状 |
|---|---|---|
| **最小唤醒间隔（分钟）** 默认 10，"窗口放不下就少醒几次" | 限流 | 我们 30–90 秒一拍 |
| **会话轮换天数** "空闲时创建新会话，保留旧会话" | 上下文不无限堆 | 没有，会话一直长 |
| **每会话减少重复人设** "成功投递后去重，人设变化才重新注入" | 重复注入 | 没有，人设/记忆每轮重送 |
| **今晚不看的概率** `0.3` | 拟人化随机 | 被并进了 `CHECK_PROB`（语义已变） |
| **单次醒来观看数量** | 一次看多少 | 无 |

**这四项加起来就是"少开口"的整套设计。移植时丢了它们，换成了"每拍都开口 + 攒大上下文"——这就是烧钱的制度性原因。**

---

## 6. 技能与插件的适配（你要求"优先复用最适配的"）

### 6.1 本轮可用的本地技能（已核实存在）

| 技能 | 适配哪里 | 我的判断 |
|---|---|---|
| `code-review` | 每次主任务交付后做证据化复核 | **强适配**，正好治"自评不可信" |
| `evidence-gated-acceptance` | 验收"她是否真的对外产出了" | **强适配**，和 `outward-evidence.mjs` 是一套 |
| `project-validate` | 跑门禁并如实报"跳过/不可用" | **强适配**，治 `run-mjs-tests` 不采 skip |
| `bounded-product-discovery` | 下一轮功能取舍（要有边界、分"确认/未知/假设/提案"） | 中 |
| `superpowers-brainstorming` / `andrej-karpathy-guidelines` | 动手前的方案约束 | 中 |
| `architecture-visualization:*` | 给主人看结构图 | 弱（我们已有一份 A 报告，够用） |
| `diagram-design` | 同上 | 弱 |

### 6.2 开源可复用的实现（优先复用，别自己写）

| 需求 | 现成件 | 状态 |
|---|---|---|
| 工具调用次数限制 | **LangChain `ToolCallLimitMiddleware`** | **已抄了一半**：`cortico-bot-xiaoyu/src/index.ts:180` 附近的 `withToolGate`，注释写明"抄 LangChain ToolCallLimitMiddleware"，闸门只在一次唤醒内计数 |
| 上下文裁剪 | 宿主已有 `rebuildTail`（`loop.ts:1749-1756`） | 已有，缺的是估算器准（见 §3.3） |
| token 估算 | 用真实 `promptTokens` 反推比率 | 不需要新库，`usage.jsonl` 里就有真值 |
| B 站读写 | **已有 18 把工具**（移植自上游 29 命令） | 不缺，缺提示词 |
| 出片 | `media_video_build` + ffmpeg + TTS 双路 | 已实现，0 产出 |
| 记忆检索 | 四因子（关键词/生动/情绪/新旧） | 75 条规模**不需要向量库**，这是正确选择 |

**结论：不需要引入新轮子。要的是把已经搬进来的轮子接上轴、把上游丢掉的四个"少开口"机制抄回来。**

---

## 7. 改进与开发方案（分四阶段，每阶段有硬验收）

### 阶段 0｜停止失血（必须先做，否则后面全是空转）

| 项 | 做法 | 验收 |
|---|---|---|
| 0-1 估算率改准 | CJK `0.6 → 0.95`，并用 `usage.jsonl` 真实 `promptTokens` 反推校准 | 估算 ≥ 真实值 95%（宁高不低） |
| 0-2 上限压回 | `maxTokens 500000 → 64000`，并验证服务端真的拒绝超预算 | 离线复现一条"超了就裁"的输出 |
| 0-3 抄回上游"会话轮换" | 空闲时换新会话，旧会话保留 | 会话正本不再单调增长；给定天数后新会话启动 |
| 0-4 抄回"最小唤醒间隔" | 默认 10 分钟，窗口放不下就少醒 | 每笔行动的模型调用数从 3.5–14 降到 ≤3 |

**这一阶段做完，才算"不烧钱"。之前不要 resume 实例。**

### 阶段 1｜一件事只做一遍（治循环）

| 项 | 做法 | 验收 |
|---|---|---|
| 1-1 写工具幂等 | `life_do/mood_apply/diary_write/memory_remember` 按**内容指纹**去重；抄上游 `quota.mjs:240`「回复按内容哈希去重，内容没变就不算新」 | 连续两次相同调用只落一笔，且不扣体力 |
| 1-2 工具闸门收紧 | 沿用已有 `withToolGate`（已抄 LangChain），把"同一工具一次唤醒内最多 N 次"的 N 调小并可见 | 面板能看到闸门触发次数 |
| 1-3 重复率成指标 | 「她的一天」显示：今日重复记账次数 / 重复率 | 226 笔那种 86% 重复能当场看见 |

### 阶段 2｜让 B 站真的能用（治"功能看不见"）

| 项 | 做法 | 验收 |
|---|---|---|
| 2-1 补 world 环境提示词 | 给 `bili-account` 写 envPrompt（什么时候刷 feed、什么时候看片、什么时候写草稿），落 `prompts/` | 她当日至少一次主动 `bili_feed` |
| 2-2 先开读路 | 只放 6 把读工具（feed/search/watch/debrief/subtitles/quota），写路继续关 | `bili_debrief` 有真实回执 |
| 2-3 再开写路 | 开 `bili_dynamic_draft`（进待放行队列，不直发） | `dynId` 或待放行条目 > 0 |
| 2-4 出片 | `media_video_build` 跑通一次 | 数据目录出现 **≥1 个 mp4** |

### 阶段 3｜重新有"价值观测"（治"不知道值不值"）

| 项 | 做法 | 验收 |
|---|---|---|
| 3-1 观测窗落盘起点 | `observation-status.mjs` 的锚点写文件 | K1/K2/K3 开始累计，不再每次归零 |
| 3-2 对外凭据日报 | 沿用已交付的 `outward-evidence.mjs` | 每天一条 0/1 |
| 3-3 价值清单 | 每周一份：她产出了什么（日记/看片/草稿/评论） | 可读，不看代码也能懂 |

### 阶段 4｜可插拔收尾（不急，但有前置）

| 项 | 做法 |
|---|---|
| 4-1 内核归一 B 段 | 证明宿主那份 `persona-core` 无人引用后删除 + 防分叉门禁（**需主人批准**） |
| 4-2 假宿主验证 | ~150 行 stub，只实现模型发起/面板挂载/状态目录/定时器，跑 24h |
| 4-3 三个宿主目录清成两个 | 回滚点已搬家（`~/.xiaoyu-home/rollback`，699 文件）；`Cortico` 984M、`Cortico-new` 991M 待删 |

---

## 8. 我这一轮犯过的错（写进报告，不隐藏）

| 错误 | 事实 | 教训 |
|---|---|---|
| 说"上游没有限流/压缩" | 上游 FIELDS 里有最小唤醒间隔、会话轮换、每会话减少重复人设 | 我用英文 `rateLimit`/`maxTokens` 搜中文项目，搜不到就下结论 |
| 说"world 工具接不进模型" | 宿主 World 契约明写"工具由 World 提供"，是宿主直接挂的 | 该先读契约再断言 |
| 说"移植后只剩内务" | 我们移植了 18 把 B 站工具，一把不少 | 只数了被调用过的，没数注册过的 |
| 擅自启动实例 | 12 分钟烧光主人补的余额 | **任何花钱动作前必须先问** |
| 擅自向主任务发指令 | 主人明确说"我让你安排了吗" | **方案先给主人看，点头才发** |

---

## 9. 未查清（不填，留白）

1. **B 站工具是否真的可达**：契约说 world tools 由宿主挂给模型，但没有做过对照实验（临时补 envPrompt 看她是否开始调用）。→ 阶段 2-1 就是验证这一步。
2. **`see_video` 与 `bili_watch` 的关系**：两个都能看片，一个有产出（87 张拼图）一个 0 调用，边界未查。
3. **`media_video_build` 为何 0 产出**：缺 ffmpeg？缺 TTS 凭据？缺提示词？未定位。
4. **公开日记为何停在 11-06**：私人本写到 11-13，公开本停在 11-06 02:11，原因未查。
5. **78 个 gate 脚本的真实通过率**：只跑过其中 7 个 `check-*`。
6. **`Cortico-new` 991M 是什么**：身份未确认，只知道 11-04 后没动。

---

## 10. 给主人的三条结论

1. **功能不缺，接线和调度缺。** 33 把工具、29 个上游命令的能力都在，缺的是"教她什么时候用"（提示词）和"别一件事问十几遍"（调度）。
2. **烧钱的根不在上下文大小，在"每笔行动 3.5–14 次调用" × "每次 71 万 token" 的乘法。** 上游用「最小唤醒间隔 + 会话轮换 + 每会话去重人设」三个开关解决，我们移植时丢了。
3. **先做阶段 0，再谈其他。** 阶段 0 不完成，任何新功能都只是继续往漏桶里加水。

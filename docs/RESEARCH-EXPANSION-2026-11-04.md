# 做广 · 做深 · 做全 —— 外部对标调研与后续施工清单（2026-11-04）

> 主人要求："不止找出当前问题，还要深入分析后续要做哪些，把项目做广、做深、做全，
> 看看别人是怎么做的，迭代搜寻或深度研究十轮八轮，整理列出来。"
>
> 本文 = **12 轮外部调研 + 仓库逐条核实** 的整合结论。
> 每条都标了依据来源（外部文献 / 我们自己的代码实测），**没核实的不写成结论**。
> 配套文档：`CONTROL-SURFACE-2026-11-04.md`（控制面）、`PANEL-GAP-AUDIT-2026-11-04.md`（旧面板对账）。

---

## 0. 先给三个判断

**判断一：我们的"骨架"比大多数同类项目正规，但"内脏"是模板。**
WriteGate 七步把关、四层记忆、因果账 append-only、能力包宿主无关——这些在开源同类里属于上游水平。
但**做梦系统是假的**：`dreamDigest()` 实测是一句拼字符串模板
（`packages/cap-memory/src/card-store.ts:404-412`，"夜里结算记忆：「…」想不太清了"），
**没有任何模型参与**。外面这条线已经叫 sleep-time compute，是真跑推理的。

**判断二：最紧的不是功能，是合规。**
《人工智能生成合成内容标识办法》2025-09-01 已施行，要求 AI 生成内容打**显式 + 隐式**标识。
我们的政策文档写着"披露在简介 + 平台标签"，但**代码里零命中**
（`grep -rn "AI生成|ai_generated|AIGC" packages/ tools/` → 无）。
主人刚说"可以公开"——**这条必须在公开发布之前落地**。

**判断三：成本这块我们是"有账没钱"。**
线上 `usage.jsonl` 实测：90 次调用、prompt 260.9 万 token、**缓存命中 235.5 万（90%）**。
缓存命中率已经很好（外部评测说这能省 41–80%），但 `cost` 全是 0——
**MiMo 没有价格表**。所以不是"看不了成本"，是"算不出钱"。补一张价格表就有账。

---

## 1. 外部对标：别人怎么做的（12 轮调研）

### 1.1 睡觉这件事：从"模板"到 sleep-time compute

**Letta / arXiv 2504.13171**：让模型在**空闲时**对已有上下文离线思考，
预判将要到来的问题，把推理成本从"用户等待时"挪到"夜里"。
论文报告在同等准确率下**推理期 token 用量降低约 5×**。

**Stanford Generative Agents（Park et al. 2023，被引 9000+）**：三件套 ——
memory stream（经历流）+ **reflection**（把记忆归纳成更高层结论，且反思结果也进记忆流）
+ planning（日程规划）。消融实验证明三者对"可信度"都是关键贡献。

**我们的位置**：
| 环节 | 外部做法 | 我们实测 |
|---|---|---|
| 经历流 | memory stream | ✅ `causal.jsonl` + 四层记忆卡 |
| 检索 | recency × importance × relevance | ✅ `retrieval.ts:150`：`0.40*关键词 + 0.30*鲜活度 + 0.15*情绪 + 0.15*新近` |
| 日程规划 | daily plan | ✅ `tools/lib/night-plan.mjs` |
| **反思归纳** | reflection tree | ❌ **零命中**（`grep reflection|反思|归纳 packages/` → 无） |
| **离线思考** | sleep-time compute | ❌ **只有模板文案**，无模型调用 |

> **可做**：把 DreamTick 从"归档 + 拼一句"升级为真离线计算——
> 夜里把当天的因果账 + 日记 + 收件箱喂给模型，产出三类东西：
> ① **反思条目**（"这周我三次跳过游戏 PV，说明我其实不爱看演示"）写回记忆卡；
> ② **明日倾向**（明天更想看什么）；③ **预答**（主人可能问的事，先想好）。
> 代价：每晚若干次模型调用（要主人点头花钱）。

### 1.2 记忆：时间维度与类型维度都还缺一层

**Zep / Graphiti（arXiv 2501.13956，被引 568）**：**双时间轴**知识图谱——
每条事实带 `valid_at` / `invalid_at`，新事实与旧事实冲突时**作废旧的**而不是并存。
在 Deep Memory Retrieval 上超过 MemGPT。

**Mem0**：图 + 向量混合，亚秒级检索。

**认知架构共识（多篇 2026 综述）**：agent 记忆分五类 ——
**episodic**（事件）/ **semantic**（事实）/ **procedural**（技能：怎么做）/
**working**（当前上下文）/ **profile**（关于用户的画像），各自有不同的检索策略与 SLA。

**我们的位置**：四层（core / active / archived / voided）**全是 episodic 一层的时间分级**。
- ❌ 没有 **procedural**（她学会的"做法"沉淀不下来；判断卡接近但只记审美结论）
- ❌ 没有独立 **profile**（关于主人的画像散在私人日记"偏好校准"段里，不可结构化检索）
- ❌ 没有**时间有效期**（"主人喜欢 X"后来改成 Y，两条会并存，靠鲜活度衰减而不是作废）
- ✅ 有 voided 层（作废可查），这是好底子，加时间语义成本不高

> **可做**：给记忆卡加 `validAt` / `invalidatedBy`；新增两类记忆（procedural / profile）。

**注意——向量检索这条我建议不要翻案**：
`retrieval.ts:4` 写着明确论证："不用向量/embedding：不可复现、要外部依赖、
也解释不了'为什么想起这条'"。这是**有论证的边界决定**，符合我们"可解释优先"的路线。
若将来要加，也应做成**混合**（关键词为主、向量只当平局裁判，且把命中理由写进因果账），
不是替换。

### 1.3 人格一致性：漂移要能被测出来

**ContextEcho（arXiv 2605.24279）**：跨 23 个前沿模型的人格漂移基准，
结论是漂移**跨厂商普遍存在**，不是某一家的问题；提供了不重训就能审计漂移的开源框架。

**Nautilus Compass**：生产环境的**黑盒**人格漂移检测器。

**Anthropic《Demystifying evals for AI agents》（2026-01）**：agent 评测的设计方法。

**我们的位置**：`check-live-drift.mjs` 查的是**代码/配置漂移**
（prompts 正本、describe.json、webui 产物），`cortico-health` 查**身份锚**（账号名在不在前缀里）。
**行为漂移没有指标**——她连续 30 天说话还像不像她，现在无法回答。

> **可做（不开观测窗也能积累）**：三个离线指标——
> ① 身份锚命中率（日记/草稿里自称、称呼主人的方式是否稳定）；
> ② 口吻一致性（句长、语气词分布的漂移）；
> ③ 越界拒绝率（该拒的有没有拒）。
> 全部读已有产物，**不需要新跑模型**，也不动观测窗基线。

### 1.4 注入策略：触发式比全量塞省得多

**SillyTavern World Info / lorebook**：分层注入（global / character / persona / chat），
**关键词触发**——只有对话里出现相关词才把那条设定塞进上下文。
社区共识：角色卡不该塞下所有设定，该按需触发。

**我们的位置**：`systemSegments` 固定五段（宪法 / 这一轮怎么做 / 场值与心情 / 记忆摘要 / 意见箱批复），
**全量注入，无触发机制**。

> **可做**：给记忆卡与设定条目加"触发词"，命中才注入。
> 直接省 token（我们 90% 缓存命中说明前缀稳定，触发式注入要小心别打破前缀缓存——
> **这条要实测**：触发内容放在前缀末尾还是单独一段，缓存命中率差多少）。

### 1.5 成本与可观测：标准已经有了

**OpenTelemetry GenAI 语义约定（2026）**：模型调用成为标准 span，
token 用量、模型名、成本都有约定字段——**厂商中立**。

**Langfuse / Arize Phoenix**：可自托管的 LLM 可观测 + 评测（tracing / datasets / LLM-as-judge）。

**LiteLLM / agentgateway**：**硬预算**（fail-closed）、每 key 上限、RPM/TPM 三重限流。
业界共识一句话：**"限流要数 token，不是数请求"**——一个 200K 上下文的请求等于 50 个普通请求。

**Prompt caching 评测（arXiv 2601.06007）**：跨厂商实测**省 41–80% 成本、TTFT 快 13–31%**。

**RouteLLM（LMSYS）**：成本感知路由，报告可省 85%。

**我们的位置**：
- ✅ 有 `usage.jsonl`（1044 行）、有 `/api/usage`、有缓存命中统计（90%）
- ❌ **没有价格表**（cost 全 0）
- ❌ **没有钱的预算闸**（只有 token/条数配额，没有"今天最多花 X 元"）
- ❌ 没有按任务路由（MiMo 有 pro / flash 两档，现在不看任务用同一个）

> **可做**：① 补 MiMo 价格表 → 立刻有账；② 加日花费上限（fail-closed）；
> ③ 看片摘要走 flash、日记/反思走 pro。**别自己造观测栈**——
> 若要 tracing，接 OTel GenAI 约定或直接自托管 Langfuse，比我们自己写页面划算。

### 1.6 控制面：schema 驱动是行业标准做法

**行业共识（多篇）**："每个能力声明自己的 settings schema，设置界面自动生成，
**没有一个设置页是手写的**。"

**IETF `draft-sharif-agent-audit-trail`（2026-10，第 9 稿）**：自治 AI 系统的标准日志格式。

**HITL 审批四模式（Dataiku 2026-10）**：interrupt-resume / human-as-tool / approval flow / fallback escalation。
审批门设计的三个要点：**该门什么、审阅者看到什么、超时与拒绝理由怎么处理**。

**我们的位置**：
- ✅ WriteGate 七步 + kill 急刹 + 待放行队列 + 拒绝理由（`why`）进因果账——**这块比多数项目扎实**
- ❌ **配置组零声明**（线上实测 `persona:xiaoyu.configGroups = []`，宿主 cormini 有 4 组）
- ❌ **待放行队列没有超时策略**（实测有过 `dyn-20261102-cd6d4a`：令牌过期发不出去，
  稿子就那么烂在队列里）
- ❌ 没有**升级路径**（连续被拒 → 该主动告诉主人，现在只是静默）
- ⚠️ 因果账字段是我们自己的形状，与 IETF 草案不对齐（不影响用，影响将来可移植）

### 1.7 视觉：从"变化分"到"带着问题看"

**K-frames（OpenReview）**：场景驱动的 **any-k 关键帧选择**，而且是 **query-aware**——
按"你想问什么"选帧，不是只按画面变化。

**Agentic Very Long Video Understanding（ACL 2026）**：planning agent + retriever
探三个源（音频转写 / 帧 embedding / 实体图），**长视频先分层再按需深入**。

**Agentic Video Summarization（CVPR 2026）**：自反思多模态理解做摘要。

**我们的位置**：`cap-vision` 是变化分 + 三路保帧 + DP 装箱拼图，**无查询意图**、**整条一次抽完**。

> **可做**：① 选帧带意图（"这片在讲什么" vs "有没有出现猫"给不同帧）；
> ② 长视频分层（先字幕/分 P/章节定位，再对可疑段抽帧），省钱也省时间。

### 1.8 形象与陪伴形态：有现成轮子，别自己写

**Open-LLM-VTuber（GitHub）**：Live2D 形象 + 免提语音 + **语音打断** + 本地跑，跨平台。
**AIRI / Moeru AI（Chronicle v0.0.1）**：开源复刻 Neuro-sama 的 cyber companion。
**Meta Waddle World（2026-10）**：Tamagotchi 式 AI 宠物；评测点出一句关键——
**"记忆才是留存机制"**：宠物能引用早先的对话，每次进入都变成一次小小的重逢。
**Yu-kai Chou（游戏化）**：宠物陪伴设计的核心是**照顾循环**驱动日活。

**我们的位置**：9 张静态底图 + TTS + 视频合成；BACKLOG 里形象路线 A/B/C 待主人拍板。

> **可做**：走 C（皮套）时**复用 Open-LLM-VTuber 的 Live2D 实现**，不要自己写口型同步。
> 另外"照顾循环"我们其实已经有雏形——主人调场值会记 `source: 'owner_adjust'` 进因果账，
> 这就是"你照顾了她"。缺的是**让她对照顾有反应**（现在只是数字变了）。

### 1.9 合规：这条是硬约束，不是选项

**《人工智能生成合成内容标识办法》**（国家网信办 2025-03-14 发布，**2025-09-01 施行**）：
AI 生成合成内容须加**显式标识**（用户可感知）与**隐式标识**（文件元数据）；
**平台在用户上传时须核验元数据并在展示时加标识**（PwC 合规解码第六条）。
新华社 2025-10 报道：短视频"AI 生成"标注已在执行。

**我们的位置**：
- 政策文档一致写着"正文不出戏，披露在简介 + 平台标签"（`PRODUCT.md:48`、
  `CORTICO-RUNBOOK.md:44`、`E-CORTICO-02-BRIEF.md:19`）——**政策是对的**
- 但 `PLUGIN-ECOSYSTEM-AUDIT-2026-10-30.md:10` 自己就记着：
  **"我们的代码里根本没有这个东西。全仓 grep `ai_generated/含AI/declaration` 零命中"**
- 我今天复核：仍然零命中

> **结论**：政策与代码之间有一道没合上的缝。**公开发布之前必须补**——
> 在发布链路里带上平台的 AI 生成声明字段（B 站投稿/动态有此选项），
> 正文仍然不出戏。这**不违背**主人的既有裁决，恰恰是执行它。

### 1.10 自举与运维：同类项目的标配我们缺三件

对照 `PANEL-GAP-AUDIT`：**cookie 写入入口、依赖体检（登录态/自测标记）、通知实弹** 三件缺失。
外部同类（LiteLLM/agentgateway 的控制台、Langfuse 的 self-host）都把
"凭据写入 + 健康自检 + 告警通道"当**第一天就要有的**，不是后期补的。

---

## 2. 做全 —— 把管理与配置补齐（13 项）

| # | 事项 | 现状证据 | 优先级 |
|---|---|---|---|
| C1 | **AIGC 平台标识落地** | 代码零命中，政策文档要求 | **P0（公开前必须）** |
| C2 | **cookie 写入入口** | 旧 `/api/cookie` 无对应；换号只能手改文件 | **P0** |
| C3 | **登录态体检 + self mid 回填** | `whois` 能读，无入口无回填 | **P0** |
| C4 | **读配额恢复**（readHourly/readDaily） | `grep readHourly` 零命中；traffic-state 只有写冷却 | **P0** |
| C5 | **配置组声明**（上下文预算/作息/偏好/发送档位） | `configGroups = []` | **P0** |
| C6 | **事件流可视化** | `recentChain` 后端有、前端不渲染 | P1 |
| C7 | **数据清理分级**（单条撤销 / 按层归档 / 全量重置留墓碑） | persona 无 storage 声明 | P1 |
| C8 | **成本可见**（MiMo 价格表 + 未计价明示） | `cost: 0`，token 有 | P1 |
| C9 | **日花费预算闸**（fail-closed） | 只有条数/token 配额，无钱上限 | P1 |
| C10 | **待放行超时策略 + 升级路径** | 实测有稿因令牌过期烂在队列 | P1 |
| C11 | **通知实弹**（ntfy/bark 推送） | ROADMAP 里挂着，未接通 | P2 |
| C12 | **今日概览**（今日分享/评论数、调度状态） | 旧 `vitals` 有，新面板无 | P2 |
| C13 | **人设正本编辑入口** | 只能改文件；drift 门禁只校验一致性 | P2 |

---

## 3. 做深 —— 把已有的做透（9 项）

| # | 事项 | 现状证据 | 外部对标 | 优先级 |
|---|---|---|---|---|
| D1 | **做梦改成真 sleep-time compute** | `dreamDigest` 是拼字符串模板 | Letta / arXiv 2504.13171 | **P1（要花模型钱，需点头）** |
| D2 | **反思归纳进记忆流** | `grep reflection|反思` 零命中 | Generative Agents | P1 |
| D3 | **记忆加时间有效期** | 无 `validAt/invalidatedBy` | Zep/Graphiti 双时间轴 | P1 |
| D4 | **新增两类记忆：procedural + profile** | 四层全是 episodic 时间分级 | 认知架构五分法 | P2 |
| D5 | **行为漂移指标（离线三件套）** | 只有代码漂移门禁 | ContextEcho / Nautilus | P1（不花钱、不动基线） |
| D6 | **触发式记忆注入** | 五段全量注入 | SillyTavern lorebook | P2（**要先实测缓存影响**） |
| D7 | **视觉：带意图选帧** | 只有变化分，无查询 | K-frames | P2 |
| D8 | **视觉：长视频分层** | 整条一次抽完 | ACL 2026 agentic long video | P2 |
| D9 | **按任务路由模型**（flash/pro） | 单一模型 | RouteLLM / LiteLLM | P2 |

---

## 4. 做广 —— 新领域（6 项，多数需主人拍板）

| # | 事项 | 可复用轮子 | 状态 |
|---|---|---|---|
| B1 | **Live2D 皮套 / 桌宠形态** | Open-LLM-VTuber（Live2D 5.0、口型、打断） | 等形象路线 A/B/C 拍板 |
| B2 | **实时语音对话**（免提 + 打断） | Open-LLM-VTuber / AIRI | 同上 |
| B3 | **"她的房间"生活场景前端** | — | ROADMAP V5，等拍板 |
| B4 | **照顾循环闭环**（她对主人的照顾有反应） | Tamagotchi/Waddle World 的留存机制 | 雏形已有（`owner_adjust` 进因果账） |
| B5 | **多渠道**（QQ world 已有骨架） | 宿主 `world:qq`（线上 inactive） | 未排期 |
| B6 | **技能库**（她学会的做法可复用） | Voyager skill library | 与 D4 procedural 记忆是同一件事 |

---

## 5. 明确不做 / 暂缓（带理由，不是拍脑袋）

| 事项 | 理由 |
|---|---|
| **向量/embedding 检索** | `retrieval.ts:4` 有论证：不可复现、要外部依赖、解释不了"为什么想起这条"。要加只能做**混合 + 可解释**，不替换 |
| **多角色社会模拟**（ai-town / Project Sid 那种） | 个人项目，价值与成本不匹配；她的世界只有主人一个观察者 |
| **自动关注/取关、公开评论区自发言** | 既有裁决挡着（PRODUCT-ROADMAP §3.E） |
| **正文写 AI 免责声明** | 既有裁决：正文永不出戏，披露只进简介 + 平台标签（C1 是执行这条，不是推翻它） |
| **自造可观测栈** | OTel GenAI 约定 + Langfuse/Phoenix 已覆盖，自己写页面是重复造轮子 |
| **大规模训练/微调** | 项目定位是工程原型（AGENTS.md 已写明） |
| **观测窗（B2）** | 主人 15:00 明确"先不开"；D5 的漂移指标设计成**不依赖开窗**也能积累 |

---

## 6. 建议施工顺序（批次）

**批次 10 · 合规与自举（P0，不碰她的行为，今天就能做）**
C1 AIGC 标识 → C2 cookie 写入 → C3 登录体检 → C4 读配额恢复
*验收*：发布链路带 AI 声明字段；面板能粘 cookie 并回读登录态；读余量可见。

**批次 11 · 控制面（P0/P1）**
C5 配置组四组 → C6 事件流 → C7 数据清理分级
*验收*：她的页面出现「配置」页签，上下文预算改完热生效；面板能看见最近 20 条因果。

**批次 12 · 成本与预算（P1）**
C8 价格表 → C9 日花费闸 → D9 按任务路由
*验收*：用量页有钱数；超预算 fail-closed 且留痕。

**批次 13 · 睡眠深化（P1，需点头花钱）**
D1 真 sleep-time compute → D2 反思归纳
*验收*：夜里产出反思条目并写回记忆卡；连续三晚可读。

**批次 14 · 记忆深化（P1/P2）**
D3 时间有效期 → D4 procedural/profile 两类 → D5 漂移指标
*验收*：冲突事实会作废旧条；漂移三指标有基线数。

**批次 15 · 视觉深化（P2）**
D7 带意图选帧 → D8 长视频分层

**批次 16 · 形象（等拍板）**
B1/B2 Live2D + 语音，复用 Open-LLM-VTuber

**并行（不占批次）**：C10 待放行超时、C11 通知实弹、C12 今日概览、C13 人设编辑、D6 触发式注入（先实测缓存）

---

## 7. 要你拍板的五件事

1. **AIGC 平台标识现在就落地吗？**（我建议：立刻。你说"可以公开"，这是公开的前置条件）
2. **优先级：先"做全"（管理配置）还是先"做深"（睡眠/记忆）？**
   我建议先做全 —— 配置面是地基，且批次 10/11 不碰她的行为、风险最低。
3. **做梦要不要花模型钱？**（D1 真 sleep-time compute = 每晚若干次调用；不点头我就只做 D2 的离线归纳，用已有产物不花钱）
4. **形象路线 A/B/C**（BACKLOG 里挂着的老问题；选 C 我就去接 Open-LLM-VTuber，不自己写）
5. **向量检索要不要翻案？**（我建议不翻，除非你要"她能想起语义相近但用词不同的事"——那就做混合式并保留可解释）

---

## 8. 来源

**外部（12 轮检索）**
- Letta《Sleep-time Compute》https://www.letta.com/blog/sleep-time-compute/
- arXiv 2504.13171《Sleep-time Compute: Beyond Inference Scaling at Test-time》https://arxiv.org/html/2504.13171v1
- Park et al.《Generative Agents: Interactive Simulacra of Human Behavior》https://arxiv.org/abs/2304.03442
- Zep《A Temporal Knowledge Graph Architecture for Agent Memory》arXiv 2501.13956 https://arxiv.org/abs/2501.13956
- Mem0 / Zep / Letta 对比 https://coworker.ai/blog/mem0-vs-zep-vs-letta
- ContextEcho《Persona Drift in Long Agentic Sessions》arXiv 2605.24279 https://arxiv.org/html/2605.24279v1
- Nautilus Compass（黑盒人格漂移检测）https://www.researchgate.net/publication/404752246
- Anthropic《Demystifying evals for AI agents》https://www.anthropic.com/research/demystifying-evals-for-ai-agents
- OpenTelemetry《Inside the LLM Call: GenAI Observability》https://opentelemetry.io/blog/2026/genai-observability/
- arXiv 2601.06007《An Evaluation of Prompt Caching for Long-Horizon Agentic Workloads》https://arxiv.org/html/2601.06007v2
- LiteLLM 预算与限流 https://docs.litellm.ai/docs/proxy/users
- agentgateway 预算上限 https://agentgateway.dev/docs/standalone/latest/documentation/llm/cost-controls/budget-limits/
- MLflow《Gateway LLM Rate Limits》https://mlflow.org/articles/rate-limiting-llm/
- RouteLLM vs vLLM Semantic Router https://gingerlabs.ai/blog/routellm-vs-vllm-semantic-router
- Langfuse vs Arize Phoenix https://qaskills.sh/blog/langfuse-vs-arize-phoenix
- SillyTavern World Info https://docs.sillytavern.app/usage/core-concepts/worldinfo/
- K-frames（场景驱动 any-k 关键帧）https://openreview.net/forum?id=YIP1CxHCue
- 《Agentic Very Long Video Understanding》ACL 2026 https://aclanthology.org/2026.acl-long.2161.pdf
- 《Agentic Video Summarization》CVPR 2026 https://openaccess.thecvf.com/content/CVPR2026/papers/Guo_Agentic_Video_Summarization_via_Self-Reflecting_Multimodal_Understanding_CVPR_2026_paper.pdf
- Voyager（技能库）https://arxiv.org/abs/2305.16291
- a16z ai-town https://github.com/a16z-infra/ai-town
- Open-LLM-VTuber https://github.com/Open-LLM-VTuber/Open-LLM-VTuber
- AIRI / Moeru AI Chronicle https://airi.moeru.ai/docs/en/docs/chronicles/version-v0.0.1/
- Meta Waddle World 评析 https://www.progressiverobot.com/2026-10-28/meta-waddle-world-tamagotchi-like-ai-pet-app/
- Yu-kai Chou《Virtual Pet Companion Design》https://yukaichou.com/advanced-gamification/the-pet-companion-design-in-gamification/
- OCC 情绪模型 https://www.idsia.ch/~steunebrink/Publications/KI09_OCC_revisited.pdf
- IETF draft-sharif-agent-audit-trail https://datatracker.ietf.org/doc/draft-sharif-agent-audit-trail/
- Dataiku《HITL AI agents: governance design patterns》https://www.dataiku.com/blog/human-in-the-loop-ai-agents
- ScaleKit《HITL Tool Calling: Approval Gates》https://www.scalekit.com/blog/human-in-the-loop-tool-calling
- Schema-driven settings https://peterhrynkow.com/ai/architecture/2025-02-01/schema-driven-platforms.html
- 国家网信办《人工智能生成合成内容标识办法》https://www.cac.gov.cn/2025-03/14/c_1743654684782215.htm
- PwC《标识办法合规解码》https://www.pwccn.com/zh/tmt/method-identifying-synthetic-content-generated-ai-sep2025.pdf
- 新华社《你刷的短视频，标注"AI 生成"了吗》http://www.news.cn/20251024/9024afae015047b593770a90dd344b70/c.html

**内部（今天实测）**
- `packages/cap-memory/src/card-store.ts:404-412`（dreamDigest 是模板）
- `packages/persona-core/src/retrieval.ts:4,150`（无向量的论证 + 四因子打分）
- `packages/cap-state-rhythm/src/index.ts:320`（recentChain 后端有）
- `~/.xiaoyu-home/xiaoyu/data/usage.jsonl`（1044 行、90 次调用、缓存命中 90%、cost 0）
- `/api/webui/manifest`（persona:xiaoyu configGroups = []）
- `docs/PLUGIN-ECOSYSTEM-AUDIT-2026-10-30.md:10`（AIGC 声明代码零命中，10-30 就记过）
- `docs/PRODUCT.md:48`、`docs/CORTICO-RUNBOOK.md:44`（披露政策）

---

## 9. 状态

- 调研：**完成**（12 轮外部 + 仓库逐条核实）。
- 施工：**未开工**，等 §7 五个拍板。
- 本文是**方向与清单**，不是排期承诺；主人点头哪一批才动哪一批。

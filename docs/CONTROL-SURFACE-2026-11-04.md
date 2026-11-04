# 控制面回补：把"能看能配能清"收回自己这边（2026-11-04）

主人反馈：**"感觉迁移了，很多功能缩水了。质量成本看不了、上下文长度设不了、数据清理不知道谁管，
很多东西还耦合在别人那边。需要恢复这些功能，或者集成到我这边。"**

这份文档是**诊断结论 + 施工计划**，不是完成报告。诊断部分每一条都有线上取证。

---

## 0. 一句话结论

**不是"功能缩水"，是"配置面没跟着迁移"。**

迁移时把**能力包**（干活的功能）搬过来了，但**配置组**（能改能看能清的旋钮）全留在宿主那一侧，
而小鱼 bot 一个配置组都没声明 —— 于是宿主那些页面在**她的页面上根本没有入口**。

宿主的功能**没丢**，是**没有路由到她的身上**。这跟功能实现无关，是声明层的事。

---

## 1. 取证：到底缺什么（全部来自线上，不是推测）

### 1.1 小鱼 bot 声明了 0 个配置组

线上 `GET /api/webui/manifest` 实测：

| provider | panels | configGroups |
|---|---|---|
| `world:console` | 0 | `["world:console"]` |
| `world:bilibili` | 2 | `["world:bilibili"]` |
| `world:minecraft` | 5 | 4 个 |
| `world:websearch` | 1 | `["world:websearch"]` |
| **`world:bili-account`** | 4 | **`[]`** |
| **`world:media-studio`** | 1 | **`[]`** |
| **`persona:xiaoyu`** | 4 | **`[]`** |
| `llm:llamacpp` | 7 | `[]` |
| `llm:openai-responses-compat` | 6 | `[]` |

对照宿主源码 `src/bot.ts:938-942`：配置组来源只有三处 ——
`coreConfigGroup()`、bot 自己的 `contribution.configGroups`、world 声明的 `webUi.config`。
**`persona:xiaoyu` 一条都没贡献，所以她的页面连「配置」页签都不生成。**

### 1.2 上下文预算：字段存在，但没人声明、也没人编辑

宿主 `bots/cormini/persona/config.ts` 有一组完整的可编辑配置
（`context.maxTokens` / `context.keepRatio` / `context.softRatio` / `context.firstTurn`），
渲染在「上下文与交接」里，注释写得很清楚：

> "没有这一组的 bot，这三个数在 WebUI 上没有位置，只能改 config.json。"

我们的小鱼 bot 定义 `packages/cortico-bot-xiaoyu/src/cortico-definition.ts:41-47` 里
`defaults()` 硬写了 `context`（继承 `CORE_DEFAULTS`），**但没有 `configGroups`**。
线上 `~/.xiaoyu-home/xiaoyu/config.json` 实测：

```json
"context": { "maxTokens": 200000, "keepRatio": 0.4, "softRatio": 0.85, "firstTurn": false }
```

**这些数字现在只能手改 JSON，改完要重启。** 主人说的"设置不了上下文长度"，就是这条。

### 1.3 质量与成本：数据在，价钱是 0

线上 `GET /api/usage?range=day` 实测：

```
calls 90, promptTokens 2608735, completionTokens 1423, cacheHitTokens 2354944
cost 0, costCacheHit 0, costCacheMiss 0, costOutput 0
```

`data/usage.jsonl` 有 1044 行，`/api/usage` 路由在（`src/web/server.ts:2414`），
**但 MiMo 这个 provider 没有价格表**，所以 token 有、成本算不出来。
主人在「用量与成本」页看到的就是一片 0 —— 页面在，数据在，**单价不在**。

> 这不是我们能自己编的：价格是供应商事实。需要 MiMo 侧价格表，或者在 provider 配置里补价格。

### 1.4 数据清理：能力在宿主，入口在她页面上没有

宿主的 storage 页（`src/web/client/features/storage/`）提供存储查看与清理，
挂载点按 `StorageOwner` 分（`owner: 'core' | 'persona' | 'world:*' | 'provider:*'`）。
小鱼这边 persona 侧没有声明 storage 声明（`webui-protocol.ts:570` 的 `storageParts`），
所以**她的记忆卡片、日记、场值这些数据的清理入口不在她名下**。

### 1.5 旧插件那 25 项设置去哪了

旧 DSH 插件 `core/client.js:53-72` 有 25 个字段（会话轮换天数、每会话减少重复人设、
疑似 AI 评论检查、最小唤醒间隔、今晚不看的概率、单次观看视频数、口味爱看/不爱看、
推送日记摘要、工具目录……）。

迁移后这些**大部分在宿主侧找不到对应旋钮**。逐条对账见 §4。

### 1.6 顺带查到的两个不一致（非本次诉求，但同源）

- `~/.xiaoyu-home/xiaoyu/config.json` 里 `web.port: 7798`，实际跑在 **7799**（启动脚本传 `--port=7799` 覆盖）。
- `config.json` 里 `worlds.bili-account.enabled: true`，但宿主侧 `world:bili-account` 是个**旧内建 world**，
  现在真实能力在 `world:bilibili`（B站号）和我们的 `cap-bilibili` 扩展里。这个配置项现在是空转的。

---

## 2. 为什么"感觉像缩水"——三条结构性原因

1. **能力包搬了，配置面没搬。** 干活的部分（看视频、写日记、发私信）全在能力包里，
   但"调参数"的旋钮是**另一套机制**（`configGroups`），迁移时整块漏了。
2. **声明粒度错了。** 我们声明的是 `panels`（自定义面板），宿主认的是 `configGroups`。
   面板能自己读配置，但**不能生成宿主那种标准配置页签**。
3. **owner 归属没定。** 宿主按 owner 决定配置渲染在谁名下、storage 归谁清。
   我们把数据放进了 `data/persona/`，但没告诉宿主"这些是我的，请给我清理入口"。

---

## 3. 施工计划（分四层，按依赖顺序）

### 第 1 层 · 上下文与预算（主人点名要的第一项）

**做法**：给小鱼 bot 声明 `configGroups`，复用宿主 cormini 的那组 schema 形状
（`context.maxTokens` / `keepRatio` / `softRatio` / `firstTurn`），owner = `persona`。

**位置**：`packages/cortico-bot-xiaoyu/src/cortico-definition.ts`，新增一个
`context-stage-config.ts`（形状照抄宿主 `bots/cormini/persona/config.ts`，
**不 import 宿主模块** —— 保持 A3 的解耦约定）。

**验收**：
- 她的页面出现「配置」页签，「上下文与交接」四项可改、保存即生效（改 `maxTokens` 不重启）。
- 改 `maxTokens` 后 `/api/webui/manifest` 里 `persona:xiaoyu.configGroups` 非空。
- `config.json` 里 `context.maxTokens` 被真值覆盖，不是死写。

**注意**：`CORE_DEFAULTS` 里 `maxTokens` 现在是 200000，但 `cortivo` 里 `contextWindow` 是模型能力
（`src/core/core.ts:309`），两者不是一回事：一个是**我们请求多少**，一个是**模型允许多少**。
页面上要分开写清楚，别让主人以为调了就能突破模型上限。

### 第 2 层 · 质量与成本看得见

**做法**：把「用量与成本」从宿主的全局页，变成**她的页面上的一页**（或至少一条可点的入口）。
同时处理单价缺失：查 MiMo 是否提供价格表；没有的话，在 provider 配置里补价格（宿主
`src/providers/configuration.ts` 那套），并在页面上标明"该模型未计价"，而不是显示 0 冒充免费。

**验收**：
- 她的页面能打开用量数据，看到 90 次调用 / 260 万 token。
- 未计价的模型**明确标注**，不显示成 0 元。

### 第 3 层 · 数据清理归位

**做法**：给 persona 声明 storage 声明（`webui-protocol.ts:570` 的 `storageParts`），
把她的记忆卡片、日记、场值、视觉产物登记成可清理项；清理要分级：
单条撤销 / 按层归档 / 全量重置（重置必须留墓碑记录，不静默删）。

**验收**：她页面上能看见"我占了多少、哪些能清、清了会怎样"；清一条记忆后召回确实不再命中，
且原条目在「已作废」层里可查（cap-memory 已有 `void` 语义，对接它，不要另造一套）。

### 第 4 层 · 旧 25 项逐条对账 + 扩展

对旧插件 `core/client.js` 的 25 个字段逐条判定：

| 旧字段 | 去向 | 处置 |
|---|---|---|
| 会话轮换天数 / 每会话减少重复人设 | 宿主 core 层 | 宿主 `coreConfigGroup` 里若有则接，否则补 persona 组 |
| 疑似 AI 评论检查 | cap-bilibili | 做成 `world:bili-account` 的 configGroup |
| 最小唤醒间隔 / 今晚不看的概率 / 单次观看视频数 | **无处安放** | 补进 rhythm 配置组 |
| 角色名 / 称呼 / 自称 | 人设正本 | 走 prompts/ENV_PROMPT，不进 config |
| 主人 mid / 昵称 / 她的 mid / 昵称 | 账号与 cookie | 走 B站 world 配置或只读展示 |
| 爱看 / 不爱看 | cap-bilibili 偏好 | 已在「偏好」面板，补成可编辑配置组 |
| 推送日记摘要 | cap-journal | 补成 configGroup |
| 专用会话目录 / 工具目录 | 工具链 | 走 persona 配置组 |
| 工具目录、分享前检查 | 保留 | 同上 |

**产出**：`docs/CONTROL-SURFACE-MATRIX.md` —— 25 行 × (新位置 / 状态 / 验收)，逐条销账。

### 第 5 层（可选，看主人要不要）· 整体优化与扩展

在第 1–4 层把"能配能看能清"补齐之后，再谈：
把分散在 6 个面板的设置**收敛成一个「她」的总控台页**（一张表看全部、点进去改），
以及把宿主那套 `x-hot` 热改字段（改完即生效不重启）用满。

---

## 4. 边界与不做的事

- **不重造宿主已有的东西**：宿主 storage/usage/prompts 页能复用就复用，
  我们做的是**把她自己的那部分接进去**，不是把宿主整套抄一遍。
- **价格不编**：MiMo 单价要么官方给，要么标记"未计价"。绝不拿猜的数字冒充账单。
- **不删原始数据**：清理一律走 cap-memory 已有的"作废→可查"语义；
  全量重置要留墓碑（旧规则：不删原始数据、不删负结果）。
- **不碰宿主的核**：不 fork 宿主代码、不改宿主 src；只在我们自己的包里声明 configGroups/storage，
  走宿主**已经提供的**扩展位（`contribution.configGroups`、`webUi.config`、`storageParts`）。
- **观察窗仍未开**：本轮不动 `B2`（14 天观测窗），除非主人点头。

---

## 5. 待主人拍板的三件事

1. **上下文预算是走宿主标准「配置」页签，还是在「鱼缸」面板里加一块？**
   建议：宿主页签（标准、能改热生效、有 schema 校验），面板里只放"快捷看一眼 + 跳转"。
2. **"质量与成本"要不要搬进她的页面？**
   建议：搬一个入口过去，底层还是宿主那套数据（不复制数据）。
3. **数据清理的粒度**：只到"单条撤销"，还是也要"按层清空"？
   建议：单条撤销 + 按层归档先做；全量重置等观测窗开了以后再放（现在重置会毁掉正在积累的证据）。

---

## 6. 状态

- 诊断：**完成**（本文件 §1 全部有线上取证）。
- 施工：**未开工**。
- 相关任务：`#11`（观测窗，仍未开）、新增任务待建。

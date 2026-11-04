# Sitemap — 小鱼控制台改版

- **生成时间**：2026-11-05T02:00+08:00
- **平台**：Web 桌面（单用户）
- **数据源**：Brief（5 维策略 + 4 目标）+ Audit（106 findings）+ 现有 9 面板真实结构
- **页面总数**：12
- **最大深度**：2

---

## 回答主人的问题：要重新设计吗？

**要梳理，不是推倒重来。** 现有 9 个面板里 6 个骨架是对的（保留+补控件），
真正要动的是 **3 处结构动作**，每一处都因为 IA 断裂有 audit 证据：

| 动作 | 对象 | 为什么（audit 证据） |
|---|---|---|
| **① 新增** | 「她的一天」persona 落地页 | "她在干什么"没有页面：事件流后端有前端无（B8）、今日计数无读数（B9）、她的发言埋在宿主原始 transcript 里。你每天的第一问要翻三个地方 |
| **② 新增** | B站「连接」页 | 账号绑定/解绑/体检/通知测试无处安放（K6，你点名的例子）；安全闸已 15 控件，再塞必炸 |
| **③ 拆分** | 意见箱独立成「分诊台」 | 它挤在「日记、判断卡与意见箱」三合一里，51 条渲染 133 按钮（D1/D2）。读她的日记（低频阅读）和处理她的反馈（高频分诊）是两种任务 |
| 合并 | vision「她的眼睛」→ 并入看片域 | 同为"她怎么看片子"：偏好是规则，眼睛是执行，天然同域 |
| 瘦身 | 安全闸只留行为闸 | 通道/凭据/通知类全部移去「连接」；解除类操作统一二次确认（H2） |

**明确保留**（骨架对，只补控件）：鱼缸、记忆、收件箱、待放行台、创作台。

---

## 主导航（8 项，Web ≤7 建议内超 1 项，理由：三组语义天然分开）

```
她的一天 · 鱼缸 · 记忆 · 日记 · 意见箱   ← persona 组（5）
B站 · 创作                               ← world 组（2）
设置                                     ← 系统（1）
```

> 实现注：宿主导航已按 provider 分组（PERSONA & MEMORY / WORLD 分节），8 项在视觉上是
> 5+2+1 三段，不是平铺 8 个，认知负担可控。若仍嫌多，可将「日记」「意见箱」收进
> 「她的一天」作 tab——但牺牲"意见箱=待办"的心智，**不推荐**。

## 站点树

```
persona:xiaoyu
├── /persona/day          她的一天 ★新增 [auth]  ← 默认落地页
├── /persona/tank         鱼缸（保留+补回执/倒计时）
├── /persona/memory       记忆（保留+补回滚/冲突/召回解释）
├── /persona/journal      日记+判断卡（拆出意见箱）
└── /persona/triage       意见箱 ★新增（分诊工作台）

world:bili-account
├── /world/bili/inbox     收件箱与指派（保留+补未读开关/拉黑管理）
├── /world/bili/drafts    待放行改稿台（保留+放行确认/过期标黄/来源）
├── /world/bili/watching  看片偏好+她的眼睛（合并 vision 子区）
├── /world/bili/connection 连接 ★新增（绑定/体检/通知/通道）
└── /world/bili/gate      安全闸（瘦身：纯行为闸）

world:media-studio
└── /world/media          创作台（保留+修复试听/缩略图选底图）

系统
└── /settings             设置（configGroups 四组+人设正本+清理分级+文档）
```

## 页面清单

| ID | Route | Label | 一句话目的 | 关联策略 |
|---|---|---|---|---|
| page-day | /persona/day | 她的一天 | 她在干什么/今天干了什么/刚说了什么 | 可解释·像人·会话卫生 |
| page-tank | /persona/tank | 鱼缸 | 实时状态+干预（滑块/戳醒/作息） | 防护·可解释 |
| page-memory | /persona/memory | 记忆 | 四层记忆+回滚+冲突+召回解释 | 可解释·防护 |
| page-journal | /persona/journal | 日记 | 两本日记+判断卡（她写的） | 防护 |
| page-triage | /persona/triage | 意见箱 | 她的反馈分诊台 | 分诊·可解释 |
| page-bili-inbox | /world/bili/inbox | 收件箱与指派 | 四路消息+指派 | 防护·可解释 |
| page-bili-drafts | /world/bili/drafts | 待放行改稿台 | 统一队列+放行确认 | 防护·可解释 |
| page-bili-watching | /world/bili/watching | 看片偏好 | 规则+命中统计+她的眼睛子区 | 可解释 |
| page-bili-connection | /world/bili/connection | 连接 | 账号绑定/体检/通知/通道 | IA旋钮 |
| page-bili-gate | /world/bili/gate | 安全闸 | 纯行为闸（急刹/档位/配额/花费） | 防护·IA旋钮 |
| page-media | /world/media | 创作 | 底图/BGM/台词/成片 | 可解释·防护 |
| page-settings | /settings | 设置 | configGroups+人设+清理+文档 | IA旋钮 |

## 关键 Flow（5 条）

| Flow | 序列 | 对应目标 |
|---|---|---|
| 早上一眼看她 | 她的一天 → 鱼缸 → 意见箱 | 她能回话 |
| 处理她的反馈 | 意见箱 → 记忆 → 日记 | 反馈处理得动 |
| 指派回消息到放行 | 收件箱 → 待放行台 | 交互防护（放行确认） |
| 换号/体检 | 连接 → 安全闸 | 旋钮上页面 |
| 出一条视频稿 | 创作 → 待放行台 | 交互防护 |

## 与现状的对照表（9 面板 → 12 页）

| 现有面板 | 去向 |
|---|---|
| 鱼缸与作息遥控台 | 保留 → page-tank |
| 记忆管理中心 | 保留 → page-memory |
| 日记、判断卡与意见箱 | **拆分** → page-journal + page-triage |
| B站收件箱与指派 | 保留 → page-bili-inbox |
| 统一待放行与改稿台 | 保留 → page-bili-drafts |
| 看片偏好与过滤规则 | 保留+**合并 vision** → page-bili-watching |
| 安全闸、配额与风控 | **瘦身** → page-bili-gate（通道类移走） |
| 她的眼睛（cap-vision） | **合并** → page-bili-watching 子区 |
| 音视频创作工作台 | 保留 → page-media |
| （无） | **新增** page-day、page-bili-connection |
| （无） | **新增** page-settings（configGroups 四组的宿主侧承载） |

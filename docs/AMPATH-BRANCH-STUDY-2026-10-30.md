# AMpath 候选分支研究（codex/ampath-unified-candidate）· 2026-10-30

> 订正：昨天研究用的 `E:/WorkSpace_Qoder/AMpath` 是 **10-07 的快照拷贝（无 .git）**，不是仓库。
> 真仓库 `biandeshen/AMpath`（私有）有 **269 个分支**；近期工作在 **`codex/ampath-unified-candidate`**，最新提交 **2026-10-29 16:48**（就是昨天），领先 master **270 commits / 300 files**。之前的"AMpath 没有最近提交"结论**作废**。

## 1. 分支概况

- master 停在 v0.1.0 发布（10-07）；候选分支是其直接超集（behind 0）。
- 269 个分支绝大多数是 `codex/*` 工作分支；`codex/ampath-unified-candidate` 是当前集成线。
- 近期主题（10-15 → 10-29）：**world 自主旅行/私人造访 → 表达素材筛选 → 记忆召回一致性 → 对话归因评估 → MiMo JSON 模式**。

## 2. 最近代码提交（fix/feat/test，10-22 → 10-29）

| 日期 | 提交 | 内容 |
|---|---|---|
| 10-29 13:54 | 4c60dae1 | fix: **reactive guidance 加对话归因限定** |
| 10-29 06:01 | 7bd80113 | fix: **记忆召回记账在原 store 内串行化** |
| 10-29 05:03 | f39ea1f3 | fix: **召回数量与情感投影保持一致** |
| 10-29 03:06 | d31e120e | fix: **两条路径都消费合格的近期对话原文** |
| 10-29 02:29 | a3379bad | fix: **保持真实的记忆与关系提示上下文** |
| 10-29 01:36 | 9a469ac8 | feat: **MiMo JSON 请求模式（opt-in，不改旧调用）** |
| 10-29 00:05 | 7648e62d | fix: **MiMo 2.6 用量记账 + no-gain 查询影子**（结论：换模型无增益） |
| 10-28 22:57 | f1aff8d5 | fix: **基础探索不强行生成 moment** |
| 10-24 | 445aa599 | fix(desktop): 窄视图下角色世界时间可读 |
| 10-22 23:36 | 26575b17 | feat(world): **"当前所在地探索"成为持久活动** |
| 10-22 15:17 | d28f2a0d | fix(world): 披露边界消费小数时钟 |
| 10-21 17:24 | ff191e87 | feat(world): **单次自主私人造访** |
| 10-17 00:39 | 5bff5580 | feat(world): source 绑定的读书角舒适度（成对 Tick） |
| 10-16 20:50 | 3d8aaba9 | feat(world): **世界时间速率 + 成对检查点** |
| 10-16 10:03 | 37918c1b | fix(world): 退役匿名遗留 tag 效果 |
| 10-16 06:02 | 2ffac7f9 | feat(world): source 绑定的低心情反思回应 |
| 10-15 22:04 | 287cf53a | feat(world): **自主旅行经原运行时接线（opt-in）** |

300 个变更文件里：**desktop 235 个**（v20 terminal/hub/声音工作台，UI 为主）、**server 25 个**、shared **0 个**（field-engine 没动——我昨天研究的 habituation/记忆重构仍是最新的，没被推翻）。

## 3. 最值得吸收的三个（全部与我们目标直接相关）

### 3.1 conversation-assessment.ts（117 行 + 测试）⭐⭐ 立刻相关
**入站消息的"有界归因"判定**，纯函数：区分 13 种对话类型；关键能力是**归因**——`direct / quoted（引号内的话不算指令）/ third_party（转述不算）`、**否定关系**（"不喜欢你"不按负向事件算）、**边界指令**（"别回复我/别叫我X/话题到此为止"→ 四级 boundaryScope）、**代理传话**（"我朋友让我问你"不算）、引号剥除时保留"我爱你"类关键短语、讽刺检测。
**对小鱼**：这正是 M3 私信入站缺的"这句话算不算他对我说的、算哪类"判定器。现在 `bili_dm_read` 命中就 +connection——如果鱼片发"别再回复我了"，她会被推向 reunion，**这是真实风险**。该函数无任何框架依赖（纯字符串处理），可直接拷入 `persona-core` 当插件。117 行 + 两个测试文件，今天就能落地（观测期不改码，但可以先拷+测，观测开始前上线）。

### 3.2 world-autonomy + private-visits 路由（server，各 ~60 行）⭐ 模式参考
**世界自主权**：GET/PUT `/npcs/:id/world/autonomy`，schema 校验 + revision 冲突 409 + capability 关闭 403；**私人造访**：propose/withdraw/end，"没有客户端能决定接收"。两者都是薄路由 + state 层纯命令。
**对小鱼**：这是"主人能调她的自主开关"的 API 形态参考——比我们现在"改 config.json 重启"干净。M1 做预算/自主开关时照这个边界设计。

### 3.3 记忆召回一致性三连修（10-29）⭐ 直接对照
他们在同一天修了三个我们同构的坑：**召回记账串行化**（对应我们 D-32 账本覆盖）、**召回数量与情感投影一致**（对应 D-03 召回）、**近期对话原文双路径消费**（对应我们 diary 双本）。说明这些坑是共性的，我们的修法方向没错；他们的"在原 store 内串行化"值得对照我们 `life.json` 的写法复核一遍。

## 4. 结论修正

- 昨天 `AMPATH-ABSORB-2026-10-30.md` 的 4 项（habituation/记忆重构/涌现生命周期/dream）**全部仍然成立**（shared 没变）。
- 新增：**conversation-assessment 立刻可吸收**（最高优先，直接补 M3 归因缺口）；world-autonomy/private-visits 作为 M1 API 形态参考。
- 澄清：AMpath 的**表达素材筛选**（10-29 16:48 最新提交）是他们自己的内容管线，与小鱼的正文字数/口径不同，不直接搬。

## 5. 行动

1. **现在**：拷 `conversation-assessment.ts` + 测试进 `persona-core`（不动 World 行为，只加纯函数与测试），观测开始前接进 `bili_dm_read` 的归因分支——"引文/转述/否定/边界"四类不计正向。
2. 观测期结束：habituation + 记忆重构（昨天的结论不变）。
3. M1：照 world-autonomy 的路由形态设计主人侧自主开关。

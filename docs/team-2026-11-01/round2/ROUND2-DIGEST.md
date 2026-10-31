# 第二轮六席汇总 + 逐条判定（2026-11-01 00:30）

> 六席：记忆 / 自我修正 / 内容 / 运营 / 成本性能 / 挑刺②。原文同目录。
> 我的判定只用两种东西：**实跑结果**与 **file:line**。凡"部分成立"都写清哪一半不成立。

## 一、结论先说

1. **第一轮我说的四条"已修"，三条在 live 上读不到**（策略层、私信收口、词表词组级、auto 令牌路径全在 dev 分支）。
   今晚已把 dev 两条线（`dev/policy` + `dev/publisher`）合成一条，并把文案对账到分支口径。
2. **记忆这条北极星仍有结构性断点**：`recallMemory` 生产零调用（我实 grep：全仓仅 `persona-core/src/memory.ts:95` 定义处一条命中）。
   她的"连续记忆"现在只影响 prompt 里那段 top-3 文本，不影响任何行为或产物。
3. **今晚真正落地的修复只有 3 个 commit**：`8b29fd2`（dev/policy 补日界测试，38/38）、`a230a28`（auto 令牌走环境变量）、
   `eef637c`（`--token-env` + 档位行为测试，282/282）。其余全部进"观测期后"清单——不是不做，是 live 冻结。

## 二、逐条判定

| # | 席 / 发现 | 判定 | 证据（我实跑/实读） | 今晚处置 |
|---|---|---|---|---|
| 1 | 挑刺②：`全套 34/34 绿`口径越界，dev/policy 实为 30/32 红 | **成立** | `git merge-base --is-ancestor 2f0aee4 HEAD` → NOT ancestor；全量跑出 `causal-ledger` 红（断言旧 04:00 日界，代码已是 00:00） | `8b29fd2` cherry-pick 后 38/38；本文件第三节把数字全部标分支 |
| 2 | 挑刺②：`安全席 P0 已修`里"无人点击也能发"没修 | **成立**（且是我自己表述过头） | 令牌是出稿时系统自入队那张 → `draftMode==='auto'` 时零点击 | 不改判据；文档改口径：P0 修的是"再铸造"，兜底是默认 `review`。写进 §五 |
| 3 | 挑刺②：`attempts` 上限 + `draftForDay` 只在未提交工作树 | **成立**（写入时如此） | 该席 `git status` 看到 2 个 ` M` | `8ac5ce5` 在它文档定稿前 8 分钟已提交；现在 `Cortico-dev` 工作树干净 |
| 4 | 挑刺②：令牌走 argv、回执只遮一段 | **成立** | `spawn(process.execPath, [... '--token', token])` 明文进进程参数 | `a230a28` + `eef637c`：`CORTICO_ACK_TOKEN` 环境变量 + `--token-env`，打码覆盖整条回执 |
| 5 | 挑刺②：`dynamic-approve.mjs:163` 明文 token 分支 | **不成立** | 该行条件是 `showTok && id === d.id`，即必须显式 `list --show-token <草稿id>`；默认走 164 的隐藏版 | 记录为误判，不改动 |
| 6 | 挑刺②：`tierQueues` 只有文本断言 | **成立** | `perm-tier.test.mjs:17` 是 `s.includes('tierQueues(')` | 新增 `tests/perm-tier-cli.test.mjs`：真跑 `like.mjs` 子进程 + 网络打桩，self 档断言发出 `/archive/like` 且本地账 +1，review 档断言**零请求**只入队（2/2 绿） |
| 7 | 挑刺②：`dm 一份实现`不成立，`me/relation/relationLines` 两份 | **成立** | `dm.mjs:94/100/106` vs `dm-send-core.mjs:63/69/76`，`dm.mjs:131` 用本地那份 | 未改（live 冻结、dev 也先不动收口顺序），列 §四 P1 |
| 8 | 记忆席：`recallMemory` 零调用、`accessCount` 全 0 | **成立** | grep 全仓只有定义处；37 条记忆计数全 0 | 列 §四 P0（观测期后第一件事），今晚不动 |
| 9 | 记忆席：重要度不进衰减，`pinned`/`milestone` 无人写 | **成立** | `memory.ts:8` 只按 `source` 分衰减率；放行/被拒只改场值 | 列 P0，与 #8 同一改动面 |
| 10 | 记忆席：note 缺省误标 `user_said` | **成立** | `personaAdapter.ts:276` `opts.source ?? 'user_said'` + `memory.ts:31` 缺省也按 0.9 慢衰减 | 列 P0：她自己的笔记被当成"主人说的"，可信度最高、最难淡 |
| 11 | 记忆席：`snippetOf` 不处理嵌套《》→ 10-31 回扣被吞 | **成立**（与内容席"截断/嵌套标题"同源） | 三份带草稿引用的记忆 `days` 全为 0 | 列 P1，和 content 席合并成一个"标题解析"改动 |
| 12 | 自我修正席：`failed/cooldown` 等于没发生 | **成立** | `definition.ts:207` 只映 `sent→draftApproved / rejected→draftRejected`，其余 `null` | 列 P1：把 `failed` 归到 `publishBlocked` 预设，但**不把 failed 伪装成 rejected**（该席红线，同意） |
| 13 | 自我修正席：意见箱 `control/feedback.jsonl` 不存在；16 个判断小节无读取端 | **成立** | 文件不存在；全仓 grep 仅测试注入 prompt | 列 P1。她的"判断→动作"闭环现在只有 dislike 词表一条真通路 |
| 14 | 自我修正席：`feed-feedback.mjs` 仍是 n-gram，与"已改词组级"不一致 | **成立（分支问题）** | live `learnTokens` 仍有 `for (const n of [3,4]) … i += 1`；词组级在 `dc26a93`（dev） | 已改 `docs/CURRENT.md`：写清 live 未换、观察项 #27 的前提是先合 |
| 15 | 挑刺②：`230 → 4` 是分母不同的对比 | **成立** | 挑刺席复跑 3-gram 单项 = 124；230 = 3∪4 gram | 对外口径改："sent 稿产出 4 个主题词（可复现）"，不再拿 230 并排 |
| 16 | 挑刺②：likes/fav 两路仍产 6 字切片；28 片名命中脚本不在仓 | **成立** | 只有 `sentDrafts` 走 `titlesOnly` | 列 P1：两路接结构化字段 + 把命中脚本落 `scripts/`（否则"效果"永远不可证） |
| 17 | 运营席：`notify.mjs` 的 `type:'dm'` 会真发私信并占当天唯一收信人锁 | **成立** | `tools/commands/notify.mjs:199-208` 直接调 `dm.mjs` 发送 | 观测期红线写进 §三：**通知一律 ntfy/bark/desktop，禁 dm**；K4-1 的私信口径不能被自己污染 |
| 18 | 运营席：冻结清单不含 `observation-day/wake-audit/action-watch`；14 天窗未开 | **成立** | `control/observation.json` 不存在 | 明早 G3b 后再定，改判据窗口已过（§六） |
| 18b | 运营席：G3b 有 1 项 PENDING（10-28 草稿无 diaryHash、无 action） | **当时成立，现已过期** | 我 11-01 00:38 在 live 跑 `g3b-check --dry` → 5/5 全 PASS；跨 00:00 后"连续 3 天"滑动到 10-29/30/31，10-28 不再是拦项 | 记录口径：**窗口随自然日滑动，任何"G3b 差一项"的结论必须带跑的时刻** |
| 18c | 情绪标签塌缩（第一轮红队：只读 4/7 场、13 标签、"平静"56.7%） | **已修，本轮复核确认** | master `2a96eba` 的 15 情绪七维投影；实跑网格 7 场×5 档 = 78125 组：**14 个不同主标签**，最高"快乐"28.7%，**没有"平静"这一档**；带成因对照：被拒→挫败、放行→快乐、风控→焦虑 | 我从待修清单里撤掉这条（图和 digest 之前的写法都过头了）。仍待观察的是**强度**：`referenceFields` 要 ≥5 条 history 才建参照，早期恒 0 |
| 19 | 运营席：K4 三条现在一条都算不出（缺 dm 出站事件、数值→标签映射、diary 逻辑日字段） | **成立** | 与 #12/#13 同一缺埋点面 | 列 P1，作为 K4 复盘的前置 |
| 20 | 成本席：nav 每轮裸取占 59%、feed 四路无缓存、`api-cache.json` 5.9MB 全量 parse | **成立** | `api-requests.log` 实测 NET 120 次；`feed.mjs:57` 绕缓存 | 纯浪费清理，列 P1，不动节奏（3–7 分钟循环是人格成本，不砍） |
| 21 | 成本席：一天 ~0.07 USD、B 站读配额用 5.5% | **成立，但不构成门槛** | 109 请求 / 11.43M 输入（缓存命中 91.7%） | 记为"钱不是瓶颈，延迟与重复 I/O 才是"，防止以后拿 token 当借口砍"像人" |
| 22 | 挑刺②：`--status` 不是离线命令，冻结窗口不该跑 | **成立**（该席已自报跑过一次） | 它打 `relation` + `me` 两次真实读接口 | §三红线：只读命令默认离线，需网络时显式 `--live` |
| 23 | 挑刺②：live 6 块面板 = 5 块真数据 + feedback 空 + vitals 调度器是宿主 stub | **成立**（也证伪了第一轮"只有 3 块有数据"） | 逐块 curl `…/panels/<id>/state` | 口径照抄进 §五；`policy` 第 7 块只在 dev |
| 24 | 挑刺②：`日界全仓统一`越界 | **成立** | `minecraft/deaths.ts:20,39` 另有 06:00 日界；`day-report.mjs:4`/`day-snapshot.mjs:2` 头注释仍写 04:00 | 注释纠正**今晚试过并被门禁拦下**（见 §三第 4 条），改到观测期后随重冻一起做 |
| 25 | 挑刺②：Drive v3 与 `4107b97`「Drive v2 缓议」冲突 | **成立** | 拍板记录原文 | 撤回 P1，回到"缓议"，等主人重签 |

## 三、观测期新增红线（今晚实测得出，不是推测）

1. **通知禁 `--type dm`**：会真发私信并占当天唯一收信人锁，顶掉 `lastInboundAt`，直接污染 K4-1。
2. **`dm --status` 之类"只读"冻结窗口禁跑**：它打两次 B 站读接口、走流量闸门。
3. **跨 00:00 跑 dsh 全量会红一条**：`traffic.test.mjs` 的日预算断言在零点被重置——我今晚实测两次，第一次红、重跑 282/282 绿。
   这不是代码问题，但**别把它当噪声**：它证明日界生效，也说明验收脚本对时钟敏感（运营席的 `clock-guard` 就是为它）。
4. **改验收脚本会立刻被哈希门禁拦**：我按挑刺席建议顺手纠正两个 04:00 头注释，`g3b-check` 两条测试当场红
   （`changed scripts/day-report.mjs; changed scripts/day-snapshot.mjs`）。我**选择回滚注释、不重冻哈希**——
   开窗前夜由同一个人重冻验收脚本哈希，正是第一轮红队点名的循环论证。注释纠正挪到观测期后，随"重冻 4 个脚本"一起做。

## 四、排期（今晚不动 live，全部落在 dev 或清单）

| 级 | 事项 | 来源 | 前置 |
|---|---|---|---|
| P0 | `recallMemory` 接进生活循环（召回→写 `accessCount`→影响下一步工具选择） | 记忆席 #8 | 观测期结束 |
| P0 | 重要度信号进衰减：放行/被拒/风控/互关写 `pinned`/`milestone` | #9 | 与 #8 同一改动面 |
| P0 | 记忆 `source` 不再默认 `user_said`；她自己的笔记按 `note` 类衰减 | #10 | 一次性改 `personaAdapter.ts:276` + 迁移 37 条存量标注 |
| P1 | 标题/《》解析统一修（嵌套、截断、`snippetOf` 去重吞稿） | #11 + 内容席 | 一个 commit 覆盖三处症状 |
| P1 | `failed/cooldown` 进自我修正账本（不伪装成 rejected） | #12 | 新增预设，`definition.ts:207` 分派 |
| P1 | 意见箱落地（文件不存在 = 通道没通）+ 判断小节有读取端 | #13 | 与 #12 同一因果面 |
| P1 | likes/fav 两路接结构化字段；28 片名命中脚本入 `scripts/` | #16 | 词表效果实测（#27）的依赖 |
| P1 | dm 的 `me/relation/relationLines` 收口到 core 一份 | #7 | 批次②收尾 |
| P1 | WebUI 免口令收口（安全席 F-17 从 P2 提回 P1，排在面板扩能之前） | 挑刺② §六.2 | 主人确认本地服务暴露面 |
| P1 | 纯浪费清理：nav 走缓存、feed popular/rank 照 `searchCached`、静态资产 `existsSync` 短路、`api-cache` 有界 | 成本席 | 不动节奏与概率 |
| P2 | 12 个缺口脚本（`ops:day`、`proc-liveness`、`clock-guard`、K4 三件套…） | 运营席 | 逐条按"人工分钟数"排 |

## 五、分支矩阵（2026-11-01 00:30 实跑，数字必须带分支）

| 仓 / 分支 | 全量 | 说明 |
|---|---|---|
| `dsh: port/core-opencode-panel`（live） | **273/273**（EXECUTED 52） | 无 `publish-policy.mjs`、无 `dm-send-core.mjs`、词表仍是 n-gram、无 `policy` 面板 |
| `dsh: dev/policy`（今晚合并后） | **282/282**（EXECUTED 55） | = dev/policy + dev/publisher（`9f396e6`）+ 令牌/档位测试（`eef637c`） |
| `dsh: dev/publisher` | 273/273（已并入上行，不再单独激活） | `50775be` + `dc26a93` |
| `Cortico: master` | `tests/*.test.mjs` **34/34**；`persona-core` **85/85**（挑刺席实跑） | `pnpm test`（vitest）今晚未跑，不称"全套" |
| `Cortico: dev/policy` | **38/38** + `tsc --noEmit` 干净 | 未跑 vitest；7 块面板只有这条分支有 |

## 六、明早 G3b 的处置（04:05 前不改 live）

`g3b-check` 在 live 上的机器判据：canary C1/C2/C3 + 验收脚本哈希 + 连续 3 天反事实 —— 挑刺席在 dev 副本实测**全绿**，
唯一拦下的是我自己动验收脚本那次。所以**机器会 PASS，但 10-29/30/31 三天跨了不止一套代码**（4 次重启 + 合入 M1c/M2/分级放开）。
建议走**裁决 A**：把三次代码窗口与重启写进评审记录后开窗，理由——B 方案要 10-31 判 tainted 并重跑 3 天，
而 10-31 的证据不可回收、主人在场可判；机器判据本来就区分不了"跨代码窗口"，写清楚比推倒更省。

**留给主人的一件事**：10-31 那条 `failed` 稿（`dyn-20261031-9f8a2a`）现在还在待审队列里，412 风控窗口过去后要么放行要么拒掉——
拒掉正好是自我修正回路（#12）的第一条真实样本。

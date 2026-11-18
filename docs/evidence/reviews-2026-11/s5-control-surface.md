# 席位五：控制面、可操作性与可观测性（2026-11-06）

评审对象：`E:\WorkSpace_Qoder\dsh-bili-whale`（基线 = 工作树现状，未动 git）
宿主：`E:\WorkSpace_Qoder\Cortico-up`（唯一真相）；线上 http://127.0.0.1:7799；数据目录 `C:/Users/Administrator/.xiaoyu-home/xiaoyu`
纪律：全程只读。仅执行 GET（`curl` 两条：`/`、`/assets/main-SCFWJUOP.js`、`/api/webui/pages`）；无写接口、无重启、无文件改动（本报告除外）。

---

## ① 核心判断

1. **可观测性这一项，前一轮评审的"没有日志"结论是错的，但真实问题比"没日志"更麻烦。**
   落盘日志确实存在，只是**扩展名不是 `.log`**：宿主把日志写成每个 run 目录下的 `log.jsonl`。
   证据：`Cortico-up/src/core/core.ts:141` `this.runlog = new Runlog(join(this.run.dir, 'log.jsonl'), …)`；`src/core/util.ts:305-316` `commit()` 里 `appendFileSync(this.file, line)` + 超限 `rotate()`（`log.jsonl → log.1.jsonl`）。
   实测：`find $DATA -name "log.jsonl" | wc -l` = **71**（run 目录共 **75** 个，`index.jsonl` **95** 行）；最新 `data/runs/r-20261106-201641-218c/log.jsonl` 47648 字节，mtime 21:09（进程活着在写）。
   前一位评审用的 `find -maxdepth 4 -name "*.log*"` 匹配不到 `log.jsonl`——`*.log*` 要求 `log` 前面有一个字面点。**关键词与位置见 ⑤。**
   真正的洞是三个启动脚本的 stdout/stderr 归宿不一致、`data/runs/index.jsonl` 承担不了复盘、以及**面板/主人侧没有任何日志视图入口**（详见 ⑤）。

2. **控制面共享层（`cortico-adapter/src/webui-helpers.ts`）已经补齐了此前 blocker 里最贵的那一块：busy/连点/确认/失败可见。**
   任务简报里说的"`webui-helpers.ts:49-177` 的 `call`/`actionButton` 没有 busy 态，可连点"——**对 `actionButton` 已不成立**：`running` 重入闸门在 `:127,131-133`，`ui.disable(btn)` + 换文案在 `:137-143`，`confirm` 在 `:152-153`，`preRun` 在 `:155-158`，"错误被自己的刷新擦掉"的时序修正在 `:144-148,177-180`（含 2026-11-04 真浏览器实测记录）。
   **对 `call()` 仍然成立**：`:72-88` 定义体内没有 running/disable，只做 `msg.textContent = e.message` + `classList.add('bad')`。所以所有"刷新/读取/翻页"类按钮仍可连点。

3. **控件总量：106 个控件点，全部绑到数据面方法；56 个按钮里 49 个走 `actionButton`（受共享层保护），7 个是裸 `ui.button`。** 逐条清单见 ③。

4. **设计交付→落地，诚实数字约 42%（严格口径），不是"批量实施完毕"。** 38 条验收项里 16 条我能在代码里钉死（`文件:行号`）；4 条明确未落地；7 条部分；3 条"落地但入口在别处"；8 条本席位无法核验（标未验证，不计入分母外的乐观）。edge 的 7 个 `critical_missing` 落地 3 个。

5. **最大的一致性风险不是文案，是"同一个配置有两个写入面"。** `draftMode / autoDailyCap / autoWindow / like / fav / dmReply / comment / danmaku / selfDailyCap / shareDailyCap / writeGapSec` 既作为 schema 项出现在设置页（`packages/cap-bilibili/src/index.ts:388-398`），又作为面板控件出现（`packages/cap-bilibili/src/webui/client.ts:662-700,737-746`），两边措辞不同、生效路径未经我核验是否同一条。story-4 的"配置组瘦身"这一条**没做**。

---

## ② 设计落地率与未落地清单

### 2.1 输入

- `spark-output/context/stories.json`：`stories` = **9**（p0×5：story-1..5；p1×3：story-6,7,8；p2×1：story-9），`critical_assumption: true` 的有 story-1 / story-2 / story-5（各带 4–6 条 `acceptance_criteria`）。合计验收项 **38** 条（按 `acceptance_criteria` 数组长度统计：6,4,4,4,4,4,4,4,4）。
- `spark-output/context/edge.json`：`coverage` = `{total_screens: 12, total_states_planned: 60, by_category:{empty:16,loading:11,error:16,boundary:12,permission:2,offline:1,shared:8}}`，`critical_missing` = **7** 条，`key_conclusion` = "三件套（空态/busy/错误分级）在 webui-helpers 收口实现一次即修复 36 个 blocker 级缺失"。

### 2.2 逐项判定（已落地 / 部分 / 未落地 / 入口在别处 / 未验证）

| 故事 | 项 | 判定 | 证据（`文件:行号`） |
|---|---|---|---|
| s1 她开口了（P0，关键假设） | actionsToday 注入回执 / 24h 两条判定 / 第三人称呼 / 同源状态 / 一眼看出做了什么 | **未验证（本席位不覆盖后端注入链）** | — |
| s2 按按钮不再赌运气（P0，关键假设） | busy 态（禁用+换文案） | **已落地** | `cortico-adapter/src/webui-helpers.ts:127,131-133,137-143` |
| s2 | 危险操作 100% 确认后执行 | **已落地** | `cap-bilibili/src/webui/client.ts:169`（拉黑）、`:326`（仍然放行）、`:421`（删词）、`:516`（清零）、`:572`（急刹）、`:645`（解除 412）、`:666`（改松）、`:850`（解绑）；`cap-memory/src/webui/client.ts:101,193,376`（退下/置顶/回滚）；`cap-vision/src/webui/client.ts:85,162`。全量确认覆盖：49 个 `actionButton` 中 **19** 个带 `confirm:`（脚本统计） |
| s2 | 失败原因在消息行可见 | **已落地** | `webui-helpers.ts:144-148,177-180`（含实测踩坑注释） |
| s2 | 412 显示 `reason`/`riskEndpoint`/剩余时间 | **未落地** | `grep -F riskEndpoint packages/*/src/webui/client.ts` = **0** 命中；`412` = 7 命中，但只用于 `:645` 的"解除 412 风控暂停"按钮文案 |
| s3 打字打一半不再蒸发（P0） | `createDirtyGuard` + refresh 前拦一次 | **已落地（共享层）** | `webui-helpers.ts:239-288`（`watch/reset/dirty/guard`，含 `isConnected` 摘除逻辑 `:264-269`） |
| s3 | 每个列表都接了脏守卫 | **部分** | 使用点仅 **9** 处：`cap-bilibili/src/webui/client.ts:122,227,382,555,789`；`cap-journal:180`；`cap-memory:45`；`cap-state-rhythm:301`。`cap-vision`（175 行，有 textarea/输入）**0** 处、`cap-media-studio`（122 行，有 script textarea `:53`）**0** 处 |
| s3 | 按 id 局部更新不整列表重建 | **已落地** | `webui-helpers.ts:112-113,174-175`（`after` 回调）；`cap-bilibili/src/webui/client.ts:279,294`（`applySaved`）；`cap-memory/src/webui/client.ts:173` |
| s3 | 输入防抖 300ms | **已落地（原语）** | `webui-helpers.ts:296-311`；面板内使用点本轮未逐文件统计（**假设**） |
| s4 按钮全回页面（P0） | 安全闸 `autoDailyCap`/`autoWindow` 控件 | **已落地** | `cap-bilibili/src/webui/client.ts:693,694,700` |
| s4 | 配额/冷却控件 | **已落地** | `cap-bilibili/src/webui/client.ts:737,738,739,746` |
| s4 | 连接页粘 cookie + whois 校验 + 降级替换 | **已落地** | `cap-bilibili/src/webui/client.ts:825`（textarea）、`:827`（"没验通也保存…会写明未校验" checkbox）、`:830`（`bindCookie`）、`:850`（`unbindCookie`）、`:866`（`↻ 重新体检`） |
| s4 | **配置组瘦身（后端一处生效，面板不留重复面）** | **未落地** | 同一批键仍在两处：schema `cap-bilibili/src/index.ts:388-398`（`draftMode/autoDailyCap/autoWindow/like/fav/dmReply/comment/danmaku/selfDailyCap/shareDailyCap/writeGapSec`）与面板控件 `cap-bilibili/src/webui/client.ts:662-700,737-746` |
| s5 早上一眼看她（P0，关键假设） | 新增"她的一天（新）"屏 | **落地但入口在别处** | `tests/dom/her-day-panel.test.mjs:15` 导入的是 `packages/cap-state-rhythm/src/webui/client.ts`（无新屏/新 pageId）；立绘默认落地页 / 事件卡跳转 / 与 `lifeTick` 实时一致 = **未验证** |
| s6 反馈分诊台（P1） | 筛选 tab / 只看 high / 未自对治 / 分页 / 回复 | **已落地** | `cap-journal/src/webui/client.ts:199`（open/resolved）、`:214`（严重度：全部/只看 high）、`:229`（只看她未自对治 checkbox）、`:240,247`（← 上一页 / 下一页 →）、`:255`（↻ 刷新）、`:276`（`replyFeedback`）、`:333`（回复 textarea） |
| s6 | 4 格去重 + 均值校验 | **未验证** | — |
| s7 没有坏消息（P1，10 个 micro） | 版本历史每项「回滚到此」+ 确认 | **已落地** | `cap-memory/src/webui/client.ts:342`（`history`）、`:376`（`rollback` + `confirm` + 警示"工作区还有未提交的改动也会一并丢掉"） |
| s7 | 收件箱/列表分页 + 只读/编辑分离 | **部分** | `cap-journal:240,247`、`cap-bilibili:125`（list 分段）；`每页` 字样在 client.ts 里只 **1** 处（`grep -F 每页`） |
| s7 | 点单 BV + diff 提醒 | **部分** | `cap-bilibili/src/webui/client.ts:231,232`（`requestNew`）；diff 呈现未验证 |
| s7 | `force_awake` 恢复自动 / 双入口 404 修复 | **未验证** | — |
| s8 她说的话有人听（P1） | 全站数字格式化（0 原始小数） | **未落地** | `grep -F toFixed packages/*/src/webui/client.ts` = **4** 处；`grep -F ¥` = **0**；`webui-helpers.ts` 的导出清单里没有任何格式化函数（`grep -n "export (const|function)"` → 只有 `:103 actionButton, :210 askConfirm, :239 createDirtyGuard, :296 debounce, :320 sliderField, :363 textField`）→ **无共享 formatter，结构上不可能"全站"** |
| s8 | 枚举中文化 | **部分** | `cap-journal:127`（keep/drop→收/不收）、`cap-state-rhythm:192`（auto/force_sleep→自然节律/强制休息）是中文；但 `cap-journal:214` 按钮文案里直接漏英文枚举值「只看 **high**」 |
| s8 | 展开因果链 / 列表可排序 / 命中图 | **未验证** | — |
| s9 安全闸干净（P2） | vision 卡片页 + 预算 + 清理确认 | **已落地** | `cap-vision/src/webui/client.ts:55,56,57`（三个 `sliderField`：留帧数/去重地板/拼图天数）、`:58`（`setTuning`）、`:85`（`rerun` + confirm + "只动本地文件，不联网"）、`:161,162`（checkbox「我确认要删掉超期的拼图」+ `cleanupSheets`） |
| s9 | 立绘/身份锚点、体检卡 fail-closed、412 实时计时 | **未落地 / 未验证** | 6 个面板的 106 个控件点里没有写入立绘或 `displayName` 的控件（按标签枚举未发现）；fail-closed 属后端行为，本席位不覆盖 |

### 2.3 edge 的 7 个 critical_missing

| # | 缺失项 | 判定 | 证据 |
|---|---|---|---|
| 1 | 全站零空态 | **已落地（数量级未做全）** | `grep -F "placeholder(" packages/*/src/webui/client.ts` = **6**；"空态" **4**；"还没有" **8**；"暂无" **0**。12 屏 × 空态 = 16 个 planned empty 态，我只在源码里找到 6 个 `placeholder()` 调用点 → 未收口 |
| 2 | 零 busy 态（双发风险） | **已落地（按钮侧）/ 未落地（刷新侧）** | `webui-helpers.ts:127-143`（按钮）；`:72-88` 的 `call()` 无 disable |
| 3 | 错误裸奔 `e.message` 无分级 | **未落地** | `webui-helpers.ts:84-87` 与 `:178-180` 都只 `msg.textContent = String(e.message)` + `classList.add('bad')`；没有任何 level/分类/建议动作；`ui.toast`(`:42`) 与 `ui.busy`(`:49`) 原语在接口里声明但本轮未在面板中统计调用 |
| 4 | 放行结果未知态 | **未验证** | 未检索"结果未知"类文案（关键词清单见 ⑦） |
| 5 | 412 不显示 reason/riskEndpoint | **未落地** | `riskEndpoint` = 0 命中（见上） |
| 6 | 未计价显示 ¥0.00 | **未落地/无法证实** | `¥` = 0 命中，即面板没有货币格式化入口；"¥0.00 假值"这一具体形态我**没有找到**，不能确认它存在 |
| 7 | 过期令牌无提示 | **已落地** | `cap-bilibili/src/webui/client.ts:291,294`（保存即自动续签："已保存并续签令牌，放行时发的就是输入框这一段"）、`:326`（令牌过期走"⚠️ 仍然放行这一条"，文案"这条已经放了很久，还要发？"） |

**落地率：`critical_missing` 7 条里 3 条已落地、2 条未落地、1 条部分、1 条未验证 → 严格 43%，折半 57%。**

### 2.4 未落地清单（可直接开工的负面清单）

1. `riskEndpoint` / 412 剩余时间在面板上不显示（`webui-helpers.ts` 无错误分级，`cap-bilibili/src/webui/client.ts` 全文 0 命中）。
2. 错误分级/建议动作没有收口：`call()` 与 `actionButton` 都只染红一行字（`webui-helpers.ts:84-87,178-180`）。
3. 全站数字/成本格式化没有共享原语（helpers 导出清单无 formatter；`toFixed` 仅 4 处；`¥` 0 处）。
4. `cap-vision`（175 行）与 `cap-media-studio`（122 行）**完全没接脏守卫**，两屏各有 textarea（`cap-media-studio:53`、`cap-vision` 卡片备注区）。
5. `call()` 驱动的刷新/翻页按钮无 busy（journal `:103,240,247,255`）。
6. story-4 的配置组瘦身（双写面并存）。
7. story-5 的"她的一天"没有独立屏/pageId，落在 `cap-state-rhythm` 面板里。

---

## ③ 控件全量清单与缺陷表

### 3.1 总量（脚本统计，逐文件；计数口径 = 源码里出现一次控件构造函数调用 = 一个控件点）

**总计 106 个控件点**，分布：

| 面板文件 | 行数 | actionButton | 裸 ui.button | input | textarea | select | checkbox | segmented | sliderField | 脏守卫接入 |
|---|---|---|---|---|---|---|---|---|---|---|
| `packages/cap-bilibili/src/webui/client.ts` | 881 | 21 | 0 | 9 | 2 | 1 | 1 | 1 | 0 | 5 站 |
| `packages/cap-journal/src/webui/client.ts` | 437 | 5 | 7 | 3 | 2 | 2 | 1 | 3 | 0 | 1 站 |
| `packages/cap-memory/src/webui/client.ts` | 454 | 13 | 0 | 5 | 2 | 0 | 1 | 1 | 0 | 1 站 |
| `packages/cap-state-rhythm/src/webui/client.ts` | 497 | 5 | 0 | 5 | 0 | 0 | 0 | 2 | 1 | 1 站 |
| `packages/cap-vision/src/webui/client.ts` | 175 | 3 | 0 | 0 | 0 | 0 | 1 | 0 | 3 | **0** |
| `packages/cap-media-studio/src/webui/client.ts` | 122 | 2 | 0 | 1 | 1 | 2 | 0 | 0 | 0 | **0** |
| `packages/cortico-bot-xiaoyu/src/webui/client.ts` | 22 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| `packages/cortico-world-bilibili/src/webui/client.ts` | 23 | 0 | … | | | | | | | 0 |
| `packages/cortico-world-media/src/webui/client.ts` | 10 | 0 | … | | | | | | | 0 |

三个 `cortico-*` 转接头合计 55 行、**0 控件**（与"转接头不配面板"一致，因此"6 个面板"的说法成立）。
按钮合计 **56**（49 actionButton + 7 裸按钮）；输入类合计 **50**（23 input + 7 textarea + 5 select + 4 checkbox + 7 segmented + 4 slider）。56 + 50 = 106。

### 3.2 按钮 → 后端方法绑定（逐个；方法名取自调用第 5 参数字面量）

`cap-bilibili`：`:159` 让她回条→`assignAction`(confirm)；`:164` 忽略已读→`assignAction`(confirm)；`:169` 拉黑→`assignAction`(confirm,danger)；`:232` 点单→`requestNew`；`:291` 保存修改→`updateDraft`(preRun)；`:303` 放行发布→`release`(confirm+preRun)；`:326` 仍然放行→`release`(confirm,danger)；`:346` 拒掉→`reject`(preRun)；`:400` 添加词→`set`(preRun)；`:421` 删词→`set`(confirm)；`:453` 保存跳过阈值→`set`(preRun)；`:515` 刷新统计→`hits`(confirm，多余)；`:516` 清零统计→`resetHits`(confirm,danger)；`:572` 急刹/解除→`set`(confirm)；`:645` 解除 412→`set`(confirm,danger)；`:666` 保存档位→`set`(confirm)；`:700` 保存自动发布档位→`set`(preRun)；`:746` 保存配额与冷却→`set`；`:830` 校验并绑定号→`bindCookie`(confirm)；`:850` 解绑→`unbindCookie`(confirm,danger)；`:866` 重新体检→`get`。

`cap-journal`：`:90` 保存并提交→`saveDiarySection`（**无 confirm**，而 `:103` 同屏提示语写着"改这里会覆盖当天整段"）；`:111` 读取日记→`getDiary`；`:136` 保存判断卡→`upsertJudgment`；`:143` 刷新判断卡→`listJudgments`；`:276` 回复反馈→`replyFeedback`(preRun，**无 confirm**)；裸按钮 `:73,74,85,103,240,247,255` = 翻页/编辑/取消/读取，**无 busy、无 disable**。

`cap-memory`：`:69` `coreReview`；`:101` `update`(confirm)；`:181` `update`；`:193` `update`(confirm)；`:207` `update`(preRun)；`:215` `void`(preRun，**无 confirm**，但要求理由≥6 字)；`:228` `restore`；`:243` `create`；`:265` `recallExplain`；`:342` `history`；`:376` `rollback`(confirm,danger)；`:404` `history`；`:437` `checkpoint`。

`cap-state-rhythm`：`:175` `setFields`；`:183` `wakeNow`；`:207` `setMode`；`:237` `setSleepWindow`；`:308` `wakeNow` —— **5 个写按钮 0 个 confirm**。其中 `:207` 强制休息、`:237` 改睡眠窗属于"改变她的作息"，按 story-2 的"不可逆/对外写才确认"口径可以不问，但 `:237` 会把可读写窗口整体挪走，主人误操作后**页面上没有"当前生效值"的二次核对提示**（未验证，标假设）。

`cap-vision`：`:58` `setTuning`；`:85` `rerun`(confirm)；`:162` `cleanupSheets`(confirm + `:161` checkbox 双确认)。
`cap-media-studio`：`:59` `previewTts`；`:76` `buildVideoDraft` —— 合成视频是长任务，**没有 `ui.busy` 遮罩调用**（`ui.busy` 只在 helpers `:49` 声明，本轮 grep 面板未出现调用；标假设："未统计"）。

### 3.3 `writable` 侧

数据面注册表里 `writable` 标记共 **50** 处：`cap-bilibili` 17（11 true / 6 false，`src/index.ts:1036-1433`）、`cap-journal` 6（3/3，`:175,191,481,505,530,539`）、`cap-media-studio` 6（3/3，`:366-458`）、`cap-memory` 11（6/5，`:313-657`）、`cap-state-rhythm` 7（5/2，`:479,551` 为 false）、`cap-vision` 6（3/3，`:364,399,407`）。
**我没有逐个把 106 控件点对到注册条目的 writable 值**（本轮预算不足）。已知一次"点到 false"的后果有实物证据：`data/runs/r-20261104-133715-061b/incidents/2026-11-04T14-13-16-565-面板调用失败-persona-xiaoyu-memory-center-list.json` 等多条 **面板调用失败** incident（incidents 目录总文件数 **183**）→ 说明面板 invoke 会被宿主拒并留痕，但**留痕位置主人不知道**。

### 3.4 幂等保护

- 放行链路：有。测试 `tests/contract/draft-approve-panel.test.mjs:35-37` 断言 `pend.used === true`（令牌已消费）、`payload.textHash` 绑定当前正文、且响应体不含 token；`:83-90` 断言带理由放行只落 1 条 `draft-result`。级别 = **测试级（假 DOM/Node test），非真浏览器**。
- 其余 `set/update/wakeNow/buildVideoDraft`：**未见幂等键**（仅 `actionButton` 的 `running` 闸门防同页连点，`:131-133`）→ 页面刷新后重放、跨标签页并发无保护（**假设**，未做实验，禁止写操作）。

### 3.5 「主人现在能操作她的哪些事 / 哪些只能改文件或重启」

面板可操作（已验证到控件行号）：回一条/忽略/拉黑收件人、点单、改稿+续签+放行+拒稿、看片词表增删、短视频跳过阈值、命中统计查看与清零、急刹、解除 412、草稿档位、自动发布档位与时段、三类日配额与冷却、B 站号绑定/解绑/降级保存/体检、日记分段编辑与提交、判断卡增改、反馈分诊（筛选/分页/回复）、记忆搜/塞/改/置顶/移出/作废/恢复/算一算/版本历史/回滚/存档点、场值改写与叮嘱、戳醒、作息模式、睡着时段、vision 调参/重跑/清拼图、媒体试听配音/合成草稿。

**仍只能改文件（或走宿主设置页）的**：见 ④。

---

## ④ 「只能改文件」清单（可核实）

先看运行期配置事实：`C:/Users/Administrator/.xiaoyu-home/xiaoyu/config.json` 顶层键 = `displayName, worlds{console,bili-account,media-studio,qq}, tick.intervalMinutes, context{maxTokens,keepRatio,softRatio,firstTurn}, web.port, activeProvider, memory{residentCap,activeCap,archiveThreshold}, reflection.enabled`。同目录还有 `config.json.bak-20261106-qq`、`config.json.bak-legacy-2026-11-06-13-07-59`（**手工改配置的直接痕迹**：两个 .bak，文件名带日期）、`deployment.json`、`prompts/`、`data/`、`workspace/`。

| 能力 | 面板有无入口 | 现有替代路径 | 证据/搜索关键词 |
|---|---|---|---|
| 睡眠窗 | **有**（不用改文件） | — | `cap-state-rhythm/src/webui/client.ts:223,224,230,237`（`setSleepWindow`） |
| 驱动权重/场值 | **有** | — | `:164` `sliderField` 循环 + `:175` `setFields`（覆盖字段数未逐项核对，标假设） |
| 对外写配额上限 | **有** | — | `cap-bilibili/src/webui/client.ts:737,738,739,746` |
| 模型通道（`activeProvider`、providers 目录） | **无（不在本仓 6 面板里）** | 宿主设置页：`Cortico-up/src/bot.ts:946-948` `providerSettings`/`providerHub` + `allConfigGroups`；文件 = `config.json` + `<部署根>/providers/` | bot.ts:945-948 注释"共享端点配置位于部署根的 providers/" |
| 上下文预算/心跳间隔/Web 端口/记忆容量/反思开关（`tick.*`、`context.*`、`web.port`、`memory.residentCap/activeCap/archiveThreshold`、`reflection.enabled`） | **无（whale 面板 0 控件）** | 宿主 `coreConfigGroup`（`Cortico-up/src/bot.ts:939-943`）schema 设置页，或直接编辑 `config.json` + 重启 | config.json 键清单（本机 dump）+ bot.ts:939-943 |
| B 站监听开关族：`listen.comment / commentIntervalSec / dm / dmIntervalSec / scope / allDay / onlyOwner` | **无**（106 个控件点里没有对应标签） | **schema 设置页**（`cap-bilibili/src/index.ts:400-406`，带 `x-hot: true` 声明"热生效"）；无面板按钮 | 我枚举了全部 56 按钮标签 + 输入标签（脚本输出），未见"监听/轮询/范围/全天"字样；标：结论依赖标签枚举完整性 |
| 身份与立绘（`displayName`、persona 素材、`prompts/`） | **无** | 改 `config.json` 的 `displayName`；改 `C:/Users/Administrator/.xiaoyu-home/xiaoyu/prompts/*`；多半需重启（未验证热生效） | `ls $HOME_DIR` = config.json / data / deployment.json / prompts / workspace；`data/persona/` 存在但无面板写控件 |
| 素材/BGM/输出路径 | **无** | 改 `config.json` 的 `worlds['media-studio']`；宿主有 `src/web/path-picker.ts`（是否接到该键**未验证**） | `packages/cap-media-studio/src/webui/client.ts` 全文 122 行，控件只有 `:41,45` 选曲、`:53` 台词、`:54` 时长、`:59` 试听、`:76` 合成 |
| 待放行队列**批量放行** | **无** | 逐条点 `:303`；或 CLI：`scripts/dynamic-approve.mjs`、`scripts/dm-approve.mjs`（目录列举存在）；或 `scripts/ack.mjs` | `grep -rn "批量\|一键放行\|selectAll" packages/*/src/webui/*.ts packages/*/src/index.ts` → 唯一命中是 `cap-bilibili/src/index.ts:724` 的一句成本提示文案，不是功能 |
| 隔离区/备份/日终快照（`data/quarantine/acceptance-memo-20261105T001715` 等） | **无** | `scripts/ops-*`、直接翻目录 | `find -maxdepth 3 -type d` 列出 `data/quarantine/acceptance-memo-20261105T001{715,833}` |
| 事故/incidents 的查看 | **无**（主人侧） | 手动读 `data/runs/<run>/incidents/*.json`（当前 **183** 个文件）；宿主 webui 有实时日志通道 `bot.ts:1111 onRunlog: (cb) => core.runlog.onWrite(cb)` | 见 ⑤ |

**关于用户抱怨「很多功能耦合在宿主那边、我这边配不了」**：可核实的部分是——`config.json` 的 8 个顶层键里有 7 个（除 `worlds` 内 bilibili 子集）由宿主的 `coreConfigGroup`/`providerSettings` 渲染（`Cortico-up/src/bot.ts:939-948`），本仓不拥有表单；同时**本仓自己拥有的 schema 组（如 `listen.*`）也只在宿主设置页出现、不在自己的面板里**。也就是说"配不了"有两层：一层是宿主契约决定的，一层是本仓可以自己补但没补的（`listen.*` 族、批量放行、incidents 视图）。

---

## ⑤ 可观测性结论（出事后谁能看到什么）

### 5.1 日志到底写到哪

| 来源 | 落盘位置 | 谁写的 | 证据 |
|---|---|---|---|
| 机器人/宿主主日志 | `C:/Users/Administrator/.xiaoyu-home/xiaoyu/data/runs/<runId>/log.jsonl`（+ 轮转 `log.1.jsonl`） | `Runlog` | `Cortico-up/src/core/core.ts:141`；`src/core/util.ts:305-316`；实测 `find -name log.jsonl \| wc -l` = **71**，最新 47648 B（mtime 21:09，正在写） |
| 每 run 事件流 | `…/runs/<runId>/events.jsonl`、`transcript.jsonl`、`toolcalls.jsonl` | 宿主 | 实测最新 run 目录含 `events.jsonl` 11183 B、`transcript.jsonl` 10514 B、`run.json` 258 B；`core.ts:153`（transcript）、`core.ts:180`（toolcalls） |
| 崩溃/面板失败事故 | `…/runs/<runId>/incidents/<ts>-<名称>.json`（**183** 个文件） | `Runlog` 的 `incidentsDir`（`core.ts:145`） | 实测文件名直接可读：`2026-11-04T13-03-39-050-面板调用失败-persona-xiaoyu-vision-cleanupShee.json`、`…-面板调用失败-world-bili-account-inbox-unblockU.json`、`…-uncaught-exception.json` |
| 看门狗（白天） | `%USERPROFILE%\.dsh\…\control\day-watchdog.log`（脚本自己 `appendFileSync`），但**它自身的 stdout/stderr 被丢弃** | `scripts/day-watchdog.mjs:19,21,30` | `.vbs` 用 `sh.Run "node scripts\day-watchdog.mjs --audit", 0, False`（窗口 = 0，无任何重定向）→ 未捕获异常打到不存在的控制台，**永久丢失** |
| 夜间草稿 | `D:\AI\养鱼\drafts\nightly.log`（`>> … 2>&1`） | `nightly-draft.cmd:3-4` | 该路径在 `D:` 盘、在数据目录之外、且 `if not exist … mkdir`；磁盘/权限变了就静默失败 |
| Cortico 本体 stdout | `scripts/start-cortico.mjs:84-91`：`spawn(…, {cwd, detached:true, stdio:['ignore', fd, fd]})` + `console.log('[start] … 日志：' + LOG_FILE)` | `start-cortico.mjs` | **fd/LOG_FILE 的具体路径本轮没读到定义**（见 ⑦），但结构上 stdout+stderr 合并进同一个 fd |
| 根目录散落文件 | `E:\WorkSpace_Qoder\dsh-bili-whale\suite.log`（15128 B，mtime 2026-11-05 23:38） | 测试套件重定向 | `ls -la`；是否入库未验证（禁止 git 操作），`.gitignore` 内容未读 |

### 5.2 直接回答"崩溃后谁能看到原因"

- **进程崩溃（宿主内）**：原因进 `data/runs/<崩溃那个 run>/log.jsonl` + `incidents/*-uncaught-exception.json`。**能看到的人 = 会去翻目录的人**。面板上没有入口（6 个面板 106 控件点无一读 incidents）。实测 2026-11-04 有两个 uncaught-exception incident，主人若不开数据目录就完全不知道。
- **启动即崩**：3 个 run 目录**空**（`r-20261104-004421-6320`、`r-20261104-004622-2778`、`r-20261104-025212-9326`，`ls | wc -l` = 0，无 log.jsonl）→ 这类失败**没有任何落盘原因**。
- **看门狗崩**：只剩 `.vbs` 静默拉起 + 它自己写的 `day-watchdog.log`；stderr 丢失。另外它有"当日无快照就写一份 missed 事件记录"的机制（`day-watchdog.mjs:105`），这是**唯一自动化的事后判定**。
- **面板调用被拒**：`incidents/面板调用失败-*.json`（183 个文件里大量此类）+ 面板底部一行红字（`webui-helpers.ts:84-87`）。红字**不进历史、不能复制、刷新即擦**（`:79` `msg.textContent = ''` 每次调用先清空）。

### 5.3 `data/runs/` 索引能承担多少观测职责

`index.jsonl` 共 **95** 行、目录 **75** 个（索引比目录多 20 条 → 有历史目录被清理，索引与实物不一致）。每行字段实测只有：`run, startedAt, bot, pid, gitSha, previousRun`。
两条尾部样本：`{"run":"r-20261106-201641-218c","startedAt":"2026-11-06T20:16:41.799+08:00","bot":"小鱼","pid":65940,"gitSha":null,…}`。
→ **承担不了复盘**：没有退出码、没有失败原因、没有配置/构建指纹（**`gitSha` 全为 `null`**，样本 2 条，全量未统计）。能回答的只有"她起过几次、什么时候起、上一个 run 是谁"。

### 5.4 与"没有日志"的旧结论的关系

**旧结论应撤销**：不是没有日志，是（a）扩展名/位置反直觉（`log.jsonl` 而非 `*.log`）、(b) 检索词写错、(c) 主人侧没有日志视图、(d) 三条 stdout 去向各不相同且两条会丢。
证据链完整性自评：**已验证** = 71 个 log.jsonl / 183 个 incidents / 3 个空 run / index 95 行 gitSha null / 4 个启动脚本原文 / day-watchdog LOG 路径；**仅自述** = `start-cortico.mjs` 的 `LOG_FILE` 具体路径（脚本 printf 说会打印，我没读到常量定义）；**无证据** = incidents 是否有面板入口（我未检索"incident"关键词在 client.ts）。

---

## ⑥ 面板正确性的真实验证强度（硬规矩核查）

- **真浏览器测试：0 个。** 搜索关键词与位置：`tests/helpers/panel-harness.mjs` 全文 grep `jsdom|JSDOM|playwright|chromium|happy-dom|puppeteer|DocumentFragment|new Function|esbuild|eval` → **0 命中**。
- **实为"自建假 DOM"**：`tests/helpers/panel-harness.mjs` 里的 `class FakeEl`（第 14 行起），自己实现 `classList`/`textContent`/`disabled`/`listeners`；头部注释（第 4-8 行）明确："真浏览器该继续用（视觉与宿主行为最终以它为准），但**行为契约**……可以离线断言"。测试**直接 import 真的面板源码**执行，例如 `tests/dom/pref-hits-panel.test.mjs:15` `import { preferencesPanel } from '../../packages/cap-bilibili/src/webui/client.ts'` → 不是"源码含某字符串"，是跑真代码，比字符串断言强，但仍不是浏览器（无 CSS、无宿主真实 ui 原语、无缓存/哈希行为）。
- **两类各多少**：DOM 行为断言测试 **10** 个（`tests/dom/` 目录列举：action-button-guard、b13d-ui-fixes、drafts-release-carries-text、feedback-triage-panel、her-day-panel、memory-center-edits、memory-history-rollback、pref-hits-panel、recall-explain-panel、tank-smoke；单文件 DOM 断言行数 3–19）。"源码字符串"式假绿在面板测试里 **0** 个；全 `tests/` 只有 **2** 处该形态，且打在 CLI 而非面板：`tests/perm-tier.test.mjs:23`（`assert.ok(src('commands/like.mjs').includes('30 * DAY'))`）、`:35`。
- **哪些关键面板其实没有专属 DOM 回归**（按 `tests/dom/` 10 个文件名 + 其导入的包名统计）：**`cap-vision` 整块、`cap-media-studio` 整块**（10 个文件里没有任何一个引用这两个包的 client.ts）；`cap-bilibili` 的**连接台（cookie 绑定/解绑/体检）**与**安全闸台（急刹/412/配额）**没有同名专属测试文件（bilibili 侧只有 drafts-release、pref-hits、b13d 三个）。`cap-state-rhythm` 只有 her-day 一个角度。
- **假绿的真正形态**（本轮最重要的一条判断）：**不是字符串断言，而是假 DOM 与宿主真 ui 的漂移**。两处已有自证：`webui-helpers.ts:14-17`（"上一版把 segmented 的参数顺序、input 的回调名都写错了，而本仓没有 tsc 门禁……于是类型错了没人报警"）与 harness 第 37-40 行（早先 `textContent` 实现导致"确认层少一段正文，测试却绿着"）。
- **资产哈希（只读 curl 实测）**：`GET http://127.0.0.1:7799/` → HTTP 200 / 692 B，`index.html` 引用 `/assets/main-SCFWJUOP.js`；`GET /assets/main-SCFWJUOP.js` → **HTTP 200 / 1,544,882 B** → **当前构建产物可取，今日无旧哈希 404 症状**。成因在宿主侧有注释自证：`Cortico-up/src/web/server.ts:2523`"入口文件名带内容 hash(缓存需要)"。另 `GET /api/webui/pages` → **404**（我猜的路由名，不代表面板清单不存在）。本仓自带哈希核对工具但**我没运行**：`scripts/check-hashes.mjs`、`scripts/hashes.json`、`scripts/check-live-drift.mjs`、`scripts/build-webui.mjs`（scripts 目录列举）。
- 我**没有开浏览器、没有改任何状态**；未运行任何测试（避免写入）。

---

## ⑦ 一致性：5 个具体例子（带行号）

1. **同一档位在两处、两套说法**：schema 标题"动态草稿发布档位""自动发布每日上限（0=不限）""写操作最小冷却间隔（秒）"（`packages/cap-bilibili/src/index.ts:388,389,398`）vs 面板按钮"保存自动发布档位""保存配额与冷却"（`packages/cap-bilibili/src/webui/client.ts:700,746`）。主人无法判断改哪个、另一边会不会覆盖。
2. **养成风 vs 后台风同屏混用**：`cap-bilibili/src/webui/client.ts:221` 描述文案"动态草稿、私信草稿、待审评论、待审弹幕都在这里。改字后自动续签令牌，可直接放行。"、`:294`"已保存并续签令牌"、`:453`"保存跳过阈值（秒）"、`cap-memory/src/webui/client.ts:173`"同步这张卡" —— 与 `:159`"👉 让她回这条"、`cap-state-rhythm:183`"⚡ 立即戳醒她"、`cap-memory:239`"你想让她记住什么？"的养成口吻并列出现。**"令牌""阈值""同步"这三个工程词直接进了主人界面。**
3. **同一含义两个名字**：`cap-bilibili/src/webui/client.ts:572`"🛑 一键急刹（停止一切对外写）" vs `:645`"解除 412 风控暂停" —— 都是"停一停对外写"，一个叫急刹、一个叫熔断/暂停；且 `:572` 把当前状态写进按钮标签（label 会随状态变化），与全仓"按钮=动作、状态=pill"的口径不一致。
4. **枚举中英混排**：`cap-journal/src/webui/client.ts:127` 把 `keep/drop` 渲染成"收/不收"（全中文），但 `:214` 的严重度分段直接露英文"只看 **high**"，`:199` 的 `open/resolved` 却译成"未解决/已解决"。同一面板三种口径。
5. **数字口径未收口（后端一致性无从谈起）**：`webui-helpers.ts` 的导出函数清单（`:103,210,239,296,320,363`）里**没有任何数值格式化函数**，全 6 个面板只有 4 处 `toFixed`、0 处货币标记；`stories.json` story-8 的 scenario 里那个真实值 `0.9606346078812088` 说明后端就是把原始浮点交出来的。面板与后端的数字口径**当前无任何合同约束**（除 `cap-bilibili:515` 命中统计那类整数）。

---

## ⑧ 最该先做的 3 件事

1. **把"失败与事故"接进控制面**（一次改动覆盖 3 条 blocker）。在 `webui-helpers.ts` 收口：错误分级 + 建议动作 + 重试；并给 `call()` 加 busy（`:72-88` 现状）；再加一个"她最近出过什么事"的只读面板，直接读 `data/runs/<run>/incidents/*.json`（现存 **183** 个文件，含 `面板调用失败-persona-xiaoyu-vision-cleanupShee`）。这件事同时解决 ⑤ 的"出事后只有会翻目录的人能看到"。
2. **消灭双写面**：story-4 没做的"配置组瘦身"。以面板为准，把 `cap-bilibili/src/index.ts:388-398` 那 11 个键在宿主设置页里改成只读显示（或反之），并给 `listen.*`（`:400-406`，7 个键，目前**只有设置页、面板 0 控件**）在面板补控件。判据：同一个键只有一个能写的地方。
3. **补上"没有专属回归的三块"**：`cap-vision`、`cap-media-studio` 两个面板（0 个 DOM 测试）+ `cap-bilibili` 连接台/安全闸台；并把"真浏览器"这一硬规矩落到可执行处——现有 `tests/helpers/panel-harness.mjs` 是自建假 DOM，与宿主真 ui 已两次漂移（`webui-helpers.ts:14-17` 自述），要么加一条宿主 `ui` 形状一致性检查（宿主真相在 `Cortico-up/src/web/shared/client-panel.ts`），要么明确降级这条硬规矩、别再把它当证据。

---

## ⑨ 我没查清的东西（诚实清单）

1. `start-cortico.mjs` 里 `fd`/`LOG_FILE` 常量定义与真实路径（脚本会打印"日志：<path>"，我没读到定义行）。
2. `%USERPROFILE%\.dsh`（`start.cmd` 的 `WHALE_HOME` 默认值）目录下 `day-watchdog.log` / `action-watch.log` 是否真的存在及其大小 —— 我只搜了 `C:/Users/Administrator/.xiaoyu-home/xiaoyu`，那里 `find -name "*.log*"` = 0 命中（这是事实，也是旧结论的来源）。
3. 106 个控件点与注册表 `writable` 标记的逐条对应（我只统计了 writable 总数 50 处，未做交叉映射）。
4. `ui.toast` / `ui.busy` 两个宿主原语在 6 个面板里是否被调用（只确认 `helpers.ts:42,49` 声明）。
5. `listen.*` 的 `x-hot: true` 是否真热生效（无面板入口，未做运行验证）；`config.json` 里 `tick/context/memory/reflection` 是否有"改文件后必须重启"的硬要求。
6. `index.jsonl` 的 `gitSha` 是否**全部**为 null（我只看了尾部 2 条）。
7. story-1（注入回执 / `actionsToday`）与 story-8 后半（因果链展开、命中图表）属于后端/数据面，本席位未覆盖。
8. 面板 invoke 的路由与鉴权细节（宿主 `src/web/server.ts` 我只读了哈希与注入相关段落；`/api/webui/pages` 404 是我猜错了路由名）。
9. `suite.log` 是否被 git 跟踪、是否在 `.gitignore` 内（禁止动 git，未验证）。

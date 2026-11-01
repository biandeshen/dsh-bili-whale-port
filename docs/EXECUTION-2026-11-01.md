# 剩余任务执行清单（2026-11-01 12:40 生成）

> 27 条待办。按**车道**排（车道=同一份工作树/同一个人，避免互相覆盖），不按日期排。
> 规矩变了：**观测窗不再是"先不做"的理由**，它只是记录。该合就合、该重启就重启（今天已第 16 次重启）。

## 车道状态（此刻）

| 车道 | 工作树 | 谁在写 | 正在做 |
|---|---|---|---|
| L1 | `dsh-bili-whale-policy`（分支 dev/policy） | 席 dsh-feedback-batch | #39 #40 #43 |
| L2 | `Cortico-dev`（分支 dev/policy） | 席 cortico-catalog-auth | #42 #34 |
| L3 | `dsh-bili-whale`（正式，只碰 docs/版本） | 席 docs-hygiene | #44 #46 |
| L4 | 协调方（我）：合并、重启、真机验证、运行时配置 | — | 全部车道的合并发车 |

**L1/L2/L3 交卷后由 L4 统一合并 + 跑门禁 + 重启 + 真机验证**，不允许各席自己 push。

## 第一批（今晚，L1/L2 交卷后立刻接）

| 序 | 任务 | 车道 | 为什么先做 | 依赖 |
|---|---|---|---|---|
| 1 | **#56 日记读取分页** | L2 | 她现在拿到的是**被截断的**全量（日志反复 `12000 > 8000`），比"太多"更严重——她以为读完了 | — |
| 2 | **#54 debrief 指错路 + 字幕路径** | L1 | 她 high；错误指令会让她反复撞不存在的能力 | 与 #39 同文件区，同批 |
| 3 | **#55 记忆作废通道** | L2 | 她 high：写错的记忆永远撤不掉；含存量被 watchedVideo 污染的那批 | #30 已做完"不再写假的" |
| 4 | **#41 审批回传理由** | L1+L2 | 她要从被拒里学习，现在只知道"没通过" | 面板（L2）+ dynamic-approve（L1） |
| 5 | **#53 + #45 迁移收尾** | L1 | 半成品在 `E:/WorkSpace_Qoder/migration-wip-paths.patch`（72 行），credentialsPath 已改指新家但调用方没接，**不能直接合** | 必须等 L1 空出来 |

## 第二批（明天，需要设计口径）

| 序 | 任务 | 车道 | 说明 |
|---|---|---|---|
| 6 | **#31 判断→动作（判断卡）** | L1+L2 | 方案 A 已获同意：她提 → 你在页面采纳 → 进 `preferences.judgments` 硬过滤。红线：额度/审批档位/kill 她永不可改。设计稿 `team-2026-11-01/round2/judgment-loop-design.md` |
| 7 | **#52 消息机制** | L2+L4 | 入站事件驱动（私信到→立刻醒，秒级）；出站给她一个通知工具（禁 dm 通道） |
| 8 | **#49 配置总览开写** | L2 | 前置是 **#34 认证**（不做假修法）；含补 17 项 DEFAULTS 声明、非法值拒绝、恢复默认、一键重启 |
| 9 | **#48 她的名字页面可改** | L2 | 四处联动：B站 昵称 `self.name`（真改要一次写操作+二次确认）、宿主显示名、CONSTITUTION 叙事、头像素材 |
| 10 | **#58 排序指标 + 扩展指不存在工具** | L1 | 前半我们能改（不许用不可比密度排序）；**后半要注意**：`alarm_set` 是第三方扩展 `coo-world-petdiary` 内部发的消息，我们改不了它的包——只能①给她补一个 alarm 工具，或②在 ORIENTATION 里教她忽略，并给上游提 issue |
| 11 | **#33 词表 likes/fav 两路** | L1 | 命中复量脚本已入仓，剩两路接结构化字段 |
| 12 | **#47 收尾** | L4 | CA 根因已修（`--use-system-ca`，实测市场搜索出真包）；剩：registry 你选一个源（页面已有可选列表） |

## 第三批（时间性/外部条件）

| 任务 | 卡在哪 |
|---|---|
| #51 上游对账 | 流程可今晚建（fetch 已实测通，落后 431 提交）；**真跟不跟要你拍板**（opencode provider 加载失败就是被这个卡的） |
| #26 通知实弹 | 要你的 ntfy topic / bark key；不给就永远只能本机 toast |
| #27 词表效果观察 | 时间性：需要 3–5 天真实候选，不能加速 |
| 14 天观测窗 | 11-02 00:00 起算，但**不再冻结改动**；K1 的 tainted 计数照记 |

## 已完成（今晚，供对账）

记忆闭环 #30、私信死循环 #37、假"喜欢"记忆 #38、聊天=鱼缸 #35、词表回执 #36、《》取位 #32、配置全量可见（只读 58 项）、市场/上游出网根因（302 hosts + `--use-system-ca`）、扩展启用（figure + pet-diary 已挂载）、npm 源可选列表、回信时效窗默认不限、意见箱 25→21（4 条核到证据后标解决）。

## 第一批收尾（11-01 13:00 后，全部已合并 + 门禁绿 + 真机验过）

| 项 | 落点 | 真机证据 |
|---|---|---|
| **#56 日记分页** | Cortico `paginateDiary` + `bili_diary_read(book/page/days/budget/date)` | 她在控制台照抄回执："公开共 6 块 14737 字…还剩 5 块 10737 字"。旧版是两本拼接后 `slice(0,12000)`，**公开本 14737 字根本放不下** |
| **#54 debrief 两条 high** | dsh `BILI_VISION=1/0` + 字幕内联 + `--from/--to` 时段 | `node tools/bili.mjs debrief BV1Sw41187j4` 实跑：`封面：本会话**没有读图工具**…这不是你的失误`、`字幕 262 行 → 内联 105 行/1999 字（写明还剩 157 行）` |
| **#55 记忆更正通道** | Cortico `bili_memory_void`（voided 章 + 召回排除 + 一次只准点一条）；dsh `scripts/repair-memory-source.mjs` | 她调 `bili_capabilities` 后自己复述"更正记忆…只准点名一条"；存量 17 条 `sender=npc` 却挂 `source=user_said` 已改回，7 条真私信未动，备份 `fields.json.bak-1793508964723` |
| **#41 审批回传理由** | dsh `--why`（草稿 + draft-result 因果账）+ 面板弹窗 + Cortico 结算进记忆 | 354/354 + 98/98 门禁；记忆行形如「主人没让发那条草稿（主人的理由：…）」，没写理由则明说"别替他想一个" |
| **#49 配置总览开写** | Cortico `settingsSet` + 页面每行一个输入框与「改」 | 页面上把 `listen.commentIntervalSec` 60→61 真写进配置并留 `settings-change` 账；`-5` 当场被拒（真机点出一个范围表漏了 `Sec/Interval/Gap` 的洞，已补并钉进测试），最后已恢复成 60 |
| **#42 手脚清单** | `bili_capabilities`（工具/扩展/开关三段，只读） | 实调返回 31 个工具，按提供方分组 |

**顺带纠一条我自己的错话**：#55 提交说明里我写过"误标的 `user_said` 会让召回以『主人说过』的口吻浮上来"。查了消费方才确认：口吻取的是 `sender`（当时已经是对的），`source` 只进衰减率（0.9 vs 1.0）。所以这次修的实际是**来源记录的正确性 + 衰减权重**，不是措辞。原文照留在 commit 里，这里更正。

## 还欠的（下一批）

- **#34 写接口认证**：席 cortico-catalog-auth 的结论是"真招不是新写一套，是给正式部署开 `CORTICO_WEB_PASSWORD`"（未登录写路由 401、WS 断），代价是两处合法盲 POST（`scripts/start-cortico.mjs`、`scripts/c2-window.mjs`）要先登录。**等 #53 那条席把 dsh 交卷再动这两个文件**，否则两边同仓打架。
- **#48 她的名字**：`self.name` / `owner.displayName` 现在页面可改（标"改后要重启"）。剩下的两处联动没做：① `definition.ts` 里写死的 `Xiaoyu's current emotion` 这类工具描述文案；② B站 昵称是账号字段，真改要一次账号写操作 + 二次确认，目前页面上明确不改账号名。
- **#53 + #45 迁移**：席正在跑（72 行半成品已接成 `stateDir/stateReadPath/writeStateText`，87 个 `.bili-ai` 调用点逐个换）。
- **#50 回归（新发现）**：`bili_capabilities` 报出 `figure · 开 · 这轮没挂` —— 配置开了但没装配上，需要查是加载失败还是 API 版本不符。
- 其余：#31 #33 #40 #46 #47 #51 #52 #57 #58（#58 后半受限于第三方包 `coo-world-petdiary` 自己发的 `alarm_set`，我们改不了它的包）。

## 原本"需要你的四件事"已作废

名字 / 通知 / registry / 上游这四件不再问：名字与通知已进配置页（一格一改，含 `notify.type`），registry 在扩展页有下拉可选也可输入，上游对账脚本属于我能自己先做出报告的活。

## 第二批（11-01 13:30–14:20，主人追问"扩展为什么已安装未加载、开关在哪"）

| 项 | 落点 | 真机证据 |
|---|---|---|
| **#34 写接口盲写洞** | Cortico `src/web/server.ts`：改她人生的写接口（`/api/config`、`/api/prompts*`、`/api/webui/*`、`/api/extensions/{install,uninstall,registry,check,index-base,vote}`、`/api/worlds/{activation,restart}`）**缺 Origin 就 403**；`/api/run/*` 不拦 | 本机 `curl -X POST /api/worlds/activation`（无 Origin）→ `403 这类写操作只接受浏览器发出的同源请求…`；带同源 Origin → 400 未知 World（说明闸门之后才到 handler）；`curl POST /api/run/resume` → 200（启动器照样叫得动她）；页面上再写一次 `listen.commentIntervalSec` 60→61→60 两次都 ✓ |
| **扩展页开关与原因** | 每张卡片就地激活/停用（走 `/api/worlds/activation`，热生效）；四种"没加载"各写原因；provider/bot 不作假装有开关 | 点「停用」两次 → `config.json` 真变 `worlds.figure.enabled=false`、API `enabled=false`；再点「激活」→ 回 true；8 张已安装卡现在全列出来（原来默认每页 2 个，figure 与桌宠日记被分页藏掉，这就是"没有按钮"的真因） |
| **#50 回归已闭环**（上一条我写的"需要查"结案） | 不是 figure 没挂：清单拿工具表反推挂载，而 figure 只出画面/事件、不出工具 → 报成"没挂"。加 `listWorlds` 挂载表 | 她现在照抄：`figure · 开 · 这轮挂着，但它不出工具（画面/事件类）` |
| **#53+#45 两个家归一** | 席做完 87 个调用点（凭据按"留在旧家"处理，traffic 状态搬家前整份复制）；我补了它交出来的洞：`pending-replies.json` 写侧搬新家、读侧（`core/api/routes.js`、`panel/data.js`）还守旧家 | 门禁 363/363 + 一致 + 全部有生产调用；新增 `stateReadPathFrom` 每次读现判，测试锁"两边都有读新家 / 新家没了退旧家 / 都没了返回新家路径" |
| **#48 她的名字**（半） | `personaNameFromConfig()` 读 `self.name`（24 字、空值回落），页面标题每次渲染现读；工具描述里的"小鱼/Xiaoyu"全部删掉 | 真机 self.name=恐怖深海鱼，标题跟着走；文案明说这一格是**本机称呼**，B 站昵称是账号字段、这一页不替主人动账号 |

**没吹的**：#34 这一道不是认证——同机进程先 `GET /` 再带 Origin 仍然通。要挡同机进程得开访问密码 `CORTICO_WEB_PASSWORD`（`docs/WEBUI-AUTH-2026-11.md` 已写清代价：操作员每次要登录、两处合法盲 POST 得先登录），这条留给主人拍板后再开。#48 剩下 B 站昵称写操作与宿主导航名两处来源没动。

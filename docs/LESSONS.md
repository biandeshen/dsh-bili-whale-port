# 踩过的坑与定下来的规矩

> **这份文档记的是「为什么」**：我们做过哪些判断、付了什么代价、以后遇到同类情形该怎么做。
> 它不记「现在是什么」——那是 [`specs/`](./specs/) 十份详设的事；也不记「到哪了」——那是案卷的事。
>
> 机器可读的同一批条目在 [`lessons.jsonl`](./lessons.jsonl)（一行一条，字段 `id/category/severity/title/rule/when/why/evidence/since`），
> 用来筛选与统计。**两边 ID 一一对应，改一边必须改另一边。**
>
> 每条都带 `file:line` 或仓内路径作为证据。写下来的是「当时真的发生了」，不是「理论上应该」。

## 怎么用这份文档

- **动手前**：按你正在干的事查 `when` 一栏。踩过的类别只有五类，扫一遍不到两分钟。
- **踩了新坑**：在本文件和 `lessons.jsonl` 各加一条，两边 ID 相同。别开新文档。
- **条目过期**：就地改，不要留"以前是这样"的残影。判据变了就重写判据，不要在后面追加一段。

**严重度**：`critical` = 会真丢东西或让防线失效；`important` = 会做错决定或反复返工；`normal` = 知道就能省时间。

---

## 一、底座是别人的项目（HOST）

这一组是 2026-11-21 推翻 subtree 方案后的结论。**先记住一句话：底座是独立克隆，我们的代码一行都不放进去。**

### HOST-01 · 独立克隆，不是 subtree `critical`

底座（`Pal-AI-Lab/Cortico`）`git clone` 到 `host/cortico`，`host/` 整棵进 `.gitignore`。

**为什么**：只有独立仓能用普通 `git pull` 拿最新代码。用 `git subtree` 并进本仓，等于把对方 **1193 个文件**抄进我们的提交历史——那不是我们写的代码，却永久住在我们的 `git log` 里；每次更新变成一次合并，冲突面从 0 变成全树。

**代价**：换机器要多跑一次 `node scripts/setup-host.mjs`（见 [`CORTICO-RUNBOOK.md`](./CORTICO-RUNBOOK.md)）。这个代价比"每次升级都合并上千个文件"划算得多。

**当时的错误**：我先按 subtree 做，还写了"如何用 `git subtree pull` 更新"的文档。方向错了，全部作废重做。

### HOST-02 · 我们的代码一行都不放进底座 `critical`

需要补的能力一律做进 `packages/`（能力包）+ `packages/adapters/`（转接头）。

**为什么**：底座一旦被改就不再是上游，`git pull` 会冲突，升级退化成手工合并。更直接的是：`scripts/setup-host.mjs --pull` 检测到脏工作树会**直接拒绝更新**。

**当时的情况**：旧底座里塞了 `SPIKE.md`、`scripts/upstream-audit.mjs`、一份 WebUI 写接口的刺探结论（现为 [`webui-auth-2026-11.md`](./evidence/webui-auth-2026-11.md)）和三份门禁报告——都是我们自己的东西。重建时已迁回本仓。

### HOST-03 · 删底座前先把我方文件迁回 `important`

删 `host/` 之前：把所有属于我们的文件找出来 → 复制到 `E:\WorkSpace_Qoder\_backups\` → 放进本仓正确位置 → 再删。

**为什么**：删除不可逆，而底座里可能混着**只有一份**的我方材料。那次删之前我先备份了，否则审计脚本和刺探结论就真没了。

### HOST-04 · 底座的 `node_modules` 必须留着 `important`

**为什么**：`host/cortico/bin/cortico.mjs` 在 `node_modules` 不存在时会自动 `pnpm install`，而 launcher 是用 `node_modules/tsx` 起的。删掉不省事，只是下次启动多等二十秒（实测 22.6s）。

它已被 `.gitignore` 排除，**本来就不占仓库体积**。

### HOST-05 · 上游与我们仓可能有同名不同物的 tag `normal`

往本仓 fetch 上游标签前先 `git ls-remote` 比对 sha。

**为什么**：本仓里 `v0.1.11` … `v0.2.0` 这些标签来自另一条分叉线，跟上游同名但指向不同对象。直接 fetch 会被拒（`would clobber existing tag`）；用 `--force` 绕过则改写本地标签的含义。正确做法是把上游 ref 分到独立命名空间。

---

## 二、删除是唯一不可逆的操作（DEL）

### DEL-01 · 删含符号链接的目录前必须先摘链接 `critical`

```bash
find <dir> -type l -delete      # 先删链接本身，不跟随
rm -rf <dir>
```

**为什么**：`rm -rf` 会跟着链接走进去，删掉链接指向的**真实文件**。

**代价（这条是真付过的）**：
- 2026-11-18：`git worktree remove --force` 跟着 pnpm 的 Windows junction 走进共享源码，清空 4 个目录 **74 个文件**（见 [`one-repo-plan-2026-11-18.md`](./evidence/one-repo-plan-2026-11-18.md)）。
- 2026-11-20：删旧克隆时，`extensions/node_modules/cortico-*` 是指回 `packages/adapters/` 的链接，`rm -rf` 顺藤摸瓜删了本仓 **47 个文件**（见 [`single-repo-2026-11-20.md`](./evidence/single-repo-2026-11-20.md)）。

**2026-11-21 重建底座时**：先 `find host/cortico -type l` 扫出 960 条链接，把 4 条指回 `packages/` 的摘掉，然后才 `rm -rf`——`packages/adapters` 完好。

### DEL-02 · 破坏性删除前先确认都在 git 里 `important`

`rm -rf` / `git reset --hard` 之前先 `git status`；未跟踪的内容先备份。

**为什么**：上面两次能恢复，唯一原因是那些文件都在 git 里（`git checkout -- packages/adapters/` 就回来了）。如果删的是未跟踪的运行数据，就是真丢。

---

## 三、门禁是用来信的不是用来绕的（GATE）

### GATE-01 · 冻结哈希不许为了过门禁而重冻结 `critical`

改动 `scripts/hashes.json` 名单里的文件，必须走正规通道：

```bash
node scripts/check-hashes.mjs --write --note "为什么改、改了什么、判据有没有放宽"
```

`history` 里会留下 `from → to` 和理由。

**为什么**：这条防线防的就是"验收期改判据"。随手重冻结等于给橡皮图章盖章。

**2026-11-21 的例子**：我把 `scripts/run-mjs-tests.mjs` 里一句描述 subtree 的注释改成"独立克隆"，触发了冻结校验（3 个测试变红）。处理方式是走 `--write --note` 并写明"只改 SKIP 注释里的一句描述，SKIP 集合与全部判据未动"——**没有**为了变绿去动哈希本身。

### GATE-02 · 门禁假阳性比漏检更坏 `critical`

门禁报红时，先确认**它自己量对了**（基准、口径、宿主在不在场），再改代码。

**为什么**：假红会逼下一个人直接加白名单绕过整条门禁，防线就废了。

**实例**：文档门禁的路径基准一直按"从文档所在目录算"，把 `docs/`、`packages/` 这类仓根相对写法全判成失效，第一次跑报了 **1256 条**假违规（见 [`check-doc-hygiene.mjs`](../scripts/check-doc-hygiene.mjs) 的口径注释）。修的是基准，不是加重豁免。

另一例：底座搬进仓内后 `<宿主>/extensions` 这种**运行时生成**的目录被判失效——它本来就不进 git，该算"未核"而非"失效"。

### GATE-03 · 发现数必须等于执行数 `important`

测试跑批要同时报 `DISCOVERED` 与 `EXECUTED`，两者不等即失败（见 [`run-mjs-tests.mjs`](../scripts/run-mjs-tests.mjs)）。

**为什么**：宿主自带 371 个测试混进来，会把"我们执行了多少"稀释成一千多个文件；真正的回归反而看不见。

### GATE-04 · 退出码 0 不等于有产物 `important`

构建/生成类脚本必须**断言产物存在且非空**。

**为什么**：实例——`packages/` 分层（`kernel/capabilities/adapters/shared`）后，构建脚本仍只 `readdir` 一层，于是它"成功"了但**零产物**（见 [`build-webui.mjs`](../scripts/build-webui.mjs) 的 `targets()` 注释）。`exit 0` 把整件事盖住了。

### GATE-05 · 断言最终输出，不只断言中间集合 `important`

验收要走生产路径，断言**真正发出去/写下去**的那份内容。

**为什么**：中间集合对而最终输出错，是这类功能最常见的失败形态。只测中间集合等于没测。

---

## 四、Windows 与工具链（PLAT）

### PLAT-01 · 排他创建文件可能报 EPERM 而非 EEXIST `important`

以 `'wx'` 方式创建锁文件时，`EPERM` / `EACCES` 与 `EEXIST` 同义——都是"别人刚建出来，我没抢到"。

**为什么**：Windows 上并发创建同名文件报的是 `EPERM`。只捕 `EEXIST` 会让**一次锁竞争**升级成"整个请求保护不可用"，测试偶发红（见 [`traffic.mjs`](../packages/capabilities/cap-bilibili/src/platform/traffic.mjs:55) 与 `tests/traffic.test.mjs`）。

### PLAT-02 · `.cmd` 包装的命令不能直接 execFileSync `important`

调 `pnpm` / `git` 这类 `.cmd` 包装时给 `execFileSync` 传 `shell: true`。

**为什么**：`argv[0]` 是 `pnpm.cmd`，不经 shell 解析就找不到可执行文件，报 `ENOENT`——看起来像"命令没装"，其实是调用方式不对（见 [`setup-host.mjs`](../scripts/setup-host.mjs)）。

### PLAT-03 · 算仓根用 fileURLToPath `normal`

由 `import.meta.url` 推目录时用 `fileURLToPath`；`URL.pathname` 会把 `~`、空格、中文 percent-encode。

**为什么**：本机临时目录是 8.3 短名（`ADMINI~1` → `ADMINI%7E1`），算出来的仓根根本不存在，`.env` 明明在却报"缺配置"。**错诊断比报错更坏**（见 [`host-root.mjs`](../scripts/lib/host-root.mjs)）。

### PLAT-04 · 版本号必须是合法 semver `normal`

用内容哈希做版本 bump 时写进 prerelease 位（`0.1.0-<hash>`），不要塞进 patch 位（`0.1.<hash>`）。

**为什么**：hex 含字母，patch 位放字母是非法 semver。在本仓一直没暴露（从没被 pnpm 校验过），换成外面的底座后 `pnpm install` 直接 `ERR_PNPM_BAD_PACKAGE_JSON`（见 [`build-webui.mjs`](../scripts/build-webui.mjs)）。

---

## 五、文档体制（DOC）

### DOC-01 · 现状归 specs，过程归 evidence / attic `important`

"某功能现在是怎么设计的"只写在 [`specs/`](./specs/) 十份里；过程案卷进 `attic/`，门禁报告进 `evidence/`。**功能变了就地改那份 spec，不许再开一本。**

**为什么**：只增不换的文档 12 小时翻倍，后果不是难看，是因果——改代码时没有规格可对照、只有案卷可翻，于是同类坑反复来。这条由 [`check-doc-hygiene.mjs`](../scripts/check-doc-hygiene.mjs) 的 R1 守着。

### DOC-02 · 文档里写的路径必须存在 `important`

活文档里的相对路径与 `file:line` 要与现状对得上（`attic/` 与 `evidence/` 豁免——那里记录的是当时的真相，不许改写）。

**为什么**：照着文档里早已不存在的路径去开文件，是"读错家"这类故障的标准入口。

### DOC-03 · 设计裁决不等于验收结论 `important`

`attic/` 里"100% 宿主无关"这类话是**方向拍板**，不是已验证事实。对外口径只认当次实测。

**为什么**：把设计目标当既成事实，会把未验证的耦合当成零耦合对外宣称。

---

## 六、装配与产物（ASM）

### ASM-01 · 能力包不声明 webUiClient `important`

面板产物只给声明了 `cortico.kind` 的**扩展包**挂 `webUiClient`；能力包的面板由所属扩展包合并后统一声明。

**为什么**：一个扩展包只能有一个 `webUiClient`；能力包不是扩展包，给它声明等于指向一个不会被加载的入口（见 [`build-webui.mjs`](../scripts/build-webui.mjs)）。

### ASM-02 · `link:` 依赖用相对路径 `normal`

底座 `extensions/` 里挂我们的包时，用相对 `link:` 指向 `packages/adapters/`。

**为什么**：绝对路径换机器即断，换盘符也断；相对路径从 `extensions/` 出发永远指得回仓里。

---

## 七、停摆不是安静（STALL）

这一组来自 2026-11-21 的对抗演练：正方主张"止损够用了"，反方专门找**跨天 / 跨重启 / 长停摆**的缝。
两条 critical 都是真跑出来的，不是推演。

### STALL-01 · 退避步数不许因时间流逝归零 `critical`

`step` 只有**通道真的恢复**（`clearStallState`）才清零。`until` 过期只表示"窗口结束了，可以再试"，**不等于恢复**。

**为什么**：演练实测——8 小时后读回 `step` 从 6 变成 0。402 欠费不会自己好，主人隔一天才充值的话，退避就从封顶 60 分钟退回 2 分钟重爬，一夜又撞十几次。这正是 2026-11-14 修过的毛病在长停摆下复发。

**边界要小心**：既有测试 `stall-stoploss.test.mjs` ③ 断言"一周前的记录视为无"。我把兜底窗口设成 7 天时用了 `>`，恰好把这条测试撞红——**不是测试过期，是我把边界选得太险**。改成 `>=` 才和既有口径对齐。

### STALL-02 · 跨天不许把最近一次失败扔掉 `critical`

当日累计（calls/paid/tokens）按天算；但**通道健康（last402/lastErr/lastPaid）必须跨天扫**。恢复只由"成功调用晚于最后一次失败"证明。

**为什么**：原来 `if (dayKey(started) !== today) continue` 让跨天后 `lastErrMs` 永远是 0 → verdict 落成 `quiet` → 心跳把 `quiet` 当成"通道可以了"直接清零退避。欠费不会因为过了零点就好。

### STALL-03 · 停摆保护只挂在心跳上，外部消息仍会撞一次 `normal`

**已知缺口，不在我能单方面修的范围**：主人发消息走宿主的投递路径，persona 的 `onDelivery` 只能注入、返回值被宿主忽略，拦不住"起一轮"。要真拦得改底座的投递契约——那是跨仓决定，不该为它擅自魔改底座。

**为什么严重度只给 normal**：查实宿主把 402 归为**不可重试**（`retryable` 只认 0 / 429 / 5xx），所以代价是**一次**失败，不是重试风暴。这条要真修，先出提案。

### PERF-01 · 只增不减的日志不许每次全量扫 `important`

心跳路径上的大文件（`usage.jsonl`）只读尾部窗口，不整份读。

**为什么**：线上那份 6.5MB / 7940 行，整份读 33ms + 解析 79ms ≈ **110ms**；心跳 30–90 秒一次，这是常驻开销，而且日志只增不减会越来越慢。

**测试上踩的坑**（值得单独记）：第一版用 `heapUsed` 差值断言"没整份读"，**变异测试（把窗口改成全文件）居然仍通过**——GC 时机和堆波动把差异吃掉了。那种断言等于没断言。改成直接数 `fs.readSync` 实际读了多少字节，变异立刻变红。

---

## 八、记忆不是存了就完（MEM）

这一组来自 2026-11-21 的记忆域对标（Mem0 / Zep / Letta 逐项对照）。

### MEM-01 · 过期记忆是降权不是删除 `critical`

`validUntil` / `supersededBy` 只把记忆乘上 `SUPERSEDE_WEIGHT`（0.25）降权，**`content` 永不删除**。回执要注明「这是过去的」。

**为什么**：过期不等于假。「我以前以为主人不喜欢猫」是有意义的记忆——归零等于改写她的人生史，违背"原文永不删除"这条老规矩。降到 0.25 而不是 0.5，因为 0.5 仍可能压过一条低鲜活度的有效记忆，那就本末倒置。

**踩的坑**：`serializeMemoryCard` / `parseMemoryCard` 最初漏了这三个新字段，表现是「标记成功、返回值里有 `supersededBy`，但重新读盘就没了」。**半成功最坏**——调用方以为记下了，下一轮召回完全当它没发生。

### MEM-02 · 冲突只提示，不自动覆盖 `important`

新记忆写入时只报「可能和这几条矛盾」，回执写「哪条算数要你定」；显式覆盖走 `memory_supersede`。

**为什么**：跟 `prefs.like` 同一个原则——系统不下结论。自动覆盖会让"听起来更新"的说法悄悄改写旧事实，而没人知道是谁改的。

**语义要把住**：`memory_void` = 当初就记错了；`memory_supersede` = 当初对、现在有新说法。前者移进 voided/，后者留在原层只标出处。

### MEM-03 · 统计口径必须复用现成的那一份 `important`

容量/水位统计走 `store.tierSize()`，不许在面板里自己 `readdir` 再数一遍。

**为什么**：我在面板里手写 `readdirSync(store.memoRoot)`，与既有 `tierSize()` 口径不一致——空库能过、**写过卡的反而数到 0**。两处各算一遍必然漂。

### TEST-01 · 排序断言不能让 id 排序蒙对 `critical`

验"降权生效"时，必须让被降权的那条在其他所有维度都更占优，且 id 故意让它排在前面。

**为什么**：第一版用两条内容完全相同的卡，变异测试（拆掉降权）**居然仍绿**——因为 id 恰好 alphabetical 顺序对了。那种断言等于没断言。

---

## 九、面板是承诺（UI）

### UI-01 · 新增面板前先查它有没有下游消费者 `critical`

建任何面板或按钮之前，先 `grep` 它调用的能力**在面板之外**有没有调用点。没有，就说明这是个死出口。

**我犯的**：做提示词预设面板时没查，写下了"预览框里的就是最后会送出去的那段字"。查证后发现——本包**根本不生图**（`composeFromSelection` 除自己文件外只有面板预览调用），`assets/` 里那 8 张底图是预生成素材。**那句是假承诺。**

修法：面板描述改成"拼好后复制出去用（本包不自己出图）"，字段标签改成"预览（复制出去用）"，并补了一个真正的出口——复制按钮。

### UI-02 · 脏守卫要盖住这一页最常改的东西 `important`

刷新会重建整页，所有会被冲掉的输入（**含开关、下拉**）都要登记进 dirty guard。

**我犯的**：只盯了"预设名"和"导入框"，理由是"开关变化是快速试，不算脏"。可五个开关和两个下拉才是这一页最常调的东西——刷新一按就静默丢。

### UI-03 · 单测要按面板读的字段断言 `critical`

面板 RPC 的回归测试，字段名必须**抄面板里 `r.xxx` 的写法**。以"我返回了什么"写测试等于没测。

**真浏览器验收抓到的两个 bug**（函数都对、只有形状错）：
- `getLayers` 读 `o.deploy`，而 `readOverrides` 返回 `{overrides:{deploy}}` → 设了部署默认，状态栏永远说"没有"
- `listPresets` 返回 `{store:{presets}}`，面板读 `r.presets` → 存了预设，列表永远说"还没有保存过"

两个都是"一半对"：`composePrompt` 走另一条路读对了，所以预览生效、状态说没有。**这比全错更难发现。**

### UI-04 · 同一件事两处算，必须对账 `important`

一个状态被两个入口读时（例：`getLayers` 与 `composePrompt` 都回答"部署层生效没"），必须有一条测试断言**两边答案一致**。

分开测各自都对，只有对账才抓得到。

### UI-05 · 能力包面板必须登记进 adapter 的 client.ts `critical`

新增 `cap-*` 面板后，**必须回到 `packages/adapters/cortico-*/src/webui/client.ts` 加一行 import 与 panels 键**。能力包自己构建出的 `dist/webui.js` **宿主不读**。

**我犯的**：给 media-studio 建了 `prompt-preset` 面板，只构建了能力包。产物确实生成了（14113 B），但宿主加载的是 adapter 那个 bundle（5556 B），里面没有它。浏览器现实报「面板产物中没有 prompt-preset」。

**最难发现的地方**：构建脚本打印「cap-media-studio → dist/webui.js (14113 B)」，看起来**成功**。它确实成功了——只是那份产物没人在用。

### UI-06 · 宿主按 pageId 缓存 bundle，换版本要整页刷新 `important`

宿主 `loader` 的 `loaded` Map 以 `pageId`（如 `world:media-studio`）为键，**不看版本号**。同一浏览器会话第一次加载后，改代码、重启宿主、`location.reload()` 都可能还拿旧的；只有**新开页面 / 新进程**才彻底刷新。

这也是我一度以为"修了但没生效"的原因——其实是缓存。

---

## 待办：还没变成规矩的观察

这几条目前只是观察，**没有**升格为验收门。别拿它们去卡别人。

- 宿主 `describe.json` 的 `parameters` 目前与我们工具的真实入参不一致（旧文件是手工补的，重新生成会变空）。**这是事实，不是缺陷判定**——要修得先定"谁是真值"。
- 上游 tag 与分支的取舍（跟 `main` 还是钉某个 tag）还没定死。当前是克隆最新。

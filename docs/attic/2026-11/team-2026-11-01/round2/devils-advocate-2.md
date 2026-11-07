# 挑刺席 第二轮 —— 审「修复本身」与六席口径（2026-11-01 凌晨）

> 方法：所有判定都用**我自己实跑/实读**的证据。允许的命令：`git log/show/grep`、跑测试、只读 curl 7799。
> 一次越界自报：按任务要求跑「只读」`node tools/bili.mjs dm --status`，它实际打了 2 个 B 站**读**接口（relation/me），
> 未发任何写请求、未取凭据内容。这本身是一条结论：**`--status` 不是离线命令**，冻结窗口里不该跑（见 §七）。

## 零、结论先说

**四条「已修复」没有一条在 live 上。** 它们分散在两条互不相交的 dev 分支（外加一处**未提交的工作树**），
live 分支（`dsh: port/core-opencode-panel` / `Cortico: master`）读不到策略层、dm 收口、词表新算法、auto 令牌路径。

**不成立 4 条 + 口径越界 3 条**（下表标 ✗ 与 △）：

| # | 宣称 | 我的判定 | 一句话证据 |
|---|---|---|---|
| 1 | Cortico mjs 全套 34/34 绿 | △ **成立但口径越界** | master 我实跑 34/34 ✓；**宣称时 `dev/policy` 实跑 30/32 红 2**（审查期内已补提交转 38/38，见 §九）；`glob` 不含 vitest/persona-core |
| 1b | 日界改造全仓跟上 | △ 行为跟上、**文档/注释没跟上** | `day-report.mjs:4`、`day-snapshot.mjs:2` 头注释仍写「按 04:00 日界」 |
| 2 | auto 只用草稿自带令牌（安全 P0 已修） | **✗ 部分不成立** | 不再铸造 ✓；但**「无人点击也能发」没修**；`attempts`/`draftForDay` 宣称时未提交（§九） |
| 3 | 230 碎词 → 4 真主题词，词表不再是噪声 | **✗ 不成立（对半成立）** | 4 词我复现 ✓；但 likes/fav 两路仍产 6 字伪词；「命中变同名作品级」**不可复现**（脚本不在仓） |
| 4a | 默认档 = 拍板 | ✓ **成立** | `POLICY_DEFAULTS` = review / self / direct，`readPolicy` 白名单收敛 |
| 4b | tierQueues 入队有测试覆盖 | **✗ 不成立** | 只有「源码含 `tierQueues(` 字符串」+ 纯函数返回值，**无一条真跑 like/fav 的 --go 入队** |
| 4c | 私信收口成一份实现 | **✗ 不成立** | `dm.mjs:94/100/106` 仍有 `me/relation/relationLines`，`dm-send-core.mjs:63/69/76` 是第二份同名实现 |
| 5 | 统一控制中心已上线、真浏览器逐块验证 | △ **数据面成立 5/6，「上线」对象错位** | live 6 块：5 块有真数据、feedback 空、`policy` 面板 live 不存在（第 7 块只在 dev） |
| 6 | 六席结论互相矛盾 | ✓ 成立 | 见 §六，列了 5 处 |

---

## 一、`2f0aee4`「全套 34/34 绿」——数字真，范围假

实跑（master，`E:/WorkSpace_Qoder/Cortico`）：

```
$ npx tsx --test tests/*.test.mjs
ℹ tests 34  ℹ pass 34  ℹ fail 0
```

`2f0aee4` 的 diff 也确实只把 `tests/causal-ledger.test.mjs` 的 04:00 断言换成 23:59/00:00 边界。
**但三条限制让它不能叫「全套」：**

1. **glob 范围**：`tests/*.test.mjs` 只 5 个文件（causal-ledger/core/dm/task-queue/webui-tank），
   不含 `tests/worlds/**.ts`（vitest）也不含 `persona-core/tests/*.test.mjs`（9 个文件）。
   我另跑 persona-core：`ℹ tests 85 ℹ pass 85 ℹ fail 0` ✓（绿，但这不是「34/34」那套）。
2. **分支范围**：承载安全 P0 的 `Cortico-dev`（`dev/policy` @ `6f461d6`）**不含 `2f0aee4`**：

   ```
   $ cd Cortico-dev && npx tsx --test tests/*.test.mjs
   ✖ 只数 kind=action 且落在该逻辑日（04:00 日界）的记录
   ✖ tests\webui-tank.test.mjs
   ℹ tests 32  ℹ pass 30  ℹ fail 2
   ```

   单跑 `tests/webui-tank.test.mjs` → `7/7 绿`。即：**合并全量红、单跑绿**，且 `causal-ledger` 是确定性红
   （dev/policy 仍断言旧日界）。结论：**「全套绿」= 只在 master 成立；一旦把 P0 修复合到 live，全量是红的。**
   `AGENTS.md §6` 要求每次提交 `pnpm test && typecheck` 绿 —— 本轮我没跑 vitest（禁构建/未验证），
   所以「全套」这个词今晚不该再用。
3. **日界没跟上的别处**（grep 实测）：
   - `dsh`：`DAY_BOUNDARY_HOUR = 0` 已统一（`counterfactual/day-report/day-snapshot/c2-*`），
     `logicalDay` 名字保留但语义已是自然日 —— 名字与语义相反，属技术债（不算 bug）。
   - **注释仍是旧的**：`scripts/day-report.mjs:4`「默认按 04:00 日界取今天」、
     `scripts/day-snapshot.mjs:2`「按 04:00 日界把运行时状态落成证据」。
   - `src/worlds/minecraft/deaths.ts:20,39` 另有一套 `dayKey`（06:00 换日），与 bili 世界无关，
     但**「日界全仓统一」这句话不成立**（两套日界、三个名字）。

## 二、`6f461d6`「auto 不再自造令牌」——修的是「重造」，没修「无人批准」

① **真不铸造**：✓。`freshAckToken()`（工作树，原名 `draftAckToken`）只 `readJson` 出稿时入队的那张 pending，
缺 `ackId` / `used` / `expiresAt<=now` / `payload.draftId` 不符 → 一律 `null`。测试 5 情形（有效/已用/过期/绑定不符/无草稿）我跑通。

② **打码可绕的面**（宣称「令牌值绝不落盘」，实际只遮了一层）：
   - 只 `pub.out.split(token).join('***')` 打了**子进程 stdout**。同一函数里 `return r.out + ...` 前段
     （`draft-dynamic` 的 stdout）**未打码**就进回执/模型上下文。
   - 令牌经 **argv** 传给 `approve --token`：同机任意进程可从进程列表/崩溃栈读到，打码对它无效。
   - 令牌在 `control/pending/<ackId>.json` 里是**明文**，且 `dynamic-approve.mjs:163` 有
     `待审 token: ${p.token}` 的明文分支（164 才是 `--show-token` 隐藏版）。
     配上「WebUI 本地免口令 + 面板可读 drafts 状态」，**令牌可读 = 免口令面可触发真实发布**这条 P0/P2 链没有因为 6f461d6 缩短。
   - 判定：打码是**输出净化**，不是**密钥管理**；「绝不落盘」这句在文档层面不成立。

③ **上限能否被失败重试绕过**：修了，但**没提交**。
   - HEAD `6f461d6`：`if (pol.autoDailyCap > 0 && autoSentToday() >= cap)`，`autoSentToday` 只数 `ok` → 绕过仍在。
   - 工作树：`autoSentToday({ attempts: true })` + `attempts` 参数把失败尝试也计入 ✓。
   - `git status --porcelain`（Cortico-dev）= ` M src/worlds/bili-account/definition.ts`、` M src/worlds/bili-account/tank.ts`
     → **③ 与 ④ 的修复只活在未提交工作树**：进程重启/切分支/被别的 session `checkout` 就没了，按自家规则属「未交付」。
   - 且 committed 测试名仍是「policyInWindow + autoSentToday：…**只数今天的 ok**」→ 新语义无断言锁定。

④ **draftId 会不会被她写的文本影响**：工作树已改成磁盘事实源
   （`draftForDay(day)` 读 `<day>.json`，注释明写「不从工具 stdout 抠」）✓ 方向对。
   代价/新洞三条：⑴ **一天只认一份**草稿（当天多稿时只发 `<day>.json` 那一份，另一份永远走人工）；
   ⑵ **没检查 `status`**（返回 `{id,textHash,ackId,status}` 却从不判断）→ 对 `rejected`/`failed` 的当日稿也会尝试 approve，
   靠 `dynamic-approve` 的状态机兜底；⑶ 依赖「`dayKey` = 自然日」，与 §一 的日界改造绑成同一失败面（跨 00:00 的回合会指向次日文件）。

⑤ **最要命的一条（对宣称本身）**：这条 P0 的原始风险是「**没人点也能发布**」。
   修完之后：令牌是**出稿时系统自己入队**的那一张 → 只要 `draftMode==='auto'` 且在窗口内、令牌未过期，
   auto 依然**不需要任何人点击**就能发。也就是说 6f461d6 把「令牌形同虚设」修成「令牌必须还是出稿那张」，
   **人工把关并没有回来**（真正的闸门是 `draftMode` 配置 + 默认 `review`，而默认值确实来自拍板）。
   DIGEST §一.2 写「一次性令牌 + draftId/正文哈希绑定形同虚设 → 已修」，读者会理解成「恢复了人工审批」—— 这就是过度宣称。

## 三、`dc26a93`「230 碎词 → 4 真主题词」——4 对得上，「不再是噪声」对不上

① 复跑（我在 `dsh-bili-whale-dev` 直接调 `tools/lib/feed-feedback.mjs`，喂 `%USERPROFILE%`/`D:/AI/养鱼/drafts` 的真实稿）：

```
drafts total 6 sent 2 statuses sent,dry-run,failed,cooldown
NEW 稿子titlesOnly: 4 ["min","失眠不怕","瑜伽休息术","高效补"]
collectLearnedTokens(仅稿): ["min","失眠不怕","瑜伽休息术","高效补"]
OLD 3gram 合计: 124
NEW 全文抽取(若误用): 36 ["其实是那条热","人挤在一个","分钟的雨声里","没人讲道理","都在互相看着",...]
```

   → **4 个词、词面完全一致**，宣称的「2 → 4」成立。
   → 但**「230」与「4」不是同一基数**：230 = 旧算法 3-gram ∪ 4-gram；我只复跑 3-gram 单项得 124（合并量级对得上）。
     把 230 与 4 并排放，是**分母不同的对比**，属宣传式取数。

② 新算法引入的新问题（可实测）：
   - `ZH_RUN_RE = /[一-龥]{2,6}/g` **不做词法分词**，只是「遇到标点/空格断一次，最长吃 6 字」→ 见上面 36 条
     （`其实是那条热`/`人挤在一个`）—— 这不是词组，是**更粗的切片**，只是不再重叠滑窗。
   - `collectLearnedTokens` 的三路信号里，**只有 sentDrafts 走 `titlesOnly`**；
     `likedEvents`（视频标题+弹幕/评论）与 `favItems`（标题+收藏理由）仍走伪词路径 →
     而这两路才是真实体量的来源。**「词表不再是噪声」只对占比最小的一路成立。**
   - 只认《书名号》→ 词表长期过小：她每天 ≤1 稿、稿里常 0–1 个《》，4 词里还有 `min`（残片）、`高效补`（被截尾）。
     结果不是「学到品味」，而是 **boost 多数时候输入≈空集** → 她报的「词表没在帮我」现在变成「词表基本不参与」，
     问题没解决，只是从「有害」变成「无害且无感」。
   - `titlesOnly` 边界：`BOOK_RE = /《([^》]{2,24})》/` 要求成对书名号 + 2–24 字，
     嵌套《》/半角<>/超过 24 字的长标题一律丢词；`ownerName` 为空时的 `new RegExp('')` 坑有注释但仍在
     （`learnTokens` 里 `ownerName` 传空串走另一分支，调用方一旦传 `undefined` 之外的假值会静默不打码）。

③ 「命中从噪声变同名作品级重合」—— **不成立**：
   `git show --stat dc26a93` 只改 2 个文件（`tools/lib/feed-feedback.mjs` + `tests/contract/feed-feedback.test.mjs`），
   我在测试文件里 `grep 片名|titles` **零命中** → 宣称的「28 个真实片名命中测试」脚本不在仓库，
   因此「25% 撞上 → 同名作品级重合」这句**不可复现**（按 `AGENTS.md §7/§8`，它属于 scratch，不该出现在对外口径里）。
   `全量 273/273` 我实跑 `node scripts/run-mjs-tests.mjs` 于 `dev/publisher`：`ℹ pass 273 ℹ fail 0` ✓（这条数字真，
   但同样是分支数字，live 分支不含 dc26a93）。

## 四、`dd909ee` / `50775be` 策略层与私信

① 默认档 = 拍板：✓ 成立。

```
export const POLICY_DEFAULTS = { draftMode:'review', autoDailyCap:0, autoWindow:'', like:'self', fav:'self', dmReply:'direct' }
```
   `readPolicy` 用白名单三元式收敛（非法值 → 默认），`publish-policy.test.mjs` 覆盖默认/非法值/跨午夜时窗/上限 4 项 ✓。
   **但现网没有它**：live `dsh/tools/lib/` 只有 `feed-feedback.mjs`，`ls | grep publish-policy|dm-send-core` → **无文件**；
   live `Cortico` 面板声明 6 块、无 `policy`。→ 「策略层已生效」不成立，成立的是「策略层已在 dev/policy 提交」。

② `tierQueues` 入队覆盖：✗ **不成立**。
   - `tests/publish-policy.test.mjs:34-35` 只断言纯函数：`tierQueues('self')===false / ('review')===true`。
   - `tests/perm-tier.test.mjs:17`：`assert.ok(s.includes('tierQueues(') && s.includes('readPolicy('))` ——
     **断言的是源码文本**。往 `like.mjs` 里加一行注释 `// tierQueues(` 也能骗绿；
     真把 `if (GO && tierQueues(...))` 删掉才会红 —— 这是 lint，不是行为测试。
   - 我 grep 全仓 `tierQueues`（在 `dev/publisher` 工作树）**零命中**（该分支不含 dd909ee），
     说明连"两份 dev 分支互相不含对方"这件事都可能让后续测试出现空洞。
   - **缺的关键测试**：以 `permissions.like='review'` 实跑 `like --go` 并断言「不进 HTTP 而是落 pending 队列」，
     以及 `dmReply='queue'` 下回信不直发。没有这两条，「分级放开/档位收回」不能称已验证。

③ dm 收口后 `--status`/退出码回归：
   - `node tools/bili.mjs dm --status` → `exit=0`，输出 6 行（账号/专属对象/今日锁定/已发 0 条/互关 attribute=6/双向已关注）✓ 无回归。
   - 代价：**它打了真实网络**（`relation` + `me` 两次 GET，走 `guardedFetch`），所以：
     ⑴ 观测冻结窗口里 `--status` **属于会消耗风控额度的写风险面**，不能当"安全只读"随便跑（今晚我已经跑了一次，如实记录）；
     ⑵ 一旦 B 站侧限流，`--status` 会返回非 0/降级文案 —— 目前**没有离线降级**（`vitalsState` 里那句
     "Cortico 宿主：节奏由状态驱动，无独立时钟" 是宿主侧 stub，`schedStatus:{ok:false}` 在 live 响应里就是它，
     不是真实调度器状态 → 「体征面板有真数据」要打折）。
   - 另外 `dev/publisher` 全量 273/273 ✓ 说明收口没打断既有契约测试。

④ 是否留双份实现：✗ **留了**。`dm.mjs` 第 21 行 `import { sendOwnerDm } from '../lib/dm-send-core.mjs'`（发送/闸门确实共用一份，
   138 行注释也这么写），但同一文件 **94/100/106 行仍保留自己的 `me()`/`relation()`/`relationLines()`**，
   `dm-send-core.mjs` 63/69/76 是第二份同名实现，且 `dm.mjs:131` 用的是**本地**那份 `relationLines`。
   → 「一份语义一份实现」只覆盖「发送 + 闸门」，**关系探测与展示文案仍是两份**，
     而这两份恰恰是 128869c（回信时效死循环）改过口径的地方 —— 漂移风险最高的正是没收口的那半。

## 五、统一控制中心：live 逐块 curl 三态表

`GET http://127.0.0.1:7799/api/webui/providers/world%3Abili-account/panels/<id>/state`（`<id>` 用 live 声明的 6 个）：

| 面板 id | 状态 | 关键返回 | 判定 |
|---|---|---|---|
| `tank` | `ok:true` | `fields.{energy:0.494,stimulation:0.963,connection:0.595,mood:0.974,curiosity:0.998}` | **有真数据** |
| `drafts` | `ok:true` | `dynamic[0].id=dyn-20261031-9f8a2a, status:"failed"` | **有真数据**（且暴露一条 failed 稿） |
| `timeline` | `ok:true` | 首条 `2026-10-30T01:12:28Z diary/private` | **有真数据** |
| `diary` | `ok:true` | `owner.bytes:33979, updatedAt:2026-10-31T12:32Z` | **有真数据** |
| `feedback` | `ok:true` | `items: []` | **空**（不是报错：她的意见箱已清空） |
| `vitals` | `ok:true` | `today:2026-10-31, shares:0, scheduler:{ok:false,reason:"Cortico 宿主…无独立时钟"}` | **半真**（额度真、调度器是宿主 stub） |
| `policy`（第 7 块） | HTTP 业务错误 | `{"error":"provider world:bili-account 没有声明面板: policy"}` | **live 不存在**（只在 `dev/policy`） |

→ **第一轮 devils「6 块里只有 3 块有真数据」已被证伪**：现在是 5 块真数据 + 1 块空 + 0 块报错。
→ 但「真浏览器逐块验证」的宣称仍有两处虚：⑴ 被验的是 `vitals` 里有 stub 字段、`feedback` 是空集，
「有响应」不等于「有内容」；⑵ 逐块验的是 **dev 的 7 块版**，live 只有 6 块 ——
「已上线」和「已逐块验过」指向的不是同一个对象。

---

## 六、矛盾/口径审查（5 处）+ 先做什么

1. **行为席「骰子不是主闸、密度由回合批量+重启决定」 vs DIGEST 保留 Drive v3 为 P1。**
   自家诊断说主因是回合批量（13/19 回合 ≤1 分钟），那么真正的修法是把 §四 的「行为过程化 `pendingRound`」排前面；
   Drive v3 改的是累积/盈余/长尾 —— 同一根因给了两条 P1，且把**不解决观测现象**的那条排在前面。
   另外 `4107b97` 已拍板「Drive v2 缓议」，DIGEST 仍列 P1（改名 Drive v3）→ **与拍板记录冲突**，须主人重签。
2. **安全席 WebUI 免口令（表里降成 P2，F-17）vs 产品席「给面板加更多能力」。**
   免口令面下 approve/reject/policy 写接口都可被同机任意本地进程触发，而 §二⑤ 说明令牌仍可读
   （`pending` 明文 + `dynamic-approve:163` 明文分支）。**在未收口前扩大写面是自伤**：这两条不能同时排先，
   应把 F-17 从 P2 提回 P1，并在产品席扩能之前做。
3. **「auto 可开 + 护栏不限制但留旋钮」vs 安全席「auto 无人点击也能发是 P0」。**
   修复后 `autoDailyCap` 默认 0（不限）、`autoWindow` 默认 ''（不限），并且（§二⑤）auto 仍不需要人点。
   DIGEST §三 把「auto 无上限/无时段」归为"自觉取舍"，§一.2 又把它当"P0 已修" ——
   **同一件事在两处口径相反**。诚实写法是：P0 修的是"令牌再铸造"，剩下的风险敞口靠 `draftMode:'review'` 默认值兜着。
4. **DIGEST §五.2 自定规则「任何『已验证』必须走全量：`run-mjs-tests` + `Cortico tests/*.test.mjs` + `pnpm test`」 vs 本轮四条修复全在 dev。**
   按自家规则：`dev/policy` 30/32（红）、`pnpm test` 未跑 → **四条修复今晚一条都不满足自家「已验证」门槛**。
   这是最容易也最该被引用的一条硬标准。
5. **「全套 34/34」与「273/273」「277/277」并存**：§一.3 已承认「分支数当唯一数报」是问题并承诺标分支，
   但 §一.2/§二 的正文里仍出现无分支限定的「34/34」「273/273」，且**没有任何一条标出 dev 分支是红的**。

**裁决建议（明早 04:05 要跑 G3b，观测期只冻结 live，因此只允许"离线且不改 live"的动作）：**

| 顺位 | 动作 | 为什么今晚必须做 |
|---|---|---|
| 1 | 把 `Cortico-dev` 的**未提交工作树**（`attempts:true` + `draftForDay`）提交到 `dev/policy` | 不提交=没交付；重启即丢，且它已被当作"已修"对外说过 |
| 2 | 把 `2f0aee4` 合/cherry-pick 进 `dev/policy`，再跑 `npx tsx --test tests/*.test.mjs` 至绿 | dev/policy 现在是 30/32；带着红测试的分支不能激活 |
| 3 | 令牌出面的收口：`pending/*.json` 明文与 `dynamic-approve:163` 明文分支改为默认隐藏；auto 不走 argv 传令牌（改 stdin/环境变量） | 「打码」只遮 stdout 一层，真实泄漏面在文件与 argv |
| 4 | 补 2 条**行为**测试：`permissions.like='review'` 跑 `like --go` 断言入队；`dmReply='queue'` 断言不直发；顺手把 `perm-tier` 的字符串断言标为 lint | 现在档位收回只有文本保障 |
| 5 | `dm.mjs` 删掉本地 `me/relation/relationLines`，只用 core 那份 | 双份实现留死了漂移风险最高的那半 |
| 6 | `feed-feedback` 的 likes/fav 两路也接结构化字段（标题整体 + 收藏理由分句），并把 28 片名命中脚本落到 `scripts/` 供复跑 | 否则"效果"永远不可证 |
| 7 | 把 `day-report.mjs:4`、`day-snapshot.mjs:2` 的 04:00 注释改掉 | 5 分钟的事，不做就会误导下一轮审查 |
| ✗ | **不在今晚做**：词表效果实测（需 3–5 天真实候选）、面板扩能、Drive v3、`--status` 之类打网络的"只读"复跑 | 观测期冻结 live；G3b 明早要干净窗口 |
| G3b | 走 **A 方案**（承认 10-29/30/31 跨代码窗口，写进评审记录后开窗） | B 方案要推迟 3 天且 10-31 的证据不可回收；主人在场，判 tainted 是可选的，但机器判据无法区分，写清楚比推倒更省 |

## 七、今晚不得再宣称清单（左：说过；右：只能这么说）

1. ✗「Cortico 全套 34/34 绿」 → ✓「master `tests/*.test.mjs` 34/34 绿（我实跑）；`persona-core` 85/85；**`dev/policy` 30/32 红 2**；`pnpm test` 未跑」
2. ✗「安全席 P0 已修」 → ✓「`6f461d6` 已提交在 `dev/policy`（未合并、未激活）：auto 不再铸造令牌；
   `autoDailyCap` 计入失败尝试、draftId 改磁盘事实源 **两处仍是未提交工作树**」
3. ✗「auto 发布需要人工放行」 → ✓「auto 只需"出稿时系统自动入队且仍有效"的令牌，**不需要任何人点击**；闸门是 `draftMode` 默认 `review`」
4. ✗「策略层已生效/档位已能收回」 → ✓「`dd909ee` 在 `dsh:dev/policy`；live 无 `publish-policy.mjs`、无 `policy` 面板；入队仅有文本断言覆盖」
5. ✗「词表已不是噪声」 → ✓「`sentDrafts` 一路实测 4 词（可复现）；liked/fav 两路仍产 6 字切片；命中改善不可复现（脚本不在仓）」
6. ✗「私信一条语义一份实现」 → ✓「发送+闸门已共用 `dm-send-core`；`me/relation/relationLines` 仍两份，`--status` 用本地那份」
7. ✗「统一控制中心已上线并逐块验证」 → ✓「live 6 块：5 有真数据 + feedback 空 + vitals 调度器为宿主 stub；第 7 块（策略）只在 dev；逐块验的是 dev 7 块版」
8. ✗「明早 G3b PASS 即连续三天同口径」 → ✓（DIGEST §二 已写，保持）「机器判据会 PASS，但三天跨了不止一套代码，须走裁决 A 显式记录」
9. ✗「日界已全仓统一为自然日」 → ✓「bili/rhythm/dsh 脚本统一为 00:00；`minecraft/deaths` 另有 06:00 日界；两处头注释仍写 04:00」
10. ✗「`--status` 是安全的只读命令」 → ✓「`--status` 会打 2 次 B 站读接口、走流量闸门，冻结窗口内禁跑（本轮我跑过一次）」

## 八、流程改进 3 条

1. **交付单位重定义**：一个"修复"= 分支 + 提交 + 该分支全量红绿 + 与 live 的合并状态，四件缺一就只准写「已提交待验证」。
   落地做法：宣称前必答三问 —— *在哪条分支*、*全量红不红*、*live 有没有*。（今晚 3 处"已修"卡在第 2、3 问，2 处卡在第 1 问。）
2. **跨分支矩阵跑法取代单点数字**：`live` 与每条在途 `dev/*` 各跑一次全量（`run-mjs-tests` + `Cortico tests/*.test.mjs` + `pnpm test`），
   结果并排写进 `CURRENT.md`，数字必须带分支名；同时把"master 有 / dev 没有"的提交（如 `2f0aee4`）列成 cherry-pick 清单，
   避免"修了个红、另一个分支还红着"。合并全量与单跑结果不一致（本轮 dev/policy：合并 ✖ / 单跑 7-7 ✓）要当**红灯**而不是噪声。
3. **断言强度与"只读"定义收紧**：① 禁止用「源码包含某字符串」充当行为覆盖（`perm-tier.test.mjs:17`），
   档位/权限类改动必须有"以真实 config 跑 CLI 并断言副作用文件"的测试；
   ② 只读命令必须**默认离线**，需要网络时显式加 `--live` 并写进冻结窗口禁跑清单；
   ③ 一次性凭据（令牌）适用"三不"规则：不落盘明文、不过 argv、不进任何 stdout —— 现在三条各破了一条。

---

## 九、复审修正（审查期内分支被改动，快照时间必须写清楚）

本轮证据分两个时刻取，**同一分支两次结果不同**，这是本项目"宣称快于验证"的最直接物证：

| 项 | 第一次快照（约 23:2x，我在 §一/§二 引用的就是它） | 第二次快照（约 23:4x 复跑） |
|---|---|---|
| `Cortico-dev` HEAD | `6f461d6`（+ 2 个文件**未提交**：`definition.ts`/`tank.ts`） | `8b29fd2`（多两条提交：`8ac5ce5` auto 两处收紧、`8b29fd2` 日界测试） |
| `npx tsx --test tests/*.test.mjs` | **30/32，红 2**（`causal-ledger` 旧 04:00 断言 + `webui-tank` 文件级；单跑 `webui-tank` 7/7） | **38/38 绿** |
| `autoSentToday({attempts:true})`（上限不再被失败重试绕过） | 只在工作树，无断言 | 已提交，且有断言：`tests/webui-tank.test.mjs:72` `算上失败尝试才能堵住绕上限` |
| `draftForDay`（draftId 取磁盘事实源，不从 stdout 抠） | 只在工作树 | 已提交，测试名 `freshAckToken + draftForDay：只认草稿自带且仍有效的令牌，绝不铸造` |

**由此修正的判定：**
- §一「全套 34/34 绿」→ 修正为：master 34/34 ✓、`dev/policy` 现 38/38 ✓；但**宣称说出口的那一刻 dev 是红的**，
  「红」不是推测而是实跑结果。真正的遗留仍是 §一.1 的 **glob 口径**（`tests/*.test.mjs` 不含 vitest 与 persona-core）
  和 **`pnpm test` 至今没人跑过**。
- §二③④ → 由「修复只在未提交工作树」改为「已在 `8ac5ce5` 提交并有断言」。
  §二⑤（**auto 仍不需要任何人点击**，因为用的是出稿时系统自入队的令牌）与 §二②（**令牌在 `pending/*.json` 明文、走 argv、`dynamic-approve:163` 有明文分支**）**不受此次修正影响，仍不成立的部分照旧**。

**维持不变（第二个快照复验过）：**
- live 侧什么都没动：`Cortico: master` 仍是 6 块面板、无 `policy`；`dsh: port/core-opencode-panel` 仍无 `tools/lib/publish-policy.mjs`、无 `dm-send-core.mjs`；
  → **四条修复依旧全部不在 live**（§四①、§五表、§七 全部有效）。
- `dsh` 侧两条 dev 分支依旧互不含对方：`dev/policy`（`dd909ee`）与 `dev/publisher`（`dc26a93`/`50775be`），
  我在 `dsh-bili-whale-dev` 复跑 `node scripts/run-mjs-tests.mjs` = **273/273 绿**（该分支不含策略层）。
- `tierQueues` 仍只有「源码含字符串」式断言，**无入队行为测试**（§四②）。
- `dm.mjs:94/100/106` 与 `dm-send-core.mjs:63/69/76` 的 `me/relation/relationLines` **两份都还在**（`grep -c` 各 1），`--status` 走本地那份（§四④）。

**新增第 11 条不得再宣称：**
11. ✗「安全席 P1 已修（上限可绕 / draftId 可被文本影响）」 →
    ✓「这两条在**本轮审查进行中**（`8ac5ce5`/`8b29fd2`）才提交并转绿；在此之前它们是未提交工作树 + 红测试。
    宣称时序为『先说已修 → 后提交』，属流程缺陷而非结论缺陷（见 §八.1）」

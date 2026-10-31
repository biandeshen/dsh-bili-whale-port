# 工程架构席 —— 债项盘点、收敛顺序与验收门（2026-11-01）

> 席别：架构（盘技术债 / 定重构顺序 / 卡验收门）。只研究，不改代码。
> 证据路径缩写：`dsh:` = `E:/WorkSpace_Qoder/dsh-bili-whale/`，`cor:` = `E:/WorkSpace_Qoder/Cortico/`。
> 前提纪律：观测期（G3b 后 14 天）只冻结 live——禁合分支、禁为加载新代码重启；dev 分支/worktree 照常推进（`dsh:docs/OBSERVATION-PROTOCOL.md` §2/§3，2026-10-30 主人拍板）。`cor:AGENTS.md` §3/§6/§9 是硬规矩。
> **一个特别警示**：Cortico 主工作树当前 checkout 在 `dev/policy`（`git branch` 实测 `* dev/policy`），而 live 进程跑的是旧 master 代码。观测期内绝不可在这个工作树触发 `pnpm build:web` 或重启——下一次重启必须先裁决"带 policy 合并上线"还是"切回 master"。

---

## 1. 债项清单（按证据）

### A. 跨仓耦合：Cortico 进程内直载 dsh 代码

| # | 证据 | 债 | 后果 |
|---|---|---|---|
| A1 | `cor:src/worlds/bili-account/tank.ts:40-52`（动态 import `panel/data.js`、`panel/drafts.mjs`、`panel/feedback.mjs`、`scripts/dynamic-approve.mjs`、`tools/lib/traffic.mjs`）；`tank.ts:16` 与 `definition.ts:24` 各自硬编码默认 `ROOT='E:/WorkSpace_Qoder/dsh-bili-whale'` | 审批执行路径（`approveFromPanel`，`dsh:scripts/dynamic-approve.mjs:94-124`）运行在 **Cortico 宿主进程内**，不是 CLI 子进程 | ① live 冻结范围事实上覆盖两仓：dsh 树里改 `panel/data.js`/`dynamic-approve.mjs` 并重启 Cortico = 变相改 live；② ES module 缓存：dsh 侧合并 `dynamic-approve.mjs` 后，Cortico 不重启就仍执行旧审批代码——**发布链改动存在"半热更"陷阱**；③ 同字面量 ROOT 写两处 |
| A2 | `tank.ts:42`（`catch { /* 单能力降级 */ }`，静默吞加载失败） | 五个模块任一损坏 = 对应页签永久 loading/降级，无日志无告警 | dsh 重构改了模块路径/导出名，Cortico 只在运行时静默掉功能，无契约测试拦截 |
| A3 | `tank.ts:218-223` 调 `data.vitals({whaleHome,home,traffic,schedStatusGetter})` ↔ `dsh:panel/data.js:48`；`schedStatusGetter` 传的是写死的假对象（"Cortico 宿主：无独立时钟"） | 跨仓调用契约只靠调用方约定，无类型/无共享 fixture | `vitals` 签名一变，世界页体征块坏；假调度器状态是把 C1 债留在调用方 |
| A4 | 审批入口现在有两个：CLI `dynamic-approve.mjs:146-178` 与 WebUI→`tank.ts:203-209`→进程内 `approveFromPanel` | 同一安全线（token/kill/绑定）两个宿主复用，token 语义依赖 `dynamic-approve.mjs:86-92` 注释（"服务端持 token"）——但"服务端"现在是 Cortico 进程 | 审计面分裂：面板放行写 dsh audit（`DRAFTS/audit.jsonl`），因果留痕在 Cortico `causal`；对账靠人肉 |

### B. 重复实现

| # | 证据 | 债 |
|---|---|---|
| B1 | `dsh:scripts/dynamic-approve.mjs:44-57` vs `dsh:scripts/dm-approve.mjs:47-59`：kill 检查、`ack.listPending` 查绑定、`draftId`+`textHash` 双绑、`ack.approve`、失败 `ack.release` 退回——逐行近乎复制。transient 正则还**漂移**：dynamic 侧 `/冷却|TRAFFIC_PAUSED|请稍后/`（`dynamic-approve.mjs:30,70`），dm 侧多一个 `|频繁`（`dm-approve.mjs:68`）。发送通道也不一：dynamic 已迁 publisher（`dynamic-approve.mjs:13,65`），dm 仍 `spawnSync bili.mjs`（`dm-approve.mjs:62-63`） | 审批安全线双写，改一处漏一处；正则漂移意味着 412/频繁类文案在一侧算临时、另一侧算永久失败。ROADMAP §2-5 已立项但没排进收敛顺序 |
| B2 | `cor:tank.ts:142-153`（`readPolicyLite`）+ `tank.ts:156-164`（`policyInWindow`/`hm2`）是 dsh 侧 `tools/lib/publish-policy.mjs`（仅存在于 `dev/policy` 分支，54 行，`git ls-tree dev/policy` 实测）的 **TS 手抄镜像**；两份各自有测试（dsh `tests/publish-policy.test.mjs` 36 行 / Cortico `tests/webui-tank.test.mjs`），无共享 fixture 钉"同语义" | 发送策略语义跨仓双实现。默认值收敛规则（`draftMode!=='auto'→'review'` 等）一处改错，两侧行为分叉——而这正是"kill 压过一切"的红线所在 |
| B3 | legacy 草稿路径 `'D:/AI/养鱼/drafts'` 单源在 `dsh:tools/lib/paths.mjs:51-52`，但内联散写 **6 处**：`scripts/c2-window.mjs:28`、`scripts/day-report.mjs:30`、`scripts/day-snapshot.mjs:45`、`scripts/g3b-check.mjs:43`、`scripts/observation-status.mjs:39`、`scripts/wake-audit.mjs:14` | MODULARITY M1a 记为"4 个冻结验收脚本 + wake-audit/c2-window"，实际举证 6 处，且全在 `scripts/hashes.json` 冻结集内——每处都是"换机器判据就变"的验收脚本级风险 |
| B4 | `new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/,'$1')` 反解析模式散写：`dm-approve.mjs:20` 与 `:97`（同文件两遍）等 | Windows fileURL 解析土办法各写各的，路径含空格/中文（`养鱼`）时 URL 编码会碎；应收口进 `tools/lib/paths.mjs` 一个 helper |
| B5 | "今天"判定三份实现：`dsh:panel/data.js:50-55`（`toLocaleDateString('sv-SE')`×2）、`cor:tank.ts:167`（同招）、`cor:persona-core/src/rhythm.ts:70-71`（`dayKey`，已按裁决改自然日 00:00） | 日界裁决（04:00→00:00）落地时 rhythm 改了、面板/tank 的"今天"是隐式自然日碰巧一致；下次再动日界或时区，三处不同步漂移 |

### C. 死代码 / 未消费配置

| # | 证据 | 债 |
|---|---|---|
| C1 | `~/.dsh/bili-whale.config.json` 实测（2026-11-01 读取）：`home:"D:/AI/养鱼"`、旧 `publish:{enabled:false,dailyMax:1,window:{21:30-23:30},requireApproval:true,imageDir:"D:/AI/养鱼/assets/daily"}` | **同一个 `publish` 键两套 schema**：旧 DSH 发布窗配置（未消费）与 `tank.ts:119-137` `policySet` 写入的新策略键（`draftMode/autoDailyCap/autoWindow`）并存互不覆盖（spread 合并保留旧键）。旧键还带 `D:/AI/养鱼` 绝对路径——"资产根收口"在配置残留层没扫干净 |
| C2 | `dsh:tools/lib/config.mjs:27` `sessionRotateDays:0`、`:40` `notify.type:'none'`（消费方 `tools/commands/notify.mjs` 存在但默认关）；`cor` 侧 `CURRENT.md:41` `clock.enabled=false`+`night.windows=[]` | 时钟/夜间窗整条配置链已被 Cortico 状态驱动取代，但 dsh 配置与 `data.js:69` 的 `plan: whale-night.json` 读取仍在——展示一个永远不会被写的计划文件 |
| C3 | `dsh:panel/data.js:20-25` whale-log 回退（最后一条 2026-10-25，`docs/CURRENT.md:56`）；`dsh:panel/server.js`+`views/tank.html` 8447 面板退役未归档（CURRENT.md:12：僵尸进程提权杀不掉） | 回退路径展示旧 DSH 时代事件；退役面板的 HTTP 审批面与世界页并存（见 A4），面扩未收面 |
| C4 | `dsh:tools/lib/paths.mjs:51-52` 的 LEGACY 常量仍被 pick-image.mjs 注释、`~/.dsh/...config` 的 `publish.imageDir` 引用 | 分发前必删清单（MODULARITY §3 P0"资产根"标记已做，但配置侧证据说明只收了代码路径没收配置路径） |

### D. 两份配置源风险

- D1：`~/.dsh/bili-whale.config.json`（dsh CLI：risk/preferences/新 publish 策略）↔ `cor:deployments/mybot/config.json` 的 `worlds.bili-account` 节（第 5 行实测存在）。世界页"发送策略"卡**实际**读写 dsh 文件（`tank.ts:111-137`，注释称"单一事实源= dsh config，主人拍板"），而 `docs/PRODUCT-ROADMAP-2026-10-31.md` §1 写的是"写进 `worlds.bili-account` 配置节，WebUI 按声明渲染"。**文档与实现口径不一致**；且按 `cor:AGENTS.md` §3-4"World parameters in the World"，把 World 行为旋钮的真相源放在另一个仓库的 untracked json 里，是结构性越界：改策略要走 `BILI_WHALE_CONFIG`/文件权限两条仓外通道，Cortico 的 config 声明/漂移门（health 的两段前缀漂移门类比）覆盖不到它。
- D2：环境默认全在代码里写死本机绝对路径（A1），两仓都没有 `.env.example` 级别的收口证据；换机器时 `BILI_WHALE_ROOT` 忘设 = 静默降级（A2 的 catch）。

### E. 测试盲区（安全线只被 mock 摸过）

- E1：`approveFromPanel` 的"令牌失效自动重入队再发"全链只测注入 `fakeRunner`（`dsh:tests/contract/draft-approve-panel.test.mjs:27,45,55,66`）；真实 `postImageDynamic` 只被 `fakeFetch` 测过（`tests/drafts-publisher.test.mjs:37-85`）。**面板→token→publisher→网络**四段从未在同一条测试里连跑（`node --check` 层面可过，语义层没有）。
- E2：dm 侧 kill/绑定/冷却退 token 全靠 `goodRunner` 桩（`tests/contract/dm-approve.test.mjs:33-90`）；"面板展示的正文==实际执行的正文"没有对真实 argv 的断言。
- E3：412 风控页（HTML 而非 JSON）是事故结论（`CURRENT.md:8`），但 publisher 测试的失败分类只覆盖 `code=509` 与 thrower（`drafts-publisher.test.mjs:62,73,85`），**没有"HTTP 200 + HTML body"夹具**——`dyn_id` 解析（`dynamic-approve.mjs:121` 再 regex 一遍 `out` 字符串）对 412 页的行为只靠线上事故验证；还叠加 B1 的正则漂移。
- E4：Cortico `tests/webui-tank.test.mjs` 这次 +48 行是 policy 值语义，**没有** A2 的负向测试（模块加载失败时哪块 UI 该降级成什么）。
- E5：冻结判据与 B3 冲突——`hashes.json` 冻住了 6 处 legacy 路径的脚本，等于把"换机器判据漂移"冻结成合法状态。

---

## 2. 收敛方案（5 步；标注是否必须等观测期）

> 通用门：dsh `node scripts/run-mjs-tests.mjs`（现 277/277）+ `npm test`、Cortico `pnpm test`+`pnpm run typecheck`（vitest 5062）、`tsc --noEmit` 0。每步一个提交里程碑，按 `cor:AGENTS.md` §9 规范、显式路径 stage。

**S1 审批公共层提取（dev only，不待观测期结束即可推进；合并等窗口）**
- 动：新建 `dsh:scripts/lib/approve-common.mjs`（或 `tools/drafts/approve.mjs`）：`checkKill` + `assertTokenBinding(ack,pending,draft)` + `releaseOnFail` + **单一** transient 正则（合并两侧词表，取并集要写明理由）；`dynamic-approve.mjs`/`dm-approve.mjs` 各自 44-59 行段改调公共层。
- 门：现有 `track-a/m1e-approval/dm-approve/draft-approve-panel` 四套契约测试**不改断言**全绿；正则并集新增一条表驱动测试。
- 回滚：revert 单提交，两文件回到原样。**⚠ 合并时机**：`dynamic-approve.mjs` 被 Cortico 进程内 import（A1），其改动生效需要 Cortico 重启刷缓存 → 必须进重启窗口；dm 侧独立（CLI 每次新读），可先行合并。

**S2 dm-approve 迁 publisher（dev only；= ROADMAP 批次②）**
- 动：`dsh:tools/drafts/publishers/bilibili-dm.mjs` 新文件（照 `bilibili-dynamic.mjs` 形状：结构化返回、transient 显式字段）；`dm-approve.mjs:62-63` spawn 删除；tests 从 `goodRunner` 改为注入 publisher。
- 门：dm 契约测试全绿 + `--dry` 真 CLI 手演一次（不 `--go`）；两条发布链 transient 判定语义对齐（同一来源）。
- 回滚：恢复 spawn 行即可，publisher 文件是纯增。**不需要重启窗口**（Cortico 不 import dm-approve）。

**S3 跨仓契约固化（合并与激活都要等观测期结束）**
- 动：`cor:tank.ts` 的 `readPolicyLite`/`policyInWindow` 与 dsh `publish-policy.mjs` 改为**同一份 JSON fixture 表驱动**（两仓测试各引用同一用例文件，内容双仓各存一份哈希对齐）；A2 的静默 catch 加加载状态上报（`consoleReady` 已有雏形，`tank.ts:56`，把失败原因塞进面板 loading 灯）；`schedStatusGetter` 假对象改为 vitals 的可选参数（dsh 侧 `data.js:48` 签名先兼容两形状）。
- 门：双侧 fixture 测试 + 世界页六块走查；`pnpm typecheck:web`。
- 回滚：revert Cortico 与 dsh 成对提交（两仓必须同窗口合并，单边合 = 语义分叉）。**必须等观测期**：触碰 live 数据面，且改 `panel/data.js` 等于改 Cortico 行为。

**S4 配置单源化（必须等观测期结束 + 重启窗口 + BREAKING）**
- 动：三选一（建议 a）：a) 保留 dsh 文件为真相源，但**清掉旧 `publish` schema 残留**（C1）+ 在 World `definition.ts` 的 ConfigGroup 声明该外部文件路径（`BILI_WHALE_CONFIG` 进配置节而非 env 硬编码）+ 更正 ROADMAP §1 口径；b) 策略迁进 `worlds.bili-account` 配置节，dsh 侧 `publish-policy.mjs` 改从 Cortico 暴露的只读端点取——违背"dsh CLI 独立可用"，重；c) 双写同步——最差。
- 门：策略卡改一次 `auto`→`review` 往返，World 行为（`definition.ts:736-741,830`）与 dsh CLI 读到的值一致；旧键残留清零。
- 回滚：config 文件有 `.bak-20261027` 先例，改前再备份一份；代码 revert。提交按 `cor:AGENTS.md` §9 加 `!` + `BREAKING CHANGE:` footer（配置含义变化）。

**S5 死代码与 legacy 收口（观测结束后第一批窗口顺带做，不单独要窗口）**
- 动：6 处内联 legacy（B3）统一改调 `paths.draftsDir()` → `scripts/hashes.json --write` **重冻**（原因写明：判据不变、路径解析收口）；whale-log 回退标 deprecated（先留一个观测周期）；`night`/`clock`/`whale-night.json` 展示链评估删除；8447 `panel/server.js` 待主人手动杀僵尸进程后归档（不先删代码，CURRENT.md:12）。
- 门：`day-report`/`g3b-check`/`observation-*` 在 `WHALE_HOME` 与 legacy 目录两种布局下判定一致（新测试）；重冻后 `hashes.json` diff 只含这 6 个脚本。
- 回滚：revert + `hashes.json` 一并回退。

---

## 3. 下一次激活窗口编排（一次停→构建→启，全带上）

前提：`pnpm build:web` 不能在 bot 进程存活时跑；窗口 = 停 bot → 构建 → 重启（Cortico AGENTS.md §6）。按序装：

1. **先裁决工作树分支**：Cortico 当前 checkout `dev/policy`（见文首警示）——要么窗口内 `master` 合入 policy，要么明确放弃。dsh 侧合 `dev/policy`（live 树 `port/core-opencode-panel`）。
2. **dsh 合并批**：`dev/policy`（发送策略 + like/fav 档位）→ S1/S2（若已完成）→ feed 词表第二层（宽词双信号门槛 + 负样本通道，ROADMAP §5 记账项）→ 日界 dev/day-boundary 尾巴（如有未合）。
3. **Cortico 合并批**：`dev/policy`（`definition.ts:736-741` auto 分流、`:830` dmReply 队列档、策略卡 + tank 68 行）→ S3（若观测期已过）。两仓 policy 必须**同窗口成对合**（B2）。
4. **通知实弹**（ROADMAP §3-A/批次④）：`notify` 接通放同窗口，省一次重启。
5. **重冻**：若 S5 已合，`hashes.json --write` 放构建前。

窗口内验证步骤（全过才算激活完成，任一步失败=回滚镜像）：
- [ ] 停 bot 前记录 pid 与 `days/<D>` 当日 ticks 尾行；
- [ ] `pnpm build:web`（bot 已停）→ `pnpm test` + `pnpm run typecheck` + `tsc --noEmit` 0；
- [ ] dsh `node scripts/run-mjs-tests.mjs`（≥277/277）+ drill 34/34；
- [ ] 启 `start-cortico.cmd` → `node scripts/cortico-health.mjs` 全绿；
- [ ] 世界页走查：鱼缸/待审稿/体征/策略卡（默认 `draftMode=review`、permissions 与 S4 前一致）；策略卡切 auto→回 review 一次，检查 `causal.jsonl` 有 `policy-change` 留痕（`definition.ts:404`）；
- [ ] 审批链冒烟：`node scripts/dynamic-approve.mjs list`（默认无 token）；对一条 dry 草稿走面板 ✓ 的 **dry 等价的**——若当日无稿，用 `--dry` CLI 通道验 publisher 形状；
- [ ] 写 incident + 更新 CURRENT.md（当天若是观测期内，本窗口本身要按 §3 污染规则记账——**除非这是 G3b 后、observe:start 前的最后窗口**；开窗后除崩溃恢复外不开此清单）。

---

## 4. 观测期 dev-only 工作清单（不违冻结）

1. S1 + S2 在 `dsh-bili-whale-dev` worktree / dev 分支写完并全测绿（不合 live）。
2. Cortico dev 分支把 S3 的共享 fixture 表和 tank 改造做成**未合并**提交；补 A2 负向测试、E3 的"200+HTML 412 页"夹具测试。
3. 只读审计：feed `collectLearnedTokens` 近 3 天候选权重对账（ROADMAP §2-4，裁决已定批次①）；DRAW 正文取位**探明**（只解析取证，改动等窗口）。
4. 每日 20-30 分钟按 OBSERVATION-PROTOCOL §2 走 `observation-day.mjs`，incident 里把当天发现的**跨仓耦合事故**（如模块加载失败）记录为 S3 的素材。
5. 备好第 3 节编排表 + 回滚脚本（不执行）；K4 体验复盘模板（第 7/14 天用）。
6. **禁做**：合任何 dev 分支进 live 树、为加载代码重启、跑 `build:web`、动 `hashes.json`、在 Cortico 主工作树做需要重启才生效的验证。

---

## 5. 反对意见（不值得做的"重构"）

- **不把动态 import 的 dsh 模块抽成 npm 包做版本 pin**：两仓同机私有分发是现状，发包/锁版本/双仓发版节奏的管理成本高于耦合本身；A1 的风险用"改 dynamic-approve 必带 Cortico 重启"的窗口纪律（第 3 节）+ 契约测试对冲即可。MODULARITY §4 同理反对拆 `definition.ts` 微服务、反对世界页上前端框架（`src/web` 零改动验收门 `tests/web/acceptance-zero-diff.test.ts` 也反对从产品侧改框架 UI）。
- **不再拆审批核心**：token/kill/绑定是冻结的单一安全点（MODULARITY §0 第二条）；S1 只提取公共 helper，不挪进插件、不做一键审批——"看起来能再抽象一层"恰恰是给注入者开门。
- **不为统一三处"今天"判定（B5）立专项**：`toLocaleDateString('sv-SE')` 与 `dayKey` 现值语义一致；除非再动日界/时区，统一重构的收益为零、风险和 hashes 重冻成本倒挂。留作 S5 顺手观察项。
- **不现在删 `panel/server.js` 与 whale-log 回退**：8447 僵尸进程还挂着（CURRENT.md:12），源码先删可能让在跑进程失去排障参照；回退路径在新机器上还兜底一个观测周期。
- **不把 `vitals` 假 `schedStatusGetter`（A3）做成真实调度器状态面**：DSH 时钟已裁决停用（`clock.enabled=false`），给它接回真实状态等于复活被冻结的旧心智模型；正确方向是删参数，不是喂数据。
- **不追 `~/.dsh/bili-whale.config.json` 旧 `publish`/`home` 残键的"立即清理"**：文件是 live 读取面，观测期内连只读脚本都不要写它；清理并进 S4 窗口一次性做。

---

## 6. 摘要

债务核心是三件事：**Cortico 进程内直载 dsh 审批/数据模块**（冻结面跨仓、改审批要两仓同窗口）、**审批与策略语义双写**（dm/dynamic 两条链 + TS/JS 两份 readPolicy，已现正则漂移）、**配置真相源分裂**（同一文件新旧两套 publish schema + World 旋钮存在别仓）。收敛顺序：S1 审批公共层 → S2 dm 迁 publisher（两者 dev-only）→ S3 跨仓契约固化 → S4 配置单源（BREAKING，窗口内）→ S5 legacy/重冻收口；全部合并动作压进同一个"停→构建→启"激活窗口（清单见第 3 节），观测期内只做 dev 分支与只读审计。

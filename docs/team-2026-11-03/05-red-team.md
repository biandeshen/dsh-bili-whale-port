# 挑刺席（否决席）审查报告 — 2026-11-03

审查对象：
- `docs/ARCHITECTURE-TARGET-2026-11-03.md`（下称 **TARGET**）
- `docs/ARCHITECTURE-DECOUPLING-2026-11-01.md` §9（下称 **DEC §9**）
- 被否掉的推理（"她 = 状态 + 循环；B 站域是一整块，靠 15 个工具调用"）——本席不重开该命题，只列它与现存证据的冲突点。

裁决口径（主人已定，不重开）：万物皆扩展、扩展粒度 = 业务域；不按感知/表达/记忆横切；argv/CLI 不是架构层；"状态/循环不能拆"已撤回，只留 tick 唯一、安全闸单点两条待论证；配置项就放那儿、页面能改、默认值由代码定。

**本席总览**：否决/降级 31 条，其中"数字错"12 条、"自相矛盾"7 条、"漏掉既有事实"6 条、"不可执行"6 条。最严重的一条见文末。

---

## 一、否决清单

### A. 把设计偏好写成物理约束

| # | 原文位置 | 问题类型 | 证据 | 处置 |
|---|---|---|---|---|
| A1 | DEC §9.2 约束 3「不新增轮询频率…今天实测 281 tick/天」 | 无源数字充当物理约束 | 全文检索 `281` 只命中该行自身（`docs/ARCHITECTURE-DECOUPLING-2026-11-01.md:829`）；`node scripts/observation-status.mjs` 输出「观测尚未开始：G3b 通过后创建 control/observation.json」——无任何观测产物可复核 | **否决**（该句无证据；"不新增定时器"作为选择保留，"281"删除） |
| A2 | TARGET §1「唯一不该拆的东西…不可逆动作的把关链」 | 物理约束 | 事故证据**存在**：`docs/CURRENT.md:45`（2026-11-01 01:23 `publish.draftMode` 被盲 POST 写成 `auto`，载荷含 `autoDailyCap=-9`；01:26 改回；未造成发布）。`traffic/quota-gate/kill/go-gate` 各有实现：`tools/lib/{traffic,quota-gate,kill,go-gate}.mjs` | **成立**（唯一有事故级证据的"必须"） |
| A3 | TARGET §2.4「生产路径一条也不走 argv」、§6「不做更细的拆」 | 设计偏好伪装成约束 | 与主人裁决同向（argv 不是架构层、粒度=业务域） | **降级为选择**（文中写作物理约束，实为主人已裁决的偏好，引用即可） |
| A4 | DEC §9.2 约束 2「游标在本地…不依赖 B 站侧"已读"接口」 | 假设被写成事实 | 未找到任何"B 站有已读接口"或"没有"的证据；本地游标可行性有证据（`tools/lib/state-roots.mjs` KINDS 表 + `resolve()`） | **降级为选择**（后半句"落本地文件"成立，前半句需补证据） |
| A5 | TARGET §3「工具（22+ 个，含 comment/danmaku/inbox_read/judgment_read）」 | 目标态写成了现状 | 现状 18 个（见 B3）；`bili_comment`/`bili_danmaku` 在 `tool-decls.ts` 0 命中（grep 实测） | **降级为选择**（P1 交付目标，非现状） |
| A6 | TARGET §5 P3「记忆只走框架 Memory（可查、可检索、可作废）」 | 能力断言 | 框架 Memory 存在（`bots/cormini/persona/memory.ts` 412 行起）；但"三层 core/recent/long + 检索 + 作废"在框架侧未核（`bot` 模板 `persona/` 只有 blobs/memory/persona） | **需补证据** |
| A7 | DEC §9.2 标题「互动感知独立成一个单元，而不是塞进 World」 vs 同节结论「先在 World 内做，等有第二个宿主再抽」 | 同一节自相矛盾 | 见 C1 | **否决标题**（保留结论句） |
| A8 | TARGET §4「路径可配…默认在部署树内」 | 隐含"当前状态不合理"的物理断言 | `docs/CURRENT.md` 与 `docs/DECOUPLING-STATUS-2026-11-02.md` 已把"路径可配"记为**待做**（`state-roots` 24 类表已落地，路径统一未落地） | **成立**（陈述待做事项，非断言） |

### B. 数字未复核（详细表见第二节）

| # | 原文位置 | 问题类型 | 证据 | 处置 |
|---|---|---|---|---|
| B1 | TARGET §1.5「dsh 有 43 条命令，她身上 18 个工具；**差集 34 条**里包含…」 | 算术错 | 43 − 18 = **25**，不是 34。43 条实测（`tools/bili.mjs` 的 `map` 43 行）；18 个工具实测（`tool-decls.ts` `DECLS` 18 项，`definition.ts` 中 `mk(DECLS[0..17])` 18 处） | **否决 34**（改为 25，并说明差集含重叠） |
| B2 | TARGET §6「41 个 CLI 是抽错的粒度」 vs §0/§2.4/§7「43 条 CLI / 43 个命令」 | 同一文档数字互斥 | 实测 43 | **否决 41** |
| B3 | DEC §9.1「`definition.ts` 的 **15 个**工具」 | 过期数字 | 实测 18（`tool-decls.ts` 首行注释「当前 18 个，以本文件 `DECLS.length` 为准」） | **否决 15**（改 18） |
| B4 | TARGET §1.5「`tools/lib/msgfeed.mjs` 已实现两个收件箱…**调用方为 0**」 | 事实错（最严重的一类） | 实测调用方 **≠ 0**：`tools/commands/comment-await.mjs:23` 与 `tools/commands/comment-digest.mjs:18` 均 `import { makeHeaders, pullFeed, resolveLatestReply, ME, OWNER } from '../lib/msgfeed.mjs'`；`tools/commands/likes.mjs:41` 单独读 `/x/msgfeed/like` | **否决该句**（成立版本：她本人（World）零调用，CLI 侧已有两个调用方） |
| B5 | TARGET §1.1/§7「跟上游对账（**落后 543** 领先/116）」 | 数字无法复现 | 实测：`git -C E:/WorkSpace_Qoder/Cortico-up rev-list --left-right --count master...upstream/main` → **116 / 436**；`HEAD(reanchor/replay)...upstream/main` → 108 / 1。543 与任何 ref 组合都不对应 | **需补证据 / 建议改 436** |
| B6 | TARGET §2.2、P2 门禁、§7「dsh 79 文件 / **440 项**测试」 | 数字错 | 现跑 `node scripts/run-mjs-tests.mjs` → `EXECUTED=80/80  COUNTS tests=444 pass=444 fail=0`；`docs/evidence/gates-2026-11-03.json` 同为 `tests:444`（discovered 80，含 `adapters/opencode/test/contract.test.mjs`） | **否决 440 → 444**；文件数 79 只覆盖 `tests/**/*.test.mjs`，全量 80 |
| B7 | TARGET §0「她的 World 17 个 .ts / **4,008 行**」 | 已过期 | 该数对应 dsh 提交 626beae 时的 Cortico-up；Cortico-up 现 HEAD `5575f95`（2026-11-03 01:13「评论与弹幕也进发送策略」）+ 工作树未提交改动，现测 **17 个 / 4,018 行**（`config-store.ts` 126→133，`webui/client.ts` 706→711） | **需更新**（非错，是过期） |
| B8 | DEC §9.3「`tools/lib/paths.mjs:196`」 | 行号错 | `export function draftsDir` 在 **194** 行（`grep -n` 实测）；196 是 legacy 存在性判断那一行 | **改为 194** |
| B9 | TARGET §1.6「状态 `C:\.dsh\bili-ai\`、`C:\.bili-ai\`」 | 路径字面不存在 | 实测 `C:/.dsh` 与 `C:/.bili-ai` **都不存在**；实际是 `C:/Users/Administrator/.dsh`（1.2G）与 `C:/Users/Administrator/.bili-ai`（6.0M） | **改写路径**（DEC §9.3 用的全路径是对的） |
| B10 | DEC §9.1「`comment-digest` 与 `likes` 只被 `core/scheduler.js:151` 的循环提示与面板使用」 | 引用不准 | `core/scheduler.js:151` 确为「7) `comment-digest --hours 24`」；但 `likes` 在 scheduler.js 中 **0 命中**（grep `likes` 只得 74/152 行的 `quota react`），面板侧未核 | **需补证据**（`quota react` 是否走 `likes.mjs` 未核） |
| B11 | TARGET §0「上游内建 worlds 161 / 66,199；minecraft 47,703、bilibili 6,727、qq 5,226、console 1,285、websearch 1,070、fixture 140」 | 核对 | 实测全部一致（`find src/worlds -name '*.ts'` 逐目录求和） | **成立** |
| B12 | TARGET §0 Core 42/9,551、WebUI 298/38,155、providers 79/8,109、extensions 18/2,543、cormini 34/6,222、persona-core 16/2,054；§1.3「fields 里 memories 60 / chain 68 / 上限 200」；§1.2「workspace 10 文件 2.4M」；§1.6 三盘 1.2G / 6.0M / 117M；§4「state-roots 24 类表」；§1.5「能力面只暴露 42%」 | 核对 | 逐条实测一致（`memories 60 chain 68`；`HISTORY_LIMIT = 200` @ `personaAdapter.ts:156`、`slice(-HISTORY_LIMIT)` @ `:215`；workspace `find -type f` = 10、`du -sh` = 2.4M；KINDS 24 键；18/43 = 41.9%） | **成立** |

### C. 方案自相矛盾

| # | 原文位置 | 问题类型 | 证据 | 处置 |
|---|---|---|---|---|
| C1 | DEC §9.2 标题 vs §9.2 末段 vs §9.4 | 三方互斥 | §9.2 标题「独立成一个单元，而不是塞进 World」；§9.2 末段「先在 World 内做，等有第二个宿主再抽」；§9.4「感知能力（debrief、inbox）应该走端口 + 适配器」。TARGET §2.2 则把 debrief/互动全部收进**一个** world 包、§6 明写「不做更细的拆」 | **否决"独立成单元"**（按主人裁决：粒度=业务域，感知不横切；DEC §9.4 的"写不拆，感知拆"一并作废） |
| C2 | TARGET §2.4「43 条 CLI 不删——它们变成 `src/cli.ts` 的薄壳（人手排障还要用），但生产路径一条也不走 argv」 vs TARGET §2.2「`src/client/` ← 原 dsh 的 43 条 CLI，改成 typed API」 | 同一节两种说法（薄壳 vs typed API 重写） | 41 CLI vs 43 CLI 同样出自此二节 | **统一为**：CLI = `src/cli.ts` 薄壳（保留可执行入口），typed API = 唯一生产路径；CLI 数量以实测 43 为准 |
| C3 | TARGET §4「路径可配（`config.ts` 里 JSON Schema 声明 `stateDir`/`mediaDir`/`draftsDir`）」 vs DEC §9.3 第 1 步「`bili-whale.config.json` 加 `storage: { home, drafts, migratedAt }`」 | 同一组路径两个配置源 | 两处各自新增配置节；主人已裁「配置项就放那儿，页面能改，默认值由代码定」——需要指明唯一 owner | **需拍板**（本席不选；只要求合并稿必须写死唯一 owner 与唯一默认值来源） |
| C4 | TARGET §5 P1「`bili_comment`/`bili_danmaku` 工具（默认 `review` = 人工放行）」 vs 2026-11-03 已落地的 `permissions.comment`/`permissions.danmaku` 档位 | 重复发明 | 实测 `tools/lib/publish-policy.mjs:26-27,40-41`（`comment:'review'`、`danmaku:'review'`，`tierQueues()`）与 `src/worlds/bili-account/config-store.ts:130-131`（`t.comment === 'self' ? 'self' : 'review'`）；Cortico-up HEAD `5575f95` 即该提交 | **否决"默认 review"的重新决策**（档位已存在，P1 只补工具面） |
| C5 | TARGET §5 P2 门禁「包内 **vitest**/440 项全绿」 vs dsh 现有 runner | 门禁写错运行时与数量 | dsh 用 `scripts/run-mjs-tests.mjs`（node:test，实测 80 文件 / 444 项）；Cortico 侧是 vitest（`package.json:"test":"vitest run"`）。把 node:test 断言"搬进"vitest 包不是搬家，是改写 | **门禁需重写**（先定：搬进 vitest 需改写 444 项，还是保留 node:test 作为包内脚本） |
| C6 | TARGET §1.5「msgfeed…调用方为 0」 vs DEC §9.1/§9.2「`comment-digest` 与 `likes` 已被 CLI 使用」 | 两文档对同一事实相反 | 见 B4 | **否决 TARGET 句**，以实测为准 |
| C7 | DEC §9.3「三个冻结脚本…共四处重复」 vs `docs/DECOUPLING-STATUS-2026-11-02.md:30`「旧家退场单点：`paths.mjs` 的 `legacyAllowed()` 是唯一判断」 | 现状描述互斥 | 实测三脚本确实各自内联：`scripts/day-report.mjs:30`、`scripts/day-snapshot.mjs:45`、`scripts/g3b-check.mjs:43`（各带 `const legacy = 'D:/AI/养鱼/drafts'`）→ STATUS 那句"单点"对这三个脚本**不成立** | **更正 STATUS 句**（不是否决方案，是纠正现状描述） |

### D. 漏掉的既有事实

| # | 原文位置 | 问题类型 | 证据 | 处置 |
|---|---|---|---|---|
| D1 | DEC §9.2 提出新造 `tools/lib/inbox.mjs`「把三路 msgfeed 归一成同一形状」 | 重复发明 | `tools/lib/msgfeed.mjs` **已实现**两路归一（`pullFeed(kind)` → `{kind,id,t,who,mid,title,source,target,business,oid,root,parent,uri}`，已按 id 去重）+ `resolveLatestReply`（父评论定位正文）+ 字段坑注释；第三路 `likes` 在 `tools/commands/likes.mjs:41` 单独读 | **否决"新造 inbox.mjs"**（改写为"给 msgfeed 加 like 分支 + 一层薄适配"，不再造归一器） |
| D2 | TARGET §2.2 `src/domain/` 清单（traffic/quota/kill/go-gate/ack/publish-policy/plain-outbound） | 漏项 | `tools/lib/write-refusal.mjs`（2026-11-02 23:28，`92a473f`「写失败不再崩栈也不再无痕」）在两份文档里都没出现——它是出站失败留痕的一环 | **补入清单** |
| D3 | TARGET §1/§5 全篇 | 漏项 | `scripts/wordlist-hit-check.mjs`（2026-11-01 01:14，`6abe473`「词表命中率复量入仓」）已入仓，TARGET §1 只把「词表」当内容提一句，无任何门禁/迁移引用 | **补入 P3 或 P1 的门禁清单** |
| D4 | DEC §9.2 约束 2「已读状态落 `~/.dsh/bili-ai/inbox-cursor.json`（走 A 方案的 `resolve('queue')`）」 | 不可执行 + 名字不存在 | `tools/lib/state-roots.mjs` 的 `resolve(kind)` 对表外 key 直接抛错（`:94-98`「state-roots 不认这个状态类」）；KINDS 24 键里**没有 `queue`**（有 `pending-replies`/`dm-await-state`/`await-state`…） | **否决 `resolve('queue')`**（需先加 KINDS 行；落点键名与 owner 明确） |
| D5 | TARGET §5 P1「收件箱四路（`msgfeed` 接上）…回滚：工具声明删掉即回滚，**无数据迁移**」 | 与自身交付矛盾 | 四路接上必然写游标/状态文件（DEC §9.2 已要求本地游标），不是"无数据迁移" | **需补证据**（回滚时游标文件的处置未定义） |
| D6 | TARGET §2.2 `src/webui/`「页签（浏览器端），只通过公开 HTTP API 消费」 | 缺可行性证据 | `templates/extension/world/` 目录内容：`AGENTS.md CHANGELOG.md CLAUDE.md README.md describe.json package.json pnpm-workspace.yaml src tests tsconfig.json vitest.config.ts`，`src/` 只有 `ENV_PROMPT.md config.ts definition.ts index.ts world.ts`——**没有 webui 目录**；现 `webui/client.ts` 711 行住在仓内 world 里 | **需补证据**（外部 world 扩展如何提供页签，需对照 `docs/extensions.md` + 模板） |

### E. 不可执行 / 需要主人拍板却写成已定

| # | 原文位置 | 问题类型 | 证据 | 处置 |
|---|---|---|---|---|
| E1 | TARGET §5 P1 门禁「`wake-audit --usage` 里"从没调用过"名单变短」 | 无阈值、不可一条命令判定 | 实跑 `node scripts/wake-audit.mjs --usage`：数据源是 `Cortico/deployments/mybot/data/session-main.jsonl`，仅 **235 行、2026-11-01T14:15 → 2026-11-03T01:15**；列出的"调用过"里含 `diary_read`/`self_log`/`external_event_frame` 等非 World 工具名 | **需补判据**（"名单变短"不是判定式；应写死"某工具出现在 usage 列表"） |
| E2 | TARGET §5 P1 门禁「意见箱 `f-d99d64`/`f-11a351` 有落点」 | 证据 ID 查不到 | `grep -rl "f-ac6261\|f-d99d64" C:/Users/Administrator/.dsh` **无命中**；`.dsh/bili-ai/` 下未列见 feedback 文件（仅 api-cache/api-requests.log/dm-await-state/dm-quota/favorites/feed-search-cache/migrations/pending-replies*/selftest-passed/traffic-state） | **需补证据**（ID 与存储位置） |
| E3 | TARGET §2.1 bot 包 `"cortico":{"kind":"bot","api":6}` | 会被门禁直接判红 | `templates/extension/bot/package.json:18` → `"api": 7`；world 模板才是 `api: 6`；`scripts/extension-check.ts:74` 打印 `Contracts: world v? / provider v? / bot v7`，`check:extension` 会比对 `cortico.api` | **否决 api:6 → 改 7**（world 包保持 6） |
| E4 | TARGET §5 P4 门禁「干装载 + 一次真启动核对」 | "干装载"无对应命令 | 现存可用：`pnpm check:extension <dir>`（`package.json:28`）、`pnpm describe:extension`（:29）、`pnpm audit:release`（:25）、`node scripts/live-code-anchor.mjs --set/--check`（实跑参数存在）；无 "dry load" 命令 | **需补证据**（给出现成命令名） |
| E5 | TARGET §5 P2 回滚「包不装回；in-tree 那份 `git revert` 即回」 | 回滚责任错位 | in-tree 那份住在 `Cortico-up`（`E:/WorkSpace_Qoder/Cortico` 的 worktree，`git branch -vv` 里 `+ master` 标记），是我们对上游仓的本地提交，不是上游分支；revert 可行但要指明在哪个仓 revert 哪个 sha | **需补证据** |
| E6 | DEC §9.6 验收 1「`bili_inbox_read` 能列出最近 24h 的 reply/at/like，且与她实际 B 站消息一致（抽 3 条人工核对）」 | 需联网 + 人工，非命令判定 | `Cortico-up/agents.md` §5 明写「No network in tests。Real-service checks live in `scripts/` and run by hand」；msgfeed 走 `guardedFetch`（真实 api.bilibili.com） | **降级为手工验收脚本**（须写明命令与凭据前置，不得进测试门禁） |
| E7 | DEC §9.6 验收 3「把 D 盘目录临时改名后，她仍能出稿」 vs §9.3 第 3 步「冻结脚本不改」 | 判据与方案互斥 | 三个冻结脚本各自内联 legacy 判断（D2/C7），D 盘改名后它们读到的落点与 CLI 不同 → "仍能出稿"只对 CLI 路径成立 | **需补判据**（明确测哪条路径，或先统一 legacy 判定） |
| E8 | TARGET §7「`bots/cormini`…这条现在**没有结论**，P4 开工前必须先定」 | （此处是文档自陈未决，不算错） | `bots/cormini/index.ts:72` `paths:{memory:'workspace',data:'data'}`；`deployments/mybot/deployment.json` = `{"bot":"cormini"}` | **成立**（保持未决，不得在合并稿里写成已定） |
| E9 | DEC §9.2「为什么不让它变成独立 npm 扩展…目前没有第二个使用者」 | 事实断言需复核 | 全仓未见第二个宿主证据（`Cortico-up/deployments/` 仅 `mybot`） | **成立**（但属偏好，非约束；按主人裁决扩展粒度=业务域，此处结论恰好一致） |

---

## 二、数字核对表（声称值 / 实测值 / 命令 / 结论）

| 项 | 声称 | 实测 | 命令 | 结论 |
|---|---|---|---|---|
| bili-account 文件/行 | 17 / 4,008 | 17 / **4,018**（HEAD `5575f95` + 工作树） | `find E:/WorkSpace_Qoder/Cortico-up/src/worlds/bili-account -name '*.ts' -exec cat {} + \| wc -l` | 过期，需更新 |
| Core | 42 / 9,551 | 42 / 9,551 | 同上（`src/core`） | ✅ |
| WebUI | 298 / 38,155 | 298 / 38,155 | `src/web` | ✅ |
| providers | 79 / 8,109 | 79 / 8,109 | `src/providers` | ✅ |
| extensions | 18 / 2,543 | 18 / 2,543 | `src/extensions` | ✅ |
| src/worlds 合计 | 161 / 66,199 | 161 / 66,199 | `src/worlds` | ✅ |
| 上游各 world 行数 | 47,703 / 6,727 / 5,226 / 1,285 / 1,070 / 140 | 全部一致 | 逐目录 `wc -l` | ✅ |
| cormini | 34 / 6,222 | 34 / 6,222 | `bots/cormini` | ✅ |
| persona-core | 16 / 2,054 | 16 / 2,054 | `persona-core` | ✅ |
| dsh CLI 条数 | 43 | **43** | `awk '/^const map/,/^\}/' tools/bili.mjs \| grep -cE "^\s*'?[a-z-]*'?:"` | ✅（但 TARGET §6 写 41 → 否决） |
| dsh scripts 数 | 41 个 | 41 个条目 = **39 个 .mjs + evaluate.sh + hashes.json** | `ls scripts/ \| wc -l` | 表述需改（"41 个脚本"不成立） |
| dsh 测试文件 | 79 | `tests/**/*.test.mjs` = **79**；runner discovered **80**（含 adapters） | `find tests -name '*.test.mjs' \| wc -l`；`run-mjs-tests.mjs` 输出 | 部分对，需补"全量 80" |
| dsh 测试项数 | 440 | **444**（tests=444 pass=444 fail=0） | `node scripts/run-mjs-tests.mjs`；`docs/evidence/gates-2026-11-03.json` | ❌ 否决 440 |
| 她身上的工具 | 18（DEC 写 15） | **18** | `tools/../src/worlds/bili-account/tool-decls.ts`（`DECLS` 18 项、`TOOL_SUMMARIES` 18 项）；`definition.ts` 中 `mk(DECLS[0..17])` | ✅ 18（DEC 15 否决） |
| 工具差集 | 34 | 43 − 18 = **25** | 同上 | ❌ 否决 34 |
| 上游落后/领先 | 落后 543 / 领先 116 | **落后 436 / 领先 116**（master…upstream/main）；HEAD…upstream/main = 108/1 | `git -C Cortico-up rev-list --left-right --count master...upstream/main` | ❌ 543 无法复现 |
| state-roots 类数 | 24 | **24** | `awk '/^const KINDS/,/^\}/' tools/lib/state-roots.mjs \| grep -cE "^  '?[a-zA-Z-]"` | ✅ |
| draftsDir 行号 | paths.mjs:196 | 函数声明在 **194**（196 = legacy 存在性判断行） | `grep -n "export function draftsDir" tools/lib/paths.mjs` | ❌ 改 194 |
| legacy 注释行 | paths.mjs:34 | 34 ✅ | `grep -n "只有\"没搬家的机器\"" tools/lib/paths.mjs` | ✅ |
| scheduler 引用 | core/scheduler.js:151 | 151 ✅（该行确为 comment-digest）；`likes` 0 命中 | `sed -n '151p' core/scheduler.js` | 部分对，`likes` 需补证据 |
| fields memories/chain/上限 | 60 / 68 / 200 | 60 / 68 / 200 | `node -e` 读 `C:/Users/Administrator/.dsh/bili-whale/fields.json`；`personaAdapter.ts:156` | ✅ |
| workspace 文件/体积 | 10 文件 / 2.4M | 10 / 2.4M | `find deployments/mybot/workspace -type f \| wc -l`；`du -sh` | ✅ |
| 三盘体积 | 1.2G / 6M / 117M | 1.2G / 6.0M / 117M | `du -sh` 三目录 | ✅（但路径字面 `C:\.dsh`/`C:\.bili-ai` 不存在） |
| 能力面占比 | 42% | 41.9% | 18/43 | ✅ |
| 唤醒工具真实用量 | "18 个工具" | usage 列表含 `bili_*` 18 类 + 外部工具名 | `node scripts/wake-audit.mjs --usage` | ✅ 语义成立 |
| tick/天 | 281 | **查不到**（观测未开始） | `node scripts/observation-status.mjs` | ❌ 无源 |
| 意见箱 ID | f-d99d64 / f-11a351 / f-ac6261 / f-b9a891 / f-4fe2c2 | **查不到**（.dsh 内无命中） | `grep -rl` | ❌ 无源 |
| bot 扩展契约版本 | api 6 | 模板 **api 7**（world 模板 api 6） | `templates/extension/bot/package.json:18` | ❌ 改 7 |
| msgfeed 调用方 | 0 | **2 个 CLI 调用方** + likes 独立读 | `grep -rn msgfeed tools/` | ❌ 否决 |
| world 注册行 | `src/worlds/index.ts:18` | 18 ✅ | `grep -n bili-account src/worlds/index.ts` | ✅ |
| WorldDefinition 契约 | `src/world.ts:52` | 52 ✅ | `sed -n '52p' src/world.ts` | ✅ |

---

## 三、这两份方案合并时必须先解决的三个冲突

1. **粒度：整个 B 站域一个包 vs 感知独立成单元。** TARGET §2.2/§6 把 debrief + inbox + 写能力全收进 `cortico-world-bilibili`，并明写"不做更细的拆"；DEC §9.2 标题与 §9.4 要把互动感知"独立成一个单元 / 走端口 + 适配器"（§9.4 甚至自我修订 §3.3）。按主人裁决（粒度 = 业务域，不横切感知），DEC §9.2 标题与 §9.4 的"感知拆"作废，DEC §9.2 结论句（先在 World 内做）保留。合并稿必须只留一句：B 站 = 一个 world 包，域内四个入口（inbox/debrief/write/ledger）。
2. **配置落点：world 的 `config.ts` JSON Schema vs dsh 的 `bili-whale.config.json.storage`。** 同一组 `stateDir/mediaDir/draftsDir` 在两份方案里各有一个 owner（TARGET §4 vs DEC §9.3 步骤 1）。主人已裁"配置就放那儿、页面能改、默认值由代码定"——合并稿必须指明唯一 owner、唯一默认值来源、页面可改的那一条路径，并删掉另一处重复声明。
3. **P1/P2 的门禁与已落地的现状脱节。** (a) P1 说"bili_comment/bili_danmaku 默认 review=人工放行"，但 2026-11-03 档位已成配置项（`permissions.comment`/`permissions.danmaku`，`tools/lib/publish-policy.mjs:26-27`、`src/worlds/bili-account/config-store.ts:130-131`），P1 只能补工具面、不能重设默认；(b) P2 门禁写"包内 vitest/440 项全绿"，实际 runner 是 node:test、实测 80 文件 444 项，搬进 vitest 是改写不是搬家；(c) P1 门禁"usage 名单变短""意见箱 f-… 有落点"两条都不是命令判定（usage 只覆盖 235 行会话；意见箱 ID 在 .dsh 内查不到）。合并稿的每个门禁必须写成"一条命令 + 期望退出码/输出"。

---

## 四、我查不到 / 证据不足（不猜）

1. **281 tick/天**：全库只有 DEC §9.2 自引这一处，`observation-status.mjs` 报"观测尚未开始"。无从复核，也无从判定是否还有效。
2. **意见箱 5 个 ID（f-d99d64 / f-11a351 / f-ac6261 / f-b9a891 / f-4fe2c2）**：`grep -rl` 在 `C:/Users/Administrator/.dsh` 无命中；我未找到 feedback 的实际存储文件（`.dsh/bili-ai/` 目录清单里没有 feedback 文件，而 `state-roots` 有 `feedback` kind，owner=cli）。ID 可能是文档里的短号、也可能在 `days/` 记录里——未核实。
3. **"落后 543"的来源**：实测只有 436（master…upstream/main）。543 可能是写稿时某个中间态，也可能来自另一口径（如含已 squash 的 PR）。我无从复现，不能断言它是"错的"还是"过期的"，但合并稿必须重跑并写明 ref 对。
4. **600 行无撕裂 / `causal` 不上锁**：只有转述（`docs/DECOUPLING-STATUS-2026-11-02.md:38`，指向 commit `e57fdda`）。我没现跑复现，也不核该 commit 内容。
5. **`quota react` 是否就是 `likes.mjs`**：scheduler.js 里无 `likes` 字面；`quota react` 是否内部读 `/x/msgfeed/like` 未核。
6. **配置里的 `home` 字段是否仍指向 `D:/AI/养鱼`**（DEC §9.3 表第 5 行）：我只 grep 了 `storage`/`migratedAt`（无命中），没有逐字段读 `bili-whale.config.json`，故这一格不判定。
7. **框架 Memory 是否已支持"三层 + 检索 + 作废"**：只确认 `bots/cormini/persona/memory.ts` 存在（412 行起）；分层与检索的具体能力未核。
8. **外部 world 扩展能否自带 WebUI 页签**：`templates/extension/world/` 无 webui 目录，我只确认了目录清单，没有读 `docs/extensions.md` 的 WebUI 章节全文。TARGET §2.2 的 `src/webui/` 归属因此标"需补证据"而非"否决"。
9. **"切 live 时已经踩过一次白屏"**（TARGET §7）：未找到对应证据文件，未核。
10. **DEC §9.1 说 `comment-digest` 与 `likes` "被面板使用"**：面板侧调用未核。
11. **Cortico 主仓（`E:/WorkSpace_Qoder/Cortico`，master）与 `Cortico-up` worktree 的差异**：我核了 worktree 关系（`git branch -vv` 的 `+ master`），未核两者是否同一 commit 状态；B7 的 4,018 是 worktree 工作树实测值。
12. **`bili-alarm` / `alarm` 工具与"能处理"能力**：DEC §9.5 说处理能力属 E 方案；`bili_alarm` 工具实际已存在于 `tool-decls.ts`（18 个之一）。§9.5 把"她处理不了"当现状描述与实测冲突（alarm 工具在、缺的是收件箱），但我没跑通她的实际调用路径，故标"需补证据"而非直接否决。

---

## 五、最严重的一条

**TARGET §1.5「`tools/lib/msgfeed.mjs`…**调用方为 0**」是事实错，且它正是"她只听得见私信"这条全篇论证的支点。** 实测 `tools/commands/comment-await.mjs:23` 与 `tools/commands/comment-digest.mjs:18` 都在 import 它（`pullFeed`/`resolveLatestReply`），`tools/commands/likes.mjs:41` 单独读第三个收件箱。正确表述是"**她本人（World 侧）零调用**"，而不是"没人调用"。这条错误如果被合并稿继承，P1 会被写成"从零实现两个收件箱"（实为"把已实现的读法接到 World 上"），工作量与风险都被凭空放大；同时也证明 TARGET 与 DEC §9.1 对同一事实给出了相反陈述（两文档同时存在这一处即断链，说明至少一份未做实测复核）。

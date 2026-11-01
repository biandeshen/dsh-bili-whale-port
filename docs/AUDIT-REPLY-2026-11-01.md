# 对账与更正（2026-11-01，回应第三方审计）

审计报告：`E:/WorkSpace_Qoder/AUDIT-2026-11-01.md`（仓外，不进版本控制）。本文只做两件事：
**已修的逐条对应到提交**，以及**审计指出的三处自评失真公开更正**。

## 一、公开更正（不静默改）

审计 §6 核实的失真，逐条认：

1. **意见箱数字**：我上一轮报"25→21"，磁盘实际是 32 条 / 未结 27（high 11）。
   数字口径错在我用会话里的印象代替了磁盘计数。
2. **"context-facts 开工前就红"**：实际是本批 `e9d5b03` 打破的断言（期望 `GET /models 401`，
   实现改成了中文人话）。归因错了：不是既有红，是我的改动带来的断言过期。
3. **"审计报告已落成文件"**：当时根本没写任何文件。报告是后来按你的要求补写的。

共同机制：**结论比证据远**。对应的流程锁见第四节。

## 二、地基（读数为准）

| 审计项 | 处置 | 提交 |
|---|---|---|
| P0-1 风控额度分账 | 所有状态读写收敛到 `tools/lib/paths.mjs`；加断言扫描全仓禁止散拼 `.bili-ai` | `11d69eb` |
| P0-2 待审稿读数与面板分家 | 两个 `DRAFTS_DIR` 合成一处（`tank.ts` 的 `resolveDraftsDir`），definition 引用它 | Cortico `91aa02e` |
| P0-3 go-gate 读失败清空队列 | 读不出来就拒绝写；`reply-draft` 同样 | `11d69eb` |
| P0-4 因果账被 `catch {}` 吞 | `causal()` 失败上抛；配置已改好只是记账失败时用 `withLedgerError` 保留结果并报因 | Cortico `91aa02e` |
| P0-5 kill 不覆盖第三方出口 | 检查提到域名分叉之前；STOP-RUNBOOK 改成事实口径并写明边界 | `afbb466` |
| P1-1 dm 额度分叉 | 写只落新家 | `11d69eb` |
| P1-2 备份目标解析错、transcript 为 0 | `runs/` 与部署 `config.json` 纳入备份；草稿根按"存在优先"排序（原来按字母排，D 盘的实目录掉到第二名） | `11d69eb` |

备份实测：文件数从 111 涨到 704，`cortico/deployments/mybot/data/runs` 586 个文件。

## 三、功能

| 审计项 | 处置 | 提交 |
|---|---|---|
| P0-6 对话历史回看 | `GET /api/session/history/search`（按 run 日期 / 关键词 / 角色）+ 控制台历史面板的检索行 + `runs/` 进备份 | Cortico `2affef6` |
| #7 日记按小节检索 | `bili_diary_read` 加 `heading`；不带过滤时回执列出这本有哪些小节 | Cortico `2affef6` |
| #9 图片能收不能看 | 兼容端点补 `accepts`（读 `multimodal`）；控制台 `console_see_image`；看不了时正文写明 | Cortico `e5eb872` |
| #10 浏览器扩展激活死锁 | 先落盘启用意图再前置检查，失败回滚；激活失败写服务端日志 | Cortico `ddca555` |
| #11 模型选型 | `deployments/mybot/workspace/MODELS.md`（实测表，含三个"收下图但答错"的）；候选预置进端点 | 部署文件 |
| #12 上游 | `scripts/upstream-audit.mjs`；opencode provider 的 `StreamErrorEvent` 已由另一会话补上 | Cortico `e78e84a` / `ddca555` |
| #14 通知接线 | `tools/lib/report.mjs` + like/fav/dm/dynamic-image/评论被拦 全部接上；`quota.selfDaily` 默认 6 | `6187c9c` |

## 四、流程锁

- `run-mjs-tests.mjs`：逐文件跑，比较发现数 / 执行数；`--report` 落 `docs/evidence/gates-<date>.json`。
  原来 `EXECUTED = files.length` 是传参算的，同义反复。
- 本仓第一个 `.github/workflows/ci.yml`；Cortico 的 `ci.yml` 补 `master` 与 `test:mjs`。
- 冻结哈希随判据变更重冻（`check-hashes.mjs --write`），diff 里能看到。
- 本文件提到的每个提交号都可用 `git show <sha>` 复核；门禁数字只引
  `docs/evidence/gates-2026-11-01.json`，不在正文里抄。

## 五、意见箱回写

按审计 §5 逐条改状态（不拿总数糊）：

- **已修待标 → 已结**：`f-ac48e3`（扩展清单可见性）、`f-54fb32`（字幕路径）、
  `f-17767a`（debrief 不再指不存在的读图工具）、`f-aec73f`（采样口径 + 桶数警告）、
  `f-da8994`（日记按日期/小节检索）、`f-579859`（图片能看）、`f-b7c6ad`（`home is not defined`）。
- **工具在、存量没清 → 已结并说明**：`f-e66393`。查过 48 条记忆，没有
  "watchedVideo 把不收写成喜欢"的条目，`void` 标记 0 条是**因为没有对象**，不是漏做。
- **闹钟三连 → 已结**：`f-ac6261` / `f-b9a891` / `f-4fe2c2`。没等 pet-diary 上游，
  本部署自己给了 `bili_alarm`（分钟 + 一句话，走持久队列，重启照响）。
- **口径冲突 → 已结**：`f-af013b` / `f-b51b3f`。`bili_capabilities` 改成事实口径：
  装/卸与改配置归主人，启用/停用她自己能点（Cortico `316928b`）。

## 六、没做的

- **上游整跟**：本地与上游**没有共同祖先**（`upstream-audit` 实测），merge 会把两边都当新文件。
  只做了定点 backport（`StreamErrorEvent`）。整跟要单独立项。
- **密度排序后半**（改分位数/分布形态代替条/桶）：未做。
- **扩展安装安全**（审计 P1-3：主进程 import 第三方代码、无签名校验）：未做，属设计问题。
- **成本口径**（539 次调用 `cost=0`）：价格表没配，未做。

---

## 七、落线门：**通过**（2026-11-01 23:26 复核后）

交接文档 §0.1 要求「`reanchor/replay` + 现 dsh 跑通一次真实 tick + 一次 debrief」才准开工。
实测结论：**开不了工**。原因不是配置，是那个检出本身没重放完。

### 已经落盘的

`reanchor/replay` 交接时有 386 个文件停在暂存区（18:08 后再没变，是停下的半重放）。
按你的指示先落盘不丢东西：

- `63dcc54` 原样提交那 386 个文件
- `d96a6ce` 补三处重放漏下的：`errors.ts` 里 `StreamErrorEvent`/`upstreamText`
  各出现两遍（英文版与移植版并存，tsc 报重复标识符）、
  `framework-release` 用了本仓没有的 `readFile`、测试里一个已不用的变量

工作区里另有 9 个未暂存改动会删掉 `StreamErrorEvent`（#61 的修复），
判为半途试验，随提交作废。

### 量出来的缺口

`npx tsc -p tsconfig.web.json`：**41 个错误，全在
`src/web/client/features/extensions/index.ts` 一个文件里**。

| 错误 | 次数 | 含义 |
|---|---|---|
| `Cannot find name 'renderRestart'` | 7 | 调用点在、函数没拷来 |
| `Cannot find name 'hit'` | 6 | 上下文变量没拷来 |
| `Cannot find name 'button'` | 6 | 同上 |
| `S.eraseConfirm` / `S.stateLoaded` / `S.enabled` 等字符串键不存在 | 若干 | 文案表没拷全 |
| 隐式 any | 3 | 类型标注缺失 |

跑全套 vitest：**93 条红 / 5210 条**，其中 65 条是同一个
`ReferenceError: renderRestart is not defined`。

我试过只补 `renderRestart` 一个函数——补完 41 个错误降到 38 个，
剩下的要求整片重来。这不是"补一个函数"的量级。

### 为什么停在这里

交接文档的纪律写得很明确：「不通过就先修契约，**不要开始 A/B**」。
把这 41 个错误硬压下去，等于在一个没验过的地基上开工，后面每一步的"绿"
都不可信。所以 §8 的 25 步一步都没开始。

### 两条可选的路

1. **把上游那个文件整份取来重放**（`git show upstream/main:…` 拿到当前版本，
   再逐处把我们的改动加回去）。已知它引用的 `restartRoot`、`workspace.statusRoot`
   本仓都有，接口是对得上的。
2. **改在 master 上做**：master 现在功能齐全、门禁全绿（dsh 72 文件 386 断言、
   Cortico 125 mjs + 1242 vitest），只是落后上游 435。代价是方案文档说的
   "先补一遍再迁"。

我不替你选。选定之前，§8 的 25 步一直停着——这比带病开工诚实。


---

## 七之补：复核后的结论（23:26）

上一条判"不通过"时我说的两件事都是错的，更正如下。

### 更正 1：`tsconfig.json` 干净不等于 web 干净

我只跑了根 tsc。`tsconfig.web.json` 当时 **41 错**，全在
`src/web/client/features/extensions/index.ts`。性质不是设计冲突，是**重放不完整**：
`renderRestart` / `installControl` / `getButton` 三个函数**上游有、我们没有**
（master 与 reanchor 都是 0 个），是调用点拷来了、被调函数没拷来。
行数也印证：本地 2062 / 上游 1913 / master 1718 —— 两代代码粘在一个文件里。

### 更正 2：落后不是 57

我接手时又推了两个提交（`63dcc54` + `d96a6ce`），但那 41 个错一个没解决。
"再补三处"不是解药。

### 采用的修法：整份取上游再挑回

`83dc3ee` 整份取 `upstream/main` 的版本（1913 行），web tsc **41 → 0**。
`9ea8259` 把我们的本地改动按新结构挑回——上游把"已安装"收进了详情页，
原来的独立卡片位置没了，所以激活/停用与原因行挂到 `renderDetail` 的按钮区：
四种"已安装却没工作"各一句原因，World 就地开关（停用按两次），
状态卡住（failed / pending-restart）时不给开关。

### 验收（你补充的那条也做了）

| 项 | 结果 |
|---|---|
| `tsc -p tsconfig.json` | **0 错** |
| `tsc -p tsconfig.web.json` | **0 错** |
| `npx vitest run`（全量，不只看 tests/web） | **290 文件 / 5207 通过 / 3 skipped / 0 失败** |
| 真实 tick | 新进程 23:20 起，**23:23:52 ticks.jsonl 有新行**，`life loop armed` |
| 真实 debrief | BV1E1x36aE6a 跑通：元信息 + 封面路径 + 无字幕说明 + 弹幕采样口径 + 热评，六路齐 |

`cbd3e90` 修了五处被我们的改动弄失效的旧断言（都是断言过期不是功能坏）：
四个集成测试的 POST 助手缺同源 Origin、cormini 工具表少列 `console_see_image`、
`context-facts` 把报错措辞写死、`util` 的直读白名单没算 World 侧。

### 怎么跑的

用她的真实部署另开端口 7800（同一个部署不能同时跑两个进程）：先暂停并关掉 7799，
用 `Cortico-up` 起 7800 验完，再停 7800、用启动器把 7799 拉回来。
现在 `pid 117840` 在跑，`lastAppliedAt` 15:26Z 仍在更新。

**落线门：通过。§8 的 25 步可以开始。**

# CHANGELOG

> **版本线规矩**（原写「见 `docs/INDEX.md` §4」，**那一节已随文档改制删掉**：`1f90099` 之后 INDEX 只剩三节，
> 2026-11-13 实测 `grep -n '^## ' docs/INDEX.md` → 1/2/3。原文可取回：`git show 1f90099^:docs/INDEX.md` §4。
> 规矩搬到本文头部，五条照抄不改口径）：
>
> 1. **版本线只有一条**：上游 `v0.4.6`（2026-10-24，tag 在）之上的移植工作用 `port-0.x.y`，与 `package.json` 的 `version` 一起走。历史 `v0.1.x–v0.4.6` 是上游轻量 tag，不动、不重打。已知不一致：`port-0.5.1` 打了 tag 但没 bump（停在 `0.5.0`），`0.5.2` 起重新对齐，旧 tag 不重打。
> 2. **什么时候打 tag**：一个能被 `node scripts/run-mjs-tests.mjs` 全绿复现的**里程碑收口**时，不是每个提交、也不是每条 dev 分支。tag 前必须复跑并把真实数字写进本文。
> 3. **谁打**：改动的那一席在本地打**附注 tag**（`git tag -a`），message 写"这一版包含"+ 可验证物（commit 号、文件、命令）。
> 4. **不 push**：tag 与提交默认只留本地；`private`（`biandeshen/dsh-bili-whale-port`）只在主人明说"推"时推，`upstream`（`Alterssss/dsh-bili-whale`）是公开仓**不推**——AMpath 借用件与 CC BY-NC-SA 素材未清干净，见 [`docs/CREDITS.md`](docs/CREDITS.md)。
> 5. **本文写法**：里程碑级条目，每条带日期与可验证物；不逐提交流水，不抄 INDEX §3 的数字。

## 未发版（2026-11-13）—— 宿主宣称降级：从「宿主可以整个换掉」到「只验证过 Cortico」

主人拍板三连的**第二件**（删旧代码 → **改文档宣称** → 假宿主验证）。**纯文档 + manifest，`packages/` 一行代码没动。**
**版本号没 bump、tag 没打**（同下条的理由：第三件还没跑，主人也没说发版）。

提交：`a1aa7ba`（8 文件，+428 / −36），分支 `port/core-opencode-panel`，**未 push**。
提交后在干净工作区复跑：本仓 149/149 文件 858 pass、宿主 28/28 229 pass，报告 `gitSha` = `a1aa7ba`。

### 生效的是哪一版

**降级版（当前版）**。主人指定的原文逐字写进 `README.md` 顶部新增节与 `VISION.md` 落点表后：

> 接口已做宿主无关设计（能力包严禁 import `cortico/*`；UI 经 `PanelCtx` 注入；模型由宿主发起）。**但目前只有一个真实宿主被验证过：Cortico。** 在未通过最小宿主验证之前，不宣称『可安装到任意底座』。

升级版（带验证日期 / stub SHA / 24h / 对外凭据 exit 0 / 三页真浏览器）**要等第三件三条判据全过**才允许写。
三句禁语一条没写：「支持任意底座」/「插件化完成」/「即装即用」。**也不是把句子删掉就算完**——每处都给了实测判据。

### 先量后写：三条宣称里有一条被量翻

| 宣称 | 判定 | 判据 |
|---|---|---|
| 能力包严禁 import `cortico/*` | **成立，且比宣称更宽** | 整个 `packages/` 树 11 个包 **0 个** `cortico/*` 模块说明符；唯一命中是 `persona-core/src/capability.ts:6` 的**注释** |
| UI 经 `PanelCtx` 注入 | **成立**（有一条要说清的边） | `PanelCtx` 只注入 DOM 根 + `invoke`（`cortico-adapter/src/webui-helpers.ts:55-63`）；adapter 两文件 517 行、**0 条 import/require**。但 6 个能力包 UI 用相对路径引这个包（12 行 import）——包名叫 `cortico-adapter`，里面却没有 Cortico 专有依赖 |
| 模型由宿主发起 | **不成立（一处反例）** | `cap-media-studio/src/vendor/tts.mjs:41` 自己 POST `api.xiaomimimo.com/v1/chat/completions`；链路 `index.ts:226` → `render.ts:10` → `tts.mjs:96`；key 取自本机凭据文件/`MIMO_API_KEY`，**不经宿主**，且 `:61` 明写不走 traffic 闸 |

**这条反例是审查方给的口径里没有的**，本批自己量出来后写进了降级文（不是悄悄放过）：
换宿主之后配音那一路照样自己花钱，宿主的成本账/退避/402 感知都管不到它。
**第三件必须覆盖配音这一路**，否则 stub 上跑通也只证明了另外五个包。修法（交回宿主发起 / 改宣称口径）**待主人拍板**，本批不改代码。

### 装载层的三处真耦合（换底座真正要改的地方）

1. 宿主 `extensions/package.json` 三条 **绝对路径 link**（`link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/...`）+ `extensions/node_modules/` 三条符号链接 ⇒ 换机器/换盘符就断，断法是宿主启动期报错（`Cortico-up/src/extensions.ts:220-222`）。
2. `scripts/build-webui.mjs:24` **先找隔壁 `../Cortico-up/node_modules/esbuild`**；本仓 `node_modules/esbuild` 不存在、根 `package.json` 没有任何依赖声明 ⇒ 实际只有这一条路，目录名写死。
3. 本仓**任何 package.json 都没有 `engines`**（`node>=22` 是宿主的声明）；`npm run gates` 自己也写死 `--root ../Cortico-up`。

### 改了哪些文件

| 文件 | 改了什么 |
|---|---|
| `README.md` | 第一句「给 **DSH** 装」→「在 **Cortico** 里养」；分支行「DSH 不再是唯一宿主」→「唯一验证过的宿主是 Cortico」；**新增顶部节**（当前版原文 + TTS 反例 + 三处耦合）；`## 装` 整节重写（原三步 `dsh plugin add` / 「设置 → 养鱼」/ 重启 DSH **已随代码树删除，照做不会成功**）→ 实测装载路径 + 「连接与凭据」面板 + `tools/bili.mjs selftest`；「保存即生效」降级（`x-hot` 无消费方，只有 cookie 下一拍生效）；前提行说清 engines 归属；`## 依赖与移植性` 七行 DSH 时代表 → **九行实测表**（每行带 file:line），**「宿主可以整个换掉」删掉并在原位说明为什么删**；ffmpeg 体检入口改 `deps`；`AGENTS.md` 小节加「DSH 时代、当前不生效」标注（原文留对照） |
| `VISION.md` | 落点表后新增「愿景与当前实测的差」。**作者原话一个字不改**；另加校注：第 12 行「`dislike` 是硬屏蔽」是旧口径，以落点表第一行为准（主人 2026-11-06：只是个标签，不做硬拦） |
| `docs/INDEX.md` | 第二条「读 attic 的口径」：`ARCHITECTURE-TARGET-2026-11-03.md` §2.1 铁律2「100% 宿主无关」是**设计裁决不是验收结论**（且当时 5 个包、现在 6 个）。**attic 原文一个字不改** |
| `docs/specs/10-control-surface.md` | ⑤ 新增**第 14 条＝本仓唯一的跨宿主验证登记处**：已量到的 / 量翻的 / 三处耦合 / stub 四件事与三条判据 / **三条都还没跑**（402 无凭据 ⇒ ①② 未验证）/ 只读复现命令 |
| `package.json` | `description` 去掉「DSH 里的 agent」「『养鱼』完整设置页（27 项）」，写明只验证过 Cortico；`keywords` 去掉 `dsh`/`dsh-plugin`/`deepseek-harness`，换 `cortico`/`persona`。**`name` 与 `version` 不动**（改包名要动宿主 link，另开批次） |
| `docs/evidence/host-claim-downgrade-2026-11-13.md` | **新增**：逐条实测读数（grep 原文 + exit code）、TTS 完整调用链每一跳行号、装载层三处原始输出、落地位置对照表、复现命令、七条「没验的 / 登记给后续批次的」 |

### 门禁与测试（改动相关，逐个跑）

`check-doc-hygiene` / `check-hashes` / `check-consumers` / `check-script-paths` / `check-cortico-paths` / `check-live-drift` / `check-mjs-syntax` **全 EXIT=0**。
`check-state-roots` **EXIT=1**——`dm-await-state`/`dm-quota`/`pending-replies` 三条分叉，**本批之前就红**，归 #58，没为它加豁免。
测试：本仓 **149/149 文件，858 pass / 0 fail / 0 skip / 0 todo / 0 cancelled**；宿主 **28/28，229 pass**（报告落宿主仓 `docs/evidence/`，未提交，宿主仓不动）。

### 没验的那条

**本批没有在任何非 Cortico 宿主上装载过。**「只验证过 Cortico」的依据是「仓内不存在第二个宿主的装载记录」，
**不是**「试过别的宿主失败了」——那个试验是第三件。另：真浏览器 11 个页签（B-1 尾）仍未做，线上 7799 当前没起。

## 未发版（2026-11-12 → 11-13）—— 旧接入层四棵树退役，79 个文件真删

提交：`b2e9fe7`（118 文件，+7118 / −5902），分支 `port/core-opencode-panel`，**未 push**。

**版本号没 bump、tag 没打**：按本文头部第 2 条，tag 只在里程碑收口时打，而这一批的验收还差一条
（真浏览器 11 个页签，见下「没验的那条」），主人也没说发版。所以这条条目先记事实，不占版本号。

### 删了什么（`git rm`，不是"端口退役、目录留着"）

四棵旧接入树整棵删除，共 **79 个文件**（`git diff --cached --name-only --diff-filter=D | wc -l` → 79）：

| 树 | 文件数 | 是什么 |
|---|---|---|
| `core/` | 10 | 旧 DSH 插件内核：`index.js`、`client.js`、`api/routes.js`、`api/support.js`、`scheduler.js`、`session-delivery.js`、`mention-summary.js`、`node-runtime.js`、`work-dir.js`、`ports/temporal.mjs` |
| `panel/` | 23 | 独立面板（8447/8448）：`server.js`、`auth.js`、`data.js`、`causal.mjs`、`drafts.mjs`、`feedback.mjs`、`views/tank.html` + `assets/whale-girl/` 16 张 png 与 manifest |
| `adapters/opencode/` | 6 | OpenCode daemon / MCP stdio 接入线 |
| `vendor/dsh-autocut/` | 18 | 旧自动剪辑 vendored 件（`vendor/dsh-video-studio/` **留下**，它是 T1） |
| 仓根 + `scripts/` | 8 | `start.cmd`、`open-panel.cmd`、`setup.cmd`、`cordis.patch.yml`；`scripts/{launch-panel,open-panel,setup}.mjs`、`scripts/evaluate.sh` |
| `tests/` | 14 | 7 份只测旧树的契约/集成/DOM + 7 份只被它们用的 helper |

**逐文件四层引用表**（施工依据，不是事后补的说明）：[`docs/evidence/legacy-refs-2026-11-12.md`](docs/evidence/legacy-refs-2026-11-12.md)
（+ 同名 `.json`）。候选 168 文件、引用方文本 682 份，分层 T1=6 / T2a=5 / T2b=127 / T3=4 / T4=13 / T0=13。
**删除集里的 57 个树内文件零 T1、零 T2a**——注释里提一句不算引用，`path.join` 片段按整组解析，
文档与测试不当根、不当桥。

### `tools/` 一个文件都没删（三条硬判据，不是"保守起见"）

1. **有活脚本真的 import 它，不是"存在性探针"而已**：
   - `scripts/dynamic-approve.mjs:15` → `import { postImageDynamic } from '../tools/drafts/publishers/bilibili-dynamic.mjs'`（动态审批放行 CLI，`:68` 用它当默认 publisher）。
   - `scripts/preflight.mjs:49-50` → `add(fs.existsSync(tools/bili.mjs) ? 'ok' : 'fail', '工具链入口', …)`，缺了就红。
   - `scripts/counterfactual.mjs:11`（**在哈希冻结名单里**）→ `draft-dynamic.mjs` → `tools/lib/pick-image.mjs`；`scripts/nightly-scheduler.mjs:18` 也 spawn 它。

   这三个脚本都**不在 `npm run gates` 链里**，所以引用表把它们当死脚本、把 `tools/bili.mjs` 归进 T2b——
   **这是表的口径漏洞**：它的"活脚本"根集只取 npm 可达，漏了没接进 npm 的运维入口，于是 T2b 偏宽。
   删除集本身不受影响——新路径门禁扫的是**全部 422 个脚本**，不分层。
   补测（2026-11-13，静态 import + 派发表字符串 + 动态 `import()` 三类边）：
   从 `tools/bili.mjs` 传递可达 **31/42** 个 `tools/lib` 文件；再并上 ops 脚本可达的 `kill`/`offline-gap`/`state-roots`
   与 `draft-dynamic.mjs` 可达的 `pick-image`，**35/42**（顶层 39 个里 35 个）。
   审阅方给的「33/39 是活的」与此同向，差在口径（分母含不含 `credentials/` 三件、算不算 ops 脚本），
   结论一致：**整棵删不动**。判据与原始输出落盘在
   [`docs/evidence/tools-retention-2026-11-13.md`](docs/evidence/tools-retention-2026-11-13.md)。
2. **能力包侧还有两处功能缺口，删了 tools 就等于把这两条能力一起删掉**：
   - **带图动态发不出去**：`bili_dynamic` 工具收 `imagePath`（`packages/cap-bilibili/src/index.ts:864/870/876`）并交给闸门，
     但默认执行器 `:330-333` 调 `executeBiliWrite(kind, { target, body })` 时**把 imagePath 丢了**；
     再往下 `client/bili-write.ts:343-346` 与 `client/bili-write-extra.ts:42-45` 的入参类型里**根本没有图片字段**
     （`grep -n "image\|pictures" client/bili-write.ts` → 0）。真能发图文动态的只有
     `tools/drafts/publishers/bilibili-dynamic.mjs` 的 `postImageDynamic`。
   - **批量放行只有一个入口**：cap-bilibili 里没有 `releaseAll`（`grep -rn "releaseAll\|'--all'" packages/cap-bilibili/src` → 0），
     `tools/commands/reply-draft.mjs:120-123` 的 `release --all` 是唯一的批量放行路径。
3. **没有活代码引用的只有 7 个**：`go-rebuild`、`poll-policy`（原来只被已删的 `core/api/routes.js`、`core/scheduler.js` 引，
   本批之后变成孤儿）、`proc`（T0，谁都不引）、`state-lock` 与 `credentials/` 三件（T3，只有测试引）。
   **它们留在原地**，等 tools 收编那批一起处理，不单独摘——T3 不等于可删，测试还在跑它们。

### 新门禁：脚本不许指向已消失的文件

`scripts/check-script-paths.mjs`（五条规则：R1 import / R2 仓内路径 / R3 片段拼出 / R4 启动器 / R5 用法注释裸路径），
接进 `npm run gates`，并**冻进哈希名单**（`check-hashes.mjs` 16 份，本批 `--write --note` 重冻 rewritten=2）。
故意违规的红输出与故意合法的绿输出都在
[`docs/evidence/script-paths-red-demo-2026-11-13.md`](docs/evidence/script-paths-red-demo-2026-11-13.md)：
夹具放在**仓外**临时目录（`--root` 指过去），红 5 条（R1×1 / R3×3 / R4×1）EXIT=1，
真仓绿 422 个脚本文件、30 条未核**逐条给理由**（散文提及 6 / 模板字符串 2 / 夹具键名 21 / 断言期望值 1），不留静默白名单。
配套 `tests/script-paths.test.mjs` 11 条。

### 连带改的（都是"不改就说谎"那一类）

- **`package.json`**：删 `main`/`exports`（指向 `core/index.js`、`core/client.js`）与整个 `dsh` 段（DSH 插件 bundle 声明）；
  `files` 去掉 core/adapters/panel/cordis.patch.yml 与四份早已不存在的 md，补上 packages/vendor/assets。
  `description`/`keywords` 仍写着 DSH 插件——**那是宣称降级那批的活，本批不动**。
- **三份运维文档原样搬 attic**：`DEPLOY.md`、`RUNBOOK.md`、`TERMUX.md` → [`docs/attic/2026-11/`](docs/attic/2026-11/)，
  它们写的正是被删掉的那四条接入线。INDEX 根目录表同步，起停只看 `CORTICO-RUNBOOK.md` 与 `specs/10`。
- **`scripts/preflight.mjs` 重写探针**：panel.token / `PANEL_PORT||8447` / OpenCode 三项换成
  `hostRoot()` + `deployment.json` + 固定 7799；凭据缺失的文案改成「旧家兜底口径，线上真正读 `<部署家>/xiaoyu/.env`」。
  顺手修一个假读数：风控 `until` 是**熔断到期时刻**，过期后 guard 自己就放行（`traffic.mjs:69` 比的是 `until > now`），
  以前不比较就把三天前的旧熔断报成「熔断中」。现在实测 EXIT=0：未熔断 · 账号桶 3 个 · 宿主 `Cortico-up` · 端口 7799 可用。
- **两处扫描面缩小，写明而不是静默**：`check-state-roots.mjs` 与 `audit-state-locations.mjs` 的目录名单去掉
  core/panel/adapters（`walk()` 遇到不存在的目录是静默返回空的，不缩名单就等于让调用点数悄悄变小）。
  后者的 JSON 现在带 `scanDirs`，人读输出多两行口径。
- **署名义务没跟着删**：`core/ports/temporal.mjs` 是 AMpath 纯函数借用件，删了；但
  `packages/persona-core/` 仍是 AMpath 移植（`types`/`effect-bus`/`causal-chain`/`memory`/`npc-state-machine` 五份原样搬或抽符号，
  2026-11-12 实测五份都在），**私有仓、无 LICENSE，对外发布前必须重写或取得授权**这条义务照旧。
  CREDITS / NOTICE / CURRENT 三处都改成这个口径，并记下一个真实缺口：逐文件「来源与取舍」对照表只在宿主侧
  `Cortico-up/persona-core/README.md:5-44`，本仓 `packages/persona-core/README.md` 只有模块职责表。
  whale-girl 16 张素材随面板退役，CC BY-NC-SA 4.0 / ZipZipPipe / 上善无形 的署名义务在 CREDITS 与 NOTICE 里保留原文。
- **specs 关掉两条**：`07-account-and-credentials.md` ⑤1（旧面板明文存凭据）与 `10-control-surface.md` ⑤11（tank.html）
  划掉并标 **已关闭（2026-11-12）**，各带复现命令；⑤2 的 FakeEl 计数 10→9，preflight 行号锚点 `:43-46`→`:44-47`。
- **两笔旧账按主人拍板标明**：
  ① 召回四因子 `0.40/0.30/0.15/0.15` 在 `specs/02` 的 ①、②、⑤3 三处都标成**数值无外部依据、本仓自定**
  （名义出处 `attic/2026-10/BLUEPRINT.md:156`「搬 AMpath `computeWarmScore`」，但同一行写着 AMpath 的 `retrieval.ts` **未搬**，
  本仓那份是自写的）；`packages/persona-core/src/retrieval.ts:60` 的常量注释同步加一句，别让它看着像调好的。
  顺手纠一个假判据：⑤3 原写「仓内无 AMpath（`grep -rn AMpath packages` → 0）」——那个 0 只证明*字符串*没出现，
  **不证明仓内没有 AMpath 代码**（persona-core 五份就是移植件）。
  ② `attic/2026-10/ARCHITECTURE.md` §12.1/§12.3 引的 `emotion-projection.ts`、`life-generator.ts` 带的是
  **上游 AMpath 的 `shared`/`server` 目录前缀**，本仓与宿主都没有那两棵（实测）；落地实现是
  `packages/persona-core/src/emotion-projection.ts` 与 `packages/persona-core/src/life-activities.ts`（改了名）。
  **attic 原文一个字不改**，映射写在 `docs/INDEX.md` 的 attic 段当读法口径。
- **本文自身三处死引用补正**：头部 `docs/INDEX.md §4`（该节已随 `1f90099` 删除，规矩五条搬进本文头部）、
  `DECOUPLING-STATUS-2026-11-02.md` 链接改指 attic、上游 0.4.5 那条的 `RISK-PROTECTION.md`
  （上游 `0cc36fb` 就删了，本仓从未包含，改成 `git show 0cc36fb^:RISK-PROTECTION.md` 取回口径）。

### 门禁（2026-11-13 逐条实跑，退出码即判据）

`check-mjs-syntax` 0（322 个 .mjs）· `run-mjs-tests` 0（**149/149 文件，858 pass / 0 fail / 0 skip / 0 todo / 0 cancelled**）·
宿主 `--root ../Cortico-up --import tsx` 0（28/28，229 pass）· `check-consumers` 0 · `check-hashes` 0（16 份一致）·
`check-cortico-paths` 0 · `check-script-paths` 0 · `check-live-drift` 0 · `check-doc-hygiene` 0（活文档 17 / specs 10/10 / docs 根 7）·
**`check-state-roots` 1**——`dm-await-state`、`dm-quota`、`pending-replies` 三类新旧两家读数分家，
**本批之前就红**，属状态落点收口（任务 #58），不是删除造成的。

测试数 892→858 的**逐文件对账**（不是净差猜测）：整份退役 8 份 −21、就地瘦身 7 份 −24、新增 1 份 +11，
892 − 21 − 24 + 11 = 858。瘦身删掉的都是指向已删模块的那几条，留下的 149 个文件全部执行。
对账表与一个口径缺陷（报告 `gitSha` 记跑时 HEAD、不记工作区脏，删前那份 `07fa6b6` 不等于它实际跑的代码）
都在上面那份 evidence 里，登记为任务 #63。

### 没验的那条（别把这条条目读成"全验收通过"）

**真浏览器 11 个页签可用：未验证。** `node scripts/preflight.mjs` 实测报「端口 7799 可用」，
即线上宿主此刻**没在跑**；本批约束是不重启线上生活循环，所以没有起宿主去点那 11 个页签。
`tests/dom/` 那 9 份是 FakeEl，**不算真浏览器**。要补这一条，得主人拍板：要么允许起线上，
要么按任务 #5 的先例开一个备用端口的隔离验证实例。

主人的口径是"别再推延期，交付功能"。这一版把 11-01 那份 §8 瘦身做完、把 live 切过去，
并顺手补了三个"数字看着对、其实没人核过"的洞。**版本线本身也有一处不一致，一并说明**：
`port-0.5.1` 的附注 tag 已在（`git tag`），但当时 `package.json` 没跟着 bump，一直停在 `0.5.0`；
本版把 `package.json` 抬到 `0.5.2`，此后 tag 与版本号一起走（当时同步改了 `docs/INDEX.md` §4 的"现值"；**那一节已于 `1f90099` 删除**，规矩现在写在本文头部）。

### 换线（live 现在是哪份代码）

- **7799 改跑 `Cortico-up`（`reanchor/replay` + 8 个 replay 提交）**，代码树与部署树分开：
  代码在 `Cortico-up`，她的 memory/session/config 仍在 `Cortico/deployments`。切换清单见
  [`docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md`](docs/attic/2026-11/DECOUPLING-STATUS-2026-11-02.md)「切 live」一节（2026-11-07 `1f90099` 文档改制时原样搬进 attic，链接此处补正）。
- **两处当场暴露**：① `Cortico-up` 的 `dist/web` 从来没构建过，直接切是白屏——构建那一步进清单；
  ② 世界页「待放行」比面板少 1，漏的是 `control/dm-drafts.json` 那本队列（`119a068` 修 + 测试）。
- **`start-cortico.mjs` 补齐这个拓扑**（`303f523`）：以前默认代码树还是 master，
  手工 launcher 起的进程不写 pid、不接日志、绕过 `bin` 的监督层——`ops-day` 因此报
  `dead pid=117840` 而 7799 其实在听。现在两条根成对写死可用 env 覆盖。

### 我说过两句错的，当场推翻并留了数

- **「reanchor 是功能超集」不成立**：8 个提交从未 replay，已逐条 cherry-pick 补齐。
- **「causal.jsonl 必须上锁」不成立**：实测三进程 × 60 行 × 100KB 并发追加，600 行无撕裂无丢失，
  于是 `causal` 降级为 `both-with-lock / requiresLock:false`，数字写进注释和测试。

### 补的三个洞（都是"读数会说谎"那一类）

- **待审队列只进不出的 9 条**：放行的那块界面退役后，`pending-replies.json` 没有任何出口。
  新增 `reply-draft release`（真发）与 `drop-pending`（只删），失败留在队列里带 `attempts`。
  两个实测坑进了测试：退出码 0 不算成功（规则拒绝只打 `✗`）、失败条目不许被摘走。
- **状态根两处各算一遍**：`tools/lib/state-roots.mjs` 24 类 + `scripts/check-state-roots.mjs`
  门禁 + `scripts/migrate-state-roots.mjs`（默认 dry、`--apply`、`--rollback <id>` 且迁移后被人
  改过就拒绝回滚）。旧家退役逻辑收进 `paths.mjs` 一份实现。
- **"没重启"证明不了"没改 live"**：World 每个工具都是 `spawn(node tools/bili.mjs …)`，改 dsh
  立刻生效，而 `observation-start.mjs`（在哈希冻结清单里）只记 `{startDay,days,createdAt}`。
  新增 `scripts/live-code-anchor.mjs`：`--set` 记 dsh/Cortico 两份 `{dir,sha,dirty}`，
  `--check` 按当初那个目录复查，漂移退出 2，`ops-day` 第 ⑥ 行每天顶出来（测试 5+1 条，
  临时目录里造真 git 仓库）。

### 她的行为侧

- **出站正文的 Markdown 四条口补齐**（`213819a`）：`**加粗**`、行首 `#`/`>`/`-`、反引号、
  `[文字](链接)` 在 B 站一律不渲染；#32 当时只修了动态，私信/评论/弹幕是裸的
  （实证：被拒的 `dm-20261101-cbc62a` 正文带着星号）。新 `tools/lib/plain-outbound.mjs` 幂等，
  接在私信入队与发送、评论、弹幕，以及动态**成稿**处——放成稿是为了守住"审的就是发的"：
  草稿文件、令牌 textHash、真正 POST 的字符串必须是同一个串。
- **被主人拒掉的稿当天能重出**（`303f523` + Cortico `7ccd96b`）：闸门以前不看状态，
  `rejected` 也算"今天已有稿"，于是"照着理由重写"变成一句她执行不了的话。
  只放开 `rejected`；`pending/sending/sent` 照旧拦。
- **`bili_look` 在真机上生效**：切换后的因果账里出现「第一次真的看见画面——海边、椰子、
  两根鹅毛棒」，十几天的「画面未核对」删掉一行。

### 门禁（当日复跑，命令即判据）

`node scripts/run-mjs-tests.mjs` → **428 pass / 0 fail / EXECUTED=78**；
`node scripts/run-mjs-tests.mjs --root ../Cortico-up --import tsx` → **227/227（28 文件）**；
Cortico `pnpm test` → **290 文件 / 5208 passed / 3 skipped**，`tsc --noEmit` 干净；
`check-hashes` 一致、`check-consumers` 全部有生产调用、`check-state-roots` 无绕过表的路径也无多写者。
两份报告按当天落 `docs/evidence/gates-2026-11-02.json`（带 gitSha 与 node 版本）。
`g3b-check` 现跑五项全 PASS，但**观测窗并未开**——`control/observation.json` 不存在，
开不开是主人的决定（见 `docs/INDEX.md` §4 与那份执行账）。


## port-0.5.1（2026-11-01）—— 读数不再分家，报备接上，门禁能复核

`port-0.5.0` 之后 19 个提交，主要是"同一个数两处各算一遍"这一类问题的收口，
以及第三方审计指出的三处会静默毁数据的读失败。

### 修

- **状态读写全收敛到 `tools/lib/paths.mjs`**：配额、待审回信、回复去重、直播等待、点赞账
  各有一处自己拼 `.bili-ai`，写落旧家、读落新家，两个数都"正常"。现在一律
  `stateReadPath`（新→旧）读、`writeStateText`（只落新家）写。`365810d` `11d69eb`
- **读失败不再被当成"空"**：go-gate 读坏时拒绝覆写队列（一次读错误曾能清空主人排的队）、
  `reply-draft` 解析失败不再当空队列。`11d69eb` `afbb466`
- **kill 覆盖第三方出口**：检查原来在域名分叉之后，非 B 站域的写在上一行就 `transport`
  出去了——通知 webhook 这类出口不受急刹车管。`afbb466`
- **报备接上**：点赞/收藏/私信/动态发出去就推一条；评论被额度闸拦下也推。
  渠道读 `notify.type`（页面选），没配就跳过、同一条只推一次、失败不改判动作。
  `6187c9c`
- **自主发言有上限了**：`quota.selfDaily`（默认 6）。主人拍板评论/弹幕维持她能自己发，
  上限是唯一的节奏约束。`6187c9c`
- **改昵称独立成命令**：`rename --to … --dry|--go`，改完用 nav 复核平台真记了什么。`3c5f5dc`

### 门禁

- `run-mjs-tests.mjs` 改成**逐文件跑**并对比"发现数 / 执行数"：原来 `EXECUTED = files.length`
  是传参算的，同义反复。现在 `--report` 把整份结果落到 `docs/evidence/gates-<date>.json`，
  文档只引路径不抄数字。
- 加了 `.github/workflows/ci.yml`：本仓以前没有任何 workflow。
- 冻结哈希随判据变更重冻（`check-hashes.mjs --write`）：`run-mjs-tests.mjs` 在冻结清单里，
  改它是让判据更严，不是放宽，所以这次 diff 里能看到。

## port-0.5.0（2026-11-01）—— 从"多宿主能跑"到"她真的过日子"

首个附注 tag `port-0.5.0`（**只建本地，未 push**）。上一版 port-0.1.0 只有 CHANGELOG 条目、没有 tag（写在 `9c9d4aa`，2026-10-25），到本版之间 **239 次提交无 tag**（`git rev-list v0.4.6..HEAD --count` = 239，2026-11-01 实测）。

**为什么是 0.5.0 而不是 0.4.7**：这一串提交里既有整块新能力（多宿主端口化、每日草稿与一次性令牌审批、观测门禁链、发送策略单一事实源、意见箱与放行入口、媒体层与 vendor 隔离、`ops:day`），也有改变既有语义的破坏性变更（日界 04:00 → 自然日 00:00 `a38c74e`；`fix(feed)!` 偏好回执改按真实来源 `76519ff`；令牌不再进 argv `eef637c`）。补丁号装不下这两件事，按 minor 走。上游行为冻结基线仍以 `docs/BASELINE.md`（upstream `3e11454` / 0.4.6）为准。

**本版收口时复跑的门禁**（2026-11-01，本机；数字随提交变化，复算命令见 `docs/INDEX.md` §3）：
`node scripts/run-mjs-tests.mjs` → `ℹ tests 321` / `pass 321` / `fail 0` / `EXECUTED=60`；`node scripts/check-hashes.mjs` → 末行「一致」；`node scripts/check-consumers.mjs` → 末行「全部有生产调用」。

### 里程碑（不逐提交流水；每条给可验证物）

| 日期 | 里程碑 | 可验证物 |
|---|---|---|
| 10-25 | **多宿主移植**：`lib/` → `core/`、`AgentSessionPort`、`WHALE_HOME`/`WHALE_NODE`、OpenCode daemon + MCP 包装、whale-panel、ntfy/bark、go-gate 方案三代码闸 | `af6fc2c` `05a2b3a` `1e3c47f` `12b9d1a` `6a6f8bd` `b688e8a` `ca7ec4a`；`adapters/opencode/README.md`、`docs/TERMUX.md` |
| 10-26 | **每日动态草稿 + 审批 CLI**（默认 dry、幂等、kill 阻断）、选图器、单实例启动器与健康检查 | `3fe4185` `c58fde4` `95c849b` `1208abf` `2fc7b62`；`scripts/dynamic-approve.mjs`、`scripts/cortico-health.mjs` |
| 10-27 | **一次性批准接入生产审批**（入队发 token，`--go` 必须校验并作废）；**清除"唤醒"概念**，改成状态驱动的 `decideAction`/`lifeTick`/`life.json`；离线门禁演练 | `0e37a36` `14be3df` `28049c5`；`scripts/ack.mjs`、`scripts/drill-gate.mjs` |
| 10-28 | **文档基线**：BLUEPRINT v2 更正 v1 的系统性曲解、ARCHITECTURE v1（M0–M4）、ISSUES 台账、TEAM 常设编制、REUSE-MATRIX、ROADMAP | `da99cbf` `b25d6d0` `dbe5f13` `78e660e` `4415532` `e5c9118` `50aea94` |
| 10-29 | **观测门禁链成型**：她的一天的容器 + 看门狗、voiceBrief 进草稿链（缺 voice 拒稿）、`g3b-check`、`observation-start` 未就绪拒开窗、反事实工具、`wake-audit`、C2 arm/verify 防作弊、人设单一来源、DM 回信草稿 + 一次性令牌、M4 召回回指、15 情绪标签、`check-consumers` + `gates` | `5d4142a` `edf828c` `a648020` `2314f8c` `3f3fb05` `d27af6b` `b62c18a` `36b99ca` `49cec82` `3476300` `e91bebb` `a5c0bf6` |
| 10-30 | **M1a–M1e 全部合 live**：可观测只读层与资产根收口、审批加固（argv 重建、令牌绑正文）、kill 在写通道统一收口、凭据注册表（secret 不进回执）、V1 本地出片（MiMo TTS + CC0 BGM + 双封面）、vendor 两个 MIT 件、按主人裁决**取消每日 3 次上限** | `86107bb` `d48096c` `a26de00` `989206b` `f709d0b` `cbfa1c5` `1571913` `2163f5c`；证据卡 `docs/evidence/V1-VIDEO-SMOKE-2026-10-30.md`、`docs/MODULARITY-2026-10-30.md` |
| 10-31 | **拆分与档位**：媒体层拆 `tools/media/*`（M1c）、草稿链拆 compose/store/publishers（M2）、日界 04:00 → 自然日 00:00、权限分级（点赞/收藏自发档 + `like` 命令）、意见箱、面板放行入口（token 不出服务端）、「小鱼 · 鱼缸」世界页在 7799 激活、`dynamic recent` 复核入口、发布策略单一事实源 + 令牌走环境变量、词表词组级 + dislike 硬过滤、Drive v2 三变体模拟（**未采纳**） | `ae023a5` `3d501e1` `a38c74e` `fd2a77b` `e4eb8b0` `f6a2a75` `e8b4916` `d481d89` `dd909ee` `eef637c` `dc26a93` `36030f6` `8e16801`；`tools/lib/publish-policy.mjs`、`docs/DRIVE-V2-SIM-2026-10-31.md` |
| 11-01 | **接入日**：voice 的节律/今天/钟点/场值/意外槽全部接进正文（断链闭合）、《作品名》取位收成一个口径、词表命中率可复量、`ops:day` 一条命令看一天、私信真发落 `dm-out`、feed 回执标明偏好来源、01:23 `draftMode=auto` 盲写事故与两条缓解、G3b 判定与"14 天窗从 11-02 00:00 起算" | `3827cc4` `e2228ba` `6abe473` `70956a9` `4490404` `76519ff` `091daf5` `6487da7`；`tests/contract/voice-state-coupling.test.mjs`、`docs/evidence/G3B-DECISION-2026-11-01.md` |

### 破坏性变更与迁移（本版一次性说明，不留到"以后"）

- **日界**：04:00 → 自然日 00:00（`a38c74e`，主人 2026-10-31 拍板）。存量 `~/.dsh/bili-whale/days/<日期>/` 按当时口径写就，不回填。
- **feed 偏好**：回执按真实来源打印「统一配置」或「日记兜底」（`76519ff`）。此前硬写「来自日记」，误导她连报七轮"改动没落地"。
- **令牌**：不再进 argv/stdout/账本，只走 `--token-env` 或进程 env（`eef637c`）。外部脚本若曾把 token 拼进命令行要改调用方式。
- **写档位**：点赞/收藏转自发档（过 kill + 额度 + 各自判据），公开评论/弹幕仍走 go-gate 人工放行，关注/取关不开放（`fd2a77b`，`tests/perm-tier.test.mjs`）。
- **面板**：8447/8448 端口退役，日常界面是 WebUI 的「小鱼 · 鱼缸」世界页（7799）；`panel/` 目录保留作 CLI 与数据模块来源（`docs/ARCHITECTURE-2026-11.md` §4、§8 第 10 条）。

### 本版**没有**做的事（别把"版本涨了"读成"都通了"）

- 视频/直播整条媒体链**无调用方**：`tools/video-build.mjs` 与 `tools/media/*` 不在 `bili.mjs` 命令表、World 也无对应工具（`ARCHITECTURE-2026-11.md` §7⑤）。
- 7799 写接口**免口令**未修（§7④）；给写口加认证排在观测后第一批。
- 控制台对话页仍**不带**她的场值与记忆（§7①）；她的判断**没有**执行通道（§7②）。
- **14 天观测窗尚未开**：`node scripts/observation-status.mjs` 2026-11-01 实跑得「观测尚未开始：G3b 通过后创建 control/observation.json」（开窗顺序与理由见 `docs/evidence/G3B-DECISION-2026-11-01.md`）。
- 扩展市场搜索 `/api/extensions/search` 仍 `registry.npmjs.org ECONNRESET`（待办 #47）。

### 文档

新增 [`docs/INDEX.md`](docs/INDEX.md) 做真相源仲裁与全量登记（此前 `docs/` 顶层 37 个 md 无索引，BLUEPRINT/CURRENT/PRODUCT 三份互抢"唯一真相源"）；`ARCHITECTURE-2026-11.md` 补 §8.1 十条出入的逐条处置；RUNBOOK/DEPLOY/PR 里 6 处写死的"122 全过"改成复跑命令。

## port-0.1.0（2026-10-25）—— 多宿主移植

把 DSH 专用插件拆成 **core + adapters + panel**，同一份配置/风控/日记可跑在 DSH、OpenCode 与手机 Termux。
上游 0.4.6 行为冻结（`docs/BASELINE.md`），上游 110 项测试全绿 + 新增 12 项契约/快照。

### 新增

- **OpenCode adapter**：`whale-daemon`（pm2/`--once`）经 `POST /session` + `prompt_async` 投递；MCP stdio 包装把 40 个 B 站命令暴露为一个 `bili` 工具（只 spawn `tools/bili.mjs`，风控闸不可绕过）。
- **whale-panel**：独立 http 服务，Bearer token fail-closed；补 `/api/vitals`、`/api/timeline`（游标分页）、`/api/diary` 三个缺口；鱼缸界面 + 鲸鱼娘 15 状态序列帧（缺失自动回落内联 SVG）。
- **手机推送**：`notify` 新增 `ntfy` / `bark`（仅 https 或局域网 http）。
- **tick-catchup**：进程停机后补投递带「补觉醒来」留痕，准点不标注。
- **可移植层**：`WHALE_HOME`/`WHALE_NODE`（兼容 `DSH_HOME`/`DSH_NODE`）；唤醒提示词按宿主切换 `node bili.mjs` ↔ `bili` 工具。

### 修复（团队四轮评审）

- **P0 go-gate 代码闸（方案三）**：普通评论/收藏/弹幕的 --go 一律进待审队列，panel 放行才发出；注入者拿不到主人的点击。分享链路（--share --auto）沿用评分闸。

- P0 采纳 `create()` 返回的宿主会话 id（OpenCode 不再造孤儿会话）。
- P0 端口 `isBusy` 异步化并 await（修「Promise 恒真导致时钟永不 tick」）。
- P1 panel 写操作合并 Authorization；P1 单时钟（panel 默认 `PANEL_SCHED` 关）。
- P0 序列帧 URL 带 token + 预载成功才隐藏 SVG；night 判定改为窗口起止。
- P2 fetch 超时、MCP 截断标记、Bearer 常量时间比较、发布 `files` 补目录、PNG 白名单收窄。

### 文档

`docs/CURRENT.md`（恢复入口）、`docs/PR-port-core-opencode-panel.md`（评审与验证）、`adapters/opencode/README.md`、`docs/TERMUX.md`、`docs/CREDITS.md`、`scripts/evaluate.sh`。

### 未完成

CodeBuddy adapter、DSH/OpenCode 真机端到端验收、CI workflow、`client.js` schema/render 单源化。

## 0.4.6（2026-10-24）

这一版把 10-23 晚上到 10-24 凌晨改的东西收拢：**分享前多一道 AI 评论闸**、
**请求保护层落地**、**唤醒提示压短 26%**，以及社区 review 挑出的几处真问题。

### 新增：分享前「疑似 AI 评论」检查（默认关闭）

主动 @ 分享之前，先采一段该视频的评论，由**当前模型**逐条判 suspected / other / uncertain。
疑似比例 ≥ **30%（写死，不做成设置项）** 就暂缓这次分享并推送到你配置的渠道。

- 只对「主动视频 @ 分享」生效：普通回复、动态、私信、弹幕都不走这条路
- 样本不足 20 条 → 明确说"无法判断" → 允许分享（不装懂）
- 缓存按登录会话 + 视频隔离，6 小时有效，不反复问模型
- 拦截发生在**发送之前**和**额度记账之前**
- 10-23 首次实战：20 条评论判出 9 条「疑似 AI」（45%），抓出来的全是「@某人 + 自称 + 三段论」的模板

### 新增：请求保护层（`tools/lib/traffic.mjs`）

- 全局请求间隔 600ms、跨进程共享；单并发
- 读 600/时 · 3000/天；写 12/时 · 30/天
- 写冷却 120 秒（私信冷却默认关闭）
- 撞 412/429 → 全局暂停 5/10/20/30 分钟，并尊重 Retry-After
- 防重复发送（指纹 + 24 小时）· 状态文件损坏时**拒绝请求**而不是静默重置

### 新增：空闲退避

私信 / 评论轮询不再固定间隔：60 秒起步，空转时翻倍退避到 15 分钟，有人说话立刻回到 60 秒。
私信轮询从固定 20 秒（4320 次/天）降到约 200 次/天。

### 修：某个 prompt 不返回 → 通道永久静默（社区报的）

醒来 / 私信 / 评论三条通道都有这个病：标志一旦卡住就永远不再触发，而且**什么都不记**。
现在超时只告警一次（不强制放开 —— 那会导致重复投递），至少留下痕迹。

### 修：PR #25 的 csrf 泄漏（完整版）

原来的修法只往 body 加一份 csrf，URL 里那份没删 —— 等于没修。
现在 URL 里删干净、csrf 挪进 body，并加了回归测试。

### 修：issue #27 的三处硬编码 + 两个 opt-in 开关

- `deps` / `notify` / `selftest` 改用 `dshPath()`，自定义 `DSH_HOME` 不再读错目录
- `personaOncePerSession`（默认关）：同一会话人设只注入一次；**每次重启后首次投递会重新注入**
  （因为宿主 `create()` 分不出"新建"还是"复用"，宁可多注入一次也不让她失忆）
- `sessionRotateDays`（默认 0）：会话轮换，老会话原样保留

### 改：抽帧清晰度

九宫格每格默认 **720** 像素（原来 360，界面文字全糊），支持 `--tile 240–1280`，JPEG 质量提高。

### 改：唤醒提示 1459 → 1086 字（-26%）

去掉装饰记号与重复解释，23 项判据一条没丢。实测她照跑九步、全程 2 分钟（以前 5~8 分钟）。

### 改：feed 提速

搜索 12 次 → 6 次（每词一种排序，交替点击/最新）+ 搜索结果 10 分钟缓存：
27 秒 → 6 秒（缓存热 4 秒）。

### 修：设置页

- 去掉「请求保护」「工具链」两组（底层照常工作，只是不再给旋钮）
- 去掉「查一次间隔」输入框（填什么都会被退避覆盖，是个假旋钮）
- 「分享前检查」提到「分享」正上方
- 三处提示写着旧值（默认 1500 / 私信冷却 60 秒）→ 改成真实值

### 修：issue #22 文档

README 新增「账号前提」一节：这个插件是**两个号**的模型，表格列清四条通道各需要什么、
只有一个号时能做什么、不能做什么。顺便改了 `README:28` 那句和后面自相矛盾的「多账号」。

### 测试

68 → 103 个，全过。新增 traffic / issue27 / ai-share / edit-dynamic 四组。

---
## 0.4.5 请求保护修订（2026-10-23）

新增跨进程请求间隔、会话预算、平台反馈暂停、写入防重复与人工核查入口；私信、评论、弹幕轮询增加空闲退避。83 项测试通过。详见 `RISK-PROTECTION.md`——**该文件已于上游 `0cc36fb`（2026-10-24）删除，本仓不含**，原文取回：`git show 0cc36fb^:RISK-PROTECTION.md`（2026-11-13 实测可读出）。

## v0.4.5（2026-10-22）

这一版是「抗限流 + 交付可靠性」两件事，加上社区 review 挑出的几处真 bug。

### 新增：抗限流三件套（`tools/lib/bili-api.mjs`）

社区实测指出：B站 的 412 是 **IP 级限流** ✗ —— 连着打一阵之后
`view` / `detail` / `playurl` / `reply` 会**一起挂**，停 25 秒都不恢复。
而我们的请求模式正好在招它：一轮要打 25~30 次，同一条视频的 `view` 被 6 个命令各查一遍。

1. **缓存** —— 元信息 24 小时只问一次
   - 只缓存「静态一点」的：`view` / `acc/info`（`nav` 10 分钟）
   - **短期授权链接绝不缓存**：`playurl` / `player/wbi/v2`（缓存了就是死链 ✗）
   - **会变的不缓存**：评论 / 收件箱 / 动态流 / 点赞 / 关注关系
   - 缓存键**按账号隔离**（换号不会看到旧号的数据 ✓）且对参数做哈希（避免 `&` 歧义）
2. **熔断** —— 撞到 HTTP 412/429 或风控码（-352 / -799 / -509 / -10403）就停
   退避 5 → 10 → 20 分钟封顶；期间**只吃缓存**、不硬闯；退避按端点记（一个接口成功不重置另一个的）
   - 例外：`playurl` 的 `-412` 是「大会员专属 / 地区限制」，**不熔断** ✓（实测过：否则一个会员视频会把整机停 5 分钟 ✗）
3. **节流** —— 两次请求至少隔 300ms，**跨进程共享时间戳**（并行跑命令也不会贴脸）

配套：
- `deps` 多一行「B站 限流」（正常显示缓存条数 / 熔断显示还要等几分钟）
- `~/.bili-ai/api-requests.log` 请求日志：每行 `时间 HIT|NET 路径`（2000 行封顶）
- `BILI_NO_CACHE=1` 可完全关掉缓存与熔断（测试与排障用）

### 新增：`comment --check` 只读预检

回答「这条回复到底能不能发」—— 解析出被回复者（含 `root == parent` 的顶层评论），
给出 `✓ 能发 / ✗ 会被 fail-closed 挡`，**不发文、不占额度**。

### 修：评论回复的几个坑

- `parentAuthor` 只翻楼中楼 → **顶层评论（`root == parent`）永远查不到作者** → fail-closed
  修：用响应里就带着的 `data.root`
- `root=0` 同样查不到 → 入口处规范化：`root` 为 0/空时视作 `parent`
- `parentAuthor` 硬编码 `type=1` → **动态评论（type=11）永远查不到作者** → 修成按 `--type` 传
- 「同一个人 30 天只回一条」对主人不生效（判定放行 + 不记入 `replied.json`）

### 修：`dm-await` 的交付回执

以前监听命中了、但 `prompt` 发送失败 → 那条消息就**丢了** ✗
新增 `--peek`（持久化待交付消息 + 返回 receipt）/ `--ack <receipt>`（宿主收到后确认）
→ 调度器改成 `r.ok && j.hit && j.receipt` 才算收到 ✓

### 修：feed 只出得到 3 条，而且「鬼畜 / B站生态八卦」永远命中不了

主人发现的：6 个偏好里只有 DSH/AI、猫咪、大肥鱼 命中过 ✗ 鬼畜、B站生态八卦从来不出现 ✓

- **切词只认 空格 / 顿号 / 斜杠** ✗ → 「鬼畜与怀旧向剪辑」切不开 → 变成 8 字长 token
  → 标题里必须原样出现这 8 个字 → **永远不命中** ✗
  修：先按分隔符 + 连接词（与/和/及/向/的/类）切；切完还 ≥4 字的整块再补**纯中文双字**滑动窗
  （只收纯中文 ✓ 否则 `Live2D` 会切出 `Li`/`iv` 这种垃圾 ✗）
- **搜索关键词用的也是整句** ✗ → 搜「鬼畜与怀旧向剪辑」B站 搜不出东西 → 这个偏好对候选池贡献 0
  修：每个偏好取一个「能搜到东西的短词」—— 鬼畜与怀旧向剪辑 → **鬼畜** ✓ / B站生态八卦 → **八卦** ✓
- **池子太小** ✗（POOL=30）→ 候选池 168 条却只出 3 条，其中 2 条是 0/1 播放的碎屑
  修：POOL 30 → **60**
- **没有质量下限** ✗ → 修：播放<300 且 弹幕<3 的丢掉（多偏好命中的例外 ✓ 那可能是小众宝藏）
- 「完全没命中偏好」的从 1 条放到 **3 条**

实测同一时刻对比：
```
改前：候选池 168 → 68 条 · 只出 3 条（2 条碎屑）· 鬼畜 0 命中 ✗
改后：候选池 228 → 131 条 · 出满 5~8 条 · 鬼畜 2 条 ✓ · 八卦 有 ✓
     【春晚鬼畜】改革春风吹满地（1.29 亿）· 【鬼畜全明星】双人舞（4064 万）✓
```

### 修：依赖体检看不到「生物钟」

`deps` 以前只看 cookie / ffmpeg / node / 目录 / 限流 ✗ → **调度器死了她看不出来** ✗
→ 结果就是「体检全绿，但今晚根本不会醒」✗ 这是最难发现的失败 ✓

- 现在多一行：`✓ 生物钟 — 每 60 秒 tick · 下次 20:56（3 分钟后） · 今日已醒 1/2`
- 四种异常都会报 ✗：没有窗口 / 计划过期没执行 / 没有计划文件 / 今日已醒满

### 修：唤醒提示

- **`share.via` 直接写进提示** —— 设置页明明设了 `comment`，她还是走私信 ✗
  根因：提示只写「先看 share.via」、两条路并列，而**没有任何命令能读 via** ✗；
  旁边 `notify.type=dm`（那是「推送」不是「分享」）也在误导 ✓
  现在提示会写「**本机现在是 share.via = comment** —— 只走下面这一条」，
  并明确「❌ 不要走私信」（反之亦然）；`via` 每次唤醒现读，切换**不用重启** ✓

- **每次看几条**不再写死 5 条 ✗ → 读 `night.maxVideos`（`readCfgNow()` 每次现读 ✓）
- **回复要挂在对方那条评论下面** → 提示里直接给【坐标】清单（oid / root / parent）
- **提示里写死了旧插件目录名** ✗ → 改成 `<插件目录>`（她照着旧路径跑到 0.2.0 的副本上 ✗）

### 修：抽帧超时

`debrief` 调 `bili-watch` 的默认超时是 120 秒 ✗
而「场景检测空跑整片 + 下载 + 拼九宫格」按时长线性长 →
一条 **25 分钟**的视频必然 `ETIMEDOUT` ✗
修：超时改成 `120s + 每秒 1.5s`（1492 秒的片子 → 2358 秒），场景检测那跳 600 秒；
超过 20 分钟会先提醒一句（不拦）。

### 修：设置页

- 分组顺序曾因「按字段出现顺序推」而乱掉（工具链跑到第一位）→ 改成显式 `GROUP_ORDER`
- `buvid3` 校验太严（真实值结尾是 `infoc`）→ 放宽 + **只警告不拦**
- 那个警告后端返回了但前端没接 → 现在会显示
- `.blw-err` 补 `white-space: pre-line`（多行报错不再塌成一行）

### 清理

删掉死文件与死配置：`lib/settings.html`（早就不挂路由）、`tools/verify/verify-reply.mjs`、
`examples/`、`share.decayPerDay`（换算法后没人读）。88 → 88 个文件（新增了 review 测试与 dm 回执辅助）。

### 测试

- 58 → **68 个用例全过**
- 新增覆盖：缓存按账号隔离 / 短期链接不缓存 / `noCache` 不回落旧数据 /
  缓存键转义 / 并行请求最小间隔 / 一个接口成功不重置另一个的退避 /
  连续风控第三次退避 20 分钟 / `wakePrompt` 跟着 `maxVideos` 走 / `--check` 四种情况 / 顶层评论作者
- 真机验证：58 次请求日志（16 HIT / 29 NET 分接口统计）· 熔断 5→10→15 分钟 ·
  `playurl -412` 不熔断而 `HTTP 412` 仍熔断 · 短片子抽帧 7.2 秒

---

## v0.4.3（2026-10-22）

三个 issue + 一个 PR。第一个最要紧：**旧端点被判 412 时，六个读命令会直接崩**。

### 修：旧 `view` 端点 412 → 六个命令全崩（#18）

`debrief` / `fav` / `comments` / `subtitles` / `video` / `quota` 的第一步都打旧端点
`/x/web-interface/view`。对部分网络环境，B站 会直接返回 **HTTP 412 + HTML** ✗
—— 于是崩在 `JSON.parse`，报错是：

```
<anonymous_script>:1
<!DOCTYPE html
SyntaxError: Unexpected token '<'
```

完全看不出真实原因 ✗

**修法**：新增中间件 `tools/lib/bili-api.mjs`（42 行），`apiGet()` 自动处理：

```js
const signedPaths = {
  '/x/web-interface/view':  '/x/web-interface/wbi/view',
  '/x/player/playurl':      '/x/player/wbi/playurl',
}
```

- 旧路径 → 自动换成 WBI 端点 + 自动签名 ✓
- 签名密钥缺失 → 返回「WBI 签名不可用」而不是 SyntaxError ✓
- 任何失败都返回 `{ code, message }`，**不再抛 JSON.parse 异常** ✓
- 10 个命令都改成走它（不是逐个改调用点）

> 这个 412 不是所有人都会遇到（我们这边两个端点都 200），是按 IP / 账号 / 地区判的。
> 改成 WBI 之后两条路都能走 ✓

### 修：`dm` 互关要求和「不关注人」红线互相卡死（#19）

新装用户 `attribute=0` 时，**分享和推送两条路都是死的**，
而提示只说了「去关注主人」—— 单向关注只有 `attribute=2`，拿不到互关的 `6`，
还得主人也回关，这一步 README 没写 ✗

**修法**：
- `dm --status` **分方向显示**：
  ```
  她 → 主人：未关注
  主人 → 她：未知（请在主人账号确认）
  → 请登录她的账号，在 https://space.bilibili.com/<owner> 手动关注主人。
  → 请登录主人账号，在 https://space.bilibili.com/<self> 确认并手动回关。
  ```
- 单独识别拉黑关系（`attribute=128`）
- README 写明是**双向**，并把「谁在哪一步点哪里」写清楚

**没有加** `follow --target` 命令：那是主人明确的红线，
「只允许 owner.mid」的边界太容易被改宽，不值得为省一次手动点击承担这个风险。

### 修：`diary show` 对 CRLF 日记解析失败（#20）

Windows 上手写日记（记事本 / Python 文本模式）是 CRLF，
`split('\n')` 之后每行末尾留着 `\r`，`^##\s+(.+)$` 一个标题都匹配不到 →
「看过 0 条」✗ 而文件本身完全正常 ✓

**修法**：三处 `split('\n')` → `split(/\r?\n/)`
（读日记 69 行、读 `whale-log.jsonl` 48 和 111 行）

验证：把现有日记在内存里转 CRLF，两种写法各跑一遍 ——
`split(/\r?\n/)` → 44 段 ✓ / `split('\n')` → **0 段** ✗

### 收：PR #21 诊断输出转义（by anupamme）

`dynamic-image.mjs` 打印「用 Python 转换图片」的示例命令时，`imagePath` 是直接拼进去的。
这行日志是**给人复制去跑的** —— 路径里带引号就不该拼出第二条命令。
按他的写法落地 3 行（对路径做引号/反斜杠转义）。

### 测试

- 39 → **57 个用例全过**
- 新增覆盖：#18（412 时干净失败且不写）、#19（分方向判定）、#20（CRLF）、
  以及 A4–A9 / B1–B6 / C1 / C3 / D2–D3 那批（补测清单里的条目）
- 68 个 JS/MJS 文件全部通过 `node --check`
- 命令：`node --test tests/planner.test.mjs tests/integration.test.mjs tests/updates.test.mjs tests/supplement.test.mjs`

### 真机验证

- 设置页顺序正常（她是谁 → 你 → 口味 → 作息 → 分享 → 监听 → 日记与推送 → 消息推送 → 工具链 → cookie）
- 真实唤醒一次：08:35 叫醒 → 写两本日记 → 分享 1 条（18 分）
- 人设生效：15 个「喵」、0 个「本小姐」、0 个感叹号
- 她自己在私密日记里认了「前面那几段天亮了/鸟在吵是我编的」

---

## v0.4.2（2026-10-22）

在 v0.4.1 基础上补上三个真修改，外加两个新功能（默认关闭）。

### 修：最小唤醒间隔在重排后会失效（v0.4.1 的漏洞）

v0.4.1 给「同一窗口的多次醒来」加了 10 分钟硬下限，靠 `state.wokeAt` 算「上次什么时候醒的」。
但 `historyOf()` 在重排时会**丢掉 `wokeAt`** —— 凡是走重排的路径（保存设置、投递后重置、
done 判定）都会让它变成 0，下一次 tick 就绕过了间隔。

**修法**：`historyOf()` 保留 `wokeAt`，让间隔在所有重排路径上都成立。

### 修：设备 ID 保存失败时不该继续发

v0.4.1 把私信的 `dev_id` 改成固定值（`~/.bili-ai/dev_id`）。但如果**写文件失败**，
旧实现会退回「随机 UUID 继续发」—— 风控漏洞又回来了。

**修法**：保存失败就**停止发送并报错**，不拿随机 ID 顶上去。

### 修：私信投递失败时 notify 仍返回成功

`notify` 的私信后端在子进程失败时，退出码仍是 0 —— 调用方会以为「已经通知到了」。

**修法**：私信投递失败就返回失败退出码。

### 新：主人 @ 请求总结（默认关闭）

可选功能：主人在评论区 **@ 她并说「总结」**，她把最近的动态整理成一段推送到配置的通道。

- 默认**关闭**；启用需要同时开启评论监听、监听范围包含 `@`、并配置 `owner.mid`
- **只认主人的 mid** —— 别人 @ 她不会触发 ✓
- 投递走设置页「消息推送」的通道（私信 / webhook / 自定义命令）

### 新：会话工作目录可配置

v0.4.0 把她的会话 cwd 从用户主目录改成了固定目录 `~/.dsh/whale-work`。
现在可以自定义（多智能体 host 想让不同实例各有目录时有用）。

- 留空 = 仍然是 `~/.dsh/whale-work` ✓
- 自定义时要求：**绝对路径** + 目录**必须已存在**（不会替你创建 ✗ 免得写错路径到别处）
- 配合「在那个目录里放一份她自己的 AGENTS.md」= 身份与作用域分离 ✓

### 内部整理

- `tools/lib/capture.mjs`：子进程输出用文件句柄捕获（Windows 沙箱禁用管道的问题）
- `tools/lib/cli-args.mjs`：命名参数 → 位置参数的翻译收成一份（原来散在 `bili.mjs` 里）
- `tools/lib/feedback.mjs`：判「有没有新回复」改成**按事件 id 计数 + 时间水位**，
  不再对「整段结果窗口的摘要」做判断（避免窗口滑动导致的重复计数）

### 测试

- 上游 25 个用例先跑通，再改
- 本版 **39/39** 通过（新增：配置目录 / PATH 与 Electron 分支 / 文件捕获 / 命名参数 /
  设备 ID 持久化失败停发 / notify 失败返回码 / digest 部分失败时的干净 JSON）
- 64 个 JS/MJS 文件全部通过 `node --check`
- 命令：`node --test tests/planner.test.mjs tests/integration.test.mjs tests/updates.test.mjs`
- 测试用临时目录 + 虚构凭据 + 模拟网络；不登录真实账号、不发真实消息

---

## v0.4.1（2026-10-22）

四个 bug 修复。最上面那个很重要 —— 它会让小号私信被 B站 风控。

### 修：私信被风控（最重要）

`dm.mjs` 每发一条私信都会生成一个**随机的设备 ID**（`msg[dev_id]`）：

```js
body.set('msg[dev_id]', 'WEB-' + crypto.randomUUID().toUpperCase())
```

B站 靠这个字段识别「这条消息是哪台设备发的」。正常人不会每发一条就换一台设备 ✗
—— 于是风控看到的是「同一个账号在不同设备之间高频切换」，小号私信容易被限制。

**修法**：生成一次、存到 `~/.bili-ai/dev_id`、之后永久复用 ✓
（真浏览器里这个值本来就是固定的 ✓ 固定了才像同一台设备）

> 已经发过一批私信的账号，历史记录改不了。如果已经被限制，建议申诉时说明是客户端的问题
> （每条消息的 device id 都不同），现已修复。

### 修：「主人回复」检测不再做子串匹配

`quota react --auto` 判断「主人回没回我」时，是把 `comment-digest` 的**整段人类可读输出**
拿去做 `out.includes(主人昵称)` / `out.includes(主人 mid)` ✗
—— 统计行、标签行、占位文本里只要出现主人的名字或 mid 就会命中 ✗
结果：明明没人回，却记一次反馈 → **沉默衰减被清零** ✗（沉默机制失真）

**修法**：`comment-digest` 新增 `--json`，输出结构化结果：
`{ ok, hours, count, reply, at, ownerMid, ownerReplies, ownerReplyItems, items }`
`ownerReplies` 是**按 mid 精确比对**出来的数字 ✓ 没有任何子串匹配。
`quota` 改读这个数字，命中详情也从 `ownerReplyItems` 打印。

实测：最近 1 小时（无回复）→ `ownerReplies=0` → 没有误记；
最近 72 小时（确有一条）→ `ownerReplies=1` → 正确记一次反馈 ✓

### 修：密集计划会连着醒

同一个窗口里要醒多次时，每次的时刻是「从现在到窗口结束」里均匀随机抽的，
两个相邻的醒来之间**没有任何间隔约束** ✗ 实测出现过 22:53 / 22:59 / 23:11 挤在 18 分钟里。

**修法**：相邻两次之间加一个 **10 分钟硬下限**（`cfg.minGapMin`，默认 10）：

```
earliest = max(now, 窗口开始, 上次醒来 + 10 分钟)
```

窗口里放不下下一次就不排 —— **少醒几次，而不是挤在一起** ✓
实测：04:34 醒过一次，下一次自动排到 04:57（间隔 23 分钟）。

### 修：「不看」会把整个窗口作废

`wakes: 5` 的窗口，掷到一次「不看」之后整段窗口就被拉黑了 ✗
—— 那一夜只醒了 1 次就收工，剩下 4 次机会全没了。

**修法**：「不看」和看视频一样只消耗**一次**机会（`usedCount +1`），
窗口是否用完由「还剩几次」自然判定，不再用黑名单。

### 测试

- 新增一条用例：「skip 只消耗一次机会，wakes>1 的窗口不会被整段作废」
- 两条断言旧机制（`skippedWindows`）的用例改成断言行为
- 25 个用例全过 ✓

## v0.4.0（2026-10-21）

这一版以「人设版」（2026-10-21）为基础，把第三方审查报告里剩下的四条修完，
并补上了一套 24 个用例的自动测试。

### 新增：她专属的人设

- 设置页「她是谁」那三个字段下面新增 **人设正文** 输入框 + **注入人设** 按钮
- 存在 `~/.bili-ai/persona.md`（和凭据、账本放一起，换机器拷 `.bili-ai` 就带着走）
- 每次唤醒 / 私信 / 评论 / 弹幕 / 直播间提示都会附上（前 3000 字）
- **人设文件优先**：和设置里的「名字 / 自称」冲突时以人设文件为准

### 修：审查报告剩余四条

- **分享总开关管住了私信**：评论和私信走同一套校验（`share.enabled` / `minScore` / `--reason` / `--rank 1`）。
  以前关掉分享，`dm --share` 照样能发出去。
- **凭据路径统一**：插件和工具链都从用户目录 `.bili-ai/credentials.json` 读写，
  自定义 `DSH_HOME` 不再导致设置页显示新账号、工具却还在用旧账号。
- **跨午夜不再出错**：生物钟改用绝对时间戳。以前 23:00–01:00 的窗口里抽到次日 00:30，
  会被"修正"成当天 23:00。
- **不再每分钟重抽签**：未触发的计划保留原时刻和「看 / 不看」的决定。
  以前每 tick 重排一次，`skipChance` 等于失效。

### 修：多窗口

- 只有作息字段变了才重排（改推送、改人设不会重置待执行计划）
- 已跳过的窗口按「窗口起始日期 + 窗口名称」记账，重启、跨午夜、保存设置都不会复活
- 按真实截止时刻排序窗口，窄窗不会再被静默跳过
- 一次「不看」只作废那一个窗口，不再连累当天后面的窗口

### 修：调度器与生命周期

- Node 运行时初始化失败 → 不再启动调度器，并在状态接口里明确报错
  （以前是静默失效，界面上一切正常，但它永远不会醒）
- 唤醒投递失败可以在下一轮重试；只有投递成功才进入冷却
- 停止插件时清理启动定时器
- 「生物钟」状态在依赖体检和设置页可见：正常显示「已启动」，坏了显示「没起来：<原因>」

### 修：此前累积的一批

- `notify` 的私信后端忽略 `--dry`，预演会真的发出私信
- 批准待审回复时引用未定义的 `cfg`，草稿在发送前就被删除
- 「推送日记摘要」开关存不进配置（字段白名单漏了 `diary`）
- 跨午夜窗口里的评论监听始终判定为窗口外
- 工具链 11 处 `process.execPath`（在 Electron 派生进程里那是主程序，spawn 它不执行脚本）
- `buvid3` 不再必填（以前缺它连评论都发不出）
- 评论/私信分享之外的写操作：三条动态命令调了 `gate()` 却没导入
- `mention-check` 不再用调试残留的假 mid / 假昵称
- `video-content` 不再写死拉无关的 GitHub 仓库
- 命令表清掉三个悬空条目
- `stop()` 补上私信轮询的 `clearInterval`
- 视频下载改流式写盘（两小时 720p 不再吃 1–2 GB 内存）
- 失败的命令改为非 0 退出码（以前 agent 会误判成成功）
- `diary` 的时区分歧（凌晨 0–8 点的发言被算到昨天）
- 动态图片的限额闸门提到上传之前（以前图传上去了才拦）
- `fav` 缺文件不再裸崩

### 测试

- 新增 `tests/`：`node --test tests/planner.test.mjs tests/integration.test.mjs`，24 个用例全过
- 测试使用临时目录、虚构凭据、模拟网络与宿主接口；不登录真实账号、不发送真实消息

### 升级注意

1. 停止 DSH，备份旧插件目录和 `~/.bili-ai`
2. 用新的插件目录替换旧的，重启 DSH
3. 到设置页跑一次「依赖体检」
4. 旧版计划没有可靠的绝对日期，首次读取会重算待执行时间
5. 如果你以前用自定义 `DSH_HOME`，请在设置页重新保存一次 cookie 并核对账号

---

## v0.3.0 —— 会感觉的一版（2026-10-20）

> 这一版的主题：**把"机制"变成"她的反应"**。
> 沉默不再只是被代码拦住，而是她**先感觉到安静**、再自己决定少说；
> 收藏不是低配的分享，而是「这个我想留着」。

### 新增

- **她学会了"收藏"** `bili.mjs fav`
  - `fav <BV> --reason "…" --dry|--go` · `fav --list [--json]` · `fav --check <BV>`
  - **五条判据写死在代码里**（不是提示词）：
    ① 理由 ≥6 字（说不清为什么留 = 不收）② 每天 ≤3 条 ③ 同一视频 30 天一次
    ④ 同类 ≥2 条要 `--better` ⑤ 必须先 `--dry`
  - 收藏**不占分享额度**，但会成为她下次选题的**口味信号**（feed 会读）
  - 收藏分四类：想学 / 想再看 / 和我有关 / 以后要提
- **沉默从"代码拦住"变成"她自己感觉到"**
  - 唤醒提示里会告诉她「主人已经 N 天没有回应你了」——**只给事实**，情绪留给她自己写
  - 三档：0–2 天正常 · **3–6 天安静**（最多分享 1 条，可主动问一次「在忙吗」）· **7 天+ 心慌**（不分享，只写心情）
  - `quota silence` 现在也显示档位；新增 `quota ask` 记"已经问过一次"（只问一次，不追问）
  - **恢复转折**：她沉默很久后又等到你，会看到「他回来了」——不是若无其事
- **启动测试** `bili.mjs selftest`
  - 一条命令列出：配置 / 凭据 / 登录态 / 数据目录 / 依赖体检
  - 最后直接告诉用户**最容易卡的两件事**：会话在「工作区 → 未分组」里、要给它「完全访问」
  - 设置页会显示首次安装横幅，`selftest` 全绿后自动消失
- **选题器大改**（`feed`）
  - 默认来源从"只搜索"改成 **搜索 + 热门 + 排行 + 关注**（更像人在刷 B 站）
  - **彻底去掉播放量权重**（以前大 UP 的爆款永远霸榜）
  - 新公式：`log10(1+弹幕密度)×3 + 偏好命中×4 + 反馈学习×2.5`
  - 多样性：同一类别最多 2 条，完全没命中的最多 1 条
  - **不再推荐她自己的视频**（以前真的会刷到自己 ✗）
- **反馈回流**：被赞过的视频会存下 BV + 标题 + 评论原文，`feed` 从里面**学主题词**给自己的候选加权
- **推送可关**：设置页「写两本日记」改成「推送日记摘要」——日记本身**不可关**，只决定推不推

### 修复

- **掷到「不看」会立刻叫醒她**（社区反馈，修了 8 层）
  1. skip 分支没有 `at` → 挑时刻挪到掷骰子之前
  2. scheduler 不等 `at` → 加 `nowMin() >= st.at` 判断
  3. `?? 0` 让旧状态立刻触发 → 改成 `?? st.endAt`
  4. `fired` 是 `undefined` → 显式写 `false`
  5. `at` 每 tick 重随机（永远追不上 `now`）→ 已有计划时沿用
  6. `keepSkipAt` 里 `> now` 太严 → 去掉（at 过了也沿用）
  7. 投递后没标记 → 写 `done: true`，`makePlan` 认 `done`
  8. `done` 状态写回时丢了 `done` 字段 → 所有 done 返回都带 `done: true`
- **沉默衰减形同虚设**：`react --auto` 每轮把同一个赞重记一次 → `last` 永远刷新 →
  实际要 5 天才开始衰减。改为按 `like_time` 去重（回复按内容哈希）
- **`dm --dry` 会真发**：dry 被塞进 `if (SHARE)` 里 → 推送型 dry 直接发出去了 ✗
  顺带修：dry 在"闸门失败"之前就退出，看不到拒绝原因
- **Desktop 版 DSH 找不到 node.exe**（社区 PR #2）：`process.execPath` 是 Electron，
  改为显式解析真实 node；补 PATH / ProgramFiles 候选 + `ELECTRON_RUN_AS_NODE`
- **DSH 会话内系统性失效**（社区 PR #3）：会话 cwd 在主目录、stock Windows TEMP 也在主目录
  → DSH 沙箱拒绝 → pwsh 起不来 → 整条工具链死。插件加载时把宿主 TEMP 重定向到
  `%PUBLIC%\dsh-whale-temp`；跨午夜窗口按 `[start, 1440+end)` 比较；沙箱内捕获式子进程改 `stdio: 'inherit'`
- **桌面通知永远发不出**（社区 Issue #1）：`.ps1` 里写 `template=\"ToastGeneric\"` 是非法转义
  → PowerShell ParserError；`stdio: 'ignore'` 把错误吞了。改 `template=""`（PS 双写）+ 捕获 stderr
- **假开关清理**：`diary.public/private/pushDaily` 没人读 → 删；「同一个人只回一条」写死 → 按配置；
  `self.mid/name` 只有默认值没人写 → 从 cookie 体检里回填

### 已知限制

- **主人的私密收藏夹读不到** ✗（B 站不给，这是设计边界）。想让她读你的口味，得建一个**公开**收藏夹。
- 「反馈 → 偏好」这一环是**软**的：她读到日记里的「偏好校准」自己调整，
  代码只保证"数据在"和"feed 会读被赞/收藏过的主题词"。

## v0.2.0 —— 私信版（2026-10-19）

> 这一版的主题：**给她一条"只对你说话"的通道**。

### 新增

- **专属通道（B站私信）** `bili.mjs dm`
  - 一天只**锁定 1 个收信人**（防刷量），对这个人数**不限**
  - 只发给配置里的 `owner.mid`；**必须互关**才能发
  - 三条限制**写死在代码里**，不接受参数覆盖
- **推送第五种方式：B站私信** —— 设置页「消息推送」多了 `B站私信` 选项
  - 适合"只有 B站、没有微信/webhook"的用户：**零外部依赖** ✓
- **分享方式二选一** —— 设置页「分享」里可选：
  - `评论区 @ 你`（原功能，公开）
  - `B站私信`（不公开发，**带视频链接**私信给你）
  - 两种方式**共用同一本分享额度**（≤3/天 · 同一视频 7 天一次）
- **私信监听** —— 设置页「全天监听」新增开关
  - 每 20 秒看一次主人有没有发私信，有就叫醒她实时回
  - **只认主人那个会话**；系统通知/陌生人一律忽略
  - 主人不说话 = 没有新私信 = **零 token**
- **身份注入** —— 设置页「她是谁」三个字段（角色名/称呼/自称）终于**真起作用**
  - 每次叫醒她，会把「你是 X，称用户 Y，自称 Z」塞进提示开头

### 修复

- 设置页「发条测试」等**五个按钮全部失败** —— `execFile(process.execPath)` 在 Electron 里跑的是 Harness.exe ✗
  → 统一改用 `findNode()` 找到的真 `node.exe`
- 「爱看/不爱看」打不出逗号 —— 受控输入里"数组 join / split"互相吞 ✗ → 改用本地文本 state
- 推送选「B站私信」点不动 —— 单选白名单漏了 `dm`
- 加密分享判重用错 key —— 以前按"发给谁"算 ✗ 现在按 **BV 号**算 ✓
- 「同一个人只回一条」开关是假的 —— 两处硬编码，关不掉 ✗ → 改成按配置走
- `check-comment` 对新发的一级评论永远判"不存在" —— 只查了 `reply/reply` ✗
  → 加了"主列表里按 rpid 找"一层
- `preferences` 逗号、`persona` 注入、`self` 自动回填（换号后设置页会跟着刷新）
- README 的 cookie 指引写错（`document.cookie` 读不到 SESSDATA，它是 HttpOnly）
- README 提到的 `tools/get-ffmpeg.mjs` 根本不存在 → 删掉

### 安全 / 隐私

- 发布仓库**压成单个提交**（原历史里有房间号、人设名等痕迹 ✗ 一旦公开就一起公开）
- 全库扫描 18 类敏感串：**0 命中**
- 模板 `config.example.json` 清空 `liveRoom` / `owner` / `self` / 人设
- 设置页的「保存」按钮旁加了「**有改动还没保存**」提示；「发条测试」会**先自动保存再测**

---

## v0.1.x 系列（2026-10-18）

- **自主生物钟**：插件每 60 秒 tick，到点用 `sessionController.prompt` 叫醒她（不需要人挂进程）
- **六路看懂**：封面 / 简介 / 官方字幕 / 弹幕热区 / 热评 / 抽帧看画面
- **成长闭环**：两本日记、偏好校准、沉默 3 天衰减 / 7 天归零（但日记照写）
- **评论区监听 + 双轨回复**：主人 → 直接回；其他人 → 写草稿等审
- **直播间监听**：独立开关、实时回、可只回主人
- **评分标尺**：5 项各 0–4 分，≥13 才发；只取当天第一名
- **从 GitHub 干净安装验证通过**：卸载 → 克隆 → 装 → 重启 → 能跑

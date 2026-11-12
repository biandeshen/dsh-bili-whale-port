# 10 · 控制面总则

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。
> 这份是其余九份面板条目的对齐尺：**"页面上有"不等于"代码在读"**。

## ① 现在是什么

一个面板要走五层才出现在浏览器里：

```
能力包 panels() 声明            packages/persona-core/src/capability.ts:101-106（面板）/ :92-99（方法：verb + writable）
  ↓ 契约校验                    capability.ts:134-165（:145 只校验 configSchema 是 object；:156-162 强制"每面板至少一个 POST writable"）
world/bot 包浏览器端注册表      packages/cortico-world-bilibili/src/webui/client.ts:15-23（5 块）
                                packages/cortico-bot-xiaoyu/src/webui/client.ts:13-22（6 块合成一个 bundle）
  ↓ 服务端转接                  packages/cortico-adapter/src/index.ts:107-122（GET 方法白名单 :113-120）、:127-146（找不到面板/方法给可读错误）
宿主路由                        E:/WorkSpace_Qoder/Cortico-up/src/web/server.ts:2361-2390（invoke）、:2397-2406（**args 必须是数组**）、:2408-2409
  ↓                             src/web/webui-pages.ts:312-339（GET 只放 panel.getMethods 点名的方法）
前端渲染                        src/web/client/webui-pages/loader.ts:85（import 产物）→ :121-127（`bundle.panels[panelId]` 缺则报错卡）
                                src/web/client/webui-pages/host.ts:240-298（选面板 :271、`impl.mount` :294）、:217-231（**失败隔离成错误卡**）
```

三件套（busy / confirm / 失败可见）全在 `actionButton` 一处实现：`packages/cortico-adapter/src/webui-helpers.ts:103-189`。
控件普查（逐文件 `grep -c`，范围 `packages/cap-*/src/webui/client.ts`；world/bot 的注册表文件是纯组装、0 控件）：

| 类别 | 数量 | 分布 |
|---|---|---|
| `actionButton` | **50** | bilibili 22 · memory 13 · journal 5 · state-rhythm 5 · vision 3 · media 2 |
| 裸 `ui.button` | **7** | 全在 `packages/cap-journal/src/webui/client.ts` |
| `ui.input` / `ui.select` / `ui.textarea` / `ui.checkbox` / `sliderField` | 23 / 5 / 7 / 4 / 4 | 见同上口径 |
| **合计可点/可填控件** | **100** | — |

服务端侧同一口径数出来：**12 面板 / 53 方法 / 31 个 `writable`**（`grep -c "verb: '"`、`grep -c "writable: true"` 逐包相加）。

## ② 真值在哪

| 参数 | 定义与读取点 | 配置键 | 面板/宿主位置 |
|---|---|---|---|
| `writable` | 声明 `capability.ts:92-99`；读点 `packages/cortico-adapter/src/index.ts:113-120`（GET 白名单） | 无 | 宿主 `webui-pages.ts:322-327` |
| `mutatesState` | 声明在各能力包工具里；读点 `packages/cortico-adapter/src/index.ts:73`（打 `act`/`read` 标签）、`:77`（写路径旁路去重） | 无 | 无（标签本身不上面板） |
| `busyLabel` | `webui-helpers.ts:103-189`（`:137-143` 换文案并 disable） | 无 | 按钮自身 |
| `argsFactory` | `webui-helpers.ts:163-166`（点击时才算参数，算错也 catch） | 无 | 按钮自身 |
| `preRun` | `webui-helpers.ts:155-158`（返回一句话=中止但照样进消息行） | 无 | 按钮自身 |
| `after` | `webui-helpers.ts:175`（拿返回值做局部更新） | 无 | 按钮自身 |
| `configGroups` | 本仓声明 `packages/cortico-bot-xiaoyu/src/cortico-definition.ts:114-119`（＋ `memory-config.ts`、`tick-config.ts`、`context-config.ts`）；宿主收拢 `Cortico-up/src/bot.ts:938-947`、校验 `src/extensions/dry-mount.ts:422-425`、渲染 `webui-pages/host.ts:400-402` | 宿主 `config.json` | 宿主「配置」页 |
| `x-hot` | 宿主唯一消费者 `src/web/client/features/config/view.ts:589`、`:621-628`（false → 打"需重启"标） | 无 | 只作用于 configGroups |
| `webUiClient` | 构建时写入/删除 `scripts/build-webui.mjs:85-87`（扩展包）、`:90-92`（能力包删键） | 包 `package.json` | 宿主按 `EXTENSION_ASSET_PREFIX` 发（`src/extensions/manifest.ts:213-221`） |
| `cache`（产物不可变） | 宿主 `src/web/server.ts:2500-2511`（`maxAge:'1y', immutable:true`，注释 `:2498`"换版本即换 URL"） | 无 | URL 里的版本号段 |
| `cost`（当日读数） | `packages/cap-state-rhythm/src/cost-today.ts:51`、`costSummary :121`；挂进 day 面板 `packages/cap-state-rhythm/src/index.ts:545-551`；前端照抄 `packages/cap-state-rhythm/src/webui/client.ts:403-407` | 无 | 「她的一天」 |

## ③ 失败与边界

- **找不到面板/方法给的是可读错误**，不是 500 空响应（`packages/cortico-adapter/src/index.ts:138`、`:142`）。
- **面板 mount 抛错被宿主隔离成错误卡**（`webui-pages/host.ts:217-231`）——一屏坏不会带崩整站，但**也不会有人主动告诉你**：它只在页内。
- **`args` 不是数组直接被宿主拒**（`web/server.ts:2401-2404`），`call()` 已经把对象包成 `[obj]`（`webui-helpers.ts:80`）——绕过 `call()` 自己发请求的地方要自己守这条。
- **失败不被自己的刷新擦掉**：`actionButton` 先存失败、`after` 跑完再回写消息行（`webui-helpers.ts:144-148`、`:177-180`；注释记的是 2026-11-04 真浏览器踩坑）。
- **`ok:false` 当失败显示**，不当成功（`webui-helpers.ts:168-170`）。
- **取消 = 这屏无事发生**：confirm 在清消息行**之前**（`:152-153`）。
- **不污染 ②**：面板方法是现读服务端状态，页面上没有"改了没落"的中间态——除了滑块类控件在保存前的值只存在于 DOM（见 ⑤ 第 1 条 vision 的重跑坑）。

## ④ 操作面

主人：宿主 WebUI 的「小鱼 · 鱼缸」世界页与「配置」「存储」页；能力包面板 12 块。
**发布前置（硬性，不是建议）**：改过任何面板客户端源码（各包的 `packages/cap-*/src/webui/client.ts`）→ 必须 `node scripts/build-webui.mjs`（内容哈希写进版本 patch 位，`scripts/build-webui.mjs:79-84`）→ **重启宿主**（版本在启动期读进 `webUiAssets`，`Cortico-up/src/extensions.ts:313-322`）→ 浏览器拿到的是新 URL；
漏掉任一步，`immutable` 缓存（`web/server.ts:2500-2511`）会让页面继续用旧 bundle，表现就是**面板空白或行为与源码不符**。
这一条今天只能靠 `node scripts/check-live-drift.mjs` 手动跑（第 3 节 `:223-265` 比的是 import 闭包 mtime，`:264` 产物比源码旧即 bad）。
`npm run gates` 从 2026-11-07 起末尾多了一条 `node scripts/check-doc-hygiene.mjs`（`package.json` 的 `gates`）——文档违规会直接把整批验收变红。
**只有 CLI**：待放行队列批量放行（见 06 ⑤ 第 10 条）；`node scripts/audit-controls.mjs` 是控件普查入口，不是操作入口。

### 回滚：出问题退回哪个人格、用哪条命令、数据在哪（2026-11-12 落盘）

以前这份计划只存在于 `scripts/start-cortico.mjs` 的注释里，而注释不是回滚计划。现在写在这。

**退回谁**：部署名 `mybot`、代码包 `cormini` —— 2026-11-04 搬家**之前**那个人格。**不是**线上的 `xiaoyu`（`cortico-bot-xiaoyu` + 能力包）。

**数据在哪**（都不在任何 git 树里，凭据跟着数据走、不进仓）：

| 东西 | 落点 | 核对 |
|---|---|---|
| 回滚部署根 | `~/.xiaoyu-home/rollback/deployments/{mybot,providers}` | 703 文件 / 187 目录，逐文件 sha256 与源全等 |
| 会话与记忆 | 同上 `mybot/data/`（682 文件，含 `runs/r-*/transcript.jsonl`） | 同上 |
| 人设两文件 | 同上 `mybot/prompts/ORIENTATION.md`、`mybot/workspace/CONSTITUTION.md` | 同上 |
| 端点凭据 | 同上 `providers/{mimo,opencode-go}/.env` | 同上（**永不进仓、永不进备份包**） |
| 哈希清单 | `~/.xiaoyu-home/rollback/rollback-manifest.json`（私有） | 由核对脚本生成 |
| 旧克隆独占的扩展包 | `~/.xiaoyu-home/rollback-extensions/`（4 包 + `fflate`，157 文件） | 逐文件 sha256 核过；见下面「前置」 |
| 每日备份里的旧人格档案 | 包内前缀仍是 `cortico/deployments/mybot/…`，恢复时落回上面的回滚部署根 | `scripts/ops-backup.mjs` 的 `roots.cortico` 取回滚根的上一级 |

**宿主代码树在哪**：只认 `CORTICO_ROOT`（进程环境）或本仓 `.env`，**没有硬默认**，缺了就明确报错 —— `scripts/lib/host-root.mjs` 是唯一答案，门禁 `scripts/check-cortico-paths.mjs` 禁止任何脚本再指向第二宿主克隆。回滚点位置同理：`XIAOYU_ROLLBACK_ROOT` 可覆盖，缺省即上表。

**命令（按顺序，前两条只读）**：

1. 核对回滚点没被改坏（只读，写一份私有清单）：
   `node scripts/verify-rollback-point.mjs --src=<源部署根>` → 退出 0 才算全等；`--dest` 缺省取 `rollbackRoot()`。
2. 只读演练：宿主能不能装载这个人格（**不起进程、不占端口、不投事件**）。在宿主检出目录里跑：
   `CORTICO_HOME=C:/Users/Administrator/.xiaoyu-home/rollback/deployments node --import tsx src/launcher.ts --list` → 应只打印 `mybot`；
   同环境 `--json` → 该部署 `bot=cormini`、`displayName=小鱼`、**无 `problem` 字段**。
3. 真回滚（**会接管 7799 与同一个 pid 文件，所以必须先停线上实例**）：
   `CORTICO_HOME=C:/Users/Administrator/.xiaoyu-home/rollback/deployments CORTICO_BOT=mybot node scripts/start-cortico.mjs`
4. 回滚后想再回来：停掉回滚实例，`node scripts/start-cortico.mjs`（缺省即 `~/.xiaoyu-home` + `xiaoyu`）。
5. 档案恢复（默认 dry，只报告会覆盖/新建哪些）：`node scripts/ops-backup.mjs --restore <备份目录>`；加 `--apply` 才写盘，写前当前状态另存到 `<备份根>/pre-restore-<ts>/`。

**前置（不补就会缺一块能力）**：回滚配置启用 `bili-account` 与 `selfkit` 两个世界（`figure`/`pet-diary` 是 `enabled:false`）。
`bili-account` 由 live 宿主已装的 `cortico-world-bilibili` 提供；`selfkit` 来自扩展包 `cortico-world-selfkit-alont1`，**live 宿主没装** —— 不补装会报 `World: selfkit 不可用`（宿主对缺世界是非致命的：收集进 `missing[]` 继续跑，但那一块能力就是没有）。
保留件在 `~/.xiaoyu-home/rollback-extensions/`；这 5 个包都是 npm 上 MIT 发布的、且在宿主 `extensions/market-catalog.json` 里，所以也可以重装而不是用保留件。**补装这一步没验证过。**

**已经验证过的 / 没验证过的（别把前者当后者）**：见 ⑤ 第 12 条。

## ⑤ 已知缺陷与验证方式

1. **"设计落地率"这类百分比不写进本仓文档**（它不可复现）；可复现的是控件与方法的对账：**100 个控件 / 50 个 `actionButton` / 7 个裸按钮 / 53 个方法（31 writable）**。
   复现（自己数一遍）：
   `for p in cap-bilibili cap-journal cap-media-studio cap-memory cap-state-rhythm cap-vision; do f=packages/$p/src/webui/client.ts; [ -f $f ] && echo "$p AB=$(grep -c 'actionButton(' $f) BTN=$(grep -c 'ui\.button(' $f) INPUT=$(grep -c 'ui\.input(' $f) SELECT=$(grep -c 'ui\.select(' $f) TA=$(grep -c 'ui\.textarea(' $f) CHK=$(grep -c 'ui\.checkbox(' $f) SL=$(grep -c 'sliderField(' $f)"; done`
   注意 `scripts/audit-controls.mjs` 报的是 10 面板 / 45 方法 / 27 writable：差值来自它对 `methods: panelMethods`（`packages/cap-vision/src/index.ts:471` 变量间接引用）与 journal `feedback-triage` 的解析盲区，**该脚本自己在 `:16-17`、`:264` 已声明正则口径不可全信**。
2. **真浏览器测试实际 0 个**：`tests/dom/` 那 9 个跑的是自建 `FakeEl`（定义 `tests/helpers/panel-harness.mjs:14-99`，`isConnected` 是为脏守卫专门补的 `:77-85`）。
   （2026-11-12 校准：原为 10 个，第 10 个 `tank-smoke` 用 `node:vm` 跑旧面板的 tank.html，随旧面板整棵树一起删除。）
   复现：`grep -rn "playwright\|puppeteer\|chrome-devtools\|jsdom" package.json tests scripts | wc -l` → 0；`ls tests/dom | wc -l` → 9。
   弱断言现存样本（渲染对了也测不出内容错）：`tests/dom/memory-history-rollback.test.mjs:67`、`:155`、`:173` 只断 `!textContent.includes('undefined')`；
   `tests/dom/b13d-ui-fixes.test.mjs:172`、`tests/dom/her-day-panel.test.mjs:213`、`:231` 靠 placeholder 文案子串定位控件——**文案一改测试即瞎**。
   复现：`grep -rn "includes('undefined')" tests/dom | wc -l`。
3. **`configSchema` 与 `x-hot` 双绝缘**：能力包里 12+ 处 `x-hot` 标注（如 `packages/cap-bilibili/src/index.ts:388-406`）**没有任何消费方**；
   宿主全文 grep `configSchema` 0 命中，`x-hot` 只作用于 configGroups（`Cortico-up/src/web/client/features/config/view.ts:589`、`:621-628`）。
   后果：面板上"热生效"的承诺在契约里没有实现路径。复现：`grep -rn "configSchema" E:/WorkSpace_Qoder/Cortico-up/src | wc -l` → 0。
4. **空旋钮两只（新发现，本轮只登记）**：`cap-journal` 的 `defaultPageBudgetChars`/`defaultDaysPerPage`（`packages/cap-journal/src/index.ts:272-286`）
   有 schema 有 `x-hot`，但 `getDiary` 硬编码 `days:7 / budget:8000`（`:489-491`）；`cap-state-rhythm` 的
   `checkIntervalMinMinutes`/`checkIntervalMaxMinutes`/`defaultMode`（`:311-334`）全包内除类型声明 `:108-110` 与 defaultConfig `:337-339` 外无读取点，
   真实节拍在 `packages/cortico-bot-xiaoyu/src/tick-config.ts:20`、`:46`。复现：`node scripts/check-doc-hygiene.mjs`（R3 只抓 specs ② 里点名的，这两只等被写进 ② 时才会被抓——所以 04 与 01 的 ② 不列它们，见本条）。
5. **脏守卫还有两块面板整块裸奔 + checkbox 全灭**：`tankPanel`（`packages/cap-state-rhythm/src/webui/client.ts:112`）与
   `journalBoardPanel`（`packages/cap-journal/src/webui/client.ts:15`）没有 `createDirtyGuard`；
   `webui-helpers.ts:241` 的 `watch()` 只支持 `{value}` 字符串比较，**4 个 checkbox（vision `:179`、bilibili `:860`、memory `:254`、journal `:229`）天然在守卫盲区**。
   复现：`grep -c "createDirtyGuard" packages/cap-state-rhythm/src/webui/client.ts packages/cap-journal/src/webui/client.ts`（前者只在 dayPanel 出现，后者 0）。
6. **有 `writable` 方法、页面无入口**：`composePrompt`（`packages/cap-media-studio/src/index.ts:373-377`）。复现：`grep -c composePrompt packages/cap-media-studio/src/webui/client.ts` → 0。
7. **死 helper 与死 import**：`textField`（`webui-helpers.ts:363-371`）全仓 0 调用，但 `packages/cap-memory/src/webui/client.ts:8` 仍 import 它。
   复现：`grep -rn "textField(" packages/*/src/webui/client.ts | wc -l` → 0。
8. **审计工具的四条 R5 全是假阳性**：`setTuning`/`cleanupSheets`/`rerun` 真实存在于 `packages/cap-vision/src/index.ts:386/:420/:442`，
   `replyFeedback` 在 `packages/cap-journal/src/index.ts:187-188`。把它当缺陷清单用之前先复核（本轮已复核）。复现：`node scripts/audit-controls.mjs | grep R5`。
9. **新队列逐条放行的设计是对的，但"批量"这个词在面板里不存在**：全仓 `releaseAll`/`批量` 只出现在注释里
   （`packages/cap-bilibili/src/webui/client.ts:285`、`packages/cap-bilibili/src/domain/write-gate.ts:309`、`:465`——那两处防的是"主人随手全放"把过期稿放飞）。
   复现：`grep -rn "releaseAll\|releaseMany" packages/cap-bilibili/src | wc -l` → 0；逐条放行的入口在 `packages/cap-bilibili/src/webui/client.ts:336`。
10. **`call()` 无 busy**：只有 `actionButton` 有重入闸门（`webui-helpers.ts:127`、`:131-143`），`call()`（`:72-88`）没有——
    面板里所有"非按钮触发"的调用（下拉即改、翻页）连点会并发打服务端。复现：`sed -n '72,88p' packages/cortico-adapter/src/webui-helpers.ts`（看函数体内无 running 标志）。
11. ~~旧面板体系与 Cortico 契约并行~~ **已关闭（2026-11-12）**：旧独立面板（8447/8448 的 server.js 与 views/tank.html）
    曾与 Cortico 面板契约并行存在于仓内，属契约外的渲染面。整棵 `panel/` 树连同它的冒烟测试已删除，
    现在仓内只有能力包 `webui/client.ts` 这一套渲染面。删除清单见 [`legacy-refs-2026-11-12.md`](../evidence/legacy-refs-2026-11-12.md)。
    复现：`git ls-files panel | wc -l` → 0；`grep -rn "tank.html" tests scripts packages | wc -l` → 0。
12. **回滚只做过只读演练，没真起过那个人格**（2026-11-12，④ 的回滚计划配套）。
    已验证：703 文件 / 187 目录逐文件 sha256 与源全等；宿主 `--list` 只打印 `mybot`、`--json` 报 `bot=cormini` 且**无 `problem`**；线上部署根 `--list` 仍只有 `xiaoyu`（回滚容器没污染线上 listing）。
    **没验证**：真起进程、模型调用、B 站读写、`selfkit` 扩展补装、7799 与 pid 文件的交接。所以"回滚可用"目前只成立到"宿主装载得起来"这一层。
    另：保留件 `cortico-world-figure` 装载探针失败（`fflate` 解析不到），但它在回滚配置里 `enabled:false`，不阻塞回滚。
    复现：`node scripts/verify-rollback-point.mjs --src=<源部署根>`（退出 0 才算全等）；`node scripts/check-cortico-paths.mjs`（退出 0）；`node --test tests/cortico-paths.test.mjs`（8 条，其中 4 条是故意违规必须判红）。
13. **线上人格的对话全文不在每日备份里**（本轮只登记）：`scripts/ops-backup.mjs` 的目录源只有回滚点那条 `mybot/data/runs`，线上 `~/.xiaoyu-home/xiaoyu/data/runs` 不在清单里——备份天天绿，丢的却是**现在**这个人格的历史。改采集面属存储合同变化，先提案再动。
    复现：`grep -n "'runs'" scripts/ops-backup.mjs`（只有一条，指向回滚点）；`ls ~/.xiaoyu-home/xiaoyu/data/runs | wc -l`（线上真有多少 run）。
14. **跨宿主只验证过 Cortico —— 本仓唯一的跨宿主验证登记处**（2026-11-13，主人拍板三连第二件配套）。
    当前口径（降级版，逐字写在 `README.md` 顶部与 `VISION.md` 落点表后）：接口已做宿主无关设计，
    **但只有一个真实宿主被验证过**；未通过最小宿主验证前不宣称「可安装到任意底座」。
    **已量到的**：整个 `packages/` 树 0 个 `cortico/*` 模块说明符（唯一命中是 `persona-core/src/capability.ts:6` 的注释）；
    `cortico-adapter/src` 两文件 517 行、0 条 import/require，`PanelCtx` 只注入 DOM 根 + `invoke`（`webui-helpers.ts:55-63`）。
    **量翻的一条**：「模型由宿主发起」不成立 —— `cap-media-studio/src/vendor/tts.mjs:41` 自己 POST MiMo，
    链路 `index.ts:226` → `render.ts:10` → `tts.mjs:96`，key 取自本机凭据文件/`MIMO_API_KEY`，且 `:61` 明写不走 traffic 闸。
    **装载层三处真耦合**：宿主 `extensions/package.json` 绝对路径 link；`scripts/build-webui.mjs:24` 借隔壁 `Cortico-up` 的 esbuild（本仓无自己的）；
    本仓任何 package.json 都无 `engines`，`npm run gates` 写死 `--root ../Cortico-up`。
    **最小宿主（stub）验证的三条判据**（第三件；只实现四件事：模型发起 / 面板挂载点 / 状态目录 / 定时器；
    挂 6 个能力包 + `cortico-bot-xiaoyu`；**不许复制现有宿主代码进 stub、不许 mock 模型发起**）：
    ① 在 stub 上连续跑 24h；② `node scripts/outward-evidence.mjs --date=<验证日>` 退出 0（判据＝**对外凭据**，`life_do` 自记账不算）；
    ③「她的一天」「作息遥控台」「待放行队列」三页在**真浏览器**可用（`FakeEl` 不算）。
    **三条都还没跑**（MiMo 账户 402 欠费，真实模型调用与对外写当前无凭据 ⇒ ①② 属未验证，不许用候选输出顶替回执）。
    证据落 `docs/evidence/`（gitSha + stub SHA + outward-evidence 原始输出 + 截图/DOM 断言），验过后才允许把宣称升级。
    复现（现在就能跑的只读测量）：`grep -rn -E "['\"]cortico/" packages/ --include=*.ts --include=*.mjs --include=*.js`（1 行注释）；
    `grep -rn "api.xiaomimimo.com" packages/`（tts.mjs:41）；`grep -rn '"engines"' --include=package.json . | grep -v node_modules | wc -l` → 0；
    `sed -n '19,33p' scripts/build-webui.mjs`。逐条读数见 [`host-claim-downgrade-2026-11-13.md`](../evidence/host-claim-downgrade-2026-11-13.md)。

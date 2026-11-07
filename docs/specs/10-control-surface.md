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
**只有 CLI**：待放行队列批量放行（见 06 ⑤ 第 10 条）；`node scripts/audit-controls.mjs` 是控件普查入口，不是操作入口。

## ⑤ 已知缺陷与验证方式

1. **"设计落地率"这类百分比不写进本仓文档**（它不可复现）；可复现的是控件与方法的对账：**100 个控件 / 50 个 `actionButton` / 7 个裸按钮 / 53 个方法（31 writable）**。
   复现（自己数一遍）：
   `for p in cap-bilibili cap-journal cap-media-studio cap-memory cap-state-rhythm cap-vision; do f=packages/$p/src/webui/client.ts; [ -f $f ] && echo "$p AB=$(grep -c 'actionButton(' $f) BTN=$(grep -c 'ui\.button(' $f) INPUT=$(grep -c 'ui\.input(' $f) SELECT=$(grep -c 'ui\.select(' $f) TA=$(grep -c 'ui\.textarea(' $f) CHK=$(grep -c 'ui\.checkbox(' $f) SL=$(grep -c 'sliderField(' $f)"; done`
   注意 `scripts/audit-controls.mjs` 报的是 10 面板 / 45 方法 / 27 writable：差值来自它对 `methods: panelMethods`（`packages/cap-vision/src/index.ts:471` 变量间接引用）与 journal `feedback-triage` 的解析盲区，**该脚本自己在 `:16-17`、`:264` 已声明正则口径不可全信**。
2. **真浏览器测试实际 0 个**：`tests/dom/` 那 10 个跑的是自建 `FakeEl`（定义 `tests/helpers/panel-harness.mjs:14-99`，`isConnected` 是为脏守卫专门补的 `:77-85`）；
   第 10 个 `tests/dom/tank-smoke.test.mjs` 用 `node:vm` 跑旧 `panel/views/tank.html` 内联脚本，不属 Cortico 面板体系。
   复现：`grep -rn "playwright\|puppeteer\|chrome-devtools\|jsdom" package.json tests scripts | wc -l` → 0。
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
   （`packages/cap-bilibili/src/webui/client.ts:285`、`packages/cap-bilibili/src/domain/write-gate.ts:309`、`:465`——那两处防的是"主人随手全放"把过期稿放飞）。复现见 06 ⑤ 第 10 条。
10. **`call()` 无 busy**：只有 `actionButton` 有重入闸门（`webui-helpers.ts:127`、`:131-143`），`call()`（`:72-88`）没有——
    面板里所有"非按钮触发"的调用（下拉即改、翻页）连点会并发打服务端。复现：`sed -n '72,88p' packages/cortico-adapter/src/webui-helpers.ts`（看函数体内无 running 标志）。
11. **旧面板体系与 Cortico 契约并行**：`panel/server.js`（8447/8448 已退役但目录活着）与 `panel/views/tank.html` 仍在仓内，测试 `tests/dom/tank-smoke.test.mjs:8` 还在跑它——属契约外的渲染面，别把它当面板现状引用。复现：`grep -n "tank.html" tests/dom/tank-smoke.test.mjs`。

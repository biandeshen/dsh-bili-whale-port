# 四问决断 —— DSH 依赖 / 功能迁移 / 形态独立性 / 市场代理（round3 · 2026-11-01）

> 归属：本文是 `docs/team-2026-11-01/round3/` 四份在审材料（`form-and-independence.md`、`project-hygiene.md`、`ux-prototype.md`、`judgment-loop-design.md`）之上的**决断文档**，不重复它们的调研过程，只做方案对比与推荐。
> 方法：只读复核两仓代码 + `docs/ARCHITECTURE-2026-11.md`、`docs/CURRENT.md`、`scripts/hashes.json` 实测。未改代码、未做 git 操作、未发 B 站请求。
> 凡本文与既有材料冲突处，以代码为准，差异列在 §0。

## 0. 既有材料 vs 代码实测（不符清单）

| 材料说法 | 实测 | 影响 |
|---|---|---|
| `form-and-independence.md:21` 「`DSH_HOME` 被 35 个文件 import」 | `grep -rl DSH_HOME tools/ scripts/ --include=*.mjs` = **31 个文件**（35 可能含 `core/*.js` 或旧口径） | Q1 改名工作量按 31+ 记 |
| `form-and-independence.md:55` 序列帧在 `tank.html:228-251` | 实为 **`panel/views/tank.html:228-254+`**，且不是单段逐帧：读 `/assets/whale-girl/manifest.json` 的**多状态精灵表播放器**（states 切换 + `setInterval` 换 `backgroundPosition`，`img.onerror` 回落 CSS 造型） | Q2 迁移工作量略高于"25 行 CSS"，但仍是纯前端 |
| `form-and-independence.md:120`、`MODULARITY` 「`scripts/hashes.json` 冻结的 **4 个**验收脚本」 | `scripts/hashes.json`（frozenAt 2026-10-31T00:30）实冻 **12 个文件**：`day-report/day-snapshot/day-watchdog/counterfactual/run-mjs-tests/check-consumers/g3b-check/observation-start/goal-audit/c2-offline/observation-status` + `tests/contract/voice.test.mjs` | Q1/Q3 的"红线判定"要按这 12 个算；`paths.mjs`、`start-cortico.mjs`、`tools/**` **不在冻结清单内** |
| `CURRENT.md:34` 「npm test 266/266」 vs `project-hygiene.md:9` 「320/320」 | 两文档时点不同（hygiene 为 11-01 本地复跑） | 无碍决策，引用时以 hygiene 为准 |
| `form-and-independence.md:99` 「Node 需 24+ 或 undici EnvHttpProxyAgent」 | 本机 `node --version` = **v24.16.0**。Node 的 `NODE_USE_ENV_PROXY=1` 让全局 fetch 走代理 env（undici EnvHttpProxyAgent 语义，fetch 侧约 24.3 起、`node:http/https` 侧官方文档记 **v24.5.0+**，见 nodejs.org「Enterprise Network Configuration」） | Q4 关键结论：**不引任何 npm 依赖就能走系统代理**，前提是代理范围与 CA 信任配对做对 |

其余材料（Q1 78 处 DSH 分类、Q2 七面板覆盖表、Q3 形态事实表）本次抽查 `tools/lib/paths.mjs:24`（链 `WHALE_HOME→DSH_HOME→~/.dsh` 确认）、`core/index.js`/`core/client.js`/`cordis.patch.yml`/`tests/helpers/plugin.mjs` 均在盘、`package.json:6` `files` 含 `"dsh"` + `:59` `"dsh"` 块仍在、`ls ~/.dsh` 混布确认——与代码一致，直接沿用。

---

## Q1 · 我们还靠 DSH 的养鱼插件吗？

### 现状（带 file:line）

- **运行时不靠**：0 处对 DSH 应用的调用；`core/index.js:3`、`core/client.js:2` 两个 DSH adapter 只被 `tests/helpers/plugin.mjs:20` import（form-and-independence §Q1 已证，本次文件在盘复核）。
- **三条真耦合还在**：①默认 home 落 `~/.dsh`（`tools/lib/paths.mjs:24` `env.WHALE_HOME || env.DSH_HOME || path.join(HOME,'.dsh')`，实测 `~/.dsh` 混布 DSH 残留 `profiles/sessions/storages/dsh-runtimes/plugin-backups/channel-pack` 与她的 `bili-whale/`）；②导出名仍是 `DSH_HOME`（`paths.mjs:27`，31 个 mjs 文件 import）；③跨仓同一条优先级链在两仓各写一遍（whale `paths.mjs:24` ↔ Cortico `src/worlds/bili-account/definition.ts:29`、`tank.ts:19`）。
- **死件在盘**：`cordis.patch.yml`、`package.json:6`+`:59-67`、`core/index.js`、`core/client.js`、`tests/helpers/plugin.mjs`。
- **红线判定**：上述文件**都不在 `scripts/hashes.json` 的 12 个冻结文件里**；冻结风险只来自"动 home 默认档"——`paths.mjs:48-49` 注释自证：4 个验收脚本内联 legacy 逻辑，改默认档会让冻结脚本与在跑代码读不同 home，须观测期结束重冻。

### 方案

**A · 什么都不动（只当命名遗产）**
- 动 0 文件；零回归；红线零触碰。
- 代价：「靠 DSH 插件」的误判源留着；两仓 home 链**档数漂移**类 bug（issue #27 型）随时复发——链在两仓三处各写各的，没有机械一致性检查。

**B · 清死代码 + 改名双读（home 默认档不动）**
- 子步 B1（纯删除，≈6 文件）：删 `cordis.patch.yml`、`core/index.js`、`core/client.js`、`tests/helpers/plugin.mjs`，摘 `package.json` 的 `"dsh"` 块与 `files` 项，收 `config.mjs:27-28,54` 死键（`sessionRotateDays/personaOncePerSession/night.windows`——先验 `~/.dsh/bili-whale.config.json` 无对应用户写入）。
- 子步 B2（机械改名，≈31+2 文件）：`DSH_HOME` 导出加 `WHALE_HOME` 别名双读一版；`dshPath()`→`whalePath()`（`paths.mjs:37`）；`runtime.mjs:26` 保留 `DSH_*` 候选但降为兼容档；`deps.mjs:81,138` 等「重启 DSH」文案改「控制台/宿主」；**同步改 Cortico `definition.ts:29`/`tank.ts:19`，两仓链必须同档数**（`~/.dsh` 默认档原样保留 → 不触发重冻）。
- 工作量：≈1 人日；`npm test`+`gates` 全绿即可合并；live 冻结不碰。回归风险：低-中（改名为主，行为恒等可测）。

**C · 整仓中性化（目录/包名/home 全改）**
- `dsh-bili-whale` 目录改名 + 包名改名 + 迁 home 到 `~/.whale`（带迁移脚本）→ 连锁改动：Cortico 绝对路径（`definition.ts:25`、`tank.ts:16`）、启动链（`start-cortico.mjs:15`、HKCU Run 注册表两项）、`check-consumers.mjs:11` 相对位置、全部 docs 坐标、`scripts/hashes.json` **重冻**（12 文件 + 内联 legacy 4 个）、BASELINE `0.4.6` 对照链切断（`project-hygiene.md` 维度 2：版本号是基线锚）。
- 工作量：≈3-4 人日 + 一次全链回归。回归风险：中-高（观测期红线唯一真正被踩到的就是 home 迁移→重冻）。收益与 B 几乎相同，多的只是"名字干净"。

### 推荐：**B**（B1 先做、B2 观测期内并行做，均不动 home 默认档；C 的 home 迁移押到观测期结束重冻时作为独立一票）

理由一句话：**运行时早就不靠 DSH 了，剩下的是命名债和死件——B 恰好把两者摘掉且不碰任何冻结文件；A 留着两仓链漂移这个真实 bug 源，C 为一口名字支付重冻成本。**

### 不推荐理由

- **不选 A**：三条硬链接里的"两仓重复链"是会咬人的——`paths.mjs:5-6` 头注释自己就写了"两边 home 语义一旦不一致就会分叉"，历史上已经分叉过（issue #27）。零改动就是把已知复发源留着。
- **不选 C**：收益全部是命名层面的（B2 已把行为相关命名解决）；代价却含**唯一真正踩红线的动作**（改 home 默认档→`scripts/hashes.json` 重冻 + 4 脚本内联 legacy 一致性）和 BASELINE 锚点断裂。观测期后如真要迁 home，届时 C 只剩"迁 `~/.whale`"一件事，不必现在打包买。

### 需要主人拍板的那一件事

**home 默认档 `~/.dsh` 暂时保留还是随 B 一起迁？**（推荐：保留，迁家动作押到观测期结束与重冻同批做——B 不依赖它。）

---

## Q2 · DSH 插件里的功能能迁到现在的控制台吗？

### 现状（带 file:line）

- 7799 七面板已覆盖 8447 面板的时间线/审批/意见箱/体征/日记（`Cortico/src/worlds/bili-account/webui/client.ts:402-411`，form-and-independence §Q2 表）。
- 序列帧播放器**还活着且是 manifest 驱动的多状态精灵表**：`panel/views/tank.html:228-254`（`/assets/whale-girl/manifest.json` + states + `setInterval` 帧位移 + 错误回落）；Cortico 鱼缸页只放了一张静态 `avatar.png`（`client.ts:69-78` `invokeBinary('avatar')`）。
- 主动通知：`tools/lib/config.mjs:40` `notify:{type:'none',...}`，枚举 **none | desktop | webhook | command**；旧面板自带测试端点 `/api/notify-test`（`tank.html:226`）。DSH 桌面通知通道已断（`notify.mjs:202` 注释），但 webhook/command 两条通道是纯本地/HTTP 实现，**不依赖宿主**。
- 桌面置顶窗：DSH 桌面端 2026-10-25 已放弃（form-and-independence §Q2）；浏览器标签页做不了 always-on-top 透明窗/托盘。
- Live2D：全仓 0 实现，证据仅 `config.mjs:37` 兴趣标签；卡点是溟月素材对 Live2D 的额外授权限制 + 需引运行时（`pixi-live2d-display`），与宿主无关。
- ux-prototype 阶段 A/B 就是这些功能的落点（`ux-prototype.md` §7），协调方补记：阶段 D 已做完（master `f8af14c` envPrompt）。

### 逐项判定

| 功能 | 能不能迁 | 迁到哪 | 技术路径 | 代价 | 不迁的代价 |
|---|---|---|---|---|---|
| 序列帧动画 | **能** | `webui/client.ts` 鱼缸页 = ux 阶段 A 主场景 | 纯浏览器：精灵 sheet 随 `tank.ts invokeBinary` 或静态路由进 WebUI bundle；播放器 ~30 行 JS 从 `tank.html:228-254` 移植，状态由 7 场值映射（ux §4 表） | 低：0.5-1 人日；`build:web` + 停 bot 窗口；素材 CC BY-NC-SA 署名随 assets 目录携带 | 鱼缸永远是一张静止图，「像养成游戏」的第一视觉承诺落空 |
| 主动通知 | **能（换通道）** | 两跳：①事件进场景——"今天要你看的一件事"浮卡（ux §3，阶段 B）；②人不在页面时——`notify.type=command` 走 PowerShell Toast（whale 进程侧执行，不碰 WebUI） | 浏览器页做不到系统通知（Notification API 需 https/权限且 Cortico 是 http 回环），**whale CLI 侧做**反而现成（`commands/notify.mjs` 已有 desktop/webhook/command 三实现） | 低-中：0.5 人日（通道已存在，改默认+接线）；桌面 toast 无需新依赖 | `none` = 她永远沉默，`MODULARITY:41` 已记为体验根因 |
| 桌面置顶窗/宠物 | **不能（浏览器内）** | 独立原生壳才有 | Electron/Tauri 自带窗 | 高：`form-and-independence.md:117` 已判——第二宿主要把 7799 免口令回环安全前提与单时钟/审批单点/冻结哈希三条硬边界**重新证明一遍** | 情感在场感缺一块；但序列帧 + Toast 能覆盖 80% |
| Live2D | **技术上能、许可上卡** | 鱼缸页（若素材解决） | 浏览器页可跑，需 `pixi-live2d-display`——whale 零依赖传统 + `acceptance-zero-diff.test.ts` 不许 `src/web/**` 手搓，依赖只能进 World 的 webui 客户端 bundle | 素材获取未知 + 2-3 人日 | 无实质代价——她本来就没有 Live2D；序列帧是等效替代 |

**对主人偏好的回答**：这四件事全在"养成游戏化"同一条轨道上——序列帧喂 ux 阶段 A 的场景动画，通知喂阶段 B 的"浮出水面"事件（**不是**后台红角标，ux §3 明确"物理事件 + 生活化文案"）。迁的顺序应该跟 A→B 走，不单独发明第三种交互。

### 推荐

**迁序列帧（并入 ux 阶段 A）+ 通知两步走（阶段 B 场景事件优先，`notify.type=command`→Windows Toast 作补充通道，默认从 `none` 改 `command`）；桌面置顶窗不迁；Live2D 挂起等材料。**

### 不推荐理由

- 不现在为宠物窗引 Electron/Tauri：代价是重建全部安全边界（form §不建议 2），收益序列帧+Toast 已近替代。
- 不把 Live2D 列为路线承诺：素材许可未解决前写进计划就是空头支票；`CREDITS.md:18` 的署名红线也提示 NC 素材进对外分发面要单独审。

### 需要主人拍板的那一件事

**通知默认值改 `command`（本机弹 toast）还是保持 `none`、只靠页面内事件？**（涉及观测期行为变化：她"主动叫你"是新行为，建议先 `none` 上线场景事件，toast 通道留开关由主人显式开——符合"默认拒绝与显式开关"的既定偏好。）

---

## Q3 · 当前形态能改成什么？可以独立吗？

### 现状（带 file:line）

- 两个目录 + 一个 detached 进程（`start-cortico.mjs:15,23,56`），whale 仓**零 npm 依赖、可独立跑 CLI 与全部测试**（`package.json:14-34` dependencies/devDependencies 均空）——**"能不能独立"的答案是早就能，缺的是打磨**。
- 三类绝对路径挡分发：`E:/WorkSpace_Qoder`（`definition.ts:25`、`tank.ts:16`、`start-cortico.mjs:15,17`、`check-consumers.mjs:11`）、`D:/AI/养鱼`（`paths.mjs:51-52` legacy-if-exists）、`C:/Program Files/nodejs/node.exe`（`start-cortico.mjs:17`）。
- bili-account 是 **in-tree World**（`src/worlds/index.ts` EXPORTS），fork 无 upstream remote，扩展页 `extensions/` 从未装过任何扩展。
- 全新机器 6 步起得来但不闭环（`project-hygiene.md` 维度 8：11 步真实清单里 ④⑥⑨ 无脚本、Node 口径三处打架）。

### 三档

**档 1 · 维持"两个目录 + 一个进程"**
- 现在缺什么：不缺什么，功能上立着。
- 需要几步：0。人日 0。
- 维护成本：Cortico fork 的 World 改动永远自己背；上游补丁不跟（现状即不跟）。

**档 2 · 打包成可交付物（`cortico-world-bili-account` 扩展 + 清路径 + `bootstrap --check`）**
- 现在缺什么：①whale 侧显式 `exports` 契约（`tank.ts:48-52` 的 5 个动态 import 收成子路径，= Q1-B 第 3 件）；②World 从 in-tree 抽成扩展（`webUiClient: dist/webui.js`，受 `api` 版本闸门、面板改用公开 `WebUiPanelContext`）；③三类绝对路径可配置；④`scripts/bootstrap.mjs --check`（hygiene 维度 8 清单的可判定版）；⑤身份数据出默认值（`config.mjs:26-55` 的 like/dislike、owner.mid、D 盘 legacy 路径）。
- 需要几步：5 步。人日：**≈8-12 人日**（契约 2 / 扩展化 3-4 / 路径 1-2 / bootstrap 1 / 许可门 `check-licensing` 与文档测试 1-2）。
- 独立后维护成本**下降**：World 移出 fork 树 → 给 fork 加 `upstream` remote、定期 rebase 变廉价（fork 只剩部署层）；上游补丁从"自己 rebase 8 个文件"变成"几乎无冲突"。
- 风险：`api` 闸门使本地 World 每次契约 bump 被卡加载（form §不建议 3 的代价，换来的是可分发）。

**档 3 · 真正独立产品（自带桌面窗/托盘 + 可选云端模型）**
- 现在缺什么：原生壳（Electron/Tauri）、自研前端（`Cortico/AGENTS.md` §3.6：下游产品只准走公开 WebUI HTTP API，不得依赖 `src/web/client/` 内部）、模型网关可换层、打包签名、升级通道。
- 需要几步：≥6 步，**≈15-25 人日**。
- 维护成本**翻倍**：两个前端 + 安全边界（免口令回环前提）在新壳里重新证明 + 单实例/凭据边界重建；`form-and-independence.md:117` 反对引第二宿主的理由全部适用。

### 推荐：**现在停在档 1 尾、把档 2 立为观测期后的第一里程碑；档 3 不做，除非"发给别人用"成为真实需求且档 2 验收通过。**

"如果主人想要一个能发给别人用的东西"的**额外条件**（档 2 之上再加）：①`scripts/check-licensing.mjs` 进门禁且过——AMpath 借用件 `core/ports/temporal.mjs`（无 LICENSE，`CREDITS.md:18` 红线）必须移除，CC BY-NC-SA 帧素材随包署名或改为"用户自供素材"；②默认配置零个人痕迹（mid/owner/D 盘路径）；③`bootstrap --check` 在全新 VM/新用户 profile 上实测一次通过；④凭据面重写（B 站 cookie 走 UI 录入而非 `~/.bili-ai/credentials.json` 手放）；⑤`private: true` 解除需主人明示（"没写好先别开源"偏好）。

### 不推荐理由

- 不选档 1 长期：换机 6 步里 ④⑥ 步无校验，读空 home/起不来是静默失败；且 fork 背 in-tree World，上游越活跃 rebase 越贵。
- 不选档 3 现在做：它的前提（分发需求）没出现，而它的成本里含一整座安全模型的复证。

### 需要主人拍板的那一件事

**fork 的上游策略二选一：A. 抽扩展后加 `upstream` remote、定期 rebase 跟补丁；B. 永远私有分叉、in-tree World 不动（档 1）。** 推荐 A——但选 A 就意味着接受 `api` 闸门，这就是档 2 的入场券。

---

## Q4 · 扩展市场我就是要用，代理这块怎么做？

### 现状（带 file:line）

- 取索引走 `fetchIndexFile()`：先 `RAW_BASE`（`market.ts:32`，raw.githubusercontent.com）后 GitHub contents API（`market.ts:210-224`），每次 `fetchImpl(url,{headers, signal: AbortSignal.timeout(...)})`——`fetchImpl` 可注入（`market.ts:211 opts.fetch ?? fetch`），讨论/评分/device-code 全走 `this.fetch`（`market.ts:636-664`）。
- **全仓 `src/` 0 处** proxy/dispatcher/`NODE_EXTRA_CA_CERTS`/undici 导入（本次 grep 实测，仅错误文案提 proxy 一词）——即当前实现完全依赖 Node 默认行为。
- 失败面：catch → `log.warn` → 进程上次值 → `<扩展目录>/market-catalog.json` 缓存（form §Q4，`market.ts:39-44,519-536`）。
- **已有设置通道**（重要，别重复发明）：扩展页「索引源」`setIndexBase()` 读写扩展目录设置文件 `{indexBase}`，只收 http(s)（`market.ts:43,199,359`；路由 `web/server.ts:2125-2141`）；CLI 侧读 `CORTICO_MARKET_INDEX_BASE` 且**读不到 WebUI 设置**（`extensions/author-guide.ts:17-18`）。
- 本机事实：Node **v24.16.0**（≥ fetch 走 `NODE_USE_ENV_PROXY` 所需版本）；GitHub 直连 502；Clash `127.0.0.1:7897` 做 HTTPS MITM，自签 CA 未进 Node 信任根 → `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`。**注意：走 CONNECT 隧道代理时 Node 仍校验 MITM 后证书，所以"走代理"和"信 CA"是两件事，必须配对，缺一仍红。**

### 方案对比

| 方案 | 实现面（动什么/新增依赖/波及面） | 失败模式与降级 | 离线可用 |
|---|---|---|---|
| ① 全局 env：`HTTPS_PROXY` + `NODE_USE_ENV_PROXY=1`（+ `NO_PROXY`） | 只动启动链（`start-cortico.mjs` 加 env，不在 12 个冻结文件内）；**0 依赖**（v24.16 原生）；**波及全部出站**：18910 网关、api.bilibili.com 都可能被套进 Clash——B 站流量出境外 IP 是风控灾难，NO_PROXY 名单错一个就翻车 | 代理进程挂 → fetch 报错 → 照旧 warn+退缓存；`NO_PROXY` 漏配 = 静默把风控面扩大 | 无关，离线照旧退缓存 |
| ② market 内显式挂 dispatcher（仅 `fetchIndexFile`/`this.fetch`） | 动 `market.ts`（注入点现成 `opts.fetch`）；**需新增 `undici` npm 依赖**（Node 不暴露 built-in undici 给用户代码）或改用①的 env 语义做"仅该请求"不可行——这正是②要引依赖的原因；波及面 = 只有 GitHub 三主机，**B 站/网关零影响** | 代理挂 → `fetchFailure()` 已带主机名+cause 码（`market.ts:210-224,419`）→ 退缓存；范围可控是最大优点 | 同上 |
| ③ `NODE_EXTRA_CA_CERTS=<clash-ca.pem>` | 只动启动 env；0 依赖；解决**证书**不解决**连通**（直连仍 502）；且是给**整个 Cortico 进程**加信任根，全局生效 | CA 文件不存在 → Node 启动即报（响亮，好）；CA 装了但仍直连 → 原错误不变 | 同上 |
| ④ 索引镜像/本地清单：`indexBase` 指局域网 http 源，或预热 `market-index.json`/`market-catalog.json` 进扩展目录 | **0 代码改动**（机制已在，`market.ts:359` + 缓存文件）；需要一台常开的镜像服务或手工同步脚本；图标/截图也随 base 走 | 镜像挂 = 同现状 warn+缓存；`file://` 会被 400 拒（只收 http(s)） | **最优**：彻底不碰 GitHub |
| ⑤ 配置化：`proxyUrl` + `caCertFile` 两个可调项上设置面 | 按 `Cortico/AGENTS.md` §3 边界 5，**必须声明成 ConfigGroup JSON Schema**，不许在扩展页手搓控件（indexBase 是市场内部路由的先例，但代理是进程级网络面，归部署配置更合规）；实现落在协调方手里，本文不指定细节 | 默认值语义见推荐；错误要能显式回显（连接测试端点） | 与④互补 |

### 推荐组合：**①+③ 配对、范围锁死 GitHub、⑤ 把两个值抬到可见面、④ 作离线兜底**

具体决断（不含实现细节，判据归协调方）：

1. **传输层用 Node 原生 `NODE_USE_ENV_PROXY=1` + 进程内仅 GitHub 走代理**：不引 undici（拒绝纯②的依赖成本）；用 `HTTPS_PROXY` 只对 market 生效即可——若实现只能全局注入①，则**必须**带 `NO_PROXY=127.0.0.1,localhost,api.bilibili.com,*.bilivideo.com,*.hdslb.com` 且这条名单写进验收判据（防 B 站流量出境）。
2. **CA 用 ③**：`NODE_EXTRA_CA_CERTS` 指 Clash CA，**只给 Cortico/whale 进程设，不进 Windows 系统受信任根**（不污染全机其他应用）；CA 文件摆放路径算部署事实，进 `deployments/mybot/.env` 注释。
3. **可见性用 ⑤**：`proxyUrl`、`caCertFile` 声明为 ConfigGroup 字段（框架惯例），页面上看得见可改；**默认值 = 空（直连）**——不把主人机器的 Clash 当出厂默认。
4. **不把风险静默吞掉的默认值判据**：失败时扩展页必须显式区分三态——`在线` / `stale（用的上次缓存，标注缓存时间）` / `不可达（含 cause 错误码，现有 fetchFailure 格式）`；现在的"只 warn 到日志"对使用者等于静默。这是给协调方的**行为要求**，不是网络实现。
5. **④ 镜像作为离线兜底保留**：索引源机制已存在，README 里写一句"可用内网镜像替代代理"即可，不重复发明。

### 可验收判据（给协调方，一条命令/一个测试可证真走代理）

- **单测（Cortico 内，不碰真实网络）**：起本地假代理（http server 记录 `CONNECT`/请求行），把 `proxyUrl` 指过去调 `fetchIndexFile()`，**断言假代理收到过对 raw 主机的请求**；另加一条断言"未配 proxyUrl 时假代理零流量"（默认直连不被悄悄改掉）。
- **本机一条命令**：Cortico 起进程后 `GET http://127.0.0.1:7799` 的扩展页目录显示 `stale:false` 且刷新时间 < 60s；或 CLI：`curl.exe --cacert <ca.pem> -x http://127.0.0.1:7897 -o NUL -w "%{http_code}" https://raw.githubusercontent.com/Pal-AI-Lab/cortico-extensions/main/index.json` = 200 只证明**通道**通，端到端以扩展页三态为准。
- **降级判据**：拔掉 Clash 后刷新市场 → 页面呈 `不可达 + cause 码`，装 `link:` 本地扩展**不受影响**（`docs/extensions.md:13-18` 已证 link: 不查 npm）——这条保护"市场坏了、开发主路不断"。
- **红线判据**：`NO_PROXY` 名单生效——运行期间抓 whale 侧 B 站请求目标 IP 不变（境内出口），18910 网关仍走回环。

### 不推荐理由

- 不选纯①：全局代理把 B 站风控面和网关流量一起绑架，NO_PROXY 是隐性单点。
- 不选纯②：为三台 GitHub 主机给零/轻依赖的框架新增 `undici` 运行时依赖不划算，且 Node 24 原生已覆盖；②的实现价值仅在于"注入点已现成"，留给协调方作备选。
- 不选纯③：只治证书不治连通，直连 502 依旧。
- 不选 `NODE_TLS_REJECT_UNAUTHORIZED=0`：`form-and-independence.md:119` 已判——扩展包完整性交给网络路径，等于给 MITM 开后门。

### 需要主人拍板的那一件事

**代理范围：接受"只有 GitHub 市场流量走 Clash，B 站与网关永不出境"这条硬边界吗？**（这决定协调方实现是"仅 market"还是"全局+NO_PROXY"，也决定验收判据第 4 条是否成立。另：Clash CA.pem 的导出与摆放需要主人亲手做一次——Clash 配置里的自签根证书位置助手无法代取。）

---

## 四问之间的依赖顺序

```
Q4（现在，协调方在做） ──→ 市场可用，与另三问零耦合，先闭环拿掉一个"坏掉的"
Q2 前端两件（现在可做） ──→ 序列帧/通知并入 ux 阶段 A/B：只动 webui/client.ts 与
                            notify 默认值，不碰 12 个冻结文件、不碰 home 链
Q1-B（观测期内可做，观测期结束合入）──→ 死件删除 + 改名双读是 Q3 档 2 第①步（exports
                            契约）的直接前置；改名完成后再迁 home 只动一档，重冻面最小
Q3 档 2（观测期后） ──→ 依赖 Q1 的契约收口与路径可配置；上游策略拍板（档 2 入场券）
Q1-C 的 home 迁移（观测期结束与 hashes 重冻同批） ──→ 刻意排在 Q1-B 之后：B 做完后
                            迁 home = 只改 `paths.mjs:24` 默认档 + 迁移脚本 + Cortico 两链同步
```

**哪件先做让后面更便宜**：Q1-B 的"契约显式化 + 两仓链同步"是杠杆点——它同时是 Q3 抽扩展的前置（`tank.ts` 不再拼绝对路径）、Q1-C 迁 home 的减半器（链只剩一处定义可改）、以及 issue #27 类 bug 的终结（档数漂移变成编译期问题）。顺序上 **Q4 ∥ Q2前端 → Q1-B → 观测期结束重冻（含 home 迁移）→ Q3 档 2**。

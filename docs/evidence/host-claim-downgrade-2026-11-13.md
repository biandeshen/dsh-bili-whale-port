# 宿主宣称降级 · 逐条实测（2026-11-13）

> 批次：主人拍板三连的**第二件**（删旧代码 → **改文档宣称** → 假宿主验证）。
> 本件是「改宣称」的测量依据：**先量后写**，不转述审查方的结论。
> 生效版本＝**降级版（当前版）**。升级版要等第三件（最小宿主验证）三条判据全过才允许写。
> 运行时 HEAD：`84931e7`（branch `port/core-opencode-panel`，工作区除 `spark-output/analysis/` 外干净）。

## ① 降级前的宣称是什么

三处旧口径（都在本批之前就在仓里）：

| 位置 | 旧原文（摘） | 问题 |
|---|---|---|
| `README.md:365`（依赖与移植性节尾） | 「状态全在**几个普通文件**里……人随时能打开看，**宿主可以整个换掉**。」 | 把「状态是普通文件」推成「宿主可换」，中间那步（装载层）没量过 |
| `README.md:352-362`（同节表格） | 七行「宿主假设」写的是 `sessionController.prompt` / `night plan` / `whale-night.mjs mark` / `~/.dsh/whale-work` | 这些是 **DSH 插件时代**的机器，那棵代码树已于 2026-11-12 整棵删除（`b2e9fe7`）。表格描述的东西仓里已不存在 |
| `docs/attic/2026-11/ARCHITECTURE-TARGET-2026-11-03.md` §2.1 铁律2 | 「**核心资产 100% 宿主无关（连 Cortico 本身也是可插拔插座）**……将来 Cortico 升级契约或彻底换掉 Cortico 底座，5 个能力包一行代码不用动。」 | 设计意图写成既成事实；且「5 个能力包」当时是 5 个，现在是 6 个 |

attic 那份**不改写**（attic 的规矩是考古、原样保留）。处置方式＝在活文档里立一条读法，见 ⑤。

## ② 三条接口宣称逐条实测

### 宣称 A：能力包严禁 import `cortico/*` —— **成立，且比宣称更宽**

```
$ grep -rn -E "['\"]cortico/" packages/ --include=*.ts --include=*.mjs --include=*.js
packages/persona-core/src/capability.ts:6: * 2. 能力包内部严禁直接 import 'cortico/*'，仅由外层薄转接头适配到具体宿主插座；
exit=0   命中行数=1
```

唯一命中是**注释**（写着这条规矩本身），不是 import。范围是**整个 `packages/` 树 11 个包**，
不只是 6 个 `cap-*`：`cortico-bot-xiaoyu` / `cortico-world-bilibili` / `cortico-world-media` 三个转接头也 0 命中。
另按 `from 'cortico` / `require('cortico` / `import('cortico` 三种写法单独扫 6 个 cap + persona-core：`exit=1`（零命中）。

**所以「耦合在装载层、不在能力包接口」这句是量出来的，不是猜的。**

### 宣称 B：UI 经 `PanelCtx` 注入 —— **成立，但有一条要说清的边**

`PanelCtx` 定义（`packages/cortico-adapter/src/webui-helpers.ts:55-63`）：

```ts
export interface PanelCtx {
  readonly pageId: string
  readonly panelId: string
  readonly language: string
  readonly root: HTMLElement
  readonly signal: AbortSignal
  readonly ui: PanelUi
  invoke(method: string, args?: unknown): Promise<unknown>
}
```

注入面只有 DOM 根 + 一个 `invoke`，没有宿主对象。**但 6 个能力包的 UI 都用相对路径引这个 adapter 包**：

```
$ grep -rn -E "from ['\"].*cortico-adapter/src/webui-helpers" packages/cap-*/src/webui/client.ts
（12 行，每个包 2 行：一行 import type { PanelCtx }，一行 import { call, actionButton, ... }）
packages/cap-bilibili/src/webui/client.ts:8,9
packages/cap-journal/src/webui/client.ts:12,13
packages/cap-media-studio/src/webui/client.ts:12,13
packages/cap-memory/src/webui/client.ts:7,8
packages/cap-state-rhythm/src/webui/client.ts:8,9
packages/cap-vision/src/webui/client.ts:8,9
exit=0   行数=12
```

这条边**不违反宣称 A**（引的是本仓相对路径，不是 `cortico/*` 模块说明符），而且被引的那个包本身宿主无关：

```
$ grep -rn -E "^\s*(import|export)\s.*from|require\(|import\(" packages/cortico-adapter/src/
exit=1        # 零命中：两个文件 517 行，一条 import/require 都没有
$ wc -l packages/cortico-adapter/src/*.ts
  146 index.ts
  371 webui-helpers.ts
  517 total
```

`index.ts:7-8` 自己写着为什么：「用本地声明的最小结构类型（不 import cortico/*），这样本包自身仍是宿主无关的」。
**要说的清的那句**：包名叫 `cortico-adapter`，但里面没有 Cortico 专有依赖；换宿主时这 517 行可以原样复用，
名字会误导下一个人以为它是宿主专用件。**不改名**（改名要动 12 行 import + 门禁 + 冻结哈希，不在本批范围），只把事实写下来。

### 宣称 C：模型由宿主发起 —— **不成立，有一处实测反例**

见 ③。这是本批唯一一条**把审查方给的口径量翻**的。

## ③ 反例：配音这一路自己发起模型调用

```
$ grep -rn -E "https\.request|http\.request|fetch\(|httpsPost\(" packages/cap-*/src packages/persona-core/src | grep -v webui/client.ts
packages/cap-media-studio/src/vendor/tts.mjs:41:  const r = await httpsPost('https://api.xiaomimimo.com/v1/chat/completions', payload, {
packages/cap-media-studio/src/vendor/tts.mjs:62:function httpsPost(url, payload, headers, timeoutMs = 180_000) {
packages/cap-media-studio/src/vendor/tts.mjs:64:    const req = https.request(new URL(url), { method: 'POST', headers }, (res) => {
（其余命中全是 cap-bilibili 打 B 站平台 API：bili-debrief.ts:87,128,150 / bili-read.ts:267,308,312 /
  bili-watch.ts:65,90 / platform/api.mjs:166 / platform/traffic.mjs:33,225,226 —— 那是平台读写，不是模型）
```

**完整调用链（每一跳都核过行号）**：

| 跳 | 位置 | 内容 |
|---|---|---|
| 1 | `packages/cap-media-studio/src/index.ts:226` | `const pipeline = opts.renderPipeline ?? renderVideoSlice` —— 能力包自己的工具，默认走真管线 |
| 2 | `packages/cap-media-studio/src/render.ts:10` | `import { ttsPlan, synthesize, describeTts } from './vendor/tts.mjs'` |
| 3 | `packages/cap-media-studio/src/vendor/tts.mjs:96` | `if (p === 'mimo') await mimoTts({ ... })`（`plan.order` 默认 `['mimo','edge']`，见 `:20`） |
| 4 | `packages/cap-media-studio/src/vendor/tts.mjs:41` | 直接 POST `https://api.xiaomimimo.com/v1/chat/completions` |
| key | `packages/cap-media-studio/src/vendor/mimo.mjs:27` | `loadMimoKey({ env = process.env, candidates = defaultCandidates() })`；缺 key 的报错文案写着来源＝`~/.local/share/mimocode/auth.json` 或 `MIMO_API_KEY`（`tts.mjs:32`） |

**为什么这条必须写进降级文而不是悄悄放过**：

- 它不经宿主 ⇒ 换宿主之后**这一路照样自己花钱**，宿主的成本账/退避/402 感知都管不到它。
- `tts.mjs:61` 的注释自己写着「只用于 MiMo TTS（不是 B 站后端，**不走 traffic 闸**）」——绕开闸门是**明写的设计**，不是漏洞；
  但「模型由宿主发起」这句宣称因此不成立，两者不能同时挂。
- 第三件（最小宿主验证）**必须覆盖配音这一路**，否则 stub 上跑通了也只证明了另外五条能力包。
- 本批**不改代码**（第二件是纯文档宣称批）。修法归后续批次：要么把 TTS 的模型发起交回宿主，
  要么把宣称改成「除配音外由宿主发起」并给出理由。**已登记，见 ⑦。**

## ④ 装载层的三处真耦合（换底座真正要改的地方）

`packages/` 里 0 个 `cortico/*`，但**这不代表装得进别的宿主**。耦合在仓外与构建期：

### 1. 宿主用绝对路径 link 指到本仓

```
$ cat E:/WorkSpace_Qoder/Cortico-up/extensions/package.json
{
  "name": "cortico-extensions",
  "private": true,
  "dependencies": {
    "cortico-bot-xiaoyu": "link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-bot-xiaoyu",
    "cortico-world-bilibili": "link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-bilibili",
    "cortico-world-media": "link:E:/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-media"
  },
  "packageManager": "pnpm@11.28.6"
}
$ ls -la E:/WorkSpace_Qoder/Cortico-up/extensions/node_modules/
lrwxrwxrwx cortico-bot-xiaoyu    -> /e/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-bot-xiaoyu
lrwxrwxrwx cortico-world-bilibili -> /e/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-bilibili
lrwxrwxrwx cortico-world-media    -> /e/WorkSpace_Qoder/dsh-bili-whale/packages/cortico-world-media
```

宿主装载机制：`Cortico-up/src/extensions.ts:101-103`（`extensionsDir`，可被 `CORTICO_EXTENSIONS_DIR` 覆盖）、
`:220-222`（登记在 `extensions/package.json` 但 `node_modules` 里没有就报错）。
⇒ **换机器/换盘符这三条 link 就断**，且断法是宿主启动期报错，不是静默降级。

### 2. 面板构建借隔壁宿主的 esbuild

```
$ grep -n -E "esbuild|Cortico" scripts/build-webui.mjs
19: * 优先用 Cortico 检出里的 esbuild（走 JS API，不依赖 .CMD 可执行文件——
24:    path.join(ROOT, '..', 'Cortico-up', 'node_modules', 'esbuild', 'lib', 'main.js'),
25:    path.join(ROOT, 'node_modules', 'esbuild', 'lib', 'main.js'),
33:  throw new Error('找不到 esbuild（试过 Cortico-up/node_modules/esbuild 与本仓 node_modules/esbuild）')
$ ls node_modules/esbuild
ls: cannot access 'node_modules/esbuild': No such file or directory
```

本仓根 `package.json` **没有任何 `dependencies` / `devDependencies`**（全文核过）⇒ 第二条候选永远不存在，
**实际只有「隔壁必须有个叫 `Cortico-up` 的检出」这一条路**。目录名写死在 `:24`。

### 3. engines 口径：本仓根本没声明

```
$ grep -rn '"engines"' --include=package.json . | grep -v node_modules
（零命中：本仓 11 个包 + 根，没有任何 engines 声明）
$ node -e "console.log(require('E:/WorkSpace_Qoder/Cortico-up/package.json').engines)"
{ node: '>=22' }
```

`README.md:156` 原文写「Node 22+（**与宿主 Cortico 的 `engines` 一致**……）」——
「一致」是**碰巧一致**，不是本仓声明过的约束。另：`npm run gates` 自己写死 `--root ../Cortico-up`
（根 `package.json` 的 gates 串第三段），**本仓的门禁链也假设隔壁有宿主检出**。

## ⑤ 落地位置与生效文本

**生效版本＝降级版（当前版）**，三处 + 一份 manifest：

| 位置 | 改了什么 |
|---|---|
| `README.md:4`（第一句） | 「给 **DSH** 装一条有日子的鱼」→「在 **Cortico** 里养一条有日子的鱼」。DSH 接入线已删，这句是最显眼的假宣称 |
| `README.md:10`（分支行） | 「DSH **不再是唯一宿主**」→「DSH 插件那条接入线已整棵删除，**当前唯一验证过的宿主是 Cortico**」。原句暗示还有别的宿主可用 |
| `README.md` 顶部（新增 `## 宿主：只验证过 Cortico` 节，紧跟入口 blockquote） | 主人指定的当前版原文**逐字**写入 + TTS 例外 + 装载层三处耦合 + 指向本件 |
| `README.md` `## 装` | 原三步是 `dsh plugin --profile desktop add` / 「设置 → 养鱼」/ 重启 DSH ——**那棵代码树已删**。换成实测的装载路径（宿主 extensions link → `node scripts/build-webui.mjs` → `node scripts/start-cortico.mjs`），cookie 入口改成实测存在的「连接与凭据」面板（`cap-bilibili/src/index.ts:1319-1320`），体检改成 `node tools/bili.mjs selftest`（dispatcher `tools/bili.mjs:31` 核过）。**「保存即生效」那句也降了**：`x-hot` 无消费方（specs/10 ⑤3），只有 cookie 是下一拍生效（`index.ts:259`）。末尾明写「本批没有重新装一遍、11 页签真浏览器验收未做」 |
| `README.md:156`（前提行） | 「与宿主 Cortico 的 `engines` **一致**」→ 说清 `node>=22` 是**宿主的**声明、**本仓没有任何 engines**；并补上「需要一个 Cortico 检出（构建借它的 esbuild）」 |
| `README.md` `## 依赖与移植性` | 七行 DSH 时代假设表换成**九行当前实测表**（每行带 file:line）；删掉「宿主可以整个换掉」这半句并**在原位说明为什么删**（不是藏问题：状态是普通文件≠装载层可移植，后者见 ④） |
| `README.md` ffmpeg「怎么确认装上了」 | 「打开 设置 → 养鱼 → 依赖体检」→ `node tools/bili.mjs deps`（dispatcher `:32` 核过），并注明那个页面已不存在 |
| `README.md` 「宿主自己的 AGENTS.md」小节 | **原文留着对照**，上面加标注：DSH 时代口径、当前不生效；改她走 `~/.xiaoyu-home/xiaoyu/prompts/CONSTITUTION.md` + `ORIENTATION.md`（2026-11-13 `ls` 实测两文件都在；RUNBOOK 那节写的 `deployments/mybot/...` 是**回滚点**路径，不是线上） |
| `VISION.md` 落点表后（新增一节） | 加「愿景与当前实测的差」：当前版原文逐字 + TTS 反例 + 两处装载耦合 + 为什么写在愿景文件里。**上面作者原话一个字不改**；另加一条校注指出第 12 行括号里「`dislike` 是硬屏蔽」是旧口径，以落点表第一行为准（主人 2026-11-06：只是个标签，不做硬拦） |
| `docs/INDEX.md` | 新增**第二条**「读 attic 的口径」：§2.1 铁律2 与 §2.2 三层图是 2026-11-03 的**设计裁决**，不是验收结论（且当时 5 个能力包、现在 6 个）；当前口径以 specs/10 ⑤14 为准。attic 原文一个字不改 |
| `docs/specs/10-control-surface.md` ⑤ | 新增**第 14 条**＝本仓**唯一的跨宿主验证登记处**：已量到的 / 量翻的一条 / 装载层三处 / stub 四件事与三条判据 / **三条都还没跑**（402 无凭据 ⇒ ①② 未验证）/ 现在就能跑的只读复现命令 |
| 根 `package.json` | `description` 去掉「DSH 里的 agent」「设置里有『养鱼』完整设置页（27 项）」，改成「只有一个真实宿主被验证过（Cortico），不宣称可安装到任意底座」；`keywords` 去掉 `dsh` / `dsh-plugin` / `deepseek-harness`，换成 `cortico` / `persona`（保留 `bilibili` / `agent` / `diary`）。**`name` 与 `version` 不动、不打 tag**（本批不是发版；改包名要动宿主 link，另开批次） |

**不许写的三句**（主人明令）：「支持任意底座」/「插件化完成」/「即装即用」。
**也不许只把句子删掉**——「那是藏问题」。所以每处都是**降级 + 给出实测判据**，不是删除。

## ⑥ 复现（只读，零 token，不碰线上）

```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale
# A：能力包不引 cortico/*（唯一命中应是注释）
grep -rn -E "['\"]cortico/" packages/ --include=*.ts --include=*.mjs --include=*.js
# B：adapter 自身零 import + UI 注入边
grep -rn -E "^\s*(import|export)\s.*from|require\(|import\(" packages/cortico-adapter/src/   # exit=1
grep -rn -E "from ['\"].*cortico-adapter/src/webui-helpers" packages/cap-*/src/webui/client.ts  # 12 行
# C：模型发起反例
grep -rn "api.xiaomimimo.com" packages/
sed -n '226p' packages/cap-media-studio/src/index.ts
sed -n '10p'   packages/cap-media-studio/src/render.ts
sed -n '41p;96p' packages/cap-media-studio/src/vendor/tts.mjs
# D：装载层三处
cat E:/WorkSpace_Qoder/Cortico-up/extensions/package.json
sed -n '19,33p' scripts/build-webui.mjs
grep -rn '"engines"' --include=package.json . | grep -v node_modules   # 零命中
```

## ⑦ 没验的 / 登记给后续批次的

1. **没验**：本批**没有**在任何非 Cortico 宿主上装载过。降级版文本里「只验证过 Cortico」这句的依据是
   「仓内不存在第二个宿主的装载记录」，**不是**「试过别的宿主失败了」。第三件才是那个试验。
2. **没验**：真浏览器 11 个页签（B-1 尾，任务 #74）——线上 7799 当前没起，标准规矩不许我重启生活循环。
3. **登记（不在本批改代码）**：TTS 自己发起模型调用（③）。两条出路：交回宿主发起，或把宣称改成「除配音外」。
   归第三件之后的批次，**由主人拍板选哪条**。
4. **登记**：`cortico-adapter` 包名误导（②B）。改名要动 12 行 import + 冻结哈希，另开批次。
5. **登记**：`build-webui.mjs:24` 与 `npm run gates` 写死隔壁目录名 `Cortico-up`。
   与 A-S2 已修的「七脚本硬默认」同类，但这两处**当时不在那七个里**；归后续批次（改法＝走 `scripts/lib/host-root.mjs`）。
6. **本批只改了与宿主宣称直接相关的段落，没有整篇重写 README。** 已顺手改掉的：`:4` 第一句、`:10` 分支行、
   `## 装`、前提行、`## 依赖与移植性`、ffmpeg「怎么确认装上了」、「宿主自己的 AGENTS.md」小节（加标注、原文留对照）。
   **登记给后续批次的 README 残留**：
   - `## 测试` 节写「**57 个用例**」——过期数字。当前实测是 149 个测试文件 / 858 pass（见 `gates-2026-11-13.json`）。
     那四条 `node --test tests/planner.test.mjs ...` 命令**本身没死**（四个文件都还在，逐个 `-f` 核过），死的只是计数。
   - `## 0.4.6 新东西` 整节是版本公告体，与「文档只写现在是怎么设计的」这条体制不合（INDEX §2 规矩 1 只管 `docs/`，管不到 README）。
   - **一条澄清（别当死路径修）**：`~/.dsh/bili-whale.config.json`（`:35`、`:181`）**不是死路径**——
     `packages/cap-bilibili/src/platform/paths.mjs:29` 的优先级链仍是 `WHALE_HOME → DSH_HOME → <HOME>/.dsh`；
     ffmpeg 查找顺序第 ③④ 位也仍是 `<仓库>/bin` 与 `~/.dsh/bili-whale/bin`（`packages/cap-vision/src/ffmpeg.ts:7`）。
     `.dsh` 这个**目录名**是遗留兼容，不是「DSH 宿主还在」的证据。
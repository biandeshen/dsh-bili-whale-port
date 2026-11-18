# 席位六：工程质量、可靠性与交付卫生

评审对象：`E:\WorkSpace_Qoder\dsh-bili-whale`
基线 HEAD：`a617b6260e0a441ff07712b17b1d34c34ed67a77`（分支 `port/core-opencode-panel`）
评审时间：2026-11-06（本地）
运行环境：Node v24.16.0；工作区在本评审进行期间被另一会话持续修改（见 §5.4）
纪律：全程只读 + 只跑测试与只读校验脚本；未运行任何部署/清理/写盘脚本；未 commit/checkout/reset/stash/clean；未重启进程；未调用 7799 写接口。

---

## ① 核心判断

**结论：这套东西的"维护住"能力显著高于同规模个人项目的常态，但它的强度不是来自测试，而是来自一套自建的本地门禁 + 逐日落盘的证据链。测试本身是绿的、也是真的（860/860 实测无红），但真正拦住历史事故的是 7 个 `check-*` / `-drift` / `-anchors` 门禁脚本，不是断言。**

分三档说明：

- **已验证（我本机实跑）**
  - 全量测试实跑：`DISCOVERED=151 / EXECUTED=151/151 / COUNTS tests=860 pass=860 fail=0`，退出码 0（`node scripts/run-mjs-tests.mjs`，2026-11-06 本机）。
  - 5 个只读门禁全绿：`check-mjs-syntax`（326 个 .mjs 无 TS 语法混入）、`check-consumers`（全部核心导出有生产调用）、`check-hashes`（10 份冻结脚本哈希一致）、`check-state-roots`、`check-live-drift`（14 项，无漂移）。
  - 全仓 407 个 .ts/.mjs 文件的相对 import 静态解析：**只有 2 处不可解析**，且都在 `spark-output/flow-web/day-client.design.ts:12-13`（指向不存在的 `../../../cortico-adapter/src/webui-helpers.ts`）。历史上"退役目录搬移导致 24 个文件 `ERR_MODULE_NOT_FOUND`"这一类当前**已不复发**。
  - `.gitattributes` 实际内容含 `* text=auto eol=lf` + `*.cmd -text` + `vendor/** -text`——即"`.cmd` 不许被规范化"这条规矩是**机器钉住的**，不是口头约定。
  - 提交密度实测（`git log --date=short`）：10-29 92 次、11-01 56 次、11-04 43 次、11-05 29 次、11-06 15 次。总量 512 次。
- **仅自述（项目文档/commit 写了，我无法在本机复现）**
  - "线上跑旧进程"事故的现场时刻（commit 00:39 / 进程 23:34）：机制侧我能验证的是存在 `scripts/check-live-drift.mjs`（278 行）专治此事，且 `git log --grep=漂移` 命中 12 个提交、`docs/` 命中 32 个文件——**这个坑被反复踩了足够多次，才会催生出专门门禁**。
  - `docs/` 里对 `data/persona/*.pre-purge-*` 的描述（见 §5.1，我在本机所有可能位置都没找到这类文件）。
- **无证据 / 前提不成立**
  - 任务书给的"数据卫生"样本路径 `data/persona/`（含 `fields.json.bak`、3 份 `fields.json.pre-purge-*`、`feedback.jsonl.pre-purge-*`×2、`judgment.jsonl.pre-purge-*`×2）在本仓与本机**不存在**：`ls data` → No such file or directory；`find /e/WorkSpace_Qoder /c/Users/Administrator/.dsh /d/AI -maxdepth 7 -name '*pre-purge*'` → 0 结果。真实的同类残留位于运行时家目录 `~\.dsh\bili-whale\`（见 §5.1）。我按实测对象重写这一节，不沿用任务书前提。

---

## ② 测试强度分类统计（含全量实跑数字）

### 2.1 全量实跑（本机，一次，不重跑）

| 指标 | 实测值 |
|---|---|
| 发现测试文件 | **151**（全部为 `.test.mjs`；`find -name '*.test.ts'` = **0**） |
| 执行文件 | **151/151**（`EXECUTED=151/151`） |
| 测试用例总数 | **860** |
| pass | **860** |
| fail | **0** |
| skip | **未采集**（见下） |
| 退出码 | 0 |

**必须如实说的两处保留：**

1. **skip 数字拿不到，而且这是 runner 的设计缺陷**。`scripts/run-mjs-tests.mjs:92-97` 只从每个文件的输出里抓三个数：
   ```js
   const pick = (label) => {
     const m = new RegExp(`^ℹ ${label} (\\d+)$`, 'm').exec(text)
     return m ? Number(m[1]) : null
   }
   ...tests: pick('tests'), pass: pick('pass'), fail: pick('fail'),
   ```
   `node --test` 的汇总行里有 `ℹ skipped N`，**runner 没有 pick('skipped')**。所以"860 pass / 0 fail"里混进了多少 skip，从门禁产物上无法回答。静态兜底：源码里 skip 标记（`skip: true` / `t.skip(` / `describe.skip`）只出现在 **3 个文件共 5 处**（`packages/cap-media-studio/tests/media-studio.test.mjs` ×2、`packages/cap-vision/tests/subtitle-strip.test.mjs` ×2、`tests/media-studio.test.mjs` ×1）。**判断：skip 规模很小，但"门禁不自报 skip"是真实盲区**（成本低即可补，非阻塞项）。
2. 我跑的是工作区当前状态（含 6 个未提交修改 + 5 个未跟踪新文件），不是干净的 HEAD。仓库内最新一份**落盘**证据是 `docs/evidence/gates-2026-11-05.json`：`gitSha=6feec267…`、`discovered=120 / executed=120 / tests=671 / pass=671 / fail=0 / exit=0`。**证据落后于代码 31 个测试文件、189 个用例**——今天（11-06）没有新的 gates 报告落盘。

### 2.2 三类分布（按文件计，方法透明）

| 类 | 判定方法 | 文件数 | 占比(/151) |
|---|---|---|---|
| ① 真跑实现并断言行为 | 静态 import 生产源码（`../src/...`）54 个文件；`spawnSync(process.execPath …)` 真起子进程跑 CLI/服务 39 个文件；`tests/contract/` 39 个契约测试文件（实测 `ls -1 tests/contract/*.test.mjs` = 39） | **约 130–140** | **≈ 88–93%** |
| ② mock 掉关键协作者 | grep `fakeHost/stubHost/makeHost/fakeFetch/deps = {/ctx = {` → 3 个；起真 `http.createServer` 做替身 → 2 个；合计 **5** | **5** | **≈ 3.3%** |
| ③ 只断言"源码字符串里含某词" | 精确 grep `readFileSync(...\.(mjs|ts))` 在测试里 → **1** 个文件；加上目录扫描式（`readdirSync` 遍历自身源码找字面量，共 13 个文件命中，其中真正断言源码文本的是 3 个） | **3–4** | **≈ 2–2.6%** |

**关键：这一类在本仓不是"假绿"，而是刻意写的架构适应度函数（fitness function），并且作者自己知道边界在哪。** 逐个看：

- `tests/contract/write-refusal.test.mjs:104`
  ```js
  const src = fs.readFileSync(path.join(ROOT, 'tools/commands', `${f}.mjs`), 'utf8')
  ```
  扫的是命令实现源码文本。**脆弱点实测存在**：若有人把 `try/catch` 重构等价、或把 `throwIfRefused(` 改名成同样拦住的东西，这条不会红。
- `adapters/opencode/test/contract.test.mjs:82-85`——**负向**断言，且做了正确的事：先剥注释再匹配。
  ```js
  const src = fs.readFileSync(path.join(ROOT, 'adapters/opencode/mcp-stdio.js'), 'utf8')
  const code = src.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, '') // 只查真实代码，注释里的警示语不算
  assert.ok(!/from\s+'[^']*bili-api|bili-api\.mjs/.test(code), 'MCP 层禁止直连 bili-api.mjs（必须过 traffic 闸）')
  ```
  这条**守的是"绕过风控闸"这个实质问题**，属合理用法。
- `tests/perm-tier.test.mjs:12,17,22,23,29,35`——**本席位判定为真正的假绿/易碎集中点**：
  ```js
  const src = (p) => fs.readFileSync(path.join(toolsDir, p), 'utf8')
  assert.ok(s.includes('tierQueues(') && s.includes(`readPolicy(`), …)
  assert.ok(fav.includes('checkRules'), 'fav 的五判据不能被顺手删')
  assert.ok(src('commands/like.mjs').includes('30 * DAY'), 'like 要保留 30 天去重…')
  assert.ok(s.includes("go-gate.mjs"), `${f} 必须保留 go-gate`)
  ```
  问题两条：(a) `30 * DAY` 写成 `30*DAY` 就红——**无意义假红**；(b) 行为改坏但字面量还在就**不红**。而且第 29 行断言的 `go-gate.mjs` **在仓库里不存在**（`docs/ARCHITECTURE-2026-11.md:133` 也引用 `tools/go-gate.mjs`，我的扫描把它列为 MISSING）。→ 这一条属"门禁指向不存在的实现"，是本席位找到的最实的一个小洞（非阻塞，但应改成行为断言）。
- `packages/cap-bilibili/tests/bili-profile.test.mjs:192-197`——正向例子：遍历自身源码，断言 `MIXIN_TAB = [` 字面量**只有一处且必须在 `platform/wbi.ts`**。这是防复制粘贴漂移的合理形式。

**综合判定**：不存在"成建制假绿"。③ 类 ≈2–3%，其中 2 处是正当适应度函数，1 处（perm-tier）是应改造的易碎断言。②类只有 5 个文件，**mock 泛滥这一典型 vibe-coding 病在本仓基本不成立**——反证是：151 个测试里 `assert.*` 调用共 **3305** 处（平均每文件 21.9 处），且 39 个文件真起子进程。

**④另有一类正向证据值得记**：`scripts/run-mjs-tests.mjs:7-11` 的注释说明它为什么放弃"手写文件清单"和"传参计数"：
> 删掉一个测试文件，清单仍"自洽"，门禁会静默变绿……`EXECUTED = files.length` 是传参算的、同义反复，防不住改名、进 SKIP 名单、零断言空文件。

这不是事后辩解，commit `07ff556`（2026-11-05 11:47）的正文记录了配套的**变异验证**（"形状断言放在真 git 那条链上，并做变异验证（退化成只给名字 → 断言变红）"）——主动证伪自己的测试，是本席位在整个评审里看到的最强的一条质量信号。

---

## ③ 门禁与脚本清单判定

### 3.1 规模与"仍在长"

`scripts/` 顶层实测 **52** 个条目（49 `.mjs` + 1 `.sh` + `hashes.json` + `start-cortico-firewall.cmd`）。
**注意**：我 21:0x 第一次 `ls` 得到 51，21:10 另一会话新增 `scripts/verify-inbox-live.mjs`（`ls -la` mtime = `Nov 6 21:10`，`git status` 显示 `??` 未跟踪）→ 变成 52。脚本数量在本次评审的 30 分钟内就在增长。

### 3.2 归类（按每个脚本头部文档实测）

| 类别 | 数量 | 代表文件 |
|---|---|---|
| **每次改动必跑（`npm run gates` 链上）** | 6 | `check-mjs-syntax.mjs`(126)、`run-mjs-tests.mjs`(147)、`check-consumers.mjs`(63)、`check-hashes.mjs`(62)、`check-state-roots.mjs`(129)、`check-live-drift.mjs`(278) |
| **手动评测/审计（只读）** | 12 | `g3b-check.mjs`(209)、`observation-status.mjs`(164)、`observation-day.mjs`(101)、`observation-start.mjs`(36)、`day-report.mjs`(124)、`ops-day.mjs`(226)、`goal-audit.mjs`(63)、`wake-audit.mjs`(231)、`audit-config-migration.mjs`(155)、`cortico-health.mjs`(133)、`wordlist-hit-check.mjs`(146)、`verify-inbox-live.mjs`(107,新) |
| **构建/部署** | 5 | `build-webui.mjs`(97)、`setup.mjs`(107)、`preflight.mjs`(84)、`launch-panel.mjs`(56)、`start-cortico.mjs`(110) |
| **一次性迁移（做完就该退役）** | 5 | `migrate-capabilities-data.mjs`(189)、`migrate-causal.mjs`(52)、`migrate-state-roots.mjs`(173)、`import-legacy-config.mjs`(256,新)、`repair-memory-source.mjs`(77) |
| **一次性诊断/取证** | 6 | `action-watch.mjs`(91,头部明写"一次性")、`bench-vision.mjs`(53)、`counterfactual.mjs`(151)、`simulate-rhythm.mjs`(99)、`preview-recall.mjs`(29)、`live-code-anchor.mjs`(120) |
| **审批/写路径（本次未运行）** | 5 | `ack.mjs`(151)、`dm-approve.mjs`(156)、`dynamic-approve.mjs`(214)、`purge-acceptance-residue.mjs`(184)、`ops-backup.mjs`(228) |
| **运行守护/调度** | 4 | `day-watchdog.mjs`(206)、`day-snapshot.mjs`(207)、`c2-offline.mjs`(123)、`c2-window.mjs`(215) |
| **杂项/已停用** | 4 | `nightly-scheduler.mjs`(22,头部明写"已停用（2026-10-27）")、`open-panel.mjs`(25)、`draft-dynamic.mjs`(95)、`drill-gate.mjs`(159) |
| **非脚本文件** | 2 | `hashes.json`(门禁基线)、`start-cortico-firewall.cmd`(需管理员) |

`evaluate.sh`(34) 是另一条 quick/标准/深三档验收剧本（自述借鉴 AMpath）。

### 3.3 判定

- **"坏了/指向不存在路径"的规模：实测很小。** import 静态解析只有 2 处不可解析且在 `spark-output/` 设计稿里；`check-hashes.mjs` 报"一致"，说明此前发生过的 `scripts/hashes.json` 与真实文件漂移**当前未复发**（哈希基线覆盖 10 个验收脚本+1 个契约测试）。
- **唯一实质不一致**：`scripts/` 里 `go-gate` 不存在，却被 `tests/perm-tier.test.mjs:29` 和 `docs/ARCHITECTURE-2026-11.md:133` 引用。
- **文档承诺了不存在的门禁**：`docs/README.md:169,178,224,251` 分别引用 `scripts/merge-issue-ids.mjs`、`scripts/check-issue-ids.mjs`、`scripts/check-docs-owner.mjs`、`scripts/check-docs-index.mjs`——**4 个都不在 `scripts/`**。即"文档里写着有这道门，实际没有"。
- **"一次性诊断堆着没人清"的规模：约 15 个**（一次性迁移 5 + 一次性诊断 6 + 已停用/杂项 4）。数量不小，但每条头部都有 `为什么入仓`/`已停用（日期）` 的显式说明——**是"可考古的堆积"，不是"无人认领的堆积"**。对个人项目这是可接受的取舍，我不把它升格为阻塞项；代价是 `check-mjs-syntax` 每次要扫 326 个 .mjs。
- **真正缺的是本地门禁的"最后一次运行时间"没有可信落点**：最新落盘是 `gates-2026-11-05.json`（对应 11-04T19:32Z、sha 6feec26）。HEAD 已到 a617b62、测试文件多了 31 个，**报告比代码旧 189 个用例**。这是"高频提交 + 手动门禁"结构的必然缝隙，属本席位最该提醒的一条。

---

## ④ 可重复部署结论

### 4.1 逐文件实测（字节数 / CRLF / 裸 LF / 非 ASCII 字节数）

| 文件 | bytes | CRLF | bareLF | 非ASCII | 判定 |
|---|---|---|---|---|---|
| `setup.cmd` | 292 | 20 | 0 | 0 | ✅ 合规。先 `where node` 检查，再跑 `scripts/setup.mjs` |
| `start.cmd` | 661 | 30 | 0 | 0 | ✅ 合规。preflight → `launch-panel.mjs`，端口/家目录走环境变量 |
| `start-cortico.cmd` | 109 | 4 | 0 | 0 | ⚠️ 合规但**硬编码绝对路径** `cd /d "E:\WorkSpace_Qoder\dsh-bili-whale"`（第 2 行） |
| `open-panel.cmd` | 202 | 10 | 0 | **12** | ❌ 违反本仓硬规矩。offset42 = `e5 b0 8f e9 b1 bc e9 9d a2 e6 9d bf`（UTF-8 的 `title 小鱼面板`）。影响：窗口标题乱码，**功能不受损** |
| `nightly-draft.cmd` | 164 | 4 | 0 | **18** | ❌ **真影响功能**：3 处 UTF-8 `养鱼`（offset 46/74/131）在 `D:\AI\养鱼\drafts` 里——`mkdir` 与 `>>` 重定向的路径都含中文。CP936 下会写成 mojibake 目录名 |
| `start-day-watchdog.vbs` | 288 | **0** | 5 | 0 | ⚠️ ASCII ✅ 但**行尾是裸 LF**（规矩要求 CRLF）；且硬编码 `sh.CurrentDirectory = "E:\WorkSpace_Qoder\dsh-bili-whale"` |
| `scripts/start-cortico-firewall.cmd` | 2639 | 74 | 0 | 0 | ✅ 合规，且明写"ASCII only on purpose: cmd mis-parses GBK/UTF-8 Chinese here"；`--check/--remove/--run` 三态齐全，先 `net session` 验管理员 |

**结论 4.1**：7 个入口里 5 个完全合规，`.gitattributes` 的 `*.cmd -text`（commit `540b9ba`）在机制上防止 checkout 规范化把它改坏。**剩下的坑是"规矩写了但没被机器检查"**——没有任何 `check-*` 脚本扫描 `.cmd/.vbs` 的非 ASCII 字节和行尾。若加 6 行到 `check-mjs-syntax.mjs` 旁边即可根治。`D:\AI\养鱼\` 目录在本机确实以正确中文名存在（`ls -d /d/AI/*/`），所以 nightly-draft 的 mojibake 风险**尚未留下可见的错名目录**（可能是它很少跑，或由别的工具建过目录），属"潜在而非已损"。

### 4.2 换一台机器能不能一步起来

**不能一步，但差得很有限。** 阻塞点全在硬编码，共 4 处：

1. `start-cortico.cmd:2` → `E:\WorkSpace_Qoder\dsh-bili-whale`（应 `%~dp0`，同仓其他 .cmd 已经这么做）。
2. `start-day-watchdog.vbs:4` → 同上绝对路径。
3. `scripts/start-cortico.mjs:26-28` → `CORTICO = process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico-up'`（有环境变量兜底，默认值是本机路径）；`NODE = 'C:/Program Files/nodejs/node.exe'`（第 30 行，Windows 下写死）。
4. `nightly-draft.cmd` → `D:\AI\养鱼\drafts` 机器专属盘符。

正向证据：`setup.cmd`/`start.cmd` 完全用 `%~dp0` + `%WHALE_HOME%`/`%PANEL_PORT%`/`%BILI_WHALE_CONFIG%` 环境变量；`preflight.mjs:22` 明确检查 Node 主版本（实测输出 `v24.16.0（要求 ≥20）`）；`start-cortico.mjs` 里 `systemCaFlags()` 按 Node 版本决定是否加 `--use-system-ca`（注释解释本机 SteamCommunity 302 的 hosts 劫持导致 `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`）——**这是把"我这机器为什么出不了网"写成了代码分支，而不是写进 README 让人背**。

### 4.3 重启是谁做的 / "代码已提交但线上跑旧进程"的窗口

- **重启由脚本做，不由测试或门禁做**：`start-cortico.mjs` 是"单实例启动器"，语义是幂等的——已在跑就 `POST /api/run/resume` 不新开；pid 文件在 `~/.dsh/bili-whale/control/cortico.pid`（实测存在，6 B，mtime `Nov 6 20:16`；日志 `cortico.log` mtime `Nov 6 21:14`，说明进程确在跑）。
- **窗口真实存在，且已被专门门禁覆盖**。`scripts/check-live-drift.mjs` 头部原文：`线上漂移门禁：查"代码对了，线上还是旧的"。为什么加这个（2026-11-04 一天内踩了两次，都是靠人想起…）`。我今天实跑它的 14 项全绿，含：部署的 CONSTITUTION/ORIENTATION 与正本字节一致、线上 persona-core 指向 `packages/persona-core`、两个 capability 的 `describe.json` 与源码一致（13/18 个工具）、9 个 webui 产物"是新的"（带字节数与闭包文件数）。
- **版本/构建号自检：有，但不在启动横幅里**。`launch-panel.mjs`（57 行）grep `version|gitSha|rev-parse|createHash|build` **0 命中**；`preflight.mjs` 只校 Node 版本；`start-cortico.mjs` 同上。自检分布在别处：`package.json` `version: 0.5.2`、commit `d43c2b5 feat(build): A4 版本缓存自动化——产物哈希写进 patch 版本位`（产物哈希进版本号）、以及每次测试报告带 `gitSha`（`run-mjs-tests.mjs:47-50`，注释："没有 sha 的报告过两周就没法对账"）。
  **缺口**：`check-live-drift` 是**手动**跑的。启动路径上没有任何一处把"进程起来时的 SHA"落盘，因此今天这种"commit 00:39 / 进程 23:34"只能事后靠人比对。最小改法：`start-cortico.mjs` 写 `control/cortico.json` 时顺带记 `git rev-parse HEAD`。**这条我列为最该做的第 1 件事。**

---

## ⑤ 数据卫生与并发

### 5.1 备份/快照文件：实测数量与大小（任务书前提不成立，以下为真实对象）

真实运行时家目录 = `C:\Users\Administrator\.dsh\bili-whale\`（不是 `data/persona/`）。

| 文件 | 字节 | mtime |
|---|---|---|
| `fields.json`（正本） | 77,120 | 11-04 23:25 |
| `fields.json.bak` | 77,170 | 11-04 02:45 |
| `fields.json.bak-1793508964723` | 59,351 | 11-01 12:56 |
| `fields.json.330848.rn4uzg.tmp` | 59,286 | 11-01 13:32 |
| `~\.dsh\bili-whale.config.json.bak-20261027` | 1,959 | 10-27 14:48 |

`.dsh` 全树（maxdepth 4）匹配 `*.bak*` / `*pre-purge*` / `*.tmp`：**5 个文件，合计 198,218 B**。`*pre-purge*` 在 `/e/WorkSpace_Qoder`、`/c/Users/Administrator/.dsh`、`/d/AI` 三处 maxdepth 7 搜索**全部 0 命中**。

**判定：**
- **没有轮转与保留策略**：`fields.json.bak` 与 `fields.json.bak-<epoch毫秒>` 是**两套不同的命名约定并存**（后者 `1793508964723` 不是合法当前时间戳，量级偏离，人无法从名字判断它是哪天）。回滚时**人不能可靠选对文件**——正本 77,120 B 与 `.bak` 77,170 B 只差 50 B、时间差 21 小时，而 `.bak-1793508964723`（59,351 B）比正本小 23%。没有 manifest 说明该回滚到哪一份。
- **`fields.json.330848.rn4uzg.tmp` 是 5 个文件里最实的一个问题**：它是 `330848` 进程留下的临时件，mtime 11-01 13:32，至今 5 天未清 → 说明**原子写的失败分支上没挂 after-fail 清理**（正好对应 commit `913ec7b … + 写盘改名重试（Windows EPERM 门禁随机红）`：加了重试，但放弃重试时那个 tmp 就留在那儿了）。
- **好消息：备份机制本身是有的**，`scripts/ops-backup.mjs`(228 行) 头部明写覆盖 `fields.json / causal.jsonl / days/<日期>`，且 `docs/evidence/restore-drill-2026-11-01.md` + `backup-2026-10-29/` 说明**做过恢复演练**。缺的只是"临时件回收 + 命名统一 + 保留策略"。

### 5.2 `control/` 目录：混合倾倒场

实测 40 个条目挤在一个目录：常驻日志（`cortico.log` **1,095,690 B**、`day-watchdog.log` **133,848 B**）、pid（`cortico.pid`、`day-watchdog.pid`）、C2 一次性取证（`c2-preflight-20261029T2135.json`、`c2-verify.out.log`、`c2-window-plan.json`…）、按日的 `voice-2026-10-29.json … voice-2026-11-03.json`、以及**账本数据**（`feedback.jsonl` 38,930 B、`judgment.jsonl` 476 B、`life.json`、`queue.json`）。
**判定**：日志**无轮转**（`cortico.log` 已 1.09 MB 且当天还在写）；一次性取证与长期账本同层混放，`ops-day.mjs`/`g3b-check.mjs` 要在这堆里找当前态。这解释了 §5.1 的"人回滚时选不对文件"不是偶发而是目录组织方式的结果。

### 5.3 `core-state.json` / `migration-ledger.json` / `instance.lock` 的语义与并发保护

- **三者都不在本仓**。实测：`core-state.json` → 仅 `E:\WorkSpace_Qoder\Cortico\deployments\mybot\data\core-state.json`；`instance.lock` → 仅 `E:\WorkSpace_Qoder\Cortico\.spike-home\mybot\data\instance.lock`；`migration-ledger.json` → **全工作区 0 命中**（此名称在本机不存在）。
- `instance.lock` 的实现是**宿主侧、且相当扎实**：`../Cortico-up/src/core/instance-lock.ts:1-8` 头部原文：
  > 单实例锁按 dataDir 隔离，防止同一数据目录被多个进程并发写入。使用 wx 排他创建；陈旧锁通过临时文件、rename 和读回核对接管，竞争失败则拒绝启动。force 仅放行当前进程，不取得锁所有权…PID 复用:锁 startedAt 早于本机开机时刻，或该 PID 现在的可执行文件名与锁里记的 execPath 不同，都按陈旧锁处理。

  带 `InstanceLockedError`（第 27-37 行）。`src/bot.ts:34` 与 `src/providers/webui/hub.ts:17`（`instanceIsRunning`）实际接线。
- **判定：`instance.lock` 真的防双起——但它防的是"同一 dataDir 起两个 Cortico"，防不住本席位关心的那类并发**。本仓自身的双起保护是 `start-cortico.mjs` 的 `pid + alive() + health()` 三重判据加端口探活（实测第 43-63 行逻辑），够用。
- **防不住的正是今天实际发生的**：另一个会话在**同一工作树**里改源码。这是 git 层面的并发，`instance.lock` 与 pid 文件都不覆盖。直接证据见 §5.4。
- 相关的"多写者"风险已被 `check-state-roots` 覆盖（我实跑输出：`✓ 没有绕过表的路径，也没有多写者`），但同一跑里报出 **6 个键新旧两家分叉**：`api-cache、dm-await-state、dm-quota、feed-search-cache、pending-replies、traffic-state`（新家 `C:\Users\Administrator\.dsh\bili-ai` vs 旧家 `C:\Users\Administrator\.bili-ai`，表里声明 24 类而调用点只用 12 类）。**这条警告不使门禁变红**（EXIT=0）。结合 commit `d8248e6 fix(state-home): 待审回信的读侧跟着写侧搬家，面板不再显示 0 条`、`1764de8 fix(ops): 体检第三处假阳性（读错了家）`、`11d69eb fix(state): 状态读写全收敛到 paths.mjs，读数不再分两家`——**"读错了家"是本项目反复出现的结构性坑（文档自述已到"第三处"），而现在的门禁只提示不拦。**

### 5.4 并发实证（本次评审期间抓到）

- 评审开始时 `ls -1 scripts/` = **51**；21:10 另一会话新建 `scripts/verify-inbox-live.mjs`（5,910 B，`git status` 为 `??`），我再数 = **52**。
- `git status --porcelain` 从评审开始的 11 条增长到 `?? scripts/verify-inbox-live.mjs` 出现后的 12 条。
- 工作区在我跑全量测试时处于**未提交状态**（6 个 ` M`：`packages/cap-bilibili/src/index.ts`、`packages/cap-bilibili/tests/bili-connection.test.mjs`、`packages/cortico-bot-xiaoyu/src/cortico-persona.ts`、`packages/cortico-world-bilibili/src/index.ts` 等 + 5 个新增文件，其中含新测试 `tests/inbox-listener.test.mjs`、`packages/cortico-bot-xiaoyu/tests/rhythm-outlets.test.mjs`）。
- **判定：任务书提出的"未提交改动被并行会话吞掉"的风险在本机是活跃的、非理论的。** 现有防线只有 git 本身；没有任何 lock/sign-off 文件（`control/` 里没有 worktree-lock 之类的东西，实测 40 个条目中无此类）。
- 顺带一条与作者自省的记录：commit `2793789 fix(tools): 库里不再杀进程——attemptWrite 抛可捕获的 WriteRefusedError` + `a125397 fix(hygiene): 验收脚本不许再拿线上实例跑写路径（我把她弄脏的那次是我的错）` + `265e7c5 … 清出去 + 两道防复发` → **说明"验收脚本污染真实数据"确实发生过并被清理**，这正是任务书里 `pre-purge` 一类快照的历史来源（清理脚本 `purge-acceptance-residue.mjs` 存在，184 行）；只是残留在本次实测中已被清干净，找不到。

### 5.5 `.gitignore` 覆盖情况

实测：`scratch-tick-analysis.mjs` **已不在工作区**（`ls` 报 No such file），`git ls-files` 里 **0 个** `.log/.bak/.tmp/pre-purge/scratch/orig/dump` 类文件（跟踪文件共 690 个）。`suite.log`（15,128 B，mtime 11-05 23:38）在仓库根**但被 `.gitignore` 的 `*.log` 覆盖**，未进版本库。
**判定：这一维没问题。** 证据是 `git ls-files | grep -Ei '\.(log|bak|tmp)$|pre-purge|scratch|\.orig'` → 空输出；`.gitignore` 除常规项外还显式挡住了凭据与私人内容（`credentials.json`、`panel.token`、`whale-diary*.md`、`bili-whale.config.json`）。"临时物被当正式物提交"的规模：**0（跟踪集内）**。唯一遗留是根目录有 `suite.log` 这类落点未收进 `control/` 或 `docs/evidence/`，属整洁问题不是卫生问题。

---

## ⑥ 故障史归纳表

来源：`git log --grep`（全部 512 提交）+ `docs/` 关键词命中 + 本机实测。计数口径写明，不外推。

| # | 反复出现的坑 | 出现过几次（证据） | 是否根治 | 现在靠什么防 | 本席位评估 |
|---|---|---|---|---|---|
| 1 | **协作者接口形状假设错**（`core.log` 是 Logger 对象不是 `(level,msg)` 函数） | **至少 4 次**，跨 4 个位置：①`311c7c7 fix(bot): 修掉 08:24 那次线上崩机——core.log 是 Logger 对象，不是 (level,msg) 函数`；②`d5db2c1 fix(reflect): core.log 是 Logger 对象不是函数——反思路径整条被它炸掉`（两条不同路径确认）；③`645dfd9 fix(bot): 她"醒着却不动"的真正原因——onDelivery 的宿主形状假设错了 + 做梦从没跑过`；④`07ff556 … 存档点那行渲染成 undefined`（`GitStatus.tags: string[] → checkpoints: CheckpointInfo[]`），同形状类。`git log --grep=core.log` = 2 提交、`docs/` = 2 文件 | **部分根治**：类型层修，但机制上 `cortico-adapter` 包 460 行、**0 个测试文件**（实测），宿主契约仍主要靠线上崩了才发现 | 事后补的**契约测试**目录 `tests/contract/`（39 个文件，如 `host-contract.test.mjs`、`m1a-observability.test.mjs`）+ `packages/cortico-bot-xiaoyu/tests/host-contract.test.mjs`；`check-consumers.mjs` 防"写了没接线"；`07ff556` 记录做了变异验证 | 本项目**代价最高的一类**。建议方向明确：给 adapter 边界加一份"宿主返回形状"的 fixture 快照，而不是逐处补断言 |
| 2 | **退役目录搬移 → 测试 import 老路径**（`ERR_MODULE_NOT_FOUND`） | `git log --grep=退役` = **9** 提交、`docs/` = 15 文件；`git log --grep=retired` = 1；`ERR_MODULE_NOT_FOUND` 字面在 commit message = **0**（该次事故记在 docs 而非 commit 标题） | **当前已根治**：407 个 .ts/.mjs 全量静态解析 → **仅 2 处不可解析**，都在 `spark-output/flow-web/day-client.design.ts:12-13`（非生产代码） | `check-mjs-syntax.mjs`(326 文件) + 测试真跑（runner 会因模块加载失败让该文件 exit≠0，且 `NOT_RUN=` 显式列出） | 状态良好。`check-consumers` 仍会把 `legacy/bili-account-retired/*.ts` 当调用点计入"有生产调用"（实测输出 5 行 OK 指向 `legacy/`，而 `legacy/` 不在本仓、在 `../Cortico-up/legacy`）→ **轻微不一致**，属可绕过的小问题 |
| 3 | **前端资产哈希/缓存 → 面板空白、404** | 相关提交实测：`5824a45 fix(webui): styles.css 404 修复与全面板带样式复验`、`f1f0bf1 fix(vision): 面板五轮浏览器复验的四个真 bug`、`96f9b60 … 真浏览器联调修四处契约不匹配`、`13e1f90 chore(webui): 跟上批次 10 的面板产物与内容哈希版本`、`18a5231`、`ff58abc`、`d43c2b5 feat(build): A4 版本缓存自动化——产物哈希写进 patch 版本位`（`docs/` 命中"面板空白" = 1 文件） | **基本根治**：哈希写进 patch 版本位 + 产物随源码提交 | `check-live-drift.mjs` 的 9 项 `… webui 产物是新的：NNNNN B，闭包 K 个文件`（我实跑全绿） | 有专门的漂移检查覆盖，属做得好的部分 |
| 4 | **Windows 文件占用 EPERM → 门禁随机红** | `git log --grep=EPERM` = **4** 提交、`docs/` = 2 文件；关键提交 `913ec7b feat(memory): 核心常驻退位审阅台 + 写盘改名重试（Windows EPERM 门禁随机红）`；`07ff556` 正文另记"**顺带修两处门禁随机红**：面板/启动器测试随机抢端口（撞上 OFM 代理 18910）→ 先探端口；心跳噪声测试靠墙钟睡觉 → 改成等真的排进来至少一拍"；`0d721e5 test(panel): 修掉一个假红——并发时没人读 stderr，面板子进程被管道卡住` | **未完全根治**：加了 rename 重试，但**放弃重试后 tmp 不回收**——实测残留 `fields.json.330848.rn4uzg.tmp`（59,286 B，11-01 13:32 至今 5 天） | rename 重试 + 端口先探 + 用真事件替代墙钟等待 | 第五类由此浮现（见下行 #5）。建议：捕获 EPERM 放弃时把 tmp 移到 `.trash/` 或直接 `rm` 已存在同 pid 的 tmp |
| 5 | **（新）**测试自身的平台/时序不免疫：抢端口、靠墙钟、并发管道卡死、对本机 `DSH_HOME` 不免疫 | `4bc7825 fix(tests): 两个测试对本机 DSH_HOME 不免疫——其中一个还在读写生产状态目录`；`07ff556`（两处随机红）；`0d721e5`（假红）；`880/2793789` 相关 | **趋势向好**（每次都是当场修 + 写进 commit 正文） | 单文件单进程执行（`run-mjs-tests.mjs:84`）隔离性好；但 **runner 不采 `skipped` 计数**（§2.1）→ 被 skip 挡掉的用例不进视野 | 属"门禁可信度"问题，成本低的补法：`pick('skipped')` 一行 |
| 6 | **（新）"读错了家"：状态读写分两家（新 `~\.dsh\bili-ai` / 旧 `~\.bili-ai`）** | `1764de8 fix(ops): 体检第三处假阳性（读错了家）`（**自述第三处**）、`11d69eb fix(state): 状态读写全收敛到 paths.mjs，读数不再分两家`、`d8248e6 fix(state-home): 待审回信的读侧跟着写侧搬家`、`140f…` 相关；`git log --grep=两家` = 2 提交、`--grep=分叉` = 6 提交、`docs/` 分叉 = 11 文件 | **未根治**：我今天实跑 `check-state-roots` 明确输出 `· 新旧两份已经分叉（读新家，但旧家仍是老值）：api-cache、dm-await-state、dm-quota、feed-search-cache、pending-replies、traffic-state`（**6 个键**） | 表化：`check-state-roots.mjs`（"表里声明 24 类；调用点用了 12 类"）+ `paths.mjs` 收敛 | **最该升格的一条**：门禁看见了、报出来了、但**以 exit 0 放行**。12/24 的覆盖率意味着一半声明无人核对 |
| 7 | **（新）`.cmd`/编码/行尾**（GBK mojibake + checkout 规范化） | `540b9ba chore: .cmd 钉住 CRLF（-text），防 checkout 规范化后批处理乱解析`；`git log --grep=乱码` = 1、`--grep=GBK` = 1；`start-cortico-firewall.cmd` 注释、`start-day-watchdog.vbs` 注释各写一条 ASCII 警告 | **机制上根治了"被 git 改坏"，未根治"人写出非 ASCII"**：实测 `open-panel.cmd`（12 非 ASCII 字节）、`nightly-draft.cmd`（18 字节，且在路径里）违规，`.vbs` 行尾是裸 LF | `.gitattributes` `*.cmd -text` + `vendor/** -text`（实测内容）；靠注释提醒 | 无自动检查。**这是唯一一个"有硬规矩、有历史事故、却没有门禁"的维度**，而补上只要十几行 |
| 8 | **（新）"代码对了、线上是旧的"** | `git log --grep=旧进程` = 0 提交但 **5 个 docs**；`--grep=漂移` = **12 提交 / 32 文档**；`check-live-drift.mjs` 头部自述"2026-11-04 一天内踩了两次，都是靠人想起" | **有专门门禁**（14 项实跑全绿），但**手动** | `check-live-drift.mjs` + `live-code-anchor.mjs`(120 行，锚定"协议里写了但机器没管住") + 报告带 `gitSha` | 缺"启动时自动记 SHA"，见 §4.3 |
| 9 | **（新）验收脚本污染真实生活数据** | `a125397 fix(hygiene): 验收脚本不许再拿线上实例跑写路径（我把她弄脏的那次是我的错）`、`265e7c5 fix(hygiene): 把验收脚本污染进她真实生活的条目清出去（批次 10 · F5）+ 两道防复发`、`scripts/purge-acceptance-residue.mjs`(184 行) | 已建防复发；实测当前 `.dsh` 树无 `pre-purge` 残留 | `check-state-roots` 的"没有多写者" + 审批脚本强制 dry-by-default（`dm-approve.mjs`、`dynamic-approve.mjs` 头部均写"默认 dry：不发送"） | 处理得比较到位，且诚实记录了责任归属 |

**归纳**：9 类里，第 1 类（接口形状）与第 6 类（状态两家）是**结构性且仍未闭合**的；第 4、5 类（Windows/时序导致的随机红）是**反复但每次当场修**的；第 2、3、9 类基本已闭合。第 7 类最"便宜"——规矩已写、事故已过、只差一道自动检查。

---

## ⑦ 文档一致性抽样

**总量（实测，非外推）**：`docs/` 递归共 **125** 个 `.md`/`.json` 文件（顶层 59 个条目，含 `evidence/`、`team-2026-11-01/`、`team-2026-11-03/` 三个子目录）；文档中的代码路径引用共 **1,278** 处提及 / **323** 个不同路径；解析后**不存在的路径 34 个**（占不同路径 **10.5%**）。

**这 34 个的性质要分开看，不能一概论罪**：

- **属"历史提案/点状快照"的（合理）**：`docs/ARCHITECTURE-DECOUPLING-2026-11-01.md:316` 引 `docs/evidence/gates-before-A.json`、`:869` 引 `scripts/migrate-drafts.mjs`；`docs/ARCHITECTURE-TARGET-2026-11-03.md:291-295` 引 `packages/cap-memory/src/memory-ops.ts`、`packages/cap-bilibili/src/client/dm.ts`、`src/config.ts`（目标态，本就该"尚未存在"）。这类带日期后缀的审计/提案文档占多数。
- **属"当前状态文档说了不存在的东西"（应修）**：
  - `docs/README.md:169,178,224,251` → `scripts/merge-issue-ids.mjs`、`scripts/check-issue-ids.mjs`、`scripts/check-docs-owner.mjs`、`scripts/check-docs-index.mjs` **4 个门禁脚本不存在**。这是最伤"可交接性"的一类：新读者会照着 README 去跑不存在的门。
  - `docs/ARCHITECTURE.md:257` → `docs/PORT-LEDGER.md` 不存在；`:423` → `packages/shared/src/field-engine/emotion-projection.ts`、`:459` → `packages/server/src/engine/business/life-generator.ts`（`packages/shared`、`packages/server` 两个目录本仓**根本不存在**——实测 `ls packages` 只有 11 个 cap-*/cortico-*/persona-core）。这两条像是从**另一代架构**（旧 monorepo）留下的正文。
  - `docs/team-2026-11-01/round3/config-surface.md:108` → `core/config.ts` 不存在；`docs/PRODUCT.md:110` → `tools/commands/upload.mjs` 不存在；`docs/REUSE-MATRIX.md:51` → `tools/commands/dm-read.mjs` 不存在；`docs/MODULARITY-2026-10-30.md:64` → `assets/avatar/manifest.json` 不存在。

**"当前状态"类文档与实际 HEAD 的一致性**：

- 本仓**没有 `docs/STATUS.md`**（任务书假定有）。真实集合是 `docs/STATUS-2026-11-01.md`、`docs/CURRENT.md`、`docs/BASELINE.md`、`docs/INDEX.md`、`docs/ISSUES.md`、`docs/BACKLOG-2026-11-04.md` + 根 `CHANGELOG.md`。**判定**：状态用"按日期分文件"而非"单一活文档"，好处是保留负结果与历史现场（符合 `agents.md` 的"保留负结果"），代价是**没有一个权威入口回答"现在是什么状态"**——11-06 当天 15 次提交之后，最新的日期型状态文档停在 11-04，唯一的"活"入口是 `docs/CURRENT.md`/`INDEX.md`。我没有逐一核对 `CURRENT.md` 的每条断言（工具预算用尽），此项列入 §9。
- **一致性有一条硬证据是好的**：`docs/evidence/` 里最新一份 `gates-2026-11-05.json` 的 `gitSha=6feec267…`，而 `6feec26` 确在历史中（`git log --oneline` 第 36 行，"chore(spec): 收下「小鱼控制台改版」设计输入…"），**报告与其声明的 SHA 自洽**，不是手抄的数字。这是该项目交付卫生做得最扎实的一点：**文档只引路径不抄数字**（`run-mjs-tests.mjs:10` 注释原文）。

---

## ⑧ 最该先做的 3 件事

（按"性价比 × 是否影响'维护住'"排序，全部不含重构）

1. **让线上进程自己带上 SHA：`start-cortico.mjs` 写 pid 时一并落 `control/cortico.json = {pid, gitSha, startedAt, CORTICO_ROOT, CORTICO_HOME, BOT}`；并把 `check-live-drift` 从手动挪到 `start-cortico` 的前置。**
   理由：这是本项目代价最高、复现最频繁的一类（`--grep=漂移` 12 提交/32 文档；门禁头部自述"一天内踩了两次，都是靠人想起"），而 `check-live-drift` 的 14 项今天实跑全绿——**能力已经有了，缺的只是让它在启动路径上自动执行**。改 `start-cortico.mjs`（110 行）与 `run-mjs-tests.mjs:44-50` 已有的 `gitSha()` 复用即可。

2. **把 `check-state-roots` 的"新旧两家分叉"从提示升格为失败（或显式白名单 + 到期日）。**
   理由：我本机实跑输出 6 个键分叉（api-cache、dm-await-state、dm-quota、feed-search-cache、pending-replies、traffic-state）、"表里声明 24 类 / 调用点用了 12 类"，**EXIT=0**。同类坑历史上至少"第三处"（commit `1764de8` 自述）。**当前状态是"门禁看见了但放行"**——这正是最危险的门禁形态。同时补上"调用点覆盖 12/24"这一半的空洞。

3. **一条 20 行的 `check-cmd-hygiene`：扫全部 `.cmd/.vbs` 的非 ASCII 字节 + 行尾必须 CRLF；顺手把 `run-mjs-tests.mjs` 的 `pick('skipped')` 补上（1 行）。**
   理由：`.cmd` 纯 ASCII + CRLF 是本仓**写在规矩里、出过事故（`540b9ba`、`--grep=乱码`/`GBK`）、却没有自动检查**的唯一维度；今天实测 `open-panel.cmd`（12 字节非 ASCII）、`nightly-draft.cmd`（18 字节，且出现在 `D:\AI\养鱼\drafts` 的**路径**里）、`start-day-watchdog.vbs`（CRLF=0，裸 LF）三处违规。另外 `start-cortico.cmd:2` 与 `start-day-watchdog.vbs:4` 的硬编码 `E:\WorkSpace_Qoder\dsh-bili-whale` 应换成 `%~dp0` / 相对定位——这是"换机器起不来"的 4 个阻塞点里最容易消掉的 2 个。补 skip 计数则让"860 pass"这个数真正可解释。

**明确不建议做的事**（避免本席位反向偏差）：不要为 `scripts/` 里那 ~15 个一次性/已停用脚本做清理工程——每条头部都有"为什么入仓 / 已停用（日期）"，是可考古的堆积，清理它的收益低于风险。不要因为 `tests/perm-tier.test.mjs` 的源码文本断言就推翻测试体系——该文件的问题（含对不存在的 `go-gate.mjs` 的断言）值得单独改造，但 151 个测试里此类只占 2–3%。不要引入 GitHub Actions——`agents.md` 明写"额度不足、本地验证可作为当前证据"，而现在这套本地门禁的实际拦截力已高于多数 CI 配置。

---

## ⑨ 我没查清的东西

1. **`skipped` 的确切数量**：runner 不采该字段（§2.1），我没有重跑全套去逐文件抓 `ℹ skipped`（受"不为获得正向指标反复付费运行"约束，只跑一次）。静态兜底只给了"5 处 skip 标记 / 3 个文件"。
2. **`gates` 链的第二段**：`npm run gates` 里含 `run-mjs-tests.mjs --root ../Cortico-up --import tsx`——**跑的是宿主仓库的测试**，且需要 `tsx`（本仓 `node_modules` 不存在，纯 `--experimental-strip-types`）。我没有跑这一段（它会驱动另一棵工作树），因此**跨仓那半的门禁强度完全未实测**，`check-consumers` 输出里出现 `legacy/` 路径也说明扫描根不止本仓。
3. **今天"commit 00:39 / 进程 23:34"的现场时刻**：机制侧证据齐全（门禁存在、自述"一天踩两次"），但具体时刻与当时进程实际跑的 SHA 我没有独立复核。标 **仅自述**。
4. **`migration-ledger.json`**：全工作区 maxdepth 7 搜索 0 命中，名称在本机不存在。不确定是（a）已改名、（b）在 Cortico 宿主侧另一目录、（c）任务书记错。我没有去宿主仓穷举。
5. **`docs/CURRENT.md` / `docs/INDEX.md` 的逐条断言**：我只做了路径存在性的机器扫描（34/323 缺失）与最新 evidence 的 SHA 自洽核对，**没有人工逐条核对文字性状态断言**。要断言"当前状态文档与 HEAD 一致/不一致"，我这轮的深度不够。
6. **`fields.json.bak-1793508964723` 的命名来源**：该毫秒值换算不是近期时间戳，我无法确定它是随机后缀、被截断的 UUID、还是旧版命名格式。因此"两套命名约定并存"是实测，但**成因是假设**。
7. **并发写吞改动的实际损失**：我观察到了并行会话新建文件（`verify-inbox-live.mjs`，21:10）这一事实，但**没有证据表明已有未提交改动被覆盖**——那是风险，不是已发生的损害。

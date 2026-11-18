# 摘除第二宿主克隆 `Cortico` · 前置施工指令（**禁止直接删除**）

> 主人已同意"最理想只有一个仓库，删掉多余的"。第三方实测发现 `E:/WorkSpace_Qoder/Cortico` **不是冗余克隆**，直接删会毁掉回滚能力并静默打断一批脚本。故本指令只安排前置工程，**最后一步的删除由第三方在复核通过后执行，或由主人当场确认执行**。

## 一、为什么现在不能删（实测证据）

1. **它是唯一的回滚点**：`Cortico/deployments/mybot` 有 **703 个文件**（`config.json`、`deployment.json`、`data/`、`prompts/`、`workspace/`、`avatar.png`、`figure/`、`figures/`、`bilibili/`、`bilibili-audience/`、`providers/`、`alarms.json`）。`dsh-bili-whale/scripts/start-cortico.mjs:20-22` 自己写着"那是**回滚点**，cormini 人格"，并给出用法：`CORTICO_HOME=E:/WorkSpace_Qoder/Cortico/deployments CORTICO_BOT=mybot node scripts/start-cortico.mjs`。
2. **七个脚本的默认路径指向它**，且**没有任何地方覆盖**：
   - `scripts/day-watchdog.mjs:17` → `process.env.CORTICO_ROOT || 'E:/WorkSpace_Qoder/Cortico'`
   - 同类硬默认：`counterfactual.mjs:13`、`drill-gate.mjs:12`、`simulate-rhythm.mjs`、`smoke-tools.mjs`、`wake-audit.mjs`、`start-cortico.mjs`（文档注释）、`run-mjs-tests.mjs:6`（示例）
   - 已逐一确认 **`CORTICO_ROOT` / `CORTICO_HOME` 未设置**：`.env`、`config.json`、`*.cmd`、`*.vbs`、用户级环境变量、机器级环境变量、线上进程命令行 —— 全部为空。**所以这些默认值是活的，不是死代码。**
3. git 内容本身确实可弃（这点我验过了，别反过来当依据）：工作树 0 脏、stash 0、`master` 零独有提交；`dev/policy` 上 3 个"不在任何 remote"的提交（`fe4392c`/`480d456`/`9158aaa`）其 subject 已分别在 `Cortico-up` 以 `c3cb8ff`/`fe6484b`/`9168190` 存在（reanchor 重放换 SHA）。**结论：历史无独占，但文件系统有独占。**

## 二、要做的事（顺序不可颠倒）

**S1｜把回滚点搬到一个明示位置。**
建议 `Cortico-up/deployments/rollback-mybot/`（或 `~/.xiaoyu-home/rollback/mybot/`，二选一，选完在文档里写死）。搬完必须能按新路径复现 `start-cortico.mjs` 那条回滚用法，并把 `start-cortico.mjs:20-22` 的注释与示例同步更新。
- 不许只搬不验：要跑一次 `node scripts/start-cortico.mjs --dry-run` 之类的只读演练；**不许真的把线上切到回滚人格**（那会改变 7799 上跑的东西）。
- 搬完核对文件数从 703 → 新位置 703，逐目录 diff。

**S2｜把默认值改成不会静默失败。** 两条一起收：
- 七个脚本的 `|| 'E:/WorkSpace_Qoder/Cortico'` 全部改成 `|| 'E:/WorkSpace_Qoder/Cortico-up'`，或者更好：**去掉硬默认，改为缺 `CORTICO_ROOT` 就明确报错并提示该设什么**（静默指向一个不存在的路径，是本项目"读错了家"那一类故障的标准形态）。
- 加一条门禁（并入 `check-live-drift` 或新开一个极小的）：**任一脚本引用 `WorkSpace_Qoder/Cortico`（不带 `-up`）即为红**。这是防复发的关键，没有它，三个月后又会长出新的硬编码。

**S3｜回滚能力落进 specs。** 按 `03-HANDOFF-DOCS-AND-SPECS.md` 的十份体制，这条属于 **10 控制面总则** 或 **运维** 那一处：写清"出问题退回哪个人格、用哪条命令、数据在哪"。别留在 `start-cortico.mjs` 的注释里 —— 注释不是回滚计划。

**S4｜回报，等复核。** 回报内容必须含：新路径、703→? 的核对结果、七个脚本的 diff、门禁故意违规能否变红、以及一句明确的话：**"回滚演练是否真的成功过"**（只做过 cp 不算）。

## 三、删除本身

S1–S4 全部复核通过后，才轮到 `E:/WorkSpace_Qoder/Cortico` 摘除。执行方式：**先 `git bundle create` 把 16 个分支全量打包到一个临时文件并验证可读回，再删目录**。这步由第三方做或由主人当场点头，**不是你的活**，也不要顺手做。

## 四、顺手澄清（回主人那句"最理想只有一个仓库"）

第三方的判断：**1 个仓做不到，2 个仓是正确下限。** 宿主必须能独立升级，挂插件靠 `extensions/package.json` 的 `link:` + `cordis.patch.yml`，合并进宿主仓等于放弃这个能力；`upstream`（原作者 Alterssss 仓）不是你的。真正让人"体感多"的是**一个目录里住着三代东西**（`packages/` 新、`core`+`panel`+`adapters` 半死、`tools`+`vendor` 旧仍被引用）加 131 篇文档 —— 这两样收拾完的收益远大于少一个 `.git`。三代残留的退役请另开批次，别塞进本轮。

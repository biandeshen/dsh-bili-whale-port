# 运维与可观测（第二轮）—— 14 天观测期的少人工、不失真方案

> 席位：运维/可观测。只研究，不改代码。所有命令均为**只读或 `--dry`/`--status` 类**，不写 B 站、不改配置。
> 现场核对时间：2026-10-31（本机 `C:/Users/Administrator/.dsh/bili-whale/`）。

---

## 0. 先说三个阻塞事实（实测，不是推测）

| # | 事实 | 证据（可直接复核） | 后果 |
|---|---|---|---|
| 0-1 | **14 天窗口还没开**。`control/observation.json` 不存在 | `node scripts/observation-status.mjs` → `观测尚未开始：G3b 通过后创建 control/observation.json` | 观测协议 §2 的每日流程现在跑不起来（`observation-day.mjs` 依赖该文件，未开窗直接拒绝）。所谓"接下来 14 天"的第 1 天要从开窗算起 |
| 0-2 | **G3b 有 1 项 PENDING** | `node scripts/g3b-check.mjs` → `PENDING 连续 3 天反事实 \| 2026-10-28: cf=ok/6 draftHash=n action=n` | 10-28 的草稿没有 `diaryHash`、当天没有她自然醒的 `kind:'action'` 记录 → 开窗被合法挡住。不许绕过（协议 §1） |
| 0-3 | **冻结清单不覆盖每日证据脚本** | `scripts/check-hashes.mjs` 的 `FILES` 含 day-report / day-snapshot / day-watchdog / counterfactual / g3b-check / observation-start / observation-status / goal-audit / c2-offline 等，**不含** `observation-day.mjs`、`wake-audit.mjs`、`action-watch.mjs`、`c2-window.mjs`、`check-hashes.mjs` 自身 | 观测期内改这几个脚本不会被 `npm run hashes` 发现，等于"验收期改判据"有后门。修法是**开窗前**把它们加进 `FILES` 再 `npm run hashes:write`，并把这次 `--write` 记进当天 `incident.md`（属于开窗准备，不算污染） |

另有一处**文档漂移**（会误导人工判读，建议在 dev 改）：`day-report.mjs` / `day-snapshot.mjs` / `counterfactual.mjs` 的文件头仍写"按 04:00 日界"，而代码里 `DAY_BOUNDARY_HOUR = 0`（自然日，2026-10-31 拍板）。人工核对"跳日"时按 04:00 想就会得错结论。

---

## 1. 每天真正必须人工看的最低限度

### 1.1 目标：把协议 §2 的 20–30 分钟压到 **6–8 分钟**

现状是 4 条命令 + 3 项肉眼只读检查 + 手写 incident。其中"肉眼检查 ticks/life.json/草稿哈希"已被 `observation-day.mjs` 覆盖（它一次收齐窗口/start/行动/草稿/cf/tainted/day-report，写 `days/<D>/observation-check.{json,md}`），可以删掉。

**最低人工清单（每天早上一次，看昨天；晚上一次，看今天是否在跑）**

| 步 | 命令（可直接抄） | 看什么 | 通过判据 | 不通过时的动作 |
|---|---|---|---|---|
| 1 | `cd E:/WorkSpace_Qoder/dsh-bili-whale`<br>`node scripts/cortico-health.mjs` | 6 个 ✓/✗ 行 | 全 ✓ | 见 §2 分诊 |
| 2 | `node scripts/observation-day.mjs --date <昨天>` | 生成的 `days/<昨天>/observation-check.md` 顶部结论 | 有稿 + `diaryHash` 有 + `cf.ok` + 无 `tainted` | 缺 → 记 `missing`；污染 → 记 `tainted` 与原因 |
| 3 | `node scripts/observation-day.mjs`（今天，只看 ticks 是否在推进） | `days/<今天>/ticks.jsonl` 行数是否每 5 分钟 +1 | 行数在涨 | 不涨 → §2 F1/F2 |
| 4 | 打开 `http://127.0.0.1:7799/` → 「小鱼 · 鱼缸」 | 体征块 + 待审稿块 + 她的一天 | 与步 2 的 JSON 一致；pending 数 = 她真的有稿等你 | 面板与 JSON 不一致 → 以 JSON 为准，记 incident |
| 5 | 写 `days/<今天>/incident.md`（**没有也要写"无"**） | 时间 / 事实 / 证据文件 | 有这一行 | — |
| 6 | `node scripts/goal-audit.mjs`（仅第 7、14 天） | A/B/C 三段 PASS/PENDING | — | — |

**只有 3 件事不允许脚本代做**（必须人眼/人手）：
1. 步 4 的"面板观感"——她是否活成一个连续的人，这是 K4 的复盘原料；
2. 步 5 的 incident 定性（是事故还是正常波动）；
3. 待审稿的 approve/reject 决策本身（`dynamic-approve.mjs` 需要 pending 令牌 + 人工 `go`）。

### 1.2 该脚本化、但目前**没有**的东西

> 命名只是占位建议，不写实现。每个都要求：`--json` 输出 + 退出码（0 干净 / 1 需人工 / 2 自身没跑成）+ 只读 + 绝不触发写通道。

| 建议命令 | 输入 | 输出 | 判据（PASS 条件） | 解决的缺口 |
|---|---|---|---|---|
| `npm run observe:open`（`ops-open.mjs`） | 无 | stdout + `control/observation.json`（唯一写动作，内部仍调 `observation-start`） | `g3b-check` 全 PASS 才放行；否则打印 PENDING 项与建议取证动作 | 现在要手敲 3 条命令且顺序易错；且 0-2 的 PENDING 需要一条稳定的"我为什么还不能开窗"回答 |
| `npm run ops:day`（`ops-daily.mjs`） | `--date`（默认昨天） | `days/<D>/ops-check.{json,md}` | 编排：`cortico-health` + `observation-day` + `proc-liveness` + `hashes` + `dm-ledger` + `backup --verify-only`；任一 fail → exit 1；输出一行"今天需要你做的事" | 把 1.1 的步 1–3 合成 1 条命令；现在是 4 次人工执行 + 4 次读屏 |
| `npm run ops:live`（`proc-liveness.mjs`） | `--json` | `control/liveness.json` | 三张表一致：① `cortico.pid` 的 pid 存活 **且** 7799 有人监听；② `day-watchdog.pid` 存活；③ 18910（OFM 代理）应答。**孤儿判定**：端口在但 pid 文件缺失/过期 = 孤儿进程；pid 在但端口不在 = 僵尸 pid 文件 | 启动器只做"活着就 resume"，不报孤儿；8447 提权残留正是这类孤儿（§2 F8） |
| `npm run ops:anomaly`（`anomaly-collect.mjs`） | `--since 26h --json` | `control/anomalies.json`（带签名） | 扫 `control/cortico.log`、`control/queue.json`、`drafts/*.json`、`causal.jsonl`、`control/life-status.json`，按 §3 的分级表产出条目，每条带 `sig=<类>:<对象>:<日>` | 现在异常分散在 5 个文件里，人工 grep；且没有"这个异常我见过了"的记忆 |
| `npm run ops:alert`（`alert-push.mjs`） | `--dry`（默认）/ `--send` | 调 `tools/commands/notify.mjs` 转发 | 只推 P0/P1；同 `sig` 24h 内不重复；每日上限 5 条；静默 23:30–07:30（除 P0） | notify 通道已有（ntfy/bark 尚未实弹），但**没有任何分级/去重/抑制层**，直接接上就是刷屏机器 |
| `npm run ops:clock`（`clock-guard.mjs`） | `--date` `--json` | `days/<D>/clock.json` | ① `ticks.jsonl` 的 `at` 单调不减且无未来时间戳；② 相邻 tick 间隔 >15 分钟标 `gap`；③ `state.start.json`/`state.end.json` 的日界与 `logicalDay()` 一致；④ 系统本地日 vs UTC 日跨零点时的归属一致 | 协议 §2 只靠肉眼"最后一行时间是否在推进"；`cortico-health` 只查 `age>=0 && <10min`，**查不到"凌晨跳了两个小时"** |
| `npm run ops:backup`（`observe-backup.mjs`） | `--day` / `--verify` | `<备份根>/obs/<D>/…` + `manifest.sha256` | 打包 §4 清单；`--verify` 重算 sha256 并逐条比对 manifest；缺文件即 fail | **全仓无任何备份脚本**（`grep backup` 只命中 `migrate-causal.mjs`/`setup.mjs` 的 `.bak` 写法），而 `fields.json.bak` 是写入副作用不是备份 |
| `npm run k4:dm`（`dm-ledger.mjs`） | `--from --days 14 --json` | `days/<D>/dm.json` + 汇总 | 见 §5 K4-1 | 现在算不出来 |
| `npm run k4:mood`（`mood-align.mjs`） | `--date --json` | `days/<D>/mood-check.json` | 见 §5 K4-2 | 现在算不出来 |
| `npm run k4:diary`（`diary-index.mjs`） | `--json` | `control/diary-index.json` | 见 §5 K4-3 | 现在算不出来 |
| `npm run ops:retire`（`panel-retire.mjs`） | `--status`（不杀进程） | stdout | 列 8447 监听者 + `panel.log`/`panel-8448.log` 最后写入时间；"今天还有新写入"= 没退役成功 | 提权进程杀不掉（已知），只能**监控它是否还在动**，否则退役是假退役 |

一句话总结：**12 个脚本，其中 `ops:day` + `proc-liveness` + `clock-guard` 三个就能吃掉大部分人工。**

---

## 2. 故障分类与处置手册

优先级动作统一前置：
```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale
node scripts/cortico-health.mjs                 # 先看是哪一段断
```

### F1 Cortico 进程死 / 假活（WebUI 200 但她不动）

- **发现**：`node scripts/cortico-health.mjs` 的 `✗ Cortico WebUI`；或 `运行状态：已暂停（POST /api/run/resume）`；或 `✗ 事件积压：behind=N`。
  ```bash
  cat C:/Users/Administrator/.dsh/bili-whale/control/cortico.pid
  curl -s http://127.0.0.1:7799/api/status
  tail -n 60 C:/Users/Administrator/.dsh/bili-whale/control/cortico.log
  ```
- **影响**：她完全停摆；`days/<D>/ticks.jsonl` 仍在长（看门狗独立），所以**只看 tick 会误判为"她还在动"**——这是最容易失真的一条。
- **恢复**：`scripts/start-cortico.cmd`（或 `node scripts/start-cortico.mjs`；已跑就只 resume，不会开第二个）。**同代码重启是协议 §5 允许的**，前提是没换代码。
- **惊动主人**：不需要（重启即回）。但必须当天 `incident.md` 写时间 + 当天可标 `late`。连续 2 天死 → 报主人。

### F2 看门狗死（观测链断，不是她的事）

- **发现**：`✗ 看门狗 tick：今日无 tick（看门狗未运行）`；
  ```bash
  cat C:/Users/Administrator/.dsh/bili-whale/control/day-watchdog.pid
  node scripts/day-watchdog.mjs --once          # 手动补一轮（只读状态 + 写 days/ 与日志）
  tail -n 30 C:/Users/Administrator/.dsh/bili-whale/control/day-watchdog.log
  ```
- **影响**：缺 tick → 当天快照不连续 → `observation-day` 的 start/行动对不上 → 该日只能记 `missing` 或 `late`。看门狗是 tick 的**唯一**来源。
- **恢复**：`start-day-watchdog.vbs`（协议 §5）；次日开机后 `node scripts/day-watchdog.mjs --once`，缺失日由 `--audit` 标 `missed`。
- **惊动主人**：不用。补不回来（缺 >1 天）才报。

### F3 OFM 代理挂（18910 无应答）

- **发现**：`✗ OFM Responses：HTTP xxx / fetch failed`。
  ```bash
  cat C:/Users/Administrator/.dsh/our-free-model/settings.json   # apiKey 来源
  cat C:/Users/Administrator/.dsh/bili-whale/control/proxy.log
  curl -s -o NUL -w "%{http_code}" http://127.0.0.1:18910/v1/responses
  ```
- **影响**：唤醒起不来 → 当天无 `kind:'action'` → K1 少一天。日志里表现为工具调用失败，而不是 B 站侧问题。
- **恢复**：`node scripts/start-cortico.mjs` 会在 18910 无应答时顺带拉起代理（`~/.dsh/ofm-go-proxy/proxy.mjs`，detached）。代理起不来（key 过期/上游变）→ **不要手改代码**。
- **惊动主人**：一次重试失败即报（属于外部依赖，不是本地能自愈的）。

### F4 模型 4xx（401/402/429/5xx、上下文超限）

- **发现**：`control/cortico.log` 里的 provider 报错；`curl -s http://127.0.0.1:7799/api/status` 的 loop 状态。
  ```bash
  grep -nE "4[0-9]{2}|5[0-9]{2}|error|Error" C:/Users/Administrator/.dsh/bili-whale/control/cortico.log | tail -n 40
  ```
- **影响**：单轮残缺（feed 有、debrief 无），可能出 `degraded` 草稿。`degraded !== true` 是 `c2-window.mjs` 里"这天的稿算不算有效"的硬条件之一，可以借它当判据。
- **恢复**：等下一轮自然醒（3–7 分钟节律）；**不要** `--force` 重出稿（=污染，协议 §3）。反复 4xx → 属 F3，报主人。
- **惊动主人**：连续 ≥3 轮同一错才报。

### F5 B 站 412 风控（写通道被熔断）

- **发现**：`tools/lib/traffic.mjs` 把 `[412,429]` 与 `[-412,-352,-799,-509,-10403]` 判为 risk → `blocked()` 抛 pause；落到 `causal.jsonl` 的 `{"kind":"trafficPaused"}`（10-31 已出现过一条）；草稿 `status` 变 `cooldown`。
  ```bash
  grep -c trafficPaused C:/Users/Administrator/.dsh/bili-whale/causal.jsonl
  grep -nE '"status": *"(cooldown|failed)"' D:/AI/养鱼/drafts/*.json
  node scripts/preflight.mjs --json      # 内含 trafficGuard，只读，可看当前是否处于暂停
  ```
- **影响**：读通道（刷视频/日记）通常仍活；写通道暂停 → 稿子堆在 pending。
- **恢复**：**唯一禁令：风控熔断后仍重试 = 停止条件**（协议 §7 / STOP-RUNBOOK §1.3）。所以这里"恢复"= 什么都不做，等冷却窗口过去；`dynamic-approve.mjs` 里 `transient`（`冷却|TRAFFIC_PAUSED|请稍后`）会把状态写回 `cooldown` 而不是 `failed`，属于设计内的不重放。
- **惊动主人**：**立即报**（P1）。风控是对外可见代价，不是本地故障。

### F6 kill 误触发（她全部写被拦，看起来像"变懒了"）

- **发现**：`cortico-health` 的 `✗ kill switch：已触发（应关闭）`；
  ```bash
  ls -l C:/Users/Administrator/.dsh/bili-whale/control/kill
  ```
- **影响**：`runner.ts`/`definition.ts` 在 spawn 前直接返回 `[blocked] kill switch is on`；读侧照常，所以**只有写侧异常**，最容易被误读成"她今天不想发"。
- **恢复**：先查 `incident.md`/聊天记录确认是谁在什么时候拉的。确认误触发才删该文件；删除动作本身要记 incident（改的是控制面，不是 `days/`/`fields.json`，不算协议 §3 的污染）。
- **惊动主人**：**必须报**（P0 候选）。kill 是拉闸手段，任何一次出现都要解释，包括"我删掉了"。

### F7 时钟跳日 / 机器睡眠跨零点

- **发现**：
  ```bash
  tail -n 3 C:/Users/Administrator/.dsh/bili-whale/days/2026-11-01/ticks.jsonl
  ls C:/Users/Administrator/.dsh/bili-whale/days/            # 有没有 00:00 后仍写进昨天目录
  curl -s http://127.0.0.1:7799/api/status > NUL && date
  ```
  典型症状：`✗ 看门狗 tick：时间在未来`（`age>=0` 分支）；或某日 `ticks.jsonl` 最后一条时间早于 `state.end.json`。
- **影响**：`logicalDay()` 用 `toLocaleDateString('sv-SE')`（本机时区自然日）。系统时区/时钟被改，或机器睡眠跨过零点，会让**同一批事件被算进不同日**，K1/K2 的"每日有稿/文本不同"就会错位；`day-report.mjs` 的头注释还写着 04:00（见 §0）更增加误判概率。
- **恢复**：`node scripts/day-watchdog.mjs --once` + `--audit` 把缺失日标 `missed`；不要手工在 `days/` 里搬文件（回填=污染）。
- **惊动主人**：报（P1），并当天标 `late`；一天错位可复盘，连续错位会毁 K3 归因。

### F8 写一半被杀（草稿 `sending` 态）

- **发现**：
  ```bash
  grep -n '"status": *"sending"' D:/AI/养鱼/drafts/*.json
  ls C:/Users/Administrator/.dsh/bili-whale/control/pending/     # ack-*.json / ack-*.claim
  ```
- **影响**：**这是唯一可能"重复对外发布"的状态**。`dynamic-approve.mjs` 的发之前先落 `sending`（`d.status='sending'` + `sendingAt`），并把 `['sent','rejected','sending']` 列为 blocked，重试会返回"上次发送中断（sending），先人工核对 B 站有没有发出去，再决定 reject/重写"——守卫是对的，但**核对必须人做**。
- **恢复**：人工打开 B 站个人主页/动态列表确认这条正文在不在：
  - 已发出 → 依据 `draft.result`/`audit.jsonl`（`D:/AI/养鱼/drafts/audit.jsonl`）人工把状态归到 `sent` 并写 incident；
  - 未发出 → 走 reject，等她自己重写（**不要**手工补稿）。
  - 令牌侧核对：`pending.payload.draftId` 与 `payload.textHash` 必须等于当前草稿正文哈希，否则"令牌与草稿不匹配"。
- **惊动主人**：**报**（P0/P1）。可能造成真实重复发布，代价对外不可回收。

### F9 WebUI / 面板 404、「她的一天」页打不开

- **发现**：`curl -s -o NUL -w "%{http_code}" http://127.0.0.1:7799/`；`node scripts/cortico-health.mjs`（人设前缀那两行会暴露 `/api/prompts/prefix` 是否 404）。
- **影响**：观测的**唯一人工感官入口**没了；但 `days/` 仍在写，K1/K2 不受影响。属于 P2。
- **分诊顺序**：
  1. WebUI 全 404 → 进程/构建产物问题（**观测期内不许 rebuild、不许合 dev**）；
  2. 只有某块面板空 → 数据侧缺（该日无 `day.json`/无草稿），回 §2 F1/F2；
  3. 旧 8447 面板还在响应 → 见 F10，别把它当 WebUI 判读。
- **恢复**：以 `days/<D>/observation-check.md` 为准继续观测；面板坏了不改变任何判据。
- **惊动主人**：当天报一次即可（不重启加载新代码 → 修面板要等到观测期结束）。

### F10 旧独立面板 8447 残留（提权、杀不掉）

- **发现**：`netstat -ano | findstr :8447` → 拿 PID → `tasklist /fi "PID eq <pid>"`。
- **影响**：提权进程无法从当前会话终止；真正的风险是**双写同一份 `fields.json`/草稿目录**造成观测数据串味，以及人工误看旧面板。
- **恢复（不杀进程版）**：
  ```bash
  node scripts/open-panel.mjs            # 或看 panel.log 最后写入时间
  ls -l --time-style=full-iso C:/Users/Administrator/.dsh/bili-whale/panel.log \
                            C:/Users/Administrator/.dsh/bili-whale/panel-8448.log
  ```
  日志 mtime 不再前进 = 事实退役；仍前进 → 报主人（需要一次提权重启机器来解决，不属于观测期动作）。
- **惊动主人**：首次发现它在写 → P1；否则只在周报里提。

### F11 会话被打断连带杀掉 detached 子进程（已知事故复现路径）

- **发现**：F1+F2 同时出现（Cortico 和看门狗一起没了），而 `cortico.log` 尾部无异常。
- **处置**：`node scripts/start-cortico.mjs` + `start-day-watchdog.vbs` 手动补；两条都写 incident。**这条最该被自动化**（见 §6 的边界：自动重启必须校验代码同一性）。
- **惊动主人**：一周内第 3 次出现才报（说明需要一个不属于 Qoder 会话的常驻拉起方式）。

### F12 GitHub 502 推不动（备份/评审记录出不了本机）

- **发现**：`git -C E:/WorkSpace_Qoder/dsh-bili-whale remote -v` 有 `private`（`dsh-bili-whale-port`）与 `upstream`；推送失败即代理问题。
- **处置**：Clash 7897 临时代理推完立刻 unset。**观测期内禁止任何 git 写**（本手册作者不适用例外）；备份走 §4 的本地快照，推送由主人拍板。
- **惊动主人**：报（P2，影响的是取证的可达性，不是她的运行）。

---

## 3. 不打扰原则：分级 + 去重抑制

### 3.1 分级（`anomaly-collect` 的产出字段建议）

| 级 | 定义 | 条目 | 动作 |
|---|---|---|---|
| **P0 立刻推主人** | 对外不可回收 / 观测期合法性受损 | 疑似重复发布（`sending` 未核对）、未经审批的真实发布、`kill` 意外出现、连续 3 天 `tainted`、`tainted+missing>3` | 推 + 拉闸建议（不自动拉闸）+ 写 incident |
| **P1 当天推主人** | 外部代价或整日证据作废 | B 站 412/风控熔断、时钟跳日、缺整天证据、8447 仍在写盘、OFM 代理反复起不来 | 推（当天一条摘要） |
| **P2 只落盘，周报汇总** | 本地可自愈、不影响判据 | Cortico 死一次后同代码重启成功、看门狗补 tick、单轮模型 4xx、WebUI 面板 404、`action-watch` 掉线 | 不推；写 `control/anomalies.json` + `incident.md` |
| **P3 静默（连 incident 都不必）** | 设计内噪声 | 正常暂停/继续、任务队列 at-least-once 的重复提示（`task-queue.ts` 明确"重复一条提示好过丢掉她的意愿"）、pending 令牌过期、`delivered/dead` 24h 清理、节律里她真的在睡（`asleep:true`） | 只在 `--audit` 里可查 |

### 3.2 静默自愈的白名单（**只允许这三类，其余一律人工**）

1. 同代码重启 Cortico / 看门狗（先做代码同一性校验，见 §6-R1）；
2. 补一轮 `day-watchdog --once` 的 tick（只读状态 + 写 days/ 与日志，脚本头已声明）；
3. `action-watch.mjs --follow` 重新挂上（它自己就是只读观察器）。

**永不自动**：重出稿、`--force`、重跑 `counterfactual` 覆盖当天结果、回填 `days/`、写 `fields.json`、删 `kill`、approve 任何草稿、给 B 站发任何请求。

### 3.3 推给她（notify 让她知道）vs 推给主人

- **推给她**：只推她**能改变自身处境**的事实——"你有一条稿在等你自己决定"、"今天风控暂停了，写通道关了"。绝不说"我重启了你"（那会把宿主故障变成她的自我叙事，K3 归因直接失真）。
- **推给主人**：P0/P1。P2/P3 只进日志。

### 3.4 去重与抑制（防止刷屏，必须实现在推送层）

1. **指纹**：`sig = 类:对象:逻辑日`（例 `cooldown:dyn-20261031-9f8a2a:2026-10-31`）。同 `sig` 24h 内只发首条；
2. **状态文件**：`control/alerts-state.json` 记 `sig → 首次/末次/已发条数`（与既有 `control/*.json` 状态习惯一致）；
3. **每日封顶**：P0 不限；P1 ≤3 条/日；超出合并成一条摘要；
4. **静默时段**：23:30–07:30 除 P0 不发（她的节律 + 主人睡觉）；
5. **风暴抑制**：同一时间窗内 ≥5 条 P2 → 折叠成 1 条"观测链疑似断了"，直接指向 `cortico-health`；
6. **恢复通知**：故障 sig 消失后补一条"已恢复"，避免主人靠猜。

### 3.5 通道现状（**实测已核对，含一个必须避开的坑**）

- `tools/commands/notify.mjs` 的分支实际是 `none|desktop|webhook|ntfy|bark|command|dm|stdout|file` —— 文件头"方式只有四种"的注释（2026-10-18）已过时，`ntfy`/`bark` **是真分支**（含 https/内网校验、bark 要求 `https://host/<device_key>` 形式），与 `preflight.mjs` 的检查一致。
- **坑：`type === 'dm'` 会真的发 B 站私信**（调 `commands/dm.mjs --go`），自带三道闸「只发主人 / 必须互相关注 / **一天只锁定一个收信人**」。后果有两层，都不容忽视：
  1. 告警若配成 `dm`，每条自动告警都是一条真实私信 → 直接污染 K4-1 的"有来有回"计数，并把 `control/life.json` 的 `lastContactAt`/`lastInboundAt` 顶掉——**告警会变成她的唤醒诱因**（观测者进栈）；
  2. 它会占掉当天唯一的收信人锁，**把她自己回私信的路堵死**。
  → 硬性约束：**观测期内 `alert-push` 与一切定时推送禁止使用 `type: dm`**；推送只走 `ntfy`/`bark`/`webhook`/`desktop`。`dm` 通道留给她自己。
- 首发验证一律 `--dry`（`dm` 分支 2026-10-21 修过：原来写死 `--go` 且不看 DRY，会真发）：
  ```bash
  node tools/commands/notify.mjs "观测告警自检" --dry
  node tools/commands/notify.mjs --test          # 按当前配置发一条测试消息（自带文案，不动她的数据）
  cat C:/Users/Administrator/.dsh/bili-whale.config.json | grep -A6 '"notify"'   # 先确认 type 不是 dm
  ```
- 推送本身也要留痕：每条告警写 `days/<D>/incident.md` 一行，否则"是否打扰了她"没法复盘。

---

## 4. 备份与取证

### 4.1 现状

- **没有任何备份脚本**（仓内 `grep backup` 只命中 `migrate-causal.mjs`/`setup.mjs` 的写文件 `.bak`）；`fields.json.bak` 是写入副作用，**不是备份**。
- 代码侧有私有远端 `private → github.com/biandeshen/dsh-bili-whale-port`，但**运行时数据全不在 git 里**（`~/.dsh/bili-whale/`、`D:/AI/养鱼/drafts/`）。
- 草稿目录有**两处**：`observation-day.mjs`/`day-report.mjs`/`wake-audit.mjs`/`c2-window.mjs` 都按 `WHALE_DRAFTS` → legacy `D:/AI/养鱼/drafts`（默认 home 且该目录存在时）→ `~/.dsh/bili-whale/drafts` 回退。实测 `D:/AI/养鱼/drafts` 里有 `2026-10-31.json` + `audit.jsonl`，即当前生效目录。**备份必须两处都抓**，只备 `~/.dsh` 会丢稿。

### 4.2 备份节奏（写进 §1 的每日编排里，人工不参与）

| 频率 | 内容 | 命令（建议形态，`ops:backup` 的实现范围） | 验证方式 |
|---|---|---|---|
| 每日 00:30 | `days/<D>/` 全部（`state.start/end`、`ticks.jsonl`、`day.json`、`counterfactual.json`、`observation-check.*`、`incident.md`、`wake-*.json`、`dm.json`/`mood-check.json`） | 打单个 `<D>.zip` + `manifest.sha256` | `--verify` 重算哈希；`day-report.mjs --date <D>` 指向解包目录能跑出同样的 MISSING/FAIL 行 |
| 每日 00:30 | `drafts/<D>.json` + `audit.jsonl`（两处目录都算） | 同上 | `diaryHash`/`textHash`/`voiceHash` 三个字段能在快照里复算一致 |
| 每日 00:30 | `fields.json`（+ `fields-events.json`）、`control/life.json`、`life-status.json`、`round.json`、`queue.json`、`observation.json` | 同上 | 与当天 `state.start.json` 的字段值互相印证 |
| 每 3 日 | `causal.jsonl`（append-only，全量单档） | 单独 zip，含行数与末尾 `at` | 行数单调；抽查 1 条 `kind:'action'` 能对上 `days/<D>/` 的 wake 文件 |
| 每周（第 7/14 天） | `~/.dsh/bili-whale.config.json`、cookie/credentials（**只加密后**）、`scripts/hashes.json`、`docs/evidence/`、面板截图 1 张 | 周快照 zip | `node scripts/check-hashes.mjs` 在该快照上 PASS |
| 立即（不等节奏） | P0/P1 事件后的**当前状态整包** | `ops:backup --incident <D>` | 包里必须含 `cortico.log` 尾部 2000 行 + `control/pending/` 列表 |

**保留与介质**：本机一份 + 第二介质一份（移动盘/NAS）。私有仓推 GitHub 受 F12 约束，且观测期禁 git 写 → **默认只做本地/离线备份**，推送由主人拍板；cookie/SESSDATA 永不进任何远端明文。

### 4.3 "观测期结束后能复现一切"需要的快照点

1. **开窗冻结点**（Day 0，最关键）：`git rev-parse HEAD`（Cortico 与 dsh 两个仓）、`npm run hashes` 输出、`g3b-check --json`、`observation-status --json`、`cortico-health` 全文、`fields.json`/`causal.jsonl`/`whale-diary.md` 的 sha256 与行数。存进 `docs/evidence/observation-open-<date>.json`。
   —— 有了它，之后每一次"她不动"都能回答"是她的问题还是环境的问题"。
2. **每日收盘点**：§4.2 的日包（等价于 `day-snapshot --end` 之后）。
3. **每次重启点**：incident 同时抓 `cortico.log` 尾部 + `/api/status` + `life-status.json`，证明"同代码"。
4. **风控点**：`trafficPaused` 事件时刻的配置快照（`drafts/*.json` 的 status 分布 + 写通道暂停原因）。
5. **周中点**（第 7 天）：全量整包 + `observation-status --json`，作为 K1/K2/K3 的中间读数。
6. **闭窗点**（Day 14）：全量 + `goal-audit --json` + `g3b-check`，并附一份 `reproduce.md`：解包路径 → `WHALE_DRAFTS=<解包>/drafts` 与 `WHALE_HOME=<解包>` → `day-report.mjs --date <D>`，**在不碰真实目录的前提下重跑读数**。

> 复现自检本身要在观测期**末**做一次（不是期中），因为设置环境变量跑 `day-report` 是纯读，但任何"把文件拷回去"的动作都可能变成回填污染。

---

## 5. 指标补全：K4 三条现在能不能算

先给结论：**K1/K2/K3 已可算**（`observation-status.mjs` / `goal-audit.mjs` 覆盖 K1≥11、K2≥9、K3≥3 + tainted+missing；K3 的情绪标签来自 `drafts/<D>.json` 的 `voice.mood.label`，实测有 `{"label":"灵感","intensity":0.9,"reason":"看完喜欢的视频 + 心情为正","cause":"watchedVideo"}` —— **可归因字段是齐的**）。
**K4 三条现在一条都算不出来**，逐条：

### K4-1 连续 7 天私信有来有回 → **不可算**

- 现有：`causal.jsonl` 里 `inbound` 只有 3 条（`{"kind":"inbound"}`，无成对方向标记）；`kind` 全集实测为 `watchedVideo(20) watched(19) diary(53) action(4) inbound(3) trafficPaused(1) draftApproved(1) draft-result(1) draft-result-consumed(1)` —— **没有出站私信事件类型**。`control/life.json` 只有 `lastContactAt`/`lastInboundAt`/`lastDmReadAt` 三个"最后时刻"，是覆盖式单值，**无法还原逐日往来**。
- 缺什么：
  1. `causal.jsonl` 补 `dm-in` / `dm-out` 两类事件（带 `peer mid`、`conversationKey`、`atMs`、`replyTo` 指回上一条的 id）；
  2. `dm-ledger.mjs --json`：按逻辑日聚合出 `inN/outN/pairedPairs/maxGapHours`，判据 `连续 7 天里每天有 inN≥1 且 outN≥1 且 pairedPairs≥1`；
  3. 一个"来回"的定义（她的回复必须挂在她**主动**的 `action` 之后，而不是自动应答）——需要 `actionKind` 与 dm 事件的时间偏序，实测 `action` 事件有 `actionKind`（如 `reflect`），字段是够的。
- 注意 `life.json` 的 `lastInboundKey`/`lastInboundAt` 目前会被覆盖 → 老数据不可回溯，**开窗当天就要开始新增 dm 账本**，否则前 7 天永久缺失。

### K4-2 成稿对得上当日情绪 → **半可算**

- 现有：`fields.json` 有 7 个连续场值（实测 `mood 0.973`、`energy 0.494`、`stimulation 0.963` …）+ `chain[]` 里的 `field_change` 记录（含 `description` 中文归因，如"看了一条喜欢的视频"）；`days/<D>/state.start.json`/`state.end.json` 有当日场值快照（`day-snapshot.mjs` 直接读 `FIELDS`）；草稿有 `voice.mood.{label,intensity,reason,cause}`。
- 缺什么：
  1. **数值 → 标签的映射表**（`mood 0.97 → "灵感"` 这条链现在在 persona-core 里，观测层没法独立复算）；
  2. `mood-align.mjs --date --json`：把 `draft.voice.mood` 与"出稿时刻最近的 state 快照 + `chain` 末尾若干条 `field_change`"做一致性打分，输出 `aligned/label-only/contradict` + 依据字段；
  3. 反事实基线：`counterfactual.json` 已给出中性状态稿与真实稿的 `diff`（实测 10-29/10-30 各 `cf=ok/32`），可以复用它回答"情绪真的进了文本吗"——**这是 K4-2 最省事的现成抓手，缺的只是把它从"字数差"升级成"情绪方向差"**；
  4. 草稿侧建议补一个 `moodAtDraft`（出稿瞬间的场值快照）；现在草稿只有 `diaryHash`/`voiceHash`，没有场值快照，需要靠 `state.end.json` 近似（对不上当天多次出稿）。

### K4-3 无日记日期错位 → **不可算**

- 现有：`causal.jsonl` 有 53 条 `diary` 事件（`{at,kind:"diary",book:"private",heading:"…",chars}`），`D:/AI/养鱼/drafts/<D>.md` + `~/.dsh/whale-diary.md`（`day-report.mjs` 读它做 `diaryHash` 校验）。
- 缺什么：
  1. diary 事件**没有逻辑日字段**，只有 `at`（UTC ISO）。跨零点/睡眠恢复/时钟跳日时，"写在昨天目录里的正文"与"正文标题里的日期"会分家（实测 `heading:"风控暂停（10-31 11:51 前）"` 是**人肉写在标题里的日期**，机器没法可靠解析）；
  2. `diary-index.mjs --json`：解析 `whale-diary.md` 的标题层级 → 每条日记产出 `{headingDate, eventLogicalDay, fileLogicalDay, draftDate}` 四个日期，任一不等 → 列 `mismatch`；
  3. 判据要写死用 `logicalDay()`（自然日，00:00），并在实现里注释引用 2026-10-31 的拍板，避免又漂回 04:00；
  4. 结构性建议（dev 期做）：`bili_diary_append` 时落一个 `day` 字段 + 标题用 `<YYYY-MM-DD>` 固定格式。**不给她看的正文加格式约束，就永远要正则猜。**

### 顺带：K3 的一个隐患

K3 判据是「≥3 天 mood≠平静且可归因」，协议里同时出现「宁静」（§6）与「平静」（2026-10-29 前的中性标签）。**中性标签的历史命名有两个写法**，任何自动统计都要按标签集合判，别按单字符串等号判——这是最容易把 K3 算成 0 的地方。

---

## 6. 红线：哪些"自动化"会让观测数据失真

| # | 自动化行为 | 为什么失真 | 允许的替代 |
|---|---|---|---|
| R1 | **自动重启（不看代码同一性）**，尤其 `pnpm build:web` 后重启、把 dev 合进 live 再重启 | 等于中途换了她的大脑：之后的行为没法归因到开窗冻结点，K3 的"可归因"直接作废；协议 §3 明列为污染 | 重启前校验 `git rev-parse HEAD` + `npm run hashes` 与 Day 0 快照一致，不一致**拒绝重启并报 P0**；校验通过才允许，并写 incident、当天可标 `late` |
| R2 | **自动补稿 / 自动重出稿**（`draft-dynamic --force`、失败自动重试到出稿为止） | K1 变成脚本达标率而不是她过日子；`--force` 是协议 §3 明文污染 | 失败只记账；缺稿日如实 `missing` |
| R3 | **自动重跑反事实覆盖 `counterfactual.json`** | 这个文件是 G3b/K2 的验收证据，重跑会用到"当时不存在"的日记/状态，等于事后造差异 | 只在新的一天由她自己的链路生成；补算只在**离线日**且写 `expected.json`（`c2-offline` 的路子） |
| R4 | **自动回填 `days/` 或写 `fields.json`**（包括"顺手把 ticks 补齐"、看门狗补写一整天） | 协议 §3 明文污染；还会掩盖 F7 的时钟问题 | 缺失就标 `missed`；`--audit` 是标记，不是造数据 |
| R5 | **自动 approve / 到点自动发布**（"待审超过 24h 就放行"这类善意） | 制造真实对外发布，直接踩 STOP-RUNBOOK 触发条件；`sending` 守卫（§2 F8）也就失去意义 | 只提醒 pending 数量；令牌机制保持"必须人点 go" |
| R6 | **重启 `nightly-scheduler.mjs` / 注册自启定时出稿** | 脚本头已声明 2026-10-27 停用，理由就是"会和 Cortico 抢着出稿" —— 定时出稿的稿不是她自然醒的产物，K1 的"她自然醒过（`kind:'action'`）"这一条会被假象满足 | 保持停用；`HKCU Run` 不要再注册 |
| R7 | **风控熔断后自动重试写通道** | 协议 §7 / STOP §1.3 明文停止条件；重试还会拉长冷却 | 只报 P1，等冷却；`transient` 判 cooldown 不判 failed |
| R8 | **自动清 `kill` 文件**（"检测到 kill 就删掉恢复服务"） | 把主人的拉闸当成故障修掉，是最恶劣的一次失真 | kill 只能人工删，且留 incident |
| R9 | **自动"整理"证据目录**（去重、压缩、搬文件、改名补日期） | 破坏 append-only 与哈希链（`textHash`/`diaryHash`/`voiceHash`、`audit.jsonl`），事后无法证明没被改 | 整理只在闭窗后的解包副本上做 |
| R10 | **把告警直接推给她**（"你今天没出稿""进程被我重启了"） | 宿主故障进入她的自我叙事 → K3 的情绪归因被观测者污染（她的情绪来自你的话，不来自世界） | P0/P1 推主人；推给她的内容只允许她本来就能感知到的事实 |
| R11 | **自动"优化"验收脚本或阈值**（含为了让 `g3b` 变绿而 `hashes:write`） | 判据可移动 = 观测期没有判据 | 冻结清单的扩充只在**开窗前**做一次并留 incident；期中一律拒绝 `--write` |
| R12 | **为减少人工而让脚本代写 `incident.md`**（自动生成"无异常"） | incident 的价值在于人的定性；自动"无"会让真事故被平均掉 | 脚本可以起草事实部分（时间/命令输出），定性一行留白给人 |

---

## 7. 一页版（打印贴屏幕上）

```bash
cd E:/WorkSpace_Qoder/dsh-bili-whale

# —— 开窗前一次性（现在被 10-28 的证据挡住，别绕过）——
node scripts/g3b-check.mjs                     # 必须全 PASS
node scripts/check-hashes.mjs                  # 冻结清单现状
node scripts/observation-start.mjs --dry       # 看它会写什么
node scripts/observation-start.mjs             # 真开窗（Day 0）
node scripts/observation-status.mjs            # 确认 startDay / 14

# —— 每天早上（昨天）——
node scripts/cortico-health.mjs
node scripts/observation-day.mjs --date 2026-11-01
node scripts/day-report.mjs --date 2026-11-01
notepad C:/Users/Administrator/.dsh/bili-whale/days/2026-11-02/incident.md   # 没有也要写"无"

# —— 每天睡前（今天还在跑吗）——
node scripts/cortico-health.mjs
node scripts/action-watch.mjs --follow --settle 10m     # 长驻观察器（掉线就重挂）

# —— 故障三板斧 ——
node scripts/day-watchdog.mjs --once           # 补 tick（F2/F7）
node scripts/start-cortico.mjs                 # 同代码拉起（含 OFM 代理）（F1/F3/F11）
ls C:/Users/Administrator/.dsh/bili-whale/control/kill   # 是不是拉闸了（F6）

# —— 周报 / 闭窗 ——
node scripts/observation-status.mjs --json
node scripts/goal-audit.mjs                    # 第 7、14 天
```

**判停立即回头看的三条**（协议 §7）：连续 3 天 `tainted`；`tainted + missing > 3`；未审批的真实发布或风控后仍重试。

---

## 8. 我建议的执行顺序（不动她的链路）

1. **D-2 ~ D0**：补 §5 的三个 K4 只读脚本里最省事的 `diary-index`（纯解析，零依赖新字段）；把 `observation-day.mjs`/`wake-audit.mjs`/`action-watch.mjs` 加进 `check-hashes.mjs` 的 `FILES` 并 `--write` 一次（**必须在开窗前**，留 incident）。
2. **D-1**：写 Day 0 冻结快照（§4.3-1），含两个仓的 HEAD sha。
3. **D0**：`observe:open` 走通 → 开窗；当天起 `ops:day` 编排接管步 1–3。
4. **D1–D3**：`ops:anomaly` + `alert-push --dry` 跑 3 天，只看落盘不真推，用真实噪声校准 §3.4 的封顶与静默时段；再核对 `notify.mjs` 对 ntfy/bark 的实际分支（§3.5），由主人拍板后实弹。
5. **D4 起**：`dm-ledger` 必须已上线——K4-1 的数据只有从今天起才攒得出来，晚一天少一天。
6. **D7 / D14**：周备份整包 + `goal-audit`；闭窗后在解包副本上做 `reproduce.md` 演练。

> 明确**不做**（留给观测期之后）：退役 8447 的进程级清理、修 `day-report.mjs`/`day-snapshot.mjs` 头注释里的 04:00 漂移、给 diary 事件加 `day` 字段、把面板 404 的根因查到底。这些都写进 dev 分支待办，不碰 live。

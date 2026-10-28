# ISSUES —— 问题台账

> v1 · 2026-10-28 · 本文件记录**所有未解决问题、待拍板事项、已知缺陷与环境约束**。
> 与 `BLUEPRINT.md` §9（历史更正）区分：那里记"写错过的结论"，这里记"还没解决的事"。
> 状态词表：`OPEN` 未动 · `DOING` 在做 · `FIXED` 已修有证据 · `BLOCKED` 前提缺失 · `NEED-USER` 待主人拍板 · `DECIDED-NO` 主人明确不做 · `WONTFIX` 判断不该做
> **任何条目改成 FIXED 必须附证据（命令输出/文件:行号/run id），否则留在 OPEN。**

## 0. 一句话现状

真实自主唤醒 **1 次**（10-27 15:49:27，`wake: restless`），完整"一天"链条**0 次**；人格状态**未接入产物**；记忆**只写不读且不衰减**；`connection` **只减不增**。前四项是 M0–M3 的全部内容。

---

## 1. 致命缺陷（阻断"活着"）

| ID | 问题 | 证据 | 影响 | 期 | 状态 |
|---|---|---|---|---|---|
| D-01 | **人格状态与产物零耦合**：`buildText()` 只吃日记文本，不读 fields/chain/memories/npc/rhythm | 红队1 F1；`scripts/draft-dynamic.mjs:44`；`drafts/2026-10-28.md` 与 `whale-diary.md:123` 逐字相同 | 情绪/主动表达/自我修正在产出路径结构性失效：被拒 100 次，第 101 条一字不变 | M0 | OPEN |
| D-02 | **记忆永不衰减**：`applyEffects` 用 `lastAppliedAt` 算天数，而生活循环每 3–7 分钟重置它 → `days>=1` 恒假 | 红队3 F6；`personaAdapter.ts:159-162,191`；实测 90 天后 vividness 仍 0.9 | "记性"不成立，重要的事不会变淡 | M0 | OPEN |
| D-03 | **"记得"永远是最早三条**：`describeState` 按 vividness 排序取 top3，全部 0.9 → 稳定排序 | 红队3 F6；`personaAdapter.ts:335`；50 条记忆实测返回 `["video #1","video #2","video #3"]` | 长期记忆形同虚设 | M0 | OPEN |
| D-04 | **`connection` 只减不增 → 必然 `cold_war` 且不可恢复**：8 个工具无任何读私信/互动的；`masterReplied` 唯一来源是模型自己填参数；6 个 preset 中只有它加 connection | 红队3 F5/S2；`definition.ts:199-208`、`personaAdapter.ts:40-48`、`decay.ts:27,37` | 关系机五态实为三态；30 天模拟 `connection=0.00` 是数学必然 | M3 | OPEN |
| D-05 | **五态里 `reunion` 不可达、`missing/repairing` 窗口 8.3e-5**：`trust` 是 `connection` 别名，进 reunion 需 `c0<0.2`，单步最多给到 0.25 | 红队3 F5；`npc-state-machine.ts`；5.7 万模拟年 `reunion NEVER REACHED` | "关系五态"名不副实 | M1 | OPEN |
| D-06 | **情绪塌缩**：`readMood` 只读 4/7 场，97.2 万网格只出 13 标签，"平静" 56.7%；`source='action'` 无分支 → 180 天 229/229 次 mood_read 全是"平静" | 红队3 F1–F3；`personaAdapter.ts:243-324`、`definition.ts:260` | "有情绪成因"这条北极星特征不成立 | M1 | OPEN |
| D-07 | **场值钉死**：mood 单调到 ±1、creativity 恒回 0.300；三条硬耦合全为单向下压，无"托起来"的手 | 红队3 F4/S1；`decay.ts:61-75` | 情绪永久冻结，`COUPLING_CAP_MS=12h` 反而只保护离线路径（在线比离线惩罚重 14 倍） | M1 | OPEN |
| D-08 | **持久任务缺失**：唤醒排程只活在内存 `setTimeout`，进程重启即丢 | 红队4 §2；`definition.ts` rhythmTick | 一次崩溃=当天不再醒 | M2 | OPEN |
| D-09 | **无醒/睡状态变量**：`rest` 恢复每 tick 无条件应用 → 体力恒满，作息没有代价 | 红队3 S5；`definition.ts` rhythmTick | "作息"缺少最基本的睡/醒语义 | M2 | OPEN |

## 2. 严重缺陷（可信度与安全）

| ID | 问题 | 证据 | 影响 | 期 | 状态 |
|---|---|---|---|---|---|
| D-10 | **`npm test` 执行 0 条自研测试**：`vitest.config.ts:16` 只 include `tests/**/*.test.ts`，我们全是 `.mjs` | 红队2 F3、红队5 §2 | 45 个测试一个都不跑；`rhythm.test.mjs`（11/11）覆盖的"再也不醒"bug 无门禁守护 | M0 | OPEN |
| D-11 | **`tsc 0 错误`口径失实**：`Cortico/tsconfig.json` 的 include 不含 `persona-core/`；`dsh-bili-whale` 是纯 JS 无 TS 工具链 | 红队5 §1 | "类型安全"只覆盖上游代码 | M0 | OPEN |
| D-12 | **测试抓不到"写了没生效"**：drill 33 项全在 `mkdtemp` 沙箱 + 5 行假 CLI，真实网络/home/CLI 触达 0/33；每项直接 `await tools.X.handler()`，绕过 `lifeTick` | 红队5 §3；`drill-gate.mjs:21-26,128` | 33/33 全绿与"她再也不会醒"可同时成立 | M0 | OPEN |
| D-13 | **22 个零引用导出**（`causal-chain` 6/6、`effect-bus` 3、`runner.makeRunner` 等） | 红队5；`CORTICO-PATCHES.md:9` 把 `makeRunner` 列为交付物 | 死代码继续增长（刚删 266 行又长回来） | M1 | OPEN |
| D-14 | **L3/L4 倒挂**：`PRESETS`/`readMood`/`describeState` 住在 World；`persona-core/tests/adapter.test.mjs:6` 反向 import World | 红队2 F1 | L3 无法独立测试/移植；"换 adapter 即可"被证伪（需改约 920 行） | M1 | OPEN |
| D-15 | **`persona-core` 不是包**：无 package.json，不在 workspace/tsconfig/vitest | 红队2 F2 | "平台无关"是注释不是约束 | M0 | OPEN |
| D-16 | **`Cortico/` 无版本控制**，约 2300 行自研代码不可回滚；上游已 0.2.8（本地 0.2.7） | 红队2 F4、红队5 §4；`cortico.log` 每次启动告警 | 升级=手工重做；改坏只能重写 | M0 | OPEN |
| D-17 | **多会话并发写同一批文件**（10-27 06:50–17:34 两会话同时活跃 11 小时，正是 P0 修复窗口） | 红队5 §5；`c2a52024.txt:7615` 自认"我改到一半撞车" | 修复互相覆盖 | 流程 | OPEN |
| D-18 | **状态 4 根目录、5 写者、0 锁**：`~/.dsh`、`~/.bili-ai`、`D:\AI\养鱼`、`Cortico/deployments/*/data` | 红队2 S4；全仓 grep `flock|lockfile` 零命中 | 备份/迁移易漏；后写覆盖 | M0 | OPEN |
| D-19 | **两套人设并存无主从**：`~/.bili-ai/persona.md` vs `deployments/mybot/prompts/ORIENTATION.md` | 红队2 S4 | 改一处不生效，排查困难 | M1 | OPEN |
| D-20 | **`--force` 可擦除 `sent` 状态 → 同日重复发布**（按日期命名整文件覆盖，审批闸读的就是该字段） | 红队4 致命2；`definition.ts:207`、`draft-dynamic.mjs:80-101` | 绕过审批的唯一屏障 | **主人 2026-10-28 决定不做**（与 AI 标识一并撤） | DECIDED-NO |
| D-21 | **一次性令牌明文落盘**（token 与 tokenHash 同文件） | 红队4 致命3；`ack.mjs:37` | 安全性依赖"工具面恰好没有文件读" | 同上 | DECIDED-NO |
| D-22 | **kill switch 不覆盖 tools 层**，直接 `bili.mjs --go` 可绕过 | 红队4 S2 | 急停不可靠 | 同上 | DECIDED-NO |
| D-23 | **成功判定是装饰**：`/dyn_id|dynamic|成功/` 里 `dynamic` 任何运行都出现 | 红队4 S1；`dynamic-approve.mjs:111` | 失败可能被记为成功 | M0 | OPEN |
| D-24 | **`ack.release` 在"已发出但进程被杀"时会把令牌退回** → 重试产生第二条 | 红队4 S1 | 重复发布 | M1 | OPEN |
| D-25 | **记忆只在测试里衰减/归档**——上游 AMpath 也一样（`batchDecayVividness` 生产零调用） | AMRESEARCH/02 | 不能靠"上游有"来证明我们该有 | 认知 | FIXED（认知已更正） |
| D-26 | **flashbulb 分支不可触发**：`note` 路径 intensity 硬编码 0.5；watch 路径饱和后几乎必然 | 红队3 M2 | "重要的事记得牢"不成立 | M1 | OPEN |

## 3. 待拍板（NEED-USER）

| ID | 事项 | 背景 | 选项 | 状态 |
|---|---|---|---|---|
| Q-01 | **EmergentDimension（涌现维度）做不做** | AMpath 自列核心壁垒；我们的离线结算与人格生长依赖它 | A 做（成本高，需搬维度体系）/ B 不做（接受"人格不生长"）/ C 暂缓到 M4 后 | NEED-USER |
| Q-02 | **Coopanion 是否进 L5** | 你 10-25 原话"完全能满足需求，甚至比当前项目更先进"；无弃用指令 | A 作为皮套前端接入 / B 保持 WebUI / C 先不决定 | NEED-USER |
| Q-03 | **A/C（MemoryWeaver 精华）范围与时机** | 10-27 05:52 已出职责切分：长期记忆图/关系史/演化报告归 MW，记忆写入单一入口；前提"先看 AMpath 的 memory/retrieval 多完整"**现已查明**（检索=取回、MW=生成认知，不重叠→叠加） | A M4 后做 / B M1 就并入 / C 只抄检索不抄图谱 | NEED-USER |
| Q-04 | **视频/直播的启动时机** | 是能力不是非目标（10-27 04:58 原话） | A M4 之后 / B 与 M4 并行 / C 等 7 天自运行达成 | NEED-USER |
| Q-05 | **AI 内容标识** | 红队4 认定为法律风险；你 2026-10-28 明确"不要这个第 0 项" | 已按你的决定不做 | DECIDED-NO |
| Q-06 | **`connection` 的语义与符号** | 上游 `embodiment/temporal-rates.ts:90-104` 在"长时间无互动"时给 `connection **+**0.001×lonelyUnits`（孤独→连接上升）；但 `npc-state-machine.ts:75-91` 又把 `connection<0.3` 当作冷战条件。两者可能语义冲突：若 connection 是"连接感"，孤独不该让它上升；若是"渴望连接"，则冷战条件反了 | A 按"连接感"（孤独下降，需外部输入回补）/ B 按"渴望"（孤独上升，冷战另立阈值）/ C 先只做状态机、不加孤独项 | NEED-USER |
| Q-07 | **是否采用上游的昼夜节律项** | 上游按小时窗口结算（23–5 睡、6–9 晨、13–15 午后低谷，`temporal-rates.ts:84-92`），与我们"作息由状态决定、不设时间表"的决定可能冲突 | A 只作缓慢背景漂移，不参与醒/睡决策 / B 完全不用 / C 用但要可配置 | NEED-USER |

## 4. 环境与流程约束（BLOCKED / 需处理）

| ID | 问题 | 现状 | 影响 | 状态 |
|---|---|---|---|---|
| E-01 | GitHub 443 不通，**12 个提交未推**（含 `c6eb06e`、`de02d9f`、`b25d6d0`、`dbe5f13`） | `git status -sb` = ahead 12 | 远端与本地不一致，换机即丢 | BLOCKED（网络） |
| E-02 | archify 装不上（`npx skills add` 被墙、gh tarball 0 字节） | 已用 mermaid 出替代图（`ARCHITECTURE.md` §2.1） | 无交互式架构图 | BLOCKED（网络）/ 有替代 |
| E-03 | GitHub Actions 额度不足 | 不上 CI | 无自动门禁 | 改用本地 `npm run gates` + pre-push |
| E-04 | 文档 17 份、互相矛盾 10 组、docs 占 21% churn | 目标砍到 4 份（CURRENT/BLUEPRINT/ARCHITECTURE/PROCESS）+ archive | 每次改代码前要先分辨哪份为准 | OPEN |
| E-05 | 三个 scheduler 遗留检查 | DSH 插件 `clock.enabled=false`、HKCU `WhaleDraft` 已删、`nightly-scheduler.mjs` 进程已杀并标注停用 | 遗留进程已清 | FIXED |
| E-06 | `causal.jsonl` 1 条旧场值记录（trust/boredom/fulfillment） | `scripts/migrate-causal.mjs --dry` 预览，等你确认才改写真实状态 | 历史回读会看到不存在的场 | NEED-USER（低风险） |
| E-07 | Cortico 上游 0.2.8 已发布，本地 0.2.7 | 无 git，无法 merge | 升级=手工重做 | OPEN（随 D-16） |
| E-08 | 本机 AMpath 快照停在 10-07 | 已浅克隆最新 `8465cbb` 到 `~/.qoder/tmp/ampath-latest` | 旧快照会误导判断 | FIXED |
| E-09 | 两个会话同时改同一批文件 | 10-28 又出现并发提交（`9613fc6`） | 改动互相覆盖 | OPEN（需定单 Writer） |
| E-10 | `life.json` 出现 `lastKind: forced` 与 `FORCE_ACTION` | 强制轮与自然轮混在一起，统计口径失真 | 会污染"自主性"证据 | OPEN |
| E-11 | **B 站动态拿不到阅读数**（接口只给赞/评/转 `module_stat`） | 已核实；`ARCHITECTURE.md` §4.6 已改口径 | #21 内容效果复盘只能用互动率，不能用曝光 | FIXED（口径已更正） |
| E-12 | **P2 投稿的上传协议不在 bili-cli 仓库里**：它只是封装 `bilibili-api-python==17.4.2`，而该依赖上游已归档 | 已核实（`src/bili_cli/commands/dm.py` 同仓库结构，投稿走库内部） | P2 视频要么重写 upos 上传，要么换实现；是 P2 的头号风险 | NEED-USER |

## 5. 已修复（留档，防止回退）

| ID | 问题 | 修法 | 证据 |
|---|---|---|---|
| F-01 | ack 路径穿越 | `ID_SHAPE` 白名单 + resolve 前缀校验 | drill 33/33 含 6 种穿越 |
| F-02 | 频率门吞效果 | 删除 `FrequencyGate`，同源效果全部生效 | 20 次 `masterReplied` → connection 累加 |
| F-03 | 场值离线穿基线 | `decayAtomicFields` 截断到基线 | 365 天与 21 天结果一致 |
| F-04 | 崩溃清空记忆 | 原子写 + `.bak` + schemaVersion + 坏文件留档 | 实测 `bakRecovered true` |
| F-05 | 令牌不可用 | 完整 token + `wx` 认领 + 常量时间比较 + TTL 12h | drill 四种拒绝路径 |
| F-06 | 门禁 2 小时自动放行 | 删除后门，`canDraft` 只认 `debriefed===true` | drill "未 debrief 被拒" |
| F-07 | 日记冻结导致重复文案 | `bili_diary_append` + 24h 新鲜度闸 + 当天日期块 + 跨日同文去重 | 10-28 日记含三个日期块 |
| F-08 | 审计结果不回写 | `draft-result` → `consumeDraftResults` 代码结算 | track-a 11/11 |
| F-09 | 记忆不写入 | debrief 成功后 `rememberWatch` | drill "debrief 后写入长期记忆" |
| F-10 | 硬耦合无上限 | `COUPLING_CAP_MS=12h` 分步结算 | persona 17/17（**但见 D-07：这个修法本身有问题**） |
| F-11 | 蓝图中 13 处曲解 | v2 更正 + 纪律第 3 条 | `BLUEPRINT.md` §9 |

## 6. 复发型教训（每次改代码前读一遍）

1. **"测试全绿"不能证明任何事**——门禁与测试同批写＝循环论证。三次外审抓到的全是"写了但没生效"。
2. **自评系统性虚高**（11→8.5→2/10）。任何"完成"必须附 run id / 命令输出 / 文件行号。
3. **抄旧值会制造事实错误**（v1 的"唤醒 0 次""日记冻结"）。坐标必须当天重测。
4. **用残缺证据下结论比原错误更严重**：v1 曾把用户消息截 400 字、助手截 1500 字，再在截断文件里 grep 词频当结论。证据必须完整、读上下文。
5. **不要把主人的优先级/限定条件写成否决**（BLUEPRINT §9 的 13 条）。无原话出处的"弃/非目标"一律标"助手判断·待拍板"。
6. **一个状态文件一个写者**；跨进程写必须锁 + 原子写。

## 7. 与 ARCHITECTURE.md 的对应

| ARCHITECTURE 期 | 覆盖本台账条目 |
|---|---|
| M0 止血 | D-01 D-02 D-03 D-10 D-11 D-12 D-15 D-16 D-18 D-23 E-09 |
| M1 情绪与场值 | D-05 D-06 D-07 D-13 D-14 D-19 D-24 D-26 Q-01 |
| M2 运行时 | D-08 D-09 E-10 |
| M3 传感器 | D-04 Q-03 Q-04 |
| M4 记忆改行为 | D-03（检索侧）D-26 |
| 持续 | E-01 E-02 E-04 E-06 E-07 |

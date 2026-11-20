# Cortico 运行手册（小鱼）

> **读前先看这份手册的年份**（2026-11-12 校准）：下面「人设 / World：bili-account / 每轮流程」几节写的是
> 2026-11-04 搬家**之前**那个人格（部署名 `mybot`、代码包 `cormini`）。它现在是**回滚点**，不是线上：
> 数据在 `~/.xiaoyu-home/rollback/deployments/mybot`，怎么退回去见 [specs/10-control-surface.md](./specs/10-control-surface.md)。
> 线上人格是 `xiaoyu`（代码包 `cortico-bot-xiaoyu` + 能力包），当前状态看 [CURRENT.md](./CURRENT.md)。
> 「进程与地址 / 排障」两节仍然适用。

## 进程与地址
- OFM 代理：`127.0.0.1:18910`（转发 OpenCode Go，Responses API）
- Cortico WebUI：`http://127.0.0.1:7799/`
- 一键启动：`start-cortico.cmd`（已注册 HKCU Run：WhaleCortico）
- 线上部署：`~/.xiaoyu-home/xiaoyu`（`deployment.json` 里 `bot=cortico-bot-xiaoyu`；人设两文件都在它的 `prompts/`）
- 代码树：`CORTICO_ROOT` / 本仓 `.env` 指定（本机是 `E:\WorkSpace_Qoder\Cortico-up`）。**没有硬默认**，缺了就报错，见 `scripts/lib/host-root.mjs`
- 回滚点部署：`~/.xiaoyu-home/rollback/deployments/mybot`（旧人格 `cormini` + 旧数据，703 文件已逐文件 sha256 核对）
- **单一调度器**：只由 Cortico World 的生活循环决定她做不做事。DSH 插件时钟已停用（`clock.enabled=false`，`night.windows=[]`），HKCU `WhaleDraft`（21:30 nightly-scheduler）已删除；不要再把它们加回来，否则会抢着出稿。

## 底座（host/cortico）：独立克隆，随时拉上游

底座是**别人的**项目（`Pal-AI-Lab/Cortico`），`git clone` 到 `host/cortico`，自带 `.git`。
我们的代码一行都不放进去，所以它的更新永远是普通的 `git pull`，没有 subtree、没有合并历史。

- `host/` 整棵在 `.gitignore` 里：不进本仓、不占本仓历史。
- 首次（或换机器）：`node scripts/setup-host.mjs` —— 没有就克隆上游最新，有就只报当前版本。
- 装依赖：`cd host/cortico && pnpm install`。
- 挂我们的四个扩展：`node scripts/setup-host.mjs --link` —— 写 `host/cortico/extensions/package.json`
  并 `pnpm install`，四个包用相对 `link:` 指回 `packages/adapters/`（换盘符也不断）。
- 更新到上游最新：`node scripts/setup-host.mjs --pull`（`git pull --ff-only`；有未提交改动就停下报错）。
- 钉某个稳定版：`node scripts/setup-host.mjs --tag v0.2.17`（只在首次克隆时生效；改版本请删掉
  `host/cortico` 再跑）。
- 2026-11-21 实测：全新克隆拿到 **v0.2.17**（`cba606f`），`pnpm install` 22.6s，
  `--link` 后宿主 `describe:extension` 四个扩展全装载——
  xiaoyu `tools 13 / prompts 2`、bilibili `tools 18 / events 4`、media `tools 2`、console-image `tools 1`。
- 更新后必跑：`node scripts/build-webui.mjs`（面板产物跟着底座契约走）、
  `node scripts/check-live-drift.mjs`、`node scripts/run-mjs-tests.mjs`，再起一次实例看四个扩展。
- `host/cortico/node_modules` **别删**：`bin/cortico.mjs:307` 见它不存在就自动 `pnpm install`，
  `:166` 用 `node_modules/tsx` 起 launcher。它不是仓库内容，删了只是下次启动重装（约 20 秒）。
- **不许改底座源码**。需要补的能力一律做进 `packages/`（能力包）+ `adapters/`（转接头）。
  真遇到上游缺陷，做本地补丁记录在 `docs/evidence/`，别把 `host/cortico` 弄成脏工作树——
  那样 `--pull` 会直接拒绝更新。

## 人设（单一来源）
- 她是谁：`deployments/mybot/workspace/CONSTITUTION.md`（唯一身份事实，改这里）
- 这一轮做什么：`deployments/mybot/prompts/ORIENTATION.md`（流程与铁律）
- `~/.bili-ai/persona.md` 是 **DSH 遗留镜像**（时钟已停用），在面板里改它不影响小鱼
- 机器门：`cortico-health.mjs` 会查显示名与两段前缀；见 `evidence/D-19-PERSONA-2026-10-29.md`

## Provider
- 端点：`opencode-go` → `http://127.0.0.1:18910/v1`
- 模型：`deepseek-v4.1-flash`（`deepseek-flash` 已被上游 410 弃用）
- 密钥：`deployments/providers/opencode-go/.env`（`OFM_API_KEY`，勿提交）
- 必须字段：`spec.thinking` 为布尔值

## World：bili-account
工具：`bili_traffic / bili_feed / bili_debrief / bili_diary_read / bili_diary_append / bili_mood_read / bili_mood_apply / bili_draft_dynamic / bili_dm_read / bili_dm_reply`
- 节奏：**生活循环，纯事件驱动（2026-10-30 主人裁决二）**。`persona-core/src/rhythm.ts` 每 3–7 分钟评估一次：无聊(刺激<0.45)/想他(连接<0.45 且不在冷战)/歇够了(距上次行动 12h 起、30h 满) × 体力 × 随机；**次数无上限、无人为间隔**（欲望驱动，Token/体力花完就冬眠；防重入由单 timer 结构保证，B 站侧写间隔由 traffic guard 管）；睡着（距上次行动 ≥6h）时体力按 0.005/h 恢复，醒着不恢复。
- 状态记录：`control/life.json`（今天行动次数/上次时间）；`control/life-status.json`（`mode=state-driven`，给健康检查看）。
- 事件：`bili.action_due`（trigger flush），文本自带她的情绪+成因+最近因果+今天是否已出稿+上一条草稿审批结果。
- 手动验证：`BILI_ACCOUNT_FORCE_ACTION=1` 启动会在 5 秒后投递一轮（计入当天次数、重置 2.5h 间隔），用于不等自然触发。
- 写操作只入待审队列，工具本身不发送。

## 每轮流程（ORIENTATION 已内置）
`mood_read → traffic → feed → debrief（必须）→ diary_read → diary_append（公开"看过/想说" + 私人"本轮留下的判断"）→ draft_dynamic → mood_apply → 汇报`。
出稿三闸：feed 后必须 debrief；公开日记 24h 内更新过；文案不能与其它日期草稿一字不差。

## 审批
- 列表（**默认隐藏 token**，只给草稿/状态/过期时间）：`node scripts/dynamic-approve.mjs list`
- 查看某条完整 token：`node scripts/dynamic-approve.mjs list --show-token <草稿id>`（只显示指定那一条）
- 试发（不消耗审批）：`node scripts/dynamic-approve.mjs approve <id>`
- 真发：`node scripts/dynamic-approve.mjs approve <id> --token <完整token> --go`
- **正文绑定（M1e）**：go 时校验令牌绑定的 `draftId` + 入队时正文哈希；入队后改过稿 → 拒发，要改就 `reject` 后重新出稿。
- token 默认 12 小时；只剩 12h 内有效。冷却/风控类失败会退回 token，可原 token 重试；成功后一次性作废。
- 私信回信草稿：`node scripts/dm-approve.mjs list`（同样默认隐藏令牌，`list --show-token <id>` 查看单条）/ `approve <id>`（dry，不耗 token）/ `approve <id> --token <完整token> --go` / `reject <id>`。她只有 `bili_dm_reply`（只入队），发送仍只走这条审批。

## 纪律
- 正文不写 AI 声明；披露在简介与平台标签
- 每天最多 1 条动态；遇 412/-352/-101 立即停
- 草稿工具幂等：当天已有草稿会拒绝重复

## 排障
- **重启只用** `node scripts/start-cortico.mjs`（或 `start-cortico.cmd`）：单实例、探活、并自动 resume。直接 `node bin/cortico.mjs` 启动会停在 `⏸ 已暂停`，她的生活循环却照跑（D-33）。
- **`bin/cortico.mjs` 没有 `--help`**（2026-11-04 实测踩到）：任何未知参数（包括 `--help`）都不报错，
  而是**按默认端口直接启动 mybot**。当时那条命令是 `node bin/cortico.mjs --help`，
  于是拿 `CORTICO_HOME=Cortico/deployments`（=live 那份数据树）在 7788 起了一个实例，
  接管了上一个已死进程留下的 `instance.lock`，然后被管道 SIGPIPE 掐死。
  后果清点（都核过）：`runs/index.jsonl` 多一条启动记录 + 一个 run 目录
  （`r-20261104-124524-cec3`），里面**落了一条事件**——
  `{"type":"opening","text":"[system] 进程重启,session 已续上。","cursor":345}`；
  因为总线起手就暂停，这条**没有投递**（`core-state.json` 的 `lastDeliveredCursor` 仍是 344），
  但它确实进了事件流，下次真启动还会再有一条 opening，别把这条当成"她说了什么"。
  `instance.lock` 随进程退出删掉；**没有**成功的模型调用、没有 B 站写、workspace git 没有新提交。
  live 7799 本身早在 11-03 23:39 就停了（日志尾是 `LLM API 429: Go usage limit exceeded`，
  `activeProvider` 是额度耗尽的 `opencode-go`），不是这条命令弄停的。
  规矩补一句：**想知道 Cortico 怎么调，读 `docs/` 与 `bin/cortico.mjs` 源码，别用 `--help` 探**；
  要起实例只用 `scripts/start-cortico.mjs`，它才有单实例探活与 pid 文件。
- WebUI 打不开：看 `start-cortico.cmd` 窗口；确认 7799 未被旧实例占用
- Provider 不可用：确认 18910 在跑、`.env` 有 key、`thinking:false`
- 启动即暂停：`curl -X POST http://127.0.0.1:7799/api/run/resume`
- World 未挂载：看日志 `World 已启动: bili-account`；缺少 `envPromptVars` 或实例 `id` 会失败
- 一直不行动：先跑 `node scripts/cortico-health.mjs`；再看 `control/life.json` 的 `lastCheckAt` 是否还在前进（3–7 分钟一次）、`fields.json` 的 `stimulation` 是否在缓慢下降。两者都停了说明 tick 没在跑。
- health 的「看门狗 tick」>10 分钟：看门狗死了或机器睡过；`taskkill` 旧 pid、删 `control/day-watchdog.pid` 后用 `node scripts/day-watchdog.mjs` 重起。
- 电脑睡眠/断电：不用补醒概念——恢复后第一次 tick 会按真实时间结算场值，她想做才做。

# 06 · B 站写路

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。

## ① 现在是什么

进程内一条闸：**WriteGate**。七个写工具（发动态 / 改动态 / 评论 / 私信 / 点赞 / 收藏 / 弹幕）全部只调 `gate.execute`
（`packages/cap-bilibili/src/index.ts:871,895,920,943,966,989,1012`），闸门内部顺序是固定的：
kill 急刹 → 熔断/冷却 → 档位判定（要不要进队）→ 指纹查重 → **网络发送** → 记账（`causal.jsonl`）
（`packages/cap-bilibili/src/domain/write-gate.ts:587-664`）。
待放行队列是单文件 `<dataDir>/pending-queue.json`（`:175`，原子写 `:349`），条目放行后改 `released` 不删（`:489`），
≥48 小时的过期稿放行需二次确认（`:467`）。执行器分派表在 `packages/cap-bilibili/src/client/bili-write.ts:343-365`，
动态/改动态/私信在 `packages/cap-bilibili/src/client/bili-write-extra.ts:42/97/159`。

**盘上还留着两条旧线**，与这条新闸互不相知：旧草稿线 `<draftsDir>/<date>.json` + ack 令牌
（`tools/drafts/store.mjs:42-44`、`scripts/ack.mjs:13-14`，实测命中 `D:/AI/养鱼/drafts`，最新到 11-03）
和 go-gate 的 `pending-replies.json`（`tools/lib/go-gate.mjs:8`）。三条队列、两个 policy 源（新 `data/bilibili/policy.json`、
旧 `bili-whale.config.json` 的 `publish/permissions`），**没有任何对账代码**。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `draftMode` | 生效默认 `auto`（`write-gate.ts:73`）；判定 `:352-368`、`:384`、`:545` | `<dataDir>/policy.json` 的 `draftMode`（实值 `auto`） | 总控台下拉（`packages/cap-bilibili/src/webui/client.ts:567-574`、渲染 `:693-719`） |
| `autoDailyCap` | 读入归一 `write-gate.ts:201`；**唯一判定 `:385-386`（`if (cap > 0)`）**；分母 `:651-652` → `quota.json` | `policy.json` 的 `autoDailyCap`（实值 **0 = 不限**） | 输入框 `webui/client.ts:726-727`、保存 `:733-738`、标尺文案「0 = 不限」`:757` |
| `autoWindow` | `write-gate.ts:392-395`；解析失败 = 不限（`:50`） | `policy.json`（实值 `00:00-24:00`） | 输入框 `webui/client.ts:727` |
| `like` / `fav` / `dmReply` / `comment` / `danmaku` | `write-gate.ts:352-368` 档位表 | `policy.json`（实值 self/self/direct/review/self） | 五个下拉 `webui/client.ts:693-719`（**改松才弹确认** `:702` + `LOOSERTIER` `:80`） |
| `writeGapSec` | 闸内 `write-gate.ts:263/271`（默认 10s）→ 判定 `:601-602` | `traffic-state.json`（实值 120） | 输入框 `webui/client.ts:770-795`，保存 `packages/cap-bilibili/src/index.ts:1304` |
| `pausedUntil` / `pauseReason` | 412 → 30 分钟熔断 `write-gate.ts:636-640`，消费 `:590` | `traffic-state.json` | 「解除熔断」按钮，需 `confirm` `webui/client.ts:678-679` → `index.ts:1285-1290` |
| `killOn` | 急刹 A `write-gate.ts:178/522/627`；急刹 B（传输层）`packages/cap-bilibili/src/platform/kill.mjs:18` → `traffic.mjs:100` | 文件 `<dataDir>/KILL`（实测不存在＝关） | 单个按钮 `webui/client.ts:605-607` |
| `seenFingerprints` | `write-gate.ts:614-616`，保留 500 条（`:266`/`:656`） | `traffic-state.json` | 无独立控件（随快照显示） |
| `risk.writeGapSec`（旧线，下限 30s） | `packages/cap-bilibili/src/platform/traffic.mjs:8/21/119-120` | 旧 `bili-whale.config.json` | **闸内面板改不到它**（见 ⑤ 第 5 条） |

## ③ 失败与边界

- **凭据缺失不前置拦截**：空 cookie 照样出网（`packages/cap-bilibili/src/index.ts:260-263` 读写同一份现取凭据），
  失败以 `-101/-111` 平台错回来（`packages/cap-bilibili/src/client/bili-write.ts:81-82` 把码翻成人话）；主人可见处是连接页体检（见 07）。
- **平台失败**：`exit 6 / code:'platform'`，账落 `<dataDir>/causal.jsonl` 的 `<kind>-failed` + `stage:'platform'`（`write-gate.ts:644-645`）。
- **传输层失败**：`exit 4`，412 记 `http_412` 并熔断（`:636-643`）；`-509/-352/429` **只在传输层记**（`packages/cap-bilibili/src/platform/traffic.mjs:158`、退避 `:167-170`），闸内不识别。
- **两道防双发**：闸内指纹（`write-gate.ts:614-616`）＋ 传输层操作幂等，且"结果不确定禁止自动重发"（`traffic.mjs:117`、`:183`）。
- **拒稿会回灌给她**：`bili-account.draft_rejected` 事件（`packages/cap-bilibili/src/index.ts:353-361`）；主人点单 `:366-372`。
- **放行前先存正文**：面板会在放行前把页面上的稿子写回去，存失败就中止放行——防止发到 B 站的是旧稿（`webui/client.ts:342-344`）。
- **不污染 ②**：策略与流量状态各自单文件、原子写；`policy-change` 也进 `causal.jsonl`（实测 5 条）。

## ④ 操作面

总控台（`gate-policy`）：六个档位下拉、`autoDailyCap`/`autoWindow`/`writeGapSec` 输入框、急刹按钮、解除熔断（要确认）——**全部热生效**，不需重启。
待放行台（`drafts-queue`）：点单看正文、在线改字续签、**逐条**放行/拒稿（`webui/client.ts:265/324/336/359/379`）。
**只能改文件**：`<dataDir>/KILL` 之外的第二把急刹 `~/.dsh/bili-whale/control/kill`、旧线 `bili-whale.config.json` 的 `publish.*`/`permissions.*`、旧草稿目录。
**只有 CLI**：旧线批量放行 `node tools/bili.mjs reply-draft release --all [--dry]`（`tools/commands/reply-draft.mjs:120-131`）——新队列没有批量入口（⑤ 第 10 条）。

## ⑤ 已知缺陷与验证方式

1. **`autoDailyCap: 0` 的语义在这里写死：0 = 不限，不是全拦。** 判定体被 `if (cap > 0)` 整块跳过（`write-gate.ts:385-386`），
   函数返回空字符串即"不拦"；唯一真实刹车是 `draftMode` 与档位表本身。复现：
   `grep -n "if (cap > 0)" -A6 packages/cap-bilibili/src/domain/write-gate.ts` ＋ `node --test packages/cap-bilibili/tests/auto-publish-tiers.test.mjs`（第 53 行那条验的是"撞上上限 → 降级进队列"，不是"0 → 拦"）。
2. **开闸至今这条线没有产生过一次对外凭据**：2026-11-07 实测 `causal.jsonl` 227 行里 `dynId` 0 次、`kind:"dynamic"` 0 次、
   `traffic-state.json` 的 `lastWriteAt` = 0、`pending-queue.json` = `[]`；唯一真实发布回执是旧路径 11-02 的 `auto-publish ok:true`。
   复现：`node scripts/outward-evidence.mjs --date=2026-11-06`（FAIL，硬凭据 0、自记 226 笔）。
   **缺的不是闸门，是出口**（主人拍板见 [`CURRENT.md`](../CURRENT.md) 11-06 条目；出口一侧的工作在 #62/P4）。
3. **面板 schema 与生效默认相反**：`packages/cap-bilibili/src/index.ts:388` 声明 `draftMode` 默认 `review`，
   生效默认是 `write-gate.ts:73` 的 `auto`；而 `defaultConfig`（`index.ts:409-416`）**没有任何代码把它写进闸门**，
   `savePolicy` 只在面板 set 时调用（`index.ts:1298`）。改宿主 `config.json` 的 `publish.*` **不会动闸门**。
   复现：`grep -rn "publish" ~/.xiaoyu-home/xiaoyu/config.json | wc -l`（实值 0）＋ `grep -n "draftMode" packages/cap-bilibili/src/index.ts | head -3`。
4. **`readPolicy` 的两条兜底互相矛盾**：文件不存在 → `auto`（`write-gate.ts:210`）；文件存在但缺 `draftMode` 键 → `review`（`:200`）。
   复现：`node --test packages/cap-bilibili/tests/bilibili-capability.test.mjs` 之外没有针对这两种半态的测试（`grep -rn "readPolicy" packages/cap-bilibili/tests | wc -l`）。
5. **两套急刹、两套写间隔，互不相通**：面板保存只写闸内那份（`packages/cap-bilibili/src/index.ts:1304`），
   传输层读的是旧配置 `risk.writeGapSec`（下限 30s，`packages/cap-bilibili/src/platform/traffic.mjs:21`）。
   复现：`grep -n "writeGapSec" packages/cap-bilibili/src/domain/write-gate.ts packages/cap-bilibili/src/platform/traffic.mjs` —— 两条链没有交集。
6. **执行器抛错时既不产生 verdict 也不写 `<kind>-failed`**：`write-gate.ts:631-633` 对 `opts.executor(action)` **没有 try/catch**，
   而 `TrafficError`（`packages/cap-bilibili/src/platform/traffic.mjs:100/117/183`）与 `fetchVideoInfo` 失败（`packages/cap-bilibili/src/client/bili-write.ts:125`）正是以异常冒出来。
   后果：账上看不见失败，主人只看见工具报错。复现：`grep -n "await this.opts.executor" -B3 packages/cap-bilibili/src/domain/write-gate.ts`。
7. **闸门在没有执行器时会造一个成功回执**：`{ ok: true, dynId: 'sim-'+Date.now() }`（`write-gate.ts:632-633`）。
   生产路径暂时安全——包内装配口有兜底 `executor: opts.writeExecutor ?? defaultExecutor`（`index.ts:349`）；
   风险在**直接 new WriteGate 而不给 executor**（今天的测试就是这么干的），那样会得到"发出去了、dynId 是 sim-"的假凭据，
   而 `sim-` 前缀一旦被当真实 id 送进 09 的成片队列，后果不可见。
   复现：`grep -n "sim-" packages/cap-bilibili/src/domain/write-gate.ts` ＋ `grep -rn "new WriteGate" packages tools scripts`。
8. **带图动态未实现**：执行体只发 `type:'4'` 纯文本（`packages/cap-bilibili/src/client/bili-write-extra.ts:48-55`，注释 `:39-41` 明写"没有验过的请求形状，不在这儿编一个"），
   而 `imagePath` 一路传进队列却在执行处被丢掉（`index.ts:330-333` 只透传 `target/body`）。带图只在旧线（`tools/drafts/publishers/bilibili-dynamic.mjs:87`，上传↔发布之间硬睡 125s）。
   复现：`grep -n "imagePath" packages/cap-bilibili/src/index.ts packages/cap-bilibili/src/domain/write-gate.ts`。
9. **点赞/收藏/私信没有平台 id 入账**：回执只映射 `rpid` 与 `dynId`（`index.ts:338-343`），其余 `meta` 丢弃——
   所以"她发过什么"这一层对 like/fav/dm 只能是"我们自己记的"，不是平台凭据（与 04/#62 的判据口径一致）。
   复现：`node scripts/outward-evidence.mjs --date=2026-10-30`（PASS 靠的是 `dyn-20261030-741fdf`，不是自记）。
10. **新队列没有批量放行**：`releaseAll`/`releaseMany` 在包内引用数为 0（实测 `grep -rn "releaseAll\|releaseMany" packages/cap-bilibili/src | wc -l` → 0），
    批量能力只活在旧线 CLI。面板逐条 `webui/client.ts:336`。
11. **旧线的上限与时段是空转实现**：`tools/lib/publish-policy.mjs:48/58` 的 `capReached()`/`inWindow()` 生产零调用（只有 `tests/publish-policy.test.mjs:42-44`）。
    复现：`grep -rn "capReached\|inWindow" tools scripts packages | grep -v publish-policy.mjs | grep -v test` → 无生产调用者。
12. **world 桥接层的日志形状会让写路日志二次抛错**（与 [03 第 8 条](./03-reflection-and-judgment.md) 同源，本轮纯文档不修）：
    `packages/cortico-world-bilibili/src/cortico-world.ts:117` 的 `host.log?.(...)`，而宿主给的是 Logger 对象（`E:/WorkSpace_Qoder/Cortico-up/src/core/types.ts:1181`）。
    复现（三行，离线）：`node -e "const log={info(m){return m}};try{log?.('warn','x')}catch(e){console.log('抛错：'+e.message)}"`；
    现存调用点清点：`grep -rn "host.log?.(" packages/cortico-world-bilibili/src packages/cortico-world-media/src packages/cap-bilibili/src | wc -l`。

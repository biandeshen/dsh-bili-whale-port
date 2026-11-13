# P2「她停了多久」+ P3 旧家摘除 —— 证据（2026-11-14）

复核方：第三方 2026-11-13 23:45 只读复核附件（`07-HANDOFF-REMAINING.md`）。
本轮只做 P2 与 P3 的前置；P1（stub）按复核方给的前置顺序等 B 段批准。

提交：见本文件所在提交（`git log -1 -- docs/evidence/liveness-and-orphan-2026-11-14.md`）。
测试读数：`EXECUTED=152/152`、`tests=876 pass=876 fail=0`，7 个门禁全绿。

---

## 一、先纠正复核方的三处事实（不是抬杠，都会影响判断）

### 1. 线上 7799 跑的**已经是**修复后的代码

复核说「23:37 我起的实例跑的是修复前代码」。实测不成立：

```
$ stat -c '%y %n' packages/cortico-world-bilibili/src/cortico-world.ts
2026-11-13 23:35:04.068644700 +0800          ← 修复落盘
$ grep -n "启动: xiaoyu" ~/.dsh/bili-whale/control/cortico.log | tail -1
31353:  启动: xiaoyu                            ← 23:36:59 启动，晚于修复
$ grep -n "World 已启动: bili-account" ~/.dsh/bili-whale/control/cortico.log | tail -1
31364:[23:36:59.881] INFO  core: World 已启动: bili-account   ← 起来了
$ grep -c "host.log is not a function" …/cortico.log
49                                            ← 全在 00:40 之前的历史 run
```

`host.log` 那 49 条错误最后一次出现在 `00:40:33`（更早的 run）；23:36:59 那次启动起，`bili-account` 一直在
`World 已启动` 列表里。**所以「重启验证」这一条已经天然完成**（任务 #78 可关）。

### 2. 余额**没有**真正恢复（这条最要紧）

复核说「主人确认余额已补，近 6 分钟 0 次调用，我没验到」。实时账：

```
23:50:30  200 成功
23:53:20  402 Insufficient account balance
```

23:50 确实成功过一次，但 3 分钟后又是 402。读数是：

```
余额不足（最近 402：1 分钟前）——恢复也不会活，要充值。最近一次成功调用 2026/11/13 23:50:30
```

**结论：余额只短暂可用，之后又被拒。** 这正好说明 P2 要做的第三种状态有现实价值——
如果只看"她今天做了 12 件小事"，没人知道门又关上了。

### 3. 「新家启动演练只 cp 不算」——已按此做，并且**第一次就撞出一个前置缺陷**

回滚点只拷贝 `deployments/mybot` 起不来：`activeProvider="opencode-go" 在 providers 段里不存在`。
必须同时带 `~/.xiaoyu-home/rollback/deployments/providers`。**这条以前没写进回滚计划**，已补进 specs/10 ④。

---

## 二、P2 交付

### 2.1 新文件：`packages/cap-state-rhythm/src/liveness.ts`

四种状态，每种都带「多久了」：

| kind | 判据（互斥，按此顺序） | 面板一句话 |
|---|---|---|
| `no-balance` | 最近一条 402 晚于最近一条 200 | 余额不足（最近 402：N 前）——**恢复也不会活**，要充值 |
| `stopped` | `instance.lock` 的 pid 不存在 / 锁读不到且沉默超阈值 | 已关机（已停 N 天 M 小时）——进程没在跑，不是"她很安静" |
| `paused` | 进程活着 + 总线暂停（`processState='paused'`） | 已暂停（已停 N 小时）——进程活着但总线暂停，不是"她不想动" |
| `running` | 其余 | 运行中（最近活动 N 前）。最近一次成功调用 … |

- **402 排在暂停之前**是有意的：余额不足时进程活着、总线也开着，她照样说不出口。
  暂停只决定「愿不愿意动」，402 决定「能不能活」。
- `instance.lock` 读不到/坏 json → `alive=null` **未知，不判已关机**（不污蔑）。
- `basis[]` 把读了哪些文件、读到什么一起返回（可复现，不许只给结论）。
- 只读：不写任何文件，不杀进程，不抢锁。

### 2.2 面板落点

`packages/cap-state-rhythm/src/index.ts` 的 `day.get` 返回新增 `liveness` 字段（在 `cost` 旁边）；
`packages/cap-state-rhythm/src/webui/client.ts` 在立绘区**成本行上面**渲染，异常态用红色加粗。
位置可 `grep -n "liveness" packages/cap-state-rhythm/src/webui/client.ts`。

### 2.3 真宿主验证（不是 FakeEl、不是单测）

隔离实例：临时 home + 端口 7798（线上 7799 全程未重启、未改）。

| 场景 | 构造方式 | 实际返回 |
|---|---|---|
| 余额不足（真实现状） | 用线上真实数据 | `kind=no-balance`；`line=余额不足（最近 402：13 分钟前）——恢复也不会活，要充值。最近一次成功调用 2026/11/13 23:50:30` |
| 已关机（复现 11-10） | 副本上删 lock + 把成功时间改到 11-10 00:42 | `kind=stopped`；`line=已关机（已停 3 天 23 小时）——进程没在跑，不是"她很安静"。最近一次成功调用 2026/11/10 00:42:00` |
| 已暂停 | 单测（宿主不给 World 暴露总线暂停态，见下） | 见 `tests/liveness.test.mjs` 第 3 条 |

**如实说明一条边界**：宿主 `WorldCtx` 没有把「总线暂停」暴露给 World（`types.ts` 全文无 paused 字段），
所以 `paused` 目前只能由注入的 `processState` 判断，面板侧拿不到这个值——
线上真停总线时，面板会显示 `running`（有成功调用）或 `stopped`（沉默超阈值）。
要真正做到「已暂停」实时可见，需要宿主加一个字段；这是**跨仓改动**，登记在 ⑤，不在本批做。

### 2.4 402 单独分类 + 长间隔重试：**这两条本来就有**

复核说的三点里，第 2、3 点在 2026-11-06 那批就做了，本轮只补了第 1 点（可见面）：

- 402 分类：`packages/cap-state-rhythm/src/cost-today.ts:37` `verdict: 'ok' | 'stalled-auth' | 'throttled' | 'quiet'`，
  402 与 429 分开，`last402At` / `stalledMinutes` 都在返回值里。
- 长间隔重试：`packages/cortico-bot-xiaoyu/src/cortico-persona.ts:178-200`，
  1/2/4/8/16/30 分钟（`STALL_STEP_MAX` 封顶），恢复后 `st.until=0` 立刻回原节奏。
  注释里写明「被拆掉的变相配额不许借这个口子还魂」——它节流的是**对着死端点的重试**，不是行动次数。
- 缺口：这份退避状态在 `this` 上，重启清零（最坏退化成"照原节奏撞几下"），已在注释里声明。

---

## 三、P3 前置交付：旧家摘除 + 新家真启动

### 3.1 旧孤儿目录 `E:/WorkSpace_Qoder/Cortico/deployments/mybot`

全量逐文件 sha256 对比（不是抽样）：

```
先：旧 704 文件 / 新 699 文件
差集：旧有 = 5 个文件（同一 run）+ data/runs/index.jsonl 多 2 行
     run = r-20261113-233335-5f29 —— 那是 2026-11-13 23:33 我用 `bin/cortico.mjs --help`
     误起的一次事故 run（日志：world-start-failed + uncaught-exception），必须清掉
处理：rm -rf 那个 run 目录；index.jsonl 用新家的那份覆盖（两行 start/end 记录）
后：旧 699 文件 / 新 699 文件
逐文件复验：同=699 不同=0 差集=∅
```

**699 → 699**，`comm -3 old new` 为空。

另注：`Cortico` 仓里 `deployments/` 是 `.gitignore:10` 覆盖的，`git ls-files` 只有一个
`deployments/mybot/prompts/ORIENTATION.md`（历史遗留，非本次数据）。删除整个目录不在我的授权内，未动。

### 3.2 新家启动演练（真起，不是 cp）

```
$ cp -r ~/.xiaoyu-home/rollback/deployments/{mybot,providers} <tmp>/
$ CORTICO_HOME=<tmp> CORTICO_BOT=mybot node bin/cortico.mjs mybot --port=7797 --host=127.0.0.1
  启动: mybot
  [00:03:14.332] INFO  core.bus/paused: 总线已暂停
  [00:03:14.367] INFO  webui: web面板已启动 http://127.0.0.1:7797/
  [00:03:14.393] INFO  core: World 已启动: console
  [00:03:14.400] INFO  worlds.bili-account: 收件箱监听已启动（回复/@我/收到的赞 + 主人私信）
  [00:03:14.409] INFO  core: World 已启动: bili-account
  [00:03:14.424] INFO  core/started: core已启动
  Bot: mybot (小鱼) / 主模型: deepseek-v4.1-flash
```

- 第一次（只拷 mybot）**失败**：`activeProvider="opencode-go" 在 providers 段里不存在` —— 已补 providers。
- B 站接口报 `code=-101 账号未登录`：回滚点里是旧 cookie，预期内。**这一格是"旧数据能装载"，不是"旧账号能上网"。**
- 演练实例已停、临时目录已删；线上 7799 全程 200。

### 3.3 一条必须写进回滚计划的前置

`scripts/start-cortico.mjs` 的标准回滚命令（`CORTICO_HOME=.../rollback/deployments`）隐含要求
`rollback/deployments/providers` 存在。遗漏就是上面那个启动失败。已在 specs/10 ④ 补一句。

---

## 四、需要主人点头的一句话（B 段，P1 的前置）

> **请批准：删除宿主检出 `E:/WorkSpace_Qoder/Cortico-up/persona-core/` 整个目录，并同时移除
> `Cortico-up/package.json` 里 `"@xiaoyu/persona-core"` 依赖（第 38 行）与 `pnpm-workspace.yaml`
> 里对应的 `persona-core` 条目（第 14 行）。**
>
> - **删完怎么验**：① `Cortico-up/src` 里 `grep -rn "persona-core"` 为 0（现在就是 0，运行时不引用它）；
>   ② 宿主 `node --import tsx --test` 用例数从 229 降到 139，**那 90 个是本仓已有同源版本的旧副本测试**
>   （本仓 `packages/persona-core/tests` 90 例全绿，其中 3 份比宿主那份更新），不是测试变少；
>   ③ 宿主 `bin/cortico.mjs --list` 仍能列出 `xiaoyu` 与 4 个世界。
> - **失败怎么回滚**：动手前 `git -C Cortico-up bundle create ../Cortico-up-persona-core-<date>.bundle --all`
>   + `git -C Cortico-up tag persona-core-before-removal`；失败时 `git checkout persona-core-before-removal -- persona-core`
>   并还原两个声明文件即可，数据目录一概不涉及。
> - **不做什么**：不删 `Cortico`（984M）与 `Cortico-new`（991M）两个死目录——那是第三方/主人执行，我只出清单。

同时请确认 **#78 可以关掉**：线上 7799 已在跑修复后的代码（证据见本文 §一.1），不需要再重启。

---

## 五、没验的 / 登记

1. **「已暂停」的实时可见性**需要宿主暴露总线状态（`WorldCtx` 无此字段）。跨仓改动，未做。
2. **余额是否长期可用**没验——只观测到 23:50 成功、23:53 再 402。这是主人的账户问题，不是代码问题。
3. **长间隔重试的退避状态不持久**（在 `this` 上，重启清零）。当前注释已声明；若要持久化需明确"写哪、会不会变成配额"。
4. 本轮没有动 `Cortico` / `Cortico-new` 任何文件（只读了 `Cortico/deployments/mybot` 并清掉那次事故 run 的残影）。
5. P1 stub 仍未开始：按复核方顺序等 B 段批准。**B 段批准请求已写成上面 §四 那一句。**

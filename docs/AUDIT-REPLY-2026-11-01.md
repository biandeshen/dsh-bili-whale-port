# 对账与更正（2026-11-01，回应第三方审计）

审计报告：`E:/WorkSpace_Qoder/AUDIT-2026-11-01.md`（仓外，不进版本控制）。本文只做两件事：
**已修的逐条对应到提交**，以及**审计指出的三处自评失真公开更正**。

## 一、公开更正（不静默改）

审计 §6 核实的失真，逐条认：

1. **意见箱数字**：我上一轮报"25→21"，磁盘实际是 32 条 / 未结 27（high 11）。
   数字口径错在我用会话里的印象代替了磁盘计数。
2. **"context-facts 开工前就红"**：实际是本批 `e9d5b03` 打破的断言（期望 `GET /models 401`，
   实现改成了中文人话）。归因错了：不是既有红，是我的改动带来的断言过期。
3. **"审计报告已落成文件"**：当时根本没写任何文件。报告是后来按你的要求补写的。

共同机制：**结论比证据远**。对应的流程锁见第四节。

## 二、地基（读数为准）

| 审计项 | 处置 | 提交 |
|---|---|---|
| P0-1 风控额度分账 | 所有状态读写收敛到 `tools/lib/paths.mjs`；加断言扫描全仓禁止散拼 `.bili-ai` | `11d69eb` |
| P0-2 待审稿读数与面板分家 | 两个 `DRAFTS_DIR` 合成一处（`tank.ts` 的 `resolveDraftsDir`），definition 引用它 | Cortico `91aa02e` |
| P0-3 go-gate 读失败清空队列 | 读不出来就拒绝写；`reply-draft` 同样 | `11d69eb` |
| P0-4 因果账被 `catch {}` 吞 | `causal()` 失败上抛；配置已改好只是记账失败时用 `withLedgerError` 保留结果并报因 | Cortico `91aa02e` |
| P0-5 kill 不覆盖第三方出口 | 检查提到域名分叉之前；STOP-RUNBOOK 改成事实口径并写明边界 | `afbb466` |
| P1-1 dm 额度分叉 | 写只落新家 | `11d69eb` |
| P1-2 备份目标解析错、transcript 为 0 | `runs/` 与部署 `config.json` 纳入备份；草稿根按"存在优先"排序（原来按字母排，D 盘的实目录掉到第二名） | `11d69eb` |

备份实测：文件数从 111 涨到 704，`cortico/deployments/mybot/data/runs` 586 个文件。

## 三、功能

| 审计项 | 处置 | 提交 |
|---|---|---|
| P0-6 对话历史回看 | `GET /api/session/history/search`（按 run 日期 / 关键词 / 角色）+ 控制台历史面板的检索行 + `runs/` 进备份 | Cortico `2affef6` |
| #7 日记按小节检索 | `bili_diary_read` 加 `heading`；不带过滤时回执列出这本有哪些小节 | Cortico `2affef6` |
| #9 图片能收不能看 | 兼容端点补 `accepts`（读 `multimodal`）；控制台 `console_see_image`；看不了时正文写明 | Cortico `e5eb872` |
| #10 浏览器扩展激活死锁 | 先落盘启用意图再前置检查，失败回滚；激活失败写服务端日志 | Cortico `ddca555` |
| #11 模型选型 | `deployments/mybot/workspace/MODELS.md`（实测表，含三个"收下图但答错"的）；候选预置进端点 | 部署文件 |
| #12 上游 | `scripts/upstream-audit.mjs`；opencode provider 的 `StreamErrorEvent` 已由另一会话补上 | Cortico `e78e84a` / `ddca555` |
| #14 通知接线 | `tools/lib/report.mjs` + like/fav/dm/dynamic-image/评论被拦 全部接上；`quota.selfDaily` 默认 6 | `6187c9c` |

## 四、流程锁

- `run-mjs-tests.mjs`：逐文件跑，比较发现数 / 执行数；`--report` 落 `docs/evidence/gates-<date>.json`。
  原来 `EXECUTED = files.length` 是传参算的，同义反复。
- 本仓第一个 `.github/workflows/ci.yml`；Cortico 的 `ci.yml` 补 `master` 与 `test:mjs`。
- 冻结哈希随判据变更重冻（`check-hashes.mjs --write`），diff 里能看到。
- 本文件提到的每个提交号都可用 `git show <sha>` 复核；门禁数字只引
  `docs/evidence/gates-2026-11-01.json`，不在正文里抄。

## 五、意见箱回写

按审计 §5 逐条改状态（不拿总数糊）：

- **已修待标 → 已结**：`f-ac48e3`（扩展清单可见性）、`f-54fb32`（字幕路径）、
  `f-17767a`（debrief 不再指不存在的读图工具）、`f-aec73f`（采样口径 + 桶数警告）、
  `f-da8994`（日记按日期/小节检索）、`f-579859`（图片能看）、`f-b7c6ad`（`home is not defined`）。
- **工具在、存量没清 → 已结并说明**：`f-e66393`。查过 48 条记忆，没有
  "watchedVideo 把不收写成喜欢"的条目，`void` 标记 0 条是**因为没有对象**，不是漏做。
- **闹钟三连 → 已结**：`f-ac6261` / `f-b9a891` / `f-4fe2c2`。没等 pet-diary 上游，
  本部署自己给了 `bili_alarm`（分钟 + 一句话，走持久队列，重启照响）。
- **口径冲突 → 已结**：`f-af013b` / `f-b51b3f`。`bili_capabilities` 改成事实口径：
  装/卸与改配置归主人，启用/停用她自己能点（Cortico `316928b`）。

## 六、没做的

- **上游整跟**：本地与上游**没有共同祖先**（`upstream-audit` 实测），merge 会把两边都当新文件。
  只做了定点 backport（`StreamErrorEvent`）。整跟要单独立项。
- **密度排序后半**（改分位数/分布形态代替条/桶）：未做。
- **扩展安装安全**（审计 P1-3：主进程 import 第三方代码、无签名校验）：未做，属设计问题。
- **成本口径**（539 次调用 `cost=0`）：价格表没配，未做。

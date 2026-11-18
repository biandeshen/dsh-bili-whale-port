# 文档体制改制 · 转主任务施工指令

> 来源：主人 2026-11-07 拍板「每个功能拆开写详细设计文档」+「避免双写」。第三方只出方案与骨架，**不动 `docs/`、`packages/`、`scripts/`**。

## 零、先把病名说清（不是数量问题）

实测：全仓 **157 个 `.md`**，`docs/` 里 **121 个**（含 46 个 evidence）。按命名意图分：evidence 46、运维说明 12、交接与状态台账 9、判据与决策 9、架构 7、计划排期 7、评审走查 7、其他 33。

**"某功能现在是怎么设计的"这一类 = 0 份。**

硬证据：`docs/` 从今日中午 **59 → 131 篇，12 小时翻倍**。这套写法的规则是只增不换，所以它没有终点。

因果关系（这条必须承认，它是本轮 bug 的来源之一，不是并列的两件事）：**改代码时没有规格可对照，只有案卷可翻** → 同类坑反复来（`core.log` 形状炸三处、家目录读错骗过只读评审席位、`check-state-roots` 报分叉却 EXIT=0、断言不存在的 `go-gate.mjs`）。

## 一、目标形态：10 份，不是 121 份

建 `docs/specs/`，十份功能详设。**每份固定五节，不许加节**：

```
① 现在是什么（一段话 + 状态机/数据流图，只写成立的事，不写历史）
② 真值在哪（参数名 → 定义 file:line → 配置文件键 → 面板控件，四者必须对齐）
③ 失败与边界（每个失败路径写清：谁看得见、账落不落、会不会污染 ②）
④ 操作面（主人能改什么、改了要不要重启、没有面板入口的明确写"只能改文件"）
⑤ 已知缺陷与验证方式（可判定的复现命令，不许写"待观察"）
```

### 十份清单 + 每份必须钉住的东西（这些全是本团队本轮实测，不是待办想象）

**1. `01-rhythm-and-autonomy.md` 作息与自主行动**（bug 最密，建议先写这一份）
四路驱动（explore/connect/restPressure/activityDrive）、`CHECK_PROB=0.35`、间隔 30–90s、三态休息、`life_do` 与 7 类活动、行动账 `actions.ndjson` 对账。
必须钉：实测 generation **116–125 次/小时** vs 参数算出的投递上界 **42 次/小时**（2.9 倍）——**概率门事实上没生效，这一条要在文档里给出解释或被修掉**；`lastKind` 只写不读、`pickActivities` 无当日记忆；226 笔/86% 重复/中位 62 秒；`expireModeIfNeeded` 不存在、`gapLeft` 与 gap/cap 分支为死码；"唯一节流阀是体力"已被 402 那天证伪。

**2. `02-memory-and-retrieval.md` 记忆与检索**
卡片分层与上限、四因子召回、作废/回滚、遗忘、core 退位审阅台。
必须钉：`activeCap=40` 是空旋钮（active 实测 45）、`memory_remember` 进 core 不查上限（core 21 vs 8）；权重 0.40/0.30/0.15/0.15 的唯一出处是仓外的 AMpath，**属无依据**；`kw=hit/maxIdf` 单点罕见词即饱和、**60% 分数与查询无关**；两处可达性黑洞（core 按最新截断丢最老身份卡；被想起过又归档的卡永久召不回）。

**3. `03-reflection-and-judgment.md` 反思与判断卡**
睡前反思触发与频次、`judgment_revisit` 取题器。
必须钉：`core.log` 是 Logger 对象不可调用，同一坑炸过三处（含一次 `uncaught-exception` 直接关机），`?.()` 挡不住它；`dreamDigest` 是否仍为模板**未结清**；反思账本记的是"尝试次数"不是"成功次数"。

**4. `04-journal-two-books.md` 日记两本**
公开本/私人本、偏好校准、区间汇总不替她下结论。
必须钉：**`diary_read` 占单次成本 34.7%（≈22 万 token/次），是全项目最大的一块**；172 次调用只有 17 种入参；她 225/226 笔行动的内容就是重读这些本子。这一份和第 1 份是同一个环。

**5. `05-bili-read.md` B 站读路**
feed、四路收件箱、看片偏好、屏蔽词、读配额余量。
必须钉：**`prefs.like` 读取点为 0**（主人已拍板"不决定她看什么"，所以文档要写"by design 不加权"，别留成失踪功能）；**`dislike` 与时长阈值都只贴标签、不丢弃候选**（`cap-bilibili/src/index.ts:602-607`，无 filter/continue/skip）—— 她那七轮"门上写着冥想、屋里是游戏广告"的诉求至今仍是写在门上；要么量化"标了词她是否真不看"，要么升级成真拦。

**6. `06-bili-write.md` B 站写路**
草稿 → 待放行 → 发布、策略闸、急刹、改删动态。
必须钉：默认 `draftMode=auto`（`dbafa7f`，主人已确认保留）；开闸当天 **`dynId`=0、`kind:dynamic`=0、`lastWriteAt`=0** —— 唯一真实发布回执是旧路径 11-02 的 `auto-publish`；`autoDailyCap:0` 的语义必须在这一份里写死（它是唯一刹车）；带图动态未实现。

**7. `07-account-and-credentials.md` 账号与凭据**
cookie 绑/解/换号、身份 mid 补齐、SESSDATA 存储。
必须钉：`.env` 里凭据的进出路径与"先验后写"；`connection` 面板是目前唯一做得对的操作面之一，写清楚它做对了什么，供其余面板对齐。

**8. `08-vision-pipeline.md` 视觉管线**
抽帧、去重地板、拼图、SUBS 字幕条。
必须钉：宿主只有 `/api/blob?handle=`，`?path=` 一律 404（本包自己出缩略图的原因）；**cap-vision 面板完全没接脏守卫**；`mood_apply` 回灌占成本 8.7%。

**9. `09-media-output.md` 音视频出片**
TTS、ffmpeg、竖屏合成、双封面、送待放行队列。
必须钉：`/api/files?path=` 这类不存在的路由不得再出现在代码里（历史裂图）；ffmpeg/TTS 缺失时的可见性；**media-studio 也没接脏守卫**。

**10. `10-control-surface.md` 控制面总则**
面板契约、`configGroups`、busy/confirm/脏守卫、成本读数、资产哈希与重建。
必须钉：控件实测 **106 个**（49 actionButton + 7 裸按钮 + 50 输入类），`call()` 无 busy；设计落地率严格 **42%**；**`tests/dom/` 那 10 个跑的是自建 FakeEl，真浏览器测试实际 0 个**；改前端不重建 + 浏览器缓存旧哈希 = 面板空白，这条要写成硬性发布前置；批量放行只有 CLI 入口。

## 二、旧文档处理

- `docs/` 现有 121 篇 → `git mv` 到 `docs/attic/2026-10/`、`docs/attic/2026-11/`，**按原日期保留，不改写、不删除**（本项目要保留负结果，attic 是对的归宿）。
- `docs/evidence/` 46 个落盘证据**留在原位**，它们是被门禁消费的机器产物，不是案卷。
- `docs/INDEX.md` 改成：10 份 specs 为唯一日常入口 + 一句"attic 只用于考古，不许作为施工依据"。
- `README.md`、`VISION.md`、`docs/CURRENT.md` 里所有指向已搬移文件的链接同步；`CURRENT.md` 明确降级为"台账，不是现状"（它已经自己这么声明了，把这句话提到最前并停止追加新条目）。

## 三、防复发门禁（这是本轮 P5 的落地，必须一起做）

新增 `scripts/check-doc-hygiene.mjs`，三条，**红即失败**：

1. **禁止新增**匹配 `docs/*-\d{4}-\d{2}-\d{2}.md` 或 `docs/(HANDOFF|CLOSEOUT|STATUS|BATCH|AUDIT|PLAN|REVIEW|DECISION)-*` 的文件（白名单只允许 `docs/specs/` 与 `docs/evidence/`）。变更就地改那 10 份。
2. 文档里出现的相对路径与 `file:line` 引用，**指向的文件必须存在**（现存 1278 处引用里 34 个、10.5% 已失效，含 `docs/README.md` 承诺存在的 4 个门禁脚本、`ARCHITECTURE.md:423,459` 引用不存在的 `packages/shared`、`packages/server`）。
3. `docs/specs/*.md` 的 ② 节里点名的每个参数，**必须能在代码里 grep 到读取点**（零读取点即红）—— 这条正是 `prefs.like`、`activeCap`、`lastKind` 这类"旋钮存在但没人读"的克星。

同批顺手收（都是现成的洞，别单开批次）：`run-mjs-tests.mjs:92-97` 补 `pick('skipped')`；`tests/perm-tier.test.mjs:12-35` 断言不存在的 `go-gate.mjs` 要改掉或删掉断言；`check-state-roots` 报"6 键两家分叉"却 EXIT=0 要升格为失败或加带到期日的白名单。

## 四、验收口径（可判定，第三方会照这四条复核）

1. `docs/specs/` **恰好 10 份**，每份五节齐全、无第六节。
2. `docs/` 根目录 `.md` 净数 **≤ 12**（specs 索引 + 少数运维入口，不含 `attic/`、不含 `evidence/`）。
3. `node scripts/check-doc-hygiene.mjs` 绿；且**故意制造一条违规**（新建 `docs/TEST-2026-11-07.md` 或引用一个不存在的路径）能当众变红。
4. 十份里 ⑤ 节每条都必须带一条可跑的复现命令；出现"待观察/后续再看"字样的条目数 **≤ 3**，且每条注明谁负责、哪一批。

## 五、边界与在飞事项

- 本轮**纯文档 + 门禁**，不许改 `packages/` 行为。唯一例外：第 1 条命令名之类的门禁脚本自身。
- 我 19:30 看到的现场（若仍是这些请一并交代，别让人来问）：`M packages/cortico-adapter/src/index.ts`、`?? tests/read-dedupe.test.mjs`、`?? spark-output/analysis/`。前两项是 `diary_read` 去重这条线的在飞工作，**要么提交要么说明为什么停在这里**。
- 删 `Cortico` 第二宿主克隆这件事**我没有授权给你**，主人还没给那个字。别动它。
- 做完回报到主任务本会话，第三方只读复核，不补写。

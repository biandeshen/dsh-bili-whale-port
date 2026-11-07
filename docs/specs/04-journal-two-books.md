# 04 · 日记两本

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。
> 这一份和 [01 作息与自主行动](./01-rhythm-and-autonomy.md) 是同一个环：**她 11-06 那 226 笔行动里 225 笔就是在重读这两本**。

## ① 现在是什么

两本 = 同一目录下两个固定 Markdown 文件：`<workspace>/diary/public.md`（「鲸鱼日记 · 给主人」，日期块用 `##`）
与 `<workspace>/diary/private.md`（「私人日记 · 偏好校准」，小节用 `###`）。路径拼装在
`packages/cortico-bot-xiaoyu/src/index.ts:94-95`（`homeDir` 取部署根，`:73` 拼 `workspace`）。

读写都走同一个纯函数层 `packages/cap-journal/src/diary.ts`：
写入 `upsertDiarySection()`（`:23-65`，同日同小节替换或追加）与 `replaceDiaryDateBlock()`（`:70-91`），
原子落盘 + git 提交（`packages/cap-journal/src/index.ts:120-122` → `packages/persona-core/src/atomic-write.ts:35-54`，`:218-223`）；
读取 `paginateDiary()`（`diary.ts:171-239`，按日期块分页）与区间汇总 `summarizeDiaryRange()`（`:265-303`，**只回计数**：
`days / watched / verdicts{keep,drop} / notes / yardstickMentions / chars`）。

她对外的入口是三个工具：`diary_read`、`diary_write`（`index.ts:316-372`）、`judgment_write`（`:402-447`）；
主人的入口是面板 `journal-board`（`packages/cap-journal/src/webui/client.ts:15`、`:431-436`）。
**真正被机器消费的"偏好"不是私人本文本，而是判断卡**：`judgment.jsonl` 里 `verdict:'keep'` 的条目在 `bili_seek` 时被现读
（`packages/cortico-world-bilibili/src/cortico-world.ts:52`，上限 200 张 → `packages/cap-bilibili/src/index.ts:635-637`）。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `budget` | `diary.ts:176`（`Math.max(200, Math.min(9000, …))`，默认 4000） | 无键 | **无**——面板固定 `days:7 / budget:8000`（`packages/cap-journal/src/index.ts:490-491`）；工具的 schema 里**根本没有 `budget`**（`index.ts:320-332`），她写多少都吃默认 |
| `page` | `diary.ts:196-236` 分页与「往前翻 {"page":N}」回执 | 无键 | 翻页按钮 `webui/client.ts:72-78` |
| `days` | `diary.ts:175`（上限 30） | 无键 | 无（面板固定 7） |
| `book` | `packages/cap-journal/src/index.ts:216-217`（`private` → 私人本，其余 → 公开本） | 无键 | 分段切换 `webui/client.ts:31-37` |
| `heading` | `diary.ts:199-215` 定位小节 | 无键 | **无面板入口**，但工具能传 |
| `summary` | `packages/cap-journal/src/index.ts:346` → `diary.ts:265-303` | 无键 | 面板 `getDiary` 顺带返回（`index.ts:496`） |
| 日期块判据 | `diary.ts:19` `/^##\s+\d{4}-\d{2}-\d{2}(?:\D|$)/` | 无键 | 无 |
| `judgment_revisit` 条数 | `judgments-feedback.ts:526`（见 03） | 无键 | 无 |

## ③ 失败与边界

- **读路径永不抛**：文件缺失 → 回默认头（`packages/cap-journal/src/index.ts:112-118` 的 `catch`）；空本 → `ok:true` +
  「这一本没有匹配的日记块」（`diary.ts:231`）；日期/页码越界 → 一句短回执（`diary.ts:227-231`）。
  **谁看得见**：她自己在回执里看见；账不落（读工具不算自主行动：`packages/cap-bilibili/src/platform/paths.mjs:132-138` 的 `AUTONOMY_TOOLS` 含 `diary_write` 不含 `diary_read`）。
- **写盘失败会抛给她**：`packages/cap-journal/src/index.ts:373` 不包 try，宿主把异常转成失败回执
  （`E:/WorkSpace_Qoder/Cortico-up/src/core/loop.ts:2150-2153`）；EPERM/EBUSY 有界重试 8 次，其他错直抛（`packages/persona-core/src/atomic-write.ts:49,54`）。
- **git 提交失败被吞**：`index.ts:222` 的 `catch` 只在 `status().commitError` 里留痕（`packages/cap-memory/src/workspace-git.ts:241-244`）——
  日记还在，历史不可回溯，**主人默认看不见**。
- **做梦直写私人本不守小节结构**：`packages/cortico-bot-xiaoyu/src/cortico-persona.ts:415-418` 用 `appendFileSync` 追加
  `- [日期] …`，绕开 `upsertDiarySection`；写失败只 warn（`:419-421`）。
- **回执过长宿主只 warn 不裁**：`E:/WorkSpace_Qoder/Cortico-up/src/core/loop.ts:1448-1450`（阈值 `:160` = 8000 字符），
  然后原样 append 进会话（`:1451`、`:1461`）——**这就是成本层的真正机制**：不是单次返回 22 万 token，
  而是这一次的结果被后面每一次调用重送。

## ④ 操作面

面板（`journal-board`）：切本、按日期看、翻页、编辑当天整块（改动会**覆盖当天整段**，页面上就写着这句——`webui/client.ts:84-108`）、
区间汇总随读返回。存储清理：`journal.private` 标 `danger`（`packages/cap-journal/src/index.ts:236-261`）。
**只能改文件**：`heading` 级定位（面板没有输入框）、历史 jsonl 判断卡原文、`watch-prefs.json`（唯一写点 `packages/cap-bilibili/src/client/inbox.ts:220`，她侧无工具）、
做梦追加的那几行。

## ⑤ 已知缺陷与验证方式

1. **`diary_read` 是全项目最大的一块成本：占当日成本加权 34.7%（≈22 万 token/次）**，172 次调用只有 17 种入参（重复 10.1×，单次结果 3152 字符）。
   复现（离线，读落盘 usage）：`node scripts/token-anatomy.mjs --date=2026-11-06`，看「② 分块占比」前 8 项表与「④ 重复读自己」表。
2. **同一段正文在一次回执里送两遍**：`paginateDiary` 返回体里 `body` 与 `receipt` 都含全文
   （`packages/cap-journal/src/diary.ts:238`），而工具用 `...paginateDiary(...)` 整体展开进 JSON（`packages/cap-journal/src/index.ts:348`）。
   复现（离线、零凭据、不写盘，实测 3023 / 3097 / 6257）：
   `node --input-type=module -e "const d=await import('./packages/cap-journal/src/diary.ts'); const raw='# 私人日记\n\n## 2026-11-06\n\n'+'甲'.repeat(3000); const r=d.paginateDiary(raw,{}); console.log('body='+r.body.length+' receipt='+r.receipt.length+' 整个回执='+JSON.stringify(r).length)"`
3. **`summary:true` 这一路不受 `budget` 约束**：`diaryHeadings()` 扫整本、不限量（`diary.ts:241-250`），
   `summarizeDiaryRange()` 扫整段（`:265-303`），两者在 `packages/cap-journal/src/index.ts:346` 直接挂进回执。
   复现（读她真实的私人本，实测 33,019 字符 / 35 条 headings）：
   `node --input-type=module -e "import fs from 'node:fs'; import os from 'node:os'; import p from 'node:path'; const d=await import('./packages/cap-journal/src/diary.ts'); const raw=fs.readFileSync(p.join(os.homedir(),'.xiaoyu-home','xiaoyu','workspace','diary','private.md'),'utf8'); console.log('整本 '+raw.length+' 字符 · headings '+d.diaryHeadings(raw).length+' 条 = '+JSON.stringify(d.diaryHeadings(raw)).length+' 字符 · summary '+JSON.stringify(d.summarizeDiaryRange(raw)).length+' 字符')"`
4. **`budget` 是"有实现、无入口"的旋钮**：默认 4000 且钳到 9000（`diary.ts:176`），但工具 schema 不暴露它（`packages/cap-journal/src/index.ts:320-332`）、
   面板固定 8000（`index.ts:490-491`）——**她能拿到的最小粒度就是面板给的粒度**。
   复现：`grep -n "budget" packages/cap-journal/src/index.ts` → 只在 spread 与固定值处出现。
5. **重复读去重覆盖不到这一路**：适配器去重键 = `工具名 + 整个入参 JSON`（`packages/cortico-adapter/src/index.ts:81`），
   所以 17 种入参彼此不去重；<400 字符不处理（`:79`）；逃生口 `again`/`rerun` 不在 schema 里（`:78` vs `packages/cap-journal/src/index.ts:320-332`）；
   且它只替换**本次**回执，**已经在会话里的那份全文照旧被每次调用重送**（`loop.ts:1461`）。
   复现：`node --test tests/read-dedupe.test.mjs`（覆盖的是同入参，不是换入参）。
6. **"区间汇总不替她下结论"这条约束没有实现**：全仓 grep `不替她下结论` 0 处；代码只是"形状上给不出结论"
   （返回体全是 number/null，`diary.ts:252-261`；数不出来就回 `null`，`:288`、`:298`），
   没有任何门禁或提示词禁止下游把计数当结论写回日记。复现：`grep -rn "不替她下结论" packages docs/specs | wc -l` → 0。
7. **结论计数靠词表正则，有误差且不标注不确定性**：drop 用 `/不收|放弃|没留|不分享/g`（`diary.ts:286`），
   keep 用去掉 drop 后的 `(?:^|[^\u4e00-\u9fa5])(收|留下|分享)(?:[^\u4e00-\u9fa5]|$)`（`:287`）；
   "这次没收住"会被记成一次 drop。词表没有任何夹具覆盖。
   复现：`grep -c "收住\|没收" packages/cap-journal/tests/journal.test.mjs` → 0（该文件是唯一一个日记侧测试）。
8. **门禁与工具的日期判据不一致**：`scripts/g3b-check.mjs:92` 要求行尾无其他字符（`^#{1,3}\s*(\d{4}-\d{2}-\d{2})\s*$`），
   工具用 `(?:\D|$)`（`diary.ts:19`）——同一本日记可以工具认、门禁不认。
   复现：`node scripts/g3b-check.mjs --json`（只跑当天）与 ⑤ 第 3 条那条读整本的命令对同一天日期块的计数差。

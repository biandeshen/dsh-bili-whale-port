# Flow Web 设计交付 — 小鱼控制台改版

> **这是设计稿，不是施工代码。** 施工权在主会话（批次负责人）手里。
> 本目录产物是给主会话拆解分派时的**实现蓝图**。

## 产物清单

| 文件 | 是什么 | 给谁用 |
|---|---|---|
| `day-client.design.ts` | 「她的一天」panel 设计稿（Cortico ui 契约形态） | 主会话施工 story-5 时参照/改编 |
| `../context/flow-web.json` | 3 个新页的 IA 骨架 + 组件映射 + 三终态 | 施工分派依据 |
| `../stories/*.md` + `../edge/*.md` | 9 故事 + 60 异常态 | 施工验收依据 |

## 「她的一天」设计稿要点（给实施者）

- **挂载点**：`cap-state-rhythm` webui，panel id `day`，作为 persona 第一个 tab
- **零新后端**：只用现有 `getSnapshot`（rest/life/recentChain/mood），可能需要后端补一个 recentChain 分页参数（`page`）
- **三区块**：状态读数带（statgrid）/ 生活事件流（table + 人话模板 humanizeEvent）/ 她最近说的话（先 placeholder 占位，后接 session 摘要）
- **edge 槽位**：首装空态、睡眠态（"别吵醒她"）、0 件解释、分页 20/页、acc* 脏数据默认过滤+展开
- **人话模板**：action 类型 → explore/create/connect/restless 四句话；field_change → 场值中文名 + 百分比；watch/draft → 事件语义化
- **注意事项**：humanizeEvent 的 dirty 判定正则 `/acc|验收/` 需要和主会话清残留批次（F5）对齐口径；S3 发言摘要需要主会话决定数据源（session 尾部 or 日记尾段），设计稿暂用 placeholder 诚实标注

## 建议的交接方式

把 `spark-output/` 整个目录作为**批次 08 的设计输入**移交主会话：
1. 主会话读 `context/flow-web.json` + `context/edge.json` 拿到 3 新页蓝图与 60 态规范
2. 按自家批次节奏拆解（它已有团队模式可并行）
3. 施工落点：story-5 → `cap-state-rhythm`（参照本设计稿）、story-4 → `cortico-definition.ts` configGroups + 新 connection 面板、story-6 → `cap-journal` 拆分意见箱
4. 本 Side chat 只维护 `spark-output/`，不再触碰 `packages/`

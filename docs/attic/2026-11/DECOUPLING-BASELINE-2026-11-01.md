# 解耦改造：落线声明（§8 第 1 条）

Owner: docs/ARCHITECTURE-DECOUPLING-2026-11-01.md §0.1

## 落在这条线上

| 检出 | 分支 | HEAD | 角色 |
|---|---|---|---|
| `E:/WorkSpace_Qoder/Cortico-up` | `reanchor/replay` | `cbd3e90` | **改造落在这里**；上游 `e77b661`（0.2.12），落后 0 |
| `E:/WorkSpace_Qoder/Cortico` | `master` | `144157d` | **只做 hotfix**，不再接新功能 |
| `E:/WorkSpace_Qoder/dsh-bili-whale` | `port/core-opencode-panel` | — | 不动分支，按 §8 逐条改 |

`reanchor/replay` 与上游有共同祖先（`e77b661`），所以上游再发版时
`git merge upstream/main` 是常规操作。`master` 与上游**没有**共同祖先，
它的历史是独立的一条根——这也是为什么改造不能落在那里。

## 落线门的实测（2026-11-01 23:26）

| 项 | 结果 |
|---|---|
| `tsc -p tsconfig.json` | 0 错 |
| `tsc -p tsconfig.web.json` | 0 错 |
| `npx vitest run`（全量） | 290 文件 / 5207 通过 / 3 skipped / 0 失败 |
| 真实 tick | 新进程 23:20 起，23:23:52 `ticks.jsonl` 有新行，`life loop armed` |
| 真实 debrief | `BV1E1x36aE6a` 六路素材齐：元信息、封面路径、无字幕说明、弹幕采样口径、热评 |

跑法：用她的真实部署另开端口 7800（同一部署不能同时跑两个进程）——
先暂停并关掉 7799，用本检出起 7800 验完，再停 7800 并把 7799 拉回。

## 与本方案的关系

`reanchor/replay` 已经解掉方案里列为"未做"的几项：`StreamErrorEvent`、
判断卡、`modelOptions`、名字双源、控制台历史、激活失败可见。
所以 §8 从第 2 条（备份）与第 4 条（状态根）开始，不从第 1 条的功能补齐开始。

`canSeeImages` 那处误读也已修：本 World 自己的 `bili_look` 现在被认作读图工具，
不再是"控制台能看图、她看不见"。

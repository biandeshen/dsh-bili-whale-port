# 备份恢复演练（2026-11-01 21:20）

备份包：`~/.dsh/backups/backup-20261101T131202Z-83636`（719 文件 · 27,269,014 B）
触发方式：`node scripts/ops-backup.mjs`（修完草稿根排序后重打的一份）

## 为什么重打

上一份 `backup-20261101T095243Z-25936` 的 `resolvedRoots.drafts` 指向
`C:\Users\Administrator\.dsh\bili-whale\drafts` —— **一个不存在的空目录**，
而真实草稿在 `D:\AI\养鱼\drafts`。根因是两处根目录按字母排序，`C:\…` 排在 `D:\…`
前面，于是存在的那份掉到第二名。观感是"备份完成了"，实际草稿一份没进包。

已修（`11d69eb`）：按"存在优先"排序。这份包是修完后重打的。

## 四项比对（manifest 记录值 vs 磁盘现值）

| 项 | manifest | 现值 | 一致 |
|---|---|---|---|
| `whale/bili-whale/fields.json` | `7cb63ea87249ebef` | `7cb63ea87249ebef` | ✓ |
| `whale/whale-diary.md` | `8c977e7192bf7d7a` | `8c977e7192bf7d7a` | ✓ |
| `whale/bili-whale/causal.jsonl` | `8b1b002bec70634f` | `8b1b002bec70634f` | ✓ |
| `whale/whale-diary-private.md` | `28f49c953e9e3f56` | `28f49c953e9e3f56` | ✓ |

一致性是 sha256 前 16 位（完整值在 `MANIFEST.json`）。

## 目录类

| 项 | 备份 | 现值 | 说明 |
|---|---|---|---|
| `cortico/deployments/mybot/data/runs` | 601 个文件 / 3,869,974 B | 同上 | 对话全文第一次进包 |
| `drafts/` | 16 个文件 | `D:\AI\养鱼\drafts` 16 个 | 上一份是 0 个 |
| `cortico/deployments/mybot/config.json` | 1 | 1 | 新增 |

## 恢复 dry-run

`node scripts/ops-backup.mjs --restore <包>` →
`共 719 个文件：覆盖 719 · 新建 0 · 跳过 0`，末行明确"这是 dry-run，没有写任何盘"。

## 没做的

**没有跑 `--apply` 真恢复**。理由：真恢复会覆盖 `~/.dsh` 与部署目录下正在用的
状态，而她现在在跑。演练要证明的是"包里的东西与盘上一致、恢复路径认得每个文件"，
这两点在 dry-run 里已经可验。真恢复应该在换机或灾难时做，不该为了演练去动生产数据。

要验 `--apply` 的完整回路（含 `pre-restore-*` 另存），需要在停机窗口做——
那属于换机演练，不在这条里。

## 已知偏差

`MANIFEST.missing` 记了一条：`drafts-2/（目录不存在）`。这是
`~/.dsh/bili-whale/drafts`（从未建过）。如实记录、不静默跳过——空白它没错，
但要让读的人知道"这条源是空的"，而不是以为备齐了。

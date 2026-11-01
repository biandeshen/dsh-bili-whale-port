# 解耦改造 §8 进度实况（2026-11-02 01:40）

本页只记**代码里能查到的状态**，不记计划。每行都能用右侧命令复验。

## 0. 先读这一条：改在哪 ≠ 跑在哪

**正在跑的进程是 `E:\WorkSpace_Qoder\Cortico`（master，PID 119536，端口 7799）。**
`Cortico-up`（reanchor/replay）没有被任何进程加载。复验：

```
wmic process where "name='node.exe'" get CommandLine | grep -i cortico
```

含义：本轮所有**世界页**改动（待放行口径、时间线 actor 列、`bili_look`、历史检索、
日记区间汇总……）都只存在于 `Cortico-up`。用户在 7799 上看到的仍是 master 的行为。
要让改动生效，必须先定"什么时候把 live 切到 reanchor"，然后走一次真实切换
（换端口起一份对照 → 观察 → 停旧起新），不是改完代码就算完。
`dsh-bili-whale` 的改动（状态根、迁移、actor 默认值、凭据路径）**是活的**——CLI 每次
调用都从磁盘读，和哪个宿主无关。

## 已完成（有代码 / 有证据）

| # | 主题 | 证据 | 复验命令 |
|---|---|---|---|
| 1 | 落线声明 | `dsh-bili-whale` 2268b8b、`docs/DECOUPLING-BASELINE-2026-11-01.md` | `git log --oneline -1` |
| 2 | 备份覆盖 runs + 正确 drafts | `scripts/ops-backup.mjs` 用 `draftsDir()` + 存在优先排序 | `npm run ops:backup` |
| 3 | 恢复演练 | `docs/evidence/restore-drill-2026-11-01.md`，四项 sha 全等；包内 drafts 17 份 / runs 601 份 | `ls ~/.dsh/backups/backup-*/files` |
| 4 | `state-roots` R1–R5 | `tools/lib/state-roots.mjs`，22→24 类 | `node --test tests/contract/state-roots.test.mjs` |
| 5 | 四红测试 | 同上一份测试里：错写者抛错、无身份拒写、退场日切读列、并发锁 | 同上 |
| 6 | 旧家退场单点 | `paths.mjs` 的 `legacyAllowed()` 是唯一判断，`state-roots` 转出不再自存 | `node -e "import('./tools/lib/paths.mjs').then(p=>console.log(p.LEGACY_UNTIL()))"` |
| 7 | selftest 落点与可见失败 | `tools/commands/selftest.mjs` 写新家；写失败 `console.error` 而非静默 | 删权限后跑一次 |
| 8 | dm / reply-draft 读写分离 | 两边都是 `stateReadPath` 读、`writeStateText` 写 | `node tools/bili.mjs reply-draft list` |
| 9–10 | 迁移工具 + 账本 + 回滚 | `scripts/migrate-state-roots.mjs`；演练四条路径全过 | `node scripts/migrate-state-roots.mjs` |
| 11 | 生产迁移执行 | 账本 `~/.dsh/bili-ai/migrations.json` 的 `mig-mvy2bnnz`：pending-replies / selftest-passed | `cat ~/.dsh/bili-ai/migrations.json` |
| 12 | 读数同源（徽标 = 面板 = CLI） | `Cortico-up` adb670b：`pendingTotal()`；实测 4+9=13 | `node --import tsx -e "import('./src/worlds/bili-account/tank.ts').then(t=>console.log(t.pendingTotal()))"`（在 Cortico-up 下跑） |
| 13 | 凭据路径只此一处 | 22 处手拼换 `credentialsPath()`，脚本已删 | `grep -rn "'\.bili-ai'" tools/ scripts/ \| grep -v paths.mjs`（应只剩 ops-backup 两行） |
| 14 | 状态根门禁进门禁链 | `package.json` 的 `gates` 末尾；`scripts/check-state-roots.mjs` | `npm run gates` |
| 15 | 并发追加不需要锁 | 实测三进程 × 60 行 × 100KB 无撕裂；`causal.requiresLock=false` | `e57fdda` 的提交说明 |
| 16 | actor 归因 | dsh 侧 `dd9bffe`+`394beaf` 前一提交；World 侧 `394beaf`；时间线加「谁」列 | `node --test tests/contract/state-roots.test.mjs`（含署名断言） |
| 24 | 门禁报告落盘带 gitSha | `056cb06`，`docs/evidence/gates-2026-11-02.json` | `node -e "console.log(require('./docs/evidence/gates-2026-11-02.json').gitSha)"` |

## 已推翻的原有判断（写下来防止重犯）

1. **"`reanchor/replay` 是功能超集"** —— 落线时它比 `dev/policy` 少 8 条提交。已逐条 cherry-pick 补齐（`eb66788`…`c3cb8ff`）。补齐后 `tsc` 两套 0 错、`vitest run` 290 文件 / 5208 通过。
2. **"causal 必须拿锁"** —— 实测单行 append 就是原子的。锁只该护读-改-写。配上只会多一种超时失败。

## 未做（按风险排序，不是按编号）

| 项 | 为什么还没做 | 卡在哪 |
|---|---|---|
| **把 live 切到 reanchor** | 见 §0：改在 up、跑在 master | 需一次受控切换（换端口对照 → 观察 → 停旧起新） |
| 17–18 persona-core 包化 | `Cortico-dev/persona-core` 无 `package.json` | 要动 6 处 `file:///` 引用 |
| 19–23 World 瘦身 / debrief 端口 | `definition.ts` 仍 1326 行、`tank.ts` 600 行 | 大改，需先有 19 的五阶段测试 |
| 25 README/INDEX 重写 | 结构已变，文档还是旧的 | 等 19–23 定稿 |

## 一条读法

`§8` 表里的"验收命令"是**当时设想**的，不是现在的事实来源。要判某项是否落地，去查右列命令，不要信表。

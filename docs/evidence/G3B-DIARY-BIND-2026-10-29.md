# G3b 草稿日记绑定：允许当天后续改日记 —— 证据（2026-10-29）

> 发现：`g3b-check` 只用 `state.end`（或 start）的日记哈希对比草稿的 `diaryHash`。
> 她一天若行动两次（单日上限就是 3），第二次写日记会改变日终哈希 → 第一次的**有效草稿**被判 `mismatch`，整天的 G3b 判不过。
> 修法：只要草稿的 `diaryHash` 在该日**任一 tick** 的日记哈希里出现过，就算绑定当天。

## 1. 改动

| 文件 | 改动 |
|---|---|
| `scripts/g3b-check.mjs` | `draftBound` 增加 `tickHashes.has(draft.diaryHash)`；ticks 由 append-only `ticks.jsonl` 读取 |
| `tests/contract/g3b-check.test.mjs`（新 2 例） | 三天齐全且草稿绑定更早 tick → ready；草稿哈希不属于当天 → 不 ready；`tainted` 仍拦 |

不改的事实：草稿仍必须有 `diaryHash`、`draft.date===d`、`degraded!==true`；不是“有草稿就放行”。

## 2. 验证

```
node scripts/check-hashes.mjs --write
node --test tests/contract/g3b-check.test.mjs
# tests 2 / pass 2 / fail 0
```

测试用临时 home 造了三天：每天 `state.end` 的日记哈希是 `H_end_<d>`，草稿绑定的是当天 20:00 tick 的 `H_draft_<d>`。
旧逻辑会判 mismatch；新逻辑 ready。把草稿换成别的日子的哈希 → 仍不 ready。

## 3. 边界

- 只放宽“当天版本”的时间点，不放宽日期：草稿 `date` 必须等于当天。
- tick 是 append-only；如果 tick 损坏/缺失，退回只比 end/start，跟以前一样严格。
- 10-28 仍然过不了：它缺的是草稿 `diaryHash` 本身，不是哈希时点问题。

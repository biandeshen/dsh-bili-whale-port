# 她的意见箱 · 证据卡（2026-10-31）

> 主人原话：“多收集她的反馈意见……最好能有这样的机制，或者允许它能提出，然后让她解决。”
> 她上一轮已经自发用 `OPS.md` 提了 5 条（工具自己修不了的写成“要鱼片动手的”）。机制化之后她不再靠写信碰运气。

## 数据流（全本地、零外发）

```
她：bili_feedback add --issue "一句话现象" [--severity high] [--self --note "怎么对治"]
      ↓ World 工具（definition.ts DECLS[10]）→ dsh CLI（tools/commands/feedback.mjs）
~/.dsh/bili-whale/control/feedback.jsonl   ← append-only，原始条目永不删
      ↓ 折叠：同 id 有 feedback-resolved → 已解决
面板「她的意见箱」卡（/api/feedback，鉴权门内）：列表 + ✓已解决（resolve 记 resolvedBy=owner）
她自己也能 resolve（World 工具 action:'resolve'，resolvedBy=whale）
```

- `severity`：high = 卡主链路；low = 体验瑕疵。`selfHandled`：她已对治（如日记手动合并、筛片只认数字）。
- **resolve 只是记录，不是修复**——修复仍由人动手；历史可回放（append-only）。
- ORIENTATION 第 10 步已写入运行时 prompt（`deployments/mybot/prompts/ORIENTATION.md`）：遇到工具缺陷不要忍，记一条；修复仍由鱼片动手。

## 安全边界

- 全部写本地 jsonl；不联网、不发 B 站、不动草稿/审批/场值。
- 意见箱 ≠ 审批：放行动态走 `/api/draft-approve`（服务端持 token），两套完全隔离。
- 面板入口在 token 鉴权门内（无 token → 503，e2e 测试锁定）。

## 验证

- `tests/contract/feedback.test.mjs` 2/2：add→list→resolve 折叠、历史回放、未知 id 拒、CLI 子进程真实跑通。
- panel e2e：`/api/feedback` 鉴权、resolve 未知 id 返 ok:false。
- 全量 dsh **252/252**，冻结哈希一致；Cortico `definition.ts` esbuild 解析通过。
- World 已重启加载（2026-10-31 01:27，pid 38372），health 全绿；`cortico.log` 01:27:10 段可查。

## 已知残留

- ORIENTATION 部署副本与 `bots/cormini/persona/ORIENTATION.md` 模板不同步（模板缺第 9/10 步）——与 D-19 的“单一来源”同族，观测后统一。
- 意见箱没有做推送：她提了、你不看面板就不知道。通知是 P1 backlog（team 分析已列）。

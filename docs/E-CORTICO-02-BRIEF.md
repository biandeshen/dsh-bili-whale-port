# E-CORTICO-02 完美版 Brief（14 分准入）

## 范围
把已跑通的 Cortico MVP（provider + bili-account 5 工具 + 21:40 唤醒）提升为“可长期无人值守、可控、可验收”的私有版本。

## 14 分（7 维 × 0–2，<9 不进入发布）
| 维度 | 现状 | 目标（2 分） |
|---|---|---|
| 正确性 | 工具链实测通过；草稿幂等 | 单元/集成覆盖工具与队列 |
| 安全 | 写操作只入队；kill 设计未接 | ack 队列 + 一次性批准 + kill 演练 |
| 可观测 | run/toolcalls/transcript 可查 | 每日证据汇总脚本 |
| 可恢复 | **本次补 catch-up** | 重启/漏跑补偿用例 |
| 风控 | 预算查询 + 单通道 | 硬日额度 + 停手码 |
| 可用性 | 21:40 自动，需代理/Cortico 常驻 | 自启 + 健康检查 |
| 可维护 | RUNBOOK/提交记录 | CURRENT + 版本锁定 |
当前自评：11/14（可恢复 1、安全 1、正确性 1）

## 锁定项（LOCK）
- 人设：小鱼 / 鱼片 / 本小姐；四条铁律；正文无 AI 声明，披露在简介+平台标签
- 时间：Track A 21:30 出稿；Cortico 21:40 唤醒；每天最多 1 条发布
- 通道：仅动态；评论/收藏/弹幕/私信不开放
- 数据：WHALE_HOME=`~/.dsh`；草稿=`D:\AI\养鱼\drafts`；图片池=8 张

## 验收证据
1. 一个真实 run 的 toolcalls 五件套
2. 当日草稿 JSON/MD（status 正确）
3. audit.jsonl（approve/send 记录）
4. traffic 读写额度
5. 重启后 catch-up 日志
6. `npm test` 140/140（Track A 侧）

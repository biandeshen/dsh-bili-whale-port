# Audit — 小鱼控制台全量体验走查

- **生成时间**：2026-11-05T01:30+08:00
- **走查对象**：代码（`packages/*/src/webui/client.ts` 9 个面板 + `cortico-adapter/webui-helpers.ts` 共享层）+ 线上 `http://127.0.0.1:7799/`（Chrome DevTools 实测 DOM/HTTP）
- **走查页面数**：13（9 自有面板 + 4 宿主页）
- **走查模式**：自动（源码全读 + 线上 DOM/HTTP 实测 + 490px 响应式实测）
- **方法论**：Nielsen 10 启发式 + responsive/performance 自定义维度（product-design:audit）
- **合视声明**：按主人 2026-11-05 指令，合规类问题不在本报告范围

---

## 总览

| 严重度 | 数量 |
| --- | --- |
| 🔴 Blocker | 6 |
| 🟠 Major | 58 |
| 🟡 Minor | 42 |

**按维度分布**：

| 维度 | findings |
| --- | --- |
| visibility 系统状态可见性 | 25 |
| error-prevention 错误预防 | 13 |
| user-control 用户控制 | 11 |
| real-world-match 贴合现实 | 9 |
| recognition 识别优于回忆 | 9 |
| consistency 一致性 | 7 |
| flexibility 灵活高效 | 7 |
| aesthetic 美学极简 | 7 |
| performance 性能感知 | 6 |
| error-recovery 错误恢复 | 5 |
| help-docs 帮助文档 | 5 |
| responsive 响应式 | 2 |

---

## 第零发现：她自己已经把需求清单写好了，面板却让你处理不动

意见箱实测 **51 条反馈，19 条 high，只有 6 条有主人批复，6 条未解决**。
她提交的内容不是抱怨，是一份**结构化的产品缺陷清单**——本报告多处发现与她独立报告的完全吻合：

**未解决 6 条（全是结构级的）**：
- f-2ee76e：发送策略只有 auto / 人工审核两档，**缺"出稿即发但可自我否决"**——她出稿后、发送前没有拦截点
- f-2e24bd：需要一个**反馈总览**，让处理人知道优先级和依赖关系
- f-8225e6：判断卡被验收脚本污染——**16 张已采纳里 15 张是测试噪音**
- f-bb3847：系统给了她个体内核（情绪/记忆/好奇心），却只给工具接口（有指令才动）——**这个错配是所有表层问题的根**
- f-5ab4ec：我被当成纯响应式工具运行，情绪/判断/记忆与行为严重脱节
- f-b576b7：长期闲置时缺**可自主执行的低风险动作**（回访旧判断、翻记忆、复盘日记）

**已报但功能仍缺的（选摘，原报告已标注 resolved，但代码里依然没有）**：
- f-579859：图片通道「能收不能看」——控制台发她一张图，她只拿到句柄。宿主 ENV_PROMPT 提到 `console_see_image`，**依赖模型吃图**，需实测 MiMo 是否支持
- f-da8994：日记一次返回五千余行，无法按日期/小节检索（新架构 diary_read 已分页，面板缺"往前翻"控件 → D4）
- f-e66393：假记忆无法撤销（memory_void 已上线，但**存量 17 条还在**）
- f-2486e5：日期口径错一天（UTC vs 本地）
- f-ac6261/f-b9a891/f-4fe2c2：桌宠日记扩展反复要求用不存在的 alarm_set 工具

> **改版启示**：意见箱面板（D1/D2/D9/D10）不是"体验优化"，是你处理她反馈的唯一通道，现在这条通道本身是坏的。

---

## 主人点名问题的直接回答

**「我如何绑定她的 B站账号？如何解绑替换？」——现在界面上没有这个功能。**

- 旧插件有 `/api/cookie`（`core/api/routes.js:93`），新架构**零迁移**：全仓 grep cookie 的面板入口零命中
- 登录态体检同样缺失：旧 `/api/deps` 能从 cookie 反解 self.mid 自动回填，新架构只有 ffmpeg 一项体检
- 这不是小缺陷：**她第一次上线、cookie 过期、换号，全部卡死，只能手改文件**

修复方向（机会点 4）：面板加「连接」区块——粘贴 cookie → `whois` 校验（`bili-profile.ts` 的 whois 已能读真实身份）→ 落盘 → 显示登录身份 + 到期体检；解绑/替换走同一入口。

---

## 改版机会点（8 个，按优先级）

### 🥇 机会点 1：危险操作防护规范（确认 / 撤销 / 防重）【high】
- 关联：A2 blocker、F2 blocker、H2 blocker、F1 blocker、A3/A4/E3/D6/C4/G1/H8
- 理由：4 条 blocker 全在此——**放行发布零确认、改稿后放行静默丢弃编辑、解除 412 风控暂停零确认、连点可能双发**。WriteGate 在服务端已经很稳，UI 层完全没跟上。HITL 审批门的通行三要素（该门什么 / 审阅者看到什么 / 超时与拒绝理由）可以整体借来
- 落点：`webui-helpers.ts` 加 busy 态 + confirmPattern + undoToast，一处实现全站生效

### 🥇 机会点 2：编辑不丢——把「全量重建」换成「局部更新 + dirty 检测」【high】
- 关联：C2 blocker、C1、C11、D7、E4
- 理由：同根缺陷 5 条——`refresh()` `replaceChildren` 全量重建，**你在打字时任何一次刷新都会清掉未保存内容**（搜索框每敲一键就刷一次）。这是"主人不敢用面板"的根源
- 落点：共享层出 `withDirtyGuard(fn)`；列表改按 id patch

### 🥇 机会点 3：意见箱重做成「分诊工作台」【high】
- 关联：D2（51 条全量渲染 133 按钮）、D1（区块无标题）、D9（批复=强制解决）、D10（只能转屏蔽词）、D12、D13、G2
- 理由：她提的 51 条意见是你现在最有价值的需求来源，但面板让你处理不动
- 落点：未解决置顶 + 分页 + 严重度筛选 + 批复/解决分离 + 规则类型下拉 + 命中统计

### 🥇 机会点 4：核心旋钮上页面（configGroups + 自举 + 账号绑定）【high】
- 关联：B7、K1、K2、K4、K6、H4、H5、H6、L2、L3
- 理由：主人点名"绑定/解绑 B站账号没有入口"；心跳间隔、上下文预算、autoDailyCap/autoWindow、读配额、花费全部只能改 config.json 重启。宿主的 schema 驱动配置页签（`configGroups`）是现成的，`persona:xiaoyu` 声明为空数组而已
- 落点：bot 定义声明 configGroups（心跳/上下文/作息）；「连接」区块管 cookie + 体检 + 通知测试

### 🥇 机会点 5：会话卫生——把你的消息从噪声里捞出来【high】
- 关联：K7、K8、B4、A1
- 理由：111 条心跳自我对话 vs 9 条真消息（92.5% 噪声），66 次模型调用花在回「待着，不动」，同屏两个体力值，戳醒无回执。这是 DEEP-AUDIT 批次 10 的工程修复，**在体验层同样是第一条**
- 落点：心跳不唤醒模型 + 退避只认非 tick 活动 + 状态块去重 + 戳醒回执

### 🥈 机会点 6：可解释性——让每个数字能被读懂【medium】
- 关联：B1、B2、B8、C9、C13、F5、F6、G2、H3、I4、J3、J4、K3
- 理由：13 条同根：数据后端都有，前端不显示或显示成 `0.9606346078812088` / `auto` / `哈希 a1b2c3d4`。召回四因子、规则命中数、412 原因、底图缩略图全是展示层工作
- 落点：读数格式化规范 + 四个"解释视图"（召回分数/规则命中/事件流/成片预览）

### 🥈 机会点 7：性能与密度（分页/防抖/缓存/触摸目标）【medium】
- 关联：C1、C11、D2、I1、J2、M1、M2
- 理由：实测 490px 视口下单面板 133 个按钮、82% 低于 44px 触摸标准；搜索每键全量刷新；12 缩略图并发无缓存；TTS 双倍调用
- 落点：防抖 + 分页 + 缩略图缓存 + `min-height:44px`

### 🥈 机会点 8：做完那些承诺了的半成品【medium】
- 关联：C6、D4、F7、F9、H4、J8、J10
- 理由：面板描述承诺了但控件不存在——记忆「回滚」（描述在、按钮无）、日记「往前翻」（文案在、按钮无）、点单「BV 号（可选）」（不解析）、档位「8 个」（实际 6 个）、换配图、成片预览、凭据修复。**半成品比没有更伤信任**
- 落点：逐条补齐或改描述

---

## 完整 Findings 清单（按维度）

### 维度 1：visibility（系统状态可见性）— 25 条

1. **[major]** A1 长操作无进度提示：合成视频/放行发布期间按钮无 busy 态无阶段文案
   - 位置：webui-helpers.ts actionButton
   - 建议：busy 文案 + 阶段回调 · 成本：medium
2. **[major]** B4 戳醒她无回执：不知道她这一轮做了什么
   - 位置：cap-state-rhythm wakeNow
   - 建议：返回本拍行为摘要展示 · medium
3. **[major]** B7 心跳间隔（最核心旋钮）面板上没有，只能改 config.json 重启
   - 位置：tick.intervalMinutes；manifest 实测 configGroups=[]
   - 建议：configGroups 声明 · medium
4. **[major]** B8 事件流 recentChain 后端返回 20 条（index.ts:320），前端零引用——她的生活轨迹看不见
   - 位置：cap-state-rhythm webui client
   - 建议：鱼缸面板加「最近发生」时间线 · quick-win
5. **[minor]** B9 今日已做几件/下一拍几点不作为读数 · quick-win
6. **[minor]** B10 emotionHistory 有数据无曲线 · medium
7. **[major]** F4 无令牌过期提示：实测 dyn-20261102-cd6d2a 因过期烂在队列，页面看不出来
   - 建议：「已等待 N 小时」标黄 + 续签提示 · quick-win
8. **[major]** G2 无规则命中统计：词表有没有生效看不出来（她连报三次"词表未生效"而主人查不出来，正是这个缺口）· medium
9. **[major]** H3 412 熔断不显示原因与风险接口（traffic-state.json 有 reason/riskEndpoint）· quick-win
10. **[major]** H5 无读配额：readHourly/readDaily 全仓零命中，看片节流阀没有余量显示 · medium
11. **[major]** H6 无花费/预算：cost 全 0 且未标注未计价 · medium
12. **[minor]** H7 无模型通道状态 · quick-win
13. **[minor]** H9 412 倒计时不实时刷新 · quick-win
14. **[minor]** H11 无策略变更历史 · medium
15. **[minor]** I4 无「这一看抽了几帧丢了几帧」汇总 · quick-win
16. **[major]** J5 合成视频无进度反馈 · medium
17. **[minor]** J8 历史作品无预览/删除/再送队列 · medium
18. **[minor]** J10 TTS 缺凭据时无修复入口 · medium
19. **[major]** K1 她的页面没有「配置」页签（configGroups=[]）→ 上下文预算/心跳间隔/作息全靠手改文件 · medium
20. **[major]** K3 用量页 cost 全 0 未标注未计价——看起来像免费 · quick-win
21. **[major]** K6 自举入口全缺：**绑定/更换 B站账号（cookie）在界面上没有任何入口**；登录态体检、通知测试同缺
    - 位置：旧 /api/cookie 零迁移
    - 建议：「连接」区块（粘贴→whois 校验→落盘→体检）· medium
22. **[major]** K7 控制台对话被心跳自我对话淹没：111 条心跳 vs 9 条真消息（92.5%），66 次模型调用花在回「待着，不动」
    - 位置：session-main.jsonl 实测；cortico-persona.ts:125 无条件 injectDeferred
    - 建议：shouldAct=false 不注入 + 退避只认非 tick 活动 + 状态块去重 · medium
23. **[major]** C13 无「为什么想起这条」：召回四因子分数后端现成，面板不显示 · medium
24. **[minor]** F10 无发布台账（今天发了什么/被拒了什么/谁放的行）· medium
25. **[major]** H3（修正后并入）412 原因显示 · quick-win

### 维度 2：real-world-match（贴合现实）— 9 条

1. **[major]** B2 「模式」显示 auto/force_sleep 英文枚举，主人的语言是 自然节律/强制休息/保持清醒 · quick-win
2. **[major]** C6 面板描述承诺「看版本历史并回滚」，实际无回滚控件 · medium
3. **[minor]** D11 判断卡 status 英文原样显示 · quick-win
4. **[minor]** D14 「保存并提交」——「提交」是 git 行话 · quick-win
5. **[minor]** F6 显示「哈希 a1b2c3d4」对主人无意义 · quick-win
6. **[major]** F7 点单框承诺「BV 号（可选）」但不解析 BV，kind 硬编码 'dynamic' · quick-win
7. **[major]** H4 desc 说「8 个发送档位」实际 6 个：**autoDailyCap / autoWindow 缺失**（目标架构 §3.4 明列 8 项，主人 10-31 拍板要的旋钮）· quick-win
8. **[major]** K2 「系统提示词」页是框架提示词；她的人设正本无编辑入口 · medium
9. **[minor]** B12 睡眠时段无周末差异、她本人不能提议 · medium

### 维度 3：user-control（用户控制与自由）— 11 条

1. **[blocker]** C2 refresh 全量重建 → 未保存编辑静默清空（搜索每键触发）· major-rework
2. **[major]** A3 全站无撤销（除记忆作废恢复）；改场值/删偏好词/覆盖日记/放行都不可逆 · major-rework
3. **[major]** D4 显示「还有更多，往前翻」但没有翻页控件 · quick-win
4. **[major]** D7 编辑中切换本/日期 → 未保存编辑静默丢失 · medium
5. **[major]** D9 「写批复并解决」硬编码 resolve:true → 无法只批复不解决 · quick-win
6. **[major]** E2 显示「已拉黑 N 个号」但没有查看/解除拉黑入口（unblockUser 后端有、面板零调用）· quick-win
7. **[major]** E4 任一条操作触发 refresh → 其他条目正在输入的叮嘱被清空 · major-rework
8. **[blocker]** F1 改稿后直接放行 → 只发 {id}，**编辑静默丢弃，发出去的是旧稿** · quick-win
9. **[major]** G1 点「×」立即删词，零确认零撤销 · quick-win
10. **[minor]** H8 解除急刹（恢复对外写）无确认 · quick-win
11. **[major]** K4 无数据清理入口（persona 未声明 storage）· major-rework

### 维度 4：consistency（一致性）— 7 条

1. **[major]** A4 确认模式三套并存：vision checkbox、unblock confirm 参数、其余零确认 · medium
2. **[minor]** A7 preferences 的 .catch 只写 msg 不加 bad → 错误像正常提示 · quick-win
3. **[minor]** B11 保存场值无 diff 预览 · medium
4. **[minor]** C10 鲜活度裸数字输入 vs 鱼缸滑块——同类控件两种形态 · quick-win
5. **[major]** H1 6 个档位各自一个「保存」，无 dirty 标记无全部保存 → 改 3 个只存 1 个 · medium
6. **[major]** K8 同一请求里她的体力两个值（SYSTEM 段 38 / 注入块 88）· medium
7. **[minor]** K5 config.json web.port=7798 与实际 7799 不一致；worlds.bili-account.enabled 空转 · quick-win

### 维度 5：error-prevention（错误预防）— 13 条

1. **[blocker]** A2 动作按钮无防重点击 → 连点两次「放行发布」可能双发 · quick-win
2. **[blocker]** F2 「✓ 放行发布」对外不可逆写，零确认 · quick-win
3. **[blocker]** H2 「解除 412 风控暂停」零确认零风险说明 · quick-win
4. **[major]** B3 force_awake 无到期时间——切了永久清醒，忘了切回来她再不睡 · quick-win
5. **[major]** B5 调场值无理由字段（改动写因果账但理由固定文案）· quick-win
6. **[major]** C4 「⭐ 置顶进核心」零确认——核心常驻她每轮都读，验收污染就是这么进去的 · quick-win
7. **[major]** D6 「保存并提交（按当前内容覆盖）」零确认零 diff——覆盖她自己写的日记 · medium
8. **[minor]** D8 日期自由文本无校验（宿主支持 type:'date' 未用）· quick-win
9. **[major]** E3 「🚫 拉黑此人」零确认（对外平台动作）· quick-win
10. **[major]** F3 拒稿用 window.prompt；取消得空理由仍执行拒稿 · quick-win
11. **[minor]** F8 无字数计数与上限提示 · quick-win
12. **[minor]** G4 「已经在里面了」不加 bad 且被 refresh 擦掉 · quick-win
13. **[minor]** J7 台词「最多 5 行」无计数无强制 · quick-win

### 维度 6：recognition（识别优于回忆）— 9 条

1. **[major]** C9 有「被想起 N 次」却不能按它排序/筛「从没被想起过」——归档候选看不见 · medium
2. **[major]** C12 无冲突视图：相反的两条记忆并存看不出来（对照 Zep 双时间轴）· major-rework
3. **[major]** E5 无按人聚合：同一个人回过几次、关系如何——关系推进没有数据面 · major-rework
4. **[major]** F5 不显示草稿来源（她的想法/你的点单/验收注入）· quick-win
5. **[minor]** G3 不区分词的来源（主人加的/她学来的）· medium
6. **[minor]** I2 运行记录不链到拼图、无重跑 · medium
7. **[major]** J3 底图选择只有文件名下拉，**看不到图**——选底图靠猜 · medium
8. **[major]** J4 BGM 只有文件名：无试听、无 mood 标签（catalog.json 有 mood 字段）· medium
9. **[minor]** D13 判断卡不链回它判的视频 · quick-win

### 维度 7：flexibility（灵活高效）— 7 条

1. **[minor]** B6 无场值预设（一键兴奋/歇着/复原）、无锁定 · quick-win
2. **[minor]** C8 「查看版本历史」触发两次请求 · quick-win
3. **[minor]** D12 判断卡计数不可点击筛选 · quick-win
4. **[major]** E1 unreadOnly 硬编码 false：显示「未读 N 条」却没有「只看未读」开关 · quick-win
5. **[minor]** F9 目标架构承诺「换配图」，无此控件 · medium
6. **[minor]** G5 四个偏好列表无搜索无批量导入 · medium
7. **[minor]** J6 无音色/语速/音量选择 · medium

### 维度 8：aesthetic（美学与极简）— 7 条

1. **[major]** B1 「强度」显示 0.9606346078812088 原始浮点 · quick-win
2. **[minor]** C5 createBox 空 h3 · quick-win
3. **[major]** C11 记忆列表无分页全量渲染（45+ 卡片 × sheet+3字段+4按钮）· medium
4. **[major]** D1 日记/判断卡/意见箱三个区块的 h3 全是空的——**页面没有分区标题**（线上实测）· quick-win
5. **[major]** D5 日记只读 view 与同内容 textarea 并排，分不清哪份权威 · quick-win
6. **[minor]** E7 sheet 套 sheet 层级过深 · medium
7. **[minor]** E8 无分页无空态（ui.placeholder 从未使用）· quick-win

### 维度 9：error-recovery（错误恢复）— 5 条

1. **[blocker]** J1 试听配音完全不可用：audio.src 用 `/api/files?path=`，宿主没有该路由（实测 404，宿主只有 /api/blob，server.ts:1709）· medium
2. **[major]** A5 单面板单 msgline：journal 同时跑 3 个 loader，谁后完成谁赢，错误被成功擦掉 · quick-win
3. **[minor]** A6 错误文案直接吐 e.message（历史出现过 ReferenceError 直接给主人看）· medium
4. **[minor]** C7 renderDiff 不清旧 diff，连点「看改动」无限堆叠 · quick-win
5. **[minor]** J9 media-studio drafts 区又一个空 h3 · quick-win

### 维度 10：help-docs（帮助文档）— 5 条

1. **[major]** L1 除 vision 外参数无人话说明：档位含义、阈值后果、鲜活度含义都没解释（vision 是正面样板，其他面板没学）· medium
2. **[major]** K6（并入）自举三件缺 → 首次使用没有引导流 · medium
3. **[minor]** L2 无首次使用引导（换机器/重装时 cookie、ffmpeg、凭据怎么配）· medium
4. **[minor]** L3 docs/ 56 个文档且 INDEX.md 存在，面板无入口指向 · quick-win
5. **[minor]** H10 配额输入无上限说明 · quick-win

### 维度 11：responsive（响应式）— 2 条

1. **[major]** M1 触摸目标不达标：实测 490px 视口下 133 个按钮中 **109 个 <44px（82%）** · medium
2. **[minor]** M2 移动端无密度模式（133 按钮一页在手机上不可操作）· medium

### 维度 12：performance（性能感知）— 6 条

1. **[major]** C1 搜索无防抖：每敲一键全量 list + 全量重建 · quick-win
2. **[major]** J2 previewTts 被调用两次（actionButton + after 各一次）→ **双倍 TTS 生成、双倍花钱** · quick-win
3. **[major]** I1 12 张缩略图并发 invoke 取 base64，每次 refresh 全部重取，无缓存 · medium
4. **[major]** D2 意见箱 51 条全量渲染（实测 133 按钮）无分页无折叠 · medium
5. **[minor]** C11（并入）记忆列表无分页 · medium
6. **[minor]** E8（并入）收件箱无分页 · quick-win

---

## 逐面板一页速览

| 面板 | 控件数(约) | Blocker | 亮点 | 最痛 |
|---|---|---|---|---|
| 鱼缸与作息遥控台 | 12 | 0 | 三态作息刚上线、滑块+数字联动 | 心跳间隔没入口；戳醒无回执；force_awake 无到期 |
| 记忆管理中心 | 14 | 1(C2) | 四层+作废恢复+版本历史 | 编辑被刷新清空；无冲突视图；核心准入无确认 |
| 日记判断卡意见箱 | 13 | 0 | 在线改日记、批复进注入 | 区块无标题；51 条 133 按钮无分诊；批复=强制解决 |
| B站收件箱 | 8 | 0 | 四路合一、指派带叮嘱 | 无只看未读；拉黑无确认；拉黑名单无出口 |
| 统一待放行改稿台 | 9 | 2(F1,F2) | 在线改字自动续签令牌 | 编辑静默丢弃后发布；放行零确认；过期不可见 |
| 看片偏好与过滤 | 11 | 0 | 可视化增删不用翻 JSON | 删词无撤销；无命中统计；她学来的词不可审计 |
| 安全闸配额风控 | 15 | 1(H2) | 急刹+档位+412 倒计时 | 解除风控零确认；档位说是 8 个实际 6 个；无读配额无花费 |
| 她的眼睛 | 9 | 0 | **全站最佳**：有标题有说明有空态有确认 | 缩略图无缓存；无重跑 |
| 音视频工作台 | 8 | 1(J1) | 底图/BGM/台词/合成一体 | 试听坏的（404 路由）；TTS 双倍调用；选底图看不到图 |

---

## 外部对标：更完善的设计逻辑（借哪些模式）

| 我们的问题 | 别人怎么做的 | 借什么 |
|---|---|---|
| 危险操作零防护 | HITL 审批门（Dataiku 四模式 / ScaleKit）：该门什么、审阅者看到什么、超时与拒绝理由 | WebUI 层借 WriteGate 自己的服务端纪律；确认弹层三要素：后果+正文预览+不可撤销提示 |
| 编辑被刷新清空 | 表单 dirty 状态是 Web 标准实践（beforeunload/切换守卫） | `withDirtyGuard` 共享封装；列表 patch 而非重建 |
| 配置只能改文件 | schema 驱动设置："每个能力声明 settings schema，设置 UI 自动生成，没有一个设置页是手写的" | 宿主 configGroups 就是这个模式，只差声明 |
| 记忆冲突看不见 | Zep/Graphiti 双时间轴：新事实 `invalid_at` 旧边 | 记忆卡加 invalidatedBy + 冲突并排视图 |
| 召回不可解释 | Generative Agents：recency×importance×relevance 三因子各自可见 | 四因子分数展示 + 召回日志 |
| 成本显示 0 | OTel GenAI 约定 + LiteLLM 预算 fail-closed；"限流要数 token 不是数请求" | 价格表 + 未计价明示 + 日花费闸 |
| 意见箱不可分诊 | 工单系统的分诊队列模式：优先级×状态×批量操作 | 意见箱重做（机会点 3） |
| 触摸目标 | WCAG 2.5.5 / iOS HIG 44pt | `min-height:44px` 一行 CSS |

---

## 下一步建议

- **先修 6 条 blocker**（都在机会点 1/2/5/8 里，多数是 quick-win）：A2、C2、F1、F2、H2、J1
- **改版方向沉淀**：机会点 1-5 直接对应「她回话」「你能操作」「你处理得动她反馈」三件事，建议按 建议按 机会点 5 → 1 → 3 → 4 → 2 的顺序进入施工
- **正面样板**：cap-vision 是六个面板里唯一做对 section 标题/参数说明/空态/确认的，**其他八个面板照它改**是最便宜的收敛路径

---

*证据链：源码全读（1309 行 webui 层）+ 线上 HTTP/DOM 实测 + 490px 视口实测 + 意见箱 51 条结构化数据。结构化 findings 见 `spark-output/context/audit.json`。*

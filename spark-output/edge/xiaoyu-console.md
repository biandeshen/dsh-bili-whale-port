# Edge States — 小鱼控制台改版

- **生成时间**：2026-11-05T02:20+08:00
- **走查屏数**：12（sitemap.pages 全量）
- **状态总数**：74（must 52 / should 18 / nice-to-have 4）
- **数据源**：sitemap.json（12 页）+ stories.json（9 故事触点）+ audit.json（106 findings 实测缺口）
- **文案语调**：brief 情感化维度——「她在」的口吻，不是「系统」的口吻（vision 面板为正面样板）
- **全站共享态**（先立规范，各页引用不重复设计）：

## 0 · 全站共享态（webui-helpers 层实现一次，12 页生效）

### error-server / error-network（must）→ 统一错误行规范
- **设计描述**：错误分两级显示。已知错误（后端返回 error 字段的业务错）→ 一行警示文案（`msgline.bad`）；未知异常（技术栈）→ 人话主文案 + 「详情」折叠技术信息
- **用户能做什么**：可重试的操作保留原输入（dirty 保护），重试按钮就地刷新
- **视觉提示**：msgline.bad 红色；折叠用 `<details>`
- **文案建议**：已知错直接引用后端 error（后端已按人话写）；未知错 →「这一步没做成——不是你的问题，是程序出了岔子。详情」
- **禁写**：`TypeError: home is not defined` 裸奔（audit A6 实测发生过）
- **实现位**：webui-helpers `call()`/`actionButton()` 收口，全站一次修

### loading-submit（must）→ busy 按钮规范
- **设计描述**：点击即 `disabled` + 文案换「处理中…」（原动作语义保留，如「放行中…」「清理中…」）；完成恢复原文案，失败恢复并显示错误行
- **fallback_behavior**：busy 期间无法重复点击（修 A2 双发）；>10s 未返回追加「还在跑——模型或网络慢，再等等或刷新」
- **copy_hint**：`{动作}中…` 单字模板
- **实现位**：webui-helpers `actionButton()` busy 机制

### loading-initial（must）→ 首载骨架规范
- **设计描述**：面板挂载时先渲染 2-3 行灰色骨架条（不是空白也不是转圈），数据到后替换
- **fallback_behavior**：>3s 显示「还在取数…」；>10s 转错误行+重试
- **实现位**：宿主 ui 无骨架组件——用 `ui.h('div')` + CSS 灰条，共享层出 `skeleton(lines)` helper

### empty-三兄弟规范（must）
- **empty-first-time**：首次进入无数据 → 说明这是哪 + 第一步做什么（CTA）
- **empty-collection**：列表空 → 「她/你还没……」+ 下一步
- **empty-search / empty-filter**：结果空 → 区分两种：「换个词试试」（搜索）vs「清除筛选看看全部」（筛选）
- **实现位**：宿主 `ui.placeholder()` 已存在但全站未用（audit 实测）——共享层出 `emptyState(icon, text, cta?)`

### offline-no-network（should，Web 桌面）
- **设计描述**：fetch 失败且 `navigator.onLine === false` → 顶部常驻一条「浏览器离线了——显示的是缓存，操作发不出去」
- **实现位**：共享层 window online/offline 监听

### permission-anonymous（must，全站统一）
- **设计描述**：控制台本身有口令/token 门（宿主处理）——面板层无需重复设计；若 invoke 返回 401 类错误按 error-server 显示「需要先在宿主解锁」
- **标注**：本页不计入各屏矩阵（全局一次）

---

## 1 · Screen: 她的一天（page-day，新增）

#### empty-first-time（must）
- **设计描述**：全新部署还没有任何生活记录 → 一张「她的一天从第一条记录开始」卡 + 一句她的自我介绍占位 + CTA「去鱼缸戳醒她」
- **fallback_behavior**：CTA 跳转鱼缸面板
- **文案建议**：「她刚搬进来，日子还没开始记。」

#### empty-collection · 她睡着时段（must，本页特有）
- **设计描述**：凌晨访问且 rest=asleep → 顶部读数区替换为「她睡着了（01:00–07:00 是她的睡眠时段），梦里在结算今天的记忆」+ 静态星空占位；事件流照常显示昨天的
- **fallback_behavior**：不阻断查看历史
- **文案建议**：「别吵醒她——做梦的时候记忆才长好。」

#### boundary-zero · 今天 0 件（must）
- **设计描述**：actionsToday=0 不显示 0 而显示状态解释：「今天还没动——{lifeTick.reason 人话}」（待着/累了/睡着各有各的说法）
- **关联 Story**：story-1（回执与理由已打通）

#### boundary-overflow · 事件流很长（must）
- **设计描述**：默认只渲染今天 + 前一天；「更早的日子」按钮展开分页加载（每页 20 条）
- **fallback_behavior**：不一次性渲染全部（audit D2 的 133 按钮教训）

#### error-server · 事件流含脏数据（must，本页特有）
- **设计描述**：事件含验收标记（acc*）→ 默认过滤并给一行「已隐藏 N 条验收记录 · 显示」；来源字段缺失的事件显示「（来源不明）」不崩溃
- **关联 Story**：story-5 风险项（f-8225e6 污染）

#### loading-initial（must）：共享骨架规范。

---

## 2 · Screen: 鱼缸（page-tank）

#### loading-refresh · 戳醒回执等待（must）
- **设计描述**：点「⚡ 立即戳醒她」→ busy 态「叫她中…」→ 返回后回执 pill：「她这一拍：{做了什么/待着，理由}」
- **fallback_behavior**：>15s 未回执显示「她还没应——可能在跑长任务，稍后在事件流里看结果」
- **关联 Story**：story-1 回执

#### boundary-zero · 场值极值（must）
- **设计描述**：任一场值 ≤0.1 → 该滑块行尾加警示 pill（「体力见底」）；energy<0.35 全局显示「她累了，在歇着」状态条（resting 态已实现，补 UI 强调）
- **fallback_behavior**：提示不阻断调节

#### boundary-null · 情绪成因缺失（should）
- **设计描述**：mood.reason 为空 → 显示「没有特别的成因，风平浪静」而非空白

#### error-validation · 时段输入非法（must，已有）
- **设计描述**：23:30 输成 25:00 → 输入框红框 + 行内「时刻超出 24 小时制」（后端已实现，补前端即时校验：输入时即校验，不等提交）
- **关联 Story**：story-2 error-validation 规范

#### empty-collection · 因果链为空（should）
- **设计描述**：recentChain 空 →「还没有记录——她刚醒或刚清过账」+ 跳她的一天

---

## 3 · Screen: 记忆（page-memory）

#### empty-search（must）
- **设计描述**：搜索无结果 → 「没有想起含「{词}」的记忆」+ 「清除搜索」按钮
- **禁写**：「无结果」

#### empty-collection · 各层为空（must）
- **设计描述**：分层 tab 为空时按层给不同文案——核心常驻空：「还没钉进核心的记忆（她每轮都记得的那些）」；已作废空：「没有作废过任何记忆——好事」
- **fallback_behavior**：CTA「塞一条给她」滚到新增区

#### error-permission · 作废理由不足（must）
- **设计描述**：作废理由 <6 字 → 行内提示「作废要写理由（至少 6 个字），她会看到」；不再是 window.prompt（audit C3）

#### loading-fetch-more · 无分页（must，实现前的状态设计）
- **设计描述**：>30 条时按层分页，每页 20；「下一页」busy 态

#### boundary-long-text · 记忆正文超长（must）
- **设计描述**：正文 >120 字列表页截断 + 「展开」；编辑框完整显示
- **fallback_behavior**：截断不破坏布局（audit C11 教训）

#### boundary-null · 无标签（should）
- **设计描述**：tags 空 → 显示弱化占位「（没打标签）」；不是空白

---

## 4 · Screen: 日记+判断卡（page-journal）

#### empty-collection · 指定日期无日记（must）
- **设计描述**：查无此日 → 「那天她没写——{可选：最近一篇是 X 月 X 日}」+「跳到最近一篇」
- **fallback_behavior**：跳转保留当前 book 选择

#### error-permission · 覆盖确认（must）
- **设计描述**：保存的正文与原正文 diff 非空 → 确认层显示 diff 摘要（增/删行数 + 变更段落）+「她的原文会留在版本历史，可回滚」
- **关联 Story**：story-2 确认规范（audit D6）

#### boundary-long-text · 五千字长文（must）
- **设计描述**：单页日记超一屏 → 默认收起显示前 60 行 + 「展开全文」；编辑框始终完整
- **fallback_behavior**：展开后「收起」

#### empty-collection · 判断卡为空（must）
- **设计描述**：「她还没立过任何判断卡——看完第一条片子就有了」+ 跳看片页

#### error-server · hasMore 但翻页失败（should）
- **设计描述**：上一页请求失败 → 保留当前页内容 + 错误行重试（不白屏，audit D4 教训）

---

## 5 · Screen: 意见箱分诊台（page-triage，新增）

#### empty-collection · 全部解决（must，本页核心空态）
- **设计描述**：未解决 0 条 → 庆祝式空态：「意见箱清空了。她最近提的 {N} 条都有着落了」+ 「看看已解决的」
- **fallback_behavior**：一键切已解决视图
- **文案语调**：这是好状态，用轻快口吻

#### empty-first-time · 她从没提过意见（must）
- **设计描述**：总量 0 → 「她还没提过意见——意见箱是她的心事出口，也是你的需求清单」+ 说明意见如何产生（她看片后的判断、对你的建议）

#### boundary-zero · 严重度计数为 0（must）
- **设计描述**：筛选某严重度为 0 → 该 tab 显示「没有 {high/low} 级的未解决意见」；不是空列表裸态

#### boundary-overflow · 批复正文超长（should）
- **设计描述**：批复框限 500 字，计数器接近上限变琥珀色；超限阻止提交并提示「批复长了，她会读不全——挑重点」

#### error-server · 批复写失败（must）
- **设计描述**：提交失败 → 批复框内容**原样保留** + 错误行「没写进去——{原因}」，重试按钮就地
- **fallback_behavior**：dirty 保护（story-3），绝不丢批复

---

## 6 · Screen: 收件箱与指派（page-bili-inbox）

#### empty-collection · 四路全空（must）
- **设计描述**：「收件箱安静——她这会儿没人找」+ 各路未读计数为 0 的极简行
- **fallback_behavior**：提示「消息到达时她会先看到；你可以在她的一天页看她的反应」

#### empty-filter · 只看未读但无未读（must）
- **设计描述**：切「只看未读」且无未读 → 「没有未读——都处理完了」+「查看全部」

#### error-server · 拉黑失败（must）
- **设计描述**：拉黑动作失败 → 错误行说明「没拉黑成——{原因}」；**确认弹层保持打开**（不静默关闭让用户以为成功）
- **关联 Story**：story-2 确认规范

#### boundary-long-text · 私信长文（must）
- **设计描述**：消息正文 >80 字截断 + 「展开」；展开后操作按钮固定可见（不随内容滚走）

#### boundary-null · 匿名/注销用户（should）
- **设计描述**：who 为空或已注销 → 显示「（已注销的号）」+ 正常提供忽略/拉黑

---

## 7 · Screen: 待放行改稿台（page-bili-drafts）

#### error-validation · 超字数（must）
- **设计描述**：正文输入时实时计数（B 站动态上限）；超限 → 计数变红 + 「超 {N} 字，放行会被平台拒」+ 放行按钮禁用
- **关联 Story**：story-2（F8 落地）

#### boundary-overflow · 队列积压（must）
- **设计描述**：>10 条待放行 → 顶部警示条「积了 {N} 条——最早的已经等了 {M} 小时」+ 按等待时长排序开关
- **fallback_behavior**：点击警示滚到最老的

#### boundary-null · 令牌过期（must，本页特有）
- **设计描述**：createdAt 距今 >24h → 草稿卡顶部黄条「这条可能已过期（令牌会失效）——先保存修改续签，或直接拒掉」；过期稿的放行按钮降级为次要样式
- **关联 Story**：story-7（F4 落地）

#### empty-collection · 队列空（must）
- **设计描述**：「没有要放行的——她想发的都在这排队，发不出的不会默默消失」+ 点单入口引用

#### error-network · 放行中网络断（must）
- **设计描述**：放行请求超时/断网 → **不显示成功也不显示失败**，显示「结果未知——去因果账查这条的最新状态」，附跳转；**绝不倒回队列当作没发过**（双发防护的 UI 面）

---

## 8 · Screen: 看片偏好+她的眼睛（page-bili-watching）

#### empty-collection · 词表为空（must）
- **设计描述**：like/dislike 空时各自显示：「还没告诉她喜欢什么——她现在按默认口味刷」/「没有屏蔽词——不喜欢的直接说，她记性很好」
- **fallback_behavior**：输入框聚焦引导

#### empty-search · 命中统计为 0（must，本页特有）
- **设计描述**：规则命中 0 次 → 词旁显示「还没拦到过——可能没遇到，也可能词太宽/太窄」+ title 提示如何判断（关联 G2 词表未生效史）
- **fallback_behavior**：不显示 0 冒充"生效中"

#### boundary-long-text · 超长 UP 主名/词（should）
- **设计描述**：chip 超 20 字截断 + title 全文

#### loading-refresh · 缩略图渐进（must）
- **设计描述**：拼图墙逐张淡入（已取到的先显示）；取图失败显示文件名+「出不了缩略图」而不是裂图（vision 已实现，保留为规范）
- **关联 Story**：story-9（I1 缓存）

#### error-server · ffmpeg 缺失（must，已有，保留为规范）
- **设计描述**：顶部常驻 pill「找不到 ffmpeg，画面这一路会跳过，字幕弹幕照常」+ 找过的路径列表
- **fallback_behavior**：功能降级不崩（vision 现有行为正确）

---

## 9 · Screen: 连接（page-bili-connection，新增）

#### loading-submit · cookie 校验中（must）
- **设计描述**：粘贴后点校验 → busy「正在验明身份…」→ 成功显示身份卡（头像位/昵称/mid/登录状态 pill）
- **fallback_behavior**：>10s 「B 站没应——检查网络或稍后再试」
- **关联 Story**：story-4

#### error-validation · cookie 无效（must）
- **设计描述**：whois 失败 → 红条「这串 cookie 验不出身份——可能过期或复制不全」+「重新粘贴」；**不落盘**，旧连接保持
- **fallback_behavior**：显示上次成功连接的旧身份供对照

#### empty-first-time · 从未连接（must）
- **设计描述**：「还没连上她的 B 站账号——粘一串 cookie 就算进门」+ 三步示意（获取 cookie → 粘贴 → 验证）
- **fallback_behavior**：CTA 指向 cookie 获取说明（折叠）

#### boundary-null · TTS 凭据缺失（must）
- **设计描述**：体检行显示「TTS：缺凭据——只能出字不能出声」+「怎么配」折叠说明（J10 落地）

#### error-server · 通知测试失败（must）
- **设计描述**：测试推送失败 → 「测试没送到——{原因}」+ 常见原因 checklist（通道没开/凭据缺失/网络）

---

## 10 · Screen: 安全闸（page-bili-gate）

#### boundary-null · 首日无配额记录（must）
- **设计描述**：今日用量 0/12 → 「今天还没发过东西」而非「0/12」裸数字；412 未触发显示「风控安静」而非 0

#### error-server · 412 熔断显示（must，本页核心态）
- **设计描述**：pausedUntil 未到 → 熔断卡展开显示：原因（reason）+ 被打的接口（riskEndpoint）+ 实时倒计时（每分钟刷）+「解除（需确认，可能加深风控）」
- **fallback_behavior**：解除确认层三件套（story-2/H2）
- **关联 Story**：story-2 / story-8（H3 落地）

#### error-validation · 配额输入非法（must）
- **设计描述**：负数/非数字 → 行内红提示「配额要是 0 或正整数」；0 = 今日不发（文案说明这是合法值）

#### loading-refresh · 花费数据未计价（must）
- **设计描述**：价格表缺失 → 「今日花费：未计价（该模型没有价格表）」灰显；**不显示 ¥0.00**（K3 红线）
- **关联 Story**：story-8 / story-9（H6）

#### error-network · 急刹状态未知（should）
- **设计描述**：get 超时 → 急刹按钮禁用 + 「读不到闸的状态——刷新重试」；**宁可不显示也不能默认显示"未开启"**（安全默认值原则）

---

## 11 · Screen: 创作台（page-media）

#### empty-collection · 底图/BGM 为空（must）
- **设计描述**：底图空 → 「素材库空——先放几张底图进来」+ 素材目录路径与「打开目录」指引；BGM 空 → 「曲库空——CC0 曲目放到 {path}」
- **fallback_behavior**：合成按钮禁用 + tooltip 原因

#### loading-submit · 合成进度（must，本页核心态）
- **设计描述**：点合成 → busy「出片中…」+ 阶段文案轮替（抽帧→配音→合成→入库，按后端回调更新）；>60s 显示已耗时
- **fallback_behavior**：失败 → 错误行 + 「素材没问题的话再试一次；反复失败去诊断页看 ffmpeg」
- **关联 Story**：story-7（J5 落地）

#### error-server · TTS 缺凭据（must）
- **设计描述**：试听前检测 → 直接提示「TTS 还没配凭据——去连接页配」+ 跳转（不发起必败请求）
- **关联 Story**：story-7（J1/J10）

#### error-validation · 台词超限（must）
- **设计描述**：>5 行实时计数变红；空台词点试听/合成 → 「先写两句台词」

#### boundary-null · 历史作品无产物（should）
- **设计描述**：构建中断的半成品 → 标「（没出完）」+「重跑这次」

---

## 12 · Screen: 设置（page-settings，新增）

#### empty-first-time · 首次打开（must）
- **设计描述**：configGroups 未声明或为空 → 「这里还空着——核心旋钮正在接入」+ 指向 config.json 的临时说明（过渡期诚实）
- **fallback_behavior**：接入后自动消失

#### error-server · 保存失败（must）
- **设计描述**：configGroups 保存失败 → 表单值保留 + 「没保存上——{原因}」+ 重试；**不回滚 UI 显示值**（避免"看着改了其实没改"）
- **fallback_behavior**：hot 字段标记失效，提示「这项要重启才生效」

#### error-validation · 范围外值（must）
- **设计描述**：超 schema 范围（如 maxTokens < 8000）→ 输入时行内提示 + 禁止保存；引用 schema 的 min/max 文案

#### boundary-overflow · 心跳间隔极小（should）
- **设计描述**：intervalMinutes < 3 → 警示「低于 3 分钟会频繁叫醒她——确定？」（不硬禁，主人有权，但要知情；呼应 noise 治理）

#### permission-read-only · 人设正本（should）
- **设计描述**：人设编辑入口初始只读 + 「编辑」按钮解锁；未解锁时显示 drift 门禁最近一次校验结果

---

## 关键缺失（critical_missing）汇总

| 级别 | 缺失 | 涉及屏 |
|---|---|---|
| 🔴 blocker | 全站零空态（empty-* 全系） | 12/12 |
| 🔴 blocker | 零 busy 态（loading-submit）→ 双发风险 | 12/12 |
| 🔴 blocker | 错误裸奔 e.message（error-server 无分级） | 12/12 |
| 🟠 high | 放行结果未知态（error-network 双发防护 UI） | 待放行台 |
| 🟠 high | 412 原因/接口不显示 | 安全闸 |
| 🟠 high | 未计价显示 ¥0（诚实性） | 安全闸/用量 |
| 🟠 high | 过期令牌无提示 | 待放行台 |
| 🟡 medium | 她睡着特殊态、验收标记过滤 | 她的一天 |
| 🟡 medium | cookie 校验失败不落盘保护 | 连接 |

> 全站三件套（空态/busy/错误分级）在 webui-helpers 收口实现一次即修复 36 个 blocker 级缺失——这是本矩阵最重要的结论：**异常态的第一战场是共享层，不是逐页补**。

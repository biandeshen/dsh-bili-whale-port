# DSH / 大肥鱼开源插件雷达（2026-10-30）

> 主人记得“B 站里关于 dsh 和大肥鱼的插件很多”。核实结果：**生态确实大，但绝大多数是 DSH 宿主插件，不能直接装进 Cortico**。
> 本文只列已用 GitHub API 核过存在/许可/最近推送的仓库；星数为 2026-10-30 当日值，会变。
> 结论先行：**借设计，不装插件；不引第二宿主**。我们缺的“她的一天/待发稿可见”没有现成插件能补，因为它们读不到我们的 `causal.jsonl` 与草稿目录。

## 1. 最相关（建议借设计）

| 项目 | 许可/活跃 | 它做什么 | 我们能借什么 | 是否接 |
|---|---|---|---|---|
| [minedalang/dsh-dafeiyu-life](https://github.com/minedalang/dsh-dafeiyu-life) | MIT · 5★ · 10-30 | 大肥鱼在 DSH 中长期生活：自主刷 B 站、互动、三层人生记忆、情绪衰减、兴趣/关系成长、**大肥鱼的一天**时间线、权限/额度/去重 | 三层记忆（精确经历/待反思/身份级）、时间线、权限代码化、日常动态默认审核；**不要抄它的每日 3 次上限**（主人 10-30 已裁决无上限） | 不装；设计参照 |
| [c1overzz/dsh-bili-scroll](https://github.com/c1overzz/dsh-bili-scroll) | MIT · 1039★ · 10-28 | 每天刷 B 站、读字幕原文、写 Markdown 日报；特别值得的自动评论并 @ 主人 | “先读字幕原文再判断”、日报格式、按 `### BV号` 计数；**自动评论/@ 不能学**（绕过审批） | 不装 |
| [MeteorNOX/DeepSeek-Balance-Whale-Widget](https://github.com/MeteorNOX/DeepSeek-Balance-Whale-Widget) | MIT · 6554★ · 10-11 | DSH 右下角鲸鱼娘余额挂件：拖拽吸附、翻转、数字滚动 | 鱼缸/桌宠的交互与视觉节奏；代码 MIT，角色素材权利需单独核 | 不装；视觉参照 |
| [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) | MIT · 4966★ · 10-30 | 透明动画桌宠，一行命令装；内置 DIY 素材链 | 多开/位置配置、动画状态机；README 标注素材 CC BY-NC-SA，商用要谨慎 | 不装；视觉参照 |
| [Phant0Meow/dsh-meow-memory](https://github.com/Phant0Meow/dsh-meow-memory) | MIT · 337★ · 10-26 | DSH 跨会话记忆：七层 SQLite、事实/反思/身份分层 | 记忆分层与 SQLite 结构；我们的 `persona-core` 记忆可对照补“事实 vs 联想” | 不装；设计参照 |
| [ppy-web/dsh-plugin-xiaomi-mimo-tts](https://github.com/ppy-web/dsh-plugin-xiaomi-mimo-tts) | MIT · 38★ · 10-30 | DSH 的 MiMo/豆包 TTS，音频下载、桌宠联动、QQBot 语音 | UI 联动/音频下载；我们已直连 MiMo API | 不装；UI 参照 |
| [huguangyu666/dsh-plugin-notify](https://github.com/huguangyu666/dsh-plugin-notify) | MIT · 3★ · 09-15 | 桌面通知/中文 SAPI 播报/提示音 | 通知形状；它绑 DSH 回合，Cortico 收不到，需自写适配 | 不装；方案参照 |

## 2. 已有计划/已在用

| 项目 | 许可/活跃 | 用途 | 结论 |
|---|---|---|---|
| [xiaweihuaniubi/dsh-bili-workbench](https://github.com/xiaweihuaniubi/dsh-bili-workbench) | MIT · 2★ · 10-28 | `bili-op` 独立出片引擎（脚本→配音→渲染→封面，不自动发布） | 保持 P2：子进程，不 import |
| [lolistlisa/dsh-autocut](https://github.com/lolistlisa/dsh-autocut) | MIT · 1★ · 10-25 | 文案分段、素材/配乐检索、多轨时间线、剪映草稿 | 已 vendor `lib/`，P2 后 |
| [btahir/open-lofi](https://github.com/btahir/open-lofi) | CC0 · 52★ · 03-15 | 166 首 lo-fi，含 27 首雨/天气 | 可用；整包 554MB，未入库 |
| [farmmer938-lgtm/aeris-cc0-music](https://github.com/farmmer938-lgtm/aeris-cc0-music) | CC0（README/LICENSE；GitHub 检测为 NOASSERTION）· 0★ · 10-07 | 13 首 CC0 氛围/lo-fi | 已入库 3 首 |
| [bruc3van/awesome-dsh-plugin](https://github.com/bruc3van/awesome-dsh-plugin) | MIT · 482★ · 10-30 | DSH 插件目录/TOP200 | 用于发现，不装 |
| [lwmxiaobei/dsh-plugins](https://github.com/lwmxiaobei/dsh-plugins) | MIT · 6★ · 10-30 | DSH 社区插件目录 | 用于发现，不装 |

## 3. 看到但不建议接

| 项目 | 原因 |
|---|---|
| [tailong-wu/dsh-plugin-dayflow](https://github.com/tailong-wu/dsh-plugin-dayflow) | “一天视图/工作日志”很对口，但 GitHub 许可 NOASSERTION；许可不明不接 |
| [theskywilldawn/dsh-stamina-pet](https://github.com/theskywilldawn/dsh-stamina-pet) | 大肥鱼体力条/桌宠，许可 NOASSERTION；只可远观 |
| [lov0vo/dsh-whale-maid](https://github.com/lov0vo/dsh-whale-maid) | 形象动画，许可 NOASSERTION；且与溟月 CC BY-NC-SA 素材边界重叠 |
| [Ebony-Vinyl/dsh-our-free-model](https://github.com/Ebony-Vinyl/dsh-our-free-model) | 51876★ MIT，免费模型聚合；我们已有 OFM 网关，不重复接 |

## 4. B 站上的“大肥鱼”内容

- `BV1d8pU6xEZX`：dsh-bili-scroll 演示（刷 B 站、写日报、@ 主人）。
- `BV14AYy6REy6`：大肥鱼余额挂件 v0.3.0。
- `BV14Gpj6UESm`：DSH 必装插件“三件套”（whale-widget / video-skin / posterflow-ai），偏视觉层。
- 结论：B 站上多是 **DSH 插件演示/桌宠/视觉**；没有找到能直接补“Cortico 里她的一天/待审稿”的现成件。

## 5. 对我们的直接结论

1. **不安装任何 DSH 插件到 Cortico**；Q-08 的 A 选择（库/子进程，不引第二宿主）不变。
2. **最值得抄的是 `dsh-dafeiyu-life` 的信息架构**：三层记忆、一天时间线、权限代码化、动态默认审核；以及 `dsh-bili-scroll` 的“先读字幕原文再判断 + 日报”。
3. **最值得抄的视觉是鲸鱼挂件/桌宠的交互**；但角色素材许可要单独核，CC BY-NC-SA 不能默认商用。
4. **最该自己写的是可观测性**：panel 读 `causal.jsonl`、三队列待审稿只读、bubble 全队列；这是我们的状态，外部插件没有。
5. **语音**：MiMo 已直连，不需要 `dsh-plugin-xiaomi-mimo-tts`；只可借它的 UI/音频下载。
6. **通知**：借 `dsh-plugin-notify` 的形状，不装它；用本地 Toast/ntfy，默认关。

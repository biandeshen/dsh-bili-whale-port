# 插件接入方案 V1 —— 团队研究（2026-10-30）

> 主人指令："能接的就接，注意方案。依旧还是团队研究。"
> 本文件只定**接什么、怎么接、什么时候接**；不写空话，每条都有许可/分发/耦合事实与验收门。
> 2026-10-30 生态复查：DSH/大肥鱼插件很多，但都是 DSH 宿主插件；结论“借设计、不装插件、不引第二宿主”见 `PLUGIN-RADAR-2026-10-30.md`。

## 1. 事实核验（2026-10-30 实测）

| 包/仓库 | 分发 | 许可 | 耦合 | 结论 |
|---|---|---|---|---|
| **dsh-video-studio** | npm `0.4.3` | **MIT** | 核心 `render/media/cover` 零 DSH 依赖；但 `exports` 只有 `"."`，子路径 import 会 `ERR_PACKAGE_PATH_NOT_EXPORTED`（E-13 已实测） | **可接**：vendor 6 个核心文件 + LICENSE + SHA256，不 npm import 内部路径 |
| **dsh-bili-workbench** | **不在 npm**（仅 GitHub） | **MIT** | `bili-op/` 是独立出片引擎（脚本→配音→渲染→封面），默认不自动发布；计费/输出目录未知 | **可接但需隔离**：子进程跑，不 import，不接自动发布 |
| **dsh-autocut** | **不在 npm**（仅 GitHub） | **MIT** | 入口绑 DSH 运行时；`lib/` 可剥出 | **可接（后置）**：剥 lib 或子进程；剪映草稿是加分项 |
| **dsh-voice** | npm `0.5.2` | **MIT AND LGPL-3.0-only** | 绑 DSH 运行时；LGPL 部分需查是依赖还是本体 | **不再需要**：MiMo TTS 官方 API 已在本地视频接入（V1 证据）；Edge-TTS 仅作回退；LGPL 不碰、不 vendor |
| **dsh-whale-maid** | **不在 npm**（仅 GitHub） | 仓库许可待核 | 精灵图集 + 状态机；形象素材是溟月二创（**CC BY-NC-SA**） | **可接展示层**：序列帧可 vendor，必须署名 + 非商用；Live2D 受重分发限制，不接 |
| **bili-cli** | GitHub | 需核（历史上部分仓库被律师函关停） | Python，80+ 命令 | **不接**：我们已有 30 个命令（4660 行）+ traffic guard + 审批，重复且引入第二运行时 |

## 2. 六席裁决

| 席 | 意见 | 采纳 |
|---|---|---|
| 产品 | 视频是最大能力缺口；但 14 天观测期禁改码，接入必须排在观测后，不能边观测边改流水线 | 采纳：观测期零代码变更 |
| 架构 | 优先"库级 vendor + 自写 CLI"，其次"子进程"，**不引第二宿主**（Q-08 A）；所有外部件走适配层，World 不直接依赖 | 采纳 |
| 运行 | 分发两条路都保留：① DSH 插件（UI 安装，已有 `dsh.bundle.patch`）② Cortico 本地部署（npm/vendor 文件）；视频流水线输出目录必须显式配置、默认 `~/.dsh/bili-whale/media/`，不得写 B 站 | 采纳 |
| 安全/合规 | 许可先审：dsh-voice 的 LGPL、溟月素材的 CC BY-NC-SA、bili-cli 的律师函历史；任何 AI 生成内容不自动带"AI 声明"（主人 10-28 DECIDED-NO），披露在简介/平台标签 | 采纳 |
| 挑刺 | "能接"不等于"现在接"；video-studio 的 7 阶段听起来完整，但我们只要**一条 15 秒竖屏**的垂直切片，先证明输出目录/计费/封面可控，再谈整链 | 采纳：V1 只做单条切片 |
| 记录 | 每个接入都要有"输入→命令→产物路径→预期时长/大小→失败处置"的证据卡，不接受"装上了"当完成 | 采纳 |

## 3. 接入顺序（受观测期约束）

```
现在 ──10-31  G3b 收尾/开窗准备（零插件代码）
11-01 ── 14 天观测（禁改码，只留证据）
观测结束 ── M1 模块化（TTS/BGM/凭据/渲染器，行为等价） ── V1 接 World ── V2 出片 ── A1 形象 ── S1 剩余（10s 试听/音色设计） ── V3 自动剪辑
```

### V1（本地已通，观测后接线）：video-studio 单条切片

> **2026-10-30 已完成前置**：核心 6 文件已 vendor 到 （MIT + LICENSE + SHA256SUMS + 完整性测试 2/2），未接线、无行为变更。
> **2026-10-30 V1 本地成片 smoke 通过**：20s/1080×1920/h264+aac，MiMo TTS（`mimo-v2.5-tts`，音色茉莉，7.04s）+ CC0 BGM（AERIS `quiet-room`），9:16 + 16:9 两张封面；不涉及 B 站投稿。证据卡：`docs/evidence/V1-VIDEO-SMOKE-2026-10-30.md`。
> **仍未做**：接 World、进待审列表、按情绪自动选曲、正式封面排版微调——留给观测后。
- vendor `render/media/cover` 核心 + LICENSE + SHA256；写 `tools/video-build.mjs`
- 输入：一段文案 + 一张立绘 + MiMo TTS（失败回退 Edge-TTS）+ CC0 BGM
- 输出：`~/.dsh/bili-whale/media/<date>/<slug>.mp4`（1080×1920，≤60s）+ 封面 PNG
- **不接投稿**；产物进待审列表，人工预览后才可走 `dynamic-image`/投稿
- 门：一条 15–30s 成片能在本地播放、字幕不越界、封面 16:9/9:16 各一张；失败可重跑且不覆盖旧产物

### V2（可选）：bili-workbench `bili-op` 子进程
- 只在 V1 的表达力不够时接；子进程 + 独立输出目录；默认 `--no-publish`
- 门：同一文案两条路线产物对比，选一条保留，另一条删除

### A1：形象（whale-maid 序列帧）
- 只取精灵图集 + 状态机映射；接入 Cortico WebUI 的鱼缸/头像位
- 必须署名「溟月 / 上善无形」+ CC BY-NC-SA + 非商用
- **2026-10-30 核查**：47 星的 `yunxiiQwQ/dsh-maid-whale-UI` **无 LICENSE，不能用**；MIT 的 `AcidGr/dsh-web-whale-maid` 资产 5.7MB（base64 内嵌），风格/许可需主人定；暂不 vendor
- 门：12 状态中至少 6 个可用（眨眼/思考/说话/困/开心/低落），掉帧不影响主流程

### S1：语音
- **2026-10-30 本地已通（◐）**：MiMo `mimo-v2.5-tts` 接入 `tools/video-build.mjs`，音色 `茉莉`，7.04s 中文样片；key 走 env/auth.json，不落库；`--tts auto` 失败回退 Edge-TTS。
- 剩余：10s 试听门未单独补；MiMo 限时免费，收费后走 Edge；voiceclone/音色设计未接。
- 原计划「审计 Edge-TTS 许可 / dsh-voice LGPL」**不再需要**（不 vendor、不分发该插件本体）。
- 门：一条 10s 中文试听，采样率/音量一致，失败回退静音不阻塞出片。

### V3：autocut
- 只做"文案→多轨时间线→剪映草稿"；不直接发布
- **2026-10-30 已完成前置**：`lib/` 15 文件已 vendor 到 `vendor/dsh-autocut/`（MIT + SHA256SUMS + 隔离测试 2/2），未接线
- 门：导出的草稿能在剪映打开，轨道名/时长正确

## 4. 分发与安装（回答"怎么就不行了"）

- **DSH 插件**：`dsh-bili-whale` 本身就是标准插件（`package.json.dsh.bundle.patch` + `core/index.js`），UI 里可安装/配置；视频/语音插件同样可装到 DSH 宿主，但那是**主人的 DSH**，不是 Cortico。
- **Cortico 部署**：本地 `deployments/mybot` + `tools/`，视频/语音以 **vendor 库/子进程**接入，不依赖 DSH 宿主。
- **两条路并存**：想用 DSH 生态就用 DSH 插件；想让小鱼在 Cortico 里活着就用本地适配层。二者共享 `~/.dsh` 状态与 `~/.bili-ai` 凭据（按 OS 用户）。
- **不做的**：不把 panel 暴露公网；不在插件里存明文 cookie；不自动发布；不默认勾选任何"AI 生成"声明。

## 5. 现在的动作

1. **观测期前不再接插件**（避免污染 3 天证据与 14 天冻结）；V1/S1 的本地能力已够，不接线。
2. 观测结束后先做 **M1 模块化**（TTS/BGM/凭据/渲染器/资产根目录，行为等价），再接 World；之后按 V1 接线 → A1 → S1 剩余 → V2 → V3，每步一门，失败就停。边界见 `docs/MODULARITY-2026-10-30.md`。
3. Q-04/Q-08 按本方案视为"已选 A（库/子进程，不引第二宿主）"；若主人要改 B（sidecar），需在观测结束后重新裁决。

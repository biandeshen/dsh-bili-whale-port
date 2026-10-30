# 模块化与可插拔边界（2026-10-30）

> 目的：把**供应商 / 渠道 / 资产 / 审批**从人格内核里剥出来，让换 TTS、换 BGM、换渲染器、换形象不用改她的一天。
> 六席评审与优先级裁决见 `TEAM-GAP-ANALYSIS-2026-10-30.md`；本文的 M1 已按评审拆成 M1a–M1e。
> 纪律：**现在只落文档**。11-01 起 14 天观测禁改码；观测结束后按 M1→M2→M3 机械执行，不边观测边拆。
> 原则：不为了拆而拆；拆出来的每块必须有独立验收，拆完行为不变。

## 0. 三条不拆的硬边界

| 不拆 | 原因 |
|---|---|
| Cortico World 的生活循环 / 节奏单调度器 | 拆成多时钟会抢唤醒，破坏"她的一天"的因果链 |
| `scripts/ack.mjs` 一次性令牌 + kill switch + `go-gate` | 安全边界必须单点；插件化审批等于给注入者开后门 |
| `scripts/hashes.json` 冻结的验收脚本 | 观测判据不能跟着代码一起漂移 |

## 1. 现状耦合热点（file:line 证据）

| # | 位置 | 混了什么 | 后果 |
|---|---|---|---|
| 1 | `tools/video-build.mjs:19-21` | 直接 import vendor 的 render/cover/ffmpeg | 换渲染器要改 CLI 主文件 |
| 2 | `tools/video-build.mjs:32-42` | CLI 参数、默认音色/风格、BGM 音量全写死在入口 | 没有配置层，无法按部署改默认 |
| 3 | `tools/video-build.mjs:94-128` | BGM 目录扫描 + MiMo key 发现 | 资产路径和凭据策略跟出片逻辑绑死 |
| 4 | `tools/video-build.mjs:130-215` | MiMo/Edge 两套 TTS + 回退顺序 | 加第三个 TTS 要改主文件 |
| 5 | `tools/video-build.mjs:217-295` | ffmpeg 混音、字幕/封面编排 | 换 vendor 或换构图要动同一文件 |
| 6 | `tools/lib/cred.mjs:19-52` vs `video-build.mjs:114-128` vs `tools/commands/video-content.mjs:12` | B 站 cookie 有统一 loader，MiMo 自己读 auth.json，字幕命令又直接读 cookie 文件 | 凭据读取三套，容易泄露/漏校验 |
| 7 | `scripts/draft-dynamic.mjs:150-183` | 纯函数 `composeDraft`（可单测） | 好边界，应保留并加测试 |
| 8 | `scripts/draft-dynamic.mjs:190-248` | CLI、日记读取、图片选择、去重、入队、写文件混在一起 | 换图片源/换存储要改主流程 |
| 9 | `scripts/dynamic-approve.mjs:91-92` | 审批器硬编码 `tools/bili.mjs dynamic-image` 的参数 | 换发布渠道要改审批器 |
| 10 | `tools/commands/dm-draft.mjs:10-12` | 命令层反向 import `scripts/ack.mjs` | `tools/` 与 `scripts/` 双向依赖 |
| 11 | `tools/lib/pick-image.mjs:28`、`scripts/draft-dynamic.mjs:19-20`、`scripts/dynamic-approve.mjs:13-14` | 硬编码 `D:/AI/养鱼` 旧路径 | 换机器/分发时装不上 |
| 12 | `panel/server.js:70-72`、`panel/views/tank.html:234` | 固定 `/api/avatar` + 单个 `avatar.png` | 换序列帧/Live2D 要改服务端和页面 |
| 13 | `vendor/dsh-video-studio/{fonts.js,render.js}` | 字体是 Windows 绝对路径、渲染契约固定 | 跨平台/换字体要动 vendor；适配层应吸收 |

### 1.1 可观测性耦合（当前“使用体验”的根）

| 位置 | 现状 | 后果 |
|---|---|---|
| `panel/data.js:13-14` | “她的一天”时间线读 `~/.dsh/whale-log.jsonl` | Cortico World 写的是 `causal.jsonl`；`whale-log` 最后一条是 **2026-10-25**，面板会显示旧 DSH 时代的事件 |
| `core/api/routes.js:195`、`panel/data.js:51` | `/api/pending` 只读 `~/.bili-ai/pending-replies.json`（go-gate） | 每日动态草稿（`D:/AI/养鱼/drafts/<D>.json`）不在面板里；bubble 的 `pendingCount` 也不会算它 |
| `panel/views/tank.html:162,180` | bubble 文案/待审列表只认 go-gate 队列 | 明明有 `dyn-20261030-741fdf` pending，面板仍可能说“在窗里游着，没事” |
| `tools/lib/config.mjs:40` | `notify.type` 默认 `none` | 她出稿/醒来不会通知；只能主动开控制台或翻文件 |
| `src/worlds/bili-account/definition.ts:632` | 日记小节日期用 `dayKey(Date.now())` | 2026-10-30 09:12/11:11 的私人日记落到了 `## 2026-10-29`；她自己在日记里记了“日期错位，要留意”。原因待查（时区/日源），不能当正常 |
| `scripts/draft-dynamic.mjs:58,79,137` | `buildText` 取第一个「想说」、`snippetOf` 截 20 字 | 10-30 公开日记同一天有两个「想说」，稿子取了 09:12 的 Yoga Nidra 段而不是 11:11 的 283 桶段；书名被截成《…高效补》，正文留下未闭合 `**`（已发稿实证） |
| 8447 / 7799 实测 | 8447 `whale-panel` 未监听；7799 是 Cortico 操作台 | 现在能看到的不是鱼缸，而是 agent 控制台：系统提示词、工具调用、token 数、事件帧；“B站账号”详情页显示“没有声明任何面板” |

> 结论：她“活着”的证据主要在两本日记和 `causal.jsonl`，但**主人看到的界面不呈现这些**。这不是模块化洁癖，是当前使用体验的直接缺口。

## 2. 目标模块（只在观测后创建）

```
tools/video-build.mjs            # 只剩 CLI：解析参数 → 调 media 编排
tools/lib/media/
  config.mjs                     # media.* 默认值与 env 覆盖
  tts/index.mjs                  # provider 注册表 + auto 回退顺序
  tts/mimo.mjs                   # MiMo HTTP；不碰 key 存储
  tts/edge.mjs                   # edge-tts 子进程
  bgm/index.mjs                  # catalog 读取 + selector/mood 映射
  video/base.mjs                 # ffmpeg 基础片段、混音、封面底图
  video/studio.mjs               # 唯一 import vendor 的适配层
tools/lib/credentials/
  index.mjs                      # provider 注册表：bilibili / mimo
  bilibili.mjs                   # 复用 tools/lib/cred.mjs
  mimo.mjs                       # env → auth.json → credentials/mimo.json
assets/bgm/catalog.json          # id/file/title/license/mood/duration/source
assets/avatar/manifest.json      # 以后：状态 → 帧文件 + 许可
scripts/lib/drafts/
  compose.mjs                    # 纯函数（从 draft-dynamic 抽出）
  store.mjs                      # 读写/去重/图片选择
  publishers/bilibili-dynamic.mjs# 只拼 argv + 解析 dyn_id
```

### 2.1 接口（行为等价的判据）

```js
// TTS
{ id, voices, async synthesize({ text, voice, style, out }) -> { provider, voice, duration } }

// BGM
{ resolve(selector, { mood } = {}) -> { id, file, license, duration } | null }

// Renderer（vendor 只在这里出现）
{ render(spec, config, hooks) -> { output, duration, sizeMB, warnings },
  cover(spec, config) -> { output, bytes } }

// Credential（secret 只在 provider 内使用，CLI 不打印）
{ id, load() -> string|null, describe() -> 'env'|'file'|'missing' }

// Publisher（审批器只认接口，不认具体命令）
{ kind, buildArgs(draft, { go }) -> string[], parseResult(out) -> { ok, id } }
```

### 2.2 计划中的配置面（现在还没有）

`tools/lib/config.mjs:26-55` 目前只有 session/persona/risk/notify/night 等键，**没有 media**。观测后新增：

```jsonc
{
  "media": {
    "tts": { "provider": "auto", "fallback": ["edge"], "voice": "茉莉", "style": "温柔、轻一点、像夜里说话" },
    "bgm": { "dir": "assets/bgm", "default": "auto", "volume": 0.14, "moodMap": { "宁静": "quiet-room", "低落": "colder-air" } },
    "renderer": "video-studio",
    "outputDir": "~/.dsh/bili-whale/media",
    "ffmpegPath": ""
  }
}
```

配置只放**非秘密**；key 继续走 `MIMO_API_KEY` / `~/.local/share/mimocode/auth.json`，不进 config、不进 assets、不进 git。

## 3. 哪些值得插拔，按优先级

| 优先级 | 能力 | 插拔方式 | 什么时候 |
|---|---|---|---|
| P0 | TTS provider | 注册表 + `--tts`/config；MiMo / Edge / 以后 voiceclone | 观测后 M1 |
| P0 | BGM 曲库 | `assets/bgm/catalog.json` + selector；曲库可整包替换 | 观测后 M1 |
| P0 | 凭据 | 统一 credential registry；B 站/MiMo 各自 provider | 观测后 M1 |
| P0 | 渲染器 | `video/studio.mjs` 适配层；以后可换 bili-workbench | 观测后 M1 |
| P0 | 资产根目录 | `WHALE_IMAGE_DIR`/`WHALE_DRAFTS`/`media.outputDir`，去掉 `D:/AI/养鱼` 硬编码 | 观测后 M1（分发前必做） |
| P0 | 可观测性（她的一天/草稿） | panel timeline 改读 `causal.jsonl` + `days/<D>/day.json`；pending 只读展示动态草稿，审批仍走 CLI/token | 观测后 M1a |
| P0 | 内容完整性 | 日记重复 heading/日期、`buildText` 选段、`snippetOf` 截断与未闭合 markdown；先修生成器再出新稿 | 观测后 M1d（最先） |
| P0 | 审批加固 | token 不进 stdout/模型、argv 重建、textHash+draftId、kill 全覆盖；在此之前不做一键审批 | 观测后 M1e |
| P1 | 草稿 compose/store/publisher | 纯函数与存储/审批分离；审批只认 publisher | 观测后 M2 |
| P1 | 动态发布器 | `publishers/bilibili-dynamic.mjs`；审批 token/kill 不变 | 观测后 M2 |
| P1 | 形象/头像 | `assets/avatar/manifest.json` + `/api/avatar` 读 manifest | 观测后 M3 |
| P2 | 按情绪选 BGM | `bgm.moodMap` + `voice.mood.label`；先人工听样 | 观测后 M2 |
| P2 | 出片流水线 | 子进程 `bili-op`，不 import、不自动发布 | 表达力不够时 |

## 4. 不建议拆的（会把简单事变复杂）

- **World 的 `definition.ts` 整体拆成微服务**：现在是一个进程里的编排，拆出去只会多一层 RPC 和状态同步；先把纯函数下沉到 `persona-core` 即可。
- **panel 拆成独立前端框架**：现在单页 + 零依赖是优点；换形象只需 avatar provider，不需要上 React。
- **把审批挪进 DSH 插件**：插件被注入时审批就失效；审批必须留在本地 CLI + 一次性 token。
- **给每首歌写自动情绪分类**：3 首 CC0 先手工 `moodMap`；等曲库 >20 首再谈自动。

## 5. 执行顺序与验收

### M0（现在，只文档）
- 更新 `CURRENT`/`BLUEPRINT`/`PLUGIN-*`/`VENDOR.md` 的现状与指针
- 本文落盘；不改代码

### M1（观测结束后第一个窗口）——拆成 5 个子阶段，各自过门

团队裁决：原来把 6 个 P0 塞进一个“行为等价门”会互相掩盖；按“先停坏内容、再保审批、再可见、最后拆供应商”排序。

| 子阶段 | 内容 | 门 |
|---|---|---|
| **M1d 内容完整性（最先）** | `upsertDiarySection` 日期段内唯一 heading、`buildText` 只取目标日期、`snippetOf` 不截断书名/闭合 markdown；单测 | 同一日期不再出现重复「想说」；30 号稿不再引用 29 号段；书名/强调闭合 |
| **M1e 审批加固** ✅ 已在 `dev/m1e` 实现 | `list` 默认不打印 token（`--show-token <id>` 才给单条）；panel 放行按 kind 白名单重建 argv（展示字段覆盖执行）；动态审批补 `textHash`+`draftId` 绑定 | 伪造 message 改不了执行命令；默认 `list` 无 token；改稿后 go 被拒；**kill 统一检查 ✅ 已补（主人 2026-10-30 翻案 D-22）：`tools/lib/kill.mjs` + traffic 写通道收口** |
| **M1a 资产根 + 可观测** ✅ 只读部分已在 `dev/m1a` 实现 | `paths.draftsDir()/imagesDir()` 收口（draft-dynamic/dynamic-approve/pick-image + Cortico 传 `--drafts`）；`panel/causal.mjs` + `panel/drafts.mjs` 只读；`/api/drafts`；bubble 三队列合计 | 换机器不依赖 `D:/AI/养鱼`；面板时间线读 `causal.jsonl`（缺则回退 whale-log）；有 pending 稿时 bubble 不再说“没事”。**残留**：4 个冻结验收脚本 + wake-audit/c2-window 的内联 legacy 同优先级未动（观测后重冻统一）；“存在感”微行为属行为改动，观测后 |
| **M1b 凭据** | 新增 `credentials/mimo.mjs`；`bilibili.mjs` 只 re-export `loadCred`；secret 不出 provider | 缺 key fail-closed；stdout/日志无 secret；B 站 cookie 位置不漂移 |
| **M1c 媒体** | 抽 `media/tts`、`media/bgm`、`media/video/studio`、`config.media` | 现有 `--tts mimo/edge/none`、`--bgm auto/quiet-room/none`、`--plan`、20s 样片继续可跑；换 provider 不改 CLI |

- 先做 M1d：已发 10-30 稿的 `**`/书名截断就是它放出来的；不先堵，后面每发一次都可能再犯。
- M1e 先于 M1a 的“待审稿可见”：可见但一键能绕过 token，比看不见更危险。
- M1a 先于 M1b/M1c：它不改她的行为，只读，风险最低，也直接回答“使用体验”。
- 新测试：TTS 回退顺序、BGM selector、secret 不出现在 stdout、缺 key fail-closed；日记重复 heading/跨日/书名截断。
- **可观测门**：面板“她的一天”能读到当天 `causal.jsonl` 的 action/diary/draft 事件；有 pending 动态草稿时 bubble 不再说“没事”；只读，不新增自动发布。

### M2
- 抽 `drafts/compose|store|publishers`；`dynamic-approve` 改调 publisher
- 门：`approve dry` 不消耗审批、`go` 后拒绝重复、token 不变；day-report/G3b 判据零变化

### M3
- `avatar/manifest.json` + `/api/avatar` provider；先接 MIT 素材，CC BY-NC-SA 只做可选皮肤并署名
- 门：6 个状态可切换，掉帧不阻塞主流程

## 6. 与观测期的关系

- 观测期（11-01 起）**不做 M1–M3 的代码改动**；只读证据、只改 incident。
- 如果观测提前失败/停止，直接进 M1，不需要等满 14 天。
- 本文只定边界，不代表任何模块已拆；现状仍是 `tools/video-build.mjs` 单文件 + 直接 import vendor。

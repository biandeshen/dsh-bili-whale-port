# V1 视频切片 —— 证据卡（2026-10-30）

> 只记跑过的命令与产物。状态：**本地成片通过**；未接 World、未投稿、未进任何待审队列。
> 2026-10-30 晚补充：TTS 从 Edge-TTS 换成 MiMo（官方 API），并接入 CC0 BGM。

## 输入

| 项 | 值 |
|---|---|
| 立绘 | `D:/AI/养鱼/assets/daily/daily-04-goodnight-a.png` |
| 文案 | `今晚听雨。` / `三十九分钟，没有人说话。` / `晚安。` |
| 时长/画幅 | 20s，1080×1920，30fps |
| TTS | MiMo `mimo-v2.5-tts`，音色 `茉莉`，风格指令「温柔、轻一点、像夜里说话」，7.04s |
| BGM | `assets/bgm/quiet-room.mp3`（AERIS MUSIC，CC0），音量 0.14 |
| 工具 | `tools/video-build.mjs` + `vendor/dsh-video-studio`（MIT） |
| 二进制 | `~/.dsh/bili-whale/bin/ffmpeg.exe` + `ffprobe.exe`，均为 9.0.2（旧 2020 版保留为 `ffmpeg-2020.exe`） |

## 命令

```bash
node tools/video-build.mjs --image "D:/AI/养鱼/assets/daily/daily-04-goodnight-a.png" \
  --text $'今晚听雨。\n三十九分钟，没有人说话。\n晚安。' \
  --duration 20 --tts mimo --voice 茉莉 --bgm quiet-room
```

默认 `--tts auto`（MiMo 失败回退 edge-tts）、`--bgm auto`（assets/bgm 第一首）；`--tts none`、`--bgm none` 可分别关掉。

## 结果

| 项 | 结果 |
|---|---|
| 成片 | `C:/Users/Administrator/.dsh/bili-whale/media/_smoke/smoke-20261030081609.mp4` |
| 容器 | 20.000s，1,342,665 B（1.28MB），h264 1080×1920 + aac 单声道 |
| 音频电平 | 全片 max -4.1 dB；人声段 mean -21.7 dB；BGM 独奏段 mean -28.8 dB（垫底不抢人声） |
| 竖版封面 | `smoke-20261030081609-cover.png`，1080×1920，1.75MB |
| 横版封面 | `smoke-20261030081609-cover-169.png`，1280×720，0.64MB（模糊底 + 完整立绘居中） |
| sha256 | 成片 `f79fb12b51260f94b9d8fec4b1b34d1121d7ee649c438652ef3ee42f42332b90` |
| | 竖封 `f2d81e4903bfca34aad0c64e6259808ad2c11ecdf0b19e1423df92f186f2243c` |
| | 横封 `c7f3781059374bfb8cb3a803baff8d249732e73152a8775fb065579213ba2b15` |
| 字幕 | 2s 顶部标题；12s 底部正文；18s 底部「晚安。」；20s 淡出 |

抽帧同目录：`mimo-6.png` `mimo-12.png` `mimo-18.png`（均已目检）。

## MiMo TTS 接入

- 端点：`POST https://api.xiaomimimo.com/v1/chat/completions`
- 请求：`{model, messages:[{role:"user",content:<风格指令>},{role:"assistant",content:<正文>}], audio:{format:"mp3",voice:"茉莉"}}`
- 响应：`choices[0].message.audio.data` 为 base64 mp3；代码直接解码写文件。
- **key 来源（不落库、不入 git、不打印）**：优先 `MIMO_API_KEY`，否则读 `~/.local/share/mimocode/auth.json` 的 `xiaomi.key`。
- 可用中文音色（官方 8 个预置中的 4 个）：`冰糖`（甜）、`茉莉`（温柔）、`苏打`（男·活力）、`白桦`（男·沉稳）。
- 回退：`--tts auto` 先 MiMo，失败再走 `tools/venv` 的 edge-tts；`--tts edge` 已单独验证（1.87s，`zh-CN-XiaoyiNeural`）。

## BGM 接入

- 本仓 `assets/bgm/` 放了 3 首 CC0：`bedroom-window-outlands`（lofi/calm）、`quiet-room`（ambient/calm）、`colder-air`（dark/cold）。
- 来源：https://github.com/farmmer938-lgtm/aeris-cc0-music，CC0 1.0，可商用、无需署名；许可文件 `assets/bgm/LICENSE-CC0.txt`。
- 混音：人声延迟 1.5s、BGM 循环并压到 `--bgm-volume`（默认 0.14），`amix normalize=0` 保持人声电平。
- 更大的 CC0 曲库：Open Lo-Fi（166 首，554MB，含 27 首雨/天气），未入库，需要时再从整包挑。

## 踩到的坑（已修）

1. `resolveBinaries({})` 不扫 `~/.dsh/bili-whale/bin/` → 显式传 `ffmpegPath`/`ffprobePath`。
2. 基础片段无音轨，vendor 的 `[i:a]` 链报 `matches no streams` → 无配音时补 `anullsrc`，有配音时走 TTS 轨。
3. planOnly 用 1s 占位片段导致「正文时间窗不足」误报 → plan 也按真实时长建片段。
4. 封面从成片取帧会叠出「大字 + 行字幕」两层字 → 改从无字幕的 base 取帧。
5. 竖图直接中心裁 16:9 会切到眼睛 → 改模糊底 + 完整立绘居中。
6. 失败路径会残留 base/voice → `process.on('exit')` 统一清理。
7. 2020 版 ffmpeg 没有 `amix normalize` → 升级到 9.0.2（旧版留 `ffmpeg-2020.exe` 备份）。

## 边界

- **未接 World**：`bili_draft_dynamic`/动态投稿链路零改动；观测期（11-01 起）不接线。
- **未接 BGM 自动选曲**：目前按文件名/首曲选；按日记情绪选曲留到观测后。
- **MiMo 限时免费**：后续若收费，走 `--tts edge` 或换 key；不把 key 写进仓库。
- 16:9 封面的文字仍在人物脚部附近；正式使用前按图微调 `firstBaseline`。

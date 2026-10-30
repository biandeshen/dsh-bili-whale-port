# V1 视频切片 —— 证据卡（2026-10-30）

> 只记跑过的命令与产物。状态：**本地成片通过**；未接 World、未投稿、未进任何待审队列。

## 输入

| 项 | 值 |
|---|---|
| 立绘 | `D:/AI/养鱼/assets/daily/daily-04-goodnight-a.png` |
| 文案 | `今晚听雨。` / `三十九分钟，没有人说话。` / `晚安。` |
| 时长/画幅 | 20s，1080×1920，30fps |
| 配音 | Edge-TTS `zh-CN-XiaoyiNeural`，rate `-4%`，5.78s |
| 工具 | `tools/video-build.mjs` + `vendor/dsh-video-studio`（MIT） |
| 二进制 | `~/.dsh/bili-whale/bin/ffmpeg.exe`（2020 build）+ `ffprobe.exe`（9.0.2） |
| TTS 环境 | `~/.dsh/bili-whale/tools/venv`（Python 3.14.3 + edge-tts 7.3.1） |

## 命令

```bash
node tools/video-build.mjs --image "D:/AI/养鱼/assets/daily/daily-04-goodnight-a.png" \
  --text $'今晚听雨。\n三十九分钟，没有人说话。\n晚安。' --duration 20
```

默认音色 `zh-CN-XiaoyiNeural`；`--voice none` 出静音成片；`--plan` 只校验时间轴（仍会合成配音并建基础片段）。

## 结果

| 项 | 结果 |
|---|---|
| 成片 | `C:/Users/Administrator/.dsh/bili-whale/media/_smoke/smoke-20261030044841.mp4` |
| 容器 | 20.000s，1,148,610 B（1.1MB），h264 1080×1920 + aac 单声道 |
| 音频 | max_volume -6.8 dB（有真实人声，非静音轨） |
| 竖版封面 | `smoke-20261030044841-cover.png`，1080×1920，2.37MB |
| 横版封面 | `smoke-20261030044841-cover-169.png`，1280×720，0.83MB（模糊底 + 完整立绘居中） |
| sha256 | 成片 `9221820a772359dcba1ee69be1cff621e2b1247e403375b418d77bd4bbb2c6a1` |
| | 竖封 `a75f11c9dad71c77f1eb854ebe146b0c585e8130299ebce732d6649775ab16e0` |
| | 横封 `71f8d669ed25952202bef51df46b777c649924319843d01b1efe8f5ded9009ce` |
| 字幕 | 2s 顶部标题；6–12s 底部正文；18s 底部「晚安。」；20s 淡出 |

抽帧同目录：`frame-2-s.png` `frame-6-s.png` `frame-12-s.png` `frame-18-s.png`（均已目检）。

## 踩到的坑（已修）

1. `resolveBinaries({})` 不扫 `~/.dsh/bili-whale/bin/` → 显式传 `ffmpegPath`/`ffprobePath`。
2. 基础片段无音轨，vendor 的 `[i:a]` 链报 `matches no streams` → 无配音时补 `anullsrc`，有配音时走 TTS 轨。
3. planOnly 用 1s 占位片段导致「正文时间窗不足」误报 → plan 也按真实时长建片段。
4. 封面从成片取帧会叠出「大字 + 行字幕」两层字 → 改从无字幕的 base 取帧。
5. 竖图直接中心裁 16:9 会切到眼睛 → 改模糊底 + 完整立绘居中。
6. 失败路径会残留 base/voice → `process.on('exit')` 统一清理。

## 边界

- **未接 World**：`bili_draft_dynamic`/动态投稿链路零改动；观测期（11-01 起）不接线。
- **未接 BGM**：只有人声 + 静音；BGM 需另找可商用音源。
- **配音服务**：Edge-TTS 是微软在线接口，离线时 `--voice none` 可降级。
- 16:9 封面的文字压在人物脚部附近；正式使用前需按图微调 `firstBaseline`。

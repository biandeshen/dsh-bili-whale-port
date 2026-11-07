# 09 · 音视频出片

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。

## ① 现在是什么

本地 ffmpeg 合成竖屏短片，产物落在部署目录，**送待放行队列那一步在部署里没接线**（⑤ 第 1 条）。

试听：面板按钮或工具 `media_tts_preview` → `runPreviewTts`（`packages/cap-media-studio/src/index.ts:168-198`）
→ `previewTtsAudio`（`packages/cap-media-studio/src/render.ts:262-299`）→ TTS 计划 auto = mimo → edge（`packages/cap-media-studio/src/vendor/tts.mjs:17-22`）
→ 命名 `tts-preview-<base36>.mp3`（`index.ts:172`）→ 回读成 data URL 进 `<audio>`（`index.ts:191-197`、`packages/cap-media-studio/src/webui/client.ts:92-97`）。

出片：面板「🎬 合成视频草稿」或工具 `media_video_build` → `runBuildVideoDraft`（`index.ts:200-280`）→ `renderVideoSlice`（`packages/cap-media-studio/src/render.ts:92-259`）。
七类产物（命名 `render.ts:121-127`）：成片 `<itemDir>/video.mp4`、竖封面 `video-cover.png`、横封面 `video-cover-169.png`，
三个点开头中间产物在 `finally` 必删（`:129-133`、`:256-258`）。五步 = TTS → 基础片段（`packages/cap-media-studio/src/vendor/video/studio.mjs:39-71`：
`force_original_aspect_ratio=increase,crop`、`adelay=1500`、BGM `volume=`+`apad`、三路音频规则、`-r 30 -pix_fmt yuv420p -c:v libx264 -preset veryfast -crf 23`）
→ 正片渲染（`render.ts:200-216` → `vendor/dsh-video-studio/render.js:186`）→ 竖封面 → 横封面（模糊底 `studio.mjs:74-84`）。
目录由部署装配口给出：`<部署家>/xiaoyu/data/media/{assets,bgm,out}`（`packages/cortico-world-media/src/index.ts:58-64`）。
账本 `<outputDir>/video-drafts.json`（`index.ts:95`，读 `:97-104`，写 `:106-109`，**无条数上限**）。

## ② 真值在哪

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `durationSec` | `index.ts:221-224`（默认走 `MEDIA_DEFAULTS.video.duration`，非 config）→ `render.ts:113-115`；界 3–60（`render.ts:21`） | schema `defaultDurationSec`（`index.ts:296`）**无人读** | 数字框 `webui/client.ts:65` |
| 竖屏规格 | `index.ts:227` split → `render.ts:106-108` → 滤镜 `packages/cap-media-studio/src/vendor/video/studio.mjs:40` | `videoWidth`/`videoHeight`（`index.ts:297-298`）**无人读** | 无 → 只能改文件 |
| 双封面规格 | 竖：`render.ts:226-229`（=成片尺寸，只放一行）；横：**硬编码 1280×720**（`:231-234`） | 无键 | 无 |
| TTS 语音/风格/模型 | `packages/cap-media-studio/src/vendor/tts.mjs:15`（mimo=茉莉、edge=zh-CN-XiaoyiNeural）、`render.ts:162/168-169/282/284-285` | `ttsProvider`/`ttsVoice`/`ttsStyle`/`ttsModel`（`index.ts:290-293`）**无人读** | 无 → 只能改文件 |
| 语速 | `packages/cap-media-studio/src/vendor/tts.mjs:82`（`--rate -4%`，**只有 edge 有**；MiMo 无速率参数） | 无键 | 无 |
| BGM 音量 | `index.ts:237`（`MEDIA_DEFAULTS.bgm.volume` 0.14）→ `render.ts:117`（钳 0–0.6）→ `studio.mjs:53` | `bgmVolume`（`index.ts:295`）**无人读** | 无 → 只能改文件 |
| 台词行数上限 | `render.ts:99-104`（split→trim→`slice(0,5)`） | 无键 | 只有 placeholder 提示 5 行（`client.ts:64`）；超限**静默丢弃** |
| 字体 | `render.ts:209/227/233`（`font:'yahei'` → `vendor/dsh-video-studio/fonts.js`） | 无键 | 无 |
| ffmpeg 是否可用 | `index.ts:81-90`（**只探 `<binDir>/*.exe`，无 PATH 兜底**）→ `listAssets.toolchain` `:390-400` | `binDir`（装配口 `packages/cortico-world-media/src/index.ts:64`） | 面板药丸（`client.ts:43`、`:47-50`） |
| TTS 凭据是否就位 | `packages/cap-media-studio/src/vendor/mimo.mjs:27-37` → `describeTtsStatus`（`render.ts:88-90`） | env `MIMO_API_KEY` 或 `~/.local/share/mimocode/auth.json` | 面板只显示"可用/缺凭据"（`client.ts:44`） |

## ③ 失败与边界

- **不 exit 是成文约束**（`render.ts:4-6`），实装 `fail()` `:67-86` + 整段 try/catch/finally `:135-258`。
- **前置校验**：空台词（`index.ts:208-209`/`169-170`、`render.ts:104`）、底图不存在（`index.ts:210-211`）、
  尺寸非数（`render.ts:108`）、非法 tts 取值（`:111`）、BGM 找不到（`index.ts:215-216`、`packages/cap-media-studio/src/vendor/bgm.mjs:35`）。
- **子进程永不抛**：`packages/cap-media-studio/src/vendor/proc.mjs:4-15`（连 error 也 resolve 成 `code:-1`），由调用方判；超时分别是 300s/120s/30s/180s
  （`packages/cap-media-studio/src/vendor/video/studio.mjs:69-70`、`:82-83`、`:30`、`packages/cap-media-studio/src/vendor/tts.mjs:82-83`、`:69`）。渲染本体走 `vendor/dsh-video-studio/ffmpeg.js:127-141`
  的文件式 stdio（注释 `:119-124` 说明是为规避 EPERM）。
- **时长不是承诺值**：TTS 出来后 `need=ceil(voice+2)`，超过点定的时长会**自己涨**（封顶 60s），装不下只 warn（`render.ts:176-182`）。
- **横封面的 3 秒坑已修**：以前 `at=2.55` 时 base169 只有 0.467s → ffmpeg **exit 0 却不产文件**；现在 `at=min(d*0.85, d-1)` 留满 1 秒（`render.ts:221-225`），
  但 `makeCover` 返回的 `bytes` 仍**不校验封面是否真存在**（`:250-251`）。
- **BGM 曲库空不是错误**：`auto` 回 `file:null`（`packages/cap-media-studio/src/vendor/bgm.mjs:13`、`:31`）→ warn「曲库里没有 mp3，本次只用人声/静音」（`render.ts:152`）；没给 `bgmDir` 同样只 warn（`:146-148`）。
- **无并发防护**：`buildVideoDraft`（`index.ts:454-469`）与 `previewTts`（`:445-453`）服务端**不要求 confirm**，两次点击 = 两趟 MiMo 计费 + 两个 `vid-*` 目录；
  唯一防线是 UI 重入闸门（`packages/cortico-adapter/src/webui-helpers.ts:127`、`:131-143`）。试听的双烧已在 11-07 修掉（`webui/client.ts:81-83` 记录了原因）。

## ④ 操作面

面板（`media-studio`）：底图下拉、BGM 下拉（含 `auto`/`none`）、台词框、时长框、试听、合成——6 个控件，脏守卫已全部接上
（`webui/client.ts:28`、`:33`、`:34`、`:76-79`）。
**没有面板入口**：语音选择、音量、语速、竖屏尺寸、封面规格、`planOnly` 预演、`pushToQueue` 开关、warnings 展示、成片与封面的任何预览/跳转、
批量重跑、清理（本包**没有 `storageParts`**，产物不进宿主存储页）。
**只能改文件**：以上全部；以及 `vendor/dsh-video-studio` 的编码档位（`render.js:604` 附近）。

## ⑤ 已知缺陷与验证方式

1. **「送待放行」在部署里是空头承诺**：能力侧留了口子（`opts.onPushToBiliQueue`，`index.ts:78`；触发条件 `:266-272` 要 `params.pushToQueue && opts.onPushToBiliQueue && res.out`），
   但**装配口从不注入**（`packages/cortico-world-media/src/index.ts:58-64` 只给五个目录），**面板也不发 `pushToQueue`**（`webui/client.ts:103-108`），
   队列侧也没有能收视频文件的入口（`pending-queue.json` 唯一写点是 B 站写动作的形状，见 06）。结果：传了 `pushToQueue=true` 也只是静默不送、不报错、不记 warn。
   复现：`grep -rn "onPushToBiliQueue" packages | grep -v test`（只剩定义与读取两处）＋ `node -e "const fs=require('fs'),os=require('os'),p=require('path');console.log(JSON.parse(fs.readFileSync(p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','bilibili','pending-queue.json'),'utf8')).length+' 条待放行')"`。
2. **`configSchema` 的 9 个键一个都没被读取，而且到不了宿主**：本包没有 `getConfig`/`readConfig`/`start()`，
   出片拿到的全是 `MEDIA_DEFAULTS` 与硬编码；宿主 `WorldDefinition` 里根本没有 `configSchema` 字段（宿主 `E:/WorkSpace_Qoder/Cortico-up/src` 全文 grep `configSchema` → 0 命中）。
   复现：`grep -rn "configSchema" packages/cap-media-studio/src/index.ts`（只命中声明）＋ `grep -rn "configSchema" E:/WorkSpace_Qoder/Cortico-up/src | wc -l`。
3. **面板的「TTS 可用」说的是 key 在不在，不是钱够不够**：`describeTtsStatus` 只看 `mimoKey==='missing'`（`render.ts:88-90`、`webui/client.ts:44`），
   `httpsPost` 只在 `status>=400` 抛并截 300 字节正文，**不区分 402/412/5xx**（`packages/cap-media-studio/src/vendor/tts.mjs:46`）。MiMo 欠费期间面板仍显示"可用"，失败发生在点击之后。
   复现：`grep -n "mimoKey" packages/cap-media-studio/src/render.ts packages/cap-media-studio/src/webui/client.ts`（判据只到 key）＋ 看当日 402：`node scripts/token-anatomy.mjs --date=2026-11-06`。
4. **edge-tts 回退在部署里是死的**：`AD/index.ts:58-64` 不传 `toolsBinDir` → `index.ts:180-183`/`render.ts:170` 拿到空串 →
   `packages/cap-media-studio/src/vendor/tts.mjs:77-81` 退化成裸命令 `edge-tts`。复现：`command -v edge-tts || echo "PATH 无 edge-tts"`（本机实测无）→ 第 3 条叠加后，**欠费时出片整条 fail**。
5. **ffmpeg 查找逻辑三套口径不一致**：视觉 `packages/cap-vision/src/ffmpeg.ts:53-79`（env→PATH→…）、出片面板 `packages/cap-media-studio/src/index.ts:81-90`
   （**只探 `<binDir>/*.exe`，无 PATH 兜底**）、渲染内部 `vendor/dsh-video-studio/ffmpeg.js:96-114`（env→PATH→常见目录）。
   同一台机器可能"能出片、面板说不可用"。复现：`grep -n "FFMPEG\|PATH" packages/cap-media-studio/src/index.ts packages/cap-vision/src/ffmpeg.ts vendor/dsh-video-studio/ffmpeg.js | head -10`。
6. **`warnings` 一路不显示**：`index.ts:245`/`:262` 把 warnings 带回返回值，面板 `after` 只做 refresh（`webui/client.ts:101-110`）。
   复现：`grep -c "warnings" packages/cap-media-studio/src/webui/client.ts` → 0。
7. **草稿账本坏 JSON 会被静默当空表**：`readDraftRecords` 的 catch 直接 `return []`（`index.ts:97-104`），下一次 `saveDraftRecords`（`:106-109`）
   就把**整本历史覆盖掉**，不报错。复现：`sed -n '97,110p' packages/cap-media-studio/src/index.ts`。
8. **这条产线至今没成功产出过成片**：`<outputDir>/video-drafts.json` 不存在，`data/media/out` 下只有 `thumbs/` 与一个 `tts-preview-*.mp3`。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','media','out');console.log(fs.readdirSync(d).join(' · ')+' || video-drafts.json '+(fs.existsSync(p.join(d,'video-drafts.json'))?'在':'不在'))"`。
   离线端到端跑通需要真 ffmpeg：本仓用 `node scripts/verify-media-pipeline.mjs`（`tts=none`、临时产物、不写账、不碰配额）实测产出过 6s 成片 + 双封面。
9. **成片/双封面在面板上没有任何呈现形式**：既不出 data URL 也不注册存储单元，宿主现成的 `{ $file }`/`{ $binary }` 流式通道在本仓引用数为 0
    （通道实现在 `E:/WorkSpace_Qoder/Cortico-up/src/web/server.ts:1186-1198`、`:1211-1258`）。
    复现：`grep -rn '[$]file\|[$]binary' packages/cap-media-studio/src packages/cap-vision/src | wc -l` → 0。
10. **产物永不删除、无体积水位**：`sizeMB` 只回读展示（`render.ts:245`），草稿账 `all.push(record)` 后整本写回、没有裁剪
    （`index.ts:274-278`，对照 `packages/cap-vision/src/index.ts:162` 的 40 条上限）。
    复现：`sed -n '274,278p' packages/cap-media-studio/src/index.ts`。
11. **`portrait`/`listPrompts`/`composePrompt` 三个面板方法面板从不调用**，其中 `composePrompt` 还是 `writable: true`（`index.ts:373-377`）——有写方法、无入口。
    复现：`grep -n "portrait\|listPrompts\|composePrompt" packages/cap-media-studio/src/webui/client.ts | wc -l` → 0。
12. **磁盘残留说明历史改过两次规格**：`data/media/out/thumbs/*.420.png` 三个（旧 420 宽实现），而 `index.ts:415` 注释仍写"先缩到 420 宽"、代码已改 320（`:144`）。
    复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','media','out','thumbs');console.log(fs.readdirSync(d).filter(f=>f.includes('420')).length+' 个 420 残留')"` ＋ `grep -n "420\|320" packages/cap-media-studio/src/index.ts`。
13. **这个包不是"宿主无关"**：`packages/cap-media-studio/src/vendor/mimo.mjs:14` 与 `packages/cap-media-studio/src/vendor/media-config.mjs:6` 都以三层回跳的相对写法 import 隔壁包的 `packages/cap-bilibili/src/platform/paths.mjs`，
    那个包不在时本包模块装载即失败，与 `index.ts:2` 的声明冲突。复现：`grep -rn "packages/cap-bilibili/src/platform/paths.mjs" packages/cap-media-studio/src`。

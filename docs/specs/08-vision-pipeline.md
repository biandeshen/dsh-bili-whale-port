# 08 · 视觉管线

> 只写成立的机制；案卷在 `docs/attic/`，不作施工依据。行数按 2026-11-07 工作区核对。

## ① 现在是什么

一条本地管道，两条腿，两套账。

**管道本体**（vendor 进来的 dsh-see-now 变化分，静态 8 个文件，`packages/cap-vision/src/vendor/see-now/VENDORED.md`，版本 0.0.10、commit `a21b62d9`，零运行时依赖）：
ffmpeg 解码成 `rawvideo/rgb24` 流（`packages/cap-vision/src/frame-pipeline.ts:252-271`）→ 逐帧进 pipeline（`:283` →
`packages/cap-vision/src/vendor/see-now/pipeline.js:199`）→ 三路留帧：切点（`pipeline.js:76`）、积分（`:105`）、静默兜底（`:109`）；
近似重复在 `pipeline.js:265` 丢弃（分差 `cuts.js:62`）→ DP 装箱（`:437`）→ 拼图（`:458` → `packages/cap-vision/src/vendor/see-now/sheet.js:153`，
缝隙 1px、帧号烧字）→ PNG（`:459`）。产物命名 `<hint>-<序号2位>-<本趟ISO>.png`（`frame-pipeline.ts:359`）。
**SUBS 字幕条**是主管道跑完后串行补的一趟（`packages/cap-vision/src/index.ts:291-317` → `packages/cap-vision/src/subtitle-strip.ts:58-117`，`tile=1xN` 滤镜在 `:98`）。

**腿 A（面板看见的那条）**：工具 `see_video`（`index.ts:321-360`）/ 面板「↻ 重跑」（`:441-463`）→ `seeVideo()`（`:225-319`）
→ 落 `data/vision/sheets` + 记 `data/vision/runs.json`（上限 40 条，`:161-165`）。
**腿 B（面板看不见的这条）**：`bili_watch` / `bili_debrief(withFrames)` → `packages/cap-bilibili/src/client/bili-watch.ts:112-129`
**直接调 `analyzeVideo`**，绕开 `seeVideo`，目录是 `packages/cap-bilibili/src/index.ts:274-275` 的 `<bili dataDir>/shots/{video,sheets}`。

图怎么进面板：**只能把字节塞进 RPC 返回值**（宿主仅有 `GET /api/blob?handle=`，`E:/WorkSpace_Qoder/Cortico-up/src/web/server.ts:1709-1717`，
而 `resolveBlob` 只认 `log:`/`mem:` 两种 scheme——`src/core/core.ts:255-259`）。所以本包自己出 320 宽缩略图、base64 data URL 回传
（`packages/cap-vision/src/index.ts:191-209`），原图链接用 `URL.createObjectURL`（`packages/cap-vision/src/webui/client.ts:155-165`）。

## ② 真值在哪

配置文件应为 `~/.xiaoyu-home/xiaoyu/data/vision/config.json`（路径 `index.ts:133`，读 `:139-146`，写 `:147-152`）——
**部署里这个文件不存在**（实测 `data/vision/` 只有 `runs.json`、`sheets` 和一个双重嵌套遗留的 `vision/`），所以今天全部跑 `VISION_DEFAULTS`（`index.ts:45-52`）。

| 参数 | 定义与执行点 | 配置键 | 面板控件 |
|---|---|---|---|
| `targetFrames` | `index.ts:46`（48）→ `:274` → `frame-pipeline.ts:214` → `tuneForDuration` `:179-194` | `targetFrames` | 滑块 `webui/client.ts:66`（8–240） |
| `dupMin`（去重地板） | `index.ts:51`（12）→ `:277` → `frame-pipeline.ts:218`（钳 0–255）→ 上游默认 8（`pipeline.js:121`） | `dupMin` | 滑块 `:67` |
| `keepDays` | `index.ts:50`（14）→ `:424`（`cleanupSheets`） | `keepDays` | 滑块 `:68` |
| `fps`（解码采样率） | `index.ts:47`（2）→ `frame-pipeline.ts:208` → ffmpeg `-vf fps=` `:258` | `fps`（在 `setTuning` 白名单 `:390`） | **无 → 只能改文件或手发 RPC** |
| `maxSheets` | `index.ts:48`（12）→ `frame-pipeline.ts:210` → 早停 `:290-299` | `maxSheets` | **无 → 只能改文件** |
| `timeoutSec` | `index.ts:49`（240）→ `:211` → killTimer `:309-316` | `timeoutSec` | **无 → 只能改文件** |
| 拼图 `width/height` | `frame-pipeline.ts:206-207`（800×450）；`seeVideo` 从不传（`index.ts:269-280`） | 无键 | 无 → 只能改文件 |
| `maxFrames`（每图几帧） | `frame-pipeline.ts:209`（12）；`index.ts:217` 有一份**过期副本** | 无键 | 无 |
| SUBS 带宽/宽/行数 | `subtitle-strip.ts:66-68`（0.17 / 1280 / 9）；取样 `index.ts:293` | 无键 | 无（面板只显示「字幕条 N 条」`client.ts:101`） |
| 切点地板 `cutAbs` | `packages/cap-vision/src/vendor/see-now/pipeline.js:76` | 无键、本包无传参入口 | 无 |

## ③ 失败与边界

- **不抛不 exit 是成文约束**（`index.ts:13-15`），实装 `failStub` `:220-223` 与 `frame-pipeline.ts:224-234`。
- **ffmpeg 找不到**：查找链 `packages/cap-vision/src/ffmpeg.ts:53-79`（env → PATH → `repoBinDir`（调用方从不传，`index.ts:168-169`）→ `~/.dsh/bili-whale/bin` → 剪映）；
  走法四种同时存在：开机 warn（`index.ts:513-518`）、工具结构化 fail（`:263-266`，含三条修法与 `tried`）、快照 `ffmpeg.available`（`:371`）、
  面板黄条 +「找过：…」（`client.ts:50-55`）。本机实测命中 `~/.dsh/bili-whale/bin/ffmpeg.exe`。
- **失败即丢已出的图**：spawn 抛错（`frame-pipeline.ts:324`）、非零退出（`:331-333`）、finish 抛错（`:341`）三处都回 `sheets: []`；
  与之相反，`maxSheets` 早停（`:292-299`）与超时 SIGKILL（`:309-316`）走"正常收尾 + `truncatedBy`"，已出的照样交。
- **腿 B 是降级不是失败**：`bili-watch.ts:114-118`、`:130-132` 回 `ok:true + degraded`。
- **缩略图单独 fail**：`index.ts:196` → `:206` → 面板把 `<img>` 摘掉换成文件名（`client.ts:146-149`），**不摆裂图**。
- **本包不碰网络**（`index.ts:259` 明写），412/风控全在 B 站侧（见 05/06）。
- **并发没有锁**：同一 file 并发两次＝两趟完整解码（各自时间戳文件名，`frame-pipeline.ts:359`，不互相覆盖），
  但缩略图按 basename 派生（`index.ts:193`）**会撞**，且 `:194` 的 mtime 比较可能读到对方半写的 png。

## ④ 操作面

面板能改：三个滑块（`targetFrames`/`dupMin`/`keepDays`）+「保存」（`client.ts:75-80`）、「↻ 重跑」（带 confirm，`:103-112`）、
「清理」勾选框 + 按钮（`:179-183`）、存储单元 `vision.config`/`vision.sheets`(danger)/`vision.runs`（`index.ts:475-499` → 宿主存储页）。
**只能改文件**：`fps`、`maxSheets`、`timeoutSec`、拼图宽高、`maxFrames`、SUBS 三个规格、`cutAbs`。
**没有入口**：`listSheets`（`index.ts:398-405` 存在但面板从不调）、`vision.runs` 无 `clear`。

## ⑤ 已知缺陷与验证方式

1. **「重跑」不读页面上没保存的滑块**：`rerun` → `seeVideo({file})`（`index.ts:449`）→ 读 `config.json`（`:226`），
   注释 `:434-437` 却写"调完参数立刻重跑就能看到"。不先点保存就是旧参数。复现：`sed -n '441,452p' packages/cap-vision/src/index.ts`（看 `seeVideo({ file: abs })` 只有 file）。
2. **面板只覆盖 6 个可配键中的 3 个**：`fps`/`maxSheets`/`timeoutSec` 有配置键但无控件。复现：`node scripts/audit-controls.mjs` ＋ `grep -n "sliderField\|保存" packages/cap-vision/src/webui/client.ts`。
3. **腿 B 没有 runs、没有字幕条、`dupMin` 还回落到上游 8**：`bili-watch.ts:112-129` 不传 `dupMin`（默认 12 那份在 `seeVideo` 里）。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','bilibili','shots');console.log(fs.existsSync(d)?'在':'不在（这条腿至今没落过盘）：'+d)"`。
4. **SUBS 字幕条不受 `timeoutSec` 保护**：它在主管道之后串行跑，每时间点起一个 ffmpeg（`subtitle-strip.ts:73-81`），
   而它的 `runFfmpeg`（`:120-128`）**没有任何超时**——一条卡住的抽帧能把整趟 `see_video` 拖过预算。复现：`grep -n "kill\|timeout" packages/cap-vision/src/subtitle-strip.ts` → 无命中。
5. **失败回执里的 `tuning` 是启动那一刻的快照**：`cfg0`/`baseTuning` 在 `createVisionCapability()` 里只算一次
   （`index.ts:215-218`，里面还写死 `width:800/height:450/maxFrames:12`），`failStub` 直接拿它当本次调参（`:220-223`）；
   成功路径的 tuning 才是现读 + 按片长配平（`frame-pipeline.ts:179-194`）。改完配置后若这一趟失败，回执显示的还是启动时的值。
   复现：`sed -n '215,223p' packages/cap-vision/src/index.ts`。
6. **写盘全线无 try/catch**：`index.ts:150`（config）、`index.ts:164`（runs）、`frame-pipeline.ts:360`（png），
   ENOSPC/EACCES 会以 rejected promise 逃到 HTTP 层（宿主 `web/server.ts:2380-2387` 返 500），面板只显示一句消息行
   （`packages/cortico-adapter/src/webui-helpers.ts:84-86`）。复现：`grep -n "writeFileSync" packages/cap-vision/src/index.ts packages/cap-vision/src/frame-pipeline.ts`。
7. **缩略图目录不在任何账上、清理删不到**：`listSheetFiles` 用非递归 `readdirSync`（`index.ts:172-182`），
   `cleanupSheets`（`:427`）与存储清理（`:488-492`）都碰不到 `sheets/thumbs`。实测部署里 19 个缩略图从未被清。
   复现：`node -e "const fs=require('fs'),os=require('os'),p=require('path');const d=p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','vision','sheets','thumbs');console.log(fs.existsSync(d)?fs.readdirSync(d).length+' 个缩略图':d+' 不存在')"`。
8. **没有体积水位**：只有数量预算（`maxSheets`/`timeoutSec`）与缩略图宽度 320；`runs.json` 只截条数不截体积（`index.ts:162`）。
   实测 `data/vision/sheets` 43MB + 缩略图 1.8MB。复现：`du -sh ~/.xiaoyu-home/xiaoyu/data/vision 2>/dev/null || node -e "const fs=require('fs'),p=require('path'),os=require('os');const walk=d=>fs.readdirSync(d,{withFileTypes:true}).reduce((a,e)=>a+(e.isDirectory()?walk(p.join(d,e.name)):fs.statSync(p.join(d,e.name)).size),0);console.log(Math.round(walk(p.join(os.homedir(),'.xiaoyu-home','xiaoyu','data','vision'))/1048576)+' MB')"`.
9. **脏守卫对滑块靠 getter shim，`isConnected` 剔除逻辑对它们永不生效**：`webui/client.ts:70-74` 把 `sliderField` 的 `{el,get}` 包成 `{get value(){...}}`，
   而 `webui-helpers.ts:264` 靠 `el.isConnected` 摘控件——shim 上没有这个字段。整块重建式面板下无害，改成按 id 局部重画就会永久拦刷新。
   复现：`grep -n "isConnected" packages/cortico-adapter/src/webui-helpers.ts packages/cap-vision/src/webui/client.ts`。
10. **漏登记的控件**：清理确认勾选框（`client.ts:179`）未进 `guard.watch`（API 本身只支持 `{value}`，不支持 `checked`，见 10）。
    复现：`grep -n "watch(" packages/cap-vision/src/webui/client.ts`（只有滑块那三行）。
11. **成本面在视觉这一侧是外溢的**：`mood_apply` 回灌占当日成本 8.7%（见 04 的第 1 条同款算法），
    但那是她主动调用工具的结果，`cap-vision` 内**没有**任何自动写场值或写 core 的代码。
    复现：`node scripts/token-anatomy.mjs --date=2026-11-06` ＋ `grep -rn "mood_apply" packages/cap-vision/src | wc -l`（0）。

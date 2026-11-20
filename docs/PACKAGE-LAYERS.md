# packages 分层（#90 · 2026-11-19）

## 现在的四层

```
packages/
  kernel/        人格内核
    persona-core/          唯一一份。节奏、记忆、情绪、检索、命名、衰减、因果链。
  capabilities/  业务域能力包（自带 store + context/event + tools + panel 四件套）
    cap-state-rhythm/      状态与作息（mood/life_do）
    cap-memory/            四层记忆卡（含 git 备份）
    cap-journal/           两本日记、判断卡、意见箱
    cap-vision/            看画面（变化分管道）
    cap-media-studio/      音视频创作（V1 素材管线、TTS）
    cap-bilibili/          B 站整域（16 把工具 + 4 个操作台）
  adapters/      往宿主/渠道挂的薄转接头
    cortico-adapter/       宿主契约的最小形状（ToolDef/PanelDecl 转换、读去重、日志口）
    cortico-bot-xiaoyu/    她这个人格在 Cortico 里的 BotDefinition（api:7）
    cortico-world-bilibili/ B 站 World（api:6）
    cortico-world-media/    音视频 World
  shared/        跨包工具（不认识任何人格/业务概念）
    fs-atomic/             原子写盘（改名重试）
    write-dedupe/          写工具幂等键
    webui-helpers/         浏览器面板共享控件（只依赖宿主 ui 契约）
host/cortico/    底座的独立克隆（自带 .git，不在本仓版本控制里），有独立依赖树
```

## 依赖方向（`scripts/check-layer-contract.mjs` 强制）

| 层 | 可以认识 | 不许认识 | 理由 |
|---|---|---|---|
| `shared/` | 只有 Node 标准库 | **任何包** | 被所有层用；反向依赖立刻成环 |
| `kernel/` | `shared/`、自身 | `capabilities/`、`adapters/` | 内核认识业务域 = 换世界观要改内核 |
| `capabilities/` | `kernel/`、`shared/`、**同层** | `adapters/` | 能力包宿主无关；认识转接头就绑死某个宿主 |
| `adapters/` | 全部 | — | 它就是干装配的 |

同层互认是有意的：`cap-journal → cap-memory`（日记要读记忆卡的 git 实例）。
另有一条铁律单独钉在门禁里：**`cap-*` 不许 `import 'cortico/*'`**。

## 搬家时发现的四件事（都改了，不是"以后再说"）

1. **`webui-helpers.ts` 放错层了**。它原来在 `cortico-adapter/src/`，但四个能力包的浏览器面板
   都在 import 它——而它只依赖宿主 ui 契约、不 import 任何 Node 模块。放 adapter 层是位置错，
   分层门禁一跑就报 18 处违规。已挪到 `shared/webui-helpers/`。
2. **`atomic-write` / `write-dedupe` 不属人格内核**。persona-core 自己不用它们，
   是 cap-* 共用的落盘工具。已挪到 `shared/`。
3. **门禁脚本假定 `packages/*` 平铺**。`build-webui`、`audit-controls`、`check-live-drift`、
   `audit-config-migration`、`audit-state-locations` 五处按一层 readdir 枚举包。
   分层后它们会**安静地扫到零个包并报通过**——比报错更危险。全部改成按层枚举（同时容忍旧平铺布局）。
4. **`tools/` 下 11 处 import 没跟着搬**。它们不在 `packages/` 内，第一轮迁移器没覆盖；
   测试跑了才发现（`cap-media-studio` 的 vendor 路径连锁失效）。
   `scripts/find-broken-relative.mjs` 就是为这个写的：搬家后拿它扫一遍，找"字面相对路径指向不存在的文件"。

## 怎么验证

```bash
node scripts/check-layer-contract.mjs      # 分层契约（四层方向 + cap-* 不认 cortico/*）
node scripts/check-layer-contract.mjs --json  # 依赖边全量清单
node scripts/find-broken-relative.mjs      # 搬家后扫一遍断裂字面路径
node scripts/run-mjs-tests.mjs             # 167 文件 / 957 用例
```

`check-layer-contract` 做过变异测试：往 `kernel/persona-core/src/naming.ts` 注入一条指向
`capabilities/cap-bilibili` 的跨层 import → 退出码 1 并指出
"kernel/ 不许依赖 capabilities/（允许：shared）"；移除即 0。

## 没做的（留给后续）

- **没建独立 npm 包**。所有包名（`@xiaoyu/persona-core` 等）不变，包的 `package.json`
  仍靠 workspace glob 解析；没拆成可发布的独立包，也没改 `exports` 之外的元数据。
- **`host/cortico` 未并入本 workspace**（它有自己的依赖树）。
  （2026-11-21 更正：底座是**独立 git 克隆**，`host/` 整棵在 `.gitignore` 里，不进本仓；
  我们只往里放一个 `extensions/package.json`，那是每台机器的部署产物。）
- **没有 typecheck**。本仓仍无 tsconfig / tsc；分层契约是运行期字符串扫描，
  能抓跨层 import，抓不到"类型对不上"。

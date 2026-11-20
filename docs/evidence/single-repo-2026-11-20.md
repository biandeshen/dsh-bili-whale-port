# 单仓完成（2026-11-20）

## 现在只有一个目录

```
E:\WorkSpace_Qoder\dsh-bili-whale\        ← 整个项目就这一个
├── packages/            我们写的（kernel / capabilities / adapters / shared）
├── host/cortico/        底座（纯上游镜像），自带 node_modules
│    └── extensions/     运行时生成：四个扩展用相对路径连到 packages/adapters/
├── scripts/  tools/  docs/  tests/
└── .env                 CORTICO_ROOT=<仓>/host/cortico
```

外面的 `Cortico` 与 `Cortico-up` **已删除**。

## 怎么验证的（不是"看路径"，是真跑）

| 检查 | 结果 |
|---|---|
| `hostRoot()` 解析 | `E:\WorkSpace_Qoder\dsh-bili-whale\host\cortico` |
| 四个扩展在 host 里加载 | `xiaoyu` / `bili-account` / `media-studio` / `console-image` 全 OK |
| 宿主自己的干装载 | `tsx scripts/extension-describe.ts` → **tools 13, events 0, prompts 2** |
| 宿主入口可运行 | `node bin/cortico.mjs` 能起，自动构建 WebUI（主包 1493.9 KiB） |
| 本仓测试 | **982 用例全绿** |
| 静态门禁 | **8 个全 0** |

## ⚠ 删除时踩的坑（必须记下来）

**用 `rm -rf` 删一个"里面有符号链接指向自己仓"的目录，会**穿透链接**把真实文件删掉。**

具体经过：`host/cortico/extensions/node_modules/cortico-*` 是指向
`packages/adapters/cortico-*` 的符号链接（pnpm 的 link:）。
删 `Cortico` 时，它自己的 `extensions/node_modules/` 里也有指向同样位置的链接——
`rm -rf` 顺着链接进去，把本仓 `packages/adapters/` 下 **47 个文件删了**。

发现与恢复：`git status` 显示 47 条 ` D`，立刻 `git checkout -- packages/adapters/` 全量恢复，
工作树回到干净，982 用例复跑全绿。

**以后删含链接的目录，先摘链接再删**：

```bash
# 做法一：先删链接本身（不跟随）
find <dir> -type l -delete
# 做法二：用不跟随链接的工具；Windows 上确认没有 junction
cmd /c "dir /AL /S <dir>"
```

**这次能恢复是因为那些文件都在 git 里。** 如果删的是未跟踪的数据，就是真丢了。

## 现在怎么更新底座

底座是我们的仓里一份纯上游代码，不跟上游自动同步。要更新：

```bash
# 拿到上游某版本后，重新导入
git subtree pull --prefix=host/cortico <上游克隆> <ref>
```

或者直接覆盖 `host/cortico/` 的非 `extensions/` `node_modules/` 目录。

**注意**：`host/cortico` 里的代码我们**不许改**——改了就回到魔改版，`git pull` 会冲突。
需要补的能力一律做成 `packages/` 里的能力包 + `adapters/` 里的转接头。

## 备份（删掉的两棵树里的本机数据）

```
E:\WorkSpace_Qoder\_backups\
├── Cortico-deployments-full-20261120.tar.gz    8.0M  旧 mybot 部署 + 市场索引
├── Cortico-deployments-mybot-20261120.tar.gz   7.9M  同上（早期单独备份）
└── Cortico-up-extensions-package.json.bak-pre-layering-20261119
```

那两棵树里的 git 历史全部已在 `host/cortico` 里（`git log` 可见），不需要额外备份。

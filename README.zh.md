# dsh-utils

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）实用插件集合：
一个 pnpm workspace，`plugins/` 下每个目录都是一个可独立安装的插件包，
`tools/` 是共享的验证工具链——新增插件即插即用。

## 插件清单

| 插件 | 版本 | 功能 | 安装（独立仓库） |
|---|---|---|---|
| [rewind](plugins/rewind/) | 0.1.1 | `/rewind`：把会话的**模型上下文**回退到更早位置（append-only surface 替换，compaction 同款通道）；命令 + 撤销选择器 + 每轮回退按钮 | `dsh plugin --profile <n> add github:ZaiMaxvx/dsh-rewind` |
| [btw](plugins/btw/) | 0.1.0 | `/btw`：**即时侧问**——基于当前上下文的轻量单轮作答，禁工具、不进主历史；右侧边栏 BTW 面板（历史 + 内联提问） | `dsh plugin --profile <n> add github:ZaiMaxvx/dsh-btw` |

两个插件均基于 dsh **v0.2.2-rc.1 / rc.2** 构建并双版本验证（`engines.dsh: >=0.2.2-rc.1 <0.3.0`，Node ≥ 24.9）。

所有插件的可安装产物已**预构建并提交**在各插件 `lib/` 目录（host + client 两半），git / 路径 / tarball / registry 安装均**零构建授权**——修复了 0.1.x 安装后 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`（Node 拒载 node_modules 内 TS）的问题。

### 从本仓库安装（path 安装）

每个插件都是带 `dsh.bundle` 声明的独立包，可按路径安装：

```sh
dsh plugin --profile <name> add 'github:ZaiMaxvx/dsh-utils#path:/plugins/rewind'
dsh plugin --profile <name> add 'github:ZaiMaxvx/dsh-utils#path:/plugins/btw'
```

独立仓库（上表）仍是各插件的一等发布渠道；本仓库是它们的**共同开发主场**。

## 布局

```
plugins/
  rewind/            /rewind 上下文回退插件（host /rewind 命令 + client 每轮按钮/选择器）
  btw/               /btw 侧问插件（host 命令+投影 + client 右栏面板）
tools/               共享验证工具链（源树解析 / paths 生成 / 双面检查 / 冒烟包装）
docs/research/       14 篇设计调研笔记（架构/插件系统/持久化/生命周期/UI/样例 + rc2 diff + btw 六篇）
```

## 开发与验证（无需安装 dsh 工作区）

前置：把 [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) 源码克隆到本仓库**旁边**并命名/链接为 `dsh-source`
（或设 `DSH_SRC` 指向任意 dsh 源树，如 `DSH_SRC=dsh-source-rc2`）；然后：

```sh
npm install                 # 仓库根（安装 typescript/vitest/tsx 等验证依赖）
npm run check               # 全部插件 × host/client 两个编译面的 tsc --noEmit
npm test                    # 全部插件的冒烟（tsx + source-plane 解析钩子）+ vitest

# 单插件
npm run check -- btw        # 或 rewind
npm test -- btw
```

`npm run check` 对各插件自身源码报告 **0 错误**；程序可能额外暴露 dsh 自带 vendored
源码内部的严格性噪音（zod/schemastery/react 版本与仓库锁定依赖的偏差），在 dsh
自身构建中不会出现。

快速试用某插件的 host 半（TS 直跑，Node ≥ 24.9）：

```sh
pnpm dsh web --patch /abs/path/to/dsh-utils/plugins/<plugin>/dev.patch.yml
```

## 新增一个插件

1. 复制任一现有插件目录到 `plugins/<name>/`，改 `package.json`（name/description/`dsh.bundle.patch`/`dsh.client`/`engines.dsh`）与 `cordis.patch.yml`
2. `package.json` 的 scripts 已指向共享 `../../tools/`，无需自带工具链
3. `npm run check -- <name> && npm test -- <name>` 即完成与 dsh 源码的对照验证
4. 调研笔记放 `docs/research/`，按 `<主题>-<名称>.md` 命名

## 设计文档

全部调研与设计笔记在 [`docs/research/`](docs/research/)：dsh 架构六篇、rc.1→rc.2 API
diff 两篇、/btw 六篇（含 Claude Code `/btw` 语义考证）。

许可：MIT（各插件包内无单独 LICENSE 时随本仓库 LICENSE）。

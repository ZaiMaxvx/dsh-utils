# dsh-plugin-rewind（回退插件）

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）`v0.2.2-rc.1`
打造的回退插件：把会话的**模型上下文**恢复到更早的位置——提供 `/rewind`
斜杠命令、裸调用的撤销选择器、以及 Web 聊天中每一轮的回退按钮。

回退**不删除、不改写任何历史**。dsh 的会话日志是仅追加的；模型可见历史是
从日志折叠出的投影（surface）。本插件追加一次 *surface 替换*——与 compaction
使用的 `surfaceOp: { op: 'replace' }` 同一通道（surface 契约明文允许任何生产者
使用）——把所选边界之后的所有存活节点遮蔽到一条简短的标记消息后面。模型
上下文回到该时刻；人类 transcript 保留全部内容（回退本身也作为一个新"世代"
落进日志，可审计、可跨重启）。

```
回退前:  [system] [user1] [user2] [assistant2] [user3] [assistant3]
/rewind to（user2 的 seq - 1）
回退后:  [system] [user1] [rewind 标记]        ← 模型上下文
         （user2…assistant3 仍留在日志与 transcript 中）
```

## 功能一览

| 界面 | 入口 | 效果 |
|---|---|---|
| Web 聊天每轮尾部 | **重试本轮** / **回退到这里** 按钮 | 重试：丢弃本轮及之后（重新措辞提问）；回退到这里：保留本轮、丢弃其后全部。智能体运行时按钮禁用。 |
| Web 输入框 `/rewind` | 裸调用弹出**撤销选择器**（最近 1–5 轮） | 经命令通道提交 `/rewind <n>`。 |
| 任意界面（Web/SDK/无 UI） | `/rewind <n>` | 撤销最近 n 轮。 |
| 任意界面 | `/rewind turn <k>` | 从第 k 轮起全部撤销。 |
| 任意界面 | `/rewind to <seq>` | 保留到事件 seq 为止的上下文（按钮提交的就是它）。 |
| 任意界面 | `/rewind` | 打印用法。 |

安全护栏：

- 回退在 `agent.runMaintenance` 内执行，只在轮与轮之间生效；智能体运行中会
  明确报错，绝不竞态。
- surface 头节点（node 0，系统提示）永不被遮蔽。
- `maxUndoTurns`（默认 20）限制 `/rewind <n>` 的上限。
- 同一会话内回退是单向的（surface 世代只前进）。要硬隔离出一个新会话，请用
  内置 **branch** 按钮——两者互补。

## 目录结构

```
src/index.ts            host 半：/rewind 命令（语法、轮次定位、维护期提交）
src/rewind.ts           提交：一次仅追加的 surface 替换（标记 + 遮蔽区间）
src/planner.ts          纯边界计算（对存活 surface seq，零依赖）
src/types.ts            `rewind` 消息来源合并（MessageSourceMap）
src/client/index.ts     浏览器半：选择器装饰 + turnTail 槽位条目
src/client/TurnTailRewind.tsx  轮尾两个动作按钮
tests/                  vitest 用例（纯 planner + 真实 Session 集成）
scripts/                免安装 dsh 工作区的本地验证
cordis.patch.yml        本组合包贡献的 bundle 层
```

## 安装

需要 dsh ≥ 0.2.2-rc.1（Node ≥ 24.9）。已同时验证 dsh
v0.2.2-rc.1 **与** v0.2.2-rc.2 —— rc.2 的 host/client API 对比未发现影响本插件的破坏性变化（见
`docs/research/rc2-*-diff.md`）。

```sh
# tarball / npm
dsh plugin --profile <name> add dsh-plugin-rewind
# git 源（安装时运行 prepare 构建；按提示放行）
dsh plugin --profile <name> add github:<you>/dsh-plugin-rewind
```

可安装产物已**预构建并提交**在 `lib/`（`main`/`exports` 指向它；由
`tools/build.mjs` 生成——esbuild host 包 + `window.__ModuleLoader__`
client 脚本）。git / 路径 / tarball / registry 四种安装均**零构建授权**；
改源码后用 `npm run build` 重建。

## 开发

在 dsh 源码检出处快速试用（host 半直接以 TypeScript 加载——Node ≥ 24.9
原生 type-stripping）：

```sh
# 在 dsh 仓库内
pnpm dsh web --patch /绝对路径/rewind-plugin/dev.patch.yml
```

两半产物均已预构建在 `lib/`（浏览器半为 `window.__ModuleLoader__` 注册脚本），
改源码后 `npm run build` 重建。

### 验证（无需安装 dsh 工作区）

```sh
npm test       # 真实 Session 冒烟（tsx + source-plane 解析钩子）+ planner vitest
npm run check  # 对 dsh 源码做两个编译面的 tsc --noEmit
```

`npm run check` 对本包文件报告 **0 错误**；检查程序可能额外暴露 dsh 自带
vendored 源码内部的严格性噪音（zod/schemastery/react 版本与仓库锁定
node_modules 的偏差），这些在仓库自身构建中不会出现。

`tests/rewind-session.spec.ts` 也可放进 dsh 工作区运行（拷贝到
`packages/rewind/` 下，由仓库 vitest 配置解析 `@deepseek-ai/*` source plane）。

## 配置

经 `cordis.patch.yml` 覆盖：

```yaml
- id: rewind
  name: dsh-plugin-rewind
  config:
    markerText: '[已回退：其后 {count} 条消息已移出上下文]'
    maxUndoTurns: 20
```

`{count}` 展开为被遮蔽的 surface 条目数。

## 设计说明

- **为什么用 surface 替换而不是 fork？** fork（内置 branch）是隔离：新会话
  id + 前缀副本。回退是*原地*的：同一会话保留身份、排队收件箱、标题与
  工作区，模型上下文回滚。dsh UI 已预留世代起源 `'rewind'`
  （`ConversationContextOriginKind`）——本插件正是该形态的一个生产者。
- **标记消息**：替换事件是 `user/message`，source 为
  `{ kind: 'rewind', maskedCount, keepThroughSeq }`（经声明合并进入
  `MessageSourceMap`），每次回退在日志与 transcript 中可见、可查询。
- **轮次边界**来自 `ctx.sessionQuery.filterEvents(... 'turn/start')`——公开
  查询面，绝不使用已废弃的同步读。

许可：MIT。

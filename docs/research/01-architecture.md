# 调研笔记 #1：deepseek-harness (dsh) v0.2.2-rc.1 整体架构

> 源码：`D:/Code/Projects/dsh-utils/dsh-source/src`（GitHub deepseek-ai/deepseek-harness，tag `dsh-v0.2.2-rc.1`，pnpm monorepo）。
> 本文所有路径均相对该根目录。调研日期：2026-11-11。

## 1. 仓库顶层结构

```
dsh-source/src/
├── apps/                      # 可执行应用（5 个）
│   ├── cli/                   # @deepseek-ai/dsh —— 唯一 Node 应用启动器（bin: dsh）
│   ├── desktop/               # @deepseek-ai/dsh-desktop —— Electron 桌面壳
│   ├── desktop-host/          # @deepseek-ai/dsh-desktop-host —— Electron 私有 Host（Node 模式子进程入口）
│   ├── web/                   # @deepseek-ai/dsh-web-frontend —— 浏览器 SPA 前端（Vite 构建）
│   └── plugin-market-generator/  # 独立 Node 程序：生成插件市场 index.json（非 Cordis 应用）
├── packages/                  # 50 个分组、约 250+ 个 @deepseek-ai/dsh-* 包
├── docs/                      # architecture.md、module-graph.md、glossary.md、cordis-primer.md、
│                              # cordis-api/、subsystems/、cookbook/、persistence-catalog.md 等
├── vendor/                    # vendored Cordis 框架源码（packages 里以 @deepseek-ai/cordis workspace 引用）
├── python/                    # Python SDK（同协议的 Python 客户端 + 打包的运行时 wheel）
├── native/  scripts/  benchmarks/  snapshots/  website/  patches/
```

`apps/cli`（`apps/cli/README.md`）是"唯一受支持的 Node 应用启动器"：`dsh <profile>` 启动命名 profile；SDK（`sdk`、`sdk-minimal`）与 ACP（`acp`）都是 profile 而非独立可执行文件。`verify-application-entrypoints` 脚本强制任何 Node 应用路径都必须经过 `dsh`。

### packages/ 分组职责（`packages/README.md` + `docs/module-graph.md`）

核心分组（与 rewind 最相关者加粗）：

| 分组 | 职责 |
|---|---|
| **`core/`** | 产品 API 脊柱：**session**（append-only 事件日志，`ctx.sessions`）、system-prompt、**tools**（`ctx.tools`）、**agent**（`Agent` 接口 + 注册表 + `agent/*` 事件，`ctx.agents`）、**agent-loop**（默认驱动，`ctx.agentLoop`）、scope（按 agent 的 scoped 注册原语）、tool-executor-native/ptc |
| `llm/` | LLM 适配器 seam（`ctx.llm`）+ deepseek/pi-ai 适配器 + llm-retry + token-meter |
| `api/` | 远程 BFF 装配与 Typert RPC 网关（session-controller、workspace-controller、gateway、remotes 等） |
| `typert/` | 类型图生成/加载/运行时注册表（生成 `ctx.remote.*` 的类型化 RPC 面） |
| `client/` | Web GUI 浏览器半边：connection、**modules**（浏览器插件加载）、store、几十个 `client-ui-*` 插件 |
| `host/` | Web GUI 宿主半边：**webserver**（`ctx.webServer`）、frontend-static（SPA 静态服务）、目录选择器、插件清单 |
| `boot/` | app-boot（profile 组合）、cmdline、**hmr**、**plugin-manager**、plugin-market |
| `bundle/` | 可安装的 profile patch 层：base、web-app、headless、sdk-app、sdk-minimal、acp-app |
| `extensions/` | agent 运行时自我修改：tool-cordis、**cordis-host-runner**（Host 半动态插件）、cordis-client-runner（浏览器半）、ui-cordis |
| `session/` | 持久化 seam + JSONL 后端 + **session-projection**（`ctx.sessionProjections`）+ 标题/统计/turn-outline |
| `session-query/` | 会话检索（逻辑语料、SQLite 全文搜索） |
| `sdk/` | 进程外 SDK：protocol（JSON-RPC 线协议）、client（TS 客户端）、server（`dsh-sdk-jsonrpc-server` 插件） |
| `subagent/` | 子代理 provider 注册表 + 委派工具（fork-in-process、spawn-in-process、acp、claude-code、codex、dsh-sdk） |
| `interaction/` | 审批/用户提问/命令（`ctx.commands`）/权限预设 |
| `fs/ shell/ subprocess/ sandbox/ ssh/ terminal/` | 能力 seam 族：文件系统、shell、子进程、沙箱、SSH、PTY |
| `compaction/` | 上下文压缩（basic、image-offload、tool-result-pruner） |
| `experimental/` | 实验性包（agent-team、inspector、liveshare、ralph、session-search 等） |
| 其余 | goal、schedule、jobs、workflow、web、skill、mcp、acp、settings、credentials、storage、workspace、preset、plan、todo、guard、deliverables、context、spill、ptc-runtime、browser-use、computer-use、lsp、attachment、feedback、telemetry、identity、document、test-support、util |

依赖规则（`packages/README.md`）："扩展插件依赖 Service Definition，绝不依赖具体 Provider"；`dsh-agent-loop` 可替换，UI/hook/tool 插件只用 `dsh-agent`。

## 2. Cordis 框架角色（`docs/cordis-primer.md`、`docs/cordis-api/`）

Cordis（vendored 于 `vendor/`，论文 *A Programming Paradigm for Spatiotemporal Composability*）是 dsh 之下的插件框架。五个核心观念：

1. **插件即 Service 对象**：函数 + 可选 `inject` 与 `apply(ctx)`，或 `Service` 子类；由 Cordis 挂载进当前 context。
2. **context 是服务仓库**：服务认领稳定的 `ctx.<key>`（`ctx.tools`、`ctx.llm`、`ctx.sessions`…），其他插件按键查找而非 import 实现。
3. **`inject` 声明依赖**：命名了所需服务的插件会等到服务存在才加载 —— 加载顺序由服务需求表达。
4. **类型化事件**：TS declaration merging 声明事件，按语义选派发模式：
   | 模式 | 等待 | 顺序 | 返回值 |
   |---|---|---|---|
   | `emit` | 否 | 注册序 | 无 |
   | `waterfall` | 否 | 注册序（around 中间件，须 `next()`） | 有 |
   | `parallel` | 是 | 并行 | 无 |
   | `serial` | 是 | 注册序 | 有 |
   | `bail` | 否 | 注册序直到 bail | 有 |
5. **注册即可逆效果**：工具 schema、prompt section、监听器都经 `ctx.effect()`/`ctx.on()` 安装，插件卸载时按序回滚。

"everything is a plugin"：模型适配器、工具注册表、会话日志、agent loop 本身都是插件，无特权核心可打补丁 —— 扩展 = 在旁边挂一个插件，从配置即可替换。`docs/cordis-api/`（context/events/fiber/registry/service）是框架继承 API 的生成文档。

### Profile 与 Bundle（`docs/architecture.md` §Profiles）

- **profile**：Harness home（`$DSH_HOME/profiles/<name>`）里的命名组合，列出其 bundle 栈 + 自带 out-of-tree 插件 + 用户 `cordis.patch.yml`。模板：`web`、`headless`、`sdk`、`sdk-minimal`、`acp`（`desktop` 保留给 Electron）。
- **bundle**：Cordis 配置行 + 其挂载代码的分发格式（`package.json` 的 `dsh` 字段：`dsh.profile` 列 bundle；`dsh.bundle` 指向 patch 文件）。
- 层序（自空表组合）：profile 的有序 bundle → profile `cordis.patch.yml` → home patch → `--patch` 覆盖。`dsh --profile web --dump-config` 可打印完整树。
- `dsh-base` 是 web/headless/sdk/acp 的公共首层（模型适配器、工具、持久化、沙箱与审批、settings、凭据、遥测 + Plugin Manager）；`dsh-web-app` 加浏览器应用。
- YAML 控制 HMR：base 开 config-only HMR；headless/SDK/ACP 关闭。HMR（`packages/boot/hmr`）`reconcileProfile()` 可热重载配置与已变更的插件模块。

## 3. 进程 / 运行时模型：谁在哪运行、插件在哪跑

### 3.1 总图（Web 部署 `dsh web`）

```
┌────────────────────────── Node "Host" 进程（dsh --profile web）──────────────────────────┐
│  Cordis Loader 按 profile 组合树挂载全部 Host 插件（dsh-base + dsh-web-app + 用户插件）      │
│  ┌────────────┐ ┌────────────┐ ┌───────────┐ ┌──────────────┐ ┌────────────────────┐   │
│  │ agent-loop │→│ dsh-session│→│ persistence│ │ api/* 控制器  │ │ host-webserver      │   │
│  │ (ctx.agentLoop)│ │(ctx.sessions)│ │(JSONL 日志)│ │+api-gateway   │ │(ctx.webServer)      │   │
│  └────────────┘ └────────────┘ └───────────┘ └──────────────┘ └────────────────────┘   │
│        │              │                          ↑ Typert RPC      ↑ /api 桥 + WS 升级   │
│        ↓ ctx.llm      ↓ session/event（进程内 emit）│ 生成 remote 面    │ 静态 SPA + /plugins │
└────────┼──────────────┼──────────────────────────┼─────────────────┼─────────────────────┘
         │ HTTP/流式     │                          │                 │
┌────────┼──────────────┼──────────────────────────┼─────────────────┼─────────────────────┐
│        ↓              ↓                          ↓                 ↓   浏览器 "Client"   │
│  LLM 提供商      ┌─────────────────────────────────────────┐  ┌──────────────────────┐ │
│  (deepseek 等)   │ 浏览器端 Cordis 应用（同一 SPA 内第二个树）  │  │ window.__DSH_BOOT__  │ │
│                  │ client-ui-* 插件、client-modules、store、  │←─│ 插件图（Host 注入）    │ │
│                  │ api-remotes → ctx.remote.<ns> + $on()     │  │ /plugins/?? 组合脚本  │ │
│                  └─────────────────────────────────────────┘  └──────────────────────┘ │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 关键结论：插件的进程归属

- **Host 插件（绝大多数）运行在 Host Node 进程内**，由 vendored Cordis Loader 依 profile 组合树直接 `import` 并挂载。包括 agent-loop、全部工具、LLM 适配器、持久化、api 控制器、以及用户通过 `dsh plugin`（pnpm 装进 profile 的 node_modules）安装的 out-of-tree 插件。
- **Client 插件（`client-ui-*` 等声明 `dsh.client` 字段的包）运行在浏览器**：Host 侧 `dsh-client-modules`（`ctx.clientModules`，`packages/client/modules`）扫描 Loader 条目中声明 `dsh.client` 的包，把 `WebBootGraph` 写进 `window.__DSH_BOOT__`，并在 `/plugins/??<pkg>/client.js&rev=…` 上服务版本化组合脚本；浏览器内核用它引导**第二个 Cordis 应用**（`docs/subsystems/web-client.md`、`client-modules.md`）。即：**一个包可同时有 Host 半（默认 export）与 Client 半（`exports["./client"]`），分别运行在两个运行时**（`packages/extensions` 的双半包是典型）。
- **Desktop（`apps/desktop` + `apps/desktop-host`）**：Electron 主进程以 Node 模式（Electron RunAsNode）启动私有 Desktop Host 子进程（`apps/desktop-host/src/index.ts`：`runProfile({ profile: 'desktop', args: ['--no-open','--host','127.0.0.1','--port','0'] })`），其中 `runProfile` 来自 `@deepseek-ai/dsh/profile-boot`。"**Host 和插件都在同一 Electron Node-mode 进程执行**"（`apps/desktop/README.md` §Installation ownership）。窗口经 `file://` 载入打包的 Web 资产，fetch 走 IPC 桥而非 webserver；Node IPC 只传 boot 注入、就绪、致命错误与关停。boot 注入即 `ctx.webServer.collectIndexInjections(ctx.connection.browserPeer)` 的输出。
- **SDK（`packages/sdk`）**：客户端**spawn 一个完整 dsh 子进程**（`dsh --profile sdk`，newline-JSON-RPC over stdio）。SDK 不能在进程内挂插件 —— 插件通过 profile + 有序 patch 文件或 `dsh plugin` 持久安装表达（`docs/architecture.md` §Application launch）。Python SDK 同构（runtime wheel 打包同一 dsh CLI）。

### 3.3 Host 与 Client 的分工（`docs/subsystems/web-client.md` §Layers）

| 层 | 归属 | 职责 |
|---|---|---|
| Host 应用 | business services + `packages/api/*-controller` | 权威状态、持久化、变更排序、访问策略、流生产 |
| 传输与 API 装配 | `client/connection`、`api/gateway`、`api/remotes` | 建立 Client generation，暴露生成的 `ctx.remote.<ns>` 方法与流，转发选定的 Cordis 事件 |
| Client 模型 | `api/session-controller/client` 等 | React-free 的 Host 状态镜像、流/单式竞速、窄命令服务 |
| UI 适配/会话数据/组合渲染 | `client/ui-*` | 模型 → Session Slot 源 → 目标快照 → React 树 |

数据流：持久会话显示 = Host Session log → Remote `follow`/`page` → Client `SessionEventLikeEntry` 窗口 → Conversation Contexts → 目标快照（chat/trajectory）→ Slot → React。`$events` 逻辑流是 Connection generation 源；`ctx.remote.$on()` 把白名单事件投给根 Client Context、把 scoped waterfall 投给对应 Session Context。**没有单一 Client Runtime/resync API**：断线重连按数据语义各自定义替换或续传。

## 4. 一条用户消息的完整数据流（`docs/agent-lifecycle.md`、`event-producer-consumer.md`、`tool-execution-pipeline.md`）

turn/step 词汇：**step** = 一次模型请求 + 它引发的工具调用；**turn** = 0..n 个 step（`docs/glossary.md` loop hierarchy）。

```
浏览器输入 → ctx.remote.session.prompt()（api-session-controller Host 面）→ agent.inbox 入队
  agent/inbox/inserted (emit)
→ 唤醒 Driver（dsh-agent-loop）
  agent/status running → Session.append('turn/start')
→ claim（领取 next-step 输入 + 一条排队消息）: agent/inbox/claimed
→ ctx.tools.resolve({agent, modelSelection, signal}) 组装 step 工具集
→ ctx.systemPrompt 'system-prompt/assemble' waterfall 组装 prompt sections + 工具 schema
→ agent/pre-step waterfall（可 accept/rewrite/reject；compaction、plan-mode 等在此拦截）
    reject 或首批为空 → turn 无 step 直接关闭
→ step/start → agent/request waterfall → ctx.llm.prepareCall(config, signal)
→ 同步落账：system/message（按节点 reconcile）→ user/message（逐条）→ request/header(+request/context)
→ deriveMessages() 从日志冻结模型历史 → 绑定的 prepared call 经 llm/stream waterfall 流式调用
→ 流式块：agent/assistant-stream chunk*（进程内瞬态；Web Session-follow 适配器是其唯一远程消费者）
→ 成功：assistant/message（内嵌精确 compact 流）+ committed end；失败/重试：assistant/attempt + agent/request-error waterfall
→ 每个工具调用：tool/call 落账 → tools/pre-execute（钩子/审批/沙箱）→ 单调 guard → ctx.approval（一次性询问）
   → tools/execute（around：超时/重试/指标）→ 工具体（fs/* intent 事件、工具自有会话事件）
   → projectContent → tools/post-execute（accept/block/replace/addContext）→ finalizeContent
   → tools/result 通知 → tool/result 落账（唯一模型可见结果）
→ step/end → 工具还欠请求或有新输入 → 下一个 step；否则 agent/turn-stopping（serial 终点检查点）
→ turn/end → agent/status idle
```

三类事件域（`docs/architecture.md` §Events）：
- **Session 事件**（`turn/* step/* system/message user/message developer/message assistant/message assistant/attempt tool/call tool/result request/* …`）是落进 append-only 日志的持久事实，经 `session/event` 广播；事实须在重载后存活时用它。
- **Agent 事件**（`agent/*`）承载活 `Agent`：inbox、step、status、request、校验、continuation —— 观察或拦截进行中的工作。
- **能力事件**（`fs/* tools/* telemetry/*`）把策略与适配器挂到 seam，不 import loop。

`agent/pre-step`、`agent/request`、`llm/stream`、`tools/pre|execute|post-execute` 是 waterfall（须 `next()`）；`agent/turn-stopping` 是 serial 且无 `next()`。**"Model-visible means logged"**：每个模型请求必须能从日志重建；改变既有消息内容的插件须注册纯 message projection（`ctx.sessions.registerMessageProjection()`）。

## 5. Session 日志（rewind 的核心载体）

（`docs/subsystems/session.md`、`docs/architecture.md` §Session log）

- `Session` = **append-only 的类型化 `SessionEvent` 日志**，LLM 消息历史由 `deriveMessages()` 投影而来，从不单独存储；replay 即重放同一批事件再投影。`seq = log.length` 连续。
- `SessionEventMap` 可 declaration-merge 扩展（compaction 加 `compaction/*`，hook 桥加 `hook/invoked|result`；实验性 `plugin:` 命名空间有 `appendPluginRecord()`/`PluginRecordMap`，标记 `ignorable: true`）。
- surface 事件（system/user/developer/assistant/tool-result）带 `surfaceOp`：`'append'` 或 `{op:'replace', startSeq, endSeq}`（compaction 用 replace 遮蔽区间）。
- `session/end-seed {inherited?: true}` 标记 fork 继承前缀切点；只有 `Session` 构造器与 `buildForkSeed` 可写。
- `TurnEndReasonMap` 含 `interrupted`（崩溃后由 resume 合成）与 `forked`（fork 种子在开放 turn 边界合成）；二者 loop 从不活着发出。
- 持久化（`docs/subsystems/persistence.md` 一族）：JSONL v0 用 `session.jsonl[.zstd]`，v1+ 用 `session.vN.jsonl[.zstd]`；相邻迁移包各管一步 `vN→vN+1`；已提交的 generation 路径永不改名/替换/删除。压缩为每事件一行 JSON。

## 6. SDK 边界（`packages/sdk/`）

| 包 | 角色 |
|---|---|
| `sdk/protocol` | 纯库：newline-JSON-RPC 2.0 传输 + 全部方法/通知类型。client→server：`initialize`、`session/prompt`、`session/query`、`session/resume`、`session/wait`、`session/working-directory-get/set`、`shutdown`；server→client：`approval/request`、`user-question/ask(/cancelled)`、`session.event`、`session.status`、`session.query.completed`、`subagent.started/finished` |
| `sdk/client` | TS 客户端：spawn 同版本 `dsh` 子进程；`DeepSeekHarness.run()` 高层 API（排队 prompt → durable inbox 回执 → 下一个整 agent idle），`HarnessClient` 低层 API；`resumeSession(id)` 恢复持久会话 |
| `sdk/server` | `dsh-sdk-jsonrpc-server` 插件（`dsh --profile sdk` 启动），stdio 服务 |

要点：SDK 是**进程外**驱动面 —— 它能开 session、发 prompt、看全部 session 事件与 agent 状态，但**不能**在进程内挂 Cordis 插件；插件只能通过 profile/patch 或 `dsh plugin` 表达。SDK 用户要可回放数据应消费 `session/event`；`agent/*` 是活协调 API（`docs/agent-lifecycle.md` 结尾明确此分界）。

## 7. 对 rewind（回退会话状态）插件最有影响的架构事实

1. **没有"原地回退"原语：Session 日志是 append-only 且已提交 generation 不可改写**（`docs/architecture.md` §Session log："committed generation paths are never renamed, replaced, or deleted"）。回退的官方形态是 **fork 到某个 turn 边界**：
   - 活会话：`SessionStore.fork(source, boundary?, childSessionId?)`（`docs/subsystems/session.md` §Live-session fork API）—— 接受 live `Session`/`SessionId`，取到**包含式 `SessionSeq` 边界**（默认最后一个事件；默认 Remote 面取"最近完成的 turn 前缀"），闭合开放尾部，deep-clone 种子事件创建独立新会话（`isSeeded: true`、精确 `inheritedEventCount`、继承 `cwd`、无 `parentSession`）。前缀若结束在开放 turn 内会被**拒绝**而非裁剪。
   - 冷读：`SessionController` 的 Remote `fork(request: SessionForkRequest)`（`packages/api/session-controller`，`docs/subsystems/session.md` Cordis API 节）—— 从冷可读的精确事件前缀 fork，省略边界则选最近完成 turn 前缀，开放切点加合成 fork closer。
   - agent 面：`ctx.agents.create({ sessionId, seed, inheritedEventCount, meta: { isSeeded: true } })`（`docs/architecture.md` "Where new behavior goes" 表；`packages/core/agent/src/index.ts` L70-98 的 `CreateAgentOptions.meta.seed/inheritedEventCount`）。注意"只有 agent-loop 发布的 session 才持久化"。
2. **回退后的 UI 数据通路是 `session/event` + follow 流**：Client 端 `SessionManager`/`Session` 持有连续逻辑事件窗口，每代 follow 首帧含 header+尾页+cursor+投影基线，"每个物理 generation 原子替换保留窗口"。rewind 若产生新 session id，浏览器侧是普通的"打开另一个 session"；若复用 id 则窗口被替换。`session-turn-outline`（`packages/session/session-turn-outline`）已提供 turn 轮廓投影，可作为选择回退点的数据源。
3. **rewind 插件可挂载的层**：
   - Host 插件（Node）：监听 `session/event`、注册 `ctx.commands` 人类命令（如 `/rewind`，无模型回合）、用 `ctx.sessions.fork()` 或 `ctx.agents.create()` 建 fork —— 全部在 Host 进程。
   - Client 插件（浏览器）：`dsh.client` 声明 + `exports['./client']`，经 Slots/Conversation 渲染回退 UI；调用生成的 `ctx.remote.session.*`（含 `fork`）。
   - 一个包可以同时提供两半（extensions 组的既有模式）。
4. **安装/分发形态**：rewind 作为 out-of-tree 插件 = npm 包 + `dsh.bundle`（patch 文件），经 `dsh plugin`（pnpm）装入某 profile；浏览器半由 client-modules 自动扫描。SDK 用户只能通过 patch 文件/profile 获得它。
5. **投影 seam**：`dsh-session-projection`（`ctx.sessionProjections`）是"fold 已提交事件"的注册单元，carriers 经 `snapshot()` 读取选定 client 视图；rewind 需要的"到某事件为止的状态"投影应建在此 seam 上而非自建旁路缓存（`.agents/skills/dsh-session-projection` 技能即为其规范）。
6. **事件拦截点**：若 rewind 需要"在下一步前改写/拒绝输入"，正确位置是 `agent/pre-step` waterfall（返回权威 enter/reject 决策）；若需要停止 turn，用 serial 的 `agent/turn-stopping`。
7. **Desktop 无额外进程**：桌面版 Host+插件在同一 Electron Node 进程；Web 版浏览器半是独立 Cordis 应用 —— rewind 的两半在两种部署下行为一致，但浏览器半依赖 Gateway 有活 Client（Client 侧查询在无活页面时 fail fast，见 `ctx.cordisInspect.query` 语义）。

## 8. 关键文件索引

| 主题 | 路径 |
|---|---|
| 架构总览 | `docs/architecture.md`（§Turn flow、§Session log、§Where new behavior goes） |
| 包依赖图（生成） | `docs/module-graph.md` |
| 词汇表 | `docs/glossary.md`（seam/scope/turn/step/round/exchange） |
| Cordis 入门 | `docs/cordis-primer.md`、`docs/cordis-api/{context,events,fiber,registry,service}.md` |
| 回合时序 | `docs/agent-lifecycle.md`（Mermaid） |
| 事件生产/消费矩阵 | `docs/event-producer-consumer.md`（生成） |
| 工具管线 | `docs/tool-execution-pipeline.md`（Mermaid） |
| Session 事件词汇/fork | `docs/subsystems/session.md`；`packages/core/session/src/index.ts`、`src/fork.ts`（buildForkSeed） |
| Agent 创建（fork 种子） | `packages/core/agent/src/index.ts`（CreateAgentOptions L70-100 附近） |
| Host webserver | `packages/host/webserver/src/index.ts`；`docs/subsystems/web-server.md` |
| 浏览器插件加载 | `packages/client/modules`；`docs/subsystems/client-modules.md`、`web-client.md` |
| API 网关/Remote | `docs/api-gateway.md`；`packages/api/{gateway,remotes,session-controller}` |
| 桌面 Host 入口 | `apps/desktop-host/src/index.ts`；`apps/desktop/README.md` |
| CLI 启动器 | `apps/cli/src/bin.ts`、`src/args.ts`；`apps/cli/README.md` |
| SDK | `packages/sdk/{protocol,client,server}/README.md` |
| 动态插件（双半） | `packages/extensions/cordis-host-runner`（`ctx.dynamicCordisRunner`）、`cordis-client-runner`；`docs/subsystems/extensions.md` |
| Profile/插件管理 | `packages/boot/{app-boot,hmr,plugin-manager,plugin-market}`；`docs/subsystems/boot.md` |

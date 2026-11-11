# dsh (deepseek-harness) v0.2.2-rc.1 插件系统与插件制作指南 — 调研笔记

调研子 agent #2。源码根：`D:/Code/Projects/dsh-utils/dsh-source/src`（GitHub tag `dsh-v0.2.2-rc.1`）。所有路径均相对该根目录（除特别标注）。

---

## 1. 总体架构：Cordis 插件运行时

dsh 的插件系统建立在 vendored 的 **Cordis** 插件框架上（`vendor/cordis`、`vendor/loader`、`vendor/include`、`vendor/group`、`vendor/schemastery`、`vendor/timer`、`vendor/hmr` 等；对外以 `@deepseek-ai/cordis` 等包名发布）。核心思想（`docs/cordis-primer.zh.md`）：

- **一切皆插件**：工具、LLM 适配器、文件访问乃至 agent loop 本身，都是挂载到共享 `Context`（`ctx`）上的插件。
- **插件是实现 Service 的对象**：三种形态（函数 / 对象 / `Service` 子类）。
- **上下文是服务容器**：`ctx.tools`、`ctx.llm`、`ctx.agents`、`ctx.sessions`…均是通过 `inject` 查找的命名服务，扁平命名空间。
- **类型化事件**：5 种分发模式 `emit` / `waterfall` / `parallel` / `serial` / `bail`；事件名遵循 `namespace/action`。waterfall 是环绕中间件（拦截/改写/否决的主要机制）。
- **注册是可逆副作用（effect）**：`ctx.on()`、`ctx.tools.register()`、服务注册、`ctx.plugin(child)` 都是 effect，插件卸载时自动撤销；非托管资源用 `ctx.effect(() => disposer)` 包装。

每个已加载插件实例有 **fiber** 状态机：`PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`（`apply`/配置校验抛错 → `FAILED`）。`inject` 未满足时停在 PENDING（进程可静默退出码 0）；运行中服务消失时依赖插件自动卸载、服务恢复后重载。

### Cordis 教程（docs/cordis-tutorial/，中文版 .zh.md 优先精读）

7 章动手教程，运行方式统一为：`node --import tsx ../../vendor/cordis/bin.js`（从 `tmp/cordis-tutorial` 内，读取当前目录 `./cordis.yml`）。`vendor/cordis/bin.js` 创建根 Context 并挂载 Loader。

| 章 | 文件 | 要点 |
|---|---|---|
| index | `docs/cordis-tutorial/index.zh.md` | 教程面向 agent 开发者，无需 API key；为 harness 本身写插件另见 `docs/user/develop/basic/index.zh.md` |
| 1 第一个插件 | `01-first-plugin.zh.md` | 插件 = 导出 `apply(ctx)` 的模块；`name` 导出为可选诊断元数据；`cordis.yml` 是配置项列表（`- name: './hello.ts'`），各项并发启动、顺序由 `inject` 决定；模块无法**解析**时经 logger 报错不崩溃，`apply` 抛错则进程终止 |
| 2 生命周期 | `02-lifecycle-and-effects.zh.md` | `ctx.effect()` 返回 disposer；`ctx.plugin(fn)` 返回 fiber，`fiber.dispose()` 等待全部异步清理并递归卸载子插件；disposer 逆序启动但异步 disposer 并发 |
| 3 服务 | `03-services.zh.md` | `Service` 子类 `super(ctx, 'greeter')` 注册服务；`declare module '@deepseek-ai/cordis' { interface Context {...} }` 声明合并提供类型；`export const inject = ['greeter']` 声明硬依赖；可选依赖用 `ctx.get('greeter')` 探测；服务命名空间扁平，harness 已占用 `tools`、`llm` 等普通名 |
| 4 事件 | `04-events.zh.md` | `interface Events` 声明合并；5 种分发模式表；waterfall 纪律：观察型监听器**必须调用 `next()`**，不调用即短路（否决）；harness 用 waterfall 做 `agent/pre-step`（拒绝/替换拟议步骤）和 `approval/request`（策略代答） |
| 5 配置 | `05-config.zh.md` | 导出 `Config`（Schemastery schema，满足 Standard Schema）在 `apply` 前校验 `cordis.yml` 条目的 `config` 块，错误响亮失败（ValidationError）；`.volatile()` 字段 + `.get()` 引用读取、`loader/volatile-update` 通知；`!!js` 标签计算配置值（仅 `config` 与 `disabled` 内有效；`disabled: !!js` 按挂载决策求值，可按平台门控行） |
| 6 组合与 HMR | `06-composition-and-hmr.zh.md` | 条目元数据：`id`（稳定标识，HMR 增量更新按 id diff）、`disabled`、组（`group`/`isolate` 服务隔离）；`@deepseek-ai/dsh-hmr` 监视文件实现热替换；诊断 PENDING 插件：遍历 `ctx.registry.values()` 的 `runtime.fibers` 查 `FiberState.PENDING` |
| 7 进入 harness | `07-into-the-harness.zh.md` | `inject: ['tools']` + `ctx.tools.register(defineTool({...}))` 注册模型可调用工具；`defineTool`（`@deepseek-ai/dsh-tools`）把 `parameters` 规约转 JSON Schema 并校验参数，`output.schema`/`output.render` 分离规范值与可持久化内容；观察插件监听 `'tools/result'`（emit，物化期间先于 execute 返回）；组合需 `@deepseek-ai/dsh-system-prompt`（工具向系统提示词贡献 schema）；完整 agent = 同套组合 + LLM 适配器 + agent loop + 持久化 + 入口，用 `--patch` overlay 即可插入自己的插件 |

---

## 2. 插件的物理形态

### 2.1 最小可运行插件（本地开发，非打包）

最少 **2 个文件**（插件模块 + 一份 cordis.yml overlay）：

```
scratch-plugin/
├── cordis.yml            # Web 覆盖层：- insert: [{ id: hello, name: '/绝对路径/.../my-plugin.ts' }]
└── src/my-plugin.ts      # export const name + export function apply(ctx)
```

- 插件路径在 patch 中**必须是绝对路径**（patch 只贡献配置，不改变 loader 的模块解析基准）。
- 启动：`pnpm dsh web --patch ./scratch-plugin/cordis.yml`，打开 `http://127.0.0.1:3080`。
- 教程源：`docs/user/develop/basic/index.zh.md`、`tool.zh.md`、`config.zh.md`、`publish.zh.md`。

插件模块本身只需一个文件（`export const name` 可选；`inject`、`Config` 视需要）。

### 2.2 可分发插件：组合包（bundle）的 manifest

安装单位是**组合包**（bundle）= 附带一个配置层的 npm 包。最少 **3 个文件**：

```
hello-plugin/
├── package.json       # 声明 dsh.bundle
├── cordis.patch.yml   # 该组合包贡献的 patch 层（插入/覆盖插件行）
└── index.js           # patch 行引用的插件入口（导出 name/apply[/inject/Config]）
```

`package.json` 示例（`docs/user/develop/basic/publish.zh.md`）：

```json
{
  "name": "dsh-hello-plugin",
  "version": "0.1.0",
  "type": "module",
  "main": "index.js",
  "files": ["index.js", "cordis.patch.yml"],
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "engines": { "dsh": ">=0.2.0 <0.3.0" }
}
```

`cordis.patch.yml`（行按包名引用入口，Node 模块解析才能找到已安装代码）：

```yaml
- insert:
    - id: hello
      name: dsh-hello-plugin
```

要点：
- `dsh.bundle.patch` 也接受有序文件列表 `["./base.patch.yml", "./web.patch.yml"]`；相对插件路径相对各文件解析。
- 没有 `dsh.bundle` 的包仍可安装，但只作普通依赖（`dsh plugin` 打警告、不激活层）——供其他插件 import 的库用这种形式。
- `dsh.client` 声明 Web UI 模块（见 §4 UI）：`platform: 'web'`、可选 `inject` 边、可选 `immediately`，并在 `exports["./client"]` 导出构建好的 bundle。
- 展示元信息：包根插件保留 `package.json` 的 `name`/`description`/`icon`；**子路径插件**（如 `pkg/search`）v0.2.0-rc.2 起不再读子路径 `package.json`，改读子路径 `locale/*.json` 的 `meta.title`/`meta.description` 与导出的 `<子路径>/icon` 资源（upgrade-guide `v0.2.0-rc.2/subpath-plugin-display-manifest`）。
- 平台声明：组合包可声明平台支持范围，Host 不支持时安装/启用返回 `unsupported-platform`（`packages/boot/plugin-manager/README.zh.md`）。

### 2.3 profile manifest

profile 位于 `$DSH_HOME/profiles/<name>`，由两个文件描述：`package.json`（pnpm 管理的树外依赖 + `dsh.profile.bundles` 有序列表）和 `cordis.patch.yml`（用户自己的层）。profile manifest 从不需手写：`dsh --profile <name> --from-default-profile <template>` 创建，`dsh plugin` 维护 bundles 列表。**没有东西同时是 bundle 和 profile**。

### 2.4 `engines.dsh` 版本兼容（upgrade-guide `v0.2.1-alpha.3/plugin-engines-dsh`）

- v0.2.1-alpha.3 起：包自身的 `engines.dsh` SemVer 范围**单独决定**兼容性，忽略 `@deepseek-ai/dsh`/`@deepseek-ai/dsh-*` peerDependencies；仅当缺 `engines.dsh` 时回退 peer 规则。
- `workspace:` 值只在 peer 中有效，出现在 `engines.dsh` 中视为不兼容；`engines` 非对象或 `engines.dsh` 非字符串 → 清单无法读取、包被拒绝。
- 拒绝记录：`IncompatiblePlugin` / app-boot `PluginCompatibility` 的 `peers` 键改名 `requirements`（按 engines 规则时键为 `engines.dsh`，回退时键为 peer 包名）。
- 版本豁免：保存在 profile 的 `compatibility.json`（精确 `package@version` → 精确 DSH 运行时版本列表）；CLI `dsh plugin --profile <p> allow-version <pkg@ver> --dsh-version <rt> --accept-risk`；拒绝错误码 `incompatible-version`。

---

## 3. 配置层与加载顺序

生效配置 = 空根之上逐层 patch（`docs/user/develop/basic/publish.zh.md`）：

1. profile `dsh.profile.bundles` 所列各组合包 patch，按列表顺序（先是 `@deepseek-ai/dsh-base`，再按安装顺序）。
2. profile 自己的 `cordis.patch.yml`。
3. home 级 `$DSH_HOME/cordis.patch.yml`（机器本地共享偏好）。
4. 每个 `--patch <path>` overlay，按 argv 顺序。

规则：后层按行（`id`）胜出；patch **整体替换**目标行的 `config`（不深度合并），覆盖行必须重述全部键。内置组合包名始终从 dsh 安装目录解析。patch 语法由 `@deepseek-ai/cordis-plugin-include` 提供（`insert` / 覆盖 `id` 行等；`!!js` 仅 `config` 与 `disabled` 内有效）。

`packages/bundle/base/cordis.patch.yml` 是 dsh-base 的真实层（约 130 行 `- insert:`），展示了工具、权限（sandbox-policy / approval / permission-presets 三行）、MCP 资源、系统提示词、HMR、settings 等全部核心行的组合方式，是理解"整个产品即插件组合"的最佳实例。`packages/bundle/` 下还有 `headless`、`web-app`、`sdk-app`、`sdk-minimal`、`acp-app` 等部署层。

表层组合包可自带命令行：挂载一个 `inject = ['cmdlineArgs']` 的提供方插件，用 `parseCmdline`（`packages/boot/cmdline`）解析启动器转发的同一份不可变参数快照。

---

## 4. 插件能注册的能力（能力面）

全部通过 `inject` 相应服务 + `ctx.<service>.register(...)`（注册即 effect）或监听事件实现。完整权威清单是各子系统页 `docs/subsystems/*.md` 末尾**自动生成的 cordis-surface 区块**（由 `scripts/gen-cordis-catalog.ts` 生成，`pnpm run verify-cordis-catalog` 校验）。

| 能力 | 服务 / 事件 | 关键文档 |
|---|---|---|
| **工具**（模型可调用） | `ctx.tools.register(defineTool({...}))`，`inject: ['tools']`；`defineTool` 提供 parameters→JSON Schema、output.schema/render、execute；支持 `parallel`/`exclusive` 调度、后台工作、PTC mode、UI 卡片 | `docs/user/develop/basic/tool.zh.md`、`docs/cookbook/adding-a-tool.zh.md`、`docs/subsystems/tools.zh.md` |
| **工具执行拦截** | waterfall 三连：`tools/pre-execute`（PreToolDecision 拒绝/放行）、`tools/execute`（改 exec.signal/超时重试）、`tools/post-execute`（accept/replace/enrich/block 结果）；`ToolGuard` 单调策略只能缩权；PTC 侧 `tools/ptc-dispatch-log` 可改持久内容副本 | `docs/subsystems/tools.zh.md`（"执行：可扩展的 waterfall"） |
| **用户命令**（slash command） | `ctx.commands.register({ name, description, input?, handler })`；命令对确切 agent 直接执行、不产生模型消息；agent 作用域注册可遮蔽全局；`command/run`/`command/done` 入会话日志 | `docs/subsystems/commands.zh.md`（`packages/interaction/commands`） |
| **LLM 适配器** | 继承 `LlmAdapter` 实现 `stream()`，`ctx.llm.registerAdapter(names, adapter)` | `docs/user/develop/practice/llm-adapter.zh.md` |
| **MCP 服务器** | 配置 `@deepseek-ai/dsh-mcp-client` 条目（每服务器一个连接插件，适配为普通 Harness 工具）；`ctx.mcpResources.register(server, provider)` 贡献资源操作；服务器指令进系统提示词 | `docs/subsystems/mcp.zh.md`、`packages/mcp/*` |
| **系统提示词** | `ctx.systemPrompt` 注册 section/context/variable；`system-prompt/assemble` waterfall 可改最终呈现文本 | `docs/subsystems/system-prompt.zh.md` |
| **Web UI 组件** | 两条路：① slots——`ctx.slots.register({name, id, order}, Component)` + `ctx.slots.inject(key, cb)` 贡献 React 组件到已声明 slot（single/list/keyed/chain，root/session/session-maybe 作用域；组件不收 `ctx`）；② client 模块——包在 package.json 声明 `dsh.client` 并 `exports["./client"]` 导出构建 bundle，宿主 `ctx.clientModules` 扫描组合 `window.__DSH_BOOT__` 图并经 `/plugins/...` 路由提供 | `docs/subsystems/slots.zh.md`、`docs/subsystems/client-modules.zh.md` |
| **设置表单** | 插件 `Config` schema 中的 **volatile 字段**自动投影为设置表单（`ctx.settings.describe/update/replace/mutate`，按 profile 条目 id 命名空间）；`ctx.settings.configure({auto})` 控制实例页面策略；config-editor 经 Cordis patch 持久化 | `docs/subsystems/settings.zh.md`、教程第 5 章 |
| **权限 / 审批** | `approval/request` **waterfall** 应答者可代用户决策（`allowed-once`/`rejected`/...，fail-closed）；`ApprovalPolicy` ask/never 按会话；sandbox 三档（read-only/workspace-write/danger-full-access）由 `dsh-sandbox-policy` + `dsh-permission-presets` 组合 | `docs/subsystems/approval.zh.md`、`docs/subsystems/sandbox.zh.md`、`docs/subsystems/permission-presets.zh.md` |
| **agent 拦截** | `agent/pre-step` **waterfall**（请求推导前唯一链）：返回 `{kind:'reject'}` 否决步骤或 `{kind:'enter', messages}` 替换进入批次的消息；`agent/request-error` waterfall 可返回 `{kind:'retry'}` 重试失败模型请求；`agent/turn-stopping` serial | `docs/subsystems/core.zh.md`（"拦截决策"） |
| **会话事件**（Cordis） | `session/event`（emit，观察每条已提交日志事件）、`session/created/disposed`、`session/flush`（parallel 持久化检查点）等；注意 `turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*` 是**持久化会话事件类型**不是 Cordis 事件，观察它们要监听 `session/event` 查 `event.type` | `docs/subsystems/session.zh.md`、`docs/user/develop/framework/events.zh.md` |
| **Claude Code / Codex 钩子桥接**（实验） | `dsh-hooks-claude-code` / `dsh-hooks-codex` + 共享 `dsh-hook-protocol`：运行现有 hooks.json 的 command 钩子（SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Stop/SubagentStop），可阻塞（exit 2）、附加上下文、强制再跑一轮；记录为 `hook/invoked`/`hook/result` 会话事件对。原生插件拥有完整 API，钩子只是兼容桥 | `packages/experimental/hooks-claude-code/README.zh.md`、`packages/experimental/hook-protocol/README.zh.md` |
| **会话日志上传排除** | `ctx.sessionLogDeepSeek.registerExclusion(pred)` | `docs/subsystems/session.zh.md` |
| **自定义工具执行器** | 挂载 `dsh-tool-executor-native` / `dsh-tool-executor-ptc` 或实现自定义 `ToolExecutor`（describe + execute）；执行器是启动必需项 | upgrade-guide `v0.2.1-rc.2/tool-executor-plugins` |

**能力三角色设计**（`docs/user/develop/practice/index.zh.md`）：通用能力拆为 Service Definition（如 `dsh-shell`）、Service Provider（如 `dsh-bash-local`）、Consumer（如 `dsh-tool-bash`）三种包，通过同一服务名组合、提供方可替换；不要预防性拆分。可替换能力系列见 `docs/capability-seams.zh.md`。

类型扩展模式：`…Map → derived-union`（`SessionEventMap`、`ContentBlockMap`、`TurnEndReasonMap` 等 6 个规范 map）由插件**声明合并**扩展变体，无需修改拥有方包（`docs/subsystems/core.zh.md`）。

---

## 5. 插件加载与生命周期（实现侧）

### 5.1 packages/boot/plugin-manager（`@deepseek-ai/dsh-plugin-manager`）

管理当前 profile 的插件：启停单个插件行（只改 profile `cordis.patch.yml` 最后一条匹配覆盖项的 `disabled`）、选择已安装组合包（改 `package.json` 的有序 `dsh.profile.bundles`）、安装/删除/更新外部组合包。要点（README.zh.md）：

- Web 侧边栏**插件**页（`packages/client/ui-plugin-manager`）+ agent 工具 `plugin_manager`（标准/Creator 预设启用；每个操作要求 `danger-full-access` 或本次调用批准）。
- 安装经 pnpm（`pnpmCommand`，默认 `pnpm`），带注册表顺序与回退（`registry` + `fallbackRegistries` 默认 npmmirror）、GitHub `git ls-remote` 预检（`githubConnectionTimeoutMs` 5000ms）、自托管 Git HTTPS→SSH 探测（`gitTransportTimeoutMs` 5000ms）、`requestId` 级安装日志流（`plugin-manager/install-log` / `install-state`）、`cancelInstall`、失败恢复 `package.json` + `pnpm-lock.yaml` 快照。
- `inspect(spec)` 安装前探查（registry 经 `pnpm view`、本地路径读 package.json、git/tarball 只报形式与 host）；`listVersions`/`updateBundle` 升级第三方组合包（官方组合包跟随 DSH 版本不列出）。
- 与 CLI `dsh plugin` 共用 `src/operations.ts`；与 HMR（`packages/boot/hmr`）协作：有 HMR 时变更即时重组合，无 HMR 报 `restart-required`（`restartReason`: `no-hmr`/`package-moved`/…）。
- HMR 下对已安装包安装返回 `already-installed`（upgrade-guide `v0.2.1-alpha.2/plugin-install-over-installed`）——先 `removeBundle` 再 `installBundle`。
- 构建脚本门槛：pnpm ≥10 拒绝 git 依赖的 `prepare` 脚本，需在 profile `pnpm-workspace.yaml` 写 `allowBuilds: {pkg: true}`（或 Web「允许这些脚本并重试」/工具 `approvedBuilds`）；该授权=允许安装时在宿主执行该包代码。
- 版本兼容与豁免：见 §2.4；`plugin-manager/operation`、`plugin-manager/changed` 事件；诊断入口 `/diagnostic`。
- 配置项：`pnpmCommand`、`inspectTimeoutMs`(20s)、`registry`、`fallbackRegistries`、`versionListLimit`(20)、`lockWaitMs`(120s)、`idleTimeoutMs`(600s)、`detailMaxBytes` 等。
- 源码文件：`packages/boot/plugin-manager/src/{index,operations,install-spec,registry,git-transport,github-connection,versions,bundle-detail,patch,tools,types,...}.ts`。

### 5.2 packages/host/plugin-inventory（`@deepseek-ai/dsh-host-plugin-inventory`）

只读投影：`pluginInventory/list` Remote 按加载顺序列出宿主当前插件（条目 id、模块标识、有效启用状态、fiber 阶段映射 pending/loading/active/failed/unloading/null），组合了 agent preset roster 时还报各预设元数据、健康状态与压平组合。不修改插件、无历史、无订阅；每次调用直读 `ctx.loader.entries()`（无第二真源）。源码仅 `src/index.ts`（`PluginInventoryGateway`）+ `src/types.ts`。仅供 Remote，不做同进程 Context 合并。

### 5.3 HMR 与 Loader

- `@deepseek-ai/dsh-hmr`（`packages/boot/hmr`）：监视文件（`root` 配置），保存时卸载旧实例→加载新代码；编辑 `cordis.yml` 本身按 `id` diff 增量挂载/卸载/重配置；串行执行模块重载、文件监听与管理写入。
- Loader 条目树（upgrade-guide `v0.2.2-alpha.2/cordis-loader-entry-trees`，Loader 1.0.0-rc.8 / Include 1.1.1）：`EntryTree.write()` 移除，改 `commit(change)`；Include 经 journal 持久化运行时变更、把生成 id 写回无 id 行；对 patch 插入行的运行时修改写父级 patch（profile 根 Include 父级是内存 Loader，故 bundle 行自行释放写入的 `disabled: true` 重启不保留）。
- plugin 行状态由 Cordis `internal/plugin` / `plugin/status` 事件驱动，`Fiber.state` 是唯一真源。

---

## 6. 安装与分发

### 6.1 CLI：`dsh plugin`

- `dsh plugin --profile <name> <args...>` 在 profile 目录内转发给 pnpm（全部 pnpm 子命令可用）；首次使用初始化 profile（`@deepseek-ai/dsh-base` 为第一个组合包），因包声明 `dsh.bundle` 自动追加进 `dsh.profile.bundles`。
- **选项位置**（upgrade-guide `v0.2.1-alpha.1/plugin-option-placement`）：`--profile` 只在被转发的 pnpm 参数**之前**读取；`dsh plugin --profile <name> add <package>`（不是 `add <package> --profile <name>`）；`dsh plugin --help` 打印自己的帮助。
- 安装来源：本地目录 `add ./hello-plugin`（pnpm link）、npm 注册表 `add your-package`、tarball `add ./pkg-0.1.0.tgz`、GitHub `add github:you/hello-plugin`。
- **git 安装拉源码不构建**：作者须提供自包含 `prepare` 脚本（tsdown 直接转译 src/）；用户须授权构建（allowBuilds）。不想让用户授权就发 npm（`pnpm publish` 时构建好 `lib/`）或交付 tarball（`pnpm pack`）——两种都不需要构建权限。
- `dsh plugin --profile demo remove dsh-hello-plugin` 同步移除依赖与层；`dsh --profile demo --dump-config` 验证层（可见 `# == dsh-hello-plugin` 层）。
- 版本豁免子命令：`version-exemptions` / `allow-version` / `revoke-version`。

### 6.2 本地插件（开发期）

- Web：`pnpm dsh web --patch ./scratch-plugin/cordis.yml`（绝对路径 insert 行）。
- 教程式（无 UI）：`node --import tsx ../../vendor/cordis/bin.js` + 手写 `cordis.yml`。
- 源码 Web 与开发 Desktop 提供 `link:<工作区包目录>` 的官方安装目标。

### 6.3 插件市场（plugin market / Discover）

- 服务：`packages/boot/plugin-market`（`@deepseek-ai/dsh-plugin-market`，可选"自定义插件索引"组合包挂载为 `plugin-market` 行，随附 profile 默认不启用）。读取用户配置的索引 URL（`indexes` volatile 配置，默认空——**DSH 不内置任何索引源**），用 `packages/util/plugin-market-index` 校验，标注安装状态与兼容性；提供只读 `plugin_market` agent 工具（不需批准，只读用户配置源；返回每个版本要传给 `plugin_manager` 的 `target`/`registry`）；安装仍走 `pluginManager.installBundle`。索引 URL 须 http(s)、无凭据/片段；网络不受控时用 https。
- Web UI：**插件页 → 实验性插件 → 自定义插件索引 → 发现标签页**（`packages/client/ui-plugin-market`）；卡片显示推荐版本（兼容且非预发布的最高版本）；安装前确认框显示来源（npm 包+注册表，或 git 仓库+commit+目录）。
- 索引格式（`format: 1`）：UTF-8 JSON，≤128 MiB，2xx 不重定向，放任意静态主机。字段：`title`(必填, LocalizedText)、`plugins[]`（`name` 必填 npm 包名；`title/description/icon/author/homepage/repository/metadata.category/labels/sortKeys` 可选；`versions[]` 必填 ≥1：`version` 精确 SemVer、`publishTimestamp` Unix 秒、`source`（npm `{type, registry?}` 或 git `{type, url:https, commit:40hex, path?}`）、可选 `engines.dsh` 范围）。图标可内联 base64 data: URL（≤32KiB）或相对/绝对 https URL。npm 版安装为 `name@version`，git 版安装为 `git+<url>.git#<commit>`（+`&path:/<path>`）。违反规则整索引被拒。
- 生成器：`apps/plugin-market-generator`（`@deepseek-ai/dsh-plugin-market-generator`，独立 Node 程序，非 Cordis 应用，**从不安装或运行所列包的代码**）。输入纯文本列表（每行 npm 包名或 https git URL），输出 `index.json`：
  ```sh
  pnpm --filter @deepseek-ai/dsh-plugin-market-generator start --input plugins.txt --output site/index.json --title "Team plugins"
  ```
  npm 包列出所有未弃用、非私有、声明 `dsh.bundle` 的版本；git 仓库在默认分支找 bundle 包（根声明 → workspaces glob → 三层目录扫描），版本来自 `vX.Y.Z`/`X.Y.Z`/`<name>@X.Y.Z` 标签及默认分支提交。`engines.dsh` 取 manifest，缺省时取 DSH peer 范围合取。缓存 `.plugin-market-cache`。安全：tarball 内存校验、git 深度 1 裸仓库 blob 读取、禁钩子/子模块/LFS。
- 索引是第三方内容：DSH 检查格式但不验证声明，只加信任的源并在安装前核对来源。
- 格式完整规则：`.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.zh.md`；产品文档 `docs/user/guide/plugin-market.zh.md`。

---

## 7. 插件配置

- 插件侧：导出 `interface Config` + 同名 Schemastery `Schema.object({...})`（默认值写在 schema；`.required()`、`.union`、`.volatile()` 等）；`apply(ctx, config)` 收到完整校验后的配置；错误配置 → fiber FAILED + 精确 `ValidationError`。设计原则：**无硬编码可调参数**（凡部署可能不同的一律配置字段化）、**配置错误要响亮**。
- 用户侧：`cordis.yml` 条目 `config:` 块；配置变更触发该插件热替换（HMR）。
- 设置页：volatile 字段自动投影为 live 表单（`ctx.settings`），config-editor 经 patch 持久化；`settings/document-updated` 失效通知。
- `!!js` 表达式：仅在 `config` 与 `disabled` 内有效；`disabled: !!js` 每次挂载决策按 loader 上下文求值（如 `!!js process.platform === 'win32'`、`!!js "!ctx.get('profileContext')"`——base patch 大量使用）。
- volatile 语义细节（教程第 5 章）：仅 volatile 变化经 `internal/config` 钩子校验后提交到运行中引用并 `loader/volatile-update` 通知；普通字段变化走完整重挂载。

---

## 8. 插件能否拦截/修改会话历史？

**结论：可以拦截与改写"进入模型的内容"，但会话日志本身是仅追加（append-only）的——插件不能原地改写已提交事件，而是通过追加"投影事件"改变派生历史。** 具体机制（`docs/subsystems/session.zh.md`、`core.zh.md`、`tools.zh.md`）：

1. **`Session` 是类型化 `SessionEvent` 的仅追加日志**，唯一真源；LLM 消息历史由 `deriveMessages()` 从日志**派生**，不单独存储。每个事件带单调 `seq`；`Session.append` 在源头强制 JSON 可序列化。
2. **拦截用户输入/步骤**：`agent/pre-step` waterfall（请求推导前唯一监听链）收到拟进入步骤的已领取 `UserMessage` 批次，可返回 `{kind:'reject'}`（不开步骤）或 `{kind:'enter', messages}`（**替换进入步骤的消息批次**）。`agent/request-error` waterfall 可返回 `{kind:'retry'}` 重试失败的模型请求。
3. **拦截/改写工具结果**：`tools/pre-execute`（否决调用）、`tools/execute`（超时/重试包装）、`tools/post-execute`（accept / **replace** / enrich / block 规范化结果——被替换的结果即持久化的 `tool/result` 内容）；PTC 模式 `tools/ptc-dispatch-log` 可改持久内容副本（保留程序值与失败身份）。
4. **改写已记录消息内容（正规定制点）**：插件用 `@messageProjection` 标记自有 `SessionEventMap` 事件，并 `ctx.sessions.registerMessageProjection()` 注册**纯处理器**；Session 提交前校验完整决策、应用不可变消息更新并推进 `contentGeneration`。模型可见历史与恢复/折叠都经投影（`foldSurface(events, projections)` / `deriveEventMessage()`）。内置例子：图片省略插件（`dsh-compaction-image-offload`，`docs/subsystems/compaction.zh.md#image-offload`）。缺处理器时拒绝操作；卸载已用处理器后拒绝派生。
5. **surface 替换**：会话事件可携带 `surfaceOp` 声明替换范围（如 compaction 的事件折叠/替换），`replaceGeneration`/`contentGeneration` 让增量消费方区分尾部增长与重写。
6. **观察**：监听 `session/event`（emit）可观察全部已提交事件（含 `turn/*`、`step/*`、`tool/call`、`tool/result`、`compaction/*` 等持久类型）——只读，不能改。
7. **插件自有日志**：插件可经声明合并添加**仅日志**事件（非 SurfaceEventType、不参与派生历史）；实验性 `appendPluginRecord()`（`plugin:` 命名空间、`ignorable: true`）。
8. **压缩**：compaction 是可替换 seam（`dsh-compaction-basic`、`dsh-compaction-tool-result-pruner`、image-offload 等），本质也是追加替换事件而非改写。
9. **审计与策略**：`approval/request` waterfall 的决策记为 `approval/asked`/`approval/decided` 审计对（仅日志、不进模型 transcript）；模型可见的是调用方派生的工具结果与运行时上下文快照。

---

## 9. 其他 upgrade-guide plugin 相关条目速览

| 条目 | 要点 |
|---|---|
| `v0.2.0-rc.2/schedule-bundle-retired`、`v0.1.7-rc.2/schedule-optional-bundle` | schedule 组合包退役/改为可选 |
| `v0.2.1-alpha.1/jsonl-persistence-plugin` | JSONL 持久化改为函数插件（命名导出 name/Config/apply，无默认导出）；消费方 `inject: ['sessionPersistence']` 用 `SessionPersistence` 类型 |
| `v0.2.1-alpha.1/instruction-home-override`、`subagent-preset-composition` 等 | 组合与 home 覆盖、预设组合细节 |
| `v0.2.1-alpha.2/cordis-timer-wrappers` | Cordis timer 包装约定 |
| `v0.2.1-alpha.2/plugin-manager-view-fields` | `viewProfilePackage(dir, spec, {fields})` 必传 fields |
| `v0.2.1-rc.2/context-menu-services`、`v0.2.2-alpha.2/context-menu-target` | 右键菜单 slot/服务扩展 |
| `v0.2.1-rc.2/conditional-tools` | 条件准入工具（步骤拥有的准入集合） |
| `v0.2.1-rc.2/session-store-writes`、`session-projection-handles`、`v0.2.2-alpha.2/projection-*` | 会话存储/投影 API 变更 |
| `v0.2.2-alpha.2/forge-worktree-entry`、`schedule-remote-host-tasks` | 组合入口细节 |

---

## 10. 关键文件路径索引（绝对路径前缀 `D:/Code/Projects/dsh-utils/dsh-source/src/`）

- 教程：`docs/cordis-tutorial/index.zh.md`、`01-first-plugin.zh.md` … `07-into-the-harness.zh.md`
- 插件开发用户文档：`docs/user/develop/basic/{index,tool,config,publish}.zh.md`、`docs/user/develop/framework/{index,service,events}.zh.md`、`docs/user/develop/practice/{index,llm-adapter,dynamic-cordis}.zh.md`
- 市场文档：`docs/user/guide/plugin-market.zh.md`
- 概念参考：`docs/cordis-primer.zh.md`、`docs/architecture.zh.md`、`docs/capability-seams.zh.md`、`docs/subsystems/*.zh.md`（cordis-surface 生成区块）
- base 组合层实例：`packages/bundle/base/cordis.patch.yml`、`packages/bundle/base/package.json`
- 插件管理：`packages/boot/plugin-manager/README.zh.md` + `src/*.ts`
- 清单投影：`packages/host/plugin-inventory/README.zh.md` + `src/{index,types}.ts`
- 市场：`packages/boot/plugin-market/README.zh.md`；生成器 `apps/plugin-market-generator/README.zh.md`；索引校验 `packages/util/plugin-market-index/`
- HMR：`packages/boot/hmr/`
- engines.dsh：`docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md`；profile/boot 规则 `packages/boot/app-boot/README.zh.md`
- 选项位置：`docs/upgrade-guide/v0.2.1-alpha.1/plugin-option-placement/guide.zh.md`
- Cordis 框架本体：`vendor/cordis/`（bin.js 单文件启动器）、`vendor/loader/`、`vendor/include/`、`vendor/group/`、`vendor/hmr/`、`vendor/schemastery/`
- 钩子桥接：`packages/experimental/{hook-protocol,hooks-claude-code,hooks-codex}/README.zh.md`
- UI：`packages/client/ui-slots/`、`packages/client/ui-renderer/`、`packages/client/modules/`、`packages/client/ui-plugin-manager/`、`packages/client/ui-plugin-market/`、`packages/client/ui-settings-plugin-inventory/`

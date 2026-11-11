# 调研笔记 06：现有插件实现示例与工程化（dsh v0.2.2-rc.1）

源码根：`D:/Code/Projects/dsh-utils/dsh-source/src`（GitHub deepseek-ai/deepseek-harness，tag dsh-v0.2.2-rc.1）。所有下文相对路径均以此根为前缀（记作 `src/`）。

结论速览：仓库内所有真实插件都是 **cordis 命名导出插件**（`export const name / inject / Config / apply`，无 default export）。入口统一是 TS 源码 `src/index.ts`；仓库内开发与测试走 **source plane**（tsx + tsconfig paths 直接跑 TS），发布/安装态走 **tsdown 预编译单文件 `lib/index.js`**。对 rewind 插件最合适的脚手架模板是 **`packages/todo/tool-todo`（工具+session projection 型）**，若 rewind 需要读取/回滚会话消息，`packages/context/time-context` 的 pre-step + projection 组合与 `packages/plan/plan-mode` 的 Service + 命令 + 工具 + session 事件 + projection 是最完整的两层范本。

---

## 1. 插件全景：真实插件在 packages/ 里的分布

插件以 cordis plugin 形态分布在"产品组"目录中（每组一个 README.md）：

| 组目录 | 典型插件 | 形态 |
|---|---|---|
| `packages/context/` | `time-context`、`agent-instructions`、`file-reference`、`session-reference`、`tmux-context` | 请求上下文/系统提示 section 型 |
| `packages/mcp/` | `mcp-client`、`mcp-resources` | 外部工具桥接型（每 server 一个实例） |
| `packages/todo/` | `tool-todo` | 模型工具 + session projection 型 |
| `packages/plan/` | `plan-mode` | Service + 工具 + 命令 + session 事件 + prompt section 全家桶 |
| `packages/subagent/` | `subagent`（seam）、`subagent-codex`、`subagent-claude-code`、`subagent-acp`、`subagent-fork-in-process`、`tool-subagent` | 能力 seam + provider 型 |
| `packages/session-query/` | `session-query`、`session-log-export` | 会话读取/导出型 |
| `packages/client/` | `ui-*`（60+ 个） | 浏览器 UI 插件（host 半 + client 半） |
| `packages/experimental/` | `plugin-recommendations`、`agent-team`、`forge`、`session-search`、`webhook`、`terminal-bundle` 等 60 个 | 实验性/可选 bundle |
| `packages/bundle/` | `base`、`web-app`、`headless`、`acp-app`、`sdk-app`、`sdk-minimal` | 纯 cordis.patch.yml 组合层（无代码） |

线索笔记（均已核实对应源码）：
- `.agents/notes/archived/feature/2026-07-14-time-context-plugin.md` → `packages/context/time-context/`
- `.agents/notes/archived/feature/2026-07-07-mcp-client-plugin.md` → `packages/mcp/mcp-client/`

---

## 2. 精读示例一：`tool-todo`（命令/工具型 —— 最佳 rewind 脚手架）

路径：`src/packages/todo/tool-todo/`，包名 `@deepseek-ai/dsh-tool-todo`（"Model-facing todo_write tool over the event-sourced session log"）。

目录结构（插件标准布局）：

```
tool-todo/
├── package.json          # main: lib/index.js；exports 同时暴露 ./src/*、./locale/*.json
├── tsconfig.json
├── README.md / README.zh.md / README.i18n.yaml
├── locale/{en,zh,...}.json   # 插件 UI 文案（meta.title/meta.description）
└── src/
    ├── index.ts          # 插件入口（name/inject/Config/apply）
    ├── types.ts          # projection key 声明（declare module SessionProjectionMap）
    └── client.ts         # 浏览器半（可选）
tests/
    ├── tool-todo.spec.ts           # 单测：真实 ctx.plugin() 挂载
    ├── loader-composition.spec.ts  # 真实 Loader + cordis.yml 组合测试
    ├── projection.spec.ts
    └── integration.spec.ts
```

入口写法（`src/index.ts`，无任何 helper，纯命名导出）：

```ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-todo'
export const inject = ['tools', 'sessionProjections']

export interface Config { allowParallelInProgress: boolean }
export const Config: z<Config> = z.object({
  allowParallelInProgress: z.boolean().required(),
})

export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.sessionProjections.register<'todos', TodoItem[] | null>({
    key: 'todos', stateVersion: 2, stateSchema: todosProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type === 'todo/write') return event.data.todos
      if (event.type === 'turn/start') return null
      return state
    },
    wire: { viewSchema, view: state => state, summary: false },
  })
  ctx.tools.register(defineTool({
    name: 'todo_write',
    description: describe(allowParallel),
    parameters: { todos: { type: 'array', required: true, items: {...} } },
    output: { schema: {...}, render: (_args, value) => [{ type: 'text', text: `...` }] },
    execute(args, exec) {
      if (!exec.agent) throw new Error('todo_write requires an owning agent session')
      exec.agent.session.append('todo/write', { todos })   // ← 向会话日志追加事件
      return Promise.resolve({ todos, counts })
    },
    presentCall: args => ({ card: 'generic', title: 'Update todo list', kind: 'other', rawInput: args.todos }),
  }))
}
```

注册了什么：1 个 session projection（`todos`，fold 会话事件）+ 1 个模型工具（`todo_write`）。工具落盘方式就是 `exec.agent.session.append('todo/write', ...)`——**这是插件向会话日志写入自定义事件的标准途径**；`types.ts` 里 `declare module '@deepseek-ai/dsh-session-projection'` 声明 projection key，`src/index.ts` re-export `types.ts` 保证声明合并进入发布 d.ts。

依赖布局（package.json 关键点）：
- `peerDependencies`：dsh 的所有共享包（`dsh-agent`、`dsh-session`、`dsh-session-projection`、`dsh-tools`、`cordis`）——宿主提供同一实例；
- `dependencies`：仅真正私有的（schemastery、zod）；
- `devDependencies`：testkit（`dsh-tool-testkit`、`dsh-agent-loop-testkit`、`cordis-plugin-loader`、`cordis-plugin-include`）。

---

## 3. 精读示例二：`time-context`（小型会话/消息操作型）

路径：`src/packages/context/time-context/`，包 `@deepseek-ai/dsh-time-context`。小而全：`src/index.ts`（244 行）+ `timestamp.ts` + `request-zone.ts`。

注册了什么：
1. **session projection**（`ctx.sessionProjections.register({ key: 'timeContext', stateVersion: 3, stateSchema: zod.object(...), init, apply })`）——从持久会话日志 fold 出"上次注入时间/上次消息时间/浏览器时区"；
2. **`agent/pre-step` 钩子**（`ctx.on('agent/pre-step', async ({agent,turn,step,signal}, next) => {...}, { prepend: true })`）——在请求组装前把一条 `createUserMessage({ content, source: { kind: name, form: 'snapshot', sections } })` **追加到 decision.messages**（模型可见但经 pre-step 管道，计入 prompt-pressure 与 request/header 日志）；
3. 通过 `declare module '@deepseek-ai/dsh-llm' { interface MessageSourceMap { 'time-context': ... } }` 声明自己的消息 source 类型。

关键模式（对 rewind 直接可抄）：
- 异步 `apply` 末尾 `await projectionReady`，钩子内 `await projectionReady` 后再 `ctx.fiber.assertActive()`（防 dispose 后继续）；
- 配置校验 fail-loud：`validateRefreshInterval()` 在 load 时 throw；
- Config 用 Schemastery `z.object({...})`，而 projection state 用 zod schema（两种 schema 各司其职：Schemastery 管 cordis.yml 配置，zod 管持久化状态）。

`inject = ['agents', 'sessionProjections']`。cordis.yml 挂载（README）：

```yaml
- name: '@deepseek-ai/dsh-time-context'
  config:
    timeZone: Asia/Shanghai
    refreshIntervalMs: 600000
```

---

## 4. 精读示例三：`plan-mode`（会话状态 + 命令 + 工具 + 服务全家桶）

路径：`src/packages/plan/plan-mode/`，包 `@deepseek-ai/dsh-plan-mode`，`src/index.ts` 483 行。它是"一个插件同时注册五类东西"的样板：

```ts
export class PlanModeController extends Service {
  static inject = ['tools', 'systemPrompt', 'sessionProjections', 'agents']
  constructor(ctx: Context, config: PlanModeConfig = { section: '' }) {
    super(ctx, 'planMode')           // 提供 ctx.planMode 服务
  }
  protected async [Service.init](): Promise<void> {
    ctx.systemPrompt.section({ name: 'plan:policy', order: ..., text: (context) => ... })
    this.planProjectionHandle = await ctx.sessionProjections.register(planProjectionDefinition)
    ctx.on('agent/pre-step', ...)                       // step 边界提交 pending 状态
    ctx.inject(['commands'], (commandCtx) => {          // 条件注入：有命令注册表才挂命令
      commandCtx.commands.register({ definitionId, name: 'plan', description, input, handler })
    })
    ctx.tools.register(defineTool({ name: 'exit_plan_mode', ... }), {
      when: ({ agent }) => this.selectedActive(agent.session) || ...  // 渐进披露
    })
  }
}
export default PlanModeController
```

它还声明了**自定义会话事件**（`declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'plan/mode': { active: boolean } } }`）并用 `session.append('plan/mode', { active })` 写入；`client.ts` 是浏览器半。`Service` class 形态 + `default export` 仅在"要提供服务"时用（见 `docs/user/develop/basic/index.md` 三种插件形态：函数/对象/类）。

**rewind 插件若要"回滚到某条消息再继续"，plan-mode 是最贴近的骨架**：pending 意图在 pre-step 边界提交、session.append 自定义事件、命令 + 工具 + projection 三面联动。另见 SessionStore fork API（`.agents/notes/archived/feature/2026-06-30-session-store-fork-api.md`）：`ctx.sessions` 直接有 `fork(source, boundary?, childSessionId?)`，按 inclusive `SessionSeq` 折叠历史、拒绝开 turn 中 fork——rewind 的"回退到某消息"可直接用 fork 而不是改写日志。

---

## 5. 精读示例四：`ui-message-feedback`（小型 UI 型）

路径：`src/packages/client/ui-message-feedback/`，包 `@deepseek-ai/dsh-client-ui-message-feedback`。**双入口结构**：

- `src/index.ts`（host 半）：空 `apply()`——只为让插件出现在宿主 cordis.yml / Loader；
- `src/client/index.ts`（浏览器半）：真正的 UI 逻辑，通过 package.json `exports['./client']` 暴露，并由 `dsh.client` 声明被发现：

```json
"dsh": {
  "client": {
    "inject": ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-locale", ...],
    "platform": "web"
  }
}
```

client 半注册的内容：`ctx.locale.register(NS, {...})` 词典、`ctx.provide('feedbackUi', feedbackUi)` 服务、`ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({...}, MessageFeedbackActions))` 插槽组件、`ctx.on('connection/reset', ...)`、`ctx.inject(['commandUi'], scope => scope.commandUi.decorate({...}))`。UI 依赖通过大量 `import type {} from '.../client'` 拉进 Context 声明合并。测试在 `tests/*.client.spec.tsx`（`@deepseek-ai/dsh-client-test-runtime` + `@testing-library/react`）。

---

## 6. mcp-client（外部进程/工具桥接型，补充参考）

路径：`src/packages/mcp/mcp-client/`。要点：
- "一 server 一实例"：同一包在 cordis.yml 里按不同 config 装多次（`serverName` 唯一性用模块级 `WeakMap` + `ctx.effect()` 登记/释放）；
- `ctx.tools.register()` 也接受**原始 JSON-Schema ToolDefinition**（MCP 工具不经 `defineTool` 转换直传）；
- 生命周期：`ctx.effect(() => dispose, 'mcp-client.connection')` + 监听 `internal/plugin` fiber 事件提前断连；`failOnStartupError` 决定初始连接失败是否 fail load；
- HMR 热替换 = dispose 旧实例 + 新建（vendored `@cordisjs/plugin-hmr`）。

---

## 7. 实验性插件：官方最新实践样板（`packages/experimental/`）

`experimental/README.md` 定义：Experimental = 公开能力仍在评估、无产品支持承诺；Optional = 用户显式选择；Official = 官方维护并上架 Plugins 页。**可选能力以 optional bundle 形态随安装分发、默认关**（note `2026-09-21-experimental-capabilities-as-optional-bundles.md`）。

### 7.1 `plugin-recommendations`（最新样板，2026-10）

结构：`src/index.ts` + `src/skill.ts` + `src/types.ts` + `skills/official-plugins.md`（插件内置 skill 文档）+ `locale/` + `icon.svg` + `evaluation/intent-cases.json`。入口是 **`TypertRemoteService` 子类**（新式 Host↔Client 远程服务基座）：

```ts
export const name = 'plugin-recommendations'
export const inject = ['pluginManager', 'agents', 'skills', 'actionCards']

export class PluginRecommendations extends TypertRemoteService {
  static inject = inject
  constructor(ctx: Context) { super(ctx, 'pluginRecommendations') }
  protected [Service.init](): void {
    registerOfficialPluginsSkill(this.ctx)
    this.ctx.actionCards.register({ action: ACTION, skill: 'official-plugins', ... })
  }
  @Remote async describe(agent: Agent, callId: ToolCallId): Promise<RecommendationDetails> { ... }
}
```

`skill.ts` 展示了**插件注册 skill 的标准姿势**：`ctx.skills.registerProvider(() => ({ name, list, get }))`，`get` 在调用时 `readFile(new URL('../skills/official-plugins.md', import.meta.url))` 拼装内容。测试 `tests/loader-composition.spec.ts` 用真实 `boot/initProfile`（`@deepseek-ai/dsh-app-boot`）+ 完整 profile 目录 + scriptable `LlmAdapter` mock。

### 7.2 subagent 委派（Codex/Claude CLI）

`packages/subagent/subagent-codex/`：入口实现 `SubagentProvider`（`start(request)` 返回 run），注册到 `ctx.subagents`；`inject = ['subagents', 'subprocess']`。**包本身是 bundle**：`package.json` 里 `dsh.bundle.patch: './cordis.patch.yml'`，patch 内容是组合层（把 provider + 对应 `dsh-tool-subagent` 实例一起插入）：

```yaml
- insert:
    - id: subagent-codex
      name: '@deepseek-ai/dsh-subagent-codex'
    - id: tool-subagent-codex
      name: '@deepseek-ai/dsh-tool-subagent'
      config: { provider: codex, toolName: subagent_codex, maxDepth: provider-managed }
```

### 7.3 `terminal-bundle`（最小可安装 bundle）

`packages/experimental/terminal-bundle/`：`src/index.ts` 只有 `export {}`（"runtime entries are declared in cordis.patch.yml"），全部内容是 patch + locale + icon + docs。**如果 rewind 只想作为可安装 bundle 分发，这就是最小模板**；但 rewind 有真实代码，更像 `tool-todo`/`plan-mode` 的"功能包 + bundle patch 二合一"。

---

## 8. 插件如何写测试（packages/test-support + docs/testing.md）

`docs/testing.md` 分层（root `package.json` scripts：`test` / `test:coverage` / `test:e2e` / `test:expected` / `test:snapshot` / `test:web`）：

- **单测（`pnpm run test`，vitest）**：每个包 `tests/*.spec.ts`，与被测代码同包。覆盖率门槛 `packages/*/*/src` **逐文件 100%**。
- **关键纪律（testing.md "Test the real entry path"）**：产品可见插件必须有**非手搓的真实组合测试**——"boot test-only `cordis.yml` through Loader and app/process"，仅 mock 外部服务/非确定输入；对无 `inject` 的插件还要加 `expect('default' in mod).toBe(false)` 防 default export 丢失命名导出（postmortem 0001）。
- **测试解析走 source plane**：所有 vitest 配置用 vite-tsconfig-paths 指向 `tsconfig.base.json`，裸 workspace import 解析到 `src/`，**绝不经过包 exports 走已构建 lib/**（避免双份模块单例）。CI 的子进程 lane 用"双模 launcher"从构建 `lib/` 起（`DSH_EXAMPLE_MODE=lib`；dev 默认 src + tsx）。

三种实测范式（都有现成文件可抄）：

1. **进程内 ctx.plugin 挂载**（`tool-todo/tests/tool-todo.spec.ts`）：
   ```ts
   const ctx = new Context()
   await ctx.plugin(SystemPrompt); await ctx.plugin(ToolRuntime)
   await ctx.plugin(SessionProjectionRegistry)
   await ctx.plugin(tool, { allowParallelInProgress: true })   // ← 被测插件
   const result = await executeToolFixture(ctx, { signal, callId, name: 'todo_write', arguments, agent })
   ```
   `executeToolFixture` 来自 `@deepseek-ai/dsh-tool-testkit`；fake agent 用真 `Session.create(SessionId(...))`，"只有 agent 包装是 stand-in，session 和工具都是 shipping code"。

2. **真实 Loader + cordis.yml**（`tool-todo/tests/loader-composition.spec.ts`，150 行）：临时目录写 cordis.yml → `ctx.plugin(Loader)` → `ctx.loader.builtins.include = Include` → 设 `ctx.loader.internal = { version: 'v2', async import(specifier) {...} }`（把 workspace 模块注入 Loader 的 import 表）→ `ctx.loader.create({ name: 'cordis:include', config: { path } })` → `await ctx.loader.await()`。验证配置真正生效、坏配置 fail-load。

3. **子进程 e2e**（`time-context/tests/time-context.e2e.ts`）：`runLoaderSmoke({ binScript, configPath, tsconfigPath, sourceImport: 'tsx/esm' })`（来自 `@deepseek-ai/dsh-loader-smoke`），keyless，跑两个 turn 后**外部**重读持久化 JSONL 断言；`plugin-recommendations` 的 loader 测试则用 `@deepseek-ai/dsh-app-boot` 的 `boot/initProfile` + 可脚本化 `LlmAdapter` mock。

test-support 全家（`src/packages/test-support/`）：`agent-loop-testkit`（`unsupportedModel()`/`unsupportedInbox()` + loop 挂载）、`tool-testkit`（`executeToolFixture`/`defineContentToolFixture`）、`loader-smoke`（子进程烟测）、`client-runtime`（UI 测试）、`llm-mock-server`、`llm-replay`、`remote-mock`、`session-snapshot`。另有真实 profile 驱动 `apps/cli/tests/fixtures/production-profile.ts`（`loadProfile` + bundle patch + `*.patch.yml`）。

---

## 9. 构建与打包：TS 直跑还是预编译？

**两者都有，按消费者分**（`docs/development.md` + `docs/user/develop/basic/publish.md`）：

- **仓库内 dev/test（TS 直跑）**：Node ≥24.9 原生 type-stripping + tsx；`tsconfig.base.json` 的 `paths` 把 workspace import 映射到 `src/`。教程直接 `pnpm dsh web --patch ./scratch-plugin/cordis.yml`，patch 行用**绝对路径指向 `.ts` 源文件**即可加载。`dsh-loader-smoke` 的 src 模式 = bin 在 tsx 下跑、`TSX_TSCONFIG_PATH` 指向仓库 tsconfig。
- **发布/安装态（必须预编译）**：`pnpm run build:artifacts` 顺序 = `tsc -b`（Host 聚合 → `lib/types/*.js`）→ `tsdown --env.DSH_BUILD_FACE=host`（把 `lib/types/index.js` 打成自包含 `lib/index.js`）→ desktop → client 面。根 `tsdown.config.ts` 是 workspace 模式（glob `vendor/*`、`packages/*/*`、`apps/cli`）；包内 `tsdown.config.ts` 极薄，如 plugin-recommendations 的：entry `lib/types/index.js` → outDir `lib`、esm、node、es2024、dts: false。**发布 files 只带 `lib/index.js` + `lib/types/**/*.d.ts` + locale + icon**（见 time-context/tool-todo package.json）。
- **外部用户安装**：`dsh plugin --profile <name> add <pkg|git|tarball>`。npm/tarball 装**预构建产物**；git 安装只拿源码，作者必须自带 `prepare` 脚本（pnpm 会在 git 安装后运行），且用户要在 profile 的 `pnpm-workspace.yaml` `allowBuilds` 里放行。npm 上没有 `dsh.bundle` 声明的包只当普通依赖装、不激活层。
- **HMR**：vendored `@cordisjs/plugin-hmr`，改 cordis.yml 条目即热换（dispose 旧实例→建新实例），所有注册都是 `ctx.effect`，自动清理。

**给 rewind 的结论**：仓库内开发时 TS 直跑即可（`--patch` 指向 src/index.ts 的绝对路径）；要发布成可安装 bundle 必须配 tsdown 产物 + `dsh.bundle.patch` + `engines.dsh`。

---

## 10. plugin-market-generator 与插件索引格式

- **格式定义/校验器**：`src/packages/util/plugin-market-index/`（`dsh-plugin-market-index`，"format 1"）。索引 `index.json` 字段（`src/types.ts`）：`format: 1`、`title/description`（LocalizedText，en 必填）、`metadata.{categories,labels,sortKeys}`（市场自定义维度）、`plugins[]`：`name`（npm 包名，索引内唯一）、`title/description/icon`（icon 可为相对路径文件或 ≤32KiB data: URL）、`author/homepage/repository{url,directory}`、`metadata{category,keywords,labels,sortKeys}`、`versions[]{version(SemVer), publishTimestamp(Unix 秒), source(npm{registry} | git{url,commit40hex,path}), engines{dsh SemVer range}}`。校验器 `MarketIndexError` 报 JSON path（如 `$.plugins[0].versions[1].version`）。
- **参考生成器**：`src/apps/plugin-market-generator/`（独立 Node 程序，非 cordis 应用，"never installs or runs the code of the packages it describes"）。输入一个每行一条的源列表（npm 包名或 Git URL），输出 Discover 页可零请求渲染的 `index.json`。只列声明 `dsh.bundle.patch` 且非 private 的版本；npm 版本来自 registry 文档，Git 版本来自 release tag（`vX.Y.Z`/`X.Y.Z`/`<name>@X.Y.Z`）+ 默认分支；`engines.dsh` 缺省时由 `@deepseek-ai/dsh*` peer ranges 合取推导（`workspace:*` 视为宿主版本）。安全：tarball ≤64MiB 校验 integrity、Git depth-1 bare fetch 无 working tree、hooks/LFS/符号链接全禁。
- 消费端：`src/packages/boot/plugin-market/`（读 index、搜索、详情、安装参数）；Discover 设计见 note `.agents/notes/implemented/feature/2026-10-02-plugin-market-discover.md`，格式见同日 `plugin-market-index-format.md`。用户文档 `docs/user/guide/plugin-market.md`。
- （release notes 所述 "plugin index renaming" 即该 2026-10-02 引入的 market index 体系；仓库内没有单独的 renaming note，Discover/index-format 两篇笔记即为出处。）

---

## 11. 模板推荐（按 rewind 需要的能力选）

| 需要什么 | 抄哪个 | 路径 |
|---|---|---|
| 最佳整体脚手架（工具 + projection + 标准包布局 + 两层测试） | **tool-todo** | `src/packages/todo/tool-todo/` |
| 读会话历史、在请求组装前注入/操纵 messages（pre-step 管道） | **time-context** | `src/packages/context/time-context/` |
| 命令 + 工具 + 自定义 session 事件 + Service 全家桶；或"用户动作改写会话走向" | **plan-mode** | `src/packages/plan/plan-mode/` |
| 回滚/分支语义本身 | **SessionStore.fork API**（`ctx.sessions.fork(source, boundary, childId)`，inclusive seq、拒绝开 turn 中 fork） | note `archived/feature/2026-06-30-session-store-fork-api.md`；实现在 `packages/core/session` |
| Web UI 入口（消息条上的动作按钮） | ui-message-feedback 双入口（host 空 apply + `dsh.client`） | `src/packages/client/ui-message-feedback/` |
| 打成可安装/上架 bundle | terminal-bundle / subagent-codex（`dsh.bundle.patch`） | `src/packages/experimental/terminal-bundle/` |
| 新式 Host↔Client 服务 + 内置 skill | plugin-recommendations（TypertRemoteService） | `src/packages/experimental/plugin-recommendations/` |

最小骨架（综合 tool-todo + 教程 `docs/user/develop/basic/index.md`）：

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'rewind'
export const inject = ['tools', 'sessionProjections', 'agents']  // 按需增减

export interface Config { /* ... */ }
export const Config: z<Config> = z.object({ /* ... */ })

export async function apply(ctx: Context, config: Config): Promise<void> {
  // ctx.sessionProjections.register(...) / ctx.tools.register(defineTool(...))
  // ctx.on('agent/pre-step', ...) / ctx.commands.register(...) / ctx.systemPrompt.section(...)
}
```

单测三件套：`new Context()` + `ctx.plugin(依赖)` + `ctx.plugin(rewind, config)`（进程内）；Loader 组合测试（cordis.yml + `ctx.loader.internal.import` 注入表）；可选 `runLoaderSmoke` 子进程 e2e。开发加载：`pnpm dsh web --patch ./rewind/cordis.yml`（patch 内绝对路径指 TS 源）。发布：tsdown 构建 `lib/index.js` + `dsh.bundle.patch` + `engines.dsh`。

# 调研笔记 05：UI 扩展点与客户端 SDK（dsh v0.2.2-rc.1）

源码根：`D:/Code/Projects/dsh-utils/dsh-source/src`（GitHub deepseek-ai/deepseek-harness tag `dsh-v0.2.2-rc.1`）。所有路径均相对该根。

核心结论（先读这个）：
- dsh 的 UI 扩展体系 = **Cordis 插件 + 声明合并的类型化 Slot 系统**。浏览器半边（`./client` 导出）通过 `ctx.slots.register/inject` 把组件挂进固定槽位；宿主半边通过 `ctx.commands`、`ctx.sessions`、`ctx.sessionProjections` 等服务注册命令/投影。
- **消息气泡上可以注册操作按钮**：`conversation.chat.assistant-actions`（list 槽，owner props = `{ messageId }`），内置 ui-message-feedback 的赞/踩就是这么挂的；气泡上还有内置 copy/branch（fork）按钮。
- **输入框（composer）、命令面板（`/` 菜单）、右键菜单、侧边栏都有官方扩展槽**（详见 §2 槽位清单）。
- **"回退到这条消息"的现成原语**：客户端 `ctx.sessions.fork({ sessionId, atSeq })` → Host `session/fork` Remote，按包含性事件 seq 精确切前缀生成新会话。内置的 branch 按钮已用它（见 §6）。
- `packages/sdk` 是**进程外 JSON-RPC SDK**（prompt/resume/query/wait），**不含 fork、历史分页读、UI 注册**——做 rewind 插件应走 Cordis 插件路线而非 SDK 路线。
- CLI（apps/cli）**没有插件可注册的 CLI 子命令机制**；斜杠命令是宿主 `ctx.commands` 注册表，由 Web composer / SDK `session/query` 路由消费。

---

## 1. 插件如何贡献 UI：机制总览

### 1.1 文档入口
- `docs/capability-seams.md` — 全部 `ctx.*` 服务/seam 一览（生成文档）。UI 相关：`ctx.clientModules`（客户端插件图）、`ctx.commands`、`ctx.sessionProjections`、`ctx.sessions`。
- `docs/subsystems/slots.md` — **Slot 系统权威文档**（声明/生命周期/基数/scope/框架 hooks/会话层级树）。
- `docs/subsystems/conversation.md` — 会话节点装配（Event Definition / View / Group），插件自定义消息节点的完整示例代码。
- `docs/subsystems/commands.md` — 人类命令注册表（斜杠命令）。
- `docs/subsystems/session-projection.md` — 会话投影（域状态 fold + 客户端 wire 值）。
- `docs/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.md` — 子路径插件不再读 `<subpath>/package.json` 的展示字段；标题/描述只能来自 `locale/*.json` 的 `meta.title`/`meta.description`，图标来自导出的 `<subpath>/icon`（如 `"./search/icon": "./assets/search.svg"`）。影响插件市场行的展示，不影响功能注册。
- `docs/cookbook/adding-a-settings-card.md` — 配置卡片 + **插件详情页扩展槽**（`plugins.detail.actions/badge/section`）+ 浏览器半边打包要求。
- `.agents/notes/implemented/architecture/`：
  - `2026-09-11-plugin-owned-message-projections.md` — 插件自有消息投影（内容变更型事件）
  - `2026-08-19-session-projection-mandatory-seam.md`、`2026-10-12-session-projection-registration-handles.md` — 投影 seam
  - `2026-07-22-slot-type-chain-implementation.md`、`2026-09-10-component-factories-and-local-slots.md`、`2026-10-09-reasoning-content-slot-factory.md` — Slot 类型代数/工厂
  - `2026-10-18-session-list-summary-projections.md` — 会话列表摘要投影
  - （无 plugin-detail-page-extension-slots / plugin-settings-tabs 独立笔记——这两个主题由 slots.md §开头、ui-settings README、cookbook 文档覆盖）

### 1.2 一个浏览器插件包的结构（以内置 ui-message-feedback 为例）
文件：`packages/client/ui-message-feedback/src/client/index.ts`

```ts
export const inject = ['slots', 'remote', 'remote.messageFeedback', 'remote.sessionFeedback', 'locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en, ... }), '...')
  // 每条 assistant 消息的操作条目（消息气泡按钮！）
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'feedback', order: 10, locale: NS,
    inject: (sessionId) => ({ hooks: {...}, ensure, current, retract, openDialog }),
  }, MessageFeedbackActions))
  // composer 覆盖层（对话框）
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({...}, FeedbackDialog))
  // 给宿主 /feedback 命令挂客户端 UI 装饰
  ctx.inject(['commandUi'], (scope) => {
    scope.effect(() => scope.commandUi.decorate({
      name: 'feedback', available: () => true,
      ui: { kind: 'action', run: (session) => feedbackUi.openSession(session.sessionId) },
    }))
  })
}
```

浏览器插件的加载：`package.json` 声明 `dsh.client`（如 `{ "platform": "web", "inject": ["@deepseek-ai/dsh-client-ui-settings"] }`）+ 导出 `./client`（tsdown clientBundle 预设产出的 lazy-CJS 工厂格式），由 `packages/client/modules`（ctx.clientModules）扫描启用的 Loader 条目并经 `/plugins` 路由伺服。导出纪律（`packages/client/AGENTS.md`）：`/client` 入口只导出 `apply`/`inject`/`Config` 及类型；禁止运行时导入其他特性插件的值——跨包 UI 一律走 slot，跨包行为走注入的 Cordis 服务。

### 1.3 Slot API（`packages/client/ui-slots` + `ui-renderer/src/client/registry.ts` 的 `SlotRegistry`，即 `ctx.slots`）
```ts
// 在父级拥有渲染位置的组件里声明子槽（外部插件一般不声明新槽，而是注册进已有槽）
ctx.slots.register({ name, id?, key?, order?, priority?, locale?, store?, inject?, children? }, Component)
ctx.slots.registerFactory({ name, children?, store?, inject? }, FactoryComponent)  // 可复用组件工厂
ctx.slots.inject(key, callback)   // 等到该槽的声明生命周期再注册；宿主重挂会重跑
ctx.slots.provideRoot(contribution) // 向所有 scope 注入新的标准 props/hooks（如 useContextMenu）
```
- 基数：`single`（替换点）| `list`（按 `id`+`order` 追加）| `keyed`（按 key 派发）| `chain`（`select(owner)` 优先级选举）。
- scope：`root` | `session`（需 SessionProvider 绑定，得 `sessionId/useSession/useProjection/useAccess` 等）| `session-maybe`。
- 组件 props 全部派生：`PropsRuntime<K>`（owner+scope 标准位）、`PropsRenderSlots<S>`（`renderSlot`/`renderSlotChain`）、`PropsStore<H>`、`InjectFace<I>`、`PropsLocale<N>`（`t`）。
- 框架标准 hooks（按 scope 可用）：`useSessions/useSessionStatus/useSessionRetainInfo/useSessionAccess`、`useWorkspaces/useWorkspaceAccess`、`useRemoteAccess`、`usePanelInfo`、（session）`sessionId/useSession/useProjection/useAccess`、`useConversation/useInput/inputActions`、`useChat`、`useTrajectory`。
- 槽名形如 `<domain>.<entry>.<hole>`（如 `tool.call.toolview`）；未声明的注册/重复声明在插件激活时失败。
- 生成目录：`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`（`pnpm run gen-client-catalog`），是每个 key 的穷尽契约（基数/scope/owner props/现有占用者/替换风险）；运行中的动态包可用 `cordis_inspect what:"client"` 查询。

---

## 2. 可用 UI 槽位清单（v0.2.2-rc.1 全量 126 个 key 中挑重点）

以下来自 `slot-catalog.ts` + `docs/subsystems/slots.md` 的会话层级树。

### 2.1 消息气泡 / 会话流（rewind 最相关）
| 槽位 | kind/scope | owner props | 说明 |
|---|---|---|---|
| `conversation.chat.assistant-actions` | list / session | `{ messageId: MessageId }` | **每条已定稿 assistant 消息的操作行**，渲染在 copy 与 branch 按钮之间（`TurnTailNodeView.tsx` → `MessageIconActions` 的 `extraActions`）。声明：`packages/client/ui-chat/src/client/contract/slots.ts:493`；渲染点：`packages/client/ui-chat/src/client/chat/register-node-renderers.ts:95`、`TurnTailNodeView.tsx:56`。 |
| `conversation.chat.turnTail` | list / session | `{ turn, seq, openFile }` | 完整 Turn 结束前的特性条目（含 closing seq）。 |
| `conversation.chat.node` | keyed / session | `{ node: ChatNode<Kind> }` | **按 ChatNodeKind 替换/新增整行消息渲染器**（自定义消息卡片的正门）。见 `docs/subsystems/conversation.md` 的完整示例（注册 `ConversationNodeDefinition` + `ctx.uiConversation.events.register` + 此槽）。 |
| `conversation.chat.commandview` | keyed / session | command 行 | 按命令名替换命令卡渲染。 |
| `conversation.chat.user.before` | chain / session | — | 用户消息行的前置装饰选举。 |
| `conversation.chat.text-interaction` | keyed / session | — | 区域内文本手势/表面准入。 |
| `conversation.chat.message.images` / `user.images`、`conversation.chat.reasoning.body`（single，可替换）、`tool.call.toolview`（keyed，按工具名换工具卡）、`tool.call.images` | | | 图片/推理体/工具卡替换点。 |
| `conversation.view`（keyed：`chat`/`trajectory`/第三方） | | | 第三方可注册整个新视图（View Definition 参与 shell 的视图选择）。 |

内置 branch（fork）按钮：`packages/client/ui-chat/src/client/chat/TurnTailNodeView.tsx`（`onBranch={forkAllowed ? () => forkAt(data.seq) : undefined}`，`useAccess('session/fork')` 门控）+ `MessageIconActions.tsx`（copy/branch/clock/`extraActions`/usage）。

### 2.2 Composer（输入框）
| 槽位 | 说明 |
|---|---|
| `conversation.composer` / `conversation.composer.bar` | composer 容器与输入条。 |
| `conversation.input.left` / `conversation.input.right` | 输入条左/右按钮区（list）。 |
| `conversation.input.attachments` / `permission` / `plan` / `model`（+ `model.label`） | 附件区/权限/计划/模型选择。 |
| `conversation.input.activity` | 模型选择器与 Send 之间的一个动作位（docs slots.md 首段）。 |
| `conversation.input.overlay` | 输入框覆盖层（对话框/弹层，ui-commands 的 popup、feedback 对话框都在此）。 |
| `conversation.composer.dock` / `conversation.input.dock`（`id=queue`） | dock 药丸位/队列 dock。 |
| `conversation.approval.detail` / `conversation.plan-review.actions` | 审批详情/计划审查动作。 |
| `conversation.user.text.node`（keyed，inline） | 用户文本的内联节点。 |

输入触发管线：`packages/client/ui-input-trigger`（`/` 与 `@` 的光标触发菜单；源注册进管线，`matchSpace/matchEnter` 仲裁）。

### 2.3 命令面板 / 斜杠命令
两层：
1. **宿主命令注册表 `ctx.commands`**（`packages/interaction/commands`，`docs/subsystems/commands.md`）：
   ```ts
   ctx.commands.register({
     name: 'rewind',              // 无前导斜杠，小写
     description: '...',
     definitionId?: 'official:rewind',  // 一方命令稳定身份（客户端按它取本地化/图标/输入拼写）
     input?: { hint: string, attachments?: boolean },
     recordInput?: boolean,
     handler: (invocation: { commandId, agent, rawInput, attachments, signal }) =>
       Promise<{ kind: 'success', text?, sourceEventSeq? } | { kind: 'error', text }>,
   })  // 返回 disposer；全局或 agent-scope（shadow）
   ```
   生命周期自动写 `command/run`+`command/done` 日志事件（log-only，不产生模型消息）。`@Remote list/execute` 供客户端目录与分发。内置注册方：command-compact、command-feedback、command-goal、permission-presets、plan-mode、session-log-export、ui-conversation、client/file-upload。
2. **客户端命令 UI `ctx.commandUi`**（`packages/client/ui-commands/src/client/contract.ts`）：
   ```ts
   ctx.commandUi.register(contribution: CommandContribution)
   // CommandContribution = { name, label?(), description?(), icon?, available(session), ui }
   // ui = { kind: 'popupSelect', options(session,signal), onSelect(option,session), searchMode?, searchLabels?() }
   //    | { kind: 'action', run(session) }   // 裸调用即回调，不提交消息
   ctx.commandUi.decorate(decoration: CommandDecoration)  // 给宿主命令挂裸调用 UI
   ctx.commandUi.dismiss(name)
   ```
   与宿主目录按名合并进 `/` 菜单（`+` 按钮同菜单）；同名宿主命令冲突会响亮失败。会话目录 RPC：`commands.list`（需已保留的 Client Session）。

### 2.4 右键/上下文菜单（`packages/client/ui-context-menu`）
- 声明合并扩展目标族：`ContextMenuTargetMap { session, file, directory, url, image, tab }`（`src/client/types.ts`）。
- 注册：`ctx.contextMenus.register({ id, target, order, observe?(target), resolve(target, signal): MenuAction[] })`；`MenuAction = { id, label, disabled?, icon?, danger?, separatorBefore?, children?, failureLabel?, run?() }`。
- 组件内取触发器：`useContextMenu()`（由该插件 `ctx.slots.provideRoot` 注入）→ `getTriggerProps(target)`。
- 图标槽：`ctx.slots.inject('contextMenu.icon', ...)` keyed `key: 'my-plugin.action'`；组件内容槽 `contextMenu.content`。
- Toast 动作：`ctx.contextMenus.notify(text, success, action?)`。
- 会话行的内置动作（Archive 等）也走 `ctx.contextMenus`（menu.item 槽是 legacy 外部行）。

### 2.5 侧边栏 / Shell / 设置 / 插件页
- `sidebar.panellist`（list，主侧栏入口，带 `label`）+ `sidebar.panellist.actions`（More 菜单行）。
- 会话行：`sidebar.session.row.leading` / `.trailing`（inline 图标）/ `.hover`（悬停卡区段）；`sidebar.workspaces.session.row.action`（悬停按钮条，内置 archive(100)/pin(200)）；`sidebar.workspaces.session.menu.item`（legacy 菜单行，含 `useMenuOpenState` hook 工厂与 shortcuts observable）。
- 主面板：`main`（keyed，按 `MainPanelId` 换整个主页面——ui-plugin-manager 以 `key: 'plugins'` 注册整页）。
- `shell.leading/bottom/overlay`、`rightbar`、`sidebar.right.*`（右侧栏 tab 族）、`workspace.toast`。
- 设置页（`packages/client/ui-settings`）：`settings.section`（+ `settings.section.icon` 同 id 图标）、`settings.plugins.tab`、`settings.onboarding`、`settings.header/close/trigger/launcher/models.footer/general.item/action`；配置卡走插件 `Config` schema + `ctx.configForms.whileServed(namespaces, register)`。
- 插件详情页（Plugin Manager 声明，`packages/client/ui-plugin-manager/src/client/slot-contract.ts`）：`plugins.detail.actions`（页首控件）、`plugins.detail.badge`（标题旁徽标）、`plugins.detail.section`（页内区段）——owner props `subject: { kind:'bundle'|'row'|'item', ... }`；另有 `plugins.tab`、`plugins.item`、`plugins.bundle.config/activation`（keyed）、`plugins.row.config`、`plugins.add.actions`。
- 会话头：`conversation.session.header.actions / .utilities / .lineage / .corner / .views.actions`。
- 空状态：`conversation.hero.brand.mark / workspace(+directoryFlow) / agentPreset / options`。

---

## 3. `packages/sdk`（进程外 JSON-RPC SDK）完整导出

**注意**：这个 "SDK" 是给**外部进程**驱动 dsh 运行时的（spawn `dsh --profile sdk` 子进程、stdio JSON-RPC），与"插件作者 UI SDK"是两回事。插件作者的 API 是 Cordis ctx 服务 + 各包的类型导出（§4）。

### 3.1 `@deepseek-ai/dsh-sdk-client`（`packages/sdk/client/src/index.ts`）
值导出：`DeepSeekHarness`、`HarnessSession`、`validatedSessionEvent`、`HarnessClient`、`RequestTimeoutError`、`SdkProtocolError`、`TransportClosedError`、`JsonRpcResponseError`。
类型导出：`RunOptions`、`NotificationSubscription`、`ContentBlock`、`SdkEncodedImageBlock`、`SdkPromptContentBlock`、`SdkUserQuestionAnswer/Result/Request`、`DeepSeekHarnessOptions`、`HarnessClientOptions`、`HarnessNotification`、`NotificationFilter`、`RunResult`。

高层 API（`api.ts`）：
- `new DeepSeekHarness(options)` → `await using`；`start()`；`session(id?)`；`resumeSession(id)`；`run(input, {sessionId?, onNotification?}): Promise<RunResult>`；`close()`。
- `HarnessSession.run/getWorkingDirectory/setWorkingDirectory`。
- `finalResponse(events)`、`validatedSessionEvent(event)`。

低层 `HarnessClient`（`client.ts`）：`start/initialize(params)/prompt(sessionId, blocks)/resumeSession(sessionId)/getWorkingDirectory/setWorkingDirectory/request(method, params, timeout)/subscribe(filter?)/subscribeSessionTree(sessionId)/onRequest(handler)/close()`。

### 3.2 线协议方法（`packages/sdk/protocol/src/types.ts` `HarnessSdkRequestMap`）
`initialize`、`session/prompt`、`session/query`（斜杠命令路由：服务器端 `queryCommand` + `ctx.commands.execute`，见 `packages/sdk/server/src/server.ts:307`）、`session/resume`、`session/wait`、`session/working-directory/get|set`、`shutdown`；通知 `session.event/session.status/subagent.started|finished/session.query.completed/user-question.cancelled`；反向请求 `approval/request`。

**结论**：进程外 SDK **没有** fork、消息删除/编辑、历史分页读、投影读写、UI 注册。会话级"读历史"只能靠订阅 `session.event` 流（`resumeSession` 后从事件流重建）。要做 rewind 插件必须走 Cordis 插件（宿主或浏览器半边），不是这个 SDK。

---

## 4. 插件作者可用的会话/消息 API（Cordis 侧）

### 4.1 客户端（浏览器插件）— 经生成的 Remote（`ctx.remote.*`，`@deepseek-ai/dsh-api-remotes/client` 聚合）
关键命名空间：`ctx.remote.session`（SessionController，`docs/subsystems/session.md` §`ctx.sessionController`）：
- `list/search/create/rename/selectModel/prompt/cancel/updateQueue/attachment/events/observeEvent/observeProjections/state/observeState/wait/**fork**/openWorkspacePath/workspacePathApplications/modelCatalog/initializeDefaultModel/canOpenWorkspacePath`。
- **`fork({ sessionId, atSeq?, allowMigration? })`**：把冷可读的精确事件前缀（含 `atSeq`）切进新会话；缺省取最近完成 turn 的前缀；开着的切口由宿主合成关闭器。客户端封装：`packages/api/session-controller/src/client/sessions/service.ts` `SessionManager.fork({sessionId, atSeq, increaseTitle?, onCreated?, allowMigration?}): Promise<SessionId>`（成功后可改名、并入列表）。
- `events(SessionPageRequest)`：冷安全、消息对齐的历史分页读（向后 cursor + 页预算）。

客户端对象层（`api/session-controller/client` 的 `ClientSessions`→`SessionManager`→`Session`）：
- `ctx.sessions`（客户端服务）：`list`（快照源）、`create({cwd?, sessionId?, agentPreset?})`、`fork(...)`、`scope(id)`（借用 agent-scope Context）、`retainAgentScope/scopeOf/sessionOf`。
- `Session`（`session.ts`）：`prompt(...) / command(line) / rename / cancel / updateQueue / readAttachment / open() / loadOlder() / loadThrough(seq) / resync() / subscribe / getSnapshot()` —— 浏览器插件读写历史的正门。

### 4.2 宿主（Host 插件）
- `ctx.sessions`（SessionStore，`docs/subsystems/session.md` §ctxsessions）：`create/prepare/enter/announce/flush/get/list/**fork(source, boundary?, childSessionId?)**`、`registerMessageProjection(projection): () => Promise<void>`。
  - `Session` 本体：append-only 事件日志；`Session.append`（SurfaceEventType 需带 `SurfaceIntent`：`'append' | { op:'replace', startSeq, endSeq }`）；`surface`、`snapshotEvents` 等。日志为唯一事实，模型历史由 fold 派生。
- `ctx.sessionQuery`（`packages/session-query/session-query`，后端 sqlite）：`listSessions/readSession(id)/filterSessions/filterEvents/readTitleSnapshots/listEvents/readSurface/readEvent/traceSession/traceEvent/searchSessions/searchEvents` —— 程序化读全部历史的统一服务（live 优先、返回 detached 克隆）。
- `ctx.sessionProjections.register(ProjectionDefinition)`：纯同步 fold（`key/stateSchema/init/apply/view(state)/stateVersion`），带 `wire` 的 key 进客户端快照/推送（`session/projection` 帧 + 会话摘要）；客户端 hook `useProjection`。
- `ctx.commands.register(...)`（§2.3）。

### 4.3 事件类型扩展（给消息附加自定义数据/UI 的宿主侧正门）
`declare module '@deepseek-ai/dsh-session/types' { interface SessionEventMap { 'review/start': Data, ... } }` —— 插件自有 durable 事件；客户端用 `ConversationNodeDefinition`（`ctx.uiConversation.events.register`）匹配事件并物化 Chat 节点/`conversation.chat.node` 渲染器（完整示例在 `docs/subsystems/conversation.md`，含 `ChatNodeDataMap`/`ConversationStepDataMap` 声明合并、`match/start/update/buildViewNode`、`exclusive` 独占声明、`reader.previous(kind)` 前驱读、`groupTree` 行定位）。普通 log-only 事件无需投影；**内容变更型**事件需 `@messageProjection` + `ctx.sessions.registerMessageProjection()`（§5）。

---

## 5. 消息投影（message projections）机制

两套不同东西，别混淆：

### 5.1 Session projection（域状态投影，`packages/session/session-projection`）
- **不是**给消息附加 UI 的机制；它是"从日志 fold 出整个会话级当前值"（如标题、计划状态、工作目录），客户端经 `useProjection` 读。
- 插件注册：`await ctx.sessionProjections.register({ key, stateSchema, init(header, inheritedEventCount), apply(state, event), wire?: { viewSchema, view(state), summary? }, stateVersion })` → `ProjectionHandle<S>`（`stateOf/readerFor/dispose`）。
- 变更流：`onChanged`/`onEventChanged`；快照 `snapshot(session, keys?)`；持久缓存 `ctx.sessionProjectionCache`（checkpoint/coldSnapshot/restore/hydrate）。
- 服务器推送：Session Controller 的 `session/projection` 帧基线 + 增量。

### 5.2 Message projection（插件自有内容投影，`2026-09-11-plugin-owned-message-projections.md`）
- 事件属主插件提供纯 `SessionMessageProjection`：一种事件类型 + 前置历史的同步解释器；校验完整 durable payload，返回**既有消息的不可变更新**（保身份）。用于**改变派生消息内容**（如 image-offload 把图从消息中卸载），不增删消息、不是 UI 挂点。
- `SessionEventMap` 成员打 `@messageProjection` 标签 → 生成必需解释器清单；缺失则 append/seed/restore/fold 全拒。经 fiber 内 `ctx.sessions.registerMessageProjection()` 注册；每事件一个属主；卸载使依赖它的缓存读失败。
- Detached 读方显式传定义：`foldSurface(events, projections)`，经 `projectedMessages`/`deriveEventMessage()` 应用。

### 5.3 给"每条消息"附加 UI/操作的实际路径（rewind 视角）
1. **操作按钮**：`ctx.slots.inject('conversation.chat.assistant-actions', ...)`（assistant 定稿消息，按 `messageId`）——feedback 插件先例；用户消息/任意节点没有等价 per-message list 槽，但可以：
2. **替换/新增消息行渲染器**：`ctx.uiConversation.events.register(definition)` + `ctx.slots.register({name:'conversation.chat.node', key:'rewind-marker'}, Component)`——自定义节点可携带任意 UI（包括按钮）。
3. **事件 seq 定位**：`ChatNode.anchorSeq` / TurnTail `closing.finalNode.seq` / `useChat` 快照里的 turn/step 结构；`conversation.chat.node` 槽级 inject 提供 `useTurnData(key)` 等。
4. **执行回退**：`ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true, onCreated })` → `ctx.uiWorkspace.openSession(childId)`（内置 `forkAt` 同款，`packages/client/ui-chat/src/client/apply.ts:301`）。访问门控 `useAccess('session/fork')`（remote-access 策略；owner peer 默认可调）。
5. 宿主侧亦可直接 `ctx.sessions.fork(liveSession, boundarySeq)`（同进程）或 `ctx.remote` 不可用时经 `ctx.sessionController.fork`。

---

## 6. 内置 UI 插件示例（如何用框架 API）

- `packages/client/ui-plugin-manager/src/client/index.ts` — 最完整的"整页插件"样板：`ctx.locale.register`、`ctx.provide('pluginChanges', ...)`、`ctx.remoteAccess.whenAccess('pluginManager/listBundles', function* () { yield ctx.remote.$on(...); yield ctx.slots.inject('main', () => ctx.slots.register({ name:'main', key:'plugins', store, inject, children: { 'plugins.tab': {...}, ... } }, PluginManagerPage)); ... })`、`sidebar.panellist` 注册入口、`ctx.reflect.provide` 跨插件导航、`ctx.layout.selectPanel`。
- `packages/client/ui-message-feedback` — per-message action + overlay + `commandUi.decorate` 样板（§1.2）。
- `packages/client/ui-chat/src/client/apply.ts` — `conversation.view` 的 `chat` key 注册 + owner props 大集合（`openFile/loadOlder/loadThrough/loadImage/forkAt/chatScroll`）+ `shell.overlay` 的 chain 子槽（quota notice）。
- `packages/client/ui-workspace/src/client/contract/slots.ts` — 侧边栏行槽声明 + JSDoc 内完整 inject 示例代码（copy-session-title）。
- `packages/client/ui-context-menu` — `provideRoot(useContextMenu)` + `contextMenus.register` + keyed 图标槽。
- 宿主命令插件样板：`packages/compaction/command-compact/src/index.ts`（`ctx.commands.register`），`packages/session-query/session-log-export`（带 `sourceEventSeq` 的成功结果）。

## 7. CLI（apps/cli）能否注册命令？

- 启动器语法固定（`apps/cli/src/args.ts`，commander）：`dsh [--profile name] [web|headless|sdk|sdk-minimal|acp|plugin]`；**没有插件注册 CLI 子命令的机制**。
- 应用内 flag：`dsh-cmdline`（`packages/boot/cmdline`）提供 `ctx.cmdlineArgs`（不可变内层参数快照）+ `ctx.appExit`，应用插件可用自己的 commander 解析（`--resume abc` 之类）——这是插件能拿到 CLI 参数的唯一途径（自定 profile 的 app 插件）。
- **斜杠命令与 CLI 无关**：宿主 `ctx.commands` 注册表被 Web composer（ui-commands/ui-input-trigger）、SDK `session/query`（`packages/sdk/server/src/server.ts:307` 走 `commands.list/execute`）消费；无 TUI。即 rewind 若做成宿主命令，Web 和 SDK 客户端都能以 `/rewind` 调用。

## 8. 对 rewind 插件的落地建议（基于以上事实）

1. UI：浏览器半边一个包（`dsh.client` 声明），`inject: ['slots','commandUi','locale']` + 类型导入 `@deepseek-ai/dsh-client-ui-conversation/client`（拿 SlotMap 合并）与 `@deepseek-ai/dsh-api-remotes/client`。
2. 每条消息的"回退到这里"按钮：优先 `conversation.chat.assistant-actions`（assistant 定稿消息）+ 若需覆盖用户消息/任意消息，注册 `conversation.chat.node` 新 key 或 `conversation.chat.user.before`/turnTail 装饰，或右键菜单（`ContextMenuTargetMap` 声明合并一个 `message` 目标族需宿主配合——现有族不含 message，需在拥有渲染位置的组件上补 `getTriggerProps`，或仅用现有槽）。
3. 动作执行：`ctx.sessions.fork({ sessionId, atSeq: node.anchorSeq, increaseTitle: true }).then(childId => ctx.uiWorkspace.openSession(childId))`；权限用 `useAccess('session/fork')` 隐藏。
4. 可选宿主半边：`ctx.commands.register({ name: 'rewind', ... })` 提供 `/rewind`（Web 菜单 + SDK query 都能用）。
5. 不要用 `packages/sdk`——它无 fork/历史 API。

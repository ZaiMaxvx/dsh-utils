# btw-05 调研笔记：dsh 客户端如何读取与管理排队消息（queue/inbox）数据

源码：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（dsh v0.2.2-rc.2）
目标：为 /btw 插件的"队列面板"（列出待消费 btw 消息、支持删除/编辑）提供数据通路。

## 0. 一图流（TL;DR）

```
队列数据（待消费消息）
  ┌────────────────────────────────────────────────────────────────┐
  │ React 组件（session 作用域 slot，如 conversation.input.dock）      │
  │   useProjection('inbox')  → InboxWireState                      │
  │       { 'next-turn': UserMessage[], 'next-step': UserMessage[] }│
  │   useSession(s => s.pendingSubmissions)  → 本地提交回显（乐观行）   │
  ├────────────────────────────────────────────────────────────────┤
  │ ISession（SessionFace，来自 ctx.sessions.binding(id).session     │
  │          或 ctx.sessions.sessionOf(actx)）                        │
  │   updateQueue(itemId, {kind:'edit'|'remove'|'steer'})            │
  │   prompt(content, mode: 'queue'|'steer', signal?, requestId?)    │
  ├────────────────────────────────────────────────────────────────┤
  │ ctx.remote.session.updateQueue / .prompt（typert 生成 RPC 面）     │
  │   endpoint: 'session/updateQueue'、'session/prompt'              │
  └────────────────────────────────────────────────────────────────┘
投影数据通路（Host 推送，客户端零折叠）：
  Host 投影注册表（fold `agent/inbox/spliced` 事件 → 'inbox' 键）
    → session/follow 开窗 baseline.projections（seed）
    → session/control 流 'projection' 帧（per-event 增量，higher-seq-wins）
    → ProjectionValueStore（client/sessions/projection-store.ts）
    → ProjectionsFace.faceOf('inbox')（identity-stable observable）
    → useProjection('inbox')（ui-session BUILTIN_SOURCE keyedHook）
```

---

## 1. SessionSnapshot 中的排队字段与生命周期

文件：`packages/api/session-controller/src/client/contract/snapshot.ts`、`client/contract/session.ts`、`client/sessions/session.ts`

### 1.1 快照字段

```ts
export interface SessionSnapshot {
  readonly sessionId: SessionId
  /** 本地提示提交回显：Host 已接受、尚未观测为 durable 事件或队列条目 */
  readonly pendingSubmissions: readonly PendingSubmission[]
  readonly running: boolean
  readonly subagent: { readonly address: SubagentAddress } | null
  // ... openState/hasMore/promptError/blank 等
}

export interface PendingSubmission {
  readonly requestId: SessionRequestId   // prompt RPC 身份；durable user/message 的 source.rpcId 回显它
  readonly placement: 'transcript' | 'queued' | 'steering'  // 提交时固定的落点
  readonly time: number                  // 客户端墙钟 ms
  readonly text: string                  // 单 text 块的原文
  readonly attachments: readonly PendingSubmissionAttachment[]  // image 预览 / file 元数据
}
```

要点：
- `pendingSubmissions` 是**客户端内存**（乐观回显），重载/重连后只从 durable 事件重建；**不是**队列权威数据。
- 权威队列数据 = **投影 key `'inbox'`**（Host 计算，见 §4），durable 事实 = 事件 `agent/inbox/spliced`。

### 1.2 生命周期（从提交到 claimed 的状态迁移）

```
用户提交（mode='queue'，会话 running）
  │ beginSubmission({mode:'queue',...})     [ISession，client/sessions/session.ts:243]
  │   placement = running ? (mode==='steer'?'steering':'queued') : 'transcript'
  │   → pendingSubmissions 加入 echo（尚未 accepted，不发布进快照的 accepted 集）
  ▼
prompt(content,'queue',signal,requestId)    [session.ts:270]
  │ → remote.session.prompt({requestId, sessionId, mode, content, clientTimeZone})
  ▼ Host 接受（两个证明谁先到谁算：prompt 回执 / inbox 投影出现携带 rpcId 的行）
acceptPrompt(requestId)                     [session.ts:333]
  │   settlement.accepted=true；echo 发布进快照（QueueDock 显示 "sending" 行、按钮禁用）
  ▼
agent/inbox/spliced 事件 + 'inbox' 投影更新（inserted 携带 source.rpcId）
  │ observeSubmissionInsertions / observeSubmissionInbox   [session.ts:893,933]
  │   记录 receipt={target,seq,index}；Queued echo 在此处被 retire（reason:'observed'）
  │   （等一帧动画再移除，避免 dock 闪空）
  ▼ Host 侧被 claim（turn 开始消费）
agent/inbox/spliced {removedCount>0, outcome?:'canceled'}（claim 不带 canceled；用户 remove/steer 带）
  │ observeSubmissionEvent                  [session.ts:861]
  │   removed && outcome==='canceled' → retireFailedSubmission
  │   否则 receipt.index 平移（null=已被移出）
  ▼
user/message durable 事件（claim 的消息被记入 transcript）
  │ observeSubmissionMessage(admitted=true) → retireAdmittedSubmission（等 inbox 水位线）
  ▼
finishSubmission：从 pendingSubmissions 删除，onRetire 回调   [session.ts:975]
```

失败路径：prompt 被拒/中止/序列化失败 → `retireFailedSubmission(requestId)`（reason:'failed'）；`abandon()` 是 prompt 前的逃生口。

### 1.3 客户端订阅方式

- React：session 作用域 slot 组件里的 `useSession`（快照选择器）、`useProjection('inbox')`（投影）。
- 非 React：`ctx.sessions.binding(sessionId).session`（`SessionFace`）→ `.projections.faceOf('inbox')`（`ObservableSnapshot<unknown>`，`getSnapshot()/subscribe()`）。
- `useSessionStatus`（ui-session）只含 `running/pendingInteraction/completionUnread`，**不含**队列数据。

---

## 2. QueueDock（conversation.input.dock id=queue）

文件：`packages/client/ui-conversation/src/client/queue/QueueDock.tsx`（组件 + 注册入口 `queueDockEntry`）

### 2.1 数据源（组件第 105-134 行）

```tsx
const inbox = useProjection('inbox') as unknown as InboxState | undefined
const pendingSubmissions = useSession(s => s.pendingSubmissions)
const queue = useMemo(() => {
  const rows = inbox?.['next-turn'] ?? EMPTY_QUEUE      // 只渲染 next-turn（FIFO 队列）
  // 过滤：placement==='transcript' 且 rpcId 仍出现在队列里的行（chat 回显抑制，等 claim 水位线）
  ...
}, [inbox, pendingSubmissions])
const pendingQueue = pendingSubmissions.filter(s => s.placement === 'queued'
  && !admitted.has(s.requestId))                        // 未入队的本地回显（"sending" 行）
const rowCount = queue.length + pendingQueue.length
const running = useSession(s => s.running)
const queueMutable = useSession(s => s.subagent === null || s.subagent.address.mode === 'continuable')
```

- 条目顺序 = `inbox['next-turn']` **数组顺序（FIFO，splice append 在尾部）**；本地 pendingQueue 行追加在 durable 行之后。
- 空队列渲染 null；1 行直接渲染；多行默认折叠为计数头（可展开）。
- 行渲染：`row.id`（MessageId）为 key；文本用 `renderFactorySlot('conversation.user.text', …)`；附件缩略图 `loadImage`。

### 2.2 行形状（wire 数据，谨慎取字段）

```ts
// packages/core/agent/src/types.ts
export interface InboxState {
  readonly 'next-turn': readonly UserMessage[]
  readonly 'next-step': readonly UserMessage[]
}
// UserMessage（packages/llm/llm/src/message.ts）
{ id: MessageId, role: 'user', content: readonly ContentBlock[], source: MessageSource }
// source 为 'user' 时可携带（declaration merge，session-controller/src/types.ts:400）：
//   { kind:'user', rpcId: SessionRequestId, clientTimeZone?, principal? }
```
注意：投影是 **JSON-safe wire 值**（`InboxWireState`，元素是 `JsonValue`），QueueDock 里对 image/file 块取 `block.attachment` 时用 `as {attachment?:…}` 且 undefined 即跳过（QueueDock.tsx:44-63）——插件应照做。

### 2.3 编辑/删除/Steer 按钮

```tsx
updateQueue: (itemId: MessageId, action: QueueAction) => Promise<void>   // QueueDockInjected
// edit:   saveEdit() → applyAction(id, {kind:'edit', content:[{type:'text',text}]})
//          仅纯文本行可编辑（textOf(): content 全为 text 块才启用编辑按钮）
// remove: applyAction(id, {kind:'remove'})
// steer:  applyAction(id, {kind:'steer'})   仅 running 时可用
// 失败: catch → notify('error', t('queue.editFailed'|'queue.removeFailed'|'queue.steerFailed'))
// busy 状态按 itemId 串行禁用
```

QueueAction（`packages/api/session-controller/src/types.ts:144`）：
```ts
export type QueueAction =
  | { readonly kind: 'edit'; readonly content: readonly TextBlock[] }  // 非空纯文本
  | { readonly kind: 'remove' }
  | { readonly kind: 'steer' }
```

### 2.4 注册（queueDockEntry，QueueDock.tsx:393-415）

```ts
ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
  name: 'conversation.input.dock',   // list 型、scope:'session'（contract/slots.ts:305）
  id: 'queue', order: 20,            // TodoDock order:0
  locale: NS,
  inject: (sessionId: SessionId): QueueDockInjected => {
    const actx = ctx.sessions.scope(sessionId)        // Agent 作用域 Context
    const conversation = actx.get('conversation')     // 会话作用域 conversation 服务
    return {
      updateQueue: (itemId, action) => conversation.updateQueue(itemId, action),
      notify: (level, text) => { conversation.input.for(actx).notify(level, text) },
      loadImage: attachment => ctx.uiConversation.imageUrl(sessionId, attachment),
    }
  },
}, QueueDock))
```
slot 组件 props = `PropsRuntime<'conversation.input.dock'>`（含 session 标准件：useSession/useProjection/sessionId/useAccess）+ QueueDockInjected + locale + renderFactorySlot。

### 2.5 conversation.updateQueue（服务封装与错误处理）

文件：`packages/client/ui-conversation/src/client/service.ts:536-546`
```ts
async updateQueue(itemId: MessageId, action: QueueAction): Promise<void> {
  const session = this.scopedSession('updateQueue')   // ctx.sessions.scopeOf(this.ctx) → binding(id).session
  const result = await session.updateQueue(itemId, action)
  if (!result.ok) {
    if (action.kind === 'steer'
      && (result.error.code === 'session/steer-unavailable'
       || result.error.code === 'session/queue-item-not-found')) return  // 竞态收敛，静默
    throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`)
  }
}
```
- `ctx.conversation` 是 **scope-addressed 服务**：必须经 `ctx.sessions.scope(id).conversation`（或 session 作用域内 ctx）访问；根 ctx 上调用抛错。
- QueueDock 的 `applyAction` 捕获 throw → notify('error')。
- 错误码（RemoteErrorDetailsMap，session-controller/src/types.ts:181-219）：
  - `session/queue-item-not-found { itemId }` —— 条目已不 pending
  - `session/steer-unavailable { itemId }` —— 仅 steer；turn 不再接受 steering
  - `session/attachment-invalid { reason:'QUEUE_EDIT_NON_TEXT' }` —— edit 含非文本块
  - `gateway/bad-request` —— edit 内容全空白
  - `session/not-found`、subagent ownership 错误（非 continuable 子代理）

### 2.6 另一个调用示例：整队 Steer（输入 hub）

`packages/client/ui-conversation/src/client/input/hub.ts:295-306`（空草稿提交时把全部 next-turn 逐条 steer）：
```ts
const inbox = session.projections.faceOf('inbox').getSnapshot() as InboxState | undefined
for (const item of inbox?.['next-turn'] ?? []) {
  const result = await session.updateQueue(item.id, { kind: 'steer' })
  if (result.ok) continue
  if (result.error.code === 'session/steer-unavailable'
   || result.error.code === 'session/queue-item-not-found') return   // 静默收敛
  shell.notify('error', t('queue.steerFailed')); return
}
```

---

## 3. ctx.remote.session.* / ISessions 队列相关方法

### 3.1 Remote 面（生成的 `ctx.remote.session`，类型 `SessionRemote = ClientRemote['session']`）

Host 声明：`packages/api/session-controller/src/index.ts`（`@Remote('updateQueue')`、`@Remote('prompt')`、`@Remote({mode:'stream'})` 等）。

| 方法（endpoint） | 签名（client 视角） | 请求/响应 |
|---|---|---|
| `session/prompt` | `remote.session.prompt(req, signal?): Promise<RemoteResult<{accepted:true}>>` | `SessionPromptRequest { requestId, sessionId, mode:'queue'|'steer', content: PromptContentPart[], clientTimeZone? }` |
| `session/updateQueue` | `remote.session.updateQueue(req)` | `SessionUpdateQueueRequest { sessionId, itemId: MessageId, action: QueueAction }` → `{accepted:true}` |
| `session/cancel` | 保留 inbox 的取消 | `{sessionId}` → `{accepted:true}` |
| `session/state` | 被动拉取（只读队列备用通路） | `SessionState { cursor, active, running, queue: SessionQueuedItem[] | null, pendingInput }` |
| `session/wait` | 等静止/需输入 | `SessionWaitValue { reason, state(含queue), output }` |
| `session/follow`（stream） | 开窗 baseline（含 `projections: SessionProjectionBaseline`）+ 增量事件帧 | —— |
| `session/observeProjections`（stream） | 每个改变投影的事件一帧 | `{type:'ready'} | {type:'projection', seq, changes:[{key,val}]}` |
| `session/projections` | 一次性读投影 | `{asOfSeq, values}`（sequenced）或 cached |
| `session/control`（stream） | Host 级 control 流 | baseline `{projections: Record<SessionId, SessionProjectionBaseline>}` / `{type:'projection'} & SessionProjectionUpdate` |

`SessionQueuedItem`（被动 state 的行形状，types.ts:600）：
```ts
{ readonly id: MessageId; readonly placement: 'queued'|'steering'|'context';
  readonly rpcId?: SessionRequestId; readonly content: readonly JsonValue[] }
```

### 3.2 ISession / ISessions（对象层封装）

`ISession`（`client/contract/session.ts:68`）：
```ts
prompt(content, mode:'queue'|'steer', signal?, requestId?): Promise<RemoteResult<{accepted:true}>>
updateQueue(itemId: MessageId, action: QueueAction): Promise<RemoteResult<{accepted:true}>>
cancel(): Promise<RemoteResult<{accepted:true}>>
beginSubmission(input: BeginSubmissionInput): SubmissionHandle
projections: ProjectionsFace   // faceOf(key): ObservableSnapshot<unknown>
readAttachment(ref) / rename(title) / loadOlder() / loadThrough(seq) / command(line)
```
客户端实现（`client/sessions/session.ts:366`）：
```ts
async updateQueue(itemId, action) {
  return this.remote.session.updateQueue({ sessionId: this.sessionId, itemId, action })
}
```
（子代理地址的 prompt 走 `remote.subagents.prompt`；updateQueue 不会。）

`ISessions`（`client/contract/sessions.ts:49`）——插件获取 Session 的入口：
- `binding(id): SessionBinding | undefined` —— `{ sessionId, session: SessionFace, eventSource, ctx }`（`client/sessions/service.ts:105`）
- `sessionOf(ctx): SessionFace | undefined`、`scope(id): AgentContext | undefined`、`scopeOf(ctx): SessionId | undefined`
- `retain(target, {source}) / using(...)` —— 持有会话引用（打开 history + 投影流）
- `list: ObservableSnapshot<SessionListState>`（含 `projectionsBySession` 列表级投影块）
- `refreshProjections(sessionId)` —— 免开窗读投影（migration-safe）

### 3.3 Host 侧 updateQueue 语义（供插件理解错误时机）

`packages/api/session-controller/src/commands.ts:447-519`：
1. edit 校验纯文本 + 非空白；2. 冷 agent 先 resolveAgent（找不到 → `session/queue-item-not-found`）；3. 在 `agent.inbox.nextTurn`/`nextStep` 中定位 itemId（找不到 → `queue-item-not-found`）；4. steer 仅 `next-turn` 且 `agent.status==='running'`（否则 `session/steer-unavailable`）；5. 执行 `inbox.replace/remove(+retirePrompt 上传回执)/steer` —— 全部落为 `agent/inbox/spliced` durable 事件 → 投影推送。

---

## 4. useProjection 可读的投影 key（与排队相关）

### 4.1 `inbox`（核心，已 wired 到客户端）

- 定义：`packages/core/agent-loop/src/inbox.ts:26` `inboxProjectionDefinition { key:'inbox' }`，fold `agent/inbox/spliced` 事件（splice 语义 + id 唯一校验），`wire.view` 原样返回 fold state。
- 类型注册：`packages/core/agent/src/types.ts:59-64` `SessionProjectionMap { inbox: InboxWireState }`。
- **不是 host 内部**：投影值随 follow baseline / control projection 帧 / list hints（inbox 未标 `summary:false`，因此**会**出现在 Session 列表摘要块 `SessionProjectionHints.values` 中）到达客户端 `ProjectionValueStore`，`useProjection('inbox')` 即可读。
- 语义：`'next-turn'`=等待新 turn 的排队消息（FIFO）；`'next-step'`=当前 turn 下一 step 边界注入的 steering 消息。QueueDock 面板只展示 `next-turn`。
- 更新粒度：Host **每个改变了投影视图的 committed 事件**发一帧 `{type:'projection', seq, changes:[{key:'inbox', val}]}`（`SessionProjectionUpdate`）；客户端 store 按 higher-seq-wins 合并（`projection-store.ts:159`）。

### 4.2 其它与队列/会话状态相关 key（部分列举）

`SessionProjectionMap` 声明合并处（各域包内）：
- `turnOutline`（`packages/session/session-turn-outline/src/types.ts:49`，`SessionProjectionSummaryExcluded`——**不进**列表摘要，只在 follow/observeProjections 里）；turn 大纲与排队无直接关系，但可用于面板的 turn 上下文。
- `modelSelection`（core/agent）、`title`（session-title）、`todo`（tool-todo）、`plan`（plan-mode）、`agentPreset`、`workingDirectory`、`tokenUsage`、`userQuestions`、`subagentCatalog`、`agentTeam`、`goal`、`sessionListMetadata`、`conversationContinuation`（session-controller/types.ts:20）等。
- 客户端无折叠：`useProjection` 返回的是 Host 整值；key 缺席 = 能力缺席（undefined）。

### 4.3 只读面板的最低数据通路

- 打开的会话：`useProjection('inbox')`（无需额外权限；projection 读取走 `session/follow`/`session/control`，本身是已授权的流）。备注：liveshare 分类里 `session/projections`、`session/follow`、`session/control` 属 reader-session-read，即只读观察者也能读 inbox。
- 未打开/后台会话：`useSessions()` 列表的 `projectionsBySession[sessionId]`（cached/sequenced hints，含 inbox 摘要），或 `ctx.sessions.refreshProjections(id)` + `binding(id).session.projections.faceOf('inbox')`。
- 被动单次读：`remote.session.state({sessionId})` → `queue: SessionQueuedItem[] | null`（无 live agent 时 queue 为 null）。

---

## 5. 会话切换时面板数据如何跟随（binding/sessionOf 模式）

- **slot 系统自动跟随**：`conversation.input.dock` 等 `scope:'session'` slot 由 renderer 用 `uiSession.adapter` 的 binding source 渲染；当前会话变化 → `StandardSourceBinding` 换成新 binding → 组件拿到新的 `useSession/useProjection/sessionId/useAccess`（标准件来自 `packages/client/ui-session/src/client/index.ts` 的 `BUILTIN_SOURCE`：`keyedHooks:{ projection: key => binding.session.projections.faceOf(key) }`、`hooks:{ session: binding.session }`、`props:{ sessionId }`）。
- keyedHook `projection` 经 `standardHookPropName`（`use`+大写首字母，`client/ui-slots/src/renderer.ts:42`）变成 `useProjection` prop；同理 `session→useSession`、`access→useAccess`。
- 插件在**非 React 代码**中定位会话：
  - `ctx.sessions.scope(sessionId)` → `AgentContext`（拿会话作用域服务如 `conversation`）；
  - `ctx.sessions.binding(id)` / `ctx.sessions.sessionOf(actx)` → SessionFace（读投影、调 updateQueue）；
  - `ctx.sessions.scopeOf(ctx)` → 从任意 client ctx 读 session 标签（conversation 服务用这个实现 scope-addressing）。
- React 里显式跨会话读：`useSessionRetainInfo`、`useSessions`（列表）；会话内一律走标准件。
- btw 队列面板如果挂在 session 作用域 slot（如右侧栏/输入区 dock），数据源随会话切换免费获得；若做全局面板，需用 `useSessions` 选 sessionId 再 `ctx.sessions.binding(id)` 读 `faceOf('inbox')`。

---

## 6. 权限（useAccess / endpoint）

- endpoint 命名 = `<namespace>/<method>`：`session/prompt`、`session/updateQueue`、`session/cancel`。
- session 作用域标准件：`useAccess(action: RemoteEndpoint): boolean`（`RemoteAccessEndpoint = \`${string}/${string}\``，`packages/api/remote-access/src/types.ts:23`）；全局：`useSessionAccess(sessionId, action)`。实现走 `ctx.remoteAccess.source('session', sessionId, action)`（`ui-session/src/client/index.ts:710-715`）。
- Owner（本机默认客户端）baseline 为 `{owner:true}` → 一切允许（`remote-access/src/client/state.ts`）。非 owner peer 按 grants 判定。
- liveshare viewer 分类（`packages/experimental/liveshare/src/endpoint-classification.ts`）佐证语义：
  - `session/updateQueue`: **owner-only**（"owner edits queued input"）——编辑/删除排队消息是 owner 能力，非 owner 永远 false。
  - `session/prompt` / `session/cancel`: `reader-session-input`（viewer 在 input tier 下可 prompt）。
  - `session/follow` / `session/projections` / `session/control` / `session/state` 等: reader-session-read。
- **只读队列面板不需要任何写权限**：inbox 数据经 follow/control 流到达，属于会话可见性范畴（挂 session 作用域 slot 即隐含已 retain 会话）。
- **删除/编辑按钮**应：`const mayEdit = useAccess('session/updateQueue')`（false 时隐藏或禁用按钮；undefined 视为不允许）。参考 `InputBar.tsx:63` `useAccess('session/prompt') === false` 的判定风格。
- 效果安装版本：`ctx.uiSession.whenAccess(sessionId, action, callback)`（内部 `remoteAccess.whenResourceAccess('session', …)`）。

---

## 7. /btw 队列面板落地建议（结论）

1. **数据源**：session 作用域组件 `useProjection('inbox')` → `inbox['next-turn']`（FIFO 顺序、`UserMessage` wire 值；文本块 `content.filter(b=>b.type==='text')`，图片/文件块取 `b.attachment` 且判空）。本地"发送中"行可并入 `useSession(s=>s.pendingSubmissions).filter(s=>s.placement==='queued')`。steering（next-step）不建议混入面板（QueueDock 也不展示）。
2. **删除/编辑调用**：优先复用会话作用域 `conversation.updateQueue(itemId, action)`（经 `ctx.sessions.scope(sessionId).get('conversation')`）；绕开 UI 服务则直接 `ctx.sessions.binding(sessionId).session.updateQueue(itemId, action)`（RemoteResult 自行处理）。edit 仅纯文本、非空白；`queue-item-not-found` 竞态建议静默收敛（remove/edit 也常因 agent 已 claim 而失败——QueueDock 对 remove/edit 是 notify，可按需放宽）。
3. **权限**：删除/编辑按钮门控 `useAccess('session/updateQueue')`；提交（若有）门控 `useAccess('session/prompt')`。只读列表无需权限。
4. **图片缩略图**：`ctx.uiConversation.imageUrl(sessionId, attachment)`（Gateway 授权、按会话缓存 URL）。
5. **会话切换**：挂 `scope:'session'` slot 即自动跟随；或 `useSessions` + `binding(id)` 手动寻址。

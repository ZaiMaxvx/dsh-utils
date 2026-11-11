# /btw 调研 #2：dsh 消息队列 / Inbox 机制（host 侧）

源码：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（deepseek-ai/deepseek-harness tag `dsh-v0.2.2-rc.2`）
结论先行：**/btw 命令 handler 正道 = `ctx.commands.register({ name: 'btw', ... })`，在 handler 里拿 `invocation.agent`（完整 `Agent`，含 `inbox`），用 `createUserMessage(...)` 造消息后调 `agent.followup(msg)`（运行中自动落 next-turn 队列、不打断当前 turn；空闲时立即开新 turn）。管理（删除/编辑/转 steer）用 `agent.inbox.remove/replace/splice`（durable），或走 Remote 面 `session.updateQueue({sessionId, itemId, action})`（按 `MessageId` 定位）。不需要也不应该走 `session.prompt` RPC——那是浏览器输入框的通道，插件命令在 host 进程内直接持有 Agent。**

---

## 1. Agent 三入口：followup / steer / inject

### 1.1 契约（`packages/core/agent/src/runtime-types.ts`，declare module './types.ts' 增强的 `Agent` 接口）

```ts
/** Route identified input to an inbox boundary and optionally wake the driver. */
send(message: UserMessage, target: InboxTarget, wakeup: boolean): void
/** Queue an ordinary follow-up turn and wake the driver.（成为自己 turn 的唯一普通消息） */
followup(message: UserMessage): void
/** Submit steering for the nearest step.（idle 也会开 turn；running 则在下个 step 边界消费） */
steer(message: UserMessage): void
/** Queue model-facing context for the next pre-step without waking the driver.（不唤醒） */
inject(message: UserMessage): void
```

- `InboxTarget = 'next-turn' | 'next-step'`（`packages/core/agent/src/types.ts:40`）
- `Inbox` 接口（同文件 75-127 行）：`readonly nextTurn: readonly UserMessage[]`、`readonly nextStep: readonly UserMessage[]`，以及 `clear() / append / prepend / replace(messageId, newMessage): boolean / remove(messageId): boolean / splice(target, start, deleteCount, inserted): UserMessage[]`。

### 1.2 实现（`packages/core/agent-loop/src/agent.ts`，`ReactLoopAgent`）

```ts
send(message, target, wakeup) {
  const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
  const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
  this.inbox.splice(resolvedTarget, Infinity, 0, [message])   // 追加到队尾（Infinity 被 normalize 钳到 length）
  if (wakeup) this.wakeDriver(wakingAfterAbort)
}
followup(input) { this.send(input, 'next-turn', true) }   // queue 语义
steer(input)    { this.send(input, 'next-step', true) }   // 打断/转向语义
inject(input)   { this.send(input, 'next-step', false) }  // 不唤醒；运行中在最近 step 边界被 claim，idle 则挂着等唤醒
```

关键行为（对 /btw 重要）：
- **运行中 followup**：消息进 `next-turn` 队尾，**不打断当前 turn**；当前 driver 在 `turn()` 结束时若 `inbox.hasPending` 会自己继续消费（`agent.ts:433` `if (!this.inbox.hasPending) return false` → 循环开下一个 turn）。
- **空闲时 followup**：`wakeDriver()` 同步置 `running` 并 kick，立即开新 turn。
- **已取消（abort）时 followup**：被重分类到 `next-turn` 排队，等 aborted 活动收敛到 idle 后再跑（`wakingAfterAbort`）。
- `cancel(cause, {keepInbox})`：默认 `keepInbox:false` 会 `inbox.clear()`（先清 next-step 再清 next-turn）；session-controller 的 `session.cancel` RPC 用 `keepInbox: true` 保留队列。
- claim：`ReactLoopInbox.claim(target, turn)`（`inbox.ts:108`）——把**全部 next-step + 一条 next-turn**（当 target 是 next-turn 时）原子取走，逐条 emit `agent/inbox/claimed`；随后这些消息在 step 中被 `session.append('user/message', message, { surfaceOp: 'append' })` 才进入 transcript（`agent.ts:469-483`）。

### 1.3 UserMessage 构造

`packages/llm/llm/src/message.ts:246`：

```ts
export function createUserMessage<T extends NewUserMessage>(
  input: T & { readonly id?: never; readonly role?: never },
): T & Pick<UserMessage, 'role'>   // 自动 mint MessageId (randomUUID)、deepFreeze
```

`MessageSource` 是 merge-extensible 联合（`message.ts:110` `MessageSourceMap`：基础只有 `user | model | tool | system-prompt`），**各生产者在自己模块里 declare module 扩展自己的 kind**：
- session-controller：`'user-rpc': { kind:'user'; rpcId: SessionRequestId; clientTimeZone?; principal? }`、`'retry-rpc': { kind:'retry'; rpcId; ... }`（`packages/api/session-controller/src/types.ts:393-404`）——注意这两种 kind 字符串本身是 `'user'`/`'retry'`（字段 kind），Map key 只是类型名。
- schedule：`'schedule': { kind: 'schedule' } & ContextFormed`（`packages/schedule/schedule/src/runtime.ts:5-9`）
- webhook：`kind: 'webhook'` + `form:'notice'` + `summary`（`packages/experimental/webhook/src/session.ts:128-139`，summary 需 `boundContextSummary` 截断 120 字符）
- agent-loop 自用：`'runtime-context'`（`packages/core/agent-loop/src/runtime-context.ts:16`）

**/btw 若要"标记"，可仿 schedule/webhook 声明自己的 kind（如 `'btw'`）**。风险：session 格式迁移 v2→v3 有 SOURCE_KINDS 白名单（`packages/session/session-format-v2-to-v3/src/payload.ts:10`，含 `user/plugin/model/tool/agent-instructions/session-reference/team-message/goal/skill-invocation/skill-catalog/coordinator/subagent-report/subagent-settled/webhook/agent-message`）；新 kind 不在名单时旧日志跨格式迁移会抛 `SessionFormatUnsupportedMigrationError`。想零风险可复用 `{ kind: 'user' }`（/goal 的做法）或已有 kind。

## 2. durable inbox：投影、事件、claimed/discarded 流

### 2.1 `agent/inbox/spliced` 事件（durable 事实，`packages/core/agent/src/types.ts:103-123`）

```ts
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'agent/inbox/spliced': {
      target: InboxTarget      // 'next-turn' | 'next-step'
      start: number
      removedCount?: number    // 有删除才有
      inserted: UserMessage[]  // 完整消息体（id/content/source 全量入日志）
      outcome?: 'canceled'     // 仅显式取消/删除路径
    }
  }
}
```

事件示例（入日志的 data）：
```json
{ "target": "next-turn", "start": 1, "inserted": [ { "id": "…uuid…", "role": "user",
  "content": [ { "type": "text", "text": "记得之后跑一下测试" } ],
  "source": { "kind": "user" } } ] }
```
删除（用户在 queue dock 删一条）：
```json
{ "target": "next-turn", "start": 0, "removedCount": 1, "inserted": [], "outcome": "canceled" }
```

### 2.2 Inbox 投影（崩溃恢复，`packages/core/agent-loop/src/inbox.ts`）

- `inboxProjectionDefinition`（key `'inbox'`，stateVersion 1）：fold 所有 `agent/inbox/spliced` 重建 `{ 'next-turn': UserMessage[], 'next-step': UserMessage[] }`；非法 splice 历史（越界、重复 id）直接抛错。注册处在 `packages/core/agent-loop/src/index.ts:334`（AgentLoop 服务 init 时 `ctx.sessionProjections.register(inboxProjectionDefinition)`）。
- wire 面：`InboxWireState`（JSON-safe，`packages/core/agent/src/types.ts:54`）进 `SessionProjectionMap`，客户端可订阅（`observeProjections` / `projections` RPC 读 key `'inbox'`）。
- `ReactLoopInbox`（`inbox.ts:73`）是 `Inbox` 契约的实现：所有 mutation 都走 `mutate()` → `session.append('agent/inbox/spliced', …)` 再 emit 进程内事件：
  - **插入**（append/prepend/splice 带插入）：`agent/inbox/inserted` `{ agent, message }`
  - **claim**（driver step 边界取走）：`agent/inbox/claimed` `{ agent, message, turn }`（注意：claim 的 splice `discardRemoved=false`，不标 `outcome`，也不 emit discarded）
  - **丢弃**（remove/clear 等显式删除）：`agent/inbox/discarded` `{ agent, message }`，splice 记 `outcome:'canceled'`
  - 这些是 cordis Events（`runtime-types.ts:275-431`），host 内插件可直接监听（agent-scoped，`@deepseek-ai/dsh-scope` 过滤）。
- 消费记账：`packages/core/agent/src/consumed-work.ts` `foldConsumedWork(events)` 用 `removedCount` + `outcome:'canceled'` 区分"turn claim 走了" vs "未运行被丢弃"（`droppedUnrun`）。

## 3. 命令通道提交 prompt 的正道：`session.prompt` vs 插件直调

### 3.1 Remote 面（`packages/api/session-controller/src/index.ts:467-492`）

```ts
@Remote('prompt')
async prompt(request: SessionPromptRequest, signal: AbortSignal): Promise<SessionPromptValue> {
  // 1) 非空 content 必须含非空白文本或附件（hasPromptContent）
  // 2) clientTimeZone 规范化
  // 3) source = { kind: content.length===0 ? 'retry' : 'user', rpcId: request.requestId, clientTimeZone?, principal? }
  //    principal 仅当调用者非 owner（principalOf(this.ctx.invocation)）
  return this.commands.prompt(request, source)
}
```

`SessionPromptRequest`（`packages/api/session-controller/src/types.ts:324-332`）：

```ts
{
  requestId: SessionRequestId        // 客户端铸造，幂等去重用
  sessionId: SessionId
  mode: 'queue' | 'steer'            // queue→followup；steer→steer
  content: readonly PromptContentPart[]  // text | image(base64) | file(receiptId)
  clientTimeZone?: string
}
```

`SessionCommandController.prompt`（`commands.ts:321-387`）如何决定 queue vs steer：**完全由 request.mode 决定**——`if (request.mode === 'steer') agent.steer(message) else agent.followup(message)`。另有：
- `requestId` 幂等：`hasPromptRequest()` 扫日志里未见的 `agent/inbox/spliced.inserted` 与 `user/message`，收集 `(source.kind==='user'||'retry') && 'rpcId' in source` 的 rpcId；重复提交直接 `{accepted:true}`。
- 空 content = "继续失败的会话"：走 `agent.runMaintenance(...)` + `agent.followup(createUserMessage({content:[], source}))`，且仅当 mode==='queue'、continuation 投影有可续失败、inbox 无 pending 用户输入。
- 附件：`file` part 按 receiptId 经 `ctx.fileUploads.resolve` 换成 durable 引用；图片校验模型 input modalities。
- 权限：资源解析器 `resolveSessionResource`（index.ts:92）注册为 `session` kind 默认 → `ctx.remoteAccess.allows({kind:'session', id})` 网关层校验；business 层无额外权限。

**插件命令 handler 能否直接调它？** 技术上可在 host 内 `ctx.remote.session.prompt(...)`（typert 本地调用），但**不必要**：命令 handler 已拿到 `invocation.agent`（活 Agent），绕一圈 RPC 会丢掉 host 内类型、且要自己 mint requestId/处理 source。**正道是 handler 内直接 `agent.followup(createUserMessage({content, source:{kind:'user'}}))`**——/goal（`packages/goal/command-goal/src/index.ts:117-123`）、schedule（`runtime.ts:352-356`）、webhook（`session.ts:128`）全都这么干。

### 3.2 命令注册与执行（`packages/interaction/commands/src/index.ts`）

```ts
ctx.commands.register({
  definitionId: CommandDefinitionId('@deepseek-ai/dsh-command-goal'),
  name: 'goal',                       // ^[a-z][a-z0-9_-]*$，'btw' 合法
  description: '…',
  input: { hint: '[<text>…]', attachments: true },   // 声明后 invocation.attachments 有已落库的 image/file blocks
  recordInput: true,                  // command/run 是否记录 rawInput（默认 true）
  handler: invocation => CommandResult | Promise<CommandResult>,
})
```

`CommandInvocation`（41-58 行）：`{ commandId, agent: Agent, rawInput: string, attachments: readonly (ImageBlock|FileBlock)[], signal }`。
执行生命周期（`execute()`，360-431 行）：`command/run`（含 name+args+`source:{kind:'user'}`）→ handler → `command/done`（success/error + text）。均为 **log-only 直接 append，不开 turn**。命令行解析 `/btw xxx` → `parseCommand` 取 name='btw', rawInput=' xxx'。
`CommandResult`：`{kind:'success', text?, sourceEventSeq?}` | `{kind:'error', text}`（text 非空）。

`/goal` 提交 prompt 的精确姿势（`command-goal/src/index.ts:117-123`）：

```ts
invocation.agent.followup(createUserMessage({
  content: [...invocation.attachments, { type: 'text', text: '…' }],
  source: { kind: 'user' },
}))
```

## 4. updateQueue（edit/remove/steer）

### 4.1 请求形状（`types.ts:143-151, 353-363` + `commands.ts:447-519`）

```ts
interface SessionUpdateQueueRequest {
  sessionId: SessionId
  itemId: MessageId            // ★ 按 messageId 定位（不是索引！在 next-turn 和 next-step 两个列表里找）
  action: QueueAction
}
type QueueAction =
  | { kind: 'edit'; content: readonly TextBlock[] }   // 仅文本、必须非空白，否则 QUEUE_EDIT_NON_TEXT / bad-request
  | { kind: 'remove' }
  | { kind: 'steer' }                                  // 仅 next-turn 且 agent.status==='running'，否则 session/steer-unavailable
```

host 端 `SessionCommandController.updateQueue` 逻辑：
1. 定位：`agent.inbox.nextTurn.find(m => m.id === itemId)`，找不到再找 `nextStep`；都没有 → `session/queue-item-not-found`（含 agent 未挂载/会话不存在时同样映射到此错误）。
2. `edit` → `agent.inbox.replace(itemId, freezeMessage({...message, content:[...action.content]}))`（保留原 id 之外全部字段——注意 replace 的 splice 是同位替换，新消息有新 id）。
3. `remove` → `agent.inbox.remove(itemId)`；若 source 是带 rpcId 的 user 消息，还会 `ctx.fileUploads.retirePrompt(agent, rpcId)` 释放上传。
4. `steer` → `agent.inbox.remove(itemId)` + `agent.steer(message)`（原地转 steering）。
5. 冷 Agent（未 attach）：先 `agents.resolveAgent` 唤醒再操作（"restoring an ordinary cold Agent when needed"）。subagent 归属校验：仅 `continuable` 模式子代理允许。

能编辑/删除什么状态的消息：**只要还在 inbox（pending，未被 claim）**。一旦被 claim（进了 turn、落成 `user/message`），updateQueue 报 `queue-item-not-found`；编辑已消费消息要走 feedback/message-delete 之类的另一域。

### 4.2 Remote 面 / 客户端调用

- Remote：`@Remote('updateQueue') updateQueue(request)`（`index.ts:509-512`）→ `commands.updateQueue`。
- 客户端 `ISession.updateQueue(itemId, action)`（`packages/api/session-controller/src/client/contract/session.ts:118`；实现 `client/sessions/session.ts:366-368` 直发 `remote.session.updateQueue({sessionId, itemId, action})`）。
- UI 用法：QueueDock 每行按钮；输入框空 draft 加速键 = "steer 整个队列"（`packages/client/ui-conversation/src/client/input/hub.ts:295-306`：按 FIFO 对 `inbox['next-turn']` 逐条 `updateQueue(item.id, {kind:'steer'})`，容忍 `steer-unavailable`/`queue-item-not-found` 静默收敛）。

**host 插件内管理排队消息**：直接 `agent.inbox.remove(id)` / `agent.inbox.replace(id, newMsg)` / `agent.inbox.splice(...)`（同样 durable，效果与 updateQueue RPC 一致，只是少一层 rpcId/文件回 收逻辑——若消息带上传附件，remove 时应仿 commands.ts 手动 retire，/btw 纯文本无此需求）。

## 5. 会话日志：排队消息的可见性

- **排队未消费**的消息以完整 UserMessage 存在于 `agent/inbox/spliced.inserted` —— 在 session log（`session.events`/`page`/`follow` 流）里**可见**，且通过 `inbox` 投影（projection key `'inbox'`）暴露给客户端。persistence 格式校验也覆盖它（v2→v3 迁移对 `agent/inbox/spliced.inserted` 每条消息做 source/content 校验，`session-format-v2-to-v3/src/payload.ts:90-93,142-148`）。
- **transcript（对话视图）默认不显示** pending 消息：它要等被 claim 后落成 `user/message`（surface event）才进对话流。Web 端用 "queue dock"（输入框上方排队条）渲染 `inbox['next-turn']` 的 pending 行；`next-step` 中 source.kind==='user' 的行显示为 steering 行。客户端侧 transcript 分类器见 `packages/client/ui-chat/src/client/conversation-nodes/inbox.ts`（`inbox-next-turn`/`inbox-next-step` ConversationNode，把 claim splice 与后续 `user/message` 配对）与 `model/steering-history.ts`。
- 客户端乐观 echo：`beginSubmission({mode, text, attachments})` 注册本地回显，靠 `rpcId` 与 inbox 投影行 / prompt 回执对账（`client/sessions/session.ts:243-257, 860-940`）；`outcome:'canceled'` 的 splice 会把 echo 置 failed。
- /btw 视角：由 host 侧命令直接 followup 插入的消息**没有**客户端 echo（没有 rpcId 对账），但队列行会随 inbox 投影推送自然出现在 queue dock——插件 UI/侧栏如需高亮"这是 /btw 消息"，依赖自定义 source kind 或自己的投影/事件。

## 6. /btw 与 Web 输入框已有 queue/steer 的关系

现状：
- Web 输入框模式由 `resolveSubmitMode(preferred, running, gesture, steeringAvailable)`（`packages/client/ui-conversation/src/client/input/submission-policy.ts:30-39`）决定：**不忙或不可 steer → 一律 'queue'**；忙时 Enter 用用户偏好（busyEnter 设置：queue|steer），Cmd/Ctrl 加速键取反。即"忙碌时排队"已经是默认行为。
- queue 模式 = `session.prompt(..., mode:'queue')` = host `agent.followup()` → `next-turn`。
- steer 模式 = `agent.steer()` → `next-step`，在当前 turn 的下一个 step 边界插入（打断语义）。

/btw 相对它增加的价值（设计建议）：
1. **显式语义与稳定性**：/btw 恒为 followup（'queue'），不受 busyEnter 偏好/加速键影响；用户敲 `/btw …` 即明确"这轮别理我，下轮再说"。也可以在命令里显式区分 `/btw`（next-turn）与潜在的 `/btw now`（remove+steer，同 updateQueue steer）。
2. **来源标记与可管理性**：自定义 MessageSource kind（如 `{kind:'btw', form:'notice', summary}`，仿 webhook）+ 命令自身的 `command/run` 日志（rawInput 已durable），queue dock/侧栏可按 kind 识别并渲染"待办/稍后"分组；管理直接复用 inbox 投影 + `updateQueue`（删除/编辑）。
3. **附带附件与上下文**：`input.attachments:true` 时 `invocation.attachments` 是已落库 blocks，可原样进 followup 消息（/goal 已示范）。
4. **不依赖 Web 客户端**：host 侧命令对 headless/SDK/ACP 等所有 composer 生效（命令注册表是共享的 `ctx.commands`）。

相关既有机制（避免重复造轮子）：
- `agent.inject()`：不唤醒的"下个 step 附加上下文"，适合工具结果的 additionalContexts，不适合 /btw（要的是"下一轮"而非"本轮下一step"）。
- `agent/turn-stopping` 事件：turn 收尾前监听器可 `agent.steer()` 强制再跑一步——/btw 不需要。
- `team/message/queued`（`packages/team/agent-team/src/types.ts:183`）：多 agent 团队的消息投递域，与单会话 inbox 无关。
- schedule（`source:{kind:'schedule'}`）与 webhook（`source:{kind:'webhook'…}`）：host 侧异步注入 prompt 的两个现成范例，/btw 与其结构完全同构，只是触发源是用户命令。

## 7. /btw handler 骨架（综合建议）

```ts
// 插件入口（host 侧，仿 command-goal）
export const name = 'command-btw'
export const inject = ['commands']

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'btw': { kind: 'btw' } & ContextFormed   // 或退化为 { kind: 'user' } 以零迁移风险
  }
}

export function apply(ctx: Context): void {
  ctx.commands.register({
    definitionId: CommandDefinitionId('@your-org/command-btw'),
    name: 'btw',
    description: 'Queue a message for the next turn without interrupting the current one',
    input: { hint: '<text>', attachments: true },
    handler: invocation => {
      const text = invocation.rawInput.trim()
      if (text === '' && invocation.attachments.length === 0) {
        return { kind: 'error', text: 'Usage: /btw <message>' }
      }
      invocation.agent.followup(createUserMessage({
        content: [...invocation.attachments, ...(text === '' ? [] : [{ type: 'text' as const, text }])],
        source: { kind: 'btw' },
      }))
      return { kind: 'success', text: 'Queued for the next turn.' }
    },
  })
}
```

- 运行中：进 `next-turn` 队尾，当前 turn 不受影响，turn 结束后自动作为新 turn 的消息被消费（`turn()` 循环 `inbox.hasPending` 继续）。
- 空闲：`followup` 立即唤醒 driver —— /btw 语义上或许希望空闲时也照常发送（等同普通消息），这是默认行为；若想"永远等下一轮"，需自行判断 `invocation.agent.status`（idle 时给 error 或直接发送，产品决策）。
- 管理：侧栏读 `agent.inbox.nextTurn`（host 内）或 inbox 投影（客户端）；删除 `agent.inbox.remove(id)` / RPC `session.updateQueue({sessionId, itemId:id, action:{kind:'remove'}})`；编辑 `replace` / `{kind:'edit', content:[{type:'text',text}]}`；转立即执行 `{kind:'steer'}`（仅 running + next-turn）。

## 附：关键文件索引

| 主题 | 文件 |
|---|---|
| Agent/followup/steer/inject 契约 | `packages/core/agent/src/runtime-types.ts` |
| Inbox 契约 + InboxTarget/WireState | `packages/core/agent/src/types.ts` |
| 驱动实现（send/turn/step/claim→user/message） | `packages/core/agent-loop/src/agent.ts` |
| durable inbox + 投影 + spliced 追加 | `packages/core/agent-loop/src/inbox.ts`（注册：`…/index.ts:334`） |
| createUserMessage / MessageSource | `packages/llm/llm/src/message.ts` |
| prompt/updateQueue/cancel 命令 | `packages/api/session-controller/src/commands.ts` |
| Remote @Remote('prompt'/'updateQueue'/'cancel') | `packages/api/session-controller/src/index.ts` |
| 请求/动作类型 | `packages/api/session-controller/src/types.ts` |
| 客户端 ISession（prompt/updateQueue/beginSubmission） | `packages/api/session-controller/src/client/contract/session.ts`、`client/sessions/session.ts` |
| 命令注册表/CommandInvocation/command-run|done | `packages/interaction/commands/src/index.ts` |
| /goal 范例 | `packages/goal/command-goal/src/index.ts` |
| schedule 范例（含崩溃恢复重排队） | `packages/schedule/schedule/src/runtime.ts` |
| webhook 范例（自定义 source kind） | `packages/experimental/webhook/src/session.ts` |
| queue/steer 模式决策 | `packages/client/ui-conversation/src/client/input/submission-policy.ts` |
| 队列 steer 批处理 UI | `packages/client/ui-conversation/src/client/input/hub.ts` |
| transcript inbox 分类（claimed/steering 行） | `packages/client/ui-chat/src/client/conversation-nodes/inbox.ts`、`model/steering-history.ts` |
| 消费记账（canceled vs claimed） | `packages/core/agent/src/consumed-work.ts` |
| source kind 迁移白名单 | `packages/session/session-format-v2-to-v3/src/payload.ts:10` |

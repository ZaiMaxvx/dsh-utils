# btw-03 调研笔记：dsh 斜杠命令通道与 transcript 呈现（dsh v0.2.2-rc.2）

源码根：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（下文路径均相对此根）。
目的：为 `/btw` 插件确定命令注册方式、结果在 transcript 中的呈现方式、裸调用交互。

---

## 1. 命令注册核心：`@deepseek-ai/dsh-commands`

包：`packages/interaction/commands/src/`
- `index.ts` — CommandRuntime（cordis Service，`ctx.commands`）+ parseCommand + 执行器
- `types.ts` — CommandResult / SessionEventMap 增补（`command/run`、`command/done`）
- `brand.ts` — `CommandDefinitionId` / `CommandId` 品牌
- `builtin.ts` — 第一方 definitionId 表 + 中英输入别名

### 1.1 CommandDefinition（index.ts:61-78）

```ts
export interface CommandDefinition {
  readonly definitionId?: CommandDefinitionId   // 稳定身份，独立于 name；内置命令靠它被客户端识别
  readonly name: string                          // 无斜杠小写；必须匹配 /^[a-z][a-z0-9_-]*$/u
  readonly description: string                   // 发现 UI 摘要（非空字符串）
  readonly input?: CommandInputDescriptor        // { hint: string; attachments?: boolean }
  readonly recordInput?: boolean                 // 默认 true；false ⇒ command/run 不记 args
  readonly handler: (invocation: CommandInvocation) => CommandResult | Promise<CommandResult>
}
```

`CommandInputDescriptor`（types.ts:20-31）：`hint` 是"用户供给自由输入前的占位符"（composer 菜单行与 claim chip 都展示）；`attachments: true` 才允许命令携带 composer 附件（图片直接编码、文件走 receipt）。

`CommandInvocation`（index.ts:41-58）：`{ commandId, agent, rawInput, attachments, signal }`。`rawInput` 是命令名后的原文（含分隔空白）；`attachments` 是已 admission 的 ImageBlock/FileBlock（未声明 `input.attachments` 时恒为空数组，registry 拒绝）。

`CommandResult`（types.ts:34-41）：

```ts
| { kind: 'success'; text?: string; sourceEventSeq?: SessionSeq }
| { kind: 'error'; text: string }   // error text 必填非空
```

注册方式：`ctx.commands.register(definition)`（index.ts:285-292，返回 effect disposer）。普通 ctx 注册为全局；在 agent ctx 的 command-injected 子上下文注册则为该 agent 的 scoped shadow。同名同层抛错。宿主插件典型写法（plan-mode:232）：

```ts
ctx.inject(['commands'], (commandCtx) => {
  commandCtx.commands.register({ definitionId: ..., name: 'plan', ... })
})
```

### 1.2 执行流程 `CommandRuntime.execute`（index.ts:360-431，`@Remote`）

签名：`execute(agent, line, submittedAttachments, signal): Promise<CommandExecution | undefined>`

1. `parseCommand(line)`（index.ts:125-132）：正则 `/^\/([a-z][a-z0-9_-]*)(?=$|[\t\n\r ])/u`；名字后必须是行尾或空白。不匹配 → `undefined`。
2. `view(agent).get(name)` 未知名 → `undefined`。**admission miss（语法错/未知名）不写任何日志**。
3. mint `commandId`：`cmd-<instanceToken8>-<seq>`（重启不重复）。
4. 直写 `command/run`（log-only，不开 turn、不 flush）：
   `{ commandId, name, args?: string, source: { kind: 'user' } }`——`args` 是 parseCommand 的原样 rawInput；**`recordInput === false` 时省略 args**（此时命令自己的域事件拥有 payload，如 /feedback 的 `feedback/record`）。
5. 附件 admission（index.ts:389-420）：未声明 `input.attachments` 却带附件 → settle `{kind:'error', text: '/btw does not accept attachments'}`；图片经 attachment store 入库；文件 receipt 由 `registerFileReceiptResolver` 解析（file-upload 包注册，`packages/client/file-upload/src/index.ts:71-78`）。
6. 调 `handler(invocation)`；返回值经 `normalizeResult` 校验/冻结。handler throw/abort → `settleThrown` 写 `command/done { kind:'error', text: 错误渲染 }` 后原样 rethrow。
7. settle：写 `command/done` `{ commandId, kind, text?, sourceEventSeq? }`，返回 `CommandExecution = { commandId, result }`（冻结）——commandId 供 UI 把 RPC 应答与流节点配对。

要点：`command/run`/`command/done` 是 **log-only（非 surface）** 事件（`SessionEventMap` 增补在 types.ts:93-119；KNOWN_SESSION_EVENT_TYPES 含二者，`packages/core/session/src/known-event-types.ts:30-31`），**永不进入模型上下文**——命令结果不会被当成模型消息。`Session.append` 对非 surface 事件不接受 surface opts（`packages/core/session/src/index.ts:853-857`）。

`commands/change` cordis 事件（types.ts:81-91）在任一注册/注销时广播（通知性、不可否决），客户端据此失效命令目录。

---

## 2. transcript 呈现：命令卡片

### 2.1 事件折叠成 CommandNode

`packages/client/ui-chat/src/client/conversation-nodes/command.ts`（`commandDefinition`，kind `'command'`，target `'chat'`）：
- `command/run` → start（id=commandId）；`command/done` → update；另吸收 `/compact` 关联的 compaction 生命周期（checkpoint user/message 的 `source.sourceCommandId`、`compaction/start|summary|end` 的 `sourceCommandId`）。
- 产出 `CommandNode`（`packages/client/ui-conversation/src/client/contract/records.ts:234-256`）：

```ts
{ kind: 'command'; seq; time; commandId; name: string | null; args: string | null;
  outcome: { kind: 'success'|'error'; text?: string; sourceEventSeq?: number } | null }
```

窗口切在 run/done 之间时软降级（done 无 run 也能建节点，name/args 为 null；run 无 done 渲染为"执行中"）。

### 2.2 `conversation.chat.commandview` 槽（keyed by 命令名）

声明：`packages/client/ui-chat/src/client/contract/slots.ts:476-480`

```ts
'conversation.chat.commandview': { kind: 'keyed'; scope: 'session'; owner: CommandRowOwnerProps }
export interface CommandRowOwnerProps { node: CommandNode; compaction?: CompactionSummaryNode }
```

消费点：`packages/client/ui-chat/src/client/chat/CommandNodeView.tsx`（'command' ChatNodeKind 渲染器，经 `register-node-renderers.ts:70-75` 把本槽作为 children 注入）：

```tsx
renderSlot('conversation.chat.commandview', owner, {
  entryKey: command.name ?? '',                       // key = 命令名（无斜杠）
  fallback: <GenericCommandCard {...owner} t={t} />,  // 未占用 key 走通用卡
})
```

**第三方插件可以为自己的命令注册自定义卡片**，且被官方插件目录收录为公开能力：
- 先例：`packages/client/ui-agent-team/src/client/mount.ts:36-38` 为 `/team` 注册 `TeamCommandRow`：

```ts
ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register(
  { name: 'conversation.chat.commandview', key: 'team', locale: NS }, TeamCommandRow))
```

- `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:284-336` 把该槽列为客户端插件可注册项（occupants 记有 `client-ui-agent-team TeamCommandRow key 'team'`，replaceRisk `shadows-shipped-ui`），示例即 `ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name: ..., key: '<命令名>' }, Component))`。
- 卡片组件 props：`PropsRuntime<'conversation.chat.commandview'>`（含 `node`、`t` 等；`TeamCommandRow.tsx` 只用 `{ node, t }`）。注意 key 是**命令名**而非 definitionId。

### 2.3 内置卡片长相

`GenericCommandCard.tsx`（兜底，所有无专属渲染器的命令）：
- DisclosureRow：icon（IconApiOutlineRegular）+ title（命令名）+ 摘要。
- 摘要：`outcome === null` → shimmer "command.running"；done 后 → `outcome.text`（单行直接展示）；无 text → "command.done"/"command.failed"。
- `outcome.text` 含换行 → 可展开 `<pre>` 显示多行文本；单行文本只作摘要不展开。
- data-state: running/ok/error 样式；error 高亮。

`/compact` 特例：conversation-nodes/command.ts:207-215——name === 'compact' 的 command 节点改产 `'manual-compaction'` ChatNodeKind，由 `CompactionCommandCard` 呈现"命令 + compaction 事务摘要（阴影条数/token 数 + checkpoint）"（`ManualCompactionChatData = { command, compaction }`）。
`/feedback`、`/plan` 等其余命令都用 GenericCommandCard（消费 `command/done` 的 `text`）。

### 2.4 sourceEventSeq（types.ts:38-39）

- 语义："Earlier authoritative domain event that owns a richer presentation"——success 结果可指向 handler 执行期间自己 append 的更早域事件 seq，客户端据此做富呈现（去 transcript 事件窗口取该 seq 的事件自行渲染）。
- 唯一内置生产者：`/compact`（`packages/compaction/command-compact/src/index.ts:72`，`sourceEventSeq: result.summarySeq` 指向 `compaction/summary` 事件）。/compact 的富呈现实际走 manual-compaction 节点的另一套关联（checkpoint `sourceCommandId`），`CommandNode.outcome.sourceEventSeq` 对 GenericCommandCard 是惰性字段——**第三方自定义卡片是它设计的消费方**。
- 校验：非负安全整数（index.ts:237-241），只允许出现在 success。

---

## 3. 带 prompt 副作用的命令先例

**`/plan`（`packages/plan/plan-mode/src/index.ts:232-277`）——最重要的先例**：

```ts
handler: ({ agent, rawInput, attachments }) => {
  const message = rawInput.trim()
  if (message === 'off') { ...切换状态，返回 success 文本... }
  const outcome = this.set(agent, true)            // append 'plan/mode'（log-only）
  if (message !== '' || attachments.length > 0) {
    agent.steer(createUserMessage({                // 副作用：把用户消息注入下一步模型轮次
      content: [...attachments, { type: 'text', text: message }],
      source: { kind: 'user' },
    }))
  }
  return { kind: 'success', text: 'Plan mode on. ...' }
}
```

要点：
- 命令结果文本只是**状态确认**（"Plan mode on."）；真正的用户内容经 `agent.steer()` 成为 steering user message，进入下一 step 的模型请求并触发轮次。
- `agent` API（`packages/core/agent-loop/src/agent.ts:171-190`）：`followup(m)` = send('next-turn', wake)；`steer(m)` = send('next-step', wake)；`inject(m)` = send('next-step', 不 wake)。plan-mode 状态切换在空闲时还用 `agent.inject(narration)` 附加一句"用户切换了模式"的旁白（source `{kind:'plan-mode', form:'notice'}`）。
- 避免命令结果被当成模型消息的机制是结构性的：`command/run`/`command/done` 是 log-only 非 surface 事件，永不投影为消息；handler 要发模型内容必须显式走 `agent.steer/inject/followup`（产生真正的 user/message surface 事件）。

其他先例：
- `/feedback`（`packages/feedback/command-feedback/src/index.ts:119-126`）：`input: { hint: '<text>' }, recordInput: false`；handler append 自己的域事件 `feedback/record`（args 不进 command/run，域事件拥有 payload）。空文本 → error "Usage"。
- `/goal`（`packages/goal/command-goal/src/index.ts:191-197`）：`input: { hint: '[<objective>|clear|edit <objective>|pause|resume]', attachments: true }`。
- `/compact`（`packages/compaction/command-compact/src/index.ts:101-106`）：无 input（不收参数）；有 rawInput → error "Usage: /compact (no arguments)"；teardown 前排空在途 handler。
- `/permission`（`packages/interaction/permission-presets/src/index.ts:255-274`）：`input: { hint: '<preset>' }`；裸调用返回当前值+可选列表的 success 文本；**故意不给 settlement text 冗余命名**（web 命令行渲染 `name · text` 会重复）。
- `/export`（`packages/session-query/session-log-export/src/index.ts:81-88`）：无 input，裸调用返回 REQUESTED；带参数 → error。
- file-upload（`packages/client/file-upload/src/index.ts`）不注册命令，只 `registerFileReceiptResolver` 供命令附件解析文件 receipt。

---

## 4. composer 交互：解析、菜单、claim、裸调用装饰

### 4.1 `/btw hello` 在输入框里的解析路径

客户端命令面：`packages/client/ui-commands/src/client/service.ts`（`ctx.commandUi`，CommandUiRuntime，注册为 `'/'` input-trigger source）。目录来自 `remote.commands.list(sessionId)`（Typert Remote，session 级缓存；`commands/change` / `agent-preset/selected` / `connection/reset` 失效）。

`matchEnter`（service.ts:319-366，Enter 提交决策表）——`/btw hello`：
1. 行首 `/`，拆出 token `/btw`，非 bare（ws ≠ -1）。
2. 非客户端 contribution → `directory.resolve()`（typed 名或内置 zh/en 别名，`builtin.ts:43-49`；别名只选第一方 definitionId，exact scoped name 优先）。
3. **bare 才查 decoration**（argued 行不查）。
4. `desc.input !== undefined`（/btw 声明了 hint）→ 返回 claim：`{ name:'btw', token:'/btw ', hint, attachments?, submit(args, actx, attachments) }`，`submit` = `remote.commands.execute(sessionId, '/btw '+args, attachments)`（service.ts:395-405）。
5. 无 input + 非 bare → `undefined`（行不被命令通道认领，**作为普通 prompt 发给模型**——无 input 的命令带参数会变成普通消息）。
6. 无 input + bare → consume token + `runDetached('/btw')`（fire-and-forget）。

claim 机制（`packages/client/ui-conversation/src/client/contract/input.ts:40-55`）：composer 把 `token`（`'/btw '`）渲染为 chip 并插入分隔空格，`hint` 作占位提示；Space 键也触发（`matchSpace`/`claimOf`，service.ts:279-301）；后续 Enter 以 args 调 `claim.submit`。`SubmitAttachment` = 编码 image（png/jpeg/webp/gif base64）或 file receiptId（input.ts:19-26）。

附件门禁（service.ts:332-362）：带附件的提交只允许 (a) 声明 `input.attachments === true` 的 claim，或 (b) action 类（不提交）；否则抛拒绝错误 → composer notice，draft+附件原样保留。`execute()`（service.ts:418-433）：result 未匹配 → error outcome；**error outcome 时 composer 保留 draft/附件**；success 时 composer 不回显（transcript 流节点负责呈现）；本 tab 广播 `'command/executed'(sessionId, name, result)` 客户端事件（service.ts:57）。

### 4.2 裸 `/btw`（无参）的行为与最佳交互

内置决策表对裸调用的行为：
- 无 decoration、有 `input.hint`：bare enter / 菜单点选都返回 **claim**——不执行，进入"参数输入模式"（chip `/btw ` + hint 占位），等用户补参数再提交。
- 无 decoration、无 input：立即 `runDetached` 执行。
- **decoration 存在（`ctx.commandUi.decorate`）**：菜单点选或 bare enter 触发 decoration 的 UI（popupSelect 弹选择器或 action），**argued 行永不咨询 decoration**。

`CommandDecoration` 契约（`packages/client/ui-commands/src/client/contract.ts:125-132`）：挂在 **HOST 命令名** 上的裸调用 UI——"the decoration replaces only the bare menu-pick/enter with a popup whose onSelect typically submits a completed line back through command.execute"。不制造菜单行（host 目录无此名则 decoration 不可达），不碰参数 claim 与生命周期日志。`CommandUiSpec`：`popupSelect`（`options(session, signal)` → SelectOption[]，`onSelect(option, session)`，可选 searchMode/'fuzzy-label'、searchLabels）或 `action`（`run(session)`，零提交）。

先例：
- **`/permission`**（`packages/client/ui-permission-presets/src/client/index.ts:186-200`）——最贴近 /btw 的样板：

```ts
command.decorate({
  name: 'permission',
  available: session => selectionOf(sessionFor(session)) !== undefined,
  ui: {
    kind: 'popupSelect',
    options: async session => optionsOf(await catalog.load(), ...),
    onSelect: (option, session) => submit(session.sessionId, option.id),  // submit → session.command(`/permission ${preset}`)
  },
})
```

  其 `submit` 走 `live.command('/permission ' + preset)`（index.ts:133-142）——即 `SessionFace.command(line)`（`packages/api/session-controller/src/client/sessions/session.ts:413-417`）→ `remote.commands.execute(sessionId, line, [])`。
- `/model`（`packages/client/ui-model-selection/src/client/index.ts:129-153`）是**纯客户端 contribution**（`command.register({ name:'model', ui:{ kind:'popupSelect', ... } })`）——无 host 命令，菜单行由客户端自造。/btw 需要 host 生命周期日志，不适用此路。
- `commandUi.dismiss(name)` 关闭该命令的过期 popup。

菜单行（`candidates`，service.ts:224-250）：host 目录行（内置命令有本地化 label/description/icon——`presentation.ts` HOST_FACES 按 definitionId；**第三方命令用 descriptor.description**，`input.hint` 显示为 hint，仅 leading 位置可见）；客户端 contributions 追加；空 query 分 Add/Commands 两节（SECTION_ROWS 固定顺序，未知行排在 Commands 节尾），typed query 用共享 rankByName。

### 4.3 /btw 推荐交互（结论）

- 声明 `input: { hint: '<text>' }`（要参数）：`/btw hello` 走 claim → execute，体验与 /plan 一致。
- 裸 `/btw`：客户端插件用 `commandUi.decorate({ name:'btw', ui:{ kind:'popupSelect', options, onSelect } })` 弹选择器（例如列出最近的搁置记录），onSelect 组完整行 `/btw <text>` 经 `command.execute` 提交——即 /permission 模式。无客户端插件时裸调用退化为 composer 的参数输入模式（chip+hint），不会误执行。
- 不声明 input 的方案（bare 立即执行）只适合零参数命令（/compact、/export 风格），不适合 /btw。

---

## 5. SDK / 无 UI 场景

- Web SDK（session-controller client）：`SessionFace.command(line): Promise<RemoteResult<{ matched: boolean }>>`（`packages/api/session-controller/src/client/contract/session.ts:166`；实现 `.../sessions/session.ts:413-417`）直接走 `remote.commands.execute`。**任意注册命令（含第三方 /btw）都可用**——ui-permission-presets 的 popup 就这么提交。纯 admission 语义：结果不回显，靠 session 事件流上的 command/run|done 节点。
- Remote 服务：`remote.commands.list(sessionId)` / `remote.commands.execute(sessionId, line, attachments)`（ui-commands service.ts:108、423）。
- **Desktop SDK（`packages/sdk/server/src/server.ts:289-332`）**：`query()` 对 `/` 开头文本调 `queryCommand()`（`packages/sdk/server/src/query-input.ts:14-27`）——**白名单只认第一方 definitionId**：`compact`（仅 bare）、`permission`（仅带参）、`plan`/`goal`（bare 或带参）。第三方命令不识别 → **`/btw hello` 作为普通 prompt 文本发给模型**。即 /btw 在 SDK query 输入不可用（除非 SDK 协议将来开放命令路由；无插件钩子）。
- 命令生命周期以 `session.query.completed` 通知收尾（`packages/sdk/protocol/src/types.ts:198-201`，按 commandId 关联）。

---

## 6. /btw 插件落地清单（基于以上事实）

1. **Host 插件**注册命令（cordis `ctx.inject(['commands'], ...)`）：
   - `definitionId: CommandDefinitionId('<plugin-ns>/btw')`（stable，客户端识别用）
   - `name: 'btw'`，`description`（菜单行文案来源）
   - `input: { hint: '<text>' }`（需要自由文本参数；要收附件加 `attachments: true`）
   - handler 内：需触发模型轮次 → `agent.steer(createUserMessage({ content: [...], source: {kind:'user'} }))`（/plan 先例）；仅记录 → `agent.session.append('<btw/…>', payload)`（第三方域事件不在 KNOWN_SESSION_EVENT_TYPES，须带 `ignorable` 标记以便旧读者安全跳过，见 `packages/core/session/src/known-event-types.ts` 头注与 `SessionEvent.ignorable`，`core/session/src/types.ts:524`）。
   - 结果 `text` 保持单行短确认（多行会变成可展开 pre）；富数据走域事件 + `sourceEventSeq`。
   - `recordInput`: 默认 true（command/run 记 args，transcript 卡片可显示命令行）；若域事件已含 payload 可 false。
2. **客户端插件**（可选增强）：
   - 自定义卡片：`ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({ name:'conversation.chat.commandview', key:'btw', locale: NS }, BtwCommandRow))`；组件收 `{ node: CommandNode, t }`，可读 `node.outcome.sourceEventSeq` 取域事件做富呈现。
   - 裸调用：`ctx.commandUi.decorate({ name:'btw', ui:{ kind:'popupSelect', ... } })`，onSelect 组完整行提交（/permission 样板）。
   - 本 tab 即时反馈可监听 `'command/executed'` 客户端事件。
3. **注意**：Desktop SDK query 不路由第三方命令；Web SDK/Remote 一切正常。

---

## 附：关键文件索引

| 主题 | 文件 |
|---|---|
| 注册/执行/parseCommand | `packages/interaction/commands/src/index.ts` |
| 事件与结果类型 | `packages/interaction/commands/src/types.ts` |
| definitionId/别名 | `packages/interaction/commands/src/{brand,builtin}.ts` |
| 命令节点折叠 | `packages/client/ui-chat/src/client/conversation-nodes/command.ts` |
| CommandNode 契约 | `packages/client/ui-conversation/src/client/contract/records.ts:234` |
| 槽声明/owner props | `packages/client/ui-chat/src/client/contract/slots.ts:296-303,476-480` |
| 卡片消费+fallback | `packages/client/ui-chat/src/client/chat/CommandNodeView.tsx` |
| 通用卡片 | `packages/client/ui-chat/src/client/chat/GenericCommandCard.tsx` |
| 第三方卡片先例 | `packages/client/ui-agent-team/src/client/{TeamCommandRow.tsx,mount.ts:36}` |
| 插件槽目录 | `packages/extensions/cordis-client-runner/src/client/slot-catalog.ts:284` |
| /plan（steer 先例） | `packages/plan/plan-mode/src/index.ts:232-277` |
| agent.steer/inject | `packages/core/agent-loop/src/agent.ts:171-190` |
| /feedback（recordInput:false） | `packages/feedback/command-feedback/src/index.ts` |
| /compact（sourceEventSeq） | `packages/compaction/command-compact/src/index.ts:59-79` |
| composer 决策表 | `packages/client/ui-commands/src/client/service.ts` |
| decorate/contribution 契约 | `packages/client/ui-commands/src/client/contract.ts` |
| /permission decorate 先例 | `packages/client/ui-permission-presets/src/client/index.ts:133-200` |
| claim 契约 | `packages/client/ui-conversation/src/client/contract/input.ts:19-55` |
| Web SDK command | `packages/api/session-controller/src/client/sessions/session.ts:413` |
| SDK query 白名单 | `packages/sdk/server/src/{server.ts:289,query-input.ts}` |

# 调研笔记 04：Agent 生命周期、事件系统与消息流（dsh v0.2.2-rc.1）

> 源码根：`D:/Code/Projects/dsh-utils/dsh-source/src`（GitHub deepseek-ai/deepseek-harness tag dsh-v0.2.2-rc.1）
> 调读范围：docs/agent-lifecycle(.zh).md、docs/event-producer-consumer.md、docs/capability-seams.md、docs/glossary.md、packages/core/{agent,agent-loop,session,system-prompt}、packages/llm/llm、packages/api/session-controller、packages/client/{ui-chat,ui-trajectory}

---

## 1. Agent 生命周期状态机

### 1.1 权威文档

- `docs/agent-lifecycle.md`（中文版 `docs/agent-lifecycle.zh.md` 同步生成）：Mermaid 时序图，"durable replay 事实在 `session/event`，live 控制/状态在 `agent/*`"。
- 驱动实现：`packages/core/agent-loop/src/agent.ts`（`ReactLoopAgent`，唯一具体 loop，`ctx.agentLoop` bundle seam）。

### 1.2 状态与 Phase

`AgentStatus = 'idle' | 'running'`（`packages/core/agent/src/runtime-types.ts:136`）。内部 Phase（agent.ts:53-61）：

```
idle ──(waking input)──▶ running ──(drain 完成)──▶ idle
  └─(runMaintenance)──▶ maintenance ──▶ idle      // 维护任务不改变公开 status（仍算 idle）
```

- `setPhase()` 在 idle/running 翻转时 emit `agent/status`（agent.ts:161-168）。
- `wakeDriver()`：idle 时进入 running 并 `kick()`；maintenance 或已 abort 的活动会 latch `wakeRequested` 待收敛后重放（agent.ts:230-251）。
- `whenIdle()`：跟随整个 agent 活动归静（含接替驱动）。

### 1.3 Turn / Step 循环（生命周期图）

```
followup/steer/inject ──▶ Inbox(next-turn / next-step)          [durable: agent/inbox/spliced 事件]
        │ wakeup
        ▼
   agent/status=running ──▶ kick() ──▶ while(turn())
        │
   turn N: session.append('turn/start')                          ── durable
        │
        ├─ preStep(target):
        │    1. inbox.claim()                 → emit agent/inbox/claimed（消息从 inbox 移除）
        │    2. model.current()               （无 provider/model 则 throw）
        │    3. ctx.tools.resolve({agent, modelSelection, signal})
        │    4. ctx.systemPrompt.assemble()   → waterfall 'system-prompt/assemble'
        │    5. waterfall 'agent/pre-step'    → {kind:'reject'} 或 {kind:'enter', messages[], startsRequestSeries?}
        │       (reject ⇒ turn/end{blocked}，claimed 消息不回 inbox 也不落 user/message)
        │
        ├─ step S: session.append('step/start')
        │    a. prepareRequest(): waterfall 'agent/request'(deprecated，仅改 LlmCallConfig)
        │       + ctx.llm.prepareCall(config, signal)     ← 此阶段取消则 system/user 均不落盘
        │    b. 同步 admission（按日志顺序落盘，模型可见内容的唯一通道）:
        │         session.append('system/message', ...)   （prompt 变化时）
        │         session.append('user/message', ...)     （每条 admitted 消息，含 runtime-context）
        │    c. buildRequest(): append 'request/header'(+reason) / 'request/context'
        │       → request = {config, messages: session.deriveMessages(), toolHistory, tools, sessionId, signal}
        │       （发给 LLM 的 messages 完全由 session log 派生，deep-frozen）
        │    d. llm.stream(request)（经 waterfall 'llm/stream'）→ emit agent/assistant-stream 帧*
        │    e. settlement:
        │         成功 ⇒ append 'assistant/message'（含 usage、紧凑 timed stream）
        │         失败/取消/流错误 ⇒ append 'assistant/attempt'（仅 stream，无表面消息）
        │         取消但已有可见前缀 ⇒ append 'assistant/message' {interrupted:true}（前缀内容）
        │    f. waterfall 'agent/request-error'（可返回 {kind:'retry'} 在同 step 内重试，
        │       不重复 pre-step / user admission）
        │    g. 有 tool-call ⇒ ctx.tools.execute()（每个调用 append 'tool/call' / 'tool/result'；
        │       additionalContexts 回插 next-step inbox；结果带 concludesTurn 可提前结束 turn）
        │    h. append 'step/end'；dispose step toolSet
        │
        ├─ 自然停止且 next-step inbox 空 ⇒ serial 'agent/turn-stopping'
        │    （监听者可 agent.steer() 阻止关闭 → 再跑新 step；否则 break）
        │
        └─ append 'turn/end'{reason: completed|aborted|blocked|error|max-tokens}
   循环下一 turn（inbox 有 pending 时换新 AbortController）→ 否则 idle
```

关键代码位置：
- `turn()`：agent.ts:327-433；`preStep()`：283-317；`step()`：435-610；`prepareRequest()`：613-653；`buildRequest()`：656-744。
- `TurnEndReason`（`packages/core/session/src/types.ts:206-238`）：`completed` / `aborted{reason: AgentCancelCause}` / `blocked` / `error{LlmFailure}` / `max-tokens` / `interrupted`（crash 孤儿 turn 由 resume 补记）/ `forked`（仅 fork 种子）。

### 1.4 用户消息何时被消费 / 可打断

三条入口（runtime-types.ts:244-271，agent.ts:170-189）：

| API | target | wakeup | 语义 |
|---|---|---|---|
| `agent.followup(msg)` | next-turn | 是 | 普通追问，独占一个新 turn |
| `agent.steer(msg)` | next-step | 是 | 运行中的 agent 在下一个 step 边界消费（steering） |
| `agent.inject(msg)` | next-step | 否 | 注入上下文（文件变更通知、skill 内容等），不唤醒 |

- 消息先进入 durable inbox：每次变更 append `agent/inbox/spliced` 事件（`packages/core/agent-loop/src/inbox.ts:215-231`；事件类型由 `packages/core/agent/src/types.ts:103-110` merge 进 SessionEventMap）。崩溃后由 session projection（`inboxProjectionDefinition`，inbox.ts:26-64）重建 pending 列表。
- **消费点**：`preStep()` 的 `inbox.claim()`（inbox.ts:108-113）——先清空 next-step，再从 next-turn 取 1 条；每条 emit `agent/inbox/claimed`。被 pre-step reject 的消息既不回 inbox 也不落 `user/message`（"claimed batch stays removed"）。
- **成为模型历史**：仅在 step 内 admission 段 append `user/message`（agent.ts:463-477）。在此之前消息只是 inbox 投影，不在派生历史里。
- **可打断窗口**：整个 turn 期间 `signal.throwIfAborted()` 遍布（prepareRequest 前后、流循环每 chunk、工具执行）。abort 发生在 prepareCall 或 admission 之前 ⇒ 既不落 system 也不落 user；发生在流中 ⇒ 已交付前缀固化为 `assistant/message{interrupted:true}`（agent.ts:502-525）。

### 1.5 取消 / 中断机制（abort、interrupt、stop）

- `agent.cancel(cause, {keepInbox?})`（agent.ts:191-197）：
  - `AgentCancelCause = {kind:'user'} | {kind:'parent'} | {kind:'hook', reason} | {kind:'disposed'}`（session/src/types.ts:194-198）。
  - 默认 `keepInbox=false`：先 `inbox.clear()`（durable splice，`outcome:'canceled'`），再 `phase.abort.abort(cause)`。
  - `keepInbox=true`：仅中止活动 turn，保留排队与 steering 输入。
- cancel 后到达的 waking 输入自动改投 next-turn（agent.ts:173-176 `wakingAfterAbort`），等活动收敛到 idle 再开新 turn；`disposed` cancel 则将其停摆。
- UI 停止按钮链路：`packages/api/session-controller/src/commands.ts:476` → `agent.cancel({kind:'user'}, {keepInbox:true})`（RPC 面 `SessionCancelRequest`，types.ts:363-371；客户端 `packages/api/remotes/src/client/.../session.ts:378`）。
- `agent/turn-stopping`（serial，runtime-types.ts:400-417）：turn 即将自然关闭的最后检查点，监听者 steer 即可续跑；反向控制（提前停工具循环）是数据：tool result 带 `concludesTurn`。
- 子 agent 由父级以 `{kind:'parent'}` 取消；hook 以 `{kind:'hook', reason}`。
- `consumedWork`（`packages/core/agent/src/consumed-work.ts`）：从日志判定"哪些被认领的工作真的跑过/被丢弃未跑"，区分 no-op turn 与被打断的 turn —— rewind 判定回滚边界时可复用此判别逻辑。

---

## 2. 事件系统架构

### 2.1 Cordis 事件总线（四种 dispatch mode）

事件通过 Cordis `ctx.events` 声明式接口（`declare module '@deepseek-ai/cordis' { interface Events {...} }`）merge 扩展。四种 mode（见 event-producer-consumer.md "Mode" 列）：

| mode | 语义 | 代表 |
|---|---|---|
| `emit` | 广播，fire-and-forget | `agent/status`、`session/event` |
| `waterfall` | 链式，可改写传递值或短路（不调 `next()`） | `agent/pre-step`、`llm/stream`、`system-prompt/assemble`、`tools/execute` |
| `serial` | 顺序 await，全部执行 | `agent/created`、`agent/turn-stopping` |
| `parallel` | 并行 await 全部 | `session/flush`、`workspace/session-stop` |

`@deepseek-ai/dsh-scope` 提供 scope 过滤：agent-scoped 监听者只收到该 agent 的事件（`Scoped<Agent>` this）。

### 2.2 双轨事件：live `agent/*` vs durable `session/*`

- **`agent/*`**（声明于 `packages/core/agent/src/runtime-types.ts:274-431`）：进程内协调 API（队列/状态/拦截/转向/错误）。SDK 用户要可回放数据应消费 `session/event`（agent-lifecycle.md:91）。
- **`session/*`**（声明于 `packages/core/session/src/index.ts:40-85`）：`session/created`、`session/disposed`、`session/event`（提交后 fire-and-forget 逐事件 feed）、`session/flush`（并行耐久检查点）。Session 事件本体（SessionEventMap）进 append-only 日志。

### 2.3 `agent/*` 事件清单（完整）

| 事件 | mode | 载荷要点 | 说明 |
|---|---|---|---|
| `agent/created` | serial | `{agent, source: startup\|resume\|clear\|compact, signal?}` | 创建后逐个 await，抛错即创建失败 |
| `agent/disposed` | emit | `{agent}` | 驱动静默 + scope 解退之后、session 脱离之前 |
| `agent/status` | emit | `{agent, status: idle\|running}` | 每次翻转 |
| `agent/inbox/inserted` | emit | `{agent, message}` | 入 inbox |
| `agent/inbox/claimed` | emit | `{agent, message, turn}` | 被 preStep 认领 |
| `agent/inbox/discarded` | emit | `{agent, message}` | 从 inbox 丢弃 |
| `agent/pre-step` | waterfall | `{agent, messages, turn, step, signal, modelSelection}` → `PreStepDecision` | **可 reject 步骤或替换进入消息** |
| `agent/request` | waterfall（**deprecated**） | `{agent, turn, step, signal}` → `LlmCallConfig` | 只能改 config（且 provider/model/effort 必须与已固化 selection 一致，否则 throw）；**不能改 messages** |
| `agent/request-error` | waterfall | `{agent, turn, step, provider, failure, retryPolicy, signal}` → `{kind:'retry'} \| undefined` | 拥有恢复的监听者不调 next() 返回 retry |
| `agent/assistant-stream` | emit | `{agent, frame: start\|chunk\|end}` | 瞬态流帧；重放读 durable settlement |
| `agent/turn-stopping` | serial | `{agent, turn, signal}` | turn 自然关闭前检查点 |
| `agent/error` | emit | `{agent, turn, step, error}` | 步/turn 级失败上报 |

另有 `agent-loop/config-start-failed`（emit，agent-loop 内部）。

### 2.4 Session 日志事件（SessionEventMap，durable）

核心词汇（`packages/core/session/src/types.ts:287-436`，全量 62 项见 `known-event-types.ts`）：

- **边界**：`turn/start`、`turn/end`、`step/start`、`step/end`、`session/end-seed`（fork/继承切分标记）
- **消息（surface 型，5 种）**：`system/message`、`developer/message`、`user/message`、`assistant/message`（含 `usage`、紧凑 `stream`、`interrupted?`）、`tool/result`
- **非表面**：`assistant/attempt`（失败/取消/重试的流，无表面消息）、`tool/call`、`request/header`（reason: initial/resume/change/series + startsSeries）、`request/context`
- **merge 扩展示例**：`agent/inbox/spliced`（agent 包声明）、`compaction/start|end|prune|summary`、`model/selection`、`todo/write`、`plan/mode`、`feedback/*`、`subagent/*`、`tool-workflow/*`、`job/*`、`goal/change`、`schedule/change`、`working-directory/change`、`image/offload`、`llm/retry(-started)`、`approval/*`、`command/*`、`session/title*` 等（插件经 PluginRecordMap/`plugin:` 前缀还可以写自有记录，需 `ignorable` 标记策略）

**SurfaceOp**（types.ts:470-472）是理解"历史可变性"的关键：
- `'append'`：追加到尾（正常路径）
- `{op:'replace', startSeq, endSeq}`：**替换** surface 节点区间为这一个节点（compaction 用；"任何 surface-replacing 生产者都可以用"）—— 日志仍 append-only，被替换节点只是不再投影。

### 2.5 其他与消息流相关的事件（producer-consumer 矩阵摘录）

- `system-prompt/assemble`（waterfall，`packages/core/system-prompt/src/index.ts:31`）：组装后的 sections/contexts/variables 展示瀑布，**文本权威**；complete section 会被恢复，监听者无法覆盖。
- `system-prompt/change`（emit）、`tools/change`（emit）
- `llm/stream`（waterfall，`packages/llm/llm/src/index.ts:75`）：每次流式模型调用外围（含 retry/replay/routing）。loop 构建的请求带 `markAgentLoopRequest` 标记且 **deep-frozen（改写即 throw）**——"内容是 session log 的纯函数（可重构性）"，监听者只能读或短路自产 chunks（`llm-replay` 测试件即如此）。
- `tools/pre-execute` / `tools/execute` / `tools/post-execute`（waterfall）+ `tools/result`（emit）、`tools/ptc-dispatch-log`
- `approval/request`（waterfall，权限决策）、`user-questions/request`
- `workspace/session-activity`（waterfall）/ `workspace/session-stop`（parallel）：workspace 对 session 生命周期的事件闸门
- `subagent/start|end|provider-added|provider-removed`、`workflow/*`
- `session-persistence`（seam，jsonl 后端）经 `session/flush` 落盘；`session-checkpoint-policy` 决定 per-request 耐久检查点

---

## 3. 消息发送前的拦截点（prompt 组装链）

按请求构建顺序，插件可介入的全部位置：

| 时机 | 事件/API | 能改什么 | 不能改什么 |
|---|---|---|---|
| 步骤入口 | `agent/pre-step`（waterfall） | **reject 整个 step**；替换/增删进入该 step 的 UserMessage 批（`enter{messages}`）；`startsRequestSeries` | 不能在 step 已开后插队（rejected step 的 claimed 消息不退回） |
| system prompt | `ctx.systemPrompt.section/context/variable` 注册 + `system-prompt/assemble`（waterfall） | 段落文本、动态 context、变量、（经 `tools provider`）工具 schema 声明 | complete section 归注册者；工具声明 provider-owned |
| 调用配置 | `agent/request`（waterfall，deprecated） | `LlmCallConfig` 的控制项（maxTokens 等） | **provider/model/effort 锁死**；**不能改 messages**（"Model-visible content must use logged channels"） |
| 最终请求 | `llm/stream`（waterfall） | 读完整 `GenerateOptions`（含 messages、tools、signal）；**短路**（自产 chunks，如 replay/mock） | loop 请求 deep-frozen，**不可改写 messages** |
| 持久层 | `Session.append(..., {surfaceOp})` | 以 `replace` 替换已有 surface 节点（compaction 模式）；`sourceEventSeqs` 引用 | 日志 append-only，不能删事件；`session/end-seed` 只有构造器/fork 可写 |
| 派生层 | `SessionStore.registerMessageProjection`（纯解释器） | 对特定事件类型改派生 message 内容（如 `image/offload`） | 不改节点成员与消息身份 |

**结论：不存在任何"发消息前修改已进入历史的 messages"的运行时钩子**。发给 LLM 的 messages 恒等于 `session.deriveMessages()`（`packages/core/session/src/index.ts:999-1020`）：沿 surface nodes 顺序对 5 种消息事件做 `deriveEventMessage` 投影（replace 被遮蔽节点即消失、空内容 assistant 不入列、消息投影叠加）。要改变模型可见历史，唯一受支持路径是：
1. **surface replace**（compaction 同款）：append 一条带 `{op:'replace', startSeq, endSeq}` 的事件；
2. **fork**：`ctx.sessions.fork(source, boundarySeq, childId?)`（index.ts:1403-1420）—— 复制到 boundary 的 inclusive 前缀为继承历史（`session/end-seed` 切分 + `turn/end{forked}` 合成闭合），子会话新开。
3. `SessionMessageProjection` 纯解释器（内容级投影，不改成员）。

---

## 4. Workstep / Trajectory：步骤如何映射到历史

### 4.1 术语（docs/glossary.md:37-40）

- **turn**：一次 admitted input 的排空（模型+工具停止或策略终止）。
- **step**：一次模型请求 + 其引发的工具执行；一个 turn 含 0..n 个 step。⇒ 对应日志 `turn/start..turn/end` 与其中嵌套的 `step/start..step/end`。
- **exchange**：从"首个 step 认领人类输入的 turn"到下一个此类 turn 之间的连续 turns；Chat 的下一条消息折叠保持最新 exchange 展开。
- **goal round / round**：外层策略迭代。

### 4.2 "工作步骤收起后保留全部助手文字回复"的出处

这是 Web/桌面客户端的 Chat 呈现设置（非内核概念）：
- `packages/client/ui-chat/src/chat-settings.ts`：
  - `transcriptView`：`compact | standard | detailed | verbose`（旧值 `normal`/`expanded` 迁移为 `detailed`；非桌面 Web 默认 `detailed`，桌面默认 `standard`）——"工作步骤展示"。
  - `collapseTiming`：`completion | next-input` —— turn 完成后何时收起。
  - `foldedReplies`：**`'all' | 'final'`（默认 all）—— turn 折叠（工作步骤收起）时保留可见的助手文字回复**：全部或仅最终答案。release note 所述即默认值 `all` 的行为。
- 折叠纯 UI 层：durable 事件与 trajectory 检视不受影响（`packages/client/ui-chat/src/client/contract/chat-visibility.ts` 头注）。

### 4.3 两套 UI 投影

- **Chat 视图**（ui-chat）：session 事件 → `ChatNode`（`contract/chat-nodes.ts`），每个 node 带 `anchorSeq`（事件锚点）与 `groupTree`（exchange 分组）；assistant 行有 `running/settled/interrupted` 态与 turn/step 号；`TurnTailChatData` 收 turn 级 token 汇总。
- **Trajectory 视图**（`packages/client/ui-trajectory/src/client/`）："轨迹台账"，从 durable 事件 + request views 独立组装 `TrajectoryContribution`（system-prompt / node / assistant / tool / request-header / compaction / turn-end / session-end，`trajectory-contract.ts:15-45`），渲染为 `TrajectoryCellKind = system|user|context|compacted|message|tool|subtool` 的 record 行（`trajectory-record.ts:9`），每行带 `sourceSeq` 可回溯到 session 事件。⇒ **"步骤→历史"的映射就是 (turn, step) 坐标 + 事件 seq 锚点；trajectory 是日志的忠实只读台账，chat 是折叠视图。**

### 4.4 持久化与重放

- `session-persistence-jsonl`（`ctx.sessionPersistence` seam，capability-seams.md）：每 session 一个 JSONL 工件，SessionEvent 词汇原样落盘；`session/flush` 并行检查点 + `session-checkpoint-policy` per-request 检查点。
- resume：`agent-loop` 以 `resumeSessionId` 挂载持久日志；crash 孤儿 open turn 由 `interruptedTurnClosers` 补 `turn/end{interrupted}`（`packages/core/session/src/preparation.ts` / agent-loop index.ts:28）。
- fork（见 §3）：`buildForkSeed`（session/src/fork.ts）复制 inclusive 前缀 + `session/end-seed{inherited:true}` 切分 + `turn/end{forked}` 闭合开放尾。

---

## 5. 对 rewind 的介入点结论

1. **数据面**：session 日志 append-only 且 LLM 请求 = `deriveMessages()` 的纯函数 ⇒ rewind 不能靠"改/删事件"，而应：
   - **同会话**：surface `replace`（compaction 先例，`SurfaceOp` 明文允许任何 surface-replacing 生产者），把回退点之后的节点替换为一条 rewind 标记/摘要节点；UI 侧轨迹因 append-only 仍可看到"被回退的过去"。
   - **换会话**：`ctx.sessions.fork(session, boundarySeq)` 以 turn 边界（建议取 `turn/end` 的 seq）切前缀，子会话继续——最干净、零内核改动。
2. **生命周期面**：rewind 触发应选 **turn 边界 / idle**：监听 `agent/status`→idle 或 `agent/turn-stopping`（可在自然停止前 steer 注入 rewind 指令）；执行中的会话先 `agent.cancel({kind:'hook', reason}, {keepInbox:true})`，`whenIdle()` 后做 fork/replace。
3. **事件面**：插件可全程旁听（`session/event` 拿 durable 事实、`agent/*` 拿 live 状态）；需要 UI 同步时挂 `api-session/*` Remote 事件。注意 `agent/assistant-stream` 是瞬态帧，重放一律读 `assistant/message|attempt` settlement。
4. **风险点**：`agent/request` 已 deprecated；`llm/stream` 上 loop 请求 frozen 不可改；`session/end-seed` 禁止插件写入；pre-step reject 会吞掉 claimed 消息（rewind 后需要重投用户消息时用 `agent.followup/steer` 重新入队即可，inbox splice 本身是 durable 的）。

---

## 附：关键文件路径速查

| 主题 | 路径 |
|---|---|
| 生命周期文档 | `docs/agent-lifecycle.md` / `.zh.md` |
| 事件矩阵 | `docs/event-producer-consumer.md` |
| 服务缝隙 | `docs/capability-seams.md` |
| 术语表 | `docs/glossary.md` |
| agent/* 事件与 Agent 接口 | `packages/core/agent/src/runtime-types.ts` |
| 驱动（turn/step 状态机） | `packages/core/agent-loop/src/agent.ts` |
| durable inbox | `packages/core/agent-loop/src/inbox.ts` |
| SessionEventMap / SurfaceOp / TurnEndReason | `packages/core/session/src/types.ts` |
| 全量事件类型清单 | `packages/core/session/src/known-event-types.ts` |
| deriveMessages / SessionStore.fork | `packages/core/session/src/index.ts` |
| fork 种子 | `packages/core/session/src/fork.ts` |
| system prompt 组装 | `packages/core/system-prompt/src/index.ts` |
| llm/stream 与冻结请求 | `packages/llm/llm/src/index.ts` |
| UI stop 链路 | `packages/api/session-controller/src/commands.ts` |
| 工作步骤展示设置 | `packages/client/ui-chat/src/chat-settings.ts` |
| 轨迹台账 | `packages/client/ui-trajectory/src/client/trajectory-contract.ts`、`trajectory-record.ts` |
| 消费工作判别 | `packages/core/agent/src/consumed-work.ts` |

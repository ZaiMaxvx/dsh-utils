# 调研 #3：dsh v0.2.2-rc.1 会话与消息历史持久化

调研对象：`D:/Code/Projects/dsh-utils/dsh-source/src`（GitHub deepseek-ai/deepseek-harness tag `dsh-v0.2.2-rc.1`）
主题：会话如何存储、消息/事件在持久层的表示、能否截断/重写/分支历史、与 rewind 插件的关系。

---

## 1. 总体结论（先读这个）

1. **会话 = append-only 事件日志（event sourcing）**。物理层与内存层都只追加、永不改写已提交事件；"消息历史"是事件日志的**派生物（surface 折叠）**，不是存储本体。
2. **没有公开的"截断/删除/回滚历史"API**。`SessionPersistence` 只有 `create/open/flush/stat/list`；`SessionHandle` 只有 `read/append/flush/close`，且 append 必须**连续续接**已存日志（`seq = 已存条数`）。
3. **存在两条"历史可变"通道**，都是通过追加实现的：
   - **surface 替换（replace）**：消息型事件携带 `surfaceOp: { op:'replace', startSeq, endSeq }`，把 surface 上一段已有节点**遮蔽（shadow）**并替换为本事件。compaction 就是这样改写历史的。任何 surface 生产者都可以用（类型注释原文："Used by compaction; any surface-replacing producer may use it"）。
   - **fork（分支）**：`SessionStore.fork(source, boundary)` 与 API 命令 `session/fork`（UI 的"Branch into a new conversation"）从**任意事件前缀**创建新会话。这是最接近 rewind 的内置实现。
4. 客户端 UI 已为 rewind **预留了词汇但未实现**：`ConversationContextOriginKind = 'compaction' | 'rewind' | 'rewrite'`（`packages/client/ui-chat/src/client/model/conversation-context.ts:6`），全仓只有这一处出现 `'rewind'`，没有任何生产者。

---

## 2. 核心模型（packages/core/session）

### 2.1 事件与信封

文件：`packages/core/session/src/types.ts`（569 行，导出为 `@deepseek-ai/dsh-session` / `/types`）

```ts
export type SessionEvent<T extends SessionEventType = SessionEventType> = {
  [K in SessionEventType]: {
    type: K
    seq: SessionSeq          // 会话内单调递增，0 起连续（seq === log.length 契约）
    time: number             // Unix epoch ms
    data: SessionEventMap[K]
    ignorable?: true         // 未知类型读者可安全跳过；缺省=必需（fail-closed）
  } & (K extends SurfaceEventType ? SurfaceIntent<K> : { surfaceOp?: never; sourceEventSeqs?: never })
}[T]
```

- `SESSION_FORMAT_VERSION = 4`（types.ts:90）。docs/session-format-status.md：`latestFinalizedVersion: 4`，`latestReleasedVersion: 4`（evidenceTag dsh-v0.2.0-rc.2）。
- `SessionHeader`（types.ts:95）：`{ version, id, createdAt, cwd?, parentSession?, isSeeded, origin?, delegationDepth?, agentPreset? }` —— **不可变存储元数据，在事件日志之外**。

### 2.2 事件分类：surface vs log-only

`docs/persistence-catalog.md`（生成文件，353KB）收录全部 60+ 种持久事件。信封字段 `type, seq, time, data, ignorable?, surfaceOp?, sourceEventSeqs?`。

- **surface 事件（5 种，产生模型消息）**：`system/message`、`developer/message`、`user/message`、`assistant/message`、`tool/result`（`SurfaceEventType`，types.ts:447）。
- **log-only 事件**：`turn/start|end`、`step/start|end`、`assistant/attempt`（失败/取消的尝试，不产生消息）、`request/header|context`、`tool/call`、`llm/retry|retry-started`、`compaction/start|summary|prune|end`、`session/end-seed`、`session/title`、`agent/inbox/spliced`、`feedback/message-put|delete` 等。

### 2.3 SurfaceOp —— 历史重写的唯一合法途径

types.ts:470：

```ts
export type SurfaceOp =
  | 'append'
  | { op: 'replace'; startSeq: SessionSeq; endSeq: SessionSeq }  // 闭区间，替换 surface 上 [startIdx..endIdx] 位置段
```

`SurfaceIntent`（types.ts:478）：surface 事件 append 时必须给 `surfaceOp`；非 assistant 事件可携带 `sourceEventSeqs`（引用其派生自的早期事件）。**assistant/message 不能带 sourceEventSeqs**（它内嵌 provider 原始流）。

折叠/校验规则（`packages/core/session/src/surface.ts`，`SurfaceManager` / `foldSurface`）：

- `startSeq`/`endSeq` 都必须是**当前 surface 上仍存活的节点**，startIdx ≤ endIdx；替换后 `nodes.splice(startIdx, endIdx-startIdx+1, newSeq)`（surface.ts:570）。
- `sourceEventSeqs` 必须包含**每一个被遮蔽节点**（`assertSourceEventReferences`，surface.ts:361）。
- **tool/result 替换**：只能改单个 tool/result 节点、且只能改 content（`assertToolResultRewrite`，surface.ts:456）。
- **surface 节点 0（系统提示）**：只能被恰好覆盖单节点的 `system/message` 重写（`assertSystemHeadRewrite`，surface.ts:493）。
- user/message / developer/message / assistant/message 的多节点替换没有专门限制 —— compaction 就是用 `user/message` replace 任意中间段。
- 工具函数：`isSurfaceEvent` / `isAppendSurfaceEvent` / `isReplacementSurfaceEvent` / `foldSurface` / `deriveEventMessage`（surface.ts 导出）。`isAppendSurfaceEvent` 的 JSDoc 明确："**模型可见 surface 故意遮蔽被替换范围，因此它不是人类 transcript 的正确来源**……append 起源事件才是 transcript 的持久源材料；替换副本仅模型可见"——即被 replace 的消息对模型消失，但人类 UI 仍按 append 起源展示。

### 2.4 Session 类与 SessionStore

文件：`packages/core/session/src/index.ts`（1475 行）

- `class Session`：`append<T>(type, data, ...opts: T extends SurfaceEventType ? [SurfaceIntent<T>] : []): SessionEvent<T>`（index.ts:806）。公开方法，**任何拿到 live Session 引用的代码都可以直接调用**（store 附着校验只要求会话已 entered+announced，不限制调用者）。事件即时冻结深拷贝、校验 JSON 与 surface 规则后进入日志并 fire `session/event`。
- 派生历史：`deriveMessages(): Message[]`（按 surface.nodes 投影，替换生效后重建缓存，index.ts:999）。
- 读 API（均已标记 `@deprecated`，见 `.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`）：`eventAt(seq)`、`snapshotEvents(from, toExclusive)`、`ownEvents()`。
- `firstLiveSeq` / `firstLifecycleSeq` / `inheritedEventCount`：fork 前缀边界（进程内偏移，不持久化；持久层靠 header.isSeeded + 最后一个 `{inherited:true}` 的 `session/end-seed` 标记推导）。
- `class SessionStore extends Service`（`ctx.sessions`，index.ts:1064）：
  - `create(id?, options?: CreateSessionOptions)` / `prepare` + `enter` + `announce` / `get` / `list` / `flush(session)`（`session/flush` parallel 事件入口）。
  - **`fork(source: Session | SessionId, boundary?: SessionSeq, childSessionId?): Session`**（index.ts:1403）：从 source 的**精确包含性前缀**建新会话；`buildForkSeed`（`fork.ts`）复制前缀、追加 `{inherited:true}` 的 `session/end-seed` 标记、再为开着的 turn/step 追加合成关闭器（reason `{kind:'forked'}`）。错误码 `SESSION_NOT_FOUND | SESSION_NOT_LIVE | SESSION_ALREADY_EXISTS | INVALID_BOUNDARY`。
  - `registerMessageProjection(projection)`：插件可注册**消息投影**（`SessionMessageProjection`，surface.ts:35）——不改变 surface 成员、只改派生消息内容的纯函数，事件类型需在 `SessionEventMap` 声明（`@messageProjection`）。
- Cordis 事件：`session/created`、`session/disposed`、`session/event`（fire-and-forget append 流）、`session/flush`（awaited 持久化屏障）。

### 2.5 插件记录（PluginRecord）

`appendPluginRecord(session, type, data): SessionSeq`（index.ts:495）：向日志写 `plugin:` 前缀、`ignorable: true` 的事件；`pluginRecordOf(event)` 读回。**限制**：JSDoc 声明"只有 `packages/experimental/` 下的生产代码可以调用；`verify-plugin-record-callers` 门禁拒绝仓库内其他生产调用者"。函数本身从 `@deepseek-ai/dsh-session` 导出（外部插件技术上可 import，但违背仓库门禁）。现有使用者：action-cards、client-ui-forge、forge-session、translator（见 `docs/experimental-persistence-catalog.md`）。plugin 记录 fork/resume 随日志携带，格式迁移尽力保留。

---

## 3. 持久层

### 3.1 服务契约（packages/session/session-persistence）

文件：`src/index.ts`（`ctx.sessionPersistence`）+ `src/handle.ts` + `src/storage-contract.ts`

```ts
abstract class SessionPersistence extends Service {
  abstract create(header, options?): Promise<SessionHandle>       // 新会话 + 写所有权
  abstract open(id, access: 'read'|'write', options?): Promise<SessionHandle>
  abstract flush(): Promise<void>                                  // 全部活动写句柄的屏障
  abstract stat(id): Promise<SessionPersistenceSnapshot | undefined>
  abstract list(): Promise<readonly SessionPersistenceSnapshot[]>
}

interface SessionHandle extends AsyncDisposable {
  readonly id; readonly header; readonly inheritedEventCount; readonly access
  read(offset?, length?, options?): Promise<{ eventState, events }>   // 只返回合法连续前缀
  append(events: readonly SessionEvent[], options?): Promise<void>    // 必须连续续接；"committed events are never rewritten"
  flush(options?): Promise<void>
  close(): Promise<void>
}
```

- **没有任何 delete/truncate/rewrite/remove 方法**。类文档原文："events are contiguous from seq 0 and never rewritten"。
- `assertContiguous`（storage-contract.ts:145）：append 批次首事件 seq 必须等于已存 next-seq。
- 写所有权互斥：`open(id,'write')` 原子独占，`SessionAlreadyOwnedError`；`read` 可与写并存（跨进程亦可）。
- 事件词汇 fail-closed：未知事件类型且未标 `ignorable` → 拒绝解读整个日志（`SessionFormatUnsupportedError`）。

### 3.2 JSONL 后端（packages/session/session-persistence-jsonl）

README + `src/format.ts`、`src/storage.ts`：

- 磁盘布局：`<root>/--<normalized-cwd>--/<encoded-session-id>/session.v3.jsonl`（或 `.jsonl.zstd`；v0 无后缀、v1、v2、v3 各一代，**运行时选数字最高的规范代**）。session id 与 cwd 都做注入式路径转义。
- 默认 `compression: 'zstd'`（checksummed zstd frame，一批一帧）；`'none'` 时为纯文本行。
- **每行一个物理事件，行内含 `type, seq, time, data(, ignorable, sourceEventSeqs, surfaceOp)`**——物理层有 seq/time（codec 要求，见 `session-format-v1-to-v2/src/codec.ts` EVENT_REQUIRED = `['type','seq','time','data']`；v3/v4 codec 复用 v2 行框架）。
- 首行物理 header：`{"type":"session","version":4,"id":...,"createdAt":...,"cwd":...,"parentSession":...,"isSeeded":...,"origin":...,"delegationDepth":...,"agentPreset":...}`。
- `sourceEventSeqs` 连续段会打包成 `[start,end]` 区间编码（`encodeSeqRanges`/`decodeSeqRanges`，`packages/core/session/src/seq-ranges.ts` 同名导出）。
- 持久化时机：`create` 只返回句柄不落盘；首次 `append` 写 header+首批（no-overwrite publish + fsync）；此后每批 fsync；写失败回滚到原长度。**崩溃恢复**：撕裂的末行丢弃；撕裂的 zstd 帧只取完整解码记录，写句柄会截断撕裂字节并重写恢复的记录再追加（这是唯一的"截断"场景——只针对损坏尾，非语义截断）。
- **格式迁移**：打开旧代文件时读通道解码+迁移但不发布；写通道在同一目录生成临时文件、Worker 校验、发布新一代（`session.vN.jsonl` → 新代文件名），**源文件字节不变**。历史代（v0-v2）永远保留在目录里。

### 3.3 快照测试格式（snapshots/session/）

例：`snapshots/session/advanced-toolchain/session.1.v4.jsonl`（同目录还有 v2/v3 版本对照迁移）：

```jsonl
{"type":"session","version":4,"id":"{{session:2}}","createdAt":1783950001000,"cwd":"{{cwd}}","parentSession":"{{session:1}}","isSeeded":false,"origin":"subagent","delegationDepth":1}
{"type":"sandbox/mode","data":{"mode":"danger-full-access","source":"delegation"}}
{"type":"turn/start","data":{"turn":1}}
{"type":"step/start","data":{"turn":1,"step":1}}
{"type":"system/message","data":{...},"surfaceOp":"append"}
{"type":"user/message","data":{"content":[...],"source":{"kind":"user"},"role":"user","id":"{{message:20}}"},"surfaceOp":"append"}
```

注意：**仓库 fixture 用"逻辑投影"形式——每事件一行、无 seq/time**（seq 按行号隐含，time 归 0）。`scripts/session-fixture-layout.ts` 的 `renderFixture` 明确 `delete record.seq; delete record.time`；解析时缺省补 seq=行号、time=0。`{{session:N}}`/`{{message:N}}`/`{{cwd}}` 是模板占位符。物理持久层（jsonl 后端）写入时**带** seq/time。compaction 相关快照：`snapshots/session/compaction-*`、`empty-response-retry*`（重试场景）。

### 3.4 版本与迁移链

`packages/session/session-format-v0-to-v1 / v1-to-v2 / v2-to-v3 / v3-to-v4 / session-format / session-format-catalog`。相邻迁移链在读取体时按需组合，只发布最终当前代。v3→v4 主要变化：未知 ignorable 事件重命名进 `plugin:` 命名空间、原生 tool 角色等。`docs/persistence-changes/`（README + finalized/v4.json）记录兼容规则；`docs/persistence-schema.json` 是机器类型指纹清单（roots: SessionHeader、JsonlHeaderLine、SessionEventEnvelope、每个 event 的 digest + surface 标志）。

### 3.5 checkpoint 策略（packages/session/session-checkpoint-policy）

不做快照，只调度 flush：模型请求派发前 flush；顶层工具执行前 flush（外部副作用前必持久）；每 step 边界 flush。`session/flush` 是 awaited parallel 事件，jsonl 后端监听它落盘。

---

## 4. 会话查询（packages/session-query）

`ctx.sessionQuery`（`session-query/src/index.ts`，`SessionQueryEngine`）——**全部只读**：

| 方法 | 作用 |
|---|---|
| `observeSession(id, opts?)` | live 优先观察租约（SessionObservation，可 dispose） |
| `readSession(id)` | 完整重放校验的原始事件日志（不拉活会话） |
| `listSessions()` / `filterSessions(filters)` | 会话清单/元数据过滤（live+persisted 合并，新→旧） |
| `listEvents(id)` / `filterEvents(id, filters)` | 轻量事件记录 / 语义文档过滤 |
| `readSurface(id)` | **当前折叠后的模型 surface**（含 capturedThroughSeq） |
| `readEvent({sessionId, seq, before, after})` | 单事件 + 有界上下文窗口（≤ readWindowMax=50） |
| `traceSession(id)` | 祖先链 + 递归后代树（fork 谱系） |
| `traceEvent(req)` | 单事件的**位置替换链**与被引源事件 |
| `readTitle(Snapshots)` | 折叠最新标题 |
| `searchSessions/searchEvents`（abstract） | 全文检索，由 sqlite 后端实现 |

错误码：`SESSION_QUERY_SESSION_NOT_FOUND / SOURCE_CONFLICT / PERSISTENCE_FAILED / CORRUPT_SESSION / INVALID_SURFACE / EVENT_NOT_FOUND / INVALID_FILTER / INVALID_WINDOW`。`session-query-sqlite` 提供 FTS 索引后端；`session-log-export` 提供导出。

---

## 5. 分支 / 重试 / 编辑 —— dsh 自带的"历史回退"能力盘点

### 5.1 fork（= "分支到新会话"，最接近 rewind 的内置实现）

三层暴露：

1. **核心**：`SessionStore.fork(source, boundary?, childId?)`（core/session/src/index.ts:1403）+ `buildForkSeed(events, boundary)`（core/session/src/fork.ts）。
2. **API 命令**：`SessionCommandController.fork(request)`（`packages/api/session-controller/src/commands.ts:213`）。`SessionForkRequest { sessionId, atSeq?, allowMigration? }`；atSeq 缺省=最近**完整 turn** 前缀（`latestCompletedPrefixBoundary`）。实现：`sessionQuery.observeSession` → `buildForkSeed` → `agents.create({sessionId: 'session-'+uuid, seed, inheritedEventCount: boundary+1, meta:{cwd, isSeeded:true, agentPreset}})` → workspace attach。错误 `session/fork-unavailable`。
3. **客户端 SDK**：`ctx.sessions.fork({ sessionId, atSeq?, increaseTitle?, onCreated?, allowMigration? }): Promise<SessionId>`（`api/session-controller/src/client/contract/sessions.ts:135`）。UI 入口：`packages/client/ui-chat/src/client/apply.ts:301` `forkAt(seq)`（turn 尾部分支按钮，文案 `'message.branch': 'Branch into a new conversation'`，locale.ts:364 等 8 语言）。

fork 语义要点：子会话持有父日志的精确前缀副本（新文件、新 id），源会话**毫发无损**；`turn/end reason {kind:'forked'}` 合成关闭器；`inheritedEventCount` 记录继承长度，`isSeeded: true`。**fork 是"分支"而非"回退"：不修改当前会话。**

### 5.2 重试（retry）

- `llm/retry` / `llm/retry-started` 事件（`packages/llm/llm-retry`）：**传输层**模型调用失败重试，按 `retryId` 聚链（UI `conversation-nodes/retry.ts`）。失败尝试持久化为 `assistant/attempt`（含完整原始流）但**不进 surface、不产生消息**。
- **没有用户级"重新生成上一条回复"功能**：全仓无 delete-last-turn/regenerate 命令；`snapshots/session/empty-response-retry*` 是空响应自动重试场景。

### 5.3 编辑已发消息 / 撤回排队消息

- **已进入 surface 的消息：无任何编辑 API**。唯一改写途径是 surface replace（compaction 模式）。
- **还在队列里的消息可以编辑/删除**：`SessionCommandController.updateQueue`（commands.ts:385）支持 `edit`（仅文本）/ `remove` / `steer`（插队当前 turn），底层是 `agent.inbox.replace/remove/steer` → `agent/inbox/spliced` 事件（`target: 'next-turn' | 'next-step'`，data `{ start, removedCount?, inserted }`——inbox 本身也是 append-only 投影，`core/agent-loop/src/inbox.ts`）。
- `cancel`（commands.ts:470）：取消当前 turn，`keepInbox: true`，turn 以 `{kind:'aborted', reason:{kind:'user'}}` 结束——历史保留。
- `feedback/message-put|delete`（`packages/feedback/message-feedback`）：按 `MessageId` 挂/删**人类反馈标注**（log-only），是"按消息 id 删除记录"的唯一先例，但只删标注不删消息。

### 5.4 UI 预留

`packages/client/ui-chat/src/client/model/conversation-context.ts`：`ConversationContext { id, parentId?, origin?: 'compaction'|'rewind'|'rewrite', originSeq?, nodes }` —— 从 surface replacements 重建的"模型上下文世代"树。`'rewind'`/`'rewrite'` 已进入类型但**无生产者**，是为将来功能预留的接口。

---

## 6. compaction（上下文压缩）对 rewind 的影响

`packages/compaction/compaction/src/types.ts` + `compaction-basic/src/region.ts`：

流程（`commitCompactionBody`，region.ts:470-522）：

```ts
session.append('compaction/start', {...})            // log-only，持锁
session.append('compaction/summary', { summary, shadowedRange:{start,end}, shadowedSeqs, shadowedTokenCount, provider, model, ... })
session.append('user/message', checkpointMessage, {
  surfaceOp: { op: 'replace', startSeq: start, endSeq: end },
  sourceEventSeqs: [startEvent.seq, summaryEvent.seq, ...shadowedSeqs],
})
session.append('compaction/end', {...})
```

- 摘要作为**新的 user/message** 遮蔽被压缩段；被遮蔽节点从 `deriveMessages()` 消失但**仍在日志里**（append-origin transcript 仍可见）。
- 提交前重校验 surface 未变（`SurfaceChangedError`，region.ts:455-467）。
- 对 rewind 的影响：
  1. rewind 插件若按 seq 定位"回退点"，必须先 `readSurface`/`foldSurface` 得到**当前存活节点**，不能假设 seq 连续映射到消息；
  2. 一次 rewind-式 replace 之后，历史 seq 与 surface 位置不再一一对应（`shadowedRange` JSDoc：start 可能 > end）；
  3. compaction 段与 rewind 段互相交叠时需要处理 `SurfaceChangedError` 类竞态；
  4. `ConversationContext.origin` 已为 compaction/rewind/rewrite 建模了"世代"概念，rewind 插件可以沿用该 UI 模型。

---

## 7. packages/api 与插件可用的会话读写面

### 7.1 Host 侧（cordis 插件，经 tool-cordis API 目录确认）

`packages/extensions/tool-cordis/src/api-catalog.ts`（生成目录）确认 host 插件上下文可见：

- **`ctx.sessions`（SessionStore）**：`create/prepare/enter/announce/get/list/flush/fork/registerMessageProjection`。→ 拿到 live Session 后可直接 `session.append(type, data, {surfaceOp, sourceEventSeqs})` 写 surface 事件（含 replace）。
- **`ctx.sessionPersistence`**：`create/open('read'|'write')/flush/stat/list`；写句柄可向**任意存储会话**连续追加（包括不在内存中的冷会话）。
- **`ctx.sessionQuery`**：全部只读查询（见 §4）。
- 事件订阅：`session/created`、`session/disposed`、`session/event`（每条新事件 fire-and-forget）、`session/flush`。

### 7.2 API 网关命令（session-controller）

`SessionCommandController`（commands.ts）：`create`、`selectModel`、`rename`、**`fork`**、`prompt`、`attachment`、`updateQueue`（edit/remove/steer）；`index.ts` 另有 `list/search/control`（取消）。历史读取走 `history.ts`：`paginate()` 以 **append-origin 的 user/assistant 事件**计数分页（`isAppendSurfaceEvent`），`sourceEventSeqs` 参与分组；`SessionPageRequest { maxMessages(默认50), beforeSeq, throughSeq, turnWindow }`。

### 7.3 客户端 SDK（client contract）

`ctx.sessions`（client）：`create/search/fork({sessionId, atSeq, ...})/retain/refresh/refreshProjections/scope/sessionOf/binding`。客户端插件（cordis-client-runner）经 `remote.session` 走网关。

**结论：插件层面没有"截断/重写既有事件"的公开 API；能做的是 (a) 追加 surface replace 事件遮蔽历史（compaction 同款），(b) fork 出新分支，(c) 对未消费的队列消息 edit/remove，(d) 追加 log-only/plugin: 记录。**

---

## 8. 对 rewind 插件的可行路径评估（基于以上事实）

1. **replace 路线（原地回退）**：对 live session `append('user/message', 重新提交的消息, { surfaceOp:{op:'replace', startSeq: 回退段首节点, endSeq: 尾节点}, sourceEventSeqs: [...全部被遮蔽节点] })`。模型历史立即"回到过去"，日志 append-only 不破坏。需处理：① 遮蔽段必须是**当前 surface 存活节点**（compaction 后需先 fold）；② 若回退段包含节点 0 系统提示则受 `assertSystemHeadRewrite` 限制（从节点 1 起替换即可）；③ 人类 transcript（append-origin）仍显示旧消息——与 compaction 检查点的 UI 呈现同款问题，UI 需自己识别 replace 事件；④ assistant/message 不能带 sourceEventSeqs，但**可以**作为替换事件类型携带 surfaceOp（assertSourceEventReferences 对 assistant 只禁 sourceEventSeqs）——不过用 user/message 替换更贴近"重新提问"语义。
2. **fork 路线（分支回退）**：直接调 `ctx.sessions.fork(source, boundary)`（host）或网关 `fork` 命令（client），零新存储语义，源会话保留完整审计轨迹。UI 已有 branch 按钮与谱系（`traceSession`）。缺点：产生新会话 id，工作区/标题要跟走（网关 fork 已处理 workspace attach 与标题递增）。
3. **混合**：rewind UI 列出回退点（按 `turn/end` 边界或 `readSurface` 节点），默认 fork，可选原地 replace。`ConversationContextOriginKind` 的 `'rewind'` 值表明官方 UI 模型预期 rewind 也是一次 surface 替换世代（与 compaction 同构），这强烈暗示官方规划的 rewind = replace 路线。
4. **不可行**：物理删除日志行、按 MessageId 删除事件、重写已存 JSONL、把 live Session 的 seq 回退——契约、门禁与格式校验全部禁止；`inheritedEventCount`/`session/end-seed` 只能由 Session 构造器与 `buildForkSeed` 写（append 不会拒绝其他写入者，但会静默改变 seed 语义，core/session types.ts:424 有警告）。

---

## 9. 关键文件索引

| 主题 | 路径 |
|---|---|
| 事件/信封/格式版本/SurfaceOp | `packages/core/session/src/types.ts` |
| Session 类 + SessionStore(fork) | `packages/core/session/src/index.ts` |
| surface 折叠与 replace 校验 | `packages/core/session/src/surface.ts` |
| fork 种子构造 | `packages/core/session/src/fork.ts`；open-tail 修复 `src/repair.ts` |
| 持久化契约 | `packages/session/session-persistence/src/{index,handle,storage-contract,errors,revision}.ts` |
| JSONL 后端 | `packages/session/session-persistence-jsonl/src/{storage,format,generation,lease}.ts` |
| 格式编解码（行含 seq/time） | `packages/session/session-format-v1-to-v2/src/codec.ts`（v2 行框架，v3/v4 复用） |
| 查询服务 | `packages/session/session-query/session-query/src/index.ts` |
| fork API 命令 | `packages/api/session-controller/src/commands.ts:213` |
| 队列编辑/删除/steer | 同上 `commands.ts:385`（updateQueue） |
| compaction replace 写入 | `packages/compaction/compaction-basic/src/region.ts:470`；事件类型 `packages/compaction/compaction/src/types.ts` |
| UI 分支动作 | `packages/client/ui-chat/src/client/apply.ts:301`；文案 `src/client/locale.ts`（message.branch） |
| rewind 预留类型 | `packages/client/ui-chat/src/client/model/conversation-context.ts` |
| 事件总目录 | `docs/persistence-catalog.md`（生成）、`docs/persistence-schema.json`、`docs/experimental-persistence-catalog.md` |
| 格式状态 | `docs/session-format-status.md`、`docs/persistence-changes/` |
| 快照样例 | `snapshots/session/advanced-toolchain/session.1.v4.jsonl` 等；fixture 规则 `scripts/session-fixture-layout.ts` |
| checkpoint 策略 | `packages/session/session-checkpoint-policy/`（README） |
| 插件 API 目录（host 插件可见面） | `packages/extensions/tool-cordis/src/api-catalog.ts` |

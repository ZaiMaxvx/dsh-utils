# rc2-01：dsh v0.2.2-rc.1 → v0.2.2-rc.2 host 侧 API 差异（针对 rewind 插件）

- 旧版：`D:/Code/Projects/dsh-utils/dsh-source/src`（tag dsh-v0.2.2-rc.1）
- 新版：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（tag dsh-v0.2.2-rc.2）
- 被评估对象：`D:/Code/Projects/dsh-utils/rewind-plugin/src/`
- 方法：对指定文件逐个 `diff -u`，对 `packages/core/session`、`packages/interaction/commands`、`packages/session-query`、`packages/llm`、`packages/boot`、`packages/client/*`、`src/docs` 做递归 diff 摘要后聚焦核对。

## 逐点结论

### 1. `packages/core/session/src/types.ts` — 有变化（非破坏，纯新增）

- diff 仅一处：新增导出类型 `SessionEventInput`（第 488-491 行），是 `Session.append` 新批量重载的输入元组类型：`readonly [type, data, ...opts?]`。
- `SurfaceOp`、`SurfaceIntent`、`SessionSeq`、`SessionEventMap` 全部未动：
  - `'user/message': UserMessage`（仍为完整 UserMessage，无 wrapper）
  - `'turn/start': { turn: number }`
  - `'turn/end': { turn: number; reason: TurnEndReason }`

### 2. `packages/core/session/src/surface.ts` — 有变化（内部重构 + 纯新增，校验规则未变）

- 三个 assert 均为**模块私有函数（未导出）**，插件无法也无需直接调用：
  - `assertSourceEventReferences`：两版逐字一致（行号 330 不变）。
  - `assertDeveloperHeader` / `assertToolResultRewrite` / `assertSystemHeadRewrite`：签名从 `(..., events, baseSeq)` 改为传 `read: (seq) => SessionEvent | undefined` 回调（为支持批量候选事件回看）；**校验规则本身逐条未变**（headerSeq 必须 < event.seq 且指向 `request/header`；`tool/result` 替换必须恰好 shadow 1 个当前 `tool/result` 节点；node 0 系统提示只允许单节点 `system/message` 重写）。
- `SessionSurface` 接口未变（`nodes` / `replaceGeneration` / `contentGeneration`）。
- `foldSurface(events, projections)` 未变。
- `SurfaceManager` 新增 `prepareBatch(events): () => void`（供 Session 批量 append 预校验+延迟采纳）；不影响现有接口，且不在 `SessionSurface` 接口上。
- 内部 `planSurfaceEvent` 新增 `candidates` 参数；投影上下文的 `events` 改为惰性 getter（含候选事件）。
- 导出列表两版完全一致。

### 3. `packages/core/session/src/index.ts` — 有变化（非破坏性新增；一个行为微调）

- **`Session.append` 新增数组重载**：`append(inputs: readonly SessionEventInput[]): readonly SessionEvent[]`。单事件重载 `append(type, data, ...opts)` 保留、签名不变、运行路径行为等价（重构为 `snapshotAppend`/`createAppendEvent`，非 JSON data 的错误消息措辞一致）。
  - 官方 upgrade-guide（`v0.2.2-rc.1/session-append-overloads`）明确：**普通单事件调用仍可编译**；只有"把函数赋给 `Session['append']` 的测试替身/包装函数"需用 Proxy 转发以支持两种重载。插件（含 `tests/rewind-session.spec.ts`、`scripts/smoke.session.mjs`）全部是直接调用单事件形式，**不受影响**。
- 新增 getter `session.currentBatchPublication`：批量发布监听器回调期间标识当前成员事件（纯新增）。
- 批量 append 的可观察行为（文档注释）：数组 append 先全部入 log 再按序发布，监听器回调里 `session.seq`/`session.surface` 已含完整批次。
- `session.surface`、`deriveMessages()`、`snapshotEvents()` 未变。
- `SessionStore` 未变（仍 `export class SessionStore extends Service`，`ctx.sessions` 服务名与 `declare module '@deepseek-ai/cordis'` merge 声明一致）。
- rc.2 新增 `tests/append.spec.ts`、`tests/append.type-test.ts`（官方批量行为参考，非 API）。

### 4. `packages/llm/llm/src/message.ts` — 无变化

- 与旧版**逐字节一致**（`cmp -s` 通过）：`createUserMessage`、`MessageSourceMap`（插件的 `declare module` 声明合并点）、`UserMessage`/`MessageBase` 全部未动。
- text ContentBlock 形状：`TextBlock`/`ContentBlock` 定义在 `llm/src/types.ts`，该文件同样**逐字节一致**。插件 marker 的 `content: [{ type: 'text', text }]` 形状不变。
- llm 包内其他变化（插件不涉及，记录备查）：
  - `error.ts`：`HarnessError` 基类迁至 `@deepseek-ai/dsh-error`（dsh-llm re-export 同一类，原 import 路径不变）；`LlmError` 构造器 `code` 参数从 `string` 收窄为 `BuiltinLlmFailureCode`，新增静态 `LlmError.fromFailure(failure)`（agent-loop 内部已改用它）。
  - `content.ts`：工具声明投影（toolDeclarations/rebaseAdditionOnlyHistory）重构，属请求组装逻辑，不影响消息/事件形状。

### 5. agent（`runtime-types.ts` + `agent-loop/agent.ts`）— 有变化（非破坏；一处行为增强）

- `runtime-types.ts`：仅 `cancel` 的文档注释加一行（"Queue-write failures still abort the activity and propagate to the caller"）。`Agent.session/status/cancel/whenIdle/runMaintenance` 签名均未变。
- `agent.ts` 中 **`runMaintenance` 两版逐字一致**（含抛错行为：非 idle 时同步 `throw new Error('agent "x" already has active work')`；job 异常经 finally 恢复 idle 并 resolve activityDone）。插件 index.ts 靠 `error.message.includes('already has active work')` 分支识别的逻辑依旧成立。
- `cancel` 行为增强（可靠性修复）：旧版 `inbox.clear()` 抛错会跳过 `phase.abort.abort(cause)`；新版 try/finally 保证**即使队列清理抛错也执行 abort**，错误仍向调用者传播。对插件（不直接调 cancel，仅经 runMaintenance）无影响。
- 其他内部变化：`LoopAgent` 构造器新增第 4 参数 `lifetimeSignal`（仅工厂内部构造）；`wakeDriver` 加 lifetime 守卫；`runtimeContext.project(joined, sections)` → `project(sections)`（agent-loop 内部）；dispose 路径 catch `machine.cancel` 错误。
- `agent/src/index.ts` + `agent-loop/src/index.ts`：**`CreateAgentOptions`/`ResumeAgentOptions`/`AgentInitializationOptions` 移除 `parentAgent` 字段**，`ctx.agents.enter(agent)` 不再收父 agent（破坏性，但插件未用）。

### 6. `packages/interaction/commands/src/` — 无变化

- `src/`（index.ts、types.ts、brand.ts）递归 diff **完全一致**：`CommandInvocation`、`CommandResult`、`CommandDefinition`、`ctx.commands.register`、`CommandDefinitionId` 全部未变。
- 仅 `package.json` 变化：版本号 rc.1→rc.2、zod 依赖 4.4.3→4.6.6、files 增加 sourcemap 与 src。运行时依赖版本升级，API 面无变化。

### 7. `packages/session-query/session-query/src/` — 有变化（纯新增）

- `index.ts`：仅新增 `inspectSession<T>(sessionId, read, signal?)`（12 行，纯新增方法）。`filterEvents`、`SessionEventRecord`、`SessionEventSearchDocument`、`SessionEventResultFilter`（`kind: 'type'`）、`ctx.sessionQuery` merge 全部未变。
- `observation.ts`：内部抽取私有 `acquire()` 复用（live/cold 获取路径），公开接口无变化。
- 插件 `filterEvents(id, [{ kind: 'type', values: ['turn/start'] }])` 调用不受影响。

### 8. manifest/兼容性 — engines.dsh 解析无变化；plugin-manager 管理面有破坏性变化（插件不涉及）

- `app-boot/src/plugin-compatibility.ts`（`engines.dsh` 读取 + `semver.satisfies(runtime, range, { includePrerelease: true })`）**两版逐字节一致**。
- `plugin-manager/src/versions.ts` 一致；`dsh.bundle` 解析（`bundlePatchPaths`、`not-bundle` 拒绝、`listedByDefault` 校验）保留。
- plugin-manager 变化集中在 bundle 更新流程（官方条目 `v0.2.2-rc.1/plugin-update-method`）：
  - **`BundleInfo.updatable: boolean` 移除**，改为可选 `BundleInfo.update: 'registry' | 'git'`；
  - `ManagementError['code']` 新增 `'unexpected-package'`（穷尽 switch 需补分支）；
  - `InstallBundleOptions` 新增 `expected?: { name, version }`；`updateBundle` 支持 Git 提交更新。
  - `assertBundlePlatform(platforms, platform, facts?)` 增加可选参数并支持 `'wsl'` 平台值。
  - 这些只影响消费 `listBundles()`/plugin-manager 工具的代码；rewind 插件没有此类交互。
- `app-boot/src/index.ts` 的变化是 `.env` 环境变量豁免规则（proxy 名大小写不敏感 + DeepSeek endpoint 精确名），与 manifest/engines 无关。
- **docs/upgrade-guide 目录对比**：新版新增 `v0.2.2-alpha.3/`（5 条目）与 `v0.2.2-rc.1/`（20 条目，含 `session-append-overloads`、`plugin-update-method`、`runtime-context-reminders`、`subagent-interrupt-default`、`web-search-billing` 等）。**没有 rc.2 专属目录**——rc.1→rc.2 的 host 变化以 `v0.2.2-rc.1/` 目录下的条目承载（如 session-append-overloads 的行文是"在 v0.2.2-rc.1 中 append 只有一个签名，现在…"）。

### 9. 事件词汇与 persistence catalog — 新增一项；多个 sha 变化但类型未变

- `known-event-types.ts`：仅新增 `'team/mode'`，**无删除**；'user/message'、'turn/start'、'turn/end' 等存量类型原样。
- `src/docs/persistence-catalog.md`：
  - 新增 `event:team/mode`；
  - sha256 变化的事件：`agent/inbox/spliced`、`developer/message`、`session/title-llm-request`、`subagent/catalog`、`team/task`、`user/message`；
  - 但逐一核验后，这些事件的 **TS 类型定义链全部未变**（`core/session/src/types.ts` 的 SessionEventMap、`llm/src/message.ts` 的 UserMessage/MessageBase、`llm/src/types.ts` 的 ContentBlock 均逐字一致；catalog 中 user/message、turn/start、turn/end 的正文段落 diff 为空）。sha 变化来自生成器对间接引用的敏感（如 `HarnessError` 基类迁包、`AttachmentError` 改继承、注释措辞），**不构成形状变化**。
  - `turn/start`、`turn/end` 连 sha 都未变。
- 结论：插件写入/读取的 'user/message'（surface replace 标记）、'turn/start'（filterEvents 边界）形状与语义在 rc.2 下完全兼容。

### 10. `client/ui-chat/src/client/model/conversation-context.ts` — 无变化（无撞车）

- 该文件**逐字节一致**；全仓 grep `'rewind'` 两版仍只命中这一个文件（ConversationContextOriginKind 的 'rewind' 预留），**官方没有新增 rewind 生产者或派生逻辑**。
- client 侧其余抽查（插件 type-only import 与注入面）：
  - `conversation.chat.turnTail` 契约未变（`ui-chat/contract/slots.ts` 的 turnTail 条目、`conversation-nodes/turn-tail.ts`、`chat/TurnTailNodeView.tsx` 一致）；
  - `ui-chat/contract/slots.ts` 新增 `conversation.chat.markdown.fence` hoc slot 与 `consumeOlder`（ChatViewInjected）——纯新增；
  - `ui-conversation/contract/slots.ts` 新增 `conversation.hero.frame` slot、composer paste 路由类型——纯新增；
  - `ui-renderer/scoped-slots.tsx` 新增 hoc slot kind——纯新增；
  - `ui-commands/src/client/presentation.ts` 仅 import 格式化差异；`ui-session`、`client-locale`、`api-session-controller`（`ctx.sessions.binding`）无 src 变化。

## 破坏性清单（对本插件）

**无。** 插件用到的每一个 host/client API 点在 rc.2 下均保持兼容：

| 插件依赖 | rc.2 状态 |
| --- | --- |
| `session.append('user/message', msg, { surfaceOp: { op: 'replace', ... }, sourceEventSeqs })` 单事件调用 | 签名保留，行为等价（新增数组重载不冲突） |
| `session.surface.nodes` / `SessionSurface` | 未变 |
| `deriveMessages` / `snapshotEvents` / `SessionStore`（ctx.sessions） | 未变 |
| `createUserMessage` / `MessageSourceMap` 声明合并 / text ContentBlock | 逐字节一致 |
| `agent.session` / `agent.runMaintenance`（含 'already has active work' 抛错文案） | 逐字一致 |
| `ctx.commands.register` / `CommandInvocation` / `CommandResult` / `CommandDefinitionId` | src 完全一致 |
| `ctx.sessionQuery.filterEvents` / `SessionEventSearchDocument` / `kind:'type'` filter | 未变（仅新增 inspectSession） |
| surface replace 三条校验规则（user/message 跨多节点、非 node-0 起切、tool/result 不可作为 rewind 目标的间接约束） | 规则未变（仅内部 read 回调重构） |
| client：turnTail slot、commandUi.decorate、ctx.sessions.binding、ctx.locale、ctx.slots | 未变或纯新增 |
| `engines.dsh: ">=0.2.2-rc.1 <0.3.0"` | 解析逻辑未变；rc.2 满足该区间（semver.satisfies includePrerelease） |

生态层面的破坏性变化（插件未触碰，仅供将来参考）：
1. 包装/替身 `Session['append']` 必须支持两种重载（官方 session-append-overloads 条目）。
2. `BundleInfo.updatable` → `BundleInfo.update`；`ManagementError.code` 新增 `unexpected-package`。
3. `CreateAgentOptions`/`ResumeAgentOptions` 移除 `parentAgent`。
4. `LlmError` 构造器 code 收窄为 `BuiltinLlmFailureCode`（跨 provider 错误改用 `LlmError.fromFailure`）。
5. `AttachmentError` 改为 `extends HarnessError`（识别改用 `isAttachmentError`）。

## 建议的插件适配动作

1. **必做：无**。现有源码在 rc.2 下应原样编译并运行。
2. 回归验证（低成本）：跑插件自带 `npm test`（smoke + planner spec，均直接调单事件 `session.append`，仍有效）与 `npm run check` 两个 tsc 配置；可对照 rc.2 新增的 `packages/core/session/tests/append.spec.ts` 确认单事件路径语义。
3. `engines.dsh` 不需要改动：`>=0.2.2-rc.1 <0.3.0` 覆盖 rc.2；若想收紧可写 `>=0.2.2-rc.2 <0.3.0`（非必要）。
4. 可选跟进（非本轮必需）：
   - 若将来一次 rewind 需要追加多个事件（如 marker + 附带事件），可迁移到 `session.append([...])` 批量重载，获得原子提交与监听器完整批次视图；
   - 新的 `ctx.sessionQuery.inspectSession()` 可替代部分自定义只读探查（当前插件用 surface.nodes 直读，无需改）；
   - 保持不使用 `parentAgent`、`LlmError` 任意 code、`listBundles().updatable` 即可继续免受上述生态破坏项影响。

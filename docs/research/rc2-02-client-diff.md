# rc2 调研 02：dsh v0.2.2-rc.1 → rc.2 插件 client（Web）侧 API diff

- 旧版（插件已适配）：`D:/Code/Projects/dsh-utils/dsh-source/src`（dsh-v0.2.2-rc.1）
- 新版：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（dsh-v0.2.2-rc.2）
- 被评估对象：`D:/Code/Projects/dsh-utils/rewind-plugin/src/client/`（TurnTailRewind.tsx + index.ts）

插件 client 半实际用到的 API 面（供对照）：

- `PropsRuntime<'conversation.chat.turnTail'>` / `InjectFace` / `PropsLocale<'rewind'>`（@deepseek-ai/dsh-client-ui-slots）
- 槽位 `conversation.chat.turnTail`（kind list / scope session / owner `TurnTailOwnerProps`：turn、seq、openFile）
- `TurnLocation`（`turn.start?.seq`）
- `ctx.slots.register(...)` / `ctx.slots.inject(...)`（经 ui-renderer 的 SlotRegistry merge）
- `ctx.commandUi.decorate({ name, available, ui: { kind: 'popupSelect', options, onSelect } })`
- `useSessionStatus(s => s.get(sessionId)?.running)`（ui-session 标准钩子）
- `ctx.sessions.binding(sessionId)` → `binding.session.command(line)`
- `ctx.locale.register(NS, { zh, en })` / `ctx.locale.bind(NS)`
- 类型 side-effect import：ui-chat/client、ui-conversation/client、ui-session/client、ui-commands/client、locale/client、api-session-controller/client、ui-renderer/client

---

## 1. `packages/client/ui-chat/src/client/contract/slots.ts` — turnTail 槽位声明

**结论：无变化（对插件）；文件本身有增量变化。**

- `conversation.chat.turnTail` 条目两版逐字相同（仅行号 487 → 492）：
  ```ts
  'conversation.chat.turnTail': { kind: 'list'; scope: 'session'; owner: TurnTailOwnerProps }
  ```
  SlotMap merge 目标、kind/scope/owner 均未动。
- 文件其余 diff（均与插件无关）：
  - `ChatViewInjected` 新增 `consumeOlder: () => boolean`（消费 `loadOlder({ deferConsumption: true })` 预备的历史页），`loadOlder` 补注释。
  - 新增 SlotMap 条目 `'conversation.chat.markdown.fence': { kind: 'hoc'; scope: 'session'; owner: MarkdownDelegateFenceInfo }`（配合 ui-slots 新 hoc kind），`ChatViewSlotProps` 的 `PropsRenderSlots` 联合相应加了这个 key。
  - import 增加 `MarkdownDelegateFenceInfo` 类型。
- 破坏性：无。新成员都是加法，`conversation.view` 等槽组件自己的 props 变宽不影响 turnTail 注册者。

## 2. `packages/client/ui-conversation/src/client/contract/conversation.ts` — TurnLocation

**结论：无变化。** `cmp -s` 两版完全相同。`TurnLocation`（turn/start/end/status/steps/data）、`TurnTailOwnerProps` 所依赖的全部形状原样。

## 3. `packages/client/ui-slots/src/index.ts` — 槽位框架契约

**结论：有变化（纯增量），对插件无影响、无破坏。**

- `SlotKind` 增加 `'hoc'`（嵌套包裹层）：`'single' | 'list' | 'keyed' | 'chain' | 'hoc'`。
- 新增类型：`HocRenderOpts`（renderSlot 对 hoc key 的 `{ children, entryKey }` 选项）、`HocKeysOf`、`HocShare<E>`（hoc 组件收到框架注入的 `children`）。
- `ComposedProps` 追加交叉项 `HocShare<SlotMap[K]>`——非 hoc 槽该项为 `object`，对既有组件类型零影响。
- `KindOptions` 新增 hoc 分支（`id` 必填 + `key?`/`order?`/`priority?`）；**list 分支（id/order/label/priority）逐字未变**，keyed/chain/single 分支也未变。
- `SlotCore.register` 增加 hoc 校验分支（缺 id 抛错、同 cell 同 priority 抛错）；list/keyed/chain 校验路径未变。排序：`kind === 'list' || kind === 'hoc'` 用 priority+order 复合排序，list 行为等价。
- **插件用到的 `PropsRuntime`、`InjectFace`、`PropsLocale`、`Translate`、`SessionStandardProps`/`GlobalStandardProps`、`ctx.slots.register/inject` 的签名全部未变**（diff 未触及这些定义）。
- 同包 `src/renderer.ts`：仅 reportEntryError 注释扩到 hoc（"chain and hoc crashes report without abdicating"），无签名变化。

## 4. `packages/client/ui-commands/src/client/contract.ts` — commandUi.decorate / popupSelect

**结论：无变化；"自定义浮层新定位接口"的破坏性改动不在本包，在 ui-primitives，且对 decorate 使用者不可见。**

- `contract.ts` 两版完全相同：`ctx.commandUi.decorate`、`CommandDecoration`、`PopupSelectSpec`、`SelectOption` 原样。
- popup shell（`PopupSelectView.tsx`、`PopupSelectView.module.css`、`popup.ts`）两版完全相同——内置 `popupSelect` 浮层的定位实现没换。
- release notes 所指"自定义浮层需适配新定位接口"落在 **ui-primitives**：
  - 移除公共导出 `useAnchoredPosition` 与类型 `AnchoredPositionOptions`（旧文件 `src/useAnchoredPosition.ts` 在 rc.2 整体删除）——**破坏性**，但只影响自己 import 该 hook 画浮层的插件。
  - 新增 `menu-submenu-position.ts`、`useMenuSubmenu.ts`、`SubmenuPanel.tsx`、`MenuRow.tsx`、`usePointerGrace`（Menu 子菜单定位/悬停引导的新实现），并新增导出 `usePointerGrace`、`FenceCodeBlock`/`FenceMathBlock`/`MarkdownDelegateFenceInfo`、`QuoteSummary`。
  - rewind 插件用 `ui.kind: 'popupSelect'`（host 内置 shell），不触碰这些原语 → 无影响。
- 本包其余 diff：`presentation.ts` 仅 import 换行格式化；`package.json` 仅版本号与发布 files（补 sourcemap、`src`）。

## 5. `packages/client/ui-session/src/client/index.ts` — 标准会话钩子

**结论：无变化。** `cmp -s` 完全相同：`SessionStatus`（含 `running`）、`useSessionStatus`、`useSession`、Session/Global 标准钩子 merge 全部原样。包内其余 diff：`package.json`（版本/发布 files）与测试 fixture（snapshot 字面量补 `historyLoadStatus: 'idle', historyWasPartial: false`——见第 6 点的 snapshot 新字段，属于测试适配，非 API）。

## 6. `packages/api/session-controller/src/client/` — ctx.sessions / SessionBinding / SessionFace

**结论：插件用到的三个面完全无变化；包内有增量 + 两处生态级破坏（均不影响本插件）。**

- `ISessions.binding(id)`：签名与语义未变（contract/sessions.ts 仅 forkChild 的 doc 措辞变化——fork 改名会跳过 Host 已列出的编号）。
- `SessionBinding`（`sessions/service.ts:105`）：`{ sessionId, session: SessionFace, eventSource, ctx }` 两版逐字相同。
- `SessionFace.command(line): Promise<RemoteResult<{ matched: boolean }>>`（contract/session.ts）：完全未变。插件的 `submitLine` 无需改。
- `ISession.loadOlder`：签名拓宽为 `loadOlder(options?: { deferConsumption?: boolean }): Promise<void>`——**向后兼容**（无参调用仍合法）。
- `ISession` 新增 `consumeOlder(): boolean`（同步发布预备历史页）。
- `SessionSnapshot`（contract/snapshot.ts）：
  - 新增 `historyWasPartial: boolean`、`historyLoadStatus: 'idle' | 'loading' | 'pendingConsumption' | 'error'`；
  - `running`、`loadingOlder`、`hasMore` 等保留；
  - **移除 `subagent.parentAvailable?`**（破坏性，只影响读该字段的代码；插件未用）。
- 实现文件（manager.ts / remotes.ts / service.ts / session.ts）无 export 签名变化（diff 过滤 `^[+-]export` 为空）；service.ts 内部 `increasedForkTitle` 增加 `taken` 集合参数（配合 fork 标题跳号）。

## 7. `packages/client/locale`（@deepseek-ai/dsh-client-locale）

**结论：无变化。** 整包递归 diff 仅 `package.json`（版本号、发布 files）。`src/client/index.ts` 原样：`ctx.locale.register(ns, dicts)` / `ctx.locale.bind(ns)` 未变。

## 8. `packages/client/modules`（dsh.client 声明扫描）与 `extensions/cordis-client-runner/src/client/slot-catalog.ts`

**结论：目录文档有增量，turnTail/assistant-actions 条目契约无变化；modules 的 node 半（dsh.client 扫描）无变化。**

- slot-catalog.ts：
  - `conversation.chat.turnTail` 条目：kind `list`、scope `session`、ownerProps（`TurnTailOwnerProps`：turn/seq/openFile）、registerOptions（id 必填 + order/label）、standardProps 列表全部未变，仅 `source` 行号 487 → 492。
  - `conversation.chat.assistant-actions` 条目：同样未变，`source` 493 → 498。
  - 文件级变化：`ClientSlotEntry.kind` doc 增加 `hoc`；`replaceRisk` 枚举 doc 增加 `wraps-owner-content`；新增若干 markdown.fence 等 hoc 槽条目；部分条目 source 行号随 ui-chat 文件增行偏移（如 ui-context-menu 34 → 42）。
- api-catalog.ts（同包）：`ISession`/`SessionSnapshot` 声明串同步了第 6 点的增量；`ComposedProps` 串加了 `HocShare`；`SlotCore` 声明未变。
- modules 包 node 半（`__DSH_BOOT__` 组合、增量 dsh.client 扫描、bundle route、webPlugins）src 无文件变化；变化集中在 client 半 entries.ts（见第 10 点）、README、package.json、测试。

## 9. 递归 diff 摘要（接口相关，忽略纯样式/文档格式）

| 目录 | 变化文件 | 接口相关性 |
|---|---|---|
| `client/ui-commands` | `package.json`（版本/发布 files）；`src/client/presentation.ts`（import 格式化） | **无 API 变化**；contract.ts、popup.ts、PopupSelectView.tsx 原样 |
| `client/ui-session` | `package.json`；`tests/ui-session.client.spec.ts`（fixture 补 snapshot 新字段） | **无 API 变化**；`src/client/index.ts` 原样 |
| `client/ui-slots` | `package.json`；README×3；`src/index.ts`（hoc kind 全套增量）；`src/renderer.ts`（注释）；tests×2 | **增量 API**：`SlotKind` + `'hoc'`、`HocRenderOpts`/`HocShare`/`HocKeysOf`、`KindOptions` hoc 分支、register hoc 校验；既有 kind 的类型与运行时行为等价 |
| `api/session-controller/src/client` | `contract/session.ts`（loadOlder 拓宽 + consumeOlder）；`contract/snapshot.ts`（+historyWasPartial/historyLoadStatus，−subagent.parentAvailable）；`contract/sessions.ts`（fork 文档）；`sessions/{manager,remotes,service,session}.ts`（实现，无 export 变化） | 详见第 6 点 |
| `client/modules` | `package.json`、README×3、`src/client/entries.ts`（容错修复）、`tests/entries.client.spec.ts`（新测试） | 详见第 10 点；node 半（dsh.client 扫描）无变化 |
| （关联）`client/ui-primitives` | 移除 `src/useAnchoredPosition.ts` 及其导出；新增 `menu-submenu-position.ts`/`useMenuSubmenu.ts`/`SubmenuPanel.tsx`/`MenuRow.tsx`/`pointer-grace.ts` 及导出；markdown Fence/copy-tex/diff-fence 等 | **破坏性**（useAnchoredPosition 移除），影响自定义浮层作者，不影响 popupSelect decorate 使用者 |
| （关联）`client/locale` | 仅 `package.json` | 无 API 变化 |
| （关联）`extensions/cordis-client-runner` | `api-catalog.ts`、`slot-catalog.ts`（目录文档同步）、`package.json` | 无运行时契约变化 |

## 10. "修复可选插件加载失败导致整个 Web 页面无法启动"

**结论：改动在 `packages/client/modules/src/client/entries.ts`，是浏览器半 Loader 条目创建的容错；插件包的 dsh.client 声明/加载路径本身未变，插件无需适配，反而受益。**

- rc.1：
  ```ts
  await this.create(loader, id)
  ```
  任一 roster 行创建失败（例如模块没有导出插件）→ Promise.all 整体 reject → Web 启动中断。
- rc.2：
  ```ts
  await this.create(loader, id).catch((error: unknown) => { loader.ctx.logger.error(error) })
  ```
  失败行记入 logger、留作 inactive 条目，boot audit 仍覆盖它，其余插件照常激活；新测试 `entries.client.spec.ts`（"logs a row whose Loader creation rejects at startup..."）验证了失败行可经 `retry()` 恢复。
- dsh.client 声明扫描、`__DSH_BOOT__` 组合、bundle route、webPlugins service（node 半）两版无文件变化 → 插件打包/声明方式不受影响。
- 对 rewind 插件的含义：即便插件自身在某环境加载失败，也不再拖垮整个 Web 页面（防御性收益）；无需改动。

---

## 破坏性清单（rc.1 → rc.2，client/Web 侧）

1. **`@deepseek-ai/dsh-client-ui-primitives` 移除公共导出 `useAnchoredPosition` / `AnchoredPositionOptions`**（文件 `src/useAnchoredPosition.ts` 删除，由 `menu-submenu-position.ts` + `useMenuSubmenu.ts` 等替代）。仅影响直接使用该 hook 的自定义浮层组件。rewind 插件未用。
2. **`SessionSnapshot.subagent.parentAvailable` 移除**。仅影响读取该字段的代码/测试 stub。rewind 插件未用。
3. **`SessionSnapshot` 新增必读字段 `historyWasPartial`、`historyLoadStatus`**：读方向的增量，但手写 snapshot 对象字面量（测试 fixture、mock）会因缺字段编译失败——属测试适配，非插件运行时问题。
4. `ISession.loadOlder(options?)` 签名拓宽、新增 `consumeOlder()`、`SlotKind` 增加 `'hoc'`、KindOptions/ComposedProps 扩展：全部向后兼容的加法，无破坏。

## 对 rewind 插件 client 半的评估

**不需要任何修改。** 插件用到的全部 API 在 rc.2 原样保留：

- turnTail 槽位声明、`TurnTailOwnerProps`、`TurnLocation`：逐字相同；
- `PropsRuntime`/`InjectFace`/`PropsLocale`/`Translate`/标准钩子 merge、`ctx.slots.register/inject`：未变（hoc 为旁路新增）；
- `ctx.commandUi.decorate` + `PopupSelectSpec`（popupSelect shell）：未变，浮层定位改动在 ui-primitives 内部、对 decorate 不可见；
- `useSessionStatus` + `SessionStatus.running`：未变（snapshot.running 保留）；
- `ctx.sessions.binding` → `SessionBinding.session.command`：未变；
- `ctx.locale.register/bind`：未变；
- dsh.client 声明/加载路径：未变（modules 容错修复只让失败更可控）。

建议适配动作（可选，非必需）：

1. 无必改项；如插件有测试手写 `SessionSnapshot` 字面量，补 `historyLoadStatus: 'idle'`、`historyWasPartial: false` 两字段（对齐 rc.2 fixture）。
2. 若未来要在代码 fence 上做文章，rc.2 提供了新能力：`conversation.chat.markdown.fence`（hoc 槽）+ `MarkdownDelegateFenceInfo`/`FenceCodeBlock`——与 rewind 无关，仅作记录。
3. 升级依赖到 rc.2 的 `@deepseek-ai/dsh-client-ui-slots` 等包时无需改 import；`peerDependencies` 要求的 cordis 版本号随 workspace `0.2.2-rc.2` 走即可。

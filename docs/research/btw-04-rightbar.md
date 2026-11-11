# 调研 #4：dsh Web UI 右侧边栏（rightbar）tab 扩展机制

目标：为 /btw 插件的"队列管理面板"找到放进右侧边栏的注册路径。
源码：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（dsh v0.2.2-rc.2），与 rc.1（`D:/Code/Projects/dsh-utils/dsh-source/src`）已做对比。

## 结论（TL;DR）

右侧栏 tab 是**两阶段注册**，全部走公开 API，第三方插件完全可仿造（registry 文档明确写着 "a tab type may ship from outside this repository"）：

1. **阶段一（类型）**：`ctx.sidebarRightTabs.register(definition)` —— 声明 `id / kind / title / guide 入口`（服务名 `sidebarRightTabs`，由 `packages/client/ui-sidebar-right` 提供）。
2. **阶段二（身体）**：`ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({ name: 'sidebar.right.pane.tab', key: <definition.id> }, Body))` —— key 必须等于 definition 的 `id`。
3. （可选）**标题**：同法注入 `'sidebar.right.pane.tab.title'` 槽做"活标题"。
4. 打开：`ctx.sidebarRight.openTab('<kind>', { params })`。

badge：**tab chip 没有独立徽标字段**（`TabRecord` 只有 `id/kind/contentId/title`），但 title 槽是活组件，可以在标题文本里带计数（"队列 (3)"），icon+文字随意渲染。
最值得抄的范例：`packages/experimental/client-ui-forge/src/client/mount.ts`（产品外插件，extension band，最小路径）；带 store/params/删除交互的完整范例是 `packages/client/ui-schedule`。

---

## 1. 槽位契约（slot catalog）

权威目录（生成产物，含所有槽的 kind/scope/owner/occupants）：
`packages/extensions/cordis-client-runner/src/client/slot-catalog.ts`

契约声明源：
`packages/client/ui-sidebar-right/src/client/contract/slots.ts`

rightbar 相关槽一览：

| 槽 key | kind | scope | 声明者（owner） | 现有占用者 | 用途 |
|---|---|---|---|---|---|
| `rightbar` | single | root | `root`（ui-layout） | `client-ui-sidebar-right RightbarRoot` | 右列整体（**不要动**，replaceRisk: shadows-shipped-ui） |
| `rightbar.session` | single | session | `rightbar`（ui-sidebar-right） | `client-ui-sidebar-right RightbarSeat` | 会话级面板壳（**不要动**） |
| `sidebar.right.pane.tab` | **keyed** | session | `rightbar.session` | 各 tab 类型按 `id` 注册 | **tab 正文——第三方在这里加面板** |
| `sidebar.right.pane.tab.title` | keyed | session | `rightbar.session` | 同上（可选） | tab chip 的"活标题" |
| `sidebar.right.tab.guide` / `.actions` / `.entry` | chain/list/keyed | — | guide tab | guide 自身 | guide 页替换/More 菜单/卡片 |
| `sidebar.right.tab.menu.item` | list | session | tab 菜单 | — | 给 tab 的"⋯"菜单追加条目 |

要点：
- keyed 槽的 key domain 是**开放字符串**，注册键 = tab 类型 definition 的 `id`（不是 kind！`kind` 可被 extension band 接管，`id` 是实现身份）。
- `sidebar.right.pane.tab` 的 `hookContext: TabHookContext`、`inject: { hooks: { tabInfo } }` —— body 组件拿到 `useTabInfo()`。
- slot-catalog 中对应条目（行号约 3238-3282）标注 `declaredBy: an entry in 'rightbar' (client-ui-sidebar-right)`；`standardProps` 里 session scope 的槽自动带 `sessionId / useSession / useSessions / useChat / useConversation / useResource / useContextMenu ...`。

## 2. 两阶段注册机制

### 2.1 阶段一：类型注册表 `ctx.sidebarRightTabs`

- 实现：`packages/client/ui-sidebar-right/src/client/tab-registry.ts`（class `SidebarRightTabRegistry`）。
- 服务暴露：`packages/client/ui-sidebar-right/src/client/index.ts`
  ```ts
  declare module '@deepseek-ai/cordis' {
    interface Context {
      sidebarRight: SidebarRightController      // 导航/呈现
      sidebarRightTabs: SidebarRightTabRegistry // tab 类型注册表（阶段一）
    }
  }
  // ctx.reflect.provide('sidebarRightTabs', tabs)
  ```
- definition 形状（`SidebarRightTabDefinition`，全部字段）：
  ```ts
  {
    id: string          // 实现身份，全局唯一（包名是自然值）；也是阶段二的槽 key
    kind: string        // 类型判别器；openTab 用的名字
    multiple?: boolean  // 每次打开独立内容；缺省 = 每 pane 一个页面
    keepMounted?: boolean // 访问过的 body 藏起/换会话/停靠都保持挂载；默认 false
    patterns?: string[] // 资源地址 glob（页面型 tab 省略）
    priority?: 'extension' | 'builtin' | 'fallback'  // 缺省 'extension'（第三方）
    canOpen?: (address) => boolean
    title: (address) => string   // 打开时捕获进布局记录的 chip 文本
    guide?: [{ id, order, title: () => string, description?: () => string, icon?: ComponentType<IconProps>, commandId? }]
                        // guide 页（"+"入口）上的入口卡；不注册就不上 guide
  }
  ```
- band 规则：`extension`(3) > `builtin`(2) > `fallback`(1)；extension 可接管 builtin 的 kind（接管期间 body/title 也换到 extension 的 id 下）。第三方不写 `priority` 即为 extension，最高优先级。
- 注册在 `ctx.effect` 内，返回 disposer；id 重复 / 同 band 同 kind 会 throw。

### 2.2 阶段二：body 与 title 注册（keyed 槽注入）

`sidebar.right.pane.tab` 由 RightbarSeat 在 `rightbar.session` 下声明为 keyed 子槽（见 `ui-sidebar-right/src/client/index.ts` L242-263），dispatch 时 `entryKey = definition.id`（`shell/SidebarRight.tsx` 的 `TabSlot`：`renderSlot(seat, {}, { entryKey: definition?.id ?? tab.kind, ... })`）。**未注册的类型渲染 owner 的 "tab.unavailable" 占位**，不炸。

`ctx.sidebarRight`（`service.ts`，`ISidebarRight`）常用面：
```ts
ctx.sidebarRight.openTab(kind, { params?, paneId?, preferNewPane?, replaceTab?, revealIfOpened? })
ctx.sidebarRight.openResource('dsh-resource://...', { params?, kind?, destination?: 'sidebar'|'float' })
ctx.sidebarRight.close(tabId) / hide(tabId) / focus(tabId) / active() / isExpanded() / toggleExpanded()
ctx.sidebarRight.tabsIn(sessionId): readonly TabRecord[]   // 恢复/遍历打开的 tab
ctx.sidebarRight.mounted: ObservableSnapshot<SessionId | undefined>  // 当前屏上会话
ctx.sidebarRight.registerCloseHandler(kind, (sessionId, tab) => {...})  // tab 关闭前清理钩子
ctx.sidebarRight.openTabFromTarget(kind, target)  // 快捷键路径（结合 commandTarget）
```
注意：`openTab` 作用于**屏上会话**（无会话 throw `'no session surface is mounted'`）；`tabsIn` 可查任意已 adopt 会话。params 通过声明合并进 `SidebarRightTabParamsMap`（`contract/params.ts`），body 端从 `tab.navigation.params` 读回；**持久化只存布局记录不存 params**——跨重载要自己存绑定（schedule 的 `TaskTabBindings` 就是干这个的）。

### 2.3 最小注册代码（仿 forge，产品外插件原型）

```ts
// packages/experimental/client-ui-forge/src/client/mount.ts:351-362
export const inject = ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight', ...]

ctx.effect(() => ctx.locale.register(NS, { zh, en, ... }), '...dictionaries')
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: TAB_ID,                 // '@deepseek-ai/dsh-experimental-client-ui-forge'
  kind: TAB_KIND,             // 'forge-panel'
  title: () => t('tab.title'),
  guide: [{ id: 'review', order: 15, title: () => t('guide.title'),
            description: () => t('guide.description'), icon: IconBranchOutlineRegular }],
}), 'forge-panel: sidebar tab')
ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
  { name: 'sidebar.right.pane.tab', key: TAB_ID, locale: NS, inject: tabFace }, ForgeTab))
ctx.slots.inject('sidebar.right.pane.tab.title', () => ctx.slots.register(
  { name: 'sidebar.right.pane.tab.title', key: TAB_ID, locale: NS }, ForgeTabTitle))
```
forge 还示范了"header 按钮切换显隐"（`mount.ts:381-384`）：
```ts
if (!visible) { ctx.sidebarRight.openTab(TAB_KIND); return }
const tab = ctx.sidebarRight.tabsIn(sessionId).find(tab => tab.kind === TAB_KIND)
ctx.sidebarRight.hide(tab.id)
```

### 2.4 带参数页面型 tab（最贴近 /btw 队列面板的完整范例：ui-schedule）

`packages/client/ui-schedule/src/client/`：
- `definition.ts`：`declare module '@deepseek-ai/dsh-client-ui-sidebar-right/client' { interface SidebarRightTabParamsMap { scheduleTask: { sessionId; id } } }`；kind `scheduleTask`，无 patterns（页面型）。
- `index.ts:120` 注册类型；`:205-217` 注册 body+title（都带 `store: createEditorStore()` 与 `inject`）；`:256` 从聊天卡片 `ctx.sidebarRight.openTab(SCHEDULE_TASK_KIND, { params: { sessionId, id } })` 打开。
- `ScheduleTaskTab.tsx`：props = `PropsRuntime<'sidebar.right.pane.tab'> & TaskEditorStoreProps & PropsLocale & InjectFace<...>`；解构出 `sessionId, useTabInfo, t`；删除完成 `tab.actions.close()`。

浏览器 tab（'browser'）注册：`packages/client/ui-sidebar-browser/src/client/index.ts`（definition 在 `definition.tsx`：`multiple: true, priority: 'builtin'`，guide order 30；body `:82-95` 带 per-session controllers Map + rebind；title `:102-104` 从 store 读当前页标题）。

## 3. rc.2 vs rc.1：注册契约无变化

逐文件 diff `dsh-source`（rc.1）vs `dsh-source-rc2`：
- `ui-sidebar-right` 包内 `contract/slots.ts`、`tab-registry.ts`、`client/index.ts`、`service.ts`、`tab-info.ts` **全部相同**；仅 `package.json`（版本号）与两个 `.module.css` 有差异。
- rc.2 release notes 所说"侧栏收纳（不常用入口移入'更多'）"改的是**左**侧栏 `packages/client/ui-sidebar`：新增 `SlotFactoryMap` 里的 `'sidebar.panel.icon'` 工厂槽、`PanelIcon.tsx`、`scroll-handoff.ts`，`sidebar.workspaces` 槽加了 `hookContext/inject`（useSectionScroller）——与右栏 tab 注册无关。
- 结论：按 rc.1 写的右栏 tab 注册代码在 rc.2 原样可用；guide 的 pin/More（`sidebar.right.tab.guide.actions` + `guide-pins.ts`）两个版本都已存在，"收纳"早就在右栏 guide 里实现（`onPinnedChange` 可钉/取消钉卡片）。

## 4. 面板组件拿到的 props / hooks 与生命周期

body 组件 props = `PropsRuntime<'sidebar.right.pane.tab'>`（`packages/client/ui-slots/src/index.ts:255`）：
- `OwnerOf` — keyed 槽无 owner props → `object`
- `ScopeStandardProps<'session'>` — `SessionStandardProps` 合并（`packages/client/ui-session/src/client/index.ts:166-175`）：**`sessionId: SessionId`、`useSession`、`useProjection`、`useAccess`** + Global 标准 hooks（`useSessions/useWorkspaces/useResource/useContextMenu/...`）
- `SlotInjectFace` — 槽级 `hooks: { tabInfo }`（`SidebarRightTabInjected`）
- `InjectFace<T>` — 注册时自己 `inject:` 传入的任意 face（store actions、hooks 等）

`useTabInfo()`（`tab-info.ts` 的 `tabInfoFactory`）返回 `SidebarRightTabInfo`（`contract/slots.ts:184-209`）：
```ts
{
  sidebar: { expanded, fullscreen },
  panel: { id: PaneId, isFloating },
  tab: TabRecord & {
    visible: boolean          // 前台会话 + 展开且选中（float 例外）
    navigation: { address, params, revision }  // revision 每次重复 open 递增
    signal: AbortSignal       // 仅当 tab 记录消失或插件卸载才 abort（隐藏/切会话不 abort）
    actions: {
      bindCommands({ refresh? })   // 绑定页面命令（⌘R 刷新按钮）
      openResource(address, opts) / openTab(kind, opts)  // 作用于本 tab 所在会话
      close()
    }
    refreshShortcut?
  }
}
```
会话跟随：右栏是 **session-scoped** 面板，每个 Session 一份 store/视图（`SidebarSessionViews`）；组件直接用 props 里的 `sessionId`，切换会话即换实例。`tab.signal` 生命周期覆盖记录存在期；`keepMounted: true` 可让访问过的 body 在隐藏/切会话/停靠变化时保持挂载（`SidebarRight.tsx:208-209` 走 `retainTab`）。布局（开了哪些 tab、分屏、浮窗）按会话持久化（`persistence.ts`，`dsh.sidebar-right.v1`），重载后恢复记录但 **params 不恢复**。

## 5. badge / 未读计数

- `TabRecord`（`packages/client/ui-dockkit/src/contract/types.ts:93-98`）仅 `id/kind/contentId/title`；chip、dockkit 全库 grep `badge|unread` **零命中**——没有原生徽标。
- 可行替代：**`sidebar.right.pane.tab.title` 活标题**。title 注册是普通 React 组件（见 `BrowserTitle.tsx`、`ForgeTabTitle.tsx`：icon + 文本任意 JSX），读自己的 store 把计数拼进标题，如 `<Icon/><span>队列 ({n})</span>`。chip 在 tab 可见（含非激活 tab 的展开态）时都会渲染 title（`visible` 规则见 `tab-info.ts:46`）。
- 另外可配合 guide 卡（`guide[].title: () => string` 也是 thunk，语言/内容变化即时读）与会话行角标（`sidebar.session.row.leading`，ui-schedule 的 `SessionScheduleMark` 先例）做提醒。

## 6. 列表操作 UI 先例

- **行内按钮**：`packages/client/ui-deliverables/src/client/ReviewTab.tsx:111-152` —— 面板头部工具条（Tooltip + `css.tool` 按钮）+ 每行渲染子槽 `renderSlot('deliverables.review.file.actions', { actionUrl, available, pending, onAction })` 让别的包补行内动作（ui-open-in-app 注入"打开方式"按钮）。删除后收尾：`ScheduleTaskTab.tsx:134` `onDeleted={() => { tab.actions.close() }}`。
- **tab chip 右键菜单**（ctx.contextMenus，target `'tab'`）：`ui-sidebar-right/src/client/index.ts:141-158`（close/closeOthers/closeRight，`MenuAction { id, label, icon?, disabled?, run() }`）。target 类型表在 `packages/client/ui-context-menu/src/client/types.ts:28-41`（`tab: { sessionId, paneId, tab: TabRecord }`）。给特定 tab 的"⋯"菜单加条目则用槽 `sidebar.right.tab.menu.item`（list, session；owner props `{ tab, dismiss }`，`contract/slots.ts:222-234`）。
- 面板内列表+删除+确认+toast 的完整闭环：ui-schedule（`catalog-source.ts` 删除 → `shell.overlay` 的 `ScheduleDeleteToast` → `ScheduleTaskTab` 的 `onDeleted` 关 tab）。

## 7. /btw 队列面板落地建议（最小路径）

1. `inject: ['slots', 'locale', 'sidebarRightTabs', 'sidebarRight']`。
2. `ctx.sidebarRightTabs.register({ id: '<pkg-id>', kind: 'btw-queue', title: () => t('title'), guide: [{ id: 'open', order: 40, title: ..., icon: ... }] })`（缺省 priority='extension'，天然最高带）。
3. `ctx.slots.inject('sidebar.right.pane.tab', ...)` 注册 QueuePanel（props 解构 `sessionId, useTabInfo`；队列数据放自己 store，经 `inject:` 传入）；`sidebar.right.pane.tab.title` 注册活标题 `队列 (n)`。
4. slash 命令回调里 `ctx.sidebarRight.openTab('btw-queue')`（注意无屏上会话会 throw，需 catch 或检查 `ctx.sidebarRight.mounted.getSnapshot()`）。
5. 队列数据跨重载需自持久化（tab 记录只保 id/kind/contentId/title）。

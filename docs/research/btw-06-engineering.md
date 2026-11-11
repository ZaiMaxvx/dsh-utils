# btw 调研 06：/btw 插件工程化方案（最大化复用 rewind 插件资产）

调研子 agent #6（共 6）。源码树：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`（dsh v0.2.2-rc.2，兼顾 rc.1 核对）；被复用资产：`D:/Code/Projects/dsh-utils/rewind-plugin/`（dsh-plugin-rewind v0.1.1，双半包）；git 仓库根：`D:/Code/Projects/dsh-utils/repo/`（GitHub `ZaiMaxvx/dsh-rewind`，仓库根即插件包根）。

产品形态假设（来自分工简报）：btw = "命令 + 客户端面板"型 —— `/btw <text>` 把一条附言停靠（park）到当前会话的队列；agent 空闲时按配置投递；Web 侧一个面板管理队列（查看/改/删/立即发送），面板靠客户端状态订阅保持实时。比 rewind **少** surface replace 提交逻辑、**多** 客户端状态订阅与常驻面板。

---

## 1. 逐文件复用清单（对照 rewind-plugin）

| rewind 文件 | btw 处置 | 说明 |
|---|---|---|
| `package.json` | **改**（骨架照抄） | name→`dsh-plugin-btw`；`dsh.bundle.patch` 不变模式；`dsh.client.inject` 列表换成本插件客户端依赖的宿主 client 包（见 §5）；`engines.dsh: ">=0.2.2-rc.1 <0.3.0"` 可原样保留（rc.1/rc.2 双验证）；`exports` 增删子路径（去掉 `./planner` `./rewind`，加 `./queue` `./types`）；scripts/test/check 完全同构 |
| `cordis.patch.yml` | **改 3 行** | 头注释换包名；`- insert: [{ id: btw, name: dsh-plugin-btw }]`。结构逐字复用 |
| `dev.patch.yml` | **改 2 行** | 绝对路径指向新包 `src/index.ts`（`pnpm dsh web --patch` 用） |
| `scripts/gen-tsconfig-paths.mjs` | **直接复用（0 改）** | 通用：扫 dsh 源树 package.json 生成 paths。参数 `<dsh-source-root> <out>` 不变 |
| `scripts/compose-check-tsconfig.mjs` | **直接复用（0 改）** | 通用：合成 host/client 两个 tsc 检查面；唯一宿主耦合是 `include: [src/*.ts]` / `src/client/**` —— btw 布局相同，无需动 |
| `scripts/hooks.resolve.mjs` + `register-hooks.mjs` | **直接复用（0 改）** | 通用 `@deepseek-ai/*` → 源码树解析钩子；`DSH_SRC` 切 rc.1/rc.2 机制照用 |
| `scripts/smoke.session.mjs` | **重写内容、复用框架** | rewind 冒烟测 applyRewind；btw 冒烟测纯队列模型 + 真实 Session 上的事件折叠（projection fold）。assert 风格/加载方式照抄 |
| `tsconfig.json` / `tsconfig.paths.json` / `tsconfig.check.host.json` / `tsconfig.check.client.json` | **直接复用（paths 重新生成）** | paths.json 是生成物；其余照抄 |
| `vitest.config.ts` | **直接复用（0 改）** | DSH_SRC 别名机制通用；如加 jsdom 客户端测试需补 `environmentMatchGlobs` 或第二个工程（见 §6） |
| `src/index.ts` | **重写（模式复用）** | 复用：`name`/`inject`/`Config`（schemastery）/命令注册骨架（`ctx.effect(function*(){ yield drain; yield ctx.commands.register(...) })`、`active` Promise 集合 drain、`CommandDefinitionId('dsh-plugin-btw')`、`input.hint`、错误文案风格）。新增：队列服务 + 空闲投递监听（§4） |
| `src/types.ts` | **改** | rewind 是 `MessageSourceMap` 合并；btw 需要 `SessionEventMap` 合并（`btw/parked` 等 log-only 事件，参照 plan-mode 的 `'plan/mode'` 写法）。若投递走 `agent.followup`，投递消息的 source 也可合并 `MessageSourceMap['btw']` |
| `src/planner.ts`（零依赖纯函数） | **对应物：`src/queue.ts`** | btw 的纯函数层：队列模型（park/replace/remove/reorder/deliver 计划、去重/上限/合并策略）。同样零 import、vitest 直测（§6） |
| `src/rewind.ts`（Session 提交） | **对应物：`src/projection.ts`（可选）** | btw 无 surface replace；若队列要持久化/客户端订阅，把 fold 定义放这里（`sessionProjections.register` 的 definition），职责对应"对真实 Session 的写入/折叠"层 |
| `src/client/index.ts` | **重写（模式复用）** | 复用：`inject` 声明、`import type {}` 拉声明合并的纪律、`ctx.locale.register(NS, { zh, en })`、`ctx.commandUi.decorate`（bare `/btw` 开面板 → `ui: { kind: 'action', run }`，参照 ui-message-feedback）、`ctx.slots.inject(...)` + `ctx.slots.register`（list/keyed 均有样板）。新增：`ctx.sidebarRightTabs.register`（§3） |
| `src/client/TurnTailRewind.tsx` | **对应物：`src/client/BtwPanel.tsx`** | 复用组件写法：`PropsRuntime<K>` + `InjectFace<I>` + `PropsLocale<NS>` 组合 props、`useSessionStatus` 门控、`t()` 文案、css-modules。btw 面板是 session 作用域 keyed 槽组件（`sidebar.right.pane.tab`） |
| `src/client/locales.ts` | **改内容** | zh 键集为真源 + `satisfies Record<RewindKey→BtwKey, string>` 的 en、`declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { btw: BtwKey } }` 合并 —— 三件套照抄 |
| `src/client/css-modules.d.ts` | **直接复用（0 改）** | css module 类型声明同款 |
| `locale/en.json` / `locale/zh.json` | **改内容** | `meta.title`/`meta.description`（插件页/市场显示元信息，根包从 locale meta 读） |
| `tests/planner.spec.ts` | **对应物：`tests/queue.spec.ts`** | 纯函数表驱动测试，同构 |
| `tests/rewind-session.spec.ts` | **对应物：`tests/btw-session.spec.ts`** | 真实 `Session.create()` + 手工 turn 骨架 + 折叠断言，同构（btw 断言队列事件折叠而非 surface） |
| `README.md` / `README.zh.md` | **改内容** | 结构照抄：What you get 表 / Layout / Install / Development / Verification / Configuration / Design notes |

结论：**工具链 8 个文件全部零改动复用**（scripts×5、tsconfig×2、vitest.config，仅重新生成 paths.json）；双半包结构、验证纪律、发布模式整体平移；业务文件按"对应物"重写。

---

## 2. btw 插件文件树规划（每文件职责）

```
dsh-btw/（仓库根 = 包根，独立仓库，见 §7）
├── package.json            # name: dsh-plugin-btw；dsh.bundle.patch + dsh.client(inject 列表) + engines.dsh；
│                           #   scripts.test / scripts.check 与 rewind 逐字同构
├── cordis.patch.yml        # bundle 层：- insert: [{ id: btw, name: dsh-plugin-btw }]
├── dev.patch.yml           # 开发 overlay：绝对路径指向 src/index.ts（pnpm dsh web --patch）
├── README.md / README.zh.md
├── locale/en.json          # meta.title "BTW" / meta.description（插件页显示元信息）
├── locale/zh.json
├── tsconfig.json           # 自包含编译选项（照抄 rewind）
├── tsconfig.paths.json     # 生成物：node scripts/gen-tsconfig-paths.mjs <dsh-root> tsconfig.paths.json
├── tsconfig.check.host.json    # 生成物（compose-check-tsconfig.mjs）
├── tsconfig.check.client.json # 生成物
├── vitest.config.ts        # DSH_SRC 源码面别名（照抄）
├── scripts/
│   ├── gen-tsconfig-paths.mjs      # 复用（0 改）
│   ├── compose-check-tsconfig.mjs  # 复用（0 改）
│   ├── hooks.resolve.mjs           # 复用（0 改）
│   ├── register-hooks.mjs          # 复用（0 改）
│   └── smoke.session.mjs           # 重写：队列模型 + 真实 Session 折叠冒烟（node --import ./scripts/register-hooks.mjs）
├── src/
│   ├── index.ts            # host 半：/btw 命令（parseBtwInput 语法：空=面板提示、text=停靠、list/clear/<id> 管理）；
│   │                       #   Config（§4）；sessionProjections 注册；agent/status 空闲监听 → 按 deliverOnIdle 投递
│   ├── queue.ts            # 纯队列模型（零 import）：BtwItem、park/replace/remove/move/清空、投递计划
│   │                       #   （deliverPlan(queue, {merge}) → 待发消息列表）、上限/去重策略 —— planner.ts 的对应物
│   ├── projection.ts       # 'btwQueue' SessionProjectionDefinition：fold btw/* 事件 → 队列状态（含 wire 视图给客户端）；
│   │                       #   stateVersion 从 1 起（rc.2 仅放宽了 bump 文档，无 API 变化）
│   ├── delivery.ts         # 空闲投递执行：监听 agent/status(idle) → deliverPlan → agent.followup(createUserMessage(...))；
│   │                       #   立即投递（agent 已 idle 时）与"仅停靠"分支；写 btw/delivered 事件；纯逻辑尽量下沉 queue.ts
│   └── types.ts            # declare module 合并：SessionEventMap（'btw/parked'|'btw/removed'|'btw/delivered'，log-only）、
│                           #   MessageSourceMap['btw']（投递消息 source）、SessionProjectionMap['btwQueue']（如有此 map）
└── src/client/
    ├── index.ts            # browser 半：locale 注册；sidebarRightTabs.register（id 'dsh-plugin-btw'，kind 'btw'，
    │                       #   guide 条目带 icon）；sidebar.right.pane.tab(.title) keyed 槽注册（key=同 id）；
    │                       #   commandUi.decorate（bare /btw → ctx.sidebarRight.openTab('btw')）；可选 composer 快捷按钮
    │                       #   （conversation.input.right list 槽）；ctx.provide('btwUi', …) 面板开口服务
    ├── BtwPanel.tsx        # 面板体：PropsRuntime<'sidebar.right.pane.tab'> + hooks.tabInfo + useProjection('btwQueue')
    │                       #   + useSessionStatus(running)；列表 + 编辑/删除/上移下移/立即发送；running 时禁用发送
    ├── BtwPanel.module.css
    ├── view.ts             # 纯视图模型（零 React import）：queue state + running → 行模型/badge 计数/发送按钮
    │                       #   disabled 态/空态文案 key —— 可在不进 jsdom 的情况下 vitest 直测（§6 关键新增）
    └── locales.ts          # btw 词典三件套（zh 键源/en 校验/LocaleNamespaceMap 合并）
└── tests/
    ├── queue.spec.ts       # 纯队列模型（planner.spec.ts 同构）
    ├── view.spec.ts        # 纯视图模型（新增，无 DOM）
    └── btw-session.spec.ts # 真实 Session + projection fold + 命令语法纯函数（rewind-session.spec.ts 同构）
```

与 rewind 的结构差异只有三点：host 侧多 `projection.ts`/`delivery.ts`（队列持久化 + 空闲投递），client 侧 `TurnTailRewind` → `BtwPanel` + `view.ts`，`planner.ts` → `queue.ts`。**没有** `rewind.ts`（无 surface replace）、没有 turnTail 槽条目。

依赖面（btw 实际 inject）：
- host：`export const inject = ['commands', 'sessionProjections']`（projection 注册是异步的，`apply` 可 async，参照 plan-mode/time-context）；观察投递用 `ctx.on('agent/status', …)`（emit，`idle`⇄`running`，agent-scoped 分发）或在命令 invocation 持有 `agent` 后 `agent.ctx` 上挂 scoped 监听。命令处理器内 `invocation.agent` 直接给到 `Agent`。
- client：`inject = ['slots', 'locale', 'commandUi', 'sessions', 'sidebarRightTabs', 'sidebarRight']`（terminal 样板同款）。

---

## 3. 客户端面板挂点：sidebar-right tab（含 rc.2 核查）

btw 面板走**右侧栏 tab 类型**（不是左侧 `sidebar.panellist`——那是全局页面入口；btw 队列是 per-Session 状态，session 作用域正确）。两条共享 `id` 的注册（`ui-sidebar-terminal/src/client/index.ts:73-100` 样板）：

```ts
ctx.effect(() => ctx.sidebarRightTabs.register({
  id: 'dsh-plugin-btw', kind: 'btw', priority: 'extension',  // 默认 band，扩展插件天然最高
  title: () => t('title'),
  guide: [{ id: 'btw', order: 60, title: () => t('guide.title'), description: () => t('guide.desc'), icon: IconQueueOutlineMedium }],
}), 'btw: tab type')
ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
  { name: 'sidebar.right.pane.tab', key: 'dsh-plugin-btw', locale: 'btw',
    inject: (sessionId) => ({ /* 面板动作面：submit/edit/remove/sendNow */ }) },
  BtwPanel)), 'btw: panel body')
```

要点（源自 `docs/subsystems/sidebar-right.md` + `tab-registry.ts`）：
- `id` 全局唯一（包名即天然值）；`kind` 是 openTab 的名字（`ctx.sidebarRight.openTab('btw')`）；页面型 tab 无 `patterns`。
- `guide` 条目决定是否出现在 guide 页（省略则不出）；`icon?: ComponentType<IconProps>`；`commandId` 可挂快捷键目录。
- 面板体收到框架注入 `hooks.tabInfo`（`useTabInfo()`：sidebar/panel/tab、`visible`、`navigation`、`signal`、`tab.actions`）。
- 可选 `sidebar.right.pane.tab.title`（keyed，同 id）给 live 标题（如 "BTW (3)" 徽标计数）。
- 布局持久化由 sidebar-right 自己按 Session 存（浏览器本地），插件无需管"面板默认开合"的持久化——默认开合只需在首次打开行为上做文章（§4 配置项据此裁剪）。
- **rc.1 → rc.2 diff 实测**：`ui-sidebar-right/src` 仅两处 `.module.css` 差异（样式微调），`tab-registry.ts`/`contract/slots.ts`/`service.ts` 全部无变化；`ui-session/src` 两版逐字相同。btw 面板在 rc.2 下无适配项。

---

## 4. 设置面：Config volatile 自动成表单

机制（`docs/subsystems/settings.md` + `docs/cookbook/adding-a-settings-card.md`）：
- **只有 `.volatile()` 字段**被 settings 服务投影为 Plugins 页的 live 表单（按 profile 条目 id 命名空间）；普通字段只出现在 config-editor patch，不进表单。`apply` 里读 `config.field.get()`；`.check()` 做跨字段校验（host 侧、不进序列化 schema）。
- 写路径自动闭环：表单 `update/replace/mutate` → config-editor 经 Cordis patch 持久化 → 仅 volatile 变化热生效（`loader/volatile-update`），插件实例不重挂。
- rewind 的 `markerText`/`maxUndoTurns` 均**未** volatile——所以 rewind 没有 live 设置卡；btw 想要设置面就必须 volatile 化。

btw 候选配置（建议）：

```ts
export interface Config {
  autoDeliver: Volatile<boolean>        // 空闲时自动发送队列
  delivery: 'each' | 'merged'           // 逐条各成一轮 vs 合并成一条消息
  notifyOnDelivery: Volatile<boolean>   // 投递完成时 toast 通知
  maxQueued: number                     // 队列上限（普通字段，防误配置即可）
}
export const Config = z.object({
  autoDeliver: z.boolean().default(true).volatile(),
  delivery: z.union(['each', 'merged']).default('each').volatile(),
  notifyOnDelivery: z.boolean().default(false).volatile(),
  maxQueued: z.number().step(1).min(1).max(50).default(20),
})
```

- `autoDeliver=false` 时队列只在面板手动"发送"（`delivery.ts` 的分支依据 `config.autoDeliver.get()`，监听 `loader/volatile-update` 刷新——或每次投递决策时读 `.get()`，更简单且是文档推荐）。
- 通知：`ctx.contextMenus.notify(text, success, action?)`（ui-context-menu 的 toast 动作，最轻）；`workspace.toast` 槽是宿主 UI 内部机制，不作为插件通知通道。
- "面板默认开合"不建议做成插件配置（与 sidebar-right 的布局持久化打架）；如确需，语义定为"投递时自动唤起面板"（客户端 `ctx.sidebarRight.openTab` + `revealIfOpened`）而非"默认开"。

---

## 5. 图标与显示约定

- **图标集**：`@deepseek-ai/dsh-client-ui-primitives` 的 `icons/index.tsx` 导出 `Icon< Glyph ><Weight>` 组件（`dsw-icon-<glyph>-<weight>` sprite 符号引用，继承 `currentColor`）。btw 合适现成字形：`queue-outline`（首选）、`paper-plane-outline`、`send-outline`、`clock-outline`、`list-pen-outline`、`alarm-clock-outline` —— **rc.1 与 rc.2 均存在**（已逐一 grep 核对），engines 覆盖两版没问题。
- guide 条目 / commandUi 菜单行的 `icon` 字段类型都是 `ComponentType<IconProps>`，直接传 `IconQueueOutlineMedium` 即可；不带 icon 时 guide 画默认方块占位。
- guide 页大图标可选 `PluginArtwork*`（36px 多彩，`plugin-artwork.tsx`：Terminal/Loop/Subagent/Search/Default）——btw 用 `PluginArtworkDefault` 或自带 SVG 组件亦可（约定是组件而非资源路径）。
- **显示元信息**：根包插件用包 `package.json` `name/description` + `locale/*.json` 的 `meta.title/meta.description`（rewind 先例；子路径插件才用 `exports['./icon']` 资源约定，btw 是根包不涉及）。市场索引里 icon 可为 ≤32KiB data: URL，非必需。
- rc.2 破坏项对照：`useAnchoredPosition` 已从 ui-primitives **移除**——btw 面板若想画自定义锚定浮层，必须用新的 `MenuSurface`/`useMenuSubmenu` 系或干脆用内置 `popupSelect` decorate；不在面板里自绘锚定弹层即可完全规避。

---

## 6. 测试策略（相对 rewind 的变化）

rewind 三层：纯函数（planner）+ 真实 Session 集成（rewind-session）+ 无 vitest 的冒烟（smoke）。btw 保持三层并**新增一层客户端纯视图测试**，jsdom 组件测试列为可选：

1. **`tests/queue.spec.ts`**（纯函数，vitest node 环境）：park/remove/reorder/上限/去重、`deliverPlan`（each vs merged、空队列、投递后清空）。对应 planner.spec 的地位。
2. **`tests/view.spec.ts`**（纯函数，**新增**）：`view.ts` 把 (queueState, running, autoDeliver) → 行模型/badge/disabled/空态 key。这是"客户端面板逻辑提取纯函数"的落点——面板的**全部**决策逻辑放这里，`BtwPanel.tsx` 只做渲染与动作转发，于是面板可测性与 rewind 的 turnTail 按钮同级（rewind 的 TurnTail 只有一个 disabled 布尔，不需要这层；btw 列表交互多，需要）。
3. **`tests/btw-session.spec.ts`**（真实 Session，vitest + 源码面别名）：手工搭 turn 骨架（照抄 rewind-session 的 `buildSession`/`prompt` helper），`session.append('btw/parked', …)` 后跑 projection fold，断言队列状态、投递后的 `btw/delivered` 事件与 `agent.followup` 的消息形状（agent 用假对象只 stub `followup`/`status`——比 rewind 轻，因为 btw 不碰真实 agent loop；若要真 agent，进程内 `new Context()` + `ctx.plugin(...)` 组合在工具链上可行但收益低）。
4. **`scripts/smoke.session.mjs`**（无 vitest 冒烟）：queue 纯函数 + Session 折叠的最小断言集，`node --import ./scripts/register-hooks.mjs` 直跑——CI 之外的快速验证，与 rewind 相同定位。
5. **（可选）`tests/panel.client.spec.tsx`**（jsdom + `@testing-library/react`）：官方用 `@deepseek-ai/dsh-client-test-runtime` 的 `SlotTestRuntime.create()`（真 Cordis Context + 真 SlotRegistry + jsdom，`declare → mount → renderSlot`）。树外运行需在 workspace-parent `package.json` 补 `jsdom`、`@testing-library/react` 依赖，并把 vitest 该 spec 标 `// @vitest-environment jsdom`；`dsh-client-test-runtime` 本身经解析钩子映射到 dsh 源码。**建议首版跳过**此层（纯视图模型已覆盖决策逻辑，组件薄），把 jsdom 运行时引入列为第二阶段；若要进 dsh workspace 内开发（拷包到 `packages/btw/`），该层开箱即用。
6. **`npm run check` 双面 tsc** 不变：host 面自动覆盖 `src/*.ts`，client 面覆盖 `src/client/**`（含 tsx）——btw 的面板类型（tabInfo hooks、keyed 槽 props）在 client 面被完整检查。

---

## 7. 命名与发布

- **npm 包名**：`dsh-plugin-btw`（延续 `dsh-plugin-rewind` 前缀约定；`dsh-btw` 留作仓库名）。发布前 npm registry 查重一次。
- **仓库**：**独立新仓库 `ZaiMaxvx/dsh-btw`，仓库根 = 包根**（现状 `ZaiMaxvx/dsh-rewind` 即此布局）。理由：
  1. `dsh plugin add github:<you>/<repo>` 简写解析到仓库**根** package.json；两插件同仓则根不是 btw 的包，简写安装直接错包。带子目录的 git 安装要 `git+<url>.git#<commit>&path:/<path>`（plugin-manager `install-spec.ts` 的 `path:` 参数，须 pin 全 commit）——market 生成器找得到，但手工安装体验差且文档负担重。
  2. 两插件 `engines.dsh`、发布节奏、版本号独立演进，独立仓库互不牵连。
  3. plugin-market-generator 的仓库扫描（根声明→workspaces glob→三层目录扫描）对两种布局都能列，但根声明零歧义。
- **发布流程差异（同账号第二个插件）**：流程本身零差异——`npm publish` 前跑 tsdown 产出 `lib/index.js`（host）+ `lib/client.js`（client 懒 CJS 工厂格式）+ locale + cordis.patch.yml，`files` 数组对齐产物；`dsh plugin --profile <p> add dsh-plugin-btw` / `github:ZaiMaxvx/dsh-btw` 安装。仅有的注意点：npm 上同名先查重；`ZaiMaxvx` 名下多包无需任何账号级配置；若自建 market 索引，`plugins.txt` 加一行包名即可。
- **README 的 Install/Development/Verification 三段**可近乎逐字平移（dev.patch 路径、包名替换）。

---

## 8. rc.2 变化对 btw 的影响清单（综合 rc2-01/rc2-02 + 本轮补查）

| rc.2 变化 | 对 btw | 动作 |
|---|---|---|
| `ui-primitives` 移除 `useAnchoredPosition`/`AnchoredPositionOptions` | 面板不画自定义锚定浮层则无影响 | **约束**：弹层一律用 `commandUi` 内置 `popupSelect` 或新 Menu 原语 |
| `SessionSnapshot` 新增必读 `historyLoadStatus`/`historyWasPartial`（手写字面量 fixture 会编译失败） | 仅测试 stub 层面 | btw-session spec 不手写 snapshot 即无感；如写，补两字段 |
| `SlotKind` 新增 `'hoc'`、`ComposedProps` 交叉 `HocShare` | 纯加法，keyed/list 注册路径未变 | 无 |
| `commandUi.decorate`/`popupSelect`、`ctx.sessions.binding`、`ctx.locale`、`useSessionStatus` | 逐字未变（rc2-02 §4-7） | 无 |
| `sidebar-right`（本轮补查）：仅 2 个 css 文件差异 | tab 注册面/槽契约/service 无变化 | 无 |
| host：`sessionProjections.register`、`commands.register`、`agent.followup/steer/inject`、`agent/status` 事件 | 未变（session-projection 仅 stateVersion 文档措辞放宽；commands src 两版一致；agent 侧仅 cancel 文档与内部增强） | 无 |
| `Session.append` 新增数组重载 / `inspectSession` 新查询 | 向后兼容加法；btw 每次 append 单事件 | 可选：一次投递多事件时用批量重载 |
| client entries 加载容错（失败行不再拖垮 Web 启动） | 纯收益 | 无 |
| `BundleInfo.updatable→update` 等 plugin-manager 管理面变化 | 插件不消费该 API | 无 |

结论：btw 按 rc.1 API 写成后 **rc.1/rc.2 双版本免适配**（与 rewind 相同结论）；`engines.dsh: ">=0.2.2-rc.1 <0.3.0"` 原样可用。

---

## 9. host 侧投递路径速查（工程落点备查）

- `agent.followup(message)`：排队一个普通后续轮并唤醒 —— "空闲时发送"的投递动作正门。
- `agent.steer(message)`：运行中最近 step 边界消费（即时插话）；`agent.inject(message)`：下一 pre-step 上下文、不唤醒 —— 若产品语义想区分"插话/停靠"，这两条是现成分流，但均属"立即进入"，与停靠队列互补。
- `agent/status`（emit，`idle`⇄`running`）驱动 autoDeliver；`agent.whenIdle()` 用于一次性等待。**不要**在 `agent/created` serial 监听器里 await whenIdle（文档明示禁）。
- 投递消息用 `createUserMessage({ content:[{type:'text',text}], source:{ kind:'btw', … } })`，`MessageSourceMap` 合并 `btw`（对应 rewind 的 `rewind` source 做法）；停靠/删除/投递记 `btw/*` log-only 事件（SessionEventMap 合并；参照 plan-mode `'plan/mode'` 与 tool-todo `'todo/write'` 先例——`exec.agent.session.append` 是插件写日志的标准途径，btw 在命令 handler 内经 `invocation.agent.session.append`）。
- 队列状态经 `ctx.sessionProjections.register({ key:'btwQueue', stateSchema(zod), init, apply, wire:{ viewSchema, view, summary:true } })` 折叠；`wire` 使客户端 `useProjection('btwQueue')` 自动收到 `session/projection` 基线+增量推送——**这就是"客户端状态订阅"的全部机制**，面板无需自建轮询或自定义 Remote。

## 10. 关键路径索引（绝对路径）

- 复用资产：`D:/Code/Projects/dsh-utils/rewind-plugin/`（scripts、tests、双面 tsconfig、vitest.config）
- dsh rc.2 源树：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src`；rc.1：`D:/Code/Projects/dsh-utils/dsh-source/src`
- sidebar-right 文档：`…/dsh-source-rc2/src/docs/subsystems/sidebar-right.md`；tab 注册样板：`…/packages/client/ui-sidebar-terminal/src/client/index.ts`
- settings/表单：`…/docs/subsystems/settings.md`、`…/docs/cookbook/adding-a-settings-card.md`
- 图标：`…/packages/client/ui-primitives/src/icons/index.tsx`、`…/src/plugin-artwork.tsx`
- projection 样板：`…/packages/todo/tool-todo/`（todos projection + 事件 append）；命令+事件全家桶：`…/packages/plan/plan-mode/`
- 客户端测试运行时：`…/packages/test-support/client-runtime/`（SlotTestRuntime）
- git 安装子目录语义：`…/packages/boot/plugin-manager/src/install-spec.ts`（`path:` 参数须 pin 全 commit）
- 相邻调研：`research/rc2-01-host-diff.md`、`research/rc2-02-client-diff.md`、`research/02-plugin-system.md`、`research/05-ui-sdk.md`、`research/06-plugin-examples.md`

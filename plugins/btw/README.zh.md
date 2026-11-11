# dsh-plugin-btw（BTW 侧问）

为 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）`v0.2.2-rc.1+`
打造的 `/btw` 插件：**即时侧问**——基于当前会话上下文立即作答的轻量单轮调用，
不打扰主对话，问答永不进入主历史。答案展示在**右侧边栏 BTW 面板**与命令卡片中。

> 语义考证：Claude Code 的 `/btw` 不是"排队消息"，而是即时侧问（fork 父上下文、
> 禁工具、单轮作答、不进主历史）。本插件忠实复刻该语义（调研笔记见
> `docs/research/btw-01-semantics.md`）。若需要"排队到下一轮"语义，直接用 dsh
> 输入框的 queue 模式即可，无需插件。

## 工作原理

```
/btw 这个仓库用的什么测试框架？
  └─ host: 一次性 ctx.llm.stream 调用（compaction 同款前缀重放）
       messages = session.deriveMessages()   ← 完整会话上下文（命中 KV 前缀缓存）
                 + [指令 + <side_question>问题</side_question>]
       无 tools / 无 toolHistory / purpose: 'btw'
  └─ 答案 → CommandResult（通用命令卡展示）
  └─ 面板数据 = btwHistory 会话投影（fold 原生 command/run + command/done 事件对）
       ↘ 经标准投影 wire 推送 → 右栏面板 useProjection('btwHistory') 实时刷新
```

不写任何自定义会话事件类型——日志词汇表保持原生，未装插件的 dsh 也能正常读取
这些会话；投影冷读可完整重建。

## 功能

- `/btw <问题>` —— 任意界面（Web/SDK）可用；答案作为命令结果返回
- **右侧边栏 BTW 面板**：问答历史（最新在上）+ 内联输入框（Ctrl+Enter 发送，
  走与手打 `/btw` 完全相同的命令通道）
- 裸 `/btw`（无参数）—— Web 端直接打开面板
- 侧栏 "+" 指南里有插件入口卡
- 中英双语言

## 布局

```
src/index.ts            host: /btw 命令 + btwHistory 投影注册
src/sideask.ts          一次性侧问调用（目标解析/请求组装/流式装配，compaction 同款）
src/history.ts          纯折叠：command 事件对 → 面板历史（可测）
src/types.ts            btwHistory 投影 key + 'btw' LLM purpose 类型合并
src/client/index.ts     browser: 右栏 tab 注册 + 面板体 + 裸 /btw 装饰
src/client/BtwTab.tsx   面板组件（历史 + 输入）
src/client/view.ts      纯视图模型（最新在上等，可测）
tests/                  vitest（折叠/视图）+ scripts/smoke.sideask.mjs（真实 dsh 消息构造）
```

## 安装

需要 dsh ≥ 0.2.2-rc.1（Node ≥ 24.9）。已在 v0.2.2-rc.1 与 v0.2.2-rc.2 上验证。

```sh
dsh plugin --profile <name> add github:ZaiMaxvx/dsh-btw
# 或 npm/tarball: dsh plugin --profile <name> add dsh-plugin-btw
```

## 开发

```sh
# 快速试用（host 半 TS 直跑）
pnpm dsh web --patch /abs/path/to/btw-plugin/dev.patch.yml

# 验证（免装 dsh 工作区）
npm test       # sideask 冒烟（tsx + source-plane 钩子）+ fold/view vitest
npm run check  # 双编译面 tsc --noEmit（对照 dsh 源码，src 0 错误）
```

## 配置

```yaml
- id: btw
  name: dsh-plugin-btw
  config:
    instruction: '回答用户的侧问…'   # 框定侧问行为的指令（有默认值）
    maxTokens: 1024                  # 单次侧答的输出 token 上限
    maxEntries: 50                   # 面板历史上限（最老的先掉）
    provider: ''                     # 可选：覆盖侧问路由（空 = 跟随会话）
    model: ''
```

## 设计说明

- **为什么不进主历史**：侧问的价值在于"问而不扰"——模型主任务与侧答互不污染；
  dsh 的 append-only 日志里只有命令生命周期事件（原生 `command/run`/`done`）
- **前缀缓存**：重放 `deriveMessages()`（含 loop 系统提示）作为前缀，与主对话
  请求共享 provider 的 KV 缓存，侧问便宜且快
- **投影而非自定义事件**：面板数据由 host 投影折叠原生命令事件生成，冷读可
  重建、跨端一致，且不引入 fail-closed 的未知事件类型

许可：MIT。

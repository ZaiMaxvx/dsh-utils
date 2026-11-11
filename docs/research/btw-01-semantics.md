# /btw 语义考证（子课题 1：功能语义）

> 调研日期：2026-11-11。目标：为 dsh（deepseek-harness）的 /btw 插件提供精确的行为规格依据。
> 结论先行：**Claude Code 的 `/btw` 不是"排队待后续消费"的消息，而是"立即并行回答、永不进入主对话"的侧问（side question）**。任务前提中"排队待后续消费"描述的其实是 Claude Code 的**普通输入排队（queued message）**机制，那是另一个功能。详见 §2 与 §5。

---

## 1. 核心结论（一句话规格）

`/btw [question]`：向当前会话提一个"顺便问一下"的小问题。**立即**由一个轻量级的"侧问 agent"（父会话上下文的 fork）在**浮层 overlay** 中作答；**问答双方都不写入主对话历史**；不打断正在运行的主任务；侧问 agent **没有任何工具权限**，只能凭主会话中已有的上下文回答，**单轮一次性应答**（无追问轮次）。

官方文档原文（[commands](https://code.claude.com/docs/en/commands)）：

> "/btw [question] — Ask a side question about the current session without adding to the conversation."
> "If you run `/btw` without a question, Claude Code shows your most recent side question so you can browse earlier answers"（从未问过则打印一行 usage）。

官方文档原文（[interactive-mode](https://code.claude.com/docs/en/interactive-mode)，"Side questions with /btw" 一节）：

> "The question and answer never enter the conversation history."（问答永不进入对话历史）
> "you can run `/btw` even while Claude is processing a response"（Claude 正在生成时也能用，侧问独立运行，不打断主轮次；但"it can't see the reply Claude is currently writing"——**看不到正在流式生成中的那条回复**）
> "side questions answer only from what is already in context."（只凭上下文中已有的内容回答）
> "No tool access"——不能读文件、跑命令；若模型以文本形式写了工具调用，"the answer ends with a note that nothing was executed"（答案末尾附注"未执行任何东西"）。
> 成本："Cost is low while the prompt cache is warm"（命中父会话 prompt cache 时近乎免费）。

## 2. /btw vs 普通排队消息 vs Esc 打断 —— 三者严格区分

这是本课题最容易混淆的点。Claude Code 在 agent 运行中收到用户输入时有**三条通道**：

| 维度 | 普通输入（排队 queued message） | Esc（打断 interrupt） | `/btw`（侧问） |
|---|---|---|---|
| 何时生效 | 不打断；"if you queue a message while Claude is running tool calls, Claude Code passes it to Claude **as soon as those tool calls finish**"（工具调用批次结束后即注入当前轮）；剩余消息在 turn 结束后自动发出；命令/`!` shell 命令则"held until the turn ends, then runs them one at a time" | 立即中止当前响应/工具调用，保留已做的工作 | **立即**并行执行，主任务完全不受影响 |
| 是否进入主对话 | **进入**（成为主对话的一部分） | 不产生消息 | **永不进入** |
| 上下文可见性 | 成为后续上下文 | — | 能看到主会话全部既有上下文（不含正在生成中的回复） |
| 工具权限 | 正常 | — | **无**（单轮、禁工具） |
| 撤销 | "Press `Up` from the first line of the input box to take back the queued messages and commands"（可逐条取回、编辑、重排）；`Ctrl+Enter`（2.1.275+）可立即冲队 | 不可（但可 Esc-Esc 进 rewind 菜单） | 不可"撤回"（即刻消费）；只能 `x` 清空侧问历史、`Space`/`Enter`/`Esc` 关浮层 |
| UI 呈现 | "Sent and queued messages show in gray until Claude starts responding to them"（灰显直到 Claude 开始响应） | 中断标记 | 可关闭的浮层 overlay；最新 20 条侧问历史可回看 |

来源：[interactive-mode docs](https://code.claude.com/docs/en/interactive-mode)、[commands docs](https://code.claude.com/docs/en/commands)、[tim-schipper.nl 实测指南](https://tim-schipper.nl/en/blog/claude-code-interrupt-and-steer)（40 次实测：Esc 路线 $0.33、排队 $0.40 (+15%)、事后才说 $0.55 (+56%)）。

**关键结论：若 dsh 想要"排队待后续消费"，那对应的是 dsh 已有的 `followup()` / `steer()` 语义（见 §6），做进 /btw 反而与 Claude Code 语义相反。**

## 3. 时间线

- **v2.0.73（2025-12 中旬）**：实验性埋入。GitHub [issue #14804](https://github.com/anthropics/claude-code/issues/14804)（2025-12-20 开）：提示条"Start with 'btw' to ask a quick side question without interrupting Claude's current work"，但当时以 `btw` 开头的行为与普通消息无异（照常排队）；用户 grep 出 `btw-side-question` 字符串与正则 `^btw\b`。注意：**最初是前缀词 `btw`，不是斜杠命令**。
- **2026-01-06**：Anthropic 协作者 bcherny 回复"A thing that we're experimenting with, more to come"，并从提示条中撤下。
- **~2026-03（v2.1.7x–8x）**：以 `/btw` 斜杠命令形态 GA。[Last Week in Claude Code #3（2026-03-17）](https://newsletter.claudecodemasterclass.com/p/last-week-in-claude-code-3-btw-voice) 作为新功能封面报道；v2.1.79 修复"streaming 中触发 /btw 返回主 agent 输出"（[AI Drops 2.1.79](https://getaidrops.com/claude/changelog/2.1.79)）；v2.1.80 把历史浏览键从 ←/→ 改为 Shift+←/→（或 `[`/`]`）。
- **2026 后续迭代**（官方 [changelog](https://code.claude.com/docs/en/changelog)）：~2.1.229/246 可调大小的 /btw 面板、system-reminder 支持；**2.1.280/285"/btw while a tool is running now sees the turn in progress"**（工具运行中发起的侧问能看到进行中的轮次——对早期"看不到正在生成回复"的放宽）；2.1.314 修复"从子代理 transcript 发起的 /btw 错答主会话"、"Esc 关 /btw 面板误打断子代理"；2.1.316/319 VS Code 侧问历史相关修复。
- 2026-06-13 issue #14804 被官方关闭（功能已发布并有文档）。

## 4. 实现细节（来自逆向工程，[ossama.is/writing/btw](https://ossama.is/writing/btw)）

作者解包 `@anthropic-ai/claude-code` npm 包（压缩后 12MB cli.js）分析：

- 注册为 **local-jsx 命令**：name `/btw`、description "Ask a quick side question without interrupting the main conversation"、feature-flag 检查、**`immediate: true`**、参数提示 `<question>`。`immediate: true` 意味着**立即执行**（同 `/status`、`/tasks` 一类），而不是像普通消息那样排队。这与 §2 的排队规则吻合：docs 的排队规则表中 /btw 不在"立即执行"白名单里被列出，但逆向表明它注册为 immediate（文档表格未更新，以逆向 + 实际行为为准）。
- handler 校验输入后渲染 React overlay；query builder 组装 prompt；**轻量 fork helper** 流式返回：调用核心 API loop，参数 **`maxTurns: 1`、工具访问拒绝、`skipCacheWrite: true`**（读父会话缓存但不写缓存）。
- 注入的 system prompt 告诉被派生的 agent：它是"separate, lightweight agent"，**共享会话上下文但"NO tools available"**，一次性应答、没有后续轮次，**绝不能说 "Let me try..." 或承诺任何动作**。
- 与 forked skills 不同（后者把结果以 `<local-command-stdout>` 回传父对话），**/btw 的结果不回传任何东西到主 transcript**。

## 5. 社区观察与限制

- [r/ClaudeCode 讨论帖](https://www.reddit.com/r/ClaudeCode/comments/1rqlry4/have_you_tried_the_new_btw_command/)：主要抱怨是 **单轮限制**——"the SINGLE response is quite limiting, it does not really allow conducting a side conversation"（不能就侧问继续追问）。
- [Vincent Qiao 博客（2026-03-25）](https://blog.vincentqiao.com/en/posts/claude-code-btw)：规则经验——"does Claude Code need to act on this answer later?" 不需要 → /btw；需要 → 主对话。金句："/btw asks about the known; subagents find the unknown."（/btw 有全上下文无工具，subagent 无上下文有工具，正好互补）。成本：复用父会话 prompt cache，"essentially 'free'"。
- [MindStudio 博客](https://www.mindstudio.ai/blog/claude-code-btw-command-save-tokens)宣称省 token 高达 ~50%（营销口径，方向正确、数字存疑）。
- GitHub [issue #44876](https://github.com/anthropics/claude-code/issues/44876)：侧问 agent 有时会反问澄清问题，但用户无法追问（单轮）——已知体验缺陷。
- overlay 键位（官方 interactive-mode docs）：`Shift+←`/`Shift+→`（或 `[`/`]`）在历史答案间切换；`Tab`/`Shift+Tab` 循环；`x` 清空更早的侧问记录；`c` 复制答案为原始 Markdown；`Space`/`Enter`/`Esc` 关闭；**`f` 把该问答 fork 成一个有完整工具权限的后台 subagent**。再次发起侧问时回放"newest 20 exchanges"，浮层顶部暗色列出"Your five newest earlier side questions"。`/btw` 无参数 = 重新打开最近一次侧问浮层。

## 6. dsh 现有排队语义（本地源码，v0.2.2-rc.2）

来源：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src/packages/core/agent/src/runtime-types.ts`（Agent 接口）与 `docs/agent-lifecycle.md`。

四个入口（runtime-types.ts L234–271）：

- **`send(message, target: InboxTarget, wakeup)`** — 把输入路由到某个 inbox 边界，可选唤醒 driver。
- **`followup(message)`** — "Queue an ordinary follow-up turn and wake the driver. The item becomes **the sole ordinary message of its own turn**."（排队一个普通后续轮次；独占一个新 turn）
- **`steer(message)`** — "Submit steering for the nearest **step**. An idle driver starts a turn; a running driver consumes it at its **next step boundary**."（空闲则开新 turn；运行中在下一个 step 边界被消费；被拒的 step 会把 steering 留在 inbox 直到下次唤醒）
- **`inject(message)`** — "Queue model-facing context for the next pre-step **without waking the driver**."（对模型可见的注入上下文，不唤醒；空闲时挂起直到 followup/steer 唤醒）

生命周期（agent-lifecycle.md）：driver 每 turn"claim pending next-step input plus one queued prompt"，逐条发 `agent/inbox/claimed`，经 `agent/pre-step` waterfall 权威决定 enter/reject；"Steering and injected context pass through the same waterfall"；自然停止且 next-step inbox 为空时走 `agent/turn-stopping` 检查点。

映射关系（Claude Code → dsh）：

| Claude Code 机制 | dsh 对应 |
|---|---|
| 运行中键入的 queued message（工具批次后即注入，同一 turn 内） | `steer()`（next step boundary 消费） |
| turn 结束后才发出的排队消息/命令 | `followup()`（独占新 turn） |
| hook/system-reminder 注入 | `inject()` |
| **`/btw` 侧问** | **四者皆非**：不应进 agent inbox，应走 human command + 独立一次性 LLM 调用 |

glossary 相关条目（docs/glossary.md）：**human command** — "a slash-prefixed instruction interpreted and executed by a human-facing adapter through `ctx.commands`, **without becoming a model message**"; **command plane** — "Command output is **UI state** unless the handler separately mutates a durable domain." —— 这两条正是 /btw 的天然落点：UI 态、不动 durable 域、不成为模型消息。

## 7. 其他 agent 产品对照（"运行中追加输入"机制）

- **OpenAI Codex CLI**：默认把运行中输入排为 queued follow-up（下一 turn 消费）；**steer mode** 开启后"injected at the next thinking step"（下一个思考步注入）；斜杠命令可在运行中键入并按 **Tab 排队**到下一 turn（[slash commands docs](https://learn.chatgpt.com/docs/cli/slash-commands)）；2026-10 起支持对队列消息 edit/reorder/send/delete（[zeniteq 报道](https://www.zeniteq.com/openai-speeds-up-codex-steering-for-active-tasks-8qi91c)）；社区提案 [issue #23615](https://github.com/openai/codex/issues/23615) 要求"stash"（**不**自动提交的暂存消息）——说明"排队 vs 暂存 vs 即时侧问"是普遍三分需求。
- **Gemini CLI**：[model steering（实验，默认关）](https://geminicli.com/docs/cli/model-steering)：spinner 期间键入 → 小模型即时生成一句确认 ack → 提示词**在下一个 turn 开头注入**并要求"re-evaluate the active plan, apply minimal-diff changes"。默认（无 steering）：排队消息在 turn 开始时才被读取（[issue #17282](https://github.com/google-gemini/gemini-cli/issues/17282) 为交错 bug；[issue #17197](https://github.com/google-gemini/gemini-cli/issues/17197) 提案 `/inject` 做真正的流中注入）；已有排队消息编辑功能。
- **Cursor**：Settings > Agents > Conversation > New Messages → **Queue**：运行中键入即排队、当前任务结束后顺序执行（[论坛帖](https://forum.cursor.com/t/add-message-to-queue-to-enforce-sequential-work-of-agent/171581)）；有卡队列/提前发出的可靠性抱怨。
- **GitHub Copilot（VS Code）**：传统上 agent 运行中输入框被阻塞；队列/steer 仍是 [feature request](https://github.com/microsoft/copilot-inCTION-feedback/issues/2020)（编号以搜索结果为准），Insiders 在实验"运行中可打字、结束后作为下一 turn 发送"。**没有发现任何产品有与 /btw 等价的"零污染即时侧问"**——这是 Claude Code 的差异化设计，也是本插件的价值点。

## 8. 语义规格建议（dsh /btw 插件）

依据 §1–§6，规格如下（编号便于引用）：

1. **命令形态**：human command（`ctx.commands` 注册 `/btw`），带一个可选文本参数。**立即执行**（等价 Claude Code `immediate: true`），绝不路由到 `followup`/`steer`/`inject`，不触碰 agent inbox，不唤醒 driver。
2. **(a) agent 运行中**：立即发起侧问，主任务零感知、零打断。上下文快照 = **已提交（settled）的 session 事件**派生出的对话历史；不含正在流式生成、尚未 `assistant/message` 落盘的回复（对齐 Claude Code 初版语义；2.1.280+ 的"看到进行中轮次"是后续增强，MVP 不做）。
3. **(b) agent 空闲时**：行为完全相同——同样在浮层/命令输出区回答，同样不进主对话。空闲时用户可能更愿意直接问主对话，但命令不做特殊分叉（Claude Code 也不分叉）。
4. **执行模型**：独立的一次性 LLM 调用（`ctx.llm` prepareCall/stream，携带 AbortSignal）：请求 = [侧问 system prompt] + [主会话历史快照] + [用户问题]。**单请求、无工具循环**（等价 maxTurns:1、禁工具）。侧问 system prompt 要点：你是独立轻量 agent；共享上述上下文但只依据其中已有信息回答；无任何工具；一次性回答；禁止"让我去看看/我来试试"类承诺；若想调用工具，改说"我无法执行，但根据上下文……"。
5. **缓存**：请求前缀与主会话保持一致以命中父会话 prompt cache（便宜），且**不写缓存、不写任何 session 事件**（等价 skipCacheWrite + "never enter the conversation history"）。
6. **transcript 标记**：**主 session log 零标记**（dsh 术语：command output 是 UI state，handler 不 mutate durable domain——这正是 glossary 的默认约定，遵守即可）。侧问历史存在**插件本地状态**：保留最近 20 次交互（对齐 Claude Code "newest 20 exchanges"），随会话恢复可重放浮层。
7. **无参数 `/btw`**：重新打开最近一次侧问交互；从未用过则打印一行 usage。
8. **撤销语义**：侧问即刻消费，**不提供撤回**（区别于普通排队消息的 Up 取回）；提供 `x` 清空插件本地侧问历史、Esc/关闭浮层（并 abort 进行中的侧问调用）。
9. **若模型输出工具调用文本**：不执行，在答案末尾追加"未执行任何工具"的注记（官方行为）。
10. **可选进阶**（对齐 `f` 键 fork）：提供"升级为后台子代理"动作——以 [侧问 Q&A + 完整工具权限] 派生一个后台 subagent 继续深挖；结果仍按 dsh 子代理完成通知机制回到主会话（此时才产生 durable 事件，但属于子代理域而非主对话污染）。
11. **命名澄清（给主 agent 的建议）**：若 dsh 需求方真正想要的是"排队待后续消费"，应直接用现有 `followup()`（整轮排队）或 `steer()`（step 边界注入）做 `/queue` 类命令，**不要叫 /btw**——/btw 的品牌语义已被 Claude Code 锚定为"不进主对话的即时侧问"。

## 9. 来源清单

- 官方：[Commands](https://code.claude.com/docs/en/commands) · [Interactive mode（含 "Side questions with /btw" 全节）](https://code.claude.com/docs/en/interactive-mode) · [Changelog](https://code.claude.com/docs/en/changelog)
- 逆向：[Figuring out Claude Code's new /btw command — ossama.is](https://ossama.is/writing/btw)
- 博客：[Claude Code /btw — Vincent Qiao](https://blog.vincentqiao.com/en/posts/claude-code-btw) · [MindStudio](https://www.mindstudio.ai/blog/claude-code-btw-command-save-tokens) · [Steering 实测 — tim-schipper.nl](https://tim-schipper.nl/en/blog/claude-code-interrupt-and-steer) · [AI Drops v2.1.79](https://getaidrops.com/claude/changelog/2.1.79)
- 社区：[GitHub issue #14804（引入时间线）](https://github.com/anthropics/claude-code/issues/14804) · [r/ClaudeCode 1rqlry4](https://www.reddit.com/r/ClaudeCode/comments/1rqlry4/have_you_tried_the_new_btw_command/) · [r/ClaudeAI 1rqgtlc](https://www.reddit.com/r/ClaudeAI/comments/1rqgtlc/btw_im_ultrathinking_to_simplify_the_loop_of) · [issue #44876](https://github.com/anthropics/claude-code/issues/44876) · [issue #18399（排队命令变原文的 bug）](https://github.com/anthropics/claude-code/issues/18399) · [Last Week in Claude Code #3](https://newsletter.claudecodemasterclass.com/p/last-week-in-claude-code-3-btw-voice)
- 其他产品：[Codex slash commands](https://learn.chatgpt.com/docs/cli/slash-commands) · [Codex steer/queue/fork](https://blog.devgenius.io/codex-clis-busy-week-steer-mode-fork-and-7-releases-in-3-days-ece5c742923e) · [codex#23615](https://github.com/openai/codex/issues/23615) · [Gemini model steering](https://geminicli.com/docs/cli/model-steering) · [gemini-cli#17282](https://github.com/google-gemini/gemini-cli/issues/17282) · [gemini-cli#17197](https://github.com/google-gemini/gemini-cli/issues/17197) · [Cursor 论坛 queue 设置](https://forum.cursor.com/t/add-message-to-queue-to-enforce-sequential-work-of-agent/171581) · [Copilot 队列 feature request](https://github.com/microsoft/copilot-intellij-feedback/issues/2020)
- 本地：`D:/Code/Projects/dsh-utils/dsh-source-rc2/src/packages/core/agent/src/runtime-types.ts`（followup/steer/inject/send 接口）· `D:/Code/Projects/dsh-utils/dsh-source-rc2/src/docs/agent-lifecycle.md`（claim/waterfall 时序）· `D:/Code/Projects/dsh-utils/dsh-source-rc2/src/docs/glossary.md`（human command / command plane 条目）

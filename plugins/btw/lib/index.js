// plugins/btw/src/index.ts
import z from "@deepseek-ai/schemastery";
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands/brand";
import { z as zod } from "zod";

// plugins/btw/src/sideask.ts
import { BlockAssembler, LlmError, createUserMessage } from "@deepseek-ai/dsh-llm";
var DEFAULT_INSTRUCTION = "Answer the user's side question briefly and directly, using only the conversation context above. This is a side channel: the answer never enters the main conversation, so do not propose actions or continue the main task.";
function resolveTarget(agent, override) {
  if (override !== void 0 && override.provider.length > 0 && override.model.length > 0) {
    return override;
  }
  const latest = agent.session.requestHeader()?.config;
  if (latest !== void 0 && latest.provider.length > 0 && latest.model.length > 0) {
    return { provider: latest.provider, model: latest.model };
  }
  const provider = agent.options.provider ?? "";
  const model = agent.options.model ?? "";
  if (provider.length > 0 && model.length > 0) {
    return { provider, model };
  }
  return void 0;
}
function buildBtwMessages(history, question, instruction) {
  return [
    ...history,
    createUserMessage({
      content: [{ type: "text", text: `${instruction}

<side_question>
${question}
</side_question>` }],
      source: { kind: "user" }
    })
  ];
}
function finishError(finish) {
  switch (finish.kind) {
    case "error":
    case "aborted":
      return LlmError.fromFailure(finish.failure);
    case "max-tokens":
      return new Error("the side answer was truncated at the token cap");
    default:
      return void 0;
  }
}
async function askSideQuestion(ctx, agent, question, options, signal) {
  const target = resolveTarget(agent, options.target);
  if (target === void 0) {
    throw new Error("no provider/model available for a side question: route one request first, or set the btw plugin provider/model config");
  }
  const messages = buildBtwMessages(agent.session.deriveMessages(), question, options.instruction);
  const assembler = new BlockAssembler();
  for await (const chunk of ctx.llm.stream({
    provider: target.provider,
    model: target.model,
    messages,
    maxTokens: options.maxTokens,
    sessionId: agent.session.id,
    purpose: "btw",
    ...signal === void 0 ? {} : { signal }
  })) {
    assembler.push(chunk);
  }
  const error = finishError(assembler.finish);
  if (error !== void 0) throw error;
  const text = assembler.blocks().flatMap((block) => block.type === "text" ? [block.text] : []).join("");
  if (text.trim().length === 0) throw new Error("the side answer produced no text content");
  return { text, provider: target.provider, model: target.model };
}

// plugins/btw/src/history.ts
function btwRun(event) {
  if (event.type !== "command/run") return void 0;
  if (event.data.name !== "btw") return void 0;
  return {
    commandId: event.data.commandId,
    question: event.data.args?.trim() ?? "",
    time: event.time
  };
}
function foldBtwHistory(state, event, maxEntries) {
  const run = btwRun(event);
  if (run !== void 0) {
    if (run.question.length === 0) return state;
    const entry = { id: run.commandId, question: run.question, answer: "", status: "pending", time: run.time };
    return capEntries([...state, entry], maxEntries);
  }
  if (event.type === "command/done") {
    const index = state.findIndex((entry) => entry.id === event.data.commandId);
    if (index === -1) return state;
    const current = state[index];
    if (current === void 0 || current.status !== "pending") return state;
    const settled = {
      id: current.id,
      question: current.question,
      answer: event.data.kind === "success" ? event.data.text ?? "" : "",
      status: event.data.kind === "success" ? "done" : "error",
      time: current.time
    };
    const next = [...state];
    next[index] = settled;
    return next;
  }
  return state;
}
function capEntries(entries, maxEntries) {
  return maxEntries <= 0 ? [] : entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries;
}

// plugins/btw/src/index.ts
var name = "btw";
var inject = ["commands", "sessionProjections", "llm"];
var Config = z.object({
  instruction: z.string().default(DEFAULT_INSTRUCTION),
  maxTokens: z.number().step(1).min(1).default(1024),
  maxEntries: z.number().step(1).min(1).default(50),
  provider: z.string().default(""),
  model: z.string().default("")
});
var USAGE = "Usage: /btw <question> \u2014 ask a side question answered from the current context without touching the main conversation.";
var btwHistorySchema = zod.array(zod.object({
  id: zod.string(),
  question: zod.string(),
  answer: zod.string(),
  status: zod.enum(["pending", "done", "error"]),
  time: zod.number()
}));
async function executeBtw(ctx, config, invocation) {
  const question = invocation.rawInput.trim();
  if (question.length === 0) return { kind: "error", text: USAGE };
  try {
    const result = await askSideQuestion(ctx, invocation.agent, question, {
      instruction: config.instruction,
      maxTokens: config.maxTokens,
      ...config.provider.length > 0 && config.model.length > 0 ? { target: { provider: config.provider, model: config.model } } : {}
    }, invocation.signal);
    return { kind: "success", text: result.text };
  } catch (error) {
    if (invocation.signal.aborted) return { kind: "error", text: "Side question cancelled." };
    const detail = error instanceof Error ? error.message : String(error);
    return { kind: "error", text: `Side question failed: ${detail}` };
  }
}
async function apply(ctx, config) {
  await ctx.sessionProjections.register({
    key: "btwHistory",
    stateVersion: 1,
    stateSchema: btwHistorySchema,
    init: () => [],
    apply: (state, event) => foldBtwHistory(state, event, config.maxEntries),
    wire: {
      viewSchema: btwHistorySchema,
      view: (state) => state
    }
  });
  const active = /* @__PURE__ */ new Set();
  const handler = (invocation) => {
    const operation = executeBtw(ctx, config, invocation);
    active.add(operation);
    const retire = () => {
      active.delete(operation);
    };
    void operation.then(retire, retire);
    return operation;
  };
  ctx.effect(function* () {
    yield async () => {
      await Promise.allSettled(active);
    };
    yield ctx.commands.register({
      definitionId: CommandDefinitionId("dsh-plugin-btw"),
      name: "btw",
      description: "Ask a side question answered from the current context, without touching the main conversation",
      input: { hint: "side question" },
      handler
    });
  }, "btw: /btw command");
}
export {
  Config,
  apply,
  inject,
  name
};
//# sourceMappingURL=index.js.map

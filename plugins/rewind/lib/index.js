// plugins/rewind/src/index.ts
import z from "@deepseek-ai/schemastery";
import { CommandDefinitionId } from "@deepseek-ai/dsh-commands/brand";

// plugins/rewind/src/rewind.ts
import { createUserMessage } from "@deepseek-ai/dsh-llm";

// plugins/rewind/src/planner.ts
function planRewind(nodes, keepThroughSeq) {
  let cutIndex = nodes.findIndex((seq) => seq > keepThroughSeq);
  if (cutIndex === -1) return null;
  if (cutIndex === 0) cutIndex = 1;
  if (cutIndex >= nodes.length) return null;
  return { cutIndex, maskedSeqs: nodes.slice(cutIndex) };
}

// plugins/rewind/src/rewind.ts
function renderMarker(template, maskedCount) {
  return template.replaceAll("{count}", String(maskedCount));
}
function applyRewind(session, keepThroughSeq, markerTemplate) {
  const plan = planRewind(session.surface.nodes, keepThroughSeq);
  if (plan === null) return null;
  const { maskedSeqs } = plan;
  if (maskedSeqs.length === 0) return null;
  const first = maskedSeqs[0];
  const last = maskedSeqs[maskedSeqs.length - 1];
  const marker = createUserMessage({
    content: [{ type: "text", text: renderMarker(markerTemplate, maskedSeqs.length) }],
    source: { kind: "rewind", maskedCount: maskedSeqs.length, keepThroughSeq }
  });
  const sourceSeqs = maskedSeqs.map((seq) => seq);
  const event = session.append("user/message", marker, {
    surfaceOp: { op: "replace", startSeq: first, endSeq: last },
    sourceEventSeqs: sourceSeqs
  });
  return { maskedSeqs: sourceSeqs, markerSeq: event.seq };
}

// plugins/rewind/src/index.ts
var name = "rewind";
var inject = ["commands", "sessionQuery"];
var DEFAULT_MARKER_TEXT = "[The user rewound this conversation. {count} later item(s) were removed from the model context; continue from the state above.]";
var Config = z.object({
  markerText: z.string().default(DEFAULT_MARKER_TEXT),
  maxUndoTurns: z.number().step(1).min(1).default(20)
});
var USAGE = "Usage: /rewind [<n> | turn <k> | to <seq>] \u2014 <n>: undo the last n turns; turn <k>: undo from the k-th turn on; to <seq>: keep context through event seq.";
function parseRewindInput(raw) {
  const text = raw.trim();
  if (text === "") return { kind: "hint" };
  const turns = /^(\d+)$/.exec(text);
  if (turns !== null) {
    const n = Number(turns[1]);
    return n < 1 ? { kind: "error", text: USAGE } : { kind: "undoTurns", turns: n };
  }
  const keep = /^to\s+(-?\d+)$/.exec(text);
  if (keep !== null) {
    const seq = Number(keep[1]);
    return seq < -1 ? { kind: "error", text: "seq must be >= -1." } : { kind: "keepThrough", seq };
  }
  const from = /^turn\s+(\d+)$/.exec(text);
  if (from !== null) {
    const k = Number(from[1]);
    return k < 1 ? { kind: "error", text: "turn number must be >= 1." } : { kind: "undoFromTurn", turn: k };
  }
  return { kind: "error", text: USAGE };
}
function boundaryForTurns(records, request) {
  const target = request.kind === "undoTurns" ? request.turns > records.length ? void 0 : records[records.length - request.turns] : records[request.turn - 1];
  if (target === void 0) {
    const detail = request.kind === "undoTurns" ? `This session has only ${records.length} turn(s) to undo.` : `Turn ${request.turn} does not exist (this session has ${records.length}).`;
    return { kind: "error", text: detail };
  }
  return { kind: "ok", seq: target.seq - 1 };
}
async function executeRewind(ctx, config, invocation) {
  const parsed = parseRewindInput(invocation.rawInput);
  if (parsed.kind === "error") return { kind: "error", text: parsed.text };
  if (parsed.kind === "hint") return { kind: "success", text: USAGE };
  const agent = invocation.agent;
  let keepThroughSeq;
  if (parsed.kind === "keepThrough") {
    keepThroughSeq = parsed.seq;
  } else {
    if (parsed.kind === "undoTurns" && parsed.turns > config.maxUndoTurns) {
      return { kind: "error", text: `At most ${config.maxUndoTurns} turns may be rewound at once (maxUndoTurns).` };
    }
    let records;
    try {
      records = await ctx.sessionQuery.filterEvents(
        agent.session.id,
        [{ kind: "type", values: ["turn/start"] }]
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      return { kind: "error", text: `Rewind could not read the session log: ${detail}` };
    }
    if (records.length === 0) return { kind: "success", text: "No turns to rewind yet." };
    const boundary = boundaryForTurns(records, parsed);
    if (boundary.kind === "error") return { kind: "error", text: boundary.text };
    keepThroughSeq = boundary.seq;
  }
  try {
    const outcome = await agent.runMaintenance(async (agentSignal) => {
      const signal = AbortSignal.any([agentSignal, invocation.signal]);
      signal.throwIfAborted();
      return applyRewind(agent.session, keepThroughSeq, config.markerText);
    });
    if (outcome === null) {
      return { kind: "success", text: "Nothing to rewind \u2014 the context already ends at that point." };
    }
    return {
      kind: "success",
      text: `Rewound: ${outcome.maskedSeqs.length} item(s) left the model context (the transcript keeps them).`,
      sourceEventSeq: outcome.markerSeq
    };
  } catch (error) {
    if (invocation.signal.aborted) return { kind: "error", text: "Rewind cancelled." };
    if (error instanceof Error && error.message.includes("already has active work")) {
      return { kind: "error", text: "Rewind needs an idle agent; stop the current run and retry." };
    }
    throw error;
  }
}
function apply(ctx, config) {
  const active = /* @__PURE__ */ new Set();
  const handler = (invocation) => {
    const operation = executeRewind(ctx, config, invocation);
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
      definitionId: CommandDefinitionId("dsh-plugin-rewind"),
      name: "rewind",
      description: "Rewind the conversation context to an earlier point",
      input: { hint: 'turns to undo, "turn <k>", or "to <seq>"' },
      handler
    });
  }, "rewind: /rewind command");
}
export {
  Config,
  DEFAULT_MARKER_TEXT,
  apply,
  inject,
  name,
  parseRewindInput
};
//# sourceMappingURL=index.js.map

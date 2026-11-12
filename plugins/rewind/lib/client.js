window.__ModuleLoader__.load({ id: "@zaimaxvx/dsh-plugin-rewind", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/rewind/src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// plugins/rewind/src/client/RewindAssistantAction.tsx
var import_react = require("react");
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// dsh-css:D:\Code\Projects\dsh-utils\repo-utils\plugins\rewind\src\client\RewindAssistantAction.module.css
var css = ".NYX84q_action{width:calc(28px + var(--dsh-content-font-delta,0px));height:calc(28px + var(--dsh-content-font-delta,0px));border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-tertiary,inherit);cursor:pointer;background:0 0;border:none;justify-content:center;align-items:center;padding:6px;display:inline-flex}.NYX84q_action svg{width:calc(15px + var(--dsh-content-font-delta,0px));height:calc(15px + var(--dsh-content-font-delta,0px))}@media (hover:hover){.NYX84q_action:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#7f7f7f1f);color:var(--dsw-alias-label-secondary,inherit)}}.NYX84q_action:focus-visible:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,#7f7f7f1f);color:var(--dsw-alias-label-secondary,inherit)}.NYX84q_action:disabled{cursor:default;opacity:.4}";
var tagId = "@zaimaxvx/dsh-plugin-rewind/RewindAssistantAction.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@zaimaxvx/dsh-plugin-rewind";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var RewindAssistantAction_default = { "action": "NYX84q_action" };

// plugins/rewind/src/client/RewindAssistantAction.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function RewindAssistantAction({
  messageId,
  submit,
  t,
  useChat,
  useSessionStatus,
  sessionId
}) {
  const seq = useChat((snapshot) => {
    for (const node of snapshot.nodes.values()) {
      if (node.kind !== "turn-tail") continue;
      const closing = node.data.closing;
      if (closing?.finalNode?.messageId === messageId) return closing.finalNode.seq;
    }
    return void 0;
  });
  const working = useSessionStatus((snapshot) => snapshot.get(sessionId)?.running) === true;
  const onRewind = (0, import_react.useCallback)(() => {
    if (seq === void 0 || working) return;
    submit(`/rewind to ${seq}`);
  }, [seq, submit, working]);
  if (seq === void 0) return null;
  const label = working ? t("action.busy") : t("action.rewindHere");
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.Tooltip, { label, side: "bottom", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
    "button",
    {
      type: "button",
      className: RewindAssistantAction_default.action,
      "aria-label": t("action.rewindHere"),
      disabled: working,
      onClick: onRewind,
      children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_dsh_client_ui_primitives.IconClockOutlineRegular, {})
    }
  ) });
}

// dsh-css:D:\Code\Projects\dsh-utils\repo-utils\plugins\rewind\src\client\RewindMarkerNode.module.css
var css2 = ".MoUBoa_marker{border-left:3px solid var(--dsw-alias-accent,#4f7cff);border-radius:var(--dsw-radius-sm,6px);background:color-mix(in srgb, var(--dsw-alias-accent,#4f7cff) 10%, transparent);align-items:center;gap:.5rem;margin:.375rem 0;padding:.4rem .625rem;display:flex}.MoUBoa_glyph{opacity:.8;font-size:.875rem;line-height:1}.MoUBoa_body{flex-wrap:wrap;align-items:baseline;gap:.375rem;min-width:0;display:flex}.MoUBoa_title{font-size:.8125rem;font-weight:600}.MoUBoa_detail{opacity:.75;font-size:.75rem}";
var tagId2 = "@zaimaxvx/dsh-plugin-rewind/RewindMarkerNode.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId2) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@zaimaxvx/dsh-plugin-rewind";
  tag.dataset.pluginCss = tagId2;
  tag.textContent = css2;
  document.head.appendChild(tag);
}
var RewindMarkerNode_default = { "body": "MoUBoa_body", "detail": "MoUBoa_detail", "glyph": "MoUBoa_glyph", "marker": "MoUBoa_marker", "title": "MoUBoa_title" };

// plugins/rewind/src/client/RewindMarkerNode.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function RewindMarkerNode({ node, t }) {
  const { maskedCount, keepThroughSeq, seq } = node.data;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: RewindMarkerNode_default.marker, "data-rewind-seq": seq, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: RewindMarkerNode_default.glyph, "aria-hidden": true, children: "\u23F1" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: RewindMarkerNode_default.body, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: RewindMarkerNode_default.title, children: t("marker.title") }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: RewindMarkerNode_default.detail, children: t("marker.detail", { count: maskedCount, keep: keepThroughSeq }) })
    ] })
  ] });
}

// plugins/rewind/src/client/rewindMarkerDefinition.ts
function rewindSourceOf(event) {
  if (event.type !== "user/message") return void 0;
  const source = event.data.source;
  if (typeof source !== "object" || source === null) return void 0;
  const kind = source.kind;
  if (kind !== "rewind") return void 0;
  const { maskedCount, keepThroughSeq } = source;
  if (typeof maskedCount !== "number" || typeof keepThroughSeq !== "number") return void 0;
  return { maskedCount, keepThroughSeq };
}
var rewindMarkerDefinition = {
  kind: "rewind-marker",
  target: "chat",
  exclusive: true,
  match: (event) => rewindSourceOf(event) !== void 0 ? { id: String(event.seq), role: "start" } : null,
  start: (_context, match) => {
    const event = match.event;
    const source = rewindSourceOf(event);
    if (event.type !== "user/message" || source === void 0) {
      throw new Error("rewind-marker start requires a user/message with a rewind source");
    }
    return {
      seq: event.seq,
      time: event.time,
      maskedCount: source.maskedCount,
      keepThroughSeq: source.keepThroughSeq
    };
  },
  update: (context) => context.state,
  buildViewNode: (context) => {
    if (context.state === void 0) return null;
    const start = context.start;
    if (start === void 0) return null;
    const anchor = start.event.seq;
    const location = start.location;
    return {
      key: context.key,
      kind: "rewind-marker",
      id: context.id,
      target: "chat",
      anchorSeq: anchor,
      location,
      visibility: "visible",
      data: context.state
    };
  }
};

// dsh-css:D:\Code\Projects\dsh-utils\repo-utils\plugins\rewind\src\client\RewindCommandCard.module.css
var css3 = ".KkjaDW_card{flex-wrap:wrap;align-items:baseline;gap:.5rem;padding:.25rem 0;font-size:.8125rem;display:flex}.KkjaDW_title{font-weight:600}.KkjaDW_pending{opacity:.6}.KkjaDW_error{color:var(--dsw-alias-danger,#d5484f)}.KkjaDW_result{opacity:.85}";
var tagId3 = "@zaimaxvx/dsh-plugin-rewind/RewindCommandCard.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId3) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "@zaimaxvx/dsh-plugin-rewind";
  tag.dataset.pluginCss = tagId3;
  tag.textContent = css3;
  document.head.appendChild(tag);
}
var RewindCommandCard_default = { "card": "KkjaDW_card", "error": "KkjaDW_error", "pending": "KkjaDW_pending", "result": "KkjaDW_result", "title": "KkjaDW_title" };

// plugins/rewind/src/client/RewindCommandCard.tsx
var import_jsx_runtime3 = require("react/jsx-runtime");
function maskedCountOf(outcomeText) {
  if (outcomeText === void 0) return void 0;
  const match = /Rewound:\s*(\d+)/.exec(outcomeText);
  return match === null ? void 0 : Number(match[1]);
}
function RewindCommandCard({ node, t }) {
  const outcome = node.outcome;
  return /* @__PURE__ */ (0, import_jsx_runtime3.jsxs)("div", { className: RewindCommandCard_default.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: RewindCommandCard_default.title, children: t("cmd.title") }),
    outcome === null ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: RewindCommandCard_default.pending, children: t("cmd.pending") }) : outcome.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: RewindCommandCard_default.error, children: outcome.text ?? t("cmd.failed") }) : /* @__PURE__ */ (0, import_jsx_runtime3.jsx)("span", { className: RewindCommandCard_default.result, children: maskedCountOf(outcome.text) !== void 0 ? t("cmd.summary", { count: maskedCountOf(outcome.text) }) : outcome.text ?? t("cmd.nothing") })
  ] });
}

// plugins/rewind/src/client/locales.ts
var zh = {
  "action.rewindHere": "\u56DE\u9000\u5230\u8FD9\u91CC",
  "action.busy": "\u667A\u80FD\u4F53\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u5148\u505C\u6B62\u518D\u56DE\u9000",
  "picker.undo1": "\u64A4\u9500\u6700\u8FD1 1 \u8F6E",
  "picker.undoN": "\u64A4\u9500\u6700\u8FD1 {n} \u8F6E",
  "picker.hint": "\u56DE\u9000\u4F1A\u4ECE\u6A21\u578B\u4E0A\u4E0B\u6587\u4E2D\u79FB\u9664\u6240\u9009\u8F6E\u6B21\u4E4B\u540E\u7684\u5185\u5BB9",
  "marker.title": "\u5DF2\u56DE\u9000",
  "marker.detail": "{count} \u6761\u5185\u5BB9\u5DF2\u79FB\u51FA\u6A21\u578B\u4E0A\u4E0B\u6587\uFF08\u8BB0\u5F55\u4ECD\u4FDD\u7559\uFF09\uFF0C\u4E0A\u4E0B\u6587\u6062\u590D\u81F3 #{keep}",
  "cmd.title": "/rewind",
  "cmd.pending": "\u56DE\u9000\u4E2D\u2026",
  "cmd.failed": "\u56DE\u9000\u5931\u8D25",
  "cmd.nothing": "\u5F53\u524D\u5DF2\u5728\u8BE5\u4F4D\u7F6E\uFF0C\u65E0\u9700\u56DE\u9000",
  "cmd.summary": "\u5DF2\u56DE\u9000\uFF1A{count} \u6761\u5185\u5BB9\u79FB\u51FA\u6A21\u578B\u4E0A\u4E0B\u6587\uFF08\u8BB0\u5F55\u4ECD\u4FDD\u7559\uFF09"
};
var en = {
  "action.rewindHere": "Rewind to here",
  "action.busy": "The agent is working; stop it before rewinding",
  "picker.undo1": "Undo the last turn",
  "picker.undoN": "Undo the last {n} turns",
  "picker.hint": "Rewinding removes the chosen turns onward from the model context",
  "marker.title": "Rewound",
  "marker.detail": "{count} item(s) left the model context (the transcript keeps them); context restored through #{keep}",
  "cmd.title": "/rewind",
  "cmd.pending": "Rewinding\u2026",
  "cmd.failed": "Rewind failed",
  "cmd.nothing": "Already at that point \u2014 nothing to rewind",
  "cmd.summary": "Rewound: {count} item(s) left the model context (the transcript keeps them)"
};

// plugins/rewind/src/client/index.ts
var NS = "rewind";
var inject = ["slots", "uiConversation", "sessions", "locale", "commandUi"];
var PICKER_TURNS = [1, 2, 3, 4, 5];
function submitLine(ctx, sessionId, line) {
  const binding = ctx.sessions.binding(sessionId);
  if (binding === void 0) return;
  void binding.session.command(line);
}
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "rewind: dictionaries");
  ctx.effect(() => ctx.commandUi.decorate({
    name: "rewind",
    available: () => true,
    ui: {
      kind: "popupSelect",
      options: async () => {
        const t = ctx.locale.bind(NS);
        return PICKER_TURNS.map((n) => ({
          id: String(n),
          label: t(n === 1 ? "picker.undo1" : "picker.undoN", { n }),
          detail: t("picker.hint")
        }));
      },
      onSelect: (option, target) => {
        submitLine(ctx, target.sessionId, `/rewind ${option.id}`);
      }
    }
  }), "rewind: /rewind picker");
  ctx.slots.inject("conversation.chat.assistant-actions", () => ctx.slots.register({
    name: "conversation.chat.assistant-actions",
    id: "rewind",
    order: 5,
    locale: NS,
    inject: (sessionId) => ({
      submit: (line) => {
        submitLine(ctx, sessionId, line);
      }
    })
  }, RewindAssistantAction));
  ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
    name: "conversation.chat.commandview",
    key: "rewind",
    locale: NS
  }, RewindCommandCard));
  ctx.uiConversation.events.register(rewindMarkerDefinition);
  ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
    name: "conversation.chat.node",
    key: "rewind-marker",
    locale: NS
  }, RewindMarkerNode));
}
return module.exports; } });
//# sourceMappingURL=client.js.map

window.__ModuleLoader__.load({ id: "dsh-plugin-rewind", factory: (require) => {
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

// dsh-css:D:\Code\Projects\dsh-utils\repo-utils\plugins\rewind\src\client\TurnTailRewind.module.css
var css = ".fpEFXW_rewind{align-items:center;gap:.25rem;display:inline-flex}.fpEFXW_action{font:inherit;color:inherit;opacity:.65;cursor:pointer;background:0 0;border:none;border-radius:.25rem;padding:0 .375rem;font-size:.75rem;line-height:1.25rem}.fpEFXW_action:hover:not(:disabled),.fpEFXW_action:focus-visible:not(:disabled){opacity:1;background:color-mix(in srgb, currentColor 10%, transparent)}.fpEFXW_action:disabled{opacity:.35;cursor:default}";
var tagId = "dsh-plugin-rewind/TurnTailRewind.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-plugin-rewind";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var TurnTailRewind_default = { "action": "fpEFXW_action", "rewind": "fpEFXW_rewind" };

// plugins/rewind/src/client/TurnTailRewind.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function TurnTailRewind({
  turn,
  seq,
  submit,
  t,
  useSessionStatus,
  sessionId
}) {
  const working = useSessionStatus((snapshot) => snapshot.get(sessionId)?.running) === true;
  const busyTitle = working ? t("action.busy") : void 0;
  const startSeq = turn.start?.seq;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: TurnTailRewind_default.rewind, children: [
    startSeq !== void 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: TurnTailRewind_default.action,
        disabled: working,
        title: busyTitle ?? t("action.retryTurn"),
        "aria-label": t("action.retryTurn"),
        onClick: () => {
          submit(`/rewind to ${startSeq - 1}`);
        },
        children: t("action.retryTurn")
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        type: "button",
        className: TurnTailRewind_default.action,
        disabled: working,
        title: busyTitle ?? t("action.rewindHere"),
        "aria-label": t("action.rewindHere"),
        onClick: () => {
          submit(`/rewind to ${seq}`);
        },
        children: t("action.rewindHere")
      }
    )
  ] });
}

// plugins/rewind/src/client/locales.ts
var zh = {
  "action.retryTurn": "\u91CD\u8BD5\u672C\u8F6E",
  "action.rewindHere": "\u56DE\u9000\u5230\u8FD9\u91CC",
  "action.busy": "\u667A\u80FD\u4F53\u6B63\u5728\u8FD0\u884C\uFF0C\u8BF7\u5148\u505C\u6B62\u518D\u56DE\u9000",
  "picker.undo1": "\u64A4\u9500\u6700\u8FD1 1 \u8F6E",
  "picker.undoN": "\u64A4\u9500\u6700\u8FD1 {n} \u8F6E",
  "picker.hint": "\u56DE\u9000\u4F1A\u4ECE\u6A21\u578B\u4E0A\u4E0B\u6587\u4E2D\u79FB\u9664\u6240\u9009\u8F6E\u6B21\u4E4B\u540E\u7684\u5185\u5BB9"
};
var en = {
  "action.retryTurn": "Retry this turn",
  "action.rewindHere": "Rewind to here",
  "action.busy": "The agent is working; stop it before rewinding",
  "picker.undo1": "Undo the last turn",
  "picker.undoN": "Undo the last {n} turns",
  "picker.hint": "Rewinding removes the chosen turns onward from the model context"
};

// plugins/rewind/src/client/index.ts
var NS = "rewind";
var inject = ["slots", "sessions", "locale", "commandUi"];
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
  ctx.slots.inject("conversation.chat.turnTail", () => ctx.slots.register({
    name: "conversation.chat.turnTail",
    id: "rewind",
    order: 5,
    locale: NS,
    inject: (sessionId) => ({
      submit: (line) => {
        submitLine(ctx, sessionId, line);
      }
    })
  }, TurnTailRewind));
}
return module.exports; } });
//# sourceMappingURL=client.js.map

window.__ModuleLoader__.load({ id: "dsh-plugin-btw", factory: (require) => {
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

// plugins/btw/src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(index_exports);

// plugins/btw/src/client/BtwTab.tsx
var import_react = require("react");

// plugins/btw/src/client/view.ts
function btwRows(history) {
  if (history === void 0) return [];
  return [...history].reverse().map((entry) => ({
    entry,
    pending: entry.status === "pending",
    failed: entry.status === "error"
  }));
}
function btwTime(time) {
  return new Date(time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}
function btwCommandLine(question) {
  return `/btw ${question.trim()}`;
}
function submittable(draft) {
  return draft.trim().length > 0;
}

// dsh-css:D:\Code\Projects\dsh-utils\repo-utils\plugins\btw\src\client\BtwTab.module.css
var css = ".XO8EkG_panel{flex-direction:column;height:100%;min-height:0;display:flex}.XO8EkG_list{flex-direction:column;flex:1;gap:.75rem;min-height:0;margin:0;padding:.5rem .75rem;list-style:none;display:flex;overflow-y:auto}.XO8EkG_empty{opacity:.6;text-align:center;flex:1;justify-content:center;align-items:center;margin:0;padding:1rem;font-size:.8125rem;display:flex}.XO8EkG_entry{border-bottom:1px solid color-mix(in srgb, currentColor 10%, transparent);flex-direction:column;gap:.25rem;padding-bottom:.75rem;display:flex}.XO8EkG_entry:last-child{border-bottom:none;padding-bottom:0}.XO8EkG_head{align-items:baseline;gap:.5rem;display:flex}.XO8EkG_question{overflow-wrap:anywhere;font-size:.8125rem;font-weight:600}.XO8EkG_time{opacity:.55;flex-shrink:0;margin-left:auto;font-size:.6875rem}.XO8EkG_answer{white-space:pre-wrap;overflow-wrap:anywhere;margin:0;font-size:.8125rem;line-height:1.45}.XO8EkG_pending,.XO8EkG_failed{opacity:.6;margin:0;font-size:.8125rem}.XO8EkG_failed{opacity:.85;color:var(--dsh-danger,#d5484f)}.XO8EkG_ask{border-top:1px solid color-mix(in srgb, currentColor 10%, transparent);align-items:flex-end;gap:.375rem;padding:.5rem .75rem;display:flex}.XO8EkG_input{resize:none;font:inherit;border:1px solid color-mix(in srgb, currentColor 20%, transparent);color:inherit;background:0 0;border-radius:.375rem;flex:1;padding:.375rem .5rem;font-size:.8125rem}.XO8EkG_input:focus-visible{outline:1px solid color-mix(in srgb, currentColor 45%, transparent)}.XO8EkG_send{color:inherit;font:inherit;cursor:pointer;opacity:.7;background:0 0;border:none;border-radius:.375rem;padding:.375rem .5rem;font-size:.9rem}.XO8EkG_send:hover:not(:disabled),.XO8EkG_send:focus-visible:not(:disabled){opacity:1;background:color-mix(in srgb, currentColor 10%, transparent)}.XO8EkG_send:disabled{opacity:.35;cursor:default}.XO8EkG_warn{opacity:.7;margin:0;padding:0 .75rem .5rem;font-size:.75rem}";
var tagId = "dsh-plugin-btw/BtwTab.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-plugin-btw";
  tag.dataset.pluginCss = tagId;
  tag.textContent = css;
  document.head.appendChild(tag);
}
var BtwTab_default = { "answer": "XO8EkG_answer", "ask": "XO8EkG_ask", "empty": "XO8EkG_empty", "entry": "XO8EkG_entry", "failed": "XO8EkG_failed", "head": "XO8EkG_head", "input": "XO8EkG_input", "list": "XO8EkG_list", "panel": "XO8EkG_panel", "pending": "XO8EkG_pending", "question": "XO8EkG_question", "send": "XO8EkG_send", "time": "XO8EkG_time", "warn": "XO8EkG_warn" };

// plugins/btw/src/client/BtwTab.tsx
var import_jsx_runtime = require("react/jsx-runtime");
function BtwTab({ submit, t, useProjection }) {
  const history = useProjection("btwHistory");
  const rows = btwRows(history);
  const [draft, setDraft] = (0, import_react.useState)("");
  const [warned, setWarned] = (0, import_react.useState)(false);
  const send = (0, import_react.useCallback)(() => {
    if (!submittable(draft)) {
      setWarned(true);
      return;
    }
    setWarned(false);
    submit(btwCommandLine(draft));
    setDraft("");
  }, [draft, submit]);
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: BtwTab_default.panel, children: [
    rows.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: BtwTab_default.empty, children: t("panel.empty") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ol", { className: BtwTab_default.list, children: rows.map(({ entry, pending, failed }) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("li", { className: BtwTab_default.entry, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: BtwTab_default.head, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: BtwTab_default.question, children: entry.question }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: BtwTab_default.time, children: btwTime(entry.time) })
      ] }),
      pending ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: BtwTab_default.pending, children: t("entry.pending") }) : failed ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: BtwTab_default.failed, children: t("entry.error") }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: BtwTab_default.answer, children: entry.answer })
    ] }, entry.id)) }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: BtwTab_default.ask, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "textarea",
        {
          className: BtwTab_default.input,
          rows: 2,
          placeholder: t("panel.inputPlaceholder"),
          value: draft,
          onChange: (event) => {
            setDraft(event.target.value);
            if (warned) setWarned(false);
          },
          onKeyDown: (event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              send();
            }
          }
        }
      ),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", className: BtwTab_default.send, disabled: !submittable(draft), onClick: send, children: "\u21B5" })
    ] }),
    warned && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: BtwTab_default.warn, role: "status", children: t("panel.emptyQuestion") })
  ] });
}

// plugins/btw/src/client/BtwCommandCard.tsx
var import_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

// dsh-css:D:\Code\Projects\dsh-utils\repo-utils\plugins\btw\src\client\BtwCommandCard.module.css
var css2 = "._4E6h3G_card{flex-direction:column;gap:.375rem;padding:.375rem 0;display:flex}._4E6h3G_question{overflow-wrap:anywhere;font-size:.8125rem;font-weight:600}._4E6h3G_answer{overflow-wrap:anywhere;font-size:.8125rem;line-height:1.45}._4E6h3G_answer :first-child{margin-top:0}._4E6h3G_answer :last-child{margin-bottom:0}._4E6h3G_pending,._4E6h3G_error{opacity:.7;margin:0;font-size:.8125rem}._4E6h3G_error{opacity:.9;color:var(--dsw-alias-danger,#d5484f)}";
var tagId2 = "dsh-plugin-btw/BtwCommandCard.module.css";
if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId2) + "]") === null) {
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-plugin-btw";
  tag.dataset.pluginCss = tagId2;
  tag.textContent = css2;
  document.head.appendChild(tag);
}
var BtwCommandCard_default = { "answer": "_4E6h3G_answer", "card": "_4E6h3G_card", "error": "_4E6h3G_error", "pending": "_4E6h3G_pending", "question": "_4E6h3G_question" };

// plugins/btw/src/client/BtwCommandCard.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
function BtwCommandCard({ node, t }) {
  const outcome = node.outcome;
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: BtwCommandCard_default.card, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: BtwCommandCard_default.question, children: node.args ?? t("cmd.untitled") }),
    outcome === null ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: BtwCommandCard_default.pending, children: t("cmd.pending") }) : outcome.kind === "error" ? /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: BtwCommandCard_default.error, children: outcome.text ?? t("cmd.failed") }) : /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: BtwCommandCard_default.answer, children: /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(import_dsh_client_ui_primitives.MarkdownText, { text: outcome.text ?? "" }) })
  ] });
}

// plugins/btw/src/client/locales.ts
var zh = {
  "tab.title": "BTW \u4FA7\u95EE",
  "guide.title": "BTW \u4FA7\u95EE",
  "guide.description": "\u4E0D\u6253\u65AD\u4E3B\u5BF9\u8BDD\u7684\u5373\u65F6\u4FA7\u95EE\uFF1A\u63D0\u95EE\u7ACB\u5373\u7531\u5F53\u524D\u4E0A\u4E0B\u6587\u4F5C\u7B54\uFF0C\u95EE\u7B54\u4E0D\u8FDB\u5165\u4E3B\u5386\u53F2",
  "panel.inputPlaceholder": "\u95EE\u70B9\u4EC0\u4E48\u2026\uFF08Ctrl+Enter \u53D1\u9001\uFF09",
  "panel.empty": "\u8FD8\u6CA1\u6709\u4FA7\u95EE\u3002\u8F93\u5165 /btw <\u95EE\u9898> \u6216\u5728\u4E0A\u65B9\u76F4\u63A5\u63D0\u95EE\u3002",
  "panel.pending": "\u601D\u8003\u4E2D\u2026",
  "panel.error": "\u4FA7\u95EE\u5931\u8D25",
  "panel.emptyQuestion": "\u95EE\u9898\u4E0D\u80FD\u4E3A\u7A7A",
  "entry.pending": "\u601D\u8003\u4E2D\u2026",
  "entry.error": "\u5931\u8D25",
  "cmd.untitled": "\u4FA7\u95EE",
  "cmd.pending": "\u601D\u8003\u4E2D\u2026",
  "cmd.failed": "\u4FA7\u95EE\u5931\u8D25"
};
var en = {
  "tab.title": "BTW",
  "guide.title": "BTW side questions",
  "guide.description": "Immediate side answers from the current context, without touching the main conversation",
  "panel.inputPlaceholder": "Ask something\u2026 (Ctrl+Enter to send)",
  "panel.empty": "No side questions yet. Type /btw <question> or ask right here.",
  "panel.pending": "Thinking\u2026",
  "panel.error": "Side question failed",
  "panel.emptyQuestion": "Question must not be empty",
  "entry.pending": "Thinking\u2026",
  "entry.error": "Failed",
  "cmd.untitled": "Side question",
  "cmd.pending": "Thinking\u2026",
  "cmd.failed": "Side question failed"
};

// plugins/btw/src/client/index.ts
var NS = "btw";
var TAB_ID = "dsh-plugin-btw";
var TAB_KIND = "btw";
var inject = ["slots", "sidebarRightTabs", "sidebarRight", "sessions", "locale", "commandUi"];
function submitLine(ctx, sessionId, line) {
  const binding = ctx.sessions.binding(sessionId);
  if (binding === void 0) return;
  void binding.session.command(line);
}
function apply(ctx) {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), "btw: dictionaries");
  const t = ctx.locale.bind(NS);
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => t("tab.title"),
    guide: [{
      id: "btw",
      order: 20,
      title: () => t("guide.title"),
      description: () => t("guide.description")
    }]
  }), "btw: sidebar tab");
  ctx.slots.inject("sidebar.right.pane.tab", () => ctx.slots.register({
    name: "sidebar.right.pane.tab",
    key: TAB_ID,
    locale: NS,
    inject: (sessionId) => ({
      submit: (line) => {
        submitLine(ctx, sessionId, line);
      }
    })
  }, BtwTab));
  ctx.slots.inject("conversation.chat.commandview", () => ctx.slots.register({
    name: "conversation.chat.commandview",
    key: "btw",
    locale: NS
  }, BtwCommandCard));
  ctx.effect(() => ctx.commandUi.decorate({
    name: "btw",
    available: () => true,
    ui: {
      kind: "action",
      run: () => {
        try {
          ctx.sidebarRight.openTab(TAB_KIND);
        } catch {
        }
      }
    }
  }), "btw: /btw opens the panel");
}
return module.exports; } });
//# sourceMappingURL=client.js.map

# dsh-plugin-rewind

Rewind for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh) `v0.2.2-rc.1`:
restore a session's **model context** to an earlier point — a `/rewind` slash
command, a bare-invocation undo picker, and per-turn rewind actions in the Web
chat.

Rewind does **not** delete or rewrite history. The dsh session log is
append-only; LLM-visible history is a projection (the "surface") folded from
that log. This plugin appends one *surface replacement* — the same
`surfaceOp: { op: 'replace' }` channel compaction uses, which the surface
contract explicitly allows any producer to use — that shadows every live
surface node after the chosen boundary behind a short marker message. The
model context returns to that point; the human transcript keeps everything
(and the rewind lands in the log as its own generation, so it is auditable and
survives restarts).

```
before:  [system] [user1] [user2] [assistant2] [user3] [assistant3]
/rewind to (seq of user2 - 1)
after:   [system] [user1] [rewind marker]        ← model context
         (user2…assistant3 remain in the log & transcript)
```

## What you get

| Surface | Entry | Effect |
|---|---|---|
| Web chat, turn tail | **Retry this turn** / **Rewind to here** buttons | Retry: drop this turn onward (rephrase its prompt). Rewind to here: keep this turn, drop everything after. Buttons disable while the agent runs. |
| Web composer, `/rewind` | Bare invocation opens an **undo picker** (last 1–5 turns) | Submits `/rewind <n>` through the command channel. |
| Any surface (Web, SDK, headless) | `/rewind <n>` | Undo the last `n` turns. |
| Any surface | `/rewind turn <k>` | Undo everything from the `k`-th turn on. |
| Any surface | `/rewind to <seq>` | Keep context through event `seq` (what the buttons submit). |
| Any surface | `/rewind` | Prints usage. |

Guardrails:

- Rewind runs inside `agent.runMaintenance`, so it only executes between
  turns; a running agent is reported, never raced.
- The surface head (node 0 — the system prompt) is never shadowed.
- `maxUndoTurns` (default 20) bounds `/rewind <n>`.
- Rewind is one-way within a session (surface generations only move forward).
  For hard isolation into a new session, use the built-in **branch** button —
  both compose well.

## Layout

```
src/index.ts            host half: /rewind command (grammar, turn lookup, maintenance)
src/rewind.ts           commit: one append-only surface replacement (marker + shadow span)
src/planner.ts          pure boundary arithmetic over live surface seqs (zero imports)
src/types.ts            `rewind` message-source merge (MessageSourceMap)
src/client/index.ts     browser half: picker decoration + turnTail slot entry
src/client/TurnTailRewind.tsx  the two turn-tail actions
tests/                  vitest specs (pure planner + real-Session integration)
scripts/                local verification without installing the dsh workspace
cordis.patch.yml        the bundle layer this package contributes
```

## Install

Requires dsh ≥ 0.2.2-rc.1 (Node ≥ 24.9). Verified against dsh
v0.2.2-rc.1 **and** v0.2.2-rc.2 — the rc.2 host/client API diff found no
breaking changes for this plugin (see `docs/research/rc2-*-diff.md`).

```sh
# from a tarball / npm
dsh plugin --profile <name> add dsh-plugin-rewind
# from a git checkout (runs the prepare build; allow it when prompted)
dsh plugin --profile <name> add github:<you>/dsh-plugin-rewind
```

Installable artifacts are **prebuilt and committed** under `lib/` (`main`/`exports`
point there; built by `tools/build.mjs` — esbuild host bundle + the
`window.__ModuleLoader__` client script). Git / path / tarball / registry
installs all work with zero build authorization; rebuild after source edits
with `npm run build`.

## Development

Quick try against a dsh source checkout (host half straight from TypeScript —
Node ≥ 24.9 type-stripping runs it):

```sh
# inside the dsh repo
pnpm dsh web --patch /abs/path/to/rewind-plugin/dev.patch.yml
```

Both halves ship prebuilt under `lib/` — the browser half is the
`window.__ModuleLoader__` registration script, rebuilt with `npm run build`.

### Verification (no dsh install needed)

```sh
npm test     # real-Session smoke (tsx + source-plane resolver hook) + planner vitest
npm run check  # tsc --noEmit for both compilation faces against the dsh sources
```

`npm run check` reports **zero errors in this package's files**; the check
program may additionally surface strictness noise inside dsh's own vendored
sources (zod/schemastery/react version skew against the repo's pinned
node_modules), which does not occur in the repo's own build.

`tests/rewind-session.spec.ts` additionally runs inside the dsh workspace
(copy the package under `packages/rewind/`, where the repo vitest config
resolves the `@deepseek-ai/*` source plane).

## Configuration

Overlay via `cordis.patch.yml`:

```yaml
- id: rewind
  name: dsh-plugin-rewind
  config:
    markerText: '[rewound: {count} later messages removed from context]'
    maxUndoTurns: 20
```

`{count}` expands to the number of shadowed surface items.

## Design notes

- **Why surface replace, not fork?** Fork (the built-in branch) is isolation:
  a new session id and a copied prefix. Rewind is *in place*: the same session
  keeps its identity, queued inbox, title, and workspace, and the model
  context rolls back. The dsh UI already reserves the generation origin
  `'rewind'` (`ConversationContextOriginKind`) — this plugin is a producer of
  exactly that shape.
- **Marker message**: the replacement event is a `user/message` with source
  `{ kind: 'rewind', maskedCount, keepThroughSeq }` (declaration-merged into
  `MessageSourceMap`), so every rewind is visible and queryable in the log and
  the transcript.
- **Turn boundaries** come from `ctx.sessionQuery.filterEvents(... 'turn/start')`
  — the public query surface — never the deprecated synchronous reads.

License: MIT.

# dsh-plugin-btw (BTW side questions)

`/btw` for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh)
`v0.2.2-rc.1+`: **immediate side questions** — a lightweight one-shot model call
answered from the current session context, without touching the main
conversation. The exchange never enters the model-visible history; answers
show up in the **right-sidebar BTW panel** and on the command card.

> Semantics note: Claude Code's `/btw` is not a queued message — it is an
> immediate side question (forked context, no tools, one turn, out of the
> main history). This plugin reproduces that behavior faithfully (research in
> `docs/research/btw-01-semantics.md`). If you want "queue for the next turn"
> semantics, use dsh's built-in composer queue mode — no plugin needed.

## How it works

```
/btw which test framework does this repo use?
  └─ host: one ctx.llm.stream call (compaction's prefix-replay shape)
       messages = session.deriveMessages()   ← full context (hits the KV prefix cache)
                 + [instruction + <side_question>…</side_question>]
       no tools / no toolHistory / purpose: 'btw'
  └─ answer → CommandResult (rendered by the generic command card)
  └─ panel data = the btwHistory session projection (folds stock
     command/run + command/done pairs) → pushed over the standard projection
     wire → the panel's useProjection('btwHistory') updates live
```

No custom session event types are written — the log vocabulary stays stock,
sessions remain readable by hosts without the plugin, and the projection
rebuilds identically from a cold read.

## Features

- `/btw <question>` — works on every surface (Web/SDK); the answer returns as
  the command result
- **Right-sidebar BTW panel**: Q&A history (newest first) plus an inline ask
  box (Ctrl+Enter to send — it goes through the exact same command channel as
  a typed `/btw` line)
- Bare `/btw` (no argument) opens the panel on the Web client
- Entry card in the sidebar "+" guide; zh/en dictionaries

## Layout

```
src/index.ts            host: /btw command + btwHistory projection registration
src/sideask.ts          the one-shot side call (target resolution, request assembly, streaming)
src/history.ts          pure fold: command event pairs → panel history (testable)
src/types.ts            btwHistory projection key + 'btw' LLM purpose merges
src/client/index.ts     browser: sidebar tab registration + panel body + bare-/btw decoration
src/client/BtwTab.tsx   the panel component (history + ask box)
src/client/view.ts      pure view model (newest-first, etc.)
tests/                  vitest (fold/view) + scripts/smoke.sideask.mjs (real dsh message constructors)
```

## Install

Requires dsh ≥ 0.2.2-rc.1 (Node ≥ 24.9). Verified against v0.2.2-rc.1 and
v0.2.2-rc.2.

```sh
dsh plugin --profile <name> add github:ZaiMaxvx/dsh-btw
# or npm/tarball: dsh plugin --profile <name> add dsh-plugin-btw
```

## Development

```sh
# quick try (host half runs straight from TypeScript)
pnpm dsh web --patch /abs/path/to/btw-plugin/dev.patch.yml

# verification (no dsh workspace install needed)
npm test       # sideask smoke (tsx + source-plane hook) + fold/view vitest
npm run check  # tsc --noEmit for both faces (0 errors in src against the dsh sources)
```

## Configuration

```yaml
- id: btw
  name: dsh-plugin-btw
  config:
    instruction: 'Answer the user''s side question…'  # framing instruction (has a default)
    maxTokens: 1024        # output token cap per side answer
    maxEntries: 50         # panel history cap (oldest drop off)
    provider: ''           # optional route override ('' = follow the session)
    model: ''
```

## Design notes

- **Why out of the main history**: the point of a side question is "ask
  without disturbing" — the main task and the side answer never pollute each
  other. The durable log records only the stock command lifecycle events.
- **Prefix cache**: replaying `deriveMessages()` (with the loop's system
  prompt) as the prefix shares the provider's warm KV cache with the main
  conversation, so side questions are cheap and fast.
- **Projection over custom events**: the panel's data is folded host-side
  from stock command events, so it cold-reads identically and introduces no
  fail-closed unknown event types.

License: MIT.

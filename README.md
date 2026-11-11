# dsh-utils

Utility plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
one pnpm workspace — every directory under `plugins/` is an independently
installable plugin package, and `tools/` is the shared verification toolchain.
New plugins drop in ready-made.

## Plugins

| Plugin | Version | What it does | Standalone install |
|---|---|---|---|
| [rewind](plugins/rewind/) | 0.1.1 | `/rewind`: restore a session's **model context** to an earlier point via an append-only surface replacement (compaction's channel) — command, undo picker, per-turn actions | `dsh plugin --profile <n> add github:ZaiMaxvx/dsh-rewind` |
| [btw](plugins/btw/) | 0.1.0 | `/btw`: immediate **side questions** — a lightweight one-shot answer from the current context, no tools, never enters the main history; right-sidebar BTW panel with inline asking | `dsh plugin --profile <n> add github:ZaiMaxvx/dsh-btw` |

Both are built and verified against dsh **v0.2.2-rc.1 / rc.2**
(`engines.dsh: >=0.2.2-rc.1 <0.3.0`, Node ≥ 24.9).

### Installing from this repository (path installs)

Each plugin is a standalone package with a `dsh.bundle` declaration and can be
installed by path:

```sh
dsh plugin --profile <name> add 'github:ZaiMaxvx/dsh-utils#path:/plugins/rewind'
dsh plugin --profile <name> add 'github:ZaiMaxvx/dsh-utils#path:/plugins/btw'
```

The standalone repositories (table above) remain each plugin's primary
publishing channel; this repository is their **shared development home**.

## Layout

```
plugins/
  rewind/            the /rewind context-rewind plugin (host command + client turn actions/picker)
  btw/               the /btw side-question plugin (host command + projection + client sidebar panel)
tools/               shared verification toolchain (source-tree resolution, path generation,
                     two-face checks, portable smoke runner)
docs/research/       14 design-research notes (architecture/plugin system/persistence/
                     lifecycle/UI/examples + rc2 API diffs + six /btw notes)
```

## Development & verification (no dsh workspace install)

Prerequisite: clone [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)
**next to** this repository named `dsh-source` (or point `DSH_SRC` at any dsh
source tree, e.g. `DSH_SRC=dsh-source-rc2`), then:

```sh
npm install                 # at the repository root (typescript/vitest/tsx etc.)
npm run check               # every plugin × both compilation faces, tsc --noEmit
npm test                    # every plugin: smoke (tsx + source-plane hook) + vitest

# one plugin
npm run check -- btw        # or rewind
npm test -- btw
```

`npm run check` reports **0 errors in each plugin's own sources**; the program
may additionally surface strictness noise inside dsh's vendored sources
(zod/schemastery/react version skew against the repo's pinned node_modules),
which does not occur in dsh's own build.

Quick-try a plugin's host half (straight from TypeScript, Node ≥ 24.9):

```sh
pnpm dsh web --patch /abs/path/to/dsh-utils/plugins/<plugin>/dev.patch.yml
```

## Adding a plugin

1. Copy any existing plugin directory to `plugins/<name>/`; adjust
   `package.json` (name/description/`dsh.bundle.patch`/`dsh.client`/`engines.dsh`)
   and `cordis.patch.yml`
2. The scripts already point at the shared `../../tools/` — no per-plugin toolchain
3. `npm run check -- <name> && npm test -- <name>` verifies against the dsh sources
4. Drop research notes into `docs/research/` as `<topic>-<name>.md`

## Design documents

All research and design notes live in [`docs/research/`](docs/research/): six
dsh-architecture notes, two rc.1→rc.2 API-diff notes, and six /btw notes
(including the Claude Code `/btw` semantics investigation).

License: MIT (see [LICENSE](LICENSE); plugin packages without their own LICENSE
file fall under this repository's).

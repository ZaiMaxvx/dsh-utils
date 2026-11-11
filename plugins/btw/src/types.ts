/**
 * Public type merges owned by the btw plugin. Types only: importing this
 * module (even `import type {}`) brings the merges into the compilation.
 *
 * - `btwHistory` session projection: the right-sidebar panel's data source,
 *   folded host-side from the stock `command/run` + `command/done` events.
 * - `btw` LLM request purpose: marks the side-question's one-shot call.
 *
 * @module dsh-plugin-btw/types
 */

import type {} from '@deepseek-ai/dsh-llm/types'
import type {} from '@deepseek-ai/dsh-session-projection/types'

/** One side-question entry as folded from the session log. */
export interface BtwEntry {
  /** The `command/run`/`command/done` pairing id. */
  readonly id: string
  /** The question exactly as typed after `/btw`. */
  readonly question: string
  /** The side-answer text; `''` until the call settles (or on failure). */
  readonly answer: string
  /** Settlement state. */
  readonly status: 'pending' | 'done' | 'error'
  /** Unix epoch ms of the `command/run` event. */
  readonly time: number
}

/** Folded btw history: oldest first, capped at the configured entry count. */
export type BtwHistoryState = readonly BtwEntry[]

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /**
     * Side-question (/btw) history for the panel: every `/btw` command pair
     * with its answer, oldest first. Served to clients through the standard
     * projection wire (useProjection('btwHistory')).
     */
    btwHistory: BtwHistoryState
  }
}

declare module '@deepseek-ai/dsh-llm/types' {
  interface LlmRequestPurposeMap {
    'btw': true
  }
}

/**
 * Pure view model for the BTW panel: newest-first ordering and display
 * helpers, extracted from the component so the mapping is testable without
 * a DOM.
 *
 * @module dsh-plugin-btw/client/view
 */

import type { BtwEntry } from '../types.ts'

/** One panel row: an entry plus display-only derivations. */
export interface BtwRow {
  readonly entry: BtwEntry
  /** True while the side answer is still streaming. */
  readonly pending: boolean
  /** Short failure label for error rows. */
  readonly failed: boolean
}

/** Project the folded history into newest-first panel rows. */
export function btwRows(history: readonly BtwEntry[] | undefined): readonly BtwRow[] {
  if (history === undefined) return []
  return [...history]
    .reverse()
    .map(entry => ({
      entry,
      pending: entry.status === 'pending',
      failed: entry.status === 'error',
    }))
}

/** Format one entry's epoch-ms time as a compact locale stamp. */
export function btwTime(time: number): string {
  return new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Build the /btw command line for one panel submission. */
export function btwCommandLine(question: string): string {
  return `/btw ${question.trim()}`
}

/** Whether a draft is submittable. */
export function submittable(draft: string): boolean {
  return draft.trim().length > 0
}

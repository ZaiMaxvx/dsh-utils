/**
 * Pure fold of the btw history from stock session events.
 *
 * The host registers this as the `btwHistory` session projection; the panel
 * reads it client-side through `useProjection('btwHistory')`. Folding the
 * generic `command/run` + `command/done` pairs (instead of writing custom
 * session events) keeps the log vocabulary stock: sessions stay readable by
 * hosts without the plugin, and the projection rebuilds identically from a
 * cold read.
 *
 * @module dsh-plugin-btw/history
 */

import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type { BtwEntry, BtwHistoryState } from './types.ts'

/** Narrow one logged event to a btw `command/run` record. */
function btwRun(event: SessionEvent): { commandId: string; question: string; time: number } | undefined {
  if (event.type !== 'command/run') return undefined
  if (event.data.name !== 'btw') return undefined
  return {
    commandId: event.data.commandId,
    question: event.data.args?.trim() ?? '',
    time: event.time,
  }
}

/**
 * Fold one event into the btw history.
 * @param state - history so far, oldest first.
 * @param event - the next session event in log order.
 * @param maxEntries - history cap; the OLDEST entries beyond the cap drop off.
 * @returns the next history state (same reference when nothing changed).
 */
export function foldBtwHistory(state: BtwHistoryState, event: SessionEvent, maxEntries: number): BtwHistoryState {
  const run = btwRun(event)
  if (run !== undefined) {
    if (run.question.length === 0) return state
    const entry: BtwEntry = { id: run.commandId, question: run.question, answer: '', status: 'pending', time: run.time }
    return capEntries([...state, entry], maxEntries)
  }
  if (event.type === 'command/done') {
    // `command/done` carries the pairing id but not the command name; only
    // ids already in this btw-only state can match.
    const index = state.findIndex(entry => entry.id === event.data.commandId)
    if (index === -1) return state
    const current = state[index]
    if (current === undefined || current.status !== 'pending') return state
    const settled: BtwEntry = {
      id: current.id,
      question: current.question,
      answer: event.data.kind === 'success' ? event.data.text ?? '' : '',
      status: event.data.kind === 'success' ? 'done' : 'error',
      time: current.time,
    }
    const next = [...state]
    next[index] = settled
    return next
  }
  return state
}

/** Drop the oldest entries beyond the cap. */
function capEntries(entries: readonly BtwEntry[], maxEntries: number): BtwHistoryState {
  return maxEntries <= 0 ? [] : entries.length > maxEntries ? entries.slice(entries.length - maxEntries) : entries
}

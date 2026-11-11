import { describe, expect, it } from 'vitest'
import { foldBtwHistory } from '../src/history.ts'
import type { BtwHistoryState } from '../src/types.ts'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'

/** Build a `command/run` event for the fold tests. */
function run(id: string, args: string, name = 'btw', time = 1000): SessionEvent {
  return {
    type: 'command/run',
    seq: 0,
    time,
    data: { commandId: id, name, args, source: { kind: 'user' } },
  } as unknown as SessionEvent
}

/** Build a `command/done` event for the fold tests. */
function done(id: string, kind: 'success' | 'error', text?: string, time = 1001): SessionEvent {
  return {
    type: 'command/done',
    seq: 1,
    time,
    data: { commandId: id, kind, ...text === undefined ? {} : { text } },
  } as unknown as SessionEvent
}

/** An unrelated event the fold must ignore. */
function other(): SessionEvent {
  return { type: 'turn/start', seq: 2, time: 2000, data: { turn: 1 } } as unknown as SessionEvent
}

describe('foldBtwHistory', () => {
  it('pairs a btw run with its success done', () => {
    let state: BtwHistoryState = []
    state = foldBtwHistory(state, run('c1', 'what files changed?'), 50)
    expect(state).toEqual([{ id: 'c1', question: 'what files changed?', answer: '', status: 'pending', time: 1000 }])
    state = foldBtwHistory(state, done('c1', 'success', 'three files'), 50)
    expect(state).toEqual([{
      id: 'c1', question: 'what files changed?', answer: 'three files', status: 'done', time: 1000,
    }])
  })

  it('marks a failed done as error without an answer', () => {
    let state = foldBtwHistory([], run('c1', 'q'), 50)
    state = foldBtwHistory(state, done('c1', 'error', 'boom'), 50)
    expect(state).toEqual([{ id: 'c1', question: 'q', answer: '', status: 'error', time: 1000 }])
  })

  it('ignores other commands, other events, and done without a pending btw run', () => {
    let state = foldBtwHistory([], run('c9', 'other question', 'compact'), 50)
    state = foldBtwHistory(state, other(), 50)
    state = foldBtwHistory(state, done('c-nobody', 'success', 'x'), 50)
    expect(state).toEqual([])
  })

  it('drops empty questions (bare /btw prints usage, never logs a run with empty args this way)', () => {
    const state = foldBtwHistory([], run('c1', '   '), 50)
    expect(state).toEqual([])
  })

  it('settles only pending entries and keeps others untouched', () => {
    let state = foldBtwHistory([], run('c1', 'q1'), 50)
    state = foldBtwHistory(state, run('c2', 'q2'), 50)
    state = foldBtwHistory(state, done('c1', 'success', 'a1'), 50)
    // A late duplicate done must not overwrite the settled entry.
    state = foldBtwHistory(state, done('c1', 'error'), 50)
    expect(state).toEqual([
      { id: 'c1', question: 'q1', answer: 'a1', status: 'done', time: 1000 },
      { id: 'c2', question: 'q2', answer: '', status: 'pending', time: 1000 },
    ])
  })

  it('caps the history at maxEntries, dropping the oldest', () => {
    let state: BtwHistoryState = []
    for (let i = 0; i < 5; i += 1) {
      state = foldBtwHistory(state, run(`c${i}`, `q${i}`), 3)
    }
    expect(state.map(entry => entry.id)).toEqual(['c2', 'c3', 'c4'])
  })
})

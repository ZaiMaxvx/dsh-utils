/**
 * Rewind plugin, host half: the `/rewind` human command.
 *
 * Rewinding restores a session's model-visible context to an earlier point by
 * appending one surface replacement that shadows every live surface node after
 * the chosen boundary (the compaction channel — the surface contract allows
 * any surface-replacing producer). The session log stays append-only and the
 * human transcript keeps the full history; the built-in fork ("branch")
 * remains the tool for hard isolation into a new session.
 *
 * Grammar:
 * - `/rewind` — print usage (the Web client replaces bare invocation with a
 *   picker contributed by this package's client half).
 * - `/rewind <n>` — undo the last `n` turns.
 * - `/rewind turn <k>` — undo everything from the k-th turn on.
 * - `/rewind to <seq>` — keep context through event `seq` (used by the
 *   turn-tail buttons).
 *
 * @module dsh-plugin-rewind
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import type { SessionEventSearchDocument } from '@deepseek-ai/dsh-session-query'
import type {} from '@deepseek-ai/dsh-session-query'
import { applyRewind } from './rewind.ts'
import type {} from './types.ts'

export const name = 'rewind'
export const inject = ['commands', 'sessionQuery']

/** Default model-visible marker text; `{count}` expands to the shadowed node count. */
export const DEFAULT_MARKER_TEXT =
  '[The user rewound this conversation. {count} later item(s) were removed from the model context; continue from the state above.]'

export interface Config {
  /**
   * Model-visible text of the replacement marker message. `{count}` expands
   * to the number of shadowed surface items.
   */
  markerText: string
  /** Upper bound accepted for `/rewind <n>`; larger requests are rejected. */
  maxUndoTurns: number
}

export const Config: z<Config> = z.object({
  markerText: z.string().default(DEFAULT_MARKER_TEXT),
  maxUndoTurns: z.number().step(1).min(1).default(20),
})

const USAGE = 'Usage: /rewind [<n> | turn <k> | to <seq>]'
  + ' — <n>: undo the last n turns;'
  + ' turn <k>: undo from the k-th turn on;'
  + ' to <seq>: keep context through event seq.'

type ParsedInput =
  | { kind: 'hint' }
  | { kind: 'undoTurns'; turns: number }
  | { kind: 'undoFromTurn'; turn: number }
  | { kind: 'keepThrough'; seq: number }
  | { kind: 'error'; text: string }

/** Parse the raw text after `/rewind`. */
export function parseRewindInput(raw: string): ParsedInput {
  const text = raw.trim()
  if (text === '') return { kind: 'hint' }
  const turns = /^(\d+)$/.exec(text)
  if (turns !== null) {
    const n = Number(turns[1])
    return n < 1 ? { kind: 'error', text: USAGE } : { kind: 'undoTurns', turns: n }
  }
  const keep = /^to\s+(-?\d+)$/.exec(text)
  if (keep !== null) {
    const seq = Number(keep[1])
    return seq < -1 ? { kind: 'error', text: 'seq must be >= -1.' } : { kind: 'keepThrough', seq }
  }
  const from = /^turn\s+(\d+)$/.exec(text)
  if (from !== null) {
    const k = Number(from[1])
    return k < 1 ? { kind: 'error', text: 'turn number must be >= 1.' } : { kind: 'undoFromTurn', turn: k }
  }
  return { kind: 'error', text: USAGE }
}

/** Resolve the k-th-from-last (or numbered) turn record to a keep-through boundary. */
function boundaryForTurns(
  records: readonly SessionEventSearchDocument[],
  request: { kind: 'undoTurns'; turns: number } | { kind: 'undoFromTurn'; turn: number },
): { kind: 'ok'; seq: number } | { kind: 'error'; text: string } {
  const target = request.kind === 'undoTurns'
    ? request.turns > records.length
      ? undefined
      : records[records.length - request.turns]
    : records[request.turn - 1]
  if (target === undefined) {
    const detail = request.kind === 'undoTurns'
      ? `This session has only ${records.length} turn(s) to undo.`
      : `Turn ${request.turn} does not exist (this session has ${records.length}).`
    return { kind: 'error', text: detail }
  }
  return { kind: 'ok', seq: target.seq - 1 }
}

/** Execute one `/rewind` invocation end to end. */
async function executeRewind(
  ctx: Context,
  config: Config,
  invocation: CommandInvocation,
): Promise<CommandResult> {
  const parsed = parseRewindInput(invocation.rawInput)
  if (parsed.kind === 'error') return { kind: 'error', text: parsed.text }
  if (parsed.kind === 'hint') return { kind: 'success', text: USAGE }

  const agent = invocation.agent
  let keepThroughSeq: number
  if (parsed.kind === 'keepThrough') {
    keepThroughSeq = parsed.seq
  } else {
    if (parsed.kind === 'undoTurns' && parsed.turns > config.maxUndoTurns) {
      return { kind: 'error', text: `At most ${config.maxUndoTurns} turns may be rewound at once (maxUndoTurns).` }
    }
    let records: readonly SessionEventSearchDocument[]
    try {
      records = await ctx.sessionQuery.filterEvents(
        agent.session.id,
        [{ kind: 'type', values: ['turn/start'] }],
      )
    } catch (error: unknown) {
      const detail = error instanceof Error ? error.message : String(error)
      return { kind: 'error', text: `Rewind could not read the session log: ${detail}` }
    }
    if (records.length === 0) return { kind: 'success', text: 'No turns to rewind yet.' }
    const boundary = boundaryForTurns(records, parsed)
    if (boundary.kind === 'error') return { kind: 'error', text: boundary.text }
    keepThroughSeq = boundary.seq
  }

  try {
    const outcome = await agent.runMaintenance(async agentSignal => {
      const signal = AbortSignal.any([agentSignal, invocation.signal])
      signal.throwIfAborted()
      return applyRewind(agent.session, keepThroughSeq, config.markerText)
    })
    if (outcome === null) {
      return { kind: 'success', text: 'Nothing to rewind — the context already ends at that point.' }
    }
    return {
      kind: 'success',
      text: `Rewound: ${outcome.maskedSeqs.length} item(s) left the model context (the transcript keeps them).`,
      sourceEventSeq: outcome.markerSeq,
    }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Rewind cancelled.' }
    if (error instanceof Error && error.message.includes('already has active work')) {
      return { kind: 'error', text: 'Rewind needs an idle agent; stop the current run and retry.' }
    }
    throw error
  }
}

/**
 * Register `/rewind` for every composed human-command adapter.
 * @param ctx - context carrying the command registry and the session query engine.
 * @param config - validated plugin configuration.
 */
export function apply(ctx: Context, config: Config): void {
  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeRewind(ctx, config, invocation)
    active.add(operation)
    const retire = (): void => { active.delete(operation) }
    void operation.then(retire, retire)
    return operation
  }

  ctx.effect(function* () {
    // Yield drain before registration: composite teardown is LIFO, so no new
    // invocation can enter while already-started handler promises quiesce.
    yield async () => { await Promise.allSettled(active) }
    yield ctx.commands.register({
      definitionId: CommandDefinitionId('dsh-plugin-rewind'),
      name: 'rewind',
      description: 'Rewind the conversation context to an earlier point',
      input: { hint: 'turns to undo, "turn <k>", or "to <seq>"' },
      handler,
    })
  }, 'rewind: /rewind command')
}

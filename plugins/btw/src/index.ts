/**
 * btw plugin, host half: the `/btw` side-question command and the
 * `btwHistory` session projection feeding the right-sidebar panel.
 *
 * `/btw <question>` asks one immediate, tool-free side question against the
 * session's current context (the compaction-style prefix-replay call reuses
 * the provider's warm cache). The exchange never enters the model-visible
 * surface: the answer returns as the command result (the generic command card
 * renders it) and lands in the projection the panel reads. Bare `/btw` opens
 * the panel (the client half decorates the bare invocation).
 *
 * @module dsh-plugin-btw
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { CommandDefinitionId } from '@deepseek-ai/dsh-commands/brand'
import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'
import { z as zod } from 'zod'
import { askSideQuestion, DEFAULT_INSTRUCTION } from './sideask.ts'
import { foldBtwHistory } from './history.ts'
import type { BtwHistoryState } from './types.ts'
import type {} from './types.ts'

export const name = 'btw'
export const inject = ['commands', 'sessionProjections', 'llm']

export interface Config {
  /** Instruction framing every side question (prepended before the question). */
  instruction: string
  /** Output token cap for one side answer. */
  maxTokens: number
  /** Panel history cap; the oldest entries drop off beyond it. */
  maxEntries: number
  /** Optional provider/model override for side questions; empty follows the session's route. */
  provider: string
  model: string
}

export const Config: z<Config> = z.object({
  instruction: z.string().default(DEFAULT_INSTRUCTION),
  maxTokens: z.number().step(1).min(1).default(1024),
  maxEntries: z.number().step(1).min(1).default(50),
  provider: z.string().default(''),
  model: z.string().default(''),
})

const USAGE = 'Usage: /btw <question> — ask a side question answered from the current context without touching the main conversation.'

const btwHistorySchema = zod.array(zod.object({
  id: zod.string(),
  question: zod.string(),
  answer: zod.string(),
  status: zod.enum(['pending', 'done', 'error']),
  time: zod.number(),
}))

/** Execute one `/btw` invocation: ask, settle, report. */
async function executeBtw(ctx: Context, config: Config, invocation: CommandInvocation): Promise<CommandResult> {
  const question = invocation.rawInput.trim()
  if (question.length === 0) return { kind: 'error', text: USAGE }
  try {
    const result = await askSideQuestion(ctx, invocation.agent, question, {
      instruction: config.instruction,
      maxTokens: config.maxTokens,
      ...config.provider.length > 0 && config.model.length > 0
        ? { target: { provider: config.provider, model: config.model } }
        : {},
    }, invocation.signal)
    return { kind: 'success', text: result.text }
  } catch (error: unknown) {
    if (invocation.signal.aborted) return { kind: 'error', text: 'Side question cancelled.' }
    const detail = error instanceof Error ? error.message : String(error)
    return { kind: 'error', text: `Side question failed: ${detail}` }
  }
}

/**
 * Register `/btw` and the `btwHistory` projection.
 * @param ctx - context carrying the command registry, the projection registry, and the LLM service.
 * @param config - validated plugin configuration.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  await ctx.sessionProjections.register<'btwHistory', BtwHistoryState>({
    key: 'btwHistory',
    stateVersion: 1,
    stateSchema: btwHistorySchema,
    init: () => [],
    apply: (state, event) => foldBtwHistory(state, event, config.maxEntries),
    wire: {
      viewSchema: btwHistorySchema,
      view: state => state,
    },
  })

  const active = new Set<Promise<CommandResult>>()
  const handler = (invocation: CommandInvocation): Promise<CommandResult> => {
    const operation = executeBtw(ctx, config, invocation)
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
      definitionId: CommandDefinitionId('dsh-plugin-btw'),
      name: 'btw',
      description: 'Ask a side question answered from the current context, without touching the main conversation',
      input: { hint: 'side question' },
      handler,
    })
  }, 'btw: /btw command')
}

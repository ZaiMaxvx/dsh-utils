/**
 * The side-question one-shot model call — dsh's /btw mechanism.
 *
 * Mirrors compaction's cache-friendly shape (`summarizeWithLlm`): replay the
 * session's derived history (whose leading system message is the loop's own
 * prompt, so the provider's warm prefix cache is reused), then append the
 * side question as the final user message. No tools, no tool history, no
 * session writes — the answer lives in the command result and the panel's
 * projection, never in the model-visible surface.
 *
 * @module dsh-plugin-btw/sideask
 */

import { BlockAssembler, LlmError, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FinishReason, Message, RequestMessage } from '@deepseek-ai/dsh-llm'
import type {} from './types.ts'

/** Default instruction framing every side question. */
export const DEFAULT_INSTRUCTION =
  'Answer the user\'s side question briefly and directly, using only the conversation context above. '
  + 'This is a side channel: the answer never enters the main conversation, so do not propose actions or continue the main task.'

/** Which provider/model answers side questions. */
export interface BtwTarget {
  readonly provider: string
  readonly model: string
}

/** Resolve the side-question target: config override, else the session's last request, else the agent fallback. */
export function resolveTarget(agent: Agent, override?: BtwTarget): BtwTarget | undefined {
  if (override !== undefined && override.provider.length > 0 && override.model.length > 0) {
    return override
  }
  const latest = agent.session.requestHeader()?.config
  if (latest !== undefined && latest.provider.length > 0 && latest.model.length > 0) {
    return { provider: latest.provider, model: latest.model }
  }
  const provider = agent.options.provider ?? ''
  const model = agent.options.model ?? ''
  if (provider.length > 0 && model.length > 0) {
    return { provider, model }
  }
  return undefined
}

/** Build the one-shot request messages: derived history + the framed question. */
export function buildBtwMessages(history: readonly Message[], question: string, instruction: string): RequestMessage[] {
  return [
    ...history,
    createUserMessage({
      content: [{ type: 'text', text: `${instruction}\n\n<side_question>\n${question}\n</side_question>` }],
      source: { kind: 'user' },
    }),
  ]
}

/** Map a terminal finish to its fail-closed error (compaction's discipline). */
function finishError(finish: FinishReason): Error | undefined {
  switch (finish.kind) {
    case 'error':
    case 'aborted':
      return LlmError.fromFailure(finish.failure)
    case 'max-tokens':
      return new Error('the side answer was truncated at the token cap')
    default:
      return undefined
  }
}

/** One settled side-question call. */
export interface SideAskResult {
  readonly text: string
  readonly provider: string
  readonly model: string
}

/**
 * Ask one side question against the session's current context.
 * @param ctx - context providing the LLM service.
 * @param agent - owning agent (history snapshot, routed-model fallback, session id).
 * @param question - the question exactly as typed after `/btw`.
 * @param options - instruction text, token cap, and optional target override.
 * @param signal - cancellation for the streamed call.
 * @returns the assembled text answer and the route that produced it.
 * @throws when no provider/model is resolvable, the stream fails, or no text
 * content is produced.
 */
export async function askSideQuestion(
  ctx: Context,
  agent: Agent,
  question: string,
  options: { instruction: string; maxTokens: number; target?: BtwTarget },
  signal?: AbortSignal,
): Promise<SideAskResult> {
  const target = resolveTarget(agent, options.target)
  if (target === undefined) {
    throw new Error('no provider/model available for a side question: route one request first, or set the btw plugin provider/model config')
  }
  const messages = buildBtwMessages(agent.session.deriveMessages(), question, options.instruction)
  const assembler = new BlockAssembler()
  for await (const chunk of ctx.llm.stream({
    provider: target.provider,
    model: target.model,
    messages,
    maxTokens: options.maxTokens,
    sessionId: agent.session.id,
    purpose: 'btw',
    ...signal === undefined ? {} : { signal },
  })) {
    assembler.push(chunk)
  }
  const error = finishError(assembler.finish)
  if (error !== undefined) throw error
  const text = assembler.blocks()
    .flatMap(block => block.type === 'text' ? [block.text] : [])
    .join('')
  if (text.trim().length === 0) throw new Error('the side answer produced no text content')
  return { text, provider: target.provider, model: target.model }
}

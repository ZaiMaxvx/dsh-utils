/**
 * The rewind marker's chat node definition: one finalized, session-anchored
 * row per rewind. The marker is a replacement (non-append) user/message, so
 * the built-in message definition never claims it — without this definition
 * a rewind would leave no visible trace in the transcript.
 *
 * @module dsh-plugin-rewind/client/rewindMarkerDefinition
 */

import type {
  ConversationLocation,
  ConversationNodeDefinition,
  SessionEventLike,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '../types.ts'

/** Immutable chat-node payload for one rewind marker row. */
export interface RewindMarkerData {
  /** Seq of the marker event; doubles as the row's anchor. */
  readonly seq: number
  /** Unix epoch ms of the rewind. */
  readonly time: number
  /** How many surface items this rewind removed from the model context. */
  readonly maskedCount: number
  /** The keep-through boundary the rewind was planned with. */
  readonly keepThroughSeq: number
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    'rewind-marker': RewindMarkerData
  }
}

/** Narrow one event to this plugin's rewind message source. */
function rewindSourceOf(event: SessionEventLike): { maskedCount: number; keepThroughSeq: number } | undefined {
  if (event.type !== 'user/message') return undefined
  const source: unknown = event.data.source
  if (typeof source !== 'object' || source === null) return undefined
  const kind = (source as { kind?: unknown }).kind
  if (kind !== 'rewind') return undefined
  const { maskedCount, keepThroughSeq } = source as { maskedCount: unknown; keepThroughSeq: unknown }
  if (typeof maskedCount !== 'number' || typeof keepThroughSeq !== 'number') return undefined
  return { maskedCount, keepThroughSeq }
}

/** The rewind marker state machine over the stock user/message events. */
export const rewindMarkerDefinition: ConversationNodeDefinition<RewindMarkerData> = {
  kind: 'rewind-marker',
  target: 'chat',
  exclusive: true,
  match: event => rewindSourceOf(event) !== undefined
    ? { id: String(event.seq), role: 'start' }
    : null,
  start: (_context, match) => {
    const event = match.event
    const source = rewindSourceOf(event)
    if (event.type !== 'user/message' || source === undefined) {
      throw new Error('rewind-marker start requires a user/message with a rewind source')
    }
    return {
      seq: event.seq,
      time: event.time,
      maskedCount: source.maskedCount,
      keepThroughSeq: source.keepThroughSeq,
    }
  },
  update: context => context.state,
  buildViewNode: context => {
    if (context.state === undefined) return null
    const start = context.start
    if (start === undefined) return null
    const anchor = start.event.seq
    const location: ConversationLocation = start.location
    return {
      key: context.key,
      kind: 'rewind-marker',
      id: context.id,
      target: 'chat',
      anchorSeq: anchor,
      location,
      visibility: 'visible',
      data: context.state,
    }
  },
}

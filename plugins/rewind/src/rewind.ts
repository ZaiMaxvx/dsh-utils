/**
 * Rewind commit: apply one planned rewind to a live Session as an append-only
 * surface replacement — the same `surfaceOp: { op: 'replace' }` channel
 * compaction uses (the type contract allows any surface-replacing producer).
 *
 * The append-only log keeps every event, so the human transcript still shows
 * the rewound-over exchange; only the model-visible history (the folded
 * surface / `deriveMessages()`) rolls back to the chosen point.
 *
 * @module dsh-plugin-rewind/rewind
 */

import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { planRewind } from './planner.ts'
import type {} from './types.ts'

/** One committed rewind. */
export interface RewindOutcome {
  /** Live surface node seqs this rewind shadowed, in surface order. */
  readonly maskedSeqs: readonly SessionSeq[]
  /** Seq of the replacement marker event that now closes the surface. */
  readonly markerSeq: SessionSeq
}

/** Render the marker text for one rewind; `{count}` expands to the shadowed count. */
export function renderMarker(template: string, maskedCount: number): string {
  return template.replaceAll('{count}', String(maskedCount))
}

/**
 * Append one rewind to a live session.
 *
 * Must run in a phase where nothing else appends (inside
 * `agent.runMaintenance`, which excludes turns and other maintenance tasks),
 * so the planned cut cannot race a concurrent surface change.
 *
 * @param session - the live session whose context is rewound.
 * @param keepThroughSeq - keep live surface nodes with `seq <= keepThroughSeq`.
 * @param markerTemplate - model-visible marker text; `{count}` expands to the
 * number of shadowed surface items.
 * @returns the outcome, or `null` when nothing live sits after the boundary.
 * @throws when the session rejects the replacement (surface contract).
 */
export function applyRewind(
  session: Session,
  keepThroughSeq: number,
  markerTemplate: string,
): RewindOutcome | null {
  const plan = planRewind(session.surface.nodes, keepThroughSeq)
  if (plan === null) return null
  const { maskedSeqs } = plan
  // planRewind only returns non-empty slices; the guard keeps the reads below
  // total for the type checker rather than defending a real state.
  if (maskedSeqs.length === 0) return null
  const first: SessionSeq = maskedSeqs[0] as SessionSeq
  const last: SessionSeq = maskedSeqs[maskedSeqs.length - 1] as SessionSeq
  const marker = createUserMessage({
    content: [{ type: 'text', text: renderMarker(markerTemplate, maskedSeqs.length) }],
    source: { kind: 'rewind', maskedCount: maskedSeqs.length, keepThroughSeq },
  })
  // The planner speaks plain numbers; the append surface cites branded seqs.
  const sourceSeqs: SessionSeq[] = maskedSeqs.map(seq => seq as SessionSeq)
  const event = session.append('user/message', marker, {
    surfaceOp: { op: 'replace', startSeq: first, endSeq: last },
    sourceEventSeqs: sourceSeqs,
  })
  return { maskedSeqs: sourceSeqs, markerSeq: event.seq }
}

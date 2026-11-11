/**
 * Pure rewind boundary planning over a session surface's live node seqs.
 *
 * Rewind keeps every live surface node whose seq is `<= keepThroughSeq` and
 * shadows the rest behind one replacement marker event (the same surface
 * mechanism compaction uses). This module holds only that arithmetic — zero
 * runtime imports — so the boundary rules are testable anywhere.
 *
 * @module dsh-plugin-rewind/planner
 */

/** A planned rewind: where the surface is cut, and what gets shadowed. */
export interface RewindPlan {
  /** Index of the first shadowed node within the current surface. */
  readonly cutIndex: number
  /** Live surface node seqs that the rewind masks, in surface order. */
  readonly maskedSeqs: readonly number[]
}

/**
 * Plan one rewind against a snapshot of the live surface nodes.
 *
 * The surface head (node 0) is never shadowed: it carries the system prompt,
 * which the agent loop reconciles in place and whose replacement is reserved
 * for single-node system rewrites. A rewind that would cut at index 0 keeps
 * the head instead.
 *
 * @param nodes - live surface node seqs in model-visible order (ascending
 * by construction of the surface fold).
 * @param keepThroughSeq - keep live nodes with `seq <= keepThroughSeq`;
 * `-1` rewinds everything the surface allows.
 * @returns the plan, or `null` when nothing live sits after the boundary.
 */
export function planRewind(nodes: readonly number[], keepThroughSeq: number): RewindPlan | null {
  let cutIndex = nodes.findIndex(seq => seq > keepThroughSeq)
  if (cutIndex === -1) return null
  // Never shadow the surface head; a rewind that reaches past everything
  // keeps the system prompt and cuts at the first node after it instead.
  if (cutIndex === 0) cutIndex = 1
  if (cutIndex >= nodes.length) return null
  return { cutIndex, maskedSeqs: nodes.slice(cutIndex) }
}

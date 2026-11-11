import { describe, expect, it } from 'vitest'
import { planRewind } from '../src/planner.ts'

describe('planRewind', () => {
  it('returns null when nothing live sits after the boundary', () => {
    expect(planRewind([0, 1, 2], 2)).toBe(null)
    expect(planRewind([0, 1, 2], 99)).toBe(null)
    expect(planRewind([], -1)).toBe(null)
  })

  it('masks every node after the boundary', () => {
    expect(planRewind([0, 1, 2, 3, 4], 1)).toEqual({ cutIndex: 2, maskedSeqs: [2, 3, 4] })
  })

  it('masks a single trailing node', () => {
    expect(planRewind([0, 1, 2, 3], 2)).toEqual({ cutIndex: 3, maskedSeqs: [3] })
  })

  it('rewinds everything but keeps the surface head when the cut lands on node 0', () => {
    expect(planRewind([0, 1, 2], -1)).toEqual({ cutIndex: 1, maskedSeqs: [1, 2] })
    expect(planRewind([5, 6, 7], 0)).toEqual({ cutIndex: 1, maskedSeqs: [6, 7] })
  })

  it('returns null when only the head exists past the cut', () => {
    expect(planRewind([0], -1)).toBe(null)
    expect(planRewind([0, 1], -1)).toEqual({ cutIndex: 1, maskedSeqs: [1] })
  })

  it('treats a log-only boundary seq (no live node at it) as keep-through', () => {
    // keepThroughSeq 4 is shadowed/log-only; live nodes 5+ are still masked.
    expect(planRewind([0, 2, 5, 6], 4)).toEqual({ cutIndex: 2, maskedSeqs: [5, 6] })
  })

  it('plans against a compaction-shaped surface with gaps', () => {
    // After a compaction replaced [1..3] with node 4, live nodes are sparse.
    expect(planRewind([0, 4, 7, 9], 4)).toEqual({ cutIndex: 2, maskedSeqs: [7, 9] })
  })
})

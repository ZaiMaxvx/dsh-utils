import { describe, expect, it } from 'vitest'
import { btwRows, btwCommandLine, submittable } from '../src/client/view.ts'
import type { BtwEntry } from '../src/types.ts'

const entries: readonly BtwEntry[] = [
  { id: 'a', question: 'first', answer: 'one', status: 'done', time: 1 },
  { id: 'b', question: 'second', answer: '', status: 'pending', time: 2 },
  { id: 'c', question: 'third', answer: '', status: 'error', time: 3 },
]

describe('btwRows', () => {
  it('returns newest first with status flags', () => {
    const rows = btwRows(entries)
    expect(rows.map(row => row.entry.id)).toEqual(['c', 'b', 'a'])
    expect(rows.map(row => [row.pending, row.failed])).toEqual([
      [false, true],
      [true, false],
      [false, false],
    ])
  })

  it('treats an absent projection as empty', () => {
    expect(btwRows(undefined)).toEqual([])
    expect(btwRows([])).toEqual([])
  })
})

describe('submittable / btwCommandLine', () => {
  it('requires non-blank drafts', () => {
    expect(submittable('')).toBe(false)
    expect(submittable('   ')).toBe(false)
    expect(submittable(' why? ')).toBe(true)
  })

  it('builds a trimmed /btw command line', () => {
    expect(btwCommandLine('  why? ')).toBe('/btw why?')
  })
})

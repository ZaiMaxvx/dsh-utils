import { describe, expect, it } from 'vitest'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { applyRewind, renderMarker } from '../src/rewind.ts'
import type {} from '../src/types.ts'

/**
 * Drives the rewind commit against a real, detached `Session`: the appends,
 * the surface fold, and the replacement validation are the shipping code —
 * only the surrounding turn structure is scripted by hand.
 */

/** Append one human prompt to the surface and return its seq. */
function prompt(session: Session, text: string): number {
  const event = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return event.seq
}

function buildSession(): Session {
  const session = Session.create(SessionId('rewind-spec'))
  session.append('turn/start', { turn: 1 })
  prompt(session, 'first question')
  prompt(session, 'second question')
  session.append('turn/end', { reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  prompt(session, 'third question')
  session.append('turn/end', { reason: { kind: 'completed' } })
  return session
}

describe('applyRewind', () => {
  it('shadows the tail behind one rewind marker and keeps the log append-only', () => {
    const session = buildSession()
    // Log: 0 turn/start, 1 user1, 2 user2, 3 turn/end, 4 turn/start,
    // 5 user3, 6 turn/end — live surface nodes are the user messages.
    expect([...session.surface.nodes]).toEqual([1, 2, 5])

    const outcome = applyRewind(session, 1, '[rewound {count}]')

    expect(outcome).not.toBe(null)
    // The marker (seq 7) replaces [2..5]: user2 and user3 leave the context.
    expect(outcome!.maskedSeqs).toEqual([2, 5])
    expect(outcome!.markerSeq).toBe(7)
    expect([...session.surface.nodes]).toEqual([1, 7])
    expect(session.surface.replaceGeneration).toBe(1)
    // The log still holds every original event.
    expect(session.seq).toBe(8)

    const messages = session.deriveMessages()
    expect(messages).toHaveLength(2)
    const marker = messages[1]!
    expect(marker.role).toBe('user')
    expect(marker.source.kind).toBe('rewind')
    if (marker.source.kind === 'rewind') {
      expect(marker.source.maskedCount).toBe(2)
      expect(marker.source.keepThroughSeq).toBe(1)
    }
    expect('text' in marker.content[0]! ? marker.content[0]!.text : '').toBe('[rewound 2]')
  })

  it('cites every shadowed node in the marker event', () => {
    const session = buildSession()
    const outcome = applyRewind(session, 4, '[rewound {count}]')
    const markerEvent = session.snapshotEvents(outcome!.markerSeq, outcome!.markerSeq + 1)[0]!
    expect(markerEvent.type).toBe('user/message')
    expect(markerEvent.sourceEventSeqs).toEqual([...outcome!.maskedSeqs])
    expect(markerEvent.surfaceOp).toEqual({ op: 'replace', startSeq: 5, endSeq: 5 })
  })

  it('rewinds to before everything but keeps the surface head', () => {
    // In real sessions node 0 is the system prompt; this synthetic session
    // keeps its first user message instead.
    const session = buildSession()
    const outcome = applyRewind(session, -1, '[rewound {count}]')
    expect(outcome!.maskedSeqs).toEqual([2, 5])
    expect([...session.surface.nodes]).toEqual([1, 7])
  })

  it('returns null when the context already ends at the boundary', () => {
    const session = buildSession()
    expect(applyRewind(session, 99, '[rewound {count}]')).toBe(null)
    expect(session.surface.replaceGeneration).toBe(0)
  })

  it('stacks a second rewind on the first generation', () => {
    const session = buildSession()
    applyRewind(session, 4, '[rewound {count}]')
    // Surface is [1, 2, 7]; rewind to before user2 masks [2, 7].
    const second = applyRewind(session, 1, '[rewound {count}]')
    expect(second!.maskedSeqs).toEqual([2, 7])
    expect([...session.surface.nodes]).toEqual([1, 8])
    expect(session.surface.replaceGeneration).toBe(2)
  })
})

describe('renderMarker', () => {
  it('expands {count}', () => {
    expect(renderMarker('[rewound {count}]', 3)).toBe('[rewound 3]')
    expect(renderMarker('no placeholder', 3)).toBe('no placeholder')
  })
})

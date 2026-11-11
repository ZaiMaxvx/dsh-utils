/**
 * Local smoke test (no vitest, no install): runs the rewind commit against a
 * real, detached dsh Session loaded straight from the dsh source tree via the
 * resolver hook. Mirrors tests/rewind-session.spec.ts.
 *
 *   node --import ./scripts/register-hooks.mjs scripts/smoke.session.mjs
 */
import assert from 'node:assert/strict'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { applyRewind, renderMarker } from '../src/rewind.ts'

function prompt(session, text) {
  const event = session.append('user/message', createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }), { surfaceOp: 'append' })
  return event.seq
}

function buildSession() {
  const session = Session.create(SessionId('rewind-smoke'))
  session.append('turn/start', { turn: 1 })
  prompt(session, 'first question')
  prompt(session, 'second question')
  session.append('turn/end', { reason: { kind: 'completed' } })
  session.append('turn/start', { turn: 2 })
  prompt(session, 'third question')
  session.append('turn/end', { reason: { kind: 'completed' } })
  return session
}

// 1. Tail rewind behind one marker.
{
  const session = buildSession()
  assert.deepEqual([...session.surface.nodes], [1, 2, 5])
  const outcome = applyRewind(session, 1, '[rewound {count}]')
  assert.ok(outcome !== null)
  assert.deepEqual([...outcome.maskedSeqs], [2, 5])
  assert.equal(outcome.markerSeq, 7)
  assert.deepEqual([...session.surface.nodes], [1, 7])
  assert.equal(session.surface.replaceGeneration, 1)
  assert.equal(session.seq, 8)
  const messages = session.deriveMessages()
  assert.equal(messages.length, 2)
  const marker = messages[1]
  assert.equal(marker.role, 'user')
  assert.equal(marker.source.kind, 'rewind')
  assert.equal(marker.source.maskedCount, 2)
  assert.equal(marker.source.keepThroughSeq, 1)
  assert.equal(marker.content[0].text, '[rewound 2]')
  console.log('ok 1 - tail rewind behind one marker')
}

// 2. Cited source seqs + surfaceOp span.
{
  const session = buildSession()
  const outcome = applyRewind(session, 4, '[rewound {count}]')
  const markerEvent = session.snapshotEvents(outcome.markerSeq, outcome.markerSeq + 1)[0]
  assert.equal(markerEvent.type, 'user/message')
  assert.deepEqual(markerEvent.sourceEventSeqs, [...outcome.maskedSeqs])
  assert.deepEqual(markerEvent.surfaceOp, { op: 'replace', startSeq: 5, endSeq: 5 })
  console.log('ok 2 - source seqs and replacement span')
}

// 3. Rewind to before everything keeps the surface head (in real sessions
//    node 0 is the system prompt; this synthetic session keeps user1).
{
  const session = buildSession()
  const outcome = applyRewind(session, -1, '[rewound {count}]')
  assert.deepEqual([...outcome.maskedSeqs], [2, 5])
  assert.deepEqual([...session.surface.nodes], [1, 7])
  console.log('ok 3 - rewind-all keeps the surface head')
}

// 4. Nothing to do at the boundary.
{
  const session = buildSession()
  assert.equal(applyRewind(session, 99, '[rewound {count}]'), null)
  assert.equal(session.surface.replaceGeneration, 0)
  console.log('ok 4 - null at boundary')
}

// 5. Stacked generations.
{
  const session = buildSession()
  applyRewind(session, 4, '[rewound {count}]')
  const second = applyRewind(session, 1, '[rewound {count}]')
  assert.deepEqual([...second.maskedSeqs], [2, 7])
  assert.deepEqual([...session.surface.nodes], [1, 8])
  assert.equal(session.surface.replaceGeneration, 2)
  console.log('ok 5 - stacked generations')
}

// 6. Marker rendering.
assert.equal(renderMarker('[rewound {count}]', 3), '[rewound 3]')
assert.equal(renderMarker('no placeholder', 3), 'no placeholder')
console.log('ok 6 - marker template')
console.log('smoke: all assertions passed')

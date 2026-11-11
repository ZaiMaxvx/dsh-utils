/**
 * Local smoke for the side-question pure core (no vitest): target resolution
 * and request assembly against the real dsh message constructors, loaded from
 * the dsh source tree via the resolver hook. Mirrors tests/sideask.spec.ts.
 *
 *   node --import ./scripts/register-hooks.mjs --import tsx scripts/smoke.sideask.mjs
 */
import assert from 'node:assert/strict'
import { buildBtwMessages, resolveTarget } from '../src/sideask.ts'
import { createUserMessage, createSystemMessage } from '@deepseek-ai/dsh-llm'

function agentWith(header, options = { provider: '', model: '' }) {
  return {
    options,
    session: {
      requestHeader: () => header === undefined ? undefined : { config: header },
    },
  }
}

// 1. Target resolution chain.
assert.deepEqual(
  resolveTarget(agentWith({ provider: 'deepseek', model: 'chat' }), { provider: 'other', model: 'fast' }),
  { provider: 'other', model: 'fast' },
)
assert.deepEqual(
  resolveTarget(agentWith({ provider: 'deepseek', model: 'chat' })),
  { provider: 'deepseek', model: 'chat' },
)
assert.deepEqual(
  resolveTarget(agentWith(undefined, { provider: 'fallback', model: 'small' })),
  { provider: 'fallback', model: 'small' },
)
assert.equal(resolveTarget(agentWith()), undefined)
assert.deepEqual(
  resolveTarget(agentWith({ provider: 'deepseek', model: 'chat' }), { provider: 'x', model: '' }),
  { provider: 'deepseek', model: 'chat' },
)
console.log('ok 1 - target resolution chain')

// 2. Request assembly: history replayed, framed question appended last.
const history = [
  createSystemMessage('you are an agent'),
  createUserMessage({ content: [{ type: 'text', text: 'do the thing' }], source: { kind: 'user' } }),
]
const messages = buildBtwMessages(history, 'what did you do?', 'INSTRUCTION')
assert.equal(messages.length, 3)
assert.deepEqual(messages.slice(0, 2), history)
assert.equal(messages[2].role, 'user')
assert.deepEqual(messages[2].content, [{
  type: 'text',
  text: 'INSTRUCTION\n\n<side_question>\nwhat did you do?\n</side_question>',
}])
console.log('ok 2 - request assembly')
console.log('smoke: all assertions passed')

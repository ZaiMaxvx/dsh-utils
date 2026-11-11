/**
 * Rewind plugin, browser half: the `/rewind` bare-invocation picker and the
 * turn-tail rewind buttons. Every action resolves to a `/rewind …` line
 * submitted through the session's command channel, so the host command stays
 * the single execution path (and the Web, SDK, and no-UI surfaces behave
 * identically).
 *
 * @module dsh-plugin-rewind/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the client ctx.sessions merge (ClientSessions + binding).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ui-conversation SlotMap base.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the chat SlotMap entries (conversation.chat.turnTail).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the standard session/global hook kit.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi).
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { TurnTailRewind } from './TurnTailRewind.tsx'
import type { TurnTailRewindInjected } from './TurnTailRewind.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'rewind'

/** Required services: the slot registry, the client sessions, the copy, and the command UI. */
export const inject = ['slots', 'sessions', 'locale', 'commandUi']

/** Offered undo depths in the bare-`/rewind` picker. */
const PICKER_TURNS = [1, 2, 3, 4, 5] as const

/** Submit one command line through the session's command channel. */
function submitLine(ctx: ClientContext, sessionId: SessionId, line: string): void {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return
  void binding.session.command(line)
}

/**
 * Client plugin body: the dictionaries, the bare-`/rewind` picker, and the
 * per-turn rewind actions.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'rewind: dictionaries')

  // Bare /rewind becomes a picker: undo the last N turns.
  ctx.effect(() => ctx.commandUi.decorate({
    name: 'rewind',
    available: () => true,
    ui: {
      kind: 'popupSelect',
      options: async () => {
        const t = ctx.locale.bind(NS)
        return PICKER_TURNS.map(n => ({
          id: String(n),
          label: t(n === 1 ? 'picker.undo1' : 'picker.undoN', { n }),
          detail: t('picker.hint'),
        }))
      },
      onSelect: (option, target) => { submitLine(ctx, target.sessionId, `/rewind ${option.id}`) },
    },
  }), 'rewind: /rewind picker')

  // Completed-turn rewind actions.
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    id: 'rewind',
    order: 5,
    locale: NS,
    inject: (sessionId): TurnTailRewindInjected => ({
      submit: line => { submitLine(ctx, sessionId, line) },
    }),
  }, TurnTailRewind))
}

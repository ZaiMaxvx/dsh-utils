/**
 * Rewind plugin, browser half: the per-message rewind action (in the copy /
 * branch icon strip), the bare-`/rewind` undo picker, the localized `/rewind`
 * command card, and the persistent rewind marker row — the visible trace a
 * rewind leaves in the transcript (the marker is a replacement message the
 * built-in chat definitions never render).
 *
 * @module dsh-plugin-rewind/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the client ctx.sessions merge (binding + session.command).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the SlotRegistry service merge (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the uiConversation events service (marker definition).
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the chat slot map (assistant-actions / commandview /
// conversation.chat.node) and the session standard kit incl. useChat.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the standard session/global hook kit.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi).
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { RewindAssistantAction } from './RewindAssistantAction.tsx'
import type { RewindAssistantActionInjected } from './RewindAssistantAction.tsx'
import { RewindMarkerNode } from './RewindMarkerNode.tsx'
import { rewindMarkerDefinition } from './rewindMarkerDefinition.ts'
import { RewindCommandCard } from './RewindCommandCard.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'rewind'

/** Required services: slots, the conversation event registry, sessions, copy, command UI. */
export const inject = ['slots', 'uiConversation', 'sessions', 'locale', 'commandUi']

/** Offered undo depths in the bare-`/rewind` picker. */
const PICKER_TURNS = [1, 2, 3, 4, 5] as const

/** Submit one command line through the session's command channel. */
function submitLine(ctx: ClientContext, sessionId: SessionId, line: string): void {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return
  void binding.session.command(line)
}

/**
 * Client plugin body: dictionaries, the picker, the message action, the
 * command card, and the marker row.
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

  // The per-message rewind action: clock icon between copy and branch.
  ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
    name: 'conversation.chat.assistant-actions',
    id: 'rewind',
    order: 5,
    locale: NS,
    inject: (sessionId): RewindAssistantActionInjected => ({
      submit: line => { submitLine(ctx, sessionId, line) },
    }),
  }, RewindAssistantAction))

  // The localized /rewind command row.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'rewind',
    locale: NS,
  }, RewindCommandCard))

  // The visible rewind marker: definition claims the replacement message the
  // built-in definitions skip; the keyed renderer draws the accent row.
  ctx.uiConversation.events.register(rewindMarkerDefinition)
  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node',
    key: 'rewind-marker',
    locale: NS,
  }, RewindMarkerNode))
}

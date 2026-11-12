/**
 * btw plugin, browser half: the right-sidebar BTW tab (side-question history
 * + inline ask box) and the bare-`/btw` decoration that opens it. Questions
 * submitted here go through the session's command channel, so the host
 * command stays the single execution path.
 *
 * @module dsh-plugin-btw/client
 */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: pulls the client ctx.sessions merge (binding + session.command).
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
// Type-only: pulls the ctx.slots / ctx.sidebarRight / ctx.sidebarRightTabs merges.
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls the standard session/global hook kit (useProjection).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls the chat slot map (conversation.chat.commandview keyed entry).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the command UI's Context merge (ctx.commandUi).
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { BtwTab } from './BtwTab.tsx'
import type { BtwTabInjected } from './BtwTab.tsx'
import { BtwCommandCard } from './BtwCommandCard.tsx'
import { en, zh } from './locales.ts'

/** Dictionary namespace owned by this plugin. */
const NS = 'btw'

/** Sidebar tab identity: the registry id doubles as the pane slot key. */
const TAB_ID = 'dsh-plugin-btw'
const TAB_KIND = 'btw'

/** Required services: slots, the sidebar tab registry/controller, sessions, copy, command UI. */
export const inject = ['slots', 'sidebarRightTabs', 'sidebarRight', 'sessions', 'locale', 'commandUi']

/** Submit one command line through the session's command channel. */
function submitLine(ctx: ClientContext, sessionId: SessionId, line: string): void {
  const binding = ctx.sessions.binding(sessionId)
  if (binding === undefined) return
  void binding.session.command(line)
}

/**
 * Client plugin body: the dictionaries, the sidebar tab (registry entry +
 * pane body), and the bare-`/btw` decoration.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'btw: dictionaries')
  const t = ctx.locale.bind(NS)

  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: TAB_ID,
    kind: TAB_KIND,
    title: () => t('tab.title'),
    guide: [{
      id: 'btw',
      order: 20,
      title: () => t('guide.title'),
      description: () => t('guide.description'),
    }],
  }), 'btw: sidebar tab')

  ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register({
    name: 'sidebar.right.pane.tab',
    key: TAB_ID,
    locale: NS,
    inject: (sessionId): BtwTabInjected => ({
      submit: line => { submitLine(ctx, sessionId, line) },
    }),
  }, BtwTab))

  // The /btw command row: markdown-rendered side answers.
  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: 'btw',
    locale: NS,
  }, BtwCommandCard))

  // Bare /btw opens the panel; an argued /btw line never passes through here.
  // openTab throws when no session surface is mounted — swallow that case.
  ctx.effect(() => ctx.commandUi.decorate({
    name: 'btw',
    available: () => true,
    ui: {
      kind: 'action',
      run: () => { try { ctx.sidebarRight.openTab(TAB_KIND) } catch { /* no session surface */ } },
    },
  }), 'btw: /btw opens the panel')
}

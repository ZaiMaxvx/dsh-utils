/**
 * The /btw command card: the side question with its answer rendered as
 * markdown, replacing the generic command row's plain preformatted text.
 *
 * @module dsh-plugin-btw/client/BtwCommandCard
 */

import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat slot map (commandview keyed entry).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from './locales.ts'
import css from './BtwCommandCard.module.css'

/** Full props of the /btw command row. */
export type BtwCommandCardProps =
  PropsRuntime<'conversation.chat.commandview', 'btw'>
  & PropsLocale<'btw'>

/** One /btw command row: question + markdown answer. */
export function BtwCommandCard({ node, t }: BtwCommandCardProps) {
  const outcome = node.outcome
  return (
    <div className={css.card}>
      <div className={css.question}>{node.args ?? t('cmd.untitled')}</div>
      {outcome === null
        ? <p className={css.pending}>{t('cmd.pending')}</p>
        : outcome.kind === 'error'
          ? <p className={css.error}>{outcome.text ?? t('cmd.failed')}</p>
          : <div className={css.answer}><MarkdownText text={outcome.text ?? ''} /></div>}
    </div>
  )
}

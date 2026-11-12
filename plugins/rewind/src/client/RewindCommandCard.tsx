/**
 * The /rewind command card: a localized, three-state row replacing the
 * generic gray one-line card. The host result text is stable English
 * ("Rewound: N item(s) ..."), so the masked count parses from it; unknown
 * shapes fall back to the raw text.
 *
 * @module dsh-plugin-rewind/client/RewindCommandCard
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat slot map (commandview keyed entry).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from './locales.ts'
import css from './RewindCommandCard.module.css'

/** Full props of the /rewind command row. */
export type RewindCommandCardProps =
  PropsRuntime<'conversation.chat.commandview', 'rewind'>
  & PropsLocale<'rewind'>

/** Parse the masked count out of the stable host result text. */
export function maskedCountOf(outcomeText: string | undefined): number | undefined {
  if (outcomeText === undefined) return undefined
  const match = /Rewound:\s*(\d+)/.exec(outcomeText)
  return match === null ? undefined : Number(match[1])
}

/** One /rewind command row: pending / failed / rewound-N summary. */
export function RewindCommandCard({ node, t }: RewindCommandCardProps) {
  const outcome = node.outcome
  return (
    <div className={css.card}>
      <span className={css.title}>{t('cmd.title')}</span>
      {outcome === null
        ? <span className={css.pending}>{t('cmd.pending')}</span>
        : outcome.kind === 'error'
          ? <span className={css.error}>{outcome.text ?? t('cmd.failed')}</span>
          : (
              <span className={css.result}>
                {maskedCountOf(outcome.text) !== undefined
                  ? t('cmd.summary', { count: maskedCountOf(outcome.text) })
                  : (outcome.text ?? t('cmd.nothing'))}
              </span>
            )}
    </div>
  )
}

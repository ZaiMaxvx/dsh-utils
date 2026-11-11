/**
 * Rewind entries in a completed turn's tail: "Retry this turn" (drop the turn
 * itself onward, so its prompt can be rephrased) and "Rewind to here" (keep
 * this turn, drop everything after it). Both submit a `/rewind to <seq>` line
 * through the session's command channel, so the rewind and its outcome land
 * in the durable log and render like any command card.
 *
 * @module dsh-plugin-rewind/client/TurnTailRewind
 */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat SlotMap merge (the turnTail entry's contract).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the standard session/global hook kit (useSessionStatus, sessionId).
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'rewind' seat).
import type {} from './locales.ts'
import css from './TurnTailRewind.module.css'

/** Injected business face of one turn-tail rewind entry. */
export interface TurnTailRewindInjected {
  /** Submit one composer command line (`/rewind …`) to this Session. */
  submit(line: string): void
}

/** Full props of the rewind entry in one turn tail. */
export type TurnTailRewindProps =
  PropsRuntime<'conversation.chat.turnTail'>
  & InjectFace<TurnTailRewindInjected>
  & PropsLocale<'rewind'>

/** One turn's rewind actions, disabled while the Session has pending work. */
export function TurnTailRewind({
  turn, seq, submit, t, useSessionStatus, sessionId,
}: TurnTailRewindProps) {
  const working = useSessionStatus(snapshot => snapshot.get(sessionId)?.running) === true
  const busyTitle = working ? t('action.busy') : undefined
  const startSeq = turn.start?.seq
  return (
    <span className={css.rewind}>
      {startSeq !== undefined && (
        <button
          type="button"
          className={css.action}
          disabled={working}
          title={busyTitle ?? t('action.retryTurn')}
          aria-label={t('action.retryTurn')}
          onClick={() => { submit(`/rewind to ${startSeq - 1}`) }}
        >
          {t('action.retryTurn')}
        </button>
      )}
      <button
        type="button"
        className={css.action}
        disabled={working}
        title={busyTitle ?? t('action.rewindHere')}
        aria-label={t('action.rewindHere')}
        onClick={() => { submit(`/rewind to ${seq}`) }}
      >
        {t('action.rewindHere')}
      </button>
    </span>
  )
}

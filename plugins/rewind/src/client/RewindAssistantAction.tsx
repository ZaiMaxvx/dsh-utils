/**
 * The per-message rewind action: a clock icon button in the assistant
 * message's icon strip, between copy and branch — the same row the user
 * already knows. "Rewind to here" keeps everything through this message and
 * drops what follows; the seq comes from the chat store's turn-tail node that
 * owns this messageId (the renderer of that node is this very row, so the
 * lookup always resolves).
 *
 * @module dsh-plugin-rewind/client/RewindAssistantAction
 */

import { useCallback } from 'react'
import { IconClockOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat slot map (assistant-actions entry + useChat kit)
// and the MessageId brand.
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from './locales.ts'
import css from './RewindAssistantAction.module.css'

/** Injected business face of the rewind message action. */
export interface RewindAssistantActionInjected {
  /** Submit one composer command line (`/rewind …`) to this Session. */
  submit(line: string): void
}

/** Full props of the rewind entry in the assistant action strip. */
export type RewindAssistantActionProps =
  PropsRuntime<'conversation.chat.assistant-actions'>
  & InjectFace<RewindAssistantActionInjected>
  & PropsLocale<'rewind'>

/** One message's rewind button, disabled while the Session has pending work. */
export function RewindAssistantAction({
  messageId, submit, t, useChat, useSessionStatus, sessionId,
}: RewindAssistantActionProps) {
  const seq = useChat(snapshot => {
    for (const node of snapshot.nodes.values()) {
      if (node.kind !== 'turn-tail') continue
      const closing = node.data.closing
      if (closing?.finalNode?.messageId === messageId) return closing.finalNode.seq
    }
    return undefined
  })
  const working = useSessionStatus(snapshot => snapshot.get(sessionId)?.running) === true

  const onRewind = useCallback(() => {
    if (seq === undefined || working) return
    submit(`/rewind to ${seq}`)
  }, [seq, submit, working])

  if (seq === undefined) return null
  const label = working ? t('action.busy') : t('action.rewindHere')
  return (
    <Tooltip label={label} side="bottom">
      <button
        type="button"
        className={css.action}
        aria-label={t('action.rewindHere')}
        disabled={working}
        onClick={onRewind}
      >
        <IconClockOutlineRegular />
      </button>
    </Tooltip>
  )
}

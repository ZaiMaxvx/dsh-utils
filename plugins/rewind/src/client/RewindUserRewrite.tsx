/**
 * The Esc-Esc style action above one durable user bubble: drop this message
 * onward (`/rewind to <seq-1>`), then put its text back in the composer for
 * rephrasing. On messages already masked by an earlier rewind the command is
 * a no-op, so the button only restores the text.
 *
 * Identity: this chain seat is dispatched by the user bubble holding the
 * message's `source`; the chat fold preserves that reference, so a
 * `data.source === source` scan over the chat nodes resolves this row's
 * seq/text without any extra plumbing.
 *
 * @module dsh-plugin-rewind/client/RewindUserRewrite
 */

import { useCallback, useState } from 'react'
import { IconEditOutlineRegular, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat slot map (user.before entry, useChat, ChatNode).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
// Type-only: pulls the standard session/global hook kit.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from './locales.ts'
import css from './RewindUserRewrite.module.css'

/** One settled /rewind execution outcome (host CommandResult shape). */
export interface RewindExecutionResult {
  readonly kind: 'success' | 'error'
}

/** Injected business face of the rewrite-resend action. */
export interface RewindUserRewriteInjected {
  /** Execute `/rewind to <seq-1>` and report the host outcome. */
  rewindToBefore(seq: number): Promise<RewindExecutionResult | undefined>
  /** Put the original text back into the composer and focus it. */
  restoreDraft(text: string): boolean
}

/** The chat-side facts for one user row. */
interface UserRowFacts {
  readonly seq: number
  readonly text: string
  readonly masked: boolean
}

/** Full props of the rewrite-resend chain entry. */
export type RewindUserRewriteProps =
  PropsRuntime<'conversation.chat.user.before'>
  & InjectFace<RewindUserRewriteInjected>
  & PropsLocale<'rewind'>

/** The edit action above one user bubble. */
export function RewindUserRewrite({
  source, rewindToBefore, restoreDraft, t, useChat, useSessionStatus, sessionId,
}: RewindUserRewriteProps) {
  const [pending, setPending] = useState(false)
  const facts = useChat(snapshot => {
    let markers: { keep: number; at: number }[] | undefined
    for (const node of snapshot.nodes.values()) {
      if (node.kind !== 'rewind-marker') continue
      markers ??= []
      markers.push({ keep: node.data.keepThroughSeq, at: node.data.seq })
    }
    for (const node of snapshot.nodes.values()) {
      if (node.kind !== 'user' || node.data.source !== source) continue
      const masked = markers?.some(m => m.keep < node.data.seq && node.data.seq < m.at) === true
      let text = ''
      for (const block of node.data.content) {
        if (block.type === 'text') text += block.text
      }
      return { seq: node.data.seq, text, masked }
    }
    return undefined
  })
  const working = useSessionStatus(snapshot => snapshot.get(sessionId)?.running) === true

  const onEdit = useCallback(() => {
    if (facts === undefined || working || pending) return
    if (facts.masked) {
      restoreDraft(facts.text)
      return
    }
    setPending(true)
    void rewindToBefore(facts.seq).then(result => {
      setPending(false)
      if (result?.kind === 'success') restoreDraft(facts.text)
    })
  }, [facts, pending, restoreDraft, rewindToBefore, working])

  if (facts === undefined || facts.text.length === 0) return null
  const label = working
    ? t('action.busy')
    : facts.masked
      ? t('action.restore')
      : t('action.rewrite')
  return (
    <div className={css.row}>
      <Tooltip label={label} side="bottom">
        <button
          type="button"
          className={css.action}
          aria-label={t('action.rewrite')}
          disabled={working || pending}
          onClick={onEdit}
        >
          <IconEditOutlineRegular />
        </button>
      </Tooltip>
    </div>
  )
}

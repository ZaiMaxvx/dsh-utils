/**
 * The visible rewind marker row: an accent notification line rendered at the
 * transcript position where the rewind landed, mirroring the compaction
 * checkpoint's card pattern (but unmissable — the point is showing that a
 * rewind happened and what left the model context).
 *
 * @module dsh-plugin-rewind/client/RewindMarkerNode
 */

import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the chat slot map (conversation.chat.node keyed entry).
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from './rewindMarkerDefinition.ts'
import type {} from './locales.ts'
import css from './RewindMarkerNode.module.css'

/** Full props of the rewind marker row renderer. */
export type RewindMarkerNodeProps =
  PropsRuntime<'conversation.chat.node', 'rewind-marker'>
  & PropsLocale<'rewind'>

/** One rewind marker row: icon + localized summary + boundary stats. */
export function RewindMarkerNode({ node, t }: RewindMarkerNodeProps) {
  const { maskedCount, keepThroughSeq, seq } = node.data
  return (
    <div className={css.marker} data-rewind-seq={seq}>
      <span className={css.glyph} aria-hidden>⏱</span>
      <div className={css.body}>
        <span className={css.title}>{t('marker.title')}</span>
        <span className={css.detail}>
          {t('marker.detail', { count: maskedCount, keep: keepThroughSeq })}
        </span>
      </div>
    </div>
  )
}

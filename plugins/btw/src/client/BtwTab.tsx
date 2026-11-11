/**
 * The BTW sidebar panel body: the side-question history (newest first, from
 * the `btwHistory` projection) and an inline input that submits `/btw …`
 * through the session's command channel — the same path a typed line takes,
 * so host-side execution, the transcript card, and the panel stay identical.
 *
 * @module dsh-plugin-btw/client/BtwTab
 */

import { useCallback, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-session standard kit (useProjection) and the
// sidebar-right slot contracts this body renders under.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'btw' seat)
// and the btwHistory projection key.
import type {} from './locales.ts'
import type {} from '../types.ts'
import { btwRows, btwTime, btwCommandLine, submittable } from './view.ts'
import css from './BtwTab.module.css'

/** Injected business face of the panel body. */
export interface BtwTabInjected {
  /** Submit one composer command line (`/btw …`) to this Session. */
  submit(line: string): void
}

/** Full props of the BTW panel body. */
export type BtwTabProps =
  PropsRuntime<'sidebar.right.pane.tab'>
  & InjectFace<BtwTabInjected>
  & PropsLocale<'btw'>

/** The panel: history list plus the inline ask box. */
export function BtwTab({ submit, t, useProjection }: BtwTabProps) {
  const history = useProjection('btwHistory')
  const rows = btwRows(history)
  const [draft, setDraft] = useState('')
  const [warned, setWarned] = useState(false)

  const send = useCallback(() => {
    if (!submittable(draft)) {
      setWarned(true)
      return
    }
    setWarned(false)
    submit(btwCommandLine(draft))
    setDraft('')
  }, [draft, submit])

  return (
    <div className={css.panel}>
      {rows.length === 0
        ? <p className={css.empty}>{t('panel.empty')}</p>
        : (
          <ol className={css.list}>
            {rows.map(({ entry, pending, failed }) => (
              <li key={entry.id} className={css.entry}>
                <div className={css.head}>
                  <span className={css.question}>{entry.question}</span>
                  <span className={css.time}>{btwTime(entry.time)}</span>
                </div>
                {pending
                  ? <p className={css.pending}>{t('entry.pending')}</p>
                  : failed
                    ? <p className={css.failed}>{t('entry.error')}</p>
                    : <p className={css.answer}>{entry.answer}</p>}
              </li>
            ))}
          </ol>
        )}
      <div className={css.ask}>
        <textarea
          className={css.input}
          rows={2}
          placeholder={t('panel.inputPlaceholder')}
          value={draft}
          onChange={event => { setDraft(event.target.value); if (warned) setWarned(false) }}
          onKeyDown={event => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              send()
            }
          }}
        />
        <button type="button" className={css.send} disabled={!submittable(draft)} onClick={send}>
          ↵
        </button>
      </div>
      {warned && <p className={css.warn} role="status">{t('panel.emptyQuestion')}</p>}
    </div>
  )
}

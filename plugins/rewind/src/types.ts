/**
 * Public type merges owned by the rewind plugin. This module is types only:
 * importing it (even `import type {}`) brings the merges into the host
 * compilation so the rewind marker's message source is a first-class
 * `MessageSource` variant everywhere the plugin is loaded.
 *
 * @module dsh-plugin-rewind/types
 */

import type {} from '@deepseek-ai/dsh-llm'

/** Message source carried by a rewind's replacement marker message. */
export interface RewindSource {
  readonly kind: 'rewind'
  /** How many live surface nodes this rewind shadowed. */
  readonly maskedCount: number
  /** The `keepThroughSeq` the rewind was planned with. */
  readonly keepThroughSeq: number
}

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    rewind: RewindSource
  }
}

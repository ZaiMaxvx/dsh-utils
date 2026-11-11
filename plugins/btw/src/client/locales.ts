/** `btw` namespace dictionaries for the browser half. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'tab.title': 'BTW 侧问',
  'guide.title': 'BTW 侧问',
  'guide.description': '不打断主对话的即时侧问：提问立即由当前上下文作答，问答不进入主历史',
  'panel.inputPlaceholder': '问点什么…（Ctrl+Enter 发送）',
  'panel.empty': '还没有侧问。输入 /btw <问题> 或在上方直接提问。',
  'panel.pending': '思考中…',
  'panel.error': '侧问失败',
  'panel.emptyQuestion': '问题不能为空',
  'entry.pending': '思考中…',
  'entry.error': '失败',
} satisfies Record<string, string>

/** The btw namespace key union. */
export type BtwKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The btw surface's copy: the sidebar tab and the side-question panel. */
    btw: BtwKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'tab.title': 'BTW',
  'guide.title': 'BTW side questions',
  'guide.description': 'Immediate side answers from the current context, without touching the main conversation',
  'panel.inputPlaceholder': 'Ask something… (Ctrl+Enter to send)',
  'panel.empty': 'No side questions yet. Type /btw <question> or ask right here.',
  'panel.pending': 'Thinking…',
  'panel.error': 'Side question failed',
  'panel.emptyQuestion': 'Question must not be empty',
  'entry.pending': 'Thinking…',
  'entry.error': 'Failed',
} satisfies Record<BtwKey, string>

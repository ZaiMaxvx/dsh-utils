/** `rewind` namespace dictionaries for the browser half. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.retryTurn': '重试本轮',
  'action.rewindHere': '回退到这里',
  'action.busy': '智能体正在运行，请先停止再回退',
  'picker.undo1': '撤销最近 1 轮',
  'picker.undoN': '撤销最近 {n} 轮',
  'picker.hint': '回退会从模型上下文中移除所选轮次之后的内容',
} satisfies Record<string, string>

/** The rewind namespace key union. */
export type RewindKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The rewind surface's copy: turn-tail actions and the /rewind picker. */
    rewind: RewindKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.retryTurn': 'Retry this turn',
  'action.rewindHere': 'Rewind to here',
  'action.busy': 'The agent is working; stop it before rewinding',
  'picker.undo1': 'Undo the last turn',
  'picker.undoN': 'Undo the last {n} turns',
  'picker.hint': 'Rewinding removes the chosen turns onward from the model context',
} satisfies Record<RewindKey, string>

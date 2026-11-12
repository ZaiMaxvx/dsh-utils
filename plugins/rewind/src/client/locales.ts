/** `rewind` namespace dictionaries for the browser half. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'action.rewindHere': '回退到这里',
  'action.busy': '智能体正在运行，请先停止再回退',
  'picker.undo1': '撤销最近 1 轮',
  'picker.undoN': '撤销最近 {n} 轮',
  'picker.hint': '回退会从模型上下文中移除所选轮次之后的内容',
  'marker.title': '已回退',
  'marker.detail': '{count} 条内容已移出模型上下文（记录仍保留），上下文恢复至 #{keep}',
  'cmd.title': '/rewind',
  'cmd.pending': '回退中…',
  'cmd.failed': '回退失败',
  'cmd.nothing': '当前已在该位置，无需回退',
  'cmd.summary': '已回退：{count} 条内容移出模型上下文（记录仍保留）',
} satisfies Record<string, string>

/** The rewind namespace key union. */
export type RewindKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The rewind surface's copy: message action, picker, marker row, command card. */
    rewind: RewindKey
  }
}

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'action.rewindHere': 'Rewind to here',
  'action.busy': 'The agent is working; stop it before rewinding',
  'picker.undo1': 'Undo the last turn',
  'picker.undoN': 'Undo the last {n} turns',
  'picker.hint': 'Rewinding removes the chosen turns onward from the model context',
  'marker.title': 'Rewound',
  'marker.detail': '{count} item(s) left the model context (the transcript keeps them); context restored through #{keep}',
  'cmd.title': '/rewind',
  'cmd.pending': 'Rewinding…',
  'cmd.failed': 'Rewind failed',
  'cmd.nothing': 'Already at that point — nothing to rewind',
  'cmd.summary': 'Rewound: {count} item(s) left the model context (the transcript keeps them)',
} satisfies Record<RewindKey, string>

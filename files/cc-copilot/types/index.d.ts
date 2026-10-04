export type Busy = 'enhancing' | 'suggesting' | null
export type Style = 'structured' | 'concise' | 'technical' | 'creative'

export type Prefs = {
  /** 增强提示词的风格 */
  style: Style
  /** 每轮结束后是否生成"下一步"建议 */
  suggest: boolean
  /** 增强和建议是否先判断任务所属领域，按该领域行家的标准来写 */
  expert: boolean
}

/** 一个子代理的工作记录：派了什么、做到哪、回报了什么 */
export type AgentTrack = {
  id: string
  type: string
  description: string
  isDone: boolean
  /** 主对话派给它的任务原文 */
  brief: string | null
  /** 已执行的工具调用次数 */
  steps: number
  /** 最近几步在做什么，新的在后 */
  recent: string[]
  /** 它交回的最终报告 */
  answer: string | null
  startedAt: number
  endedAt: number | null
}

declare module 'claude-code' {
  interface PluginState {
    'cc-copilot': {
      suggestion: string | null
      busy: Busy
      undo: string | null
      note: string | null
      prefs: Prefs
      agents: AgentTrack[]
      /** 设置行是否展开；默认收起，栏里只留「增强」 */
      isOpen: boolean
    }
  }
}

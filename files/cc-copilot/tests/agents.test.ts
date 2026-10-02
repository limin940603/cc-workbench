import { expect, mock, test } from 'claude-code/testing'

const BAND = (isWorking: boolean) => ({ component: 'AbovePrompt', props: { hasSurvey: false, isWorking, maxRows: 10, bodyColumns: 120 } }) as const
const PANE = { component: 'Pane', requestId: 'subagents', props: {} } as const

// 把一棵绘制结果里的文字全部拼起来，方便断言"界面上出现了什么"
const textOf = (node: unknown): string => {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  const n = node as { props?: Record<string, unknown>; children?: unknown }
  return `${typeof n.props?.label === 'string' ? n.props.label : ''}${textOf(n.children ?? n.props?.children)}`
}

test('子代理可见：栏里显示正在做的那一步，面板里有派单原文、过程和回报', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('tool.call', () => ({ result: { text: 'ok' } }) as any)
  on('agent.list', () => ({ value: [{ id: 'a1', description: '调研竞品定价', type: 'Explore', status: 'running' }] }) as any)
  on('turn.complete', (_$, e) => ({ text: e.answer }) as any)
  on('ui.open', () => ({}) as any)

  // 主对话派单，然后子代理做了两步
  await $.tool.call({ tool: 'Agent', description: '调研竞品定价', prompt: '查三家同类产品的公开价格，给出处', subagent_type: 'Explore' } as any)
  await $.tool.call({ tool: 'WebSearch', query: '竞品A 价格', agentId: 'a1' } as any)
  await $.tool.call({ tool: 'Grep', pattern: 'price', agentId: 'a1' } as any)

  for (const surface of ['terminal', 'desktop'] as const) {
    // 主对话在干活时，栏里只留子代理行
    const band = await $.ui.mount({ plugin: 'cc-copilot', surface, ...BAND(true) } as any)
    const shown = textOf(await band.drawn())
    expect(shown).toContain('Explore')
    expect(shown).toContain('Grep price')
    expect(shown).toContain('2 步')
    expect(shown).toContain('子代理 1 在跑 / 共 1')
    expect(shown).not.toContain('增强')
    await band.unmount()
  }

  // 子代理交回报告
  await $.turn.complete({ answer: '三家价格：A 99、B 129、C 未公开。', durationMs: 1, isAborted: false, turnId: 't-a1', reason: 'end_turn', agentId: 'a1' } as any)

  const pane = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...PANE } as any)
  const detail = textOf(await pane.drawn())
  expect(detail).toContain('查三家同类产品的公开价格')
  expect(detail).toContain('WebSearch 竞品A 价格')
  expect(detail).toContain('三家价格：A 99')

  // 完成后栏里不再有运行行，但按钮还在，随时能点开回看
  const idle = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND(false) } as any)
  const after = textOf(await idle.drawn())
  expect(after).toContain('子代理 0 在跑 / 共 1')
  expect(after).toContain('增强')
})

test('主对话自己的工具调用不算子代理', async ($, on) => {
  mock.store(on)
  mock.clock(on)
  on('tool.call', () => ({ result: { text: 'ok' } }) as any)
  await $.tool.call({ tool: 'Bash', command: 'ls' } as any)
  const band = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND(false) } as any)
  expect(textOf(await band.drawn())).not.toContain('子代理')
})

test('专家开关：开着时增强按领域行家标准写，关掉后不带', async ($, on) => {
  const systems: string[] = []
  mock.store(on)
  on('prompt.read', () => ({ value: { text: '做个招生短视频脚本', cursor: 0 } }))
  on('session.messages', () => ({ value: [] }) as any)
  on('model.complete', (_$, e) => {
    systems.push(e.system ?? '')
    return { value: { isAnswered: true, text: '改写后', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.fill', () => ({ isFilled: true }))

  const ui = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND(false) } as any)
  await ui.press({ key: 'enhance' })
  expect(systems[0]).toContain('资深')
  await ui.redraw()
  await ui.press({ key: 'more' }) // 设置行默认收起，先展开
  await ui.redraw()
  await ui.press({ key: 'expert' })
  await ui.redraw()
  await ui.press({ key: 'enhance' })
  expect(systems[1]).not.toContain('资深')
})

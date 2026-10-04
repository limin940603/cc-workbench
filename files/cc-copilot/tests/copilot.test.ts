import { expect, mock, test } from 'claude-code/testing'

const BAND = { component: 'AbovePrompt', props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 120 } } as const
const HISTORY = [
  { role: 'user', text: '帮某职业学校做招生海报', toolUses: [] },
  { role: 'assistant', text: '好的，先确认专业方向。', toolUses: [] },
]

test('增强：带上最近对话和所选风格，草稿被改写、可撤销', async ($, on) => {
  const fills: string[] = []
  const asked: { system?: string; prompt: string }[] = []
  let draft = '帮我写个文案'
  mock.store(on)
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('session.messages', () => ({ value: HISTORY }) as any)
  on('model.complete', (_$, e) => {
    asked.push({ system: e.system, prompt: e.prompt })
    return { value: { isAnswered: true, text: '为某职业学校写一份招生海报文案', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    draft = e.text
    return { isFilled: true }
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    fills.length = 0
    asked.length = 0
    draft = '帮我写个文案'
    const ui = await $.ui.mount({ plugin: 'cc-copilot', surface, ...BAND } as any)
    await ui.press({ key: 'more' }) // 设置行默认收起，先展开
    await ui.redraw()
    await ui.press({ key: 'style' }) // 结构化 → 精简
    await ui.redraw()
    await ui.press({ key: 'enhance' })
    expect(asked[0]?.prompt).toContain('某职业学校')
    expect(asked[0]?.prompt).toContain('帮我写个文案')
    expect(asked[0]?.system).toContain('1.5 倍')
    expect(fills[0]).toContain('招生海报')
    await ui.redraw()
    await ui.press({ key: 'undo' })
    expect(fills[1]).toBe('帮我写个文案')
    // 把风格转回结构化，下一轮循环从同一起点开始
    for (let i = 0; i < 3; i++) {
      await ui.redraw()
      await ui.press({ key: 'style' })
    }
    await ui.redraw()
    await ui.press({ key: 'more' }) // 收起，下一轮从默认状态开始
    await ui.unmount()
  }
})

test('草稿为空时不调用模型', async ($, on) => {
  let called = false
  mock.store(on)
  on('prompt.read', () => ({ value: { text: '  ', cursor: 0 } }))
  on('model.complete', () => {
    called = true
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { inputTokens: 0, outputTokens: 0 } } } as any
  })
  on('ui.toast', () => ({}) as any)
  const ui = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND } as any)
  await ui.press({ key: 'enhance' })
  expect(called).toBe(false)
})

test('关掉建议后，轮次结束不再调用模型', async ($, on) => {
  let calls = 0
  mock.store(on, { prefs: { style: 'structured', suggest: false } })
  on('model.complete', () => {
    calls += 1
    return { value: { isAnswered: true, text: '继续', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as any)
  on('prompt.suggest', () => ({ isShown: true }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as any)
  on('session.start', (_$, e) => ({ cwd: (e as any).cwd }) as any)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as any)
  await $.prompt.submit({ text: '你好' } as any)
  await $.turn.complete({ answer: '你好，我在。', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
  expect(calls).toBe(0)
})

test('建议开着时，轮次结束调用一次小模型并给出建议', async ($, on) => {
  let calls = 0
  mock.store(on, { prefs: { style: 'structured', suggest: true } })
  on('model.complete', () => {
    calls += 1
    return { value: { isAnswered: true, text: '继续', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as any)
  on('prompt.suggest', () => ({ isShown: true }))
  on('turn.complete', (_$, e) => ({ text: e.answer }) as any)
  on('session.start', (_$, e) => ({ cwd: (e as any).cwd }) as any)
  await $.session.start({ source: 'startup', cwd: '/tmp' } as any)
  await $.prompt.submit({ text: '你好' } as any)
  await $.turn.complete({ answer: '你好，我在。', durationMs: 1, isAborted: false, turnId: 't1', reason: 'end_turn' } as any)
  await new Promise(r => setTimeout(r, 0))
  expect(calls).toBe(1)
})

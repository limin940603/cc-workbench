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

test('增强：带上这几轮读写的文件、跑过的命令和项目规则，并告诉用户参考了什么', async ($, on) => {
  const asked: { system?: string; prompt: string }[] = []
  const draft = '把刚才那个文件里的按钮改成和设计稿一致，然后把测试跑一遍确认没坏'
  mock.store(on)
  on('prompt.read', () => ({ value: { text: draft, cursor: draft.length } }))
  on('session.messages', () => ({
    value: [
      { role: 'user', text: '看看助手栏的按钮', toolUses: [] },
      {
        role: 'assistant',
        text: '看过了，按钮在 register.tsx 里。',
        toolUses: [
          { tool_use_id: '1', tool: 'Read', input: { file_path: 'files/cc-copilot/hooks/register.tsx' } },
          { tool_use_id: '2', tool: 'Read', input: { file_path: 'files/cc-copilot/hooks/register.tsx' } },
          { tool_use_id: '3', tool: 'Bash', input: { command: 'claude plugin test files/cc-copilot', description: '跑助手栏测试' } },
        ],
      },
    ],
  }) as any)
  on('fs.read', (_$, e) => (/(^|[\\/])CLAUDE\.md$/.test(String(e.path)) ? { value: '# 项目规则\n- commit 用中文' } : { deny: 'missing' }) as any)
  on('model.complete', (_$, e) => {
    asked.push({ system: e.system, prompt: e.prompt })
    return { value: { isAnswered: true, text: '改 register.tsx 里的按钮', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.fill', () => ({ isFilled: true }))

  const ui = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND } as any)
  await ui.redraw()
  await ui.press({ key: 'enhance' })
  const prompt = asked[0]?.prompt ?? ''
  // 动作行：同一文件只出现一次，命令用描述
  expect(prompt).toContain('动作：读 files/cc-copilot/hooks/register.tsx；跑 跑助手栏测试')
  expect(prompt.split('register.tsx').length - 1).toBe(2) // 助手正文一次 + 动作一次
  expect(prompt).toContain('项目规则')
  expect(prompt).toContain('commit 用中文')
  expect(prompt.indexOf('项目规则')).toBeLessThan(prompt.indexOf('最近对话'))
  expect(prompt.endsWith(`草稿：\n${draft}`)).toBe(true)
  expect(asked[0]?.system).toContain('动作')
  // 草稿不短，默认风格保持结构化
  expect(asked[0]?.system).toContain('3 倍')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /参考了最近 2 条对话、1 个文件、项目规则/ })).toBeDefined()
  await ui.unmount()
})

test('增强：没有项目规则文件时照常工作，短草稿按精简处理', async ($, on) => {
  const asked: { system?: string; prompt: string }[] = []
  mock.store(on)
  on('prompt.read', () => ({ value: { text: '帮我写个文案', cursor: 6 } }))
  on('session.messages', () => ({ value: [] }) as any)
  on('fs.read', () => ({ deny: 'ENOENT' }) as any)
  on('model.complete', (_$, e) => {
    asked.push({ system: e.system, prompt: e.prompt })
    return { value: { isAnswered: true, text: '写一份文案', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.fill', () => ({ isFilled: true }))
  const ui = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND } as any)
  await ui.redraw()
  await ui.press({ key: 'enhance' })
  expect(asked[0]?.prompt).toBe('草稿：\n帮我写个文案')
  expect(asked[0]?.system).toContain('1.5 倍')
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /草稿短，按精简处理，没有可参考的对话和项目规则/ })).toBeDefined()
  await ui.unmount()
})

test('草稿为空时不调用模型', async ($, on) => {
  let called = false
  mock.store(on)
  on('prompt.read', () => ({ value: { text: '  ', cursor: 0 } }))
  on('model.complete', () => {
    called = true
    return { value: { isAnswered: false, reason: 'empty-reply', usage: { inputTokens: 0, outputTokens: 0 } } } as any
  })
  on('ui.toast', () => ({ value: undefined }) as any)
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

test('增强超时：说明原因，不写输入框，按钮恢复', async ($, on) => {
  const fills: string[] = []
  let timeoutMs: unknown
  mock.store(on)
  on('prompt.read', () => ({ value: { text: '把这段改成英文', cursor: 7 } }))
  on('session.messages', () => ({ value: [] }) as any)
  on('fs.read', () => ({ deny: 'ENOENT' }) as any)
  on('model.complete', (_$, e) => {
    timeoutMs = (e as any).timeoutMs
    return { value: { isAnswered: false, reason: 'aborted', usage: { inputTokens: 0, outputTokens: 0 } } } as any
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const ui = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND } as any)
  await ui.redraw()
  await ui.press({ key: 'enhance' })
  expect(timeoutMs).toBe(60_000)
  expect(fills).toEqual([])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /增强超时（60 秒），原稿未改动/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'enhance' })).toBeDefined()
  await ui.unmount()
})

test('增强中可取消：模型晚到的结果不落地，原稿不动', async ($, on) => {
  const fills: string[] = []
  mock.store(on)
  const clock = mock.clock(on)
  on('prompt.read', () => ({ value: { text: '把这段改成英文', cursor: 7 } }))
  on('session.messages', () => ({ value: [] }) as any)
  on('fs.read', () => ({ deny: 'ENOENT' }) as any)
  on('model.complete', async () => {
    // 模型 5 秒后才回；期间用户按取消
    await clock.sleep(5000)
    return { value: { isAnswered: true, text: 'Translate this into English', usage: { inputTokens: 1, outputTokens: 1 } } } as any
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  const ui = await $.ui.mount({ plugin: 'cc-copilot', surface: 'terminal', ...BAND } as any)
  await ui.redraw()
  // press 会等增强做完，而增强停在模拟时钟上等测试推进，所以这里不等它，只让已启动的工作跑到停住
  const pressed = ui.press({ key: 'enhance' })
  await clock.settle()
  await ui.redraw()
  // 增强中：增强按钮换成取消，状态行写明上限
  expect(await ui.find({ type: 'Button', key: 'cancel' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /最多 60 秒/ })).toBeDefined()
  const cancelled = ui.press({ key: 'cancel' })
  await clock.settle()
  await clock.advance(5000)
  await Promise.all([pressed, cancelled])
  expect(fills).toEqual([])
  await ui.redraw()
  expect(await ui.find({ type: 'Text', text: /已取消，原稿未改动/ })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'enhance' })).toBeDefined()
  await ui.unmount()
})

test('++ 触发的增强失败后，空输入框里放回原稿；增强中再 ++ 不重复请求', async ($, on) => {
  const fills: string[] = []
  const toasts: string[] = []
  let calls = 0
  mock.store(on)
  const clock = mock.clock(on)
  // ++ 把提交拦下后输入框是空的
  on('prompt.read', () => ({ value: { text: '', cursor: 0 } }))
  on('session.messages', () => ({ value: [] }) as any)
  on('fs.read', () => ({ deny: 'ENOENT' }) as any)
  on('ui.toast', (_$, e) => {
    toasts.push((e as any).text)
    return { value: undefined } as any
  })
  on('model.complete', async () => {
    calls += 1
    await clock.sleep(1000)
    return { value: { isAnswered: false, reason: 'api-error', status: 529, error: 'overloaded', usage: { inputTokens: 0, outputTokens: 0 } } } as any
  })
  on('prompt.fill', (_$, e) => {
    fills.push(e.text)
    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => ({ text: e.text }) as any)
  const first = await $.prompt.submit({ text: '把这段改成英文 ++', origin: { kind: 'composer' } } as any)
  expect((first as any).drop).toContain('正在增强')
  await clock.settle()
  const second = await $.prompt.submit({ text: '再来一次 ++', origin: { kind: 'composer' } } as any)
  expect((second as any).drop).toContain('正在增强')
  await clock.settle()
  expect(calls).toBe(1)
  expect(toasts.some(t => t.includes('正在增强'))).toBe(true)
  await clock.advance(1000)
  expect(fills).toEqual(['把这段改成英文'])
})

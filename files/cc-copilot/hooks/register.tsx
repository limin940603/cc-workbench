// 输入框上方的助手栏：
// 1. 发送前选模型和推理强度：只改之后发出的请求，不动 /model 的全局默认；换了模型会在系统提示词里告诉它实际是谁；
// 2. 「✨ 增强」按所选风格改写草稿（可选，不点就不发生），会参考最近对话，原稿可撤销；
//    键盘党：草稿末尾加 ++ 再回车，不发送，改为增强后放回输入框；
// 3. 每轮结束后预测"下一步"，作为栏内提示和输入框灰字建议（Tab 采用），可关；
// 4. 「专家」开关：增强和建议先判断任务属于哪个领域，按该领域行家的标准来写；
// 5. 子代理可见：栏里实时显示每个子代理正在做的那一步，「子代理」面板里看派单原文、最近动作和回报。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentTrack, Busy, Effort, Prefs, Style } from '../types'

const suggestion = atom({ plugin: 'cc-copilot', key: 'suggestion' } as const, null as string | null)
const busy = atom({ plugin: 'cc-copilot', key: 'busy' } as const, null as Busy)
const undo = atom({ plugin: 'cc-copilot', key: 'undo' } as const, null as string | null)
const note = atom({ plugin: 'cc-copilot', key: 'note' } as const, null as string | null)
const prefs = atom({ plugin: 'cc-copilot', key: 'prefs' } as const, { model: null, effort: null, style: 'structured', suggest: true, expert: true } as Prefs)
const isOpen = atom({ plugin: 'cc-copilot', key: 'isOpen' } as const, false)
const agents = atom({ plugin: 'cc-copilot', key: 'agents' } as const, [] as AgentTrack[])

// null = 跟随会话。换模型后第一条消息要重新计费整段上下文（缓存按模型分开），所以默认不换。
const MODELS: readonly { id: string | null; label: string }[] = [
  { id: null, label: '跟随会话' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { id: 'claude-sonnet-5-5', label: 'Sonnet 5.5' },
  { id: 'claude-opus-5-5', label: 'Opus 5.5' },
  { id: 'claude-fable-5-1', label: 'Fable 5.1' },
]
const EFFORTS: readonly { id: Effort | null; label: string }[] = [
  { id: null, label: '跟随会话' },
  { id: 'low', label: '低' },
  { id: 'medium', label: '中' },
  { id: 'high', label: '高' },
  { id: 'xhigh', label: '很高' },
  { id: 'max', label: '最高' },
]
const STYLES: readonly { id: Style; label: string; rule: string }[] = [
  {
    id: 'structured',
    label: '结构化',
    rule: '按需补全结构：要做什么（目标）、已知背景、具体要求与约束、交付形式和完成标准。草稿很短很明确时只做轻量润色，不硬套结构。长度不超过原文的 3 倍。',
  },
  {
    id: 'concise',
    label: '精简',
    rule: '只消除歧义、补上缺失的关键约束，不加小标题和列表结构，保持一两句话的形态。长度不超过原文的 1.5 倍。',
  },
  {
    id: 'technical',
    label: '技术',
    rule: '写成工程任务：点明涉及的文件/模块/命令（只用草稿和对话里出现过的），说明边界（哪些不要动）、验收方式（怎么算做完、怎么验证）。长度不超过原文的 3 倍。',
  },
  {
    id: 'creative',
    label: '内容创作',
    rule: '写成内容创作任务：点明发布平台、目标读者、口吻、篇幅、素材来源；要求保留作者本人的观点和经历，区分实测与推测，不编造数据和背书。长度不超过原文的 3 倍。',
  },
]

const EXPERT_RULE =
  '先判断这个任务属于哪个专业领域（例如产品经理、前端工程、短视频编导、电商视觉、职教课程设计、商务沟通、数据分析），再以该领域资深从业者下任务单的方式改写：开头用一句"请以资深××的专业标准完成"点明角色；补上这个领域的行家一定会交代、外行常漏掉的关键要素（只列要素名和草稿/对话里已有的信息，没有的不要编）。'
const EXPERT_SUGGEST = '先判断任务所属的专业领域，优先建议该领域行家在这个节点会做的下一步（例如验证、对照验收标准、排查风险、复盘沉淀），而不是泛泛的"继续"。'
const PANE = 'subagents'

const ENHANCE_MARK = /\s*\+\+\s*$/
const STORE_KEY = 'prefs'

const enhanceSystem = (rule: string, expert = false) => `你是提示词优化助手。用户会给你一段准备发给 Claude Code（能读写文件、运行命令、调研和写作的 AI 工作搭档）的草稿，把它改写成更清晰、可直接执行的指令。
规则：
- 保留原意、语言和口吻；不添加草稿和对话里都没有的事实、数字、文件名、客户名。
- ${rule}${expert ? `\n- ${EXPERT_RULE}` : ''}
- 你会看到"最近对话"作为背景：草稿里的"这个/这些/它/刚才那个"能从对话里确定指什么，就直接写明，不要再问。
- 只有对话也回答不了、并且会实质影响结果的缺口，才用【待补充：…】标出，最多 2 处；做事方式（先确认还是直接做、优先级）不算缺口，不要标。
- 不写客套话。只输出改写后的提示词本身，不加解释、不加引号。`

const SUGGEST_SYSTEM = `根据用户上一条请求和 AI 助手的回复，预测用户最可能发出的下一条指令。
要求：一句中文，不超过 30 个字，用用户自己的口吻写成祈使句，具体、可直接发送。
如果助手在等用户确认或回答问题，就写出最合理的确认或回答。
只输出这句话，不加引号和解释。`

// 按显示宽度截断：中日韩字符占两格
const clipW = (s: string, max: number) => {
  let w = 0
  let out = ''
  for (const ch of s) {
    w += (ch.codePointAt(0) ?? 0) > 0x2e7f ? 2 : 1
    if (w > max) return out + '…'
    out += ch
  }
  return out
}
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s)
const labelOf = <T,>(list: readonly { id: T; label: string }[], id: T) => list.find(x => x.id === id)?.label ?? String(id)
const nextOf = <T,>(list: readonly { id: T }[], id: T): T => {
  const i = list.findIndex(x => x.id === id)
  return (list[(i + 1) % list.length] ?? list[0]!).id
}

// 一步工具调用压成一行：工具名 + 最能说明它在干什么的那个参数
function describeStep(e: { tool: string } & Record<string, unknown>) {
  const detail = e.description ?? e.command ?? e.file_path ?? e.pattern ?? e.query ?? e.url ?? e.prompt ?? ''
  return `${e.tool} ${clip(String(detail).replace(/\s+/g, ' '), 70)}`.trim()
}

async function trackStep($: EngineInterface, agentId: string, step: string, brief: (description: string) => string | null) {
  const now = await $.clock.now()
  const known = (await read($, agents)).some(a => a.id === agentId)
  // 第一次见到这个子代理时才去问引擎它的类型和描述
  const info = known ? undefined : (await $.agent.list()).find(a => a.id === agentId)
  const fresh: AgentTrack = {
    id: agentId,
    type: info?.type ?? 'agent',
    description: info?.description ?? agentId,
    isDone: false,
    brief: info ? brief(info.description) : null,
    steps: 0,
    recent: [],
    answer: null,
    startedAt: now,
    endedAt: null,
  }
  await update($, agents, list => {
    const base = list.some(a => a.id === agentId) ? list : [...list, fresh].slice(-20)
    return base.map(a => (a.id === agentId ? { ...a, steps: a.steps + 1, recent: [...a.recent, step].slice(-8) } : a))
  })
}

async function finishAgent($: EngineInterface, agentId: string, answer: string) {
  const now = await $.clock.now()
  await update($, agents, list => list.map(a => (a.id === agentId ? { ...a, isDone: true, endedAt: now, answer: clip(answer.trim(), 3000) } : a)))
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  return s >= 60 ? `${Math.floor(s / 60)}分${s % 60}秒` : `${s}秒`
}

async function setPrefs($: EngineInterface, patch: Partial<Prefs>) {
  const p = { ...(await read($, prefs)), ...patch }
  await update($, prefs, () => p)
  // 风格和建议开关跨会话记住；模型和强度只在本会话有效，免得下次开工忘了自己还挂在别的模型上
  await $.store.set(STORE_KEY, { style: p.style, suggest: p.suggest, expert: p.expert })
}

async function recentContext($: EngineInterface) {
  const all = await $.session.messages()
  if (!Array.isArray(all)) return ''
  return all
    .filter(m => m.text?.trim())
    .slice(-6)
    .map(m => `${m.role === 'user' ? '用户' : '助手'}：${clip(m.text.trim(), 600)}`)
    .join('\n')
}

async function enhance($: EngineInterface, draft: string) {
  const text = draft.replace(ENHANCE_MARK, '').trim()
  if (!text) {
    $.ui.toast('先在输入框写个草稿，再点增强')
    return
  }
  await update($, busy, () => 'enhancing')
  await update($, note, () => null)
  try {
    const { style, expert } = await read($, prefs)
    const rule = STYLES.find(s => s.id === style)?.rule ?? STYLES[0]!.rule
    const context = await recentContext($)
    const r = await $.model.complete({
      model: 'sonnet',
      system: enhanceSystem(rule, expert),
      prompt: `${context ? `最近对话（仅作背景，不要改写它）：\n${context}\n\n` : ''}草稿：\n${text}`,
      maxTokens: 1500,
    })
    if (!r.isAnswered) {
      // 失败要说出来，原稿留在输入框不动
      await update($, note, () => `增强失败（${r.reason}），原稿未改动`)
      return
    }
    await update($, undo, () => text)
    const filled = await $.prompt.fill({ text: r.text.trim(), mode: 'replace' })
    await update($, note, () => (filled.isFilled ? '已增强，检查后回车；不满意按撤销' : '输入框暂时不可写，稍后再试'))
  } finally {
    await update($, busy, () => null)
  }
}

export const register: Register = on => {
  let lastPrompt = ''
  // 主对话派单时记下任务原文，按描述对上之后出现的子代理
  const briefs = new Map<string, string>()

  on('session.start', async ($, e, next) => {
    const saved = (await $.store.get(STORE_KEY)) as Partial<Prefs> | undefined
    if (saved && typeof saved === 'object') {
      const style = STYLES.some(s => s.id === saved.style) ? saved.style! : 'structured'
      await update($, prefs, p => ({ ...p, style, suggest: saved.suggest !== false, expert: saved.expert !== false }))
    }
    await $.command.register({ name: 'subagents', description: '打开子代理面板：派单原文、最近动作、回报' })
    return next(e)
  })

  on('command.run', { command: 'subagents' }, async $ => {
    await $.ui.open({ id: PANE, title: '子代理' })
    return { text: '子代理面板已打开。' }
  })

  on('tool.call', async ($, e, next) => {
    const call = e as unknown as { tool: string; agentId?: string } & Record<string, unknown>
    if (call.agentId !== undefined) {
      await trackStep($, call.agentId, describeStep(call), d => briefs.get(d) ?? null)
    } else if (call.tool === 'Agent' || call.tool === 'Task') {
      briefs.set(String(call.description ?? ''), String(call.prompt ?? ''))
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    // 只拦截本人在输入框里打的 ++，插件自己发出的提示不处理
    if (e.origin?.kind === 'composer') {
      if (ENHANCE_MARK.test(e.text) && e.text.replace(ENHANCE_MARK, '').trim()) {
        void enhance($, e.text)
        return { drop: '✨ 正在增强提示词，完成后会放回输入框' }
      }
    }
    lastPrompt = e.text
    await update($, suggestion, () => null)
    await update($, note, () => null)
    await update($, undo, () => null)
    return next(e)
  })

  // 发送前选的模型/强度在这里生效：改写主会话的每个模型请求，子代理不动
  on('turn.step', async function* ($, e, next) {
    const p = await read($, prefs)
    if (e.agentId !== undefined || (p.model === null && p.effort === null)) {
      return yield* next(e)
    }
    const model = p.model ?? e.model
    const effort = p.effort ?? e.effort
    // Haiku 不接受推理强度参数，带上会被拒
    if (/haiku/i.test(model) || effort === undefined) {
      const { effort: _dropped, ...rest } = e
      return yield* next({ ...rest, model })
    }
    return yield* next({ ...e, model, effort })
  })

  // 系统提示词里"你是哪个模型"那句按会话模型写死，插件改不到；只改请求不补这段，模型会照着那句自称会话模型。
  // 子代理不走这里（它们的请求也没被改写）；teammate 是别的循环借用主提示词，同样不补。
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    const { model } = await read($, prefs)
    if (model === null || model === e.model.replace(/\[1m\]$/i, '') || e.traits.includes('teammate')) return r
    const label = labelOf(MODELS, model)
    const text = `# 本会话实际回答的模型
助手栏把主对话的请求改由 ${label}（模型 ID：${model}）发送，你就是 ${label}。上文按会话默认模型 ${e.model} 写的"你是哪个模型"的说法不适用于你；说明自己是哪个模型时以这里为准。`
    return { sections: [...r.sections, { id: 'cc-copilot:model', text, scope: 'session' as const }] }
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    // 只给主会话出建议；子代理、被打断、没有文字回复的轮次跳过
    if (e.agentId) {
      await finishAgent($, e.agentId, e.answer ?? '')
      return result
    }
    if (e.isAborted || !e.answer?.trim() || !lastPrompt) return result
    const { suggest, expert } = await read($, prefs)
    if (!suggest) return result
    void (async () => {
      await update($, busy, () => 'suggesting')
      try {
        const r = await $.model.complete({
          model: 'haiku',
          system: expert ? `${SUGGEST_SYSTEM}\n${EXPERT_SUGGEST}` : SUGGEST_SYSTEM,
          prompt: `用户上一条请求：\n${clip(lastPrompt, 1500)}\n\n助手的回复：\n${clip(e.answer, 4000)}`,
          maxTokens: 100,
        })
        if (r.isAnswered) {
          const s = (r.text.trim().split('\n')[0] ?? '').replace(/^["“「]|["”」]$/g, '')
          await update($, suggestion, () => s)
          void $.prompt.suggest({ text: s })
        }
      } finally {
        await update($, busy, () => null)
      }
    })()
    return result
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const state = await read($, busy)
    if (e.props.hasSurvey || e.props.view?.agentId) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const tracks = await read($, agents)
    const running = tracks.filter(a => !a.isDone)
    const now = tracks.length ? await $.clock.now() : 0
    const cols = e.props.bodyColumns ?? 100
    // 配色：灰阶为主；青色 = 正在运行，黄色 = 等待中，高亮按钮 = 偏离默认的设置。不用表情符号做图标（两个系统上宽度不一致），只保留 ✨ 作为「增强」的标记。
    const agentRows = tracks.length ? (
      <Box flexDirection="column">
        {running.slice(-3).map(a => (
          <Text>
            <Text color="cyan">●</Text> {a.type} <Text dimColor>{clipW(`${a.description} · ${a.recent.at(-1) ?? '启动中'}`, Math.max(20, cols - a.type.length - 24))} · {a.steps} 步 · {mmss(now - a.startedAt)}</Text>
          </Text>
        ))}
        <Box gap={1}>
          <Button key="agents" label={`子代理 ${running.length} 在跑 / 共 ${tracks.length}`} hotkey="a" dimColor={running.length === 0} onPress={() => $.ui.open({ id: PANE, title: '子代理' })} />
        </Box>
      </Box>
    ) : null

    // 主对话在干活时只留子代理这几行，不挡输出
    if (e.props.isWorking && state !== 'enhancing') return agentRows ?? next(e)

    const p = await read($, prefs)
    const s = p.suggest ? await read($, suggestion) : null
    const u = await read($, undo)
    const n = await read($, note)
    const open = await read($, isOpen)

    const status =
      state === 'enhancing' ? (
        <Text color="yellow">✨ 正在增强…</Text>
      ) : s ? (
        <Text>
          <Text dimColor>下一步 </Text>
          {clipW(s, Math.max(20, cols - 20))}
          <Text dimColor> · Tab 采用</Text>
        </Text>
      ) : n ? (
        <Text dimColor>{n}</Text>
      ) : null

    const modelButton = (
      <Button key="model" label={`模型 ${labelOf(MODELS, p.model)}`} hotkey="m" variant={p.model ? 'primary' : 'secondary'} dimColor={!p.model} onPress={() => setPrefs($, { model: nextOf(MODELS, p.model) })} />
    )
    const effortButton = (
      <Button key="effort" label={`强度 ${labelOf(EFFORTS, p.effort)}`} hotkey="r" variant={p.effort ? 'primary' : 'secondary'} dimColor={!p.effort} onPress={() => setPrefs($, { effort: nextOf(EFFORTS, p.effort) })} />
    )

    return (
      <Box flexDirection="column">
        {agentRows}
        {status ? <Box>{status}</Box> : null}
        <Box gap={1}>
          <Button key="enhance" label="✨ 增强" hotkey="e" onPress={async () => enhance($, (await $.prompt.read()).text)} />
          {u ? (
            <Button
              key="undo"
              label="撤销"
              hotkey="u"
              onPress={async () => {
                await $.prompt.fill({ text: u, mode: 'replace' })
                await update($, undo, () => null)
                await update($, note, () => '已恢复原稿')
              }}
            />
          ) : null}
          {/* 收起时，只有偏离默认的模型/强度才露出来，提醒"这条消息不是按默认发的" */}
          {!open && p.model ? modelButton : null}
          {!open && p.effort ? effortButton : null}
          <Button key="more" label={open ? '收起' : '设置'} hotkey="o" dimColor onPress={() => update($, isOpen, v => !v)} />
        </Box>
        {open ? (
          <Box flexDirection="column">
            <Box gap={1}>
              <Text dimColor>发送</Text>
              {modelButton}
              {effortButton}
            </Box>
            <Box gap={1}>
              <Text dimColor>增强</Text>
              <Button key="style" label={`风格 ${labelOf(STYLES, p.style)}`} hotkey="s" dimColor onPress={() => setPrefs($, { style: nextOf(STYLES, p.style) })} />
              <Button key="expert" label={`专家 ${p.expert ? '开' : '关'}`} hotkey="x" dimColor onPress={() => setPrefs($, { expert: !p.expert })} />
              <Text dimColor>建议</Text>
              <Button key="suggest" label={p.suggest ? '开' : '关'} hotkey="n" dimColor onPress={() => setPrefs($, { suggest: !p.suggest })} />
            </Box>
          </Box>
        ) : null}
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const tracks = await read($, agents)
    const now = await $.clock.now()

    return (
      <Box flexDirection="column">
        {tracks.length === 0 ? <Text dimColor>本会话还没有子代理。派出后这里会显示：派单原文、最近动作、回报。</Text> : null}
        {[...tracks].reverse().map(a => (
          <Box flexDirection="column" marginBottom={1}>
            <Text>
              <Text color={a.isDone ? 'green' : 'cyan'}>
                {a.isDone ? '✓' : '●'} {a.type}
              </Text>{' '}
              {a.description}
              <Text dimColor>
                {' '}· {a.steps} 步 · {mmss((a.endedAt ?? now) - a.startedAt)}
              </Text>
            </Text>
            <Text dimColor>派单：{a.brief ? clip(a.brief.replace(/\s+/g, ' '), 400) : '（没截到派单原文）'}</Text>
            {a.recent.map(step => (
              <Text dimColor>  · {step}</Text>
            ))}
            {a.answer !== null ? <Text>回报：{clip(a.answer, 1200) || '（空）'}</Text> : null}
          </Box>
        ))}
      </Box>
    )
  })
}

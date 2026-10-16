// 输入框上方的助手栏：
// 1. 「✨ 增强」按所选风格改写草稿（可选，不点就不发生），会参考最近对话、这几轮读写过的文件和命令、项目 CLAUDE.md 开头，原稿可撤销；栏里写明参考了什么；
//    进行中可点「取消」，超过 60 秒自动放弃，两种情况原稿都不动；
//    键盘党：草稿末尾加 ++ 再回车，不发送，改为增强后放回输入框；
// 2. 每轮结束后预测"下一步"，作为栏内提示和输入框灰字建议（Tab 采用），可关；
// 3. 「专家」开关：增强和建议先判断任务属于哪个领域，按该领域行家的标准来写；
// 4. 子代理可见：栏里实时显示每个子代理正在做的那一步，「子代理」面板里看派单原文、最近动作和回报。
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { AgentTrack, Busy, Prefs, Style } from '../types'

const suggestion = atom({ plugin: 'cc-copilot', key: 'suggestion' } as const, null as string | null)
const busy = atom({ plugin: 'cc-copilot', key: 'busy' } as const, null as Busy)
const undo = atom({ plugin: 'cc-copilot', key: 'undo' } as const, null as string | null)
const note = atom({ plugin: 'cc-copilot', key: 'note' } as const, null as string | null)
const prefs = atom({ plugin: 'cc-copilot', key: 'prefs' } as const, { style: 'structured', suggest: true, expert: true } as Prefs)
const isOpen = atom({ plugin: 'cc-copilot', key: 'isOpen' } as const, false)
const agents = atom({ plugin: 'cc-copilot', key: 'agents' } as const, [] as AgentTrack[])

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
// 草稿不超过这个字数时，默认风格自动降为精简
const SHORT_DRAFT = 20
// 增强最多等这么久；Sonnet 写满 1500 token 通常 20～30 秒，留一倍余量
const ENHANCE_TIMEOUT_MS = 60_000
// 正在进行的那次增强；「取消」按钮通过它中止。放在模块级是因为按钮的处理器和发起增强的处理器不是同一个
let enhancing: AbortController | null = null
const STORE_KEY = 'prefs'

const enhanceSystem = (rule: string, expert = false) => `你是提示词优化助手。用户会给你一段准备发给 Claude Code（能读写文件、运行命令、调研和写作的 AI 工作搭档）的草稿，把它改写成更清晰、可直接执行的指令。
规则：
- 保留原意、语言和口吻；不添加草稿和对话里都没有的事实、数字、文件名、客户名。
- ${rule}${expert ? `\n- ${EXPERT_RULE}` : ''}
- 你会看到"最近对话"作为背景：草稿里的"这个/这些/它/刚才那个"能从对话里确定指什么，就直接写明，不要再问。对话里"动作"一行列的是助手真实读写过的文件、跑过的命令，草稿说"那个文件/刚改的/刚才跑的"时直接点名。
- 你可能看到"项目规则"（仓库 CLAUDE.md 的开头）：改写后的指令不要和它冲突，但不要把规则原文抄进指令。
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
  // 风格和开关跨会话记住
  await $.store.set(STORE_KEY, { style: p.style, suggest: p.suggest, expert: p.expert })
}

// 背景材料：最近对话 + 这几轮助手真实做过的事 + 项目规则。返回正文和参考范围（显示给用户，让他知道增强依据了什么）
type Context = { text: string; turns: number; files: number; hasRules: boolean }

// 工具调用压成"动作"短语：只保留能让改写点名的信息（文件路径、命令、派单描述）
function describeUse(u: { tool: string; input: Record<string, unknown> }): { verb: string; what: string } | null {
  const i = u.input
  const file = typeof i.file_path === 'string' ? i.file_path : typeof i.path === 'string' ? i.path : ''
  switch (u.tool) {
    case 'Read':
      return file ? { verb: '读', what: file } : null
    case 'Edit':
    case 'MultiEdit':
    case 'Write':
    case 'NotebookEdit':
      return file ? { verb: '改', what: file } : null
    case 'Bash':
    case 'PowerShell':
      return { verb: '跑', what: String(i.description ?? i.command ?? '') }
    case 'Agent':
    case 'Task':
      return { verb: '派子代理', what: String(i.description ?? '') }
    case 'Grep':
    case 'Glob':
      return { verb: '搜', what: String(i.pattern ?? '') }
    default:
      return null
  }
}

async function recentContext($: EngineInterface): Promise<Context> {
  const all = await $.session.messages()
  const files = new Set<string>()
  const lines: string[] = []
  const recent = Array.isArray(all) ? all.filter(m => m.text?.trim() || m.toolUses?.length).slice(-10) : []
  for (const m of recent) {
    if (m.text?.trim()) lines.push(`${m.role === 'user' ? '用户' : '助手'}：${clip(m.text.trim(), 600)}`)
    // 同一条消息里的动作按动词归并：读 a、b；改 c；跑 xxx
    const byVerb = new Map<string, string[]>()
    for (const u of m.toolUses ?? []) {
      const d = describeUse(u)
      if (!d || !d.what) continue
      if (d.verb === '读' || d.verb === '改') files.add(d.what)
      const list = byVerb.get(d.verb) ?? []
      if (!list.includes(d.what)) list.push(d.what)
      byVerb.set(d.verb, list)
    }
    if (byVerb.size) {
      const acts = [...byVerb].map(([verb, what]) => `${verb} ${what.slice(0, 6).map(w => clip(w.replace(/\s+/g, ' '), 80)).join('、')}${what.length > 6 ? ` 等 ${what.length} 项` : ''}`)
      lines.push(`  动作：${acts.join('；')}`)
    }
  }
  // 项目规则只取开头：够看出项目是什么、有哪些硬约束；读不到（没有这个文件）就不带
  let rules = ''
  try {
    const raw = await $.fs.read('CLAUDE.md')
    if (typeof raw === 'string') rules = clip(raw.trim(), 1500)
  } catch {
    rules = ''
  }
  const parts: string[] = []
  if (rules) parts.push(`项目规则（仓库 CLAUDE.md 开头，改写要遵守、不要抄入）：\n${rules}`)
  if (lines.length) parts.push(`最近对话（仅作背景，不要改写它）：\n${lines.join('\n')}`)
  return { text: parts.join('\n\n'), turns: recent.length, files: files.size, hasRules: Boolean(rules) }
}

// 参考范围的一句话，显示在栏里
const describeContext = (c: Context) => {
  const bits: string[] = []
  if (c.turns) bits.push(`最近 ${c.turns} 条对话`)
  if (c.files) bits.push(`${c.files} 个文件`)
  if (c.hasRules) bits.push('项目规则')
  return bits.length ? `参考了${bits.join('、')}` : '没有可参考的对话和项目规则'
}

// from：按钮点的，还是草稿末尾 ++ 回车触发的。++ 是把提交拦下来的，输入框可能已清空，失败时要把原稿放回去
async function enhance($: EngineInterface, draft: string, from: 'button' | 'mark' = 'button') {
  const text = draft.replace(ENHANCE_MARK, '').trim()
  if (!text) {
    $.ui.toast('先在输入框写个草稿，再点增强')
    return
  }
  // 已有一次在跑就不再发第二次，否则「取消」不知道该停哪个，撤销也会存错原稿
  if ((await read($, busy)) === 'enhancing') {
    $.ui.toast('正在增强，等它完成或点取消')
    return
  }
  const stop = new AbortController()
  enhancing = stop
  await update($, busy, () => 'enhancing')
  await update($, note, () => null)
  const restore = async () => {
    if (from !== 'mark') return
    if (!(await $.prompt.read()).text.trim()) await $.prompt.fill({ text, mode: 'replace' })
  }
  try {
    const { style, expert } = await read($, prefs)
    // 默认风格下，很短的草稿不套结构骨架，按精简处理，免得一句话被撑成一页
    const effective: Style = style === 'structured' && text.length <= SHORT_DRAFT ? 'concise' : style
    const rule = STYLES.find(s => s.id === effective)?.rule ?? STYLES[0]!.rule
    const context = await recentContext($)
    const r = await $.model.complete(
      {
        model: 'sonnet',
        system: enhanceSystem(rule, expert),
        prompt: `${context.text ? `${context.text}\n\n` : ''}草稿：\n${text}`,
        maxTokens: 1500,
        timeoutMs: ENHANCE_TIMEOUT_MS,
      },
      { signal: stop.signal },
    )
    // 用户已取消：哪怕模型恰好在这一刻返回了，也不往输入框里填
    if (stop.signal.aborted) {
      await update($, note, () => '已取消，原稿未改动')
      await restore()
      return
    }
    if (!r.isAnswered) {
      // 失败要说出来，原稿留在输入框不动
      const why = r.reason === 'aborted' ? `增强超时（${ENHANCE_TIMEOUT_MS / 1000} 秒）` : `增强失败（${r.reason}）`
      await update($, note, () => `${why}，原稿未改动`)
      await restore()
      return
    }
    await update($, undo, () => text)
    const filled = await $.prompt.fill({ text: r.text.trim(), mode: 'replace' })
    const how = effective !== style ? `草稿短，按精简处理，${describeContext(context)}` : describeContext(context)
    await update($, note, () => (filled.isFilled ? `已增强（${how}），检查后回车；不满意按撤销` : '输入框暂时不可写，稍后再试'))
  } finally {
    if (enhancing === stop) enhancing = null
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
        void enhance($, e.text, 'mark')
        return { drop: '✨ 正在增强提示词，完成后会放回输入框' }
      }
    }
    lastPrompt = e.text
    await update($, suggestion, () => null)
    await update($, note, () => null)
    await update($, undo, () => null)
    return next(e)
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
        <Text color="yellow">✨ 正在增强…<Text dimColor>（最多 {ENHANCE_TIMEOUT_MS / 1000} 秒，可点取消）</Text></Text>
      ) : s ? (
        <Text>
          <Text dimColor>下一步 </Text>
          {clipW(s, Math.max(20, cols - 20))}
          <Text dimColor> · Tab 采用</Text>
        </Text>
      ) : n ? (
        <Text dimColor>{n}</Text>
      ) : null

    return (
      <Box flexDirection="column">
        {agentRows}
        {status ? <Box>{status}</Box> : null}
        <Box gap={1}>
          {state === 'enhancing' ? (
            // 快捷键不用 e：增强中误按两下不该变成取消
            <Button key="cancel" label="取消" hotkey="c" onPress={() => enhancing?.abort()} />
          ) : (
            <Button key="enhance" label="✨ 增强" hotkey="e" onPress={async () => enhance($, (await $.prompt.read()).text)} />
          )}
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
          <Button key="more" label={open ? '收起' : '设置'} hotkey="o" dimColor onPress={() => update($, isOpen, v => !v)} />
        </Box>
        {open ? (
          <Box gap={1}>
            <Text dimColor>增强</Text>
            <Button key="style" label={`风格 ${labelOf(STYLES, p.style)}`} hotkey="s" dimColor onPress={() => setPrefs($, { style: nextOf(STYLES, p.style) })} />
            <Button key="expert" label={`专家 ${p.expert ? '开' : '关'}`} hotkey="x" dimColor onPress={() => setPrefs($, { expert: !p.expert })} />
            <Text dimColor>建议</Text>
            <Button key="suggest" label={p.suggest ? '开' : '关'} hotkey="n" dimColor onPress={() => setPrefs($, { suggest: !p.suggest })} />
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

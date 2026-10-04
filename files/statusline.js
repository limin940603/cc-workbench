#!/usr/bin/env node
// 工作台状态栏：模型/项目/账号/时长、上下文、配置数、工具统计、运行中任务与子代理、令牌。
// 零依赖；转录文件按偏移增量解析并缓存，避免长会话每次全量读取拖慢刷新。
const fs = require('fs');
const os = require('os');
const path = require('path');

const TITLE = process.env.CC_STATUS_TITLE || 'Claude Code';
// 录屏、截图分享时可以隐藏账号：CC_STATUS_HIDE_ACCOUNT=1
const HIDE_ACCOUNT = process.env.CC_STATUS_HIDE_ACCOUNT === '1';
const HOME = os.homedir();
// 配色原则：灰阶为主，橙色只给标题，青色只给"正在运行"，黄/红只在告警时出现。
// 只用 16 色和 256 色里两端主题都清楚的颜色；不用蓝色（Windows 终端默认主题里太暗）。
const C = { dim: '\x1b[38;5;245m', bold: '\x1b[1m', red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', orange: '\x1b[38;5;208m', reset: '\x1b[0m' };
const paint = (c, s) => (c ? C[c] + s + C.reset : s);
const sep = paint('dim', ' │ ');
// 中日韩字符占两格；按显示宽度截断，避免一行被长会话名撑爆
const clipW = (str, max) => {
  let w = 0, out = '';
  for (const ch of String(str)) {
    w += ch.codePointAt(0) > 0x2e7f ? 2 : 1;
    if (w > max) return out + '…';
    out += ch;
  }
  return out;
};

// claude-opus-5-5 → Opus 5.5，claude-haiku-4-5-20251001 → Haiku 4.5；认不出的原样显示
const modelName = (id) => {
  const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(\[1m\])?$/i.exec(id);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] ? '.' + m[3] : ''}${m[4] ? ' (1M)' : ''}` : id;
};

const readJSON = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const exists = (p) => { try { return fs.existsSync(p); } catch { return false; } };

function fmtDur(ms) {
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

// ---------- 转录增量解析 ----------
function newState() {
  return { offset: 0, tools: {}, pending: {}, agents: {}, lastCtx: 0, lastModel: '' };
}
function parseTranscript(tp) {
  if (!tp || !exists(tp)) return newState();
  const cacheFile = path.join(os.tmpdir(), 'cc-statusline-' + Buffer.from(tp).toString('base64url').slice(-40) + '.json');
  let st = readJSON(cacheFile);
  if (!st || st.lastModel === undefined) st = newState(); // 旧版缓存缺新字段，整份重解析一次
  const size = fs.statSync(tp).size;
  if (size < st.offset) st = newState(); // 文件被重写（如压缩），重新解析
  if (size > st.offset) {
    const fd = fs.openSync(tp, 'r');
    const buf = Buffer.alloc(size - st.offset);
    fs.readSync(fd, buf, 0, buf.length, st.offset);
    fs.closeSync(fd);
    const text = buf.toString('utf8');
    const lastNL = text.lastIndexOf('\n');
    if (lastNL >= 0) {
      for (const line of text.slice(0, lastNL).split('\n')) {
        if (!line.trim()) continue;
        let d; try { d = JSON.parse(line); } catch { continue; }
        ingest(st, d);
      }
      st.offset += Buffer.byteLength(text.slice(0, lastNL + 1), 'utf8');
    }
    try { fs.writeFileSync(cacheFile, JSON.stringify(st)); } catch {}
  }
  return st;
}
function ingest(st, d) {
  const m = d.message;
  if (!m) return;
  // 后台子代理完成时会以 task-notification 形式回到主会话
  if (d.type === 'user' && typeof m.content === 'string' && m.content.includes('task-notification')) {
    const open = Object.values(st.agents).filter((a) => !a.done);
    const hit = open.find((a) => a.desc && m.content.includes(a.desc)) || open[0];
    if (hit) hit.done = true;
    return;
  }
  if (!Array.isArray(m.content)) return;
  const ts = Date.parse(d.timestamp) || Date.now();
  if (d.type === 'assistant') {
    const u = m.usage;
    if (u && !d.isSidechain) {
      st.lastCtx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    // 实际回答的模型以回复记录为准：限流降级等情况下，会和会话默认模型不同。<synthetic> 是本地生成的报错提示，不算
    if (!d.isSidechain && m.model && m.model !== '<synthetic>') st.lastModel = m.model;
    for (const b of m.content) {
      if (b.type !== 'tool_use' || d.isSidechain) continue;
      const inp = b.input || {};
      if (b.name === 'Agent' || b.name === 'Task') {
        st.agents[b.id] = { type: inp.subagent_type || 'general-purpose', model: inp.model || '', desc: inp.description || '', start: ts, done: false };
      } else {
        st.pending[b.id] = { name: b.name, desc: inp.description || inp.command || inp.file_path || inp.pattern || '', start: ts, bg: !!inp.run_in_background };
      }
    }
  } else if (d.type === 'user') {
    for (const b of m.content) {
      if (b.type !== 'tool_result') continue;
      const p = st.pending[b.tool_use_id];
      if (p) {
        const k = p.name.startsWith('mcp__') ? 'MCP' : p.name;
        const t = st.tools[k] || (st.tools[k] = { ok: 0, err: 0 });
        b.is_error ? t.err++ : t.ok++;
        delete st.pending[b.tool_use_id];
      }
      const a = st.agents[b.tool_use_id];
      if (a) {
        // 后台子代理会立刻返回"已启动"，真正完成看后续通知；这里按返回内容粗判
        const txt = JSON.stringify(b.content || '');
        a.done = !/background|后台|running/i.test(txt) || !!b.is_error;
        a.end = ts;
      }
    }
  }
  for (const a of Object.values(st.agents)) {
    if (!a.done && Date.now() - a.start > 3 * 3600e3) a.done = true; // 兜底，防止僵尸项常驻
  }
}

// ---------- 配置计数 ----------
function countConfig(cwd, projectDir) {
  let md = 0, mcp = 0, hooks = 0;
  const dirs = [...new Set([projectDir, cwd].filter(Boolean))];
  const mdFiles = [path.join(HOME, '.claude', 'CLAUDE.md'), ...dirs.flatMap((d) => [path.join(d, 'CLAUDE.md'), path.join(d, 'CLAUDE.local.md'), path.join(d, '.claude', 'CLAUDE.md')])];
  for (const p of new Set(mdFiles.map((f) => path.resolve(f)))) if (exists(p)) md++;
  const g = readJSON(path.join(HOME, '.claude.json')) || {};
  mcp += Object.keys(g.mcpServers || {}).length;
  for (const d of dirs) {
    const proj = (g.projects || {})[d.replace(/\\/g, '/')] || {};
    mcp += Object.keys(proj.mcpServers || {}).length;
    mcp += Object.keys((readJSON(path.join(d, '.mcp.json')) || {}).mcpServers || {}).length;
  }
  const settingsFiles = [path.join(HOME, '.claude', 'settings.json'), ...dirs.flatMap((d) => [path.join(d, '.claude', 'settings.json'), path.join(d, '.claude', 'settings.local.json')])];
  const enabled = {};
  for (const f of [...new Set(settingsFiles.map((f) => path.resolve(f)))]) {
    const s = readJSON(f); if (!s) continue;
    Object.assign(enabled, s.enabledPlugins || {});
    for (const arr of Object.values(s.hooks || {})) for (const h of arr || []) hooks += (h.hooks || []).length;
  }
  const inst = (readJSON(path.join(HOME, '.claude', 'plugins', 'installed_plugins.json')) || {}).plugins || {};
  for (const [name, on] of Object.entries(enabled)) {
    if (!on || !inst[name]) continue;
    const dir = inst[name][0].installPath;
    const pm = readJSON(path.join(dir, '.mcp.json'));
    if (pm) mcp += Object.keys(pm.mcpServers || pm).length;
    const ph = readJSON(path.join(dir, 'hooks', 'hooks.json'));
    if (ph) for (const arr of Object.values(ph.hooks || {})) for (const h of arr || []) hooks += (h.hooks || []).length;
  }
  return { md, mcp, hooks };
}

// ---------- 渲染 ----------
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let inp = {};
  try { inp = JSON.parse(raw); } catch {}
  const cwd = inp.cwd || inp.workspace?.current_dir || process.cwd();
  const projectDir = inp.workspace?.project_dir || cwd;
  const st = parseTranscript(inp.transcript_path);
  const lines = [];

  // 第 1 行：模型 | 项目 | 会话 | 账号 · 套餐 | 时长
  const oa = (readJSON(path.join(HOME, '.claude.json')) || {}).oauthAccount || {};
  const plan = { claude_max: 'Claude Max', claude_pro: 'Claude Pro', claude_team: 'Claude Team', claude_enterprise: 'Claude Enterprise' }[oa.organizationType] || '';
  // 邮箱打码：截图发内容时不暴露完整账号
  const email = (oa.emailAddress || '').replace(/^(.{4}).*(@.*)$/, '$1***$2');
  // 推理强度跟模型放一起：两者共同决定这一轮的质量和消耗
  const effort = typeof inp.effort === 'string' ? inp.effort : inp.effort?.level;
  const shown = inp.model?.display_name || inp.model?.id || 'Claude';
  // 输入里的 model/effort 只是会话默认；上一轮实际由别的模型回答时，实际模型放前面，默认值退为注释，免得被当成实际用的模型
  const actual = st.lastModel && st.lastModel !== String(inp.model?.id || '').replace(/\[1m\]$/i, '') ? st.lastModel : '';
  const head = actual
    ? paint('bold', modelName(actual)) + paint('dim', ` 上轮实际 · 默认 ${shown}${effort ? ' · ' + effort : ''}`)
    : paint('bold', shown) + (effort ? paint('dim', ' · ' + effort) : '');
  const l1 = [head, path.basename(projectDir) || projectDir];
  if (inp.session_name) l1.push(paint('dim', clipW(inp.session_name, 28)));
  if (!HIDE_ACCOUNT && (email || plan)) l1.push(paint('dim', [email, plan].filter(Boolean).join(' · ')));
  if (inp.cost?.total_duration_ms) l1.push(paint('dim', fmtDur(inp.cost.total_duration_ms)));
  lines.push(l1.join(sep));

  // 标题 + 配置数（静态信息并一行，省出空间给动态信息）
  const cfg = countConfig(cwd, projectDir);
  lines.push(paint('orange', TITLE) + '  ' + paint('dim', `${cfg.md} CLAUDE.md · ${cfg.mcp} MCPs · ${cfg.hooks} 钩子`));

  // 余量一行：上下文 | 5 小时额度 | 周额度
  // 8 格进度条：三段并排时整行控制在 80 列左右，窄窗口也不折行
  const BAR = 8;
  const bar = (p) => {
    p = Math.max(0, Math.min(100, Math.round(p || 0)));
    // 用量正常时不上色，颜色留给需要注意的时候；有用量但不足一格时也亮一格，避免"用了却全空"
    const n = p > 0 ? Math.max(1, Math.round((p / 100) * BAR)) : 0, c = p >= 80 ? 'red' : p >= 60 ? 'yellow' : null;
    return `${paint(c, '█'.repeat(n))}${paint('dim', '░'.repeat(BAR - n))} ${paint(c, p + '%')}`;
  };
  const reset = (ts, withDay) => {
    if (!ts) return '';
    const d = new Date(ts * 1000), hm = d.toTimeString().slice(0, 5);
    return paint('dim', ` ${withDay ? `${d.getMonth() + 1}/${d.getDate()} ` : ''}${hm}重置`);
  };
  const cw = inp.context_window || {};
  const size = cw.context_window_size || (/1m|1M/.test(inp.model?.id || inp.model?.display_name || '') ? 1e6 : 2e5);
  const ctxPct = cw.used_percentage ?? (st.lastCtx ? (st.lastCtx / size) * 100 : 0);
  const quota = [`${paint('dim', '上下文')} ${bar(ctxPct)}`];
  const rl = inp.rate_limits; // 仅订阅账号登录时有
  if (rl) {
    // 5 小时窗口刚重置、还没用量时字段可能暂缺，显示 0% 而不是整段消失
    const fh = rl.five_hour || {};
    quota.push(`${paint('dim', '5小时')} ${bar(fh.used_percentage)}${reset(fh.resets_at, false)}`);
    if (rl.seven_day) quota.push(`${paint('dim', '本周')} ${bar(rl.seven_day.used_percentage)}${reset(rl.seven_day.resets_at, true)}`);
  }
  lines.push(quota.join(sep));

  // 工具统计（按次数降序，最多 6 个）
  const tools = Object.entries(st.tools).sort((a, b) => b[1].ok + b[1].err - a[1].ok - a[1].err).slice(0, 6);
  if (tools.length) {
    lines.push(tools.map(([n, t]) => paint('dim', `${n} ${t.ok}`) + (t.err ? paint('red', ` ✗${t.err}`) : '')).join(paint('dim', ' · ')));
  }

  // 运行中的工具：长下载/安装在这里能看到已等多久
  const now = Date.now();
  for (const p of Object.values(st.pending).slice(-3)) {
    const el = now - p.start;
    const color = el > 120e3 ? 'red' : el > 30e3 ? 'yellow' : 'cyan';
    const desc = String(p.desc).replace(/\s+/g, ' ').slice(0, 60);
    lines.push(`${paint(color, '●')} ${p.name}${p.bg ? paint('dim', ' 后台') : ''} ${paint('dim', desc)} ${paint(color, fmtDur(el))}`);
  }

  // 子代理
  const agents = Object.values(st.agents).filter((a) => !a.done).slice(-4);
  for (const a of agents) {
    lines.push(`${paint('cyan', '●')} ${a.type}${a.model ? paint('dim', ` ${a.model}`) : ''} ${paint('dim', a.desc)} ${paint('dim', fmtDur(now - a.start))}`);
  }

  process.stdout.write(lines.join('\n'));
});

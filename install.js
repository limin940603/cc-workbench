#!/usr/bin/env node
// Claude Code 工作台一键安装/卸载（Windows / macOS / Linux 通用，零依赖）。
//   node install.js                    安装或更新（可重复执行，结果一致）
//   node install.js --title "我的台子"  自定义状态栏标题（写入 settings.json 的 env）
//   node install.js --no-claude-md     不往 ~/.claude/CLAUDE.md 写"执行方式"规则
//   node install.js --uninstall        卸载，只移除本工具写入的内容
// 改 settings.json / CLAUDE.md 之前都会先备份到 ~/.claude/backups/。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VERSION = '0.3.0';
const MIN_CLAUDE = [2, 1, 287]; // 提示词助手依赖的函数钩子插件接口从这个版本起可用

function parseArgs(argv) {
  const a = { flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--title') {
      a.title = argv[++i];
      if (a.title === undefined) throw new Error('--title 缺少取值');
    } else if (['--uninstall', '--no-claude-md', '--help', '-h'].includes(argv[i])) a.flags.add(argv[i]);
    else throw new Error(`不认识的参数：${argv[i]}（用 --help 查看用法）`);
  }
  return a;
}

// 测试时可指向临时目录、模拟另一个系统；正常使用不需要设置
const HOME = process.env.CC_WORKBENCH_HOME || os.homedir();
const PLATFORM = process.env.CC_WORKBENCH_PLATFORM || process.platform;
const IS_WIN = PLATFORM === 'win32';
const DELIM = IS_WIN ? ';' : ':'; // CLAUDE_CODE_PLUGIN_DIRS 的分隔符跟随系统
const CLAUDE = path.join(HOME, '.claude');
const SRC = path.join(__dirname, 'files');
const PLUGIN = 'cc-copilot';
const LEGACY_PLUGINS = ['jevin-copilot']; // 0.2 及以前的插件名，升级时清理

const T = {
  statusline: path.join(CLAUDE, 'statusline.js'),
  inventory: path.join(CLAUDE, 'env-inventory.js'),
  inventoryCache: path.join(CLAUDE, 'env-inventory.md'),
  mods: path.join(CLAUDE, 'mods'),
  mod: path.join(CLAUDE, 'mods', PLUGIN),
  settings: path.join(CLAUDE, 'settings.json'),
  claudeMd: path.join(CLAUDE, 'CLAUDE.md'),
  skill: path.join(CLAUDE, 'skills', 'cc-workbench'),
};
const MD_START = '<!-- cc-workbench:start -->';
const MD_END = '<!-- cc-workbench:end -->';
const MD_HEADING = '## 执行方式（少等待、看得见、及时换路）';

// 写进 settings 的路径统一用正斜杠，Windows 的 Git Bash 和 cmd 都认
const fwd = (p) => p.replace(/\\/g, '/');
// Windows 上 node 在 PATH 里很稳定；macOS 从 Finder/GUI 启动的 Claude 常找不到 nvm/Homebrew 的 node，用绝对路径
const nodeCmd = IS_WIN ? 'node' : `"${process.execPath}"`;
const statusCmd = `${nodeCmd} "${fwd(T.statusline)}"`;
const inventoryCmd = `${nodeCmd} "${fwd(T.inventory)}"`;
const isOurPluginDir = (d) => [PLUGIN, ...LEGACY_PLUGINS].some((n) => new RegExp(`(^|[\\\\/])${n}[\\\\/]?$`).test(d));
// 从插件目录列表里去掉本工具的条目：先按完整路径精确删除（不受路径里自带冒号影响），再按目录名兜底
function withoutOurDirs(list) {
  let rest = list || '';
  for (const n of [PLUGIN, ...LEGACY_PLUGINS]) rest = rest.split(fwd(path.join(T.mods, n))).join('');
  return rest.split(DELIM).filter((d) => d && !isOurPluginDir(d));
}

const log = (s) => console.log(s);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);

function backup(file) {
  if (!fs.existsSync(file)) return;
  const dir = path.join(CLAUDE, 'backups');
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, `${path.basename(file)}.bak-${stamp}`);
  fs.copyFileSync(file, to);
  log(`  备份 ${path.basename(file)} → ${to}`);
}

function readSettings() {
  if (!fs.existsSync(T.settings)) return {};
  try {
    return JSON.parse(fs.readFileSync(T.settings, 'utf8'));
  } catch (e) {
    // settings 坏了不能硬覆盖，交给用户处理
    throw new Error(`${T.settings} 不是合法 JSON，先修好再装：${e.message}`);
  }
}
const writeSettings = (s) => fs.writeFileSync(T.settings, JSON.stringify(s, null, 2) + '\n');

const isOurHook = (h) => /env-inventory\.js/.test(h.command || '');
const isOurStatus = (sl) => sl && fwd(sl.command || '').includes(fwd(T.statusline));
const samePath = (a, b) => {
  try { return fs.realpathSync(a) === fs.realpathSync(b); } catch { return false; }
};

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 18) throw new Error(`需要 Node.js 18 以上，当前 ${process.version}`);
}

// 只提示不拦截：Claude Code 版本不够时，其他三项照常可用
function checkClaude() {
  if (process.env.CC_WORKBENCH_SKIP_CLAUDE_CHECK) return;
  const r = spawnSync('claude --version', { shell: true, encoding: 'utf8', timeout: 15000, windowsHide: true });
  const m = (r.stdout || '').match(/(\d+)\.(\d+)\.(\d+)/);
  if (!m) return log('  ! 没检测到 Claude Code（claude 命令不在 PATH 里）。装完后状态栏等功能在 Claude Code 里才生效');
  const v = m.slice(1).map(Number);
  const diff = v[0] - MIN_CLAUDE[0] || v[1] - MIN_CLAUDE[1] || v[2] - MIN_CLAUDE[2];
  if (diff < 0) log(`  ! Claude Code ${m[0]} 低于 ${MIN_CLAUDE.join('.')}：提示词助手栏不会加载，其他功能正常。升级：claude update`);
}

function install(args) {
  checkNode();
  log(`安装 Claude Code 工作台 v${VERSION} → ${CLAUDE}`);
  checkClaude();
  fs.mkdirSync(CLAUDE, { recursive: true });

  // 1. 脚本与插件（顺手清掉旧版插件目录）
  fs.copyFileSync(path.join(SRC, 'statusline.js'), T.statusline);
  fs.copyFileSync(path.join(SRC, 'env-inventory.js'), T.inventory);
  for (const old of LEGACY_PLUGINS) fs.rmSync(path.join(T.mods, old), { recursive: true, force: true });
  fs.rmSync(T.mod, { recursive: true, force: true });
  fs.mkdirSync(T.mods, { recursive: true });
  fs.cpSync(path.join(SRC, PLUGIN), T.mod, { recursive: true });
  log('  ✓ 状态栏、环境清单脚本、提示词助手插件');

  // 2. settings.json：只增改本工具的几项，其他配置原样保留
  const s = readSettings();
  backup(T.settings);
  if (s.statusLine && !isOurStatus(s.statusLine)) log(`  ! 原有状态栏配置被替换（已在备份里）：${s.statusLine.command}`);
  s.statusLine = { type: 'command', command: statusCmd, padding: 0 };

  s.hooks = s.hooks || {};
  const ss = (s.hooks.SessionStart = (s.hooks.SessionStart || []).map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurHook(h)) })).filter((g) => g.hooks.length));
  ss.push({ matcher: 'startup|clear', hooks: [{ type: 'command', command: inventoryCmd, timeout: 30 }] });

  s.env = s.env || {};
  const dirs = withoutOurDirs(s.env.CLAUDE_CODE_PLUGIN_DIRS);
  dirs.push(fwd(T.mod));
  s.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(DELIM);
  if (args.title !== undefined) s.env.CC_STATUS_TITLE = args.title;
  writeSettings(s);
  log(`  ✓ settings.json：statusLine、SessionStart 钩子、插件目录${args.title !== undefined ? `、标题"${args.title}"` : ''}`);

  // 3. CLAUDE.md 执行方式规则（用标记包起来，便于更新和卸载）
  if (!args.flags.has('--no-claude-md')) {
    const block = `${MD_START}\n${fs.readFileSync(path.join(SRC, 'claude-md-exec.md'), 'utf8').trim()}\n${MD_END}`;
    const md = fs.existsSync(T.claudeMd) ? fs.readFileSync(T.claudeMd, 'utf8') : '';
    let next;
    if (md.includes(MD_START) && md.includes(MD_END)) {
      next = md.slice(0, md.indexOf(MD_START)) + block + md.slice(md.indexOf(MD_END) + MD_END.length);
    } else if (md.includes(MD_HEADING)) {
      next = null; // 用户手写过同名章节，不重复插入
      log('  - CLAUDE.md 已有"执行方式"章节，跳过');
    } else {
      next = (md.trimEnd() ? md.trimEnd() + '\n\n' : '') + block + '\n';
    }
    if (next !== null && next !== md) {
      backup(T.claudeMd);
      fs.writeFileSync(T.claudeMd, next);
      log('  ✓ CLAUDE.md：执行方式规则');
    }
  }

  // 4. 技能本身装进 ~/.claude/skills，以后可以直接对 Claude 说"更新工作台"；已经在那儿（或是链接）就跳过
  if (!samePath(__dirname, T.skill)) {
    fs.rmSync(T.skill, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(T.skill), { recursive: true });
    fs.cpSync(__dirname, T.skill, { recursive: true, filter: (p) => !/[\\/](\.git|dist|node_modules)([\\/]|$)/.test(p) });
    log(`  ✓ 技能已装到 ${T.skill}`);
  }

  // 5. 自检：用假输入跑一遍状态栏，并生成环境清单
  const sample = JSON.stringify({ model: { display_name: 'Claude' }, effort: { level: 'medium' }, cwd: HOME, workspace: { current_dir: HOME, project_dir: HOME }, rate_limits: { five_hour: { used_percentage: 12 }, seven_day: { used_percentage: 3 } } });
  const r = spawnSync(process.execPath, [T.statusline], { input: sample, encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout.includes('5小时')) throw new Error(`状态栏自检失败：${r.stderr || r.stdout}`);
  log('  ✓ 状态栏自检通过');
  const inv = spawnSync(process.execPath, [T.inventory, '--refresh'], { encoding: 'utf8', timeout: 60000 });
  log(inv.status === 0 ? '  ✓ 环境清单已生成' : `  ! 环境清单生成失败（不影响其他功能）：${inv.stderr}`);

  log('\n完成。重开 Claude Code（或在会话里 /clear）后生效。');
}

function uninstall() {
  log(`卸载 Claude Code 工作台 ← ${CLAUDE}`);
  for (const f of [T.statusline, T.inventory, T.inventoryCache]) fs.rmSync(f, { force: true });
  for (const n of [PLUGIN, ...LEGACY_PLUGINS]) fs.rmSync(path.join(T.mods, n), { recursive: true, force: true });

  if (fs.existsSync(T.settings)) {
    const s = readSettings();
    backup(T.settings);
    if (isOurStatus(s.statusLine)) delete s.statusLine;
    if (s.hooks?.SessionStart) {
      s.hooks.SessionStart = s.hooks.SessionStart.map((g) => ({ ...g, hooks: (g.hooks || []).filter((h) => !isOurHook(h)) })).filter((g) => g.hooks.length);
      if (!s.hooks.SessionStart.length) delete s.hooks.SessionStart;
      if (!Object.keys(s.hooks).length) delete s.hooks;
    }
    if (s.env) {
      if (s.env.CLAUDE_CODE_PLUGIN_DIRS) {
        const dirs = withoutOurDirs(s.env.CLAUDE_CODE_PLUGIN_DIRS);
        dirs.length ? (s.env.CLAUDE_CODE_PLUGIN_DIRS = dirs.join(DELIM)) : delete s.env.CLAUDE_CODE_PLUGIN_DIRS;
      }
      delete s.env.CC_STATUS_TITLE;
      if (!Object.keys(s.env).length) delete s.env;
    }
    writeSettings(s);
  }

  if (fs.existsSync(T.claudeMd)) {
    const md = fs.readFileSync(T.claudeMd, 'utf8');
    if (md.includes(MD_START) && md.includes(MD_END)) {
      backup(T.claudeMd);
      // 安装时在原文和规则块之间加了一个空行，这里连同它一起拿掉，恢复成安装前的样子
      const before = md.slice(0, md.indexOf(MD_START)).trimEnd();
      const after = md.slice(md.indexOf(MD_END) + MD_END.length).replace(/^\n+/, '').trimEnd();
      const kept = [before, after].filter(Boolean).join('\n\n');
      const next = kept ? kept + '\n' : '';
      fs.writeFileSync(T.claudeMd, next);
    }
  }
  // 技能目录本身不删：可能是链接或用户想保留，再装还能用
  log('完成。技能目录保留在原处，需要彻底删除可手动移除。');
}

const HELP = `Claude Code 工作台 v${VERSION}
用法：node install.js [--title "标题"] [--no-claude-md]
      node install.js --uninstall`;

try {
  const args = parseArgs(process.argv.slice(2));
  if (args.flags.has('--help') || args.flags.has('-h')) log(HELP);
  else if (args.flags.has('--uninstall')) uninstall();
  else install(args);
} catch (e) {
  console.error(`✗ ${e.message}`);
  process.exit(1);
}

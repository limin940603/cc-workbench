// node --test tests/install.test.js
// 在临时目录里装、更新、卸载；macOS 用 CC_WORKBENCH_PLATFORM=darwin 模拟（真机行为仍需在 Mac 上确认）。
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const INSTALL = path.join(__dirname, '..', 'install.js');

function freshHome(settings, claudeMd) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ccwb-'));
  fs.mkdirSync(path.join(home, '.claude'));
  if (settings) fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify(settings, null, 2));
  if (claudeMd !== undefined) fs.writeFileSync(path.join(home, '.claude', 'CLAUDE.md'), claudeMd);
  return home;
}
function run(home, args = [], platform = process.platform) {
  const r = spawnSync(process.execPath, [INSTALL, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CC_WORKBENCH_HOME: home, CC_WORKBENCH_PLATFORM: platform, CC_WORKBENCH_SKIP_CLAUDE_CHECK: '1' },
  });
  assert.equal(r.status, 0, r.stderr || r.stdout);
  return r.stdout;
}
const settingsOf = (home) => JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
const exists = (home, rel) => fs.existsSync(path.join(home, '.claude', rel));

for (const platform of ['win32', 'darwin']) {
  const delim = platform === 'win32' ? ';' : ':';

  test(`[${platform}] 安装：保留原有配置，写入三项，路径分隔符正确`, () => {
    const home = freshHome({ theme: 'dark', env: { FOO: '1', CLAUDE_CODE_PLUGIN_DIRS: '/other/plugin' }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo mine' }] }] } }, '# 我的规则\n');
    run(home, [], platform);
    const s = settingsOf(home);
    assert.equal(s.theme, 'dark');
    assert.equal(s.env.FOO, '1');
    assert.ok(s.hooks.SessionStart.some((g) => g.hooks.some((h) => h.command === 'echo mine')));
    assert.match(s.statusLine.command, /statusline\.js"$/);
    // 在 Windows 上模拟 macOS 时，临时目录路径自带 "C:"，所以按完整字符串比对而不是按分隔符拆分
    const mod = path.join(home, '.claude', 'mods', 'cc-copilot').replace(/\\/g, '/');
    assert.equal(s.env.CLAUDE_CODE_PLUGIN_DIRS, `/other/plugin${delim}${mod}`);
    // macOS 用 node 绝对路径（GUI 启动时 PATH 里常没有 nvm/Homebrew 的 node），Windows 用 node
    if (platform === 'darwin') assert.match(s.statusLine.command, /^"/);
    else assert.match(s.statusLine.command, /^node /);
    for (const f of ['statusline.js', 'env-inventory.js', 'mods/cc-copilot/hooks/register.tsx', 'skills/cc-workbench/install.js']) assert.ok(exists(home, f), f);
    assert.match(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), /^# 我的规则\n\n<!-- cc-workbench:start -->/);
  });

  test(`[${platform}] 重复安装不重复写入`, () => {
    const home = freshHome({}, '');
    run(home, [], platform);
    run(home, [], platform);
    const s = settingsOf(home);
    assert.equal(s.hooks.SessionStart.length, 1);
    assert.equal(s.env.CLAUDE_CODE_PLUGIN_DIRS.split('cc-copilot').length, 2);
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8').split('cc-workbench:start').length, 2);
  });

  test(`[${platform}] 从旧版 jevin-copilot 升级：旧目录和旧路径都被清掉`, () => {
    const home = freshHome();
    const old = path.join(home, '.claude', 'mods', 'jevin-copilot').replace(/\\/g, '/');
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ env: { CLAUDE_CODE_PLUGIN_DIRS: `/other/plugin${delim}${old}` } }));
    fs.mkdirSync(path.join(home, '.claude', 'mods', 'jevin-copilot'), { recursive: true });
    run(home, [], platform);
    assert.ok(!exists(home, 'mods/jevin-copilot'));
    assert.ok(!settingsOf(home).env.CLAUDE_CODE_PLUGIN_DIRS.includes('jevin-copilot'));
    assert.ok(settingsOf(home).env.CLAUDE_CODE_PLUGIN_DIRS.startsWith(`/other/plugin${delim}`));
  });

  test(`[${platform}] 卸载：恢复到安装前，只留用户自己的东西`, () => {
    const home = freshHome({ theme: 'dark', env: { FOO: '1' } }, '# 我的规则\n');
    run(home, ['--title', '我的台子'], platform);
    assert.equal(settingsOf(home).env.CC_STATUS_TITLE, '我的台子');
    run(home, ['--uninstall'], platform);
    assert.deepEqual(settingsOf(home), { theme: 'dark', env: { FOO: '1' } });
    assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), '# 我的规则\n');
    for (const f of ['statusline.js', 'env-inventory.js', 'mods/cc-copilot']) assert.ok(!exists(home, f), f);
  });
}

test('已有手写的同名规则章节时不重复插入；--no-claude-md 完全不碰 CLAUDE.md', () => {
  const md = '## 执行方式（少等待、看得见、及时换路）\n- 我自己的写法\n';
  const home = freshHome({}, md);
  run(home);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'CLAUDE.md'), 'utf8'), md);
  const home2 = freshHome({});
  run(home2, ['--no-claude-md']);
  assert.ok(!exists(home2, 'CLAUDE.md'));
});

test('settings.json 损坏时拒绝安装，不覆盖', () => {
  const home = freshHome();
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{ broken');
  const r = spawnSync(process.execPath, [INSTALL], { encoding: 'utf8', env: { ...process.env, CC_WORKBENCH_HOME: home, CC_WORKBENCH_SKIP_CLAUDE_CHECK: '1' } });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /不是合法 JSON/);
  assert.equal(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'), '{ broken');
});

test('状态栏：标题可改、账号可隐藏、长会话名按显示宽度截断', () => {
  const statusline = path.join(__dirname, '..', 'files', 'statusline.js');
  const input = JSON.stringify({ model: { display_name: 'Opus' }, session_name: '这是一个非常非常非常非常长的中文会话名称用来测试截断', cwd: os.tmpdir() });
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const a = strip(spawnSync(process.execPath, [statusline], { input, encoding: 'utf8', env: { ...process.env, CC_STATUS_TITLE: '我的台子' } }).stdout);
  assert.match(a, /我的台子/);
  assert.match(a, /…/);
  const b = strip(spawnSync(process.execPath, [statusline], { input, encoding: 'utf8', env: { ...process.env, CC_STATUS_HIDE_ACCOUNT: '1' } }).stdout);
  assert.doesNotMatch(b, /@/);
});

test('状态栏：实际回答的模型和会话默认不同时，显示实际模型（以转录为准）', () => {
  const statusline = path.join(__dirname, '..', 'files', 'statusline.js');
  const strip = (s) => s.replace(/\x1b\[[0-9;]*m/g, '');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccwb-sl-'));
  const reply = (model, extra = {}) => JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { model, content: [{ type: 'text', text: 'ok' }] }, ...extra });
  const render = (lines) => {
    const tp = path.join(dir, `t${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(tp, lines.join('\n') + '\n');
    const input = JSON.stringify({ model: { id: 'claude-fable-5-1', display_name: 'Fable 5.1' }, effort: 'high', transcript_path: tp, cwd: dir });
    return strip(spawnSync(process.execPath, [statusline], { input, encoding: 'utf8' }).stdout).split('\n')[0];
  };
  // 主会话被助手栏改发给 Opus；子代理的回复和本地报错不算"实际模型"
  const a = render([reply('claude-opus-5-5'), reply('claude-haiku-4-5-20251001', { isSidechain: true }), reply('<synthetic>')]);
  assert.match(a, /^Opus 5\.5 上轮实际 · 默认 Fable 5\.1 · high/);
  const b = render([reply('claude-fable-5-1')]);
  assert.match(b, /^Fable 5\.1 · high/);
  assert.doesNotMatch(b, /上轮实际/);
  fs.rmSync(dir, { recursive: true, force: true });
});

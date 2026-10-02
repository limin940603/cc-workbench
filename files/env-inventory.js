#!/usr/bin/env node
// SessionStart 钩子：把本机已装工具、版本和镜像配置注入上下文，让 Claude 先复用、不重复安装。
// 探测较慢（几秒），结果缓存 24 小时；传 --refresh 强制刷新。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CACHE = path.join(os.homedir(), '.claude', 'env-inventory.md');
const MAX_AGE = 24 * 3600e3;

function run(cmd, args) {
  // 参数都是本文件写死的常量，拼成字符串交给 shell，Windows 上才能找到 .cmd 包装器
  const r = spawnSync([cmd, ...args].join(' '), { encoding: 'utf8', timeout: 5000, shell: true, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr || '').trim().split('\n')[0].trim();
}

function probe() {
  const tools = [
    ['node', ['-v']], ['npm', ['-v']], ['pnpm', ['-v']], ['bun', ['-v']],
    ['python', ['--version']], ['uv', ['--version']], ['pip', ['--version']],
    ['git', ['--version']], ['gh', ['--version']], ['curl', ['--version']],
    ['ffmpeg', ['-version']], ['docker', ['--version']], ['conda', ['--version']],
    ['winget', ['--version']], ['brew', ['--version']], ['aria2c', ['--version']],
  ];
  const have = [], missing = [];
  for (const [t, a] of tools) {
    const v = run(t, a);
    v ? have.push(`- ${t}: ${v.replace(/\s*\(.*$/, '').slice(0, 60)}`) : missing.push(t);
  }
  const mirrors = [];
  const npmReg = run('npm', ['config', 'get', 'registry']);
  if (npmReg) mirrors.push(`- npm registry: ${npmReg}`);
  const pipIdx = run('pip', ['config', 'get', 'global.index-url']);
  if (pipIdx) mirrors.push(`- pip index: ${pipIdx}`);
  if (process.env.UV_DEFAULT_INDEX || process.env.UV_INDEX_URL) mirrors.push(`- uv index: ${process.env.UV_DEFAULT_INDEX || process.env.UV_INDEX_URL}`);
  const npmGlobal = run('npm', ['root', '-g']);
  let globals = [];
  try { if (npmGlobal) globals = fs.readdirSync(npmGlobal).filter((n) => !n.startsWith('.')); } catch {}

  return [
    `# 本机已装环境（${new Date().toISOString().slice(0, 16).replace('T', ' ')} 探测，${os.platform()} ${os.arch()}）`,
    '需要工具时先用这里已有的；缺的再装，并优先走下列镜像。清单可能过期，关键版本以实际命令为准。',
    '', ...have,
    `- 未安装: ${missing.join(', ') || '无'}`,
    globals.length ? `- npm 全局包: ${globals.join(', ')}` : '',
    '', '## 镜像', ...(mirrors.length ? mirrors : ['- 未配置']),
  ].filter((l) => l !== null).join('\n');
}

let text;
try {
  const fresh = !process.argv.includes('--refresh') && Date.now() - fs.statSync(CACHE).mtimeMs < MAX_AGE;
  if (fresh) text = fs.readFileSync(CACHE, 'utf8');
} catch {}
if (!text) {
  text = probe();
  fs.writeFileSync(CACHE, text);
}
process.stdout.write(text + '\n');

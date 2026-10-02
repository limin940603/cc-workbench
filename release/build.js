#!/usr/bin/env node
// 打包发布：生成 Windows / macOS 两个安装包，并可同步出一份开源仓库目录（零依赖）。
//   node release/build.js                      在 ./dist 生成两个 zip
//   node release/build.js --repo <目录>        同时把仓库内容同步到该目录（不含 .git，供开源仓库提交）
// 两个包核心文件相同，区别只在：双击启动的安装/卸载脚本、对应系统的使用说明。
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const VERSION = (fs.readFileSync(path.join(ROOT, 'install.js'), 'utf8').match(/const VERSION = '([\d.]+)'/) || [])[1];
if (!VERSION) throw new Error('install.js 里找不到 VERSION');

// 两个包都带的文件
const CORE = ['install.js', 'SKILL.md', 'README.md', 'LICENSE', 'CHANGELOG.md', 'files'];
const PLATFORMS = {
  windows: { extra: { 'install.cmd': 'launchers/install.cmd', 'uninstall.cmd': 'launchers/uninstall.cmd', '使用说明-Windows.md': 'docs/windows.md' } },
  macos: { extra: { 'install.command': 'launchers/install.command', 'uninstall.command': 'launchers/uninstall.command', '使用说明-macOS.md': 'docs/macos.md' }, executable: /\.command$/ },
};
// 开源仓库里放的：核心 + 启动脚本 + 文档 + 测试 + 本打包脚本
const REPO = [...CORE, 'launchers', 'docs', 'tests', 'release', '.gitignore', '.gitattributes'];

function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.statSync(abs).isDirectory()) return [rel];
  return fs.readdirSync(abs).flatMap((n) => walk(path.join(rel, n)));
}

// ---------- 最小 zip 写入器：store/deflate、UTF-8 文件名、Unix 权限位 ----------
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function zip(entries) {
  // entries: [{ name, data: Buffer, mode }]
  const locals = [], centrals = [];
  let offset = 0;
  // 固定时间戳，同样的内容打出同样的包，便于核对
  const dosTime = 0, dosDate = ((2026 - 1980) << 9) | (10 << 5) | 3;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const deflated = zlib.deflateRawSync(e.data, { level: 9 });
    const useDeflate = deflated.length < e.data.length;
    const body = useDeflate ? deflated : e.data;
    const crc = crc32(e.data);
    const flags = 0x0800; // 文件名是 UTF-8
    const method = useDeflate ? 8 : 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE((3 << 8) | 20, 4); // 3 = Unix，解压工具才会认权限位
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((0o100000 | e.mode) << 16) >>> 0, 38); // 普通文件 + 权限
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = centrals.reduce((n, b) => n + b.length, 0);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cdSize, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, ...centrals, end]);
}

function buildZip(platform) {
  const cfg = PLATFORMS[platform];
  const entries = [];
  for (const rel of CORE.flatMap(walk)) entries.push({ name: rel, src: rel });
  for (const [name, src] of Object.entries(cfg.extra)) entries.push({ name, src });
  const files = entries
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((e) => ({
      name: `cc-workbench/${e.name.replace(/\\/g, '/')}`,
      data: fs.readFileSync(path.join(ROOT, e.src)),
      mode: cfg.executable && cfg.executable.test(e.name) ? 0o755 : 0o644,
    }));
  const out = path.join(ROOT, 'dist', `cc-workbench-${VERSION}-${platform}.zip`);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, zip(files));
  return { out, count: files.length };
}

function syncRepo(target) {
  target = path.resolve(target);
  fs.mkdirSync(target, { recursive: true });
  // 只替换本脚本管理的条目，目标目录里的 .git 等其他内容不动
  for (const rel of REPO) {
    fs.rmSync(path.join(target, rel), { recursive: true, force: true });
    if (!fs.existsSync(path.join(ROOT, rel))) continue;
    fs.cpSync(path.join(ROOT, rel), path.join(target, rel), { recursive: true });
  }
  return target;
}

const args = process.argv.slice(2);
for (const p of Object.keys(PLATFORMS)) {
  const { out, count } = buildZip(p);
  console.log(`✓ ${path.relative(process.cwd(), out)}（${count} 个文件，${Math.round(fs.statSync(out).size / 1024)}KB）`);
}
const i = args.indexOf('--repo');
if (i >= 0) {
  if (!args[i + 1]) throw new Error('--repo 缺少目录');
  console.log(`✓ 仓库内容已同步到 ${syncRepo(args[i + 1])}`);
}

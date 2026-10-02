---
name: cc-workbench
description: "在 Windows 或 macOS 上安装、更新、卸载 Claude Code 工作台：多行状态栏（上下文、5 小时/周额度、运行中任务）、开会话注入已装环境清单、执行方式规则、输入框上方助手栏（发送前选模型和强度、提示词增强、下一步建议、子代理进度）。用户说\"装工作台/配状态栏/新电脑配 Claude Code/卸载工作台\"时用。"
---

# Claude Code 工作台

## 装了什么

| 组件 | 装到哪 | 作用 |
| --- | --- | --- |
| 状态栏 `statusline.js` | `~/.claude/statusline.js` | 模型、项目、会话、套餐、时长；上下文 / 5 小时 / 周额度进度条；工具统计；运行中的命令和子代理及已等待时间 |
| 环境清单 `env-inventory.js` | `~/.claude/env-inventory.js` + SessionStart 钩子 | 每次开会话把已装工具、版本、镜像告诉 Claude，先复用再安装；缓存 24 小时 |
| 执行方式规则 | `~/.claude/CLAUDE.md`（标记包裹的一节） | 下载要报进度、卡住换源、失败两次换思路、并行少等待 |
| 提示词助手 `cc-copilot` | `~/.claude/mods/cc-copilot` + `CLAUDE_CODE_PLUGIN_DIRS` | 输入框上方一栏：发送前选模型和推理强度（只在本会话生效，不改 `/model` 默认）；「✨ 增强」按风格（结构化/精简/技术/内容创作）改写草稿，会参考最近对话，可撤销，草稿末尾加 `++` 回车也能触发；每轮后的"下一步"建议（Tab 采用，可关）；「专家」开关让增强和建议按任务所属领域的行家标准来写；子代理实时进度行和「子代理」面板（派单原文、最近动作、回报） |

## 安装

前提：Node.js 18+，Claude Code 2.1.287 或更新（提示词助手依赖函数钩子插件接口，旧版本不加载它，其他三项不受影响）。

```
node <本技能目录>/install.js
```

- Windows 本机技能目录：`C:\Users\<你>\.agents\skills\cc-workbench`（已链接到 `~/.claude/skills`）。
- 新电脑：解压对应系统的安装包（`cc-workbench-<版本>-windows.zip` / `-macos.zip`），双击 `install.cmd` / 右键打开 `install.command`，或在解压出的目录里执行 `node install.js`。安装器会顺便把技能复制到 `~/.claude/skills/cc-workbench`。
- `--title "标题"`：自定义状态栏标题（写入 settings.json 的 `CC_STATUS_TITLE`）。
- 可重复执行：再次运行就是更新，不会重复写入。
- `--no-claude-md`：不写执行方式规则（比如那台机器的 CLAUDE.md 另有安排）。
- `--uninstall`：只移除本工具写入的文件和配置项，其他设置原样保留。

装完重开 Claude Code，或在会话里 `/clear`。

## 代用户执行时

1. 先确认 `node -v` ≥ 18；没有 Node 就停下来告诉用户，不擅自安装。
2. 运行 `node install.js`，把输出原样转述：哪些 ✓、哪些 ! 。安装器改 `settings.json` / `CLAUDE.md` 前会自动备份到 `~/.claude/backups/`。
3. 出现"原有状态栏配置被替换"时告诉用户原配置在备份里。
4. 自检失败（✗）就按报错排查，不要绕过。

## 可调项

- 状态栏标题：环境变量 `CC_STATUS_TITLE`（默认"Claude Code"）；`CC_STATUS_HIDE_ACCOUNT=1` 隐藏账号和套餐。
- 环境清单强制刷新：`node ~/.claude/env-inventory.js --refresh`。
- 提示词助手的模型：`files/cc-copilot/hooks/register.tsx` 里的 `haiku`（建议）和 `sonnet`（增强），改完重新安装。
- 可选模型列表和增强风格：同一文件顶部的 `MODELS`、`STYLES`。出了新模型就在 `MODELS` 里加一行。

## 助手栏按键

鼠标点按钮，或 ctrl+x 再按 tab 选中这一栏后按字母：`e` 增强、`u` 撤销、`o` 展开或收起设置行、`a` 打开子代理面板（也可以输入 `/subagents`）；设置行展开后 `m` 模型、`r` 强度、`s` 风格、`x` 专家、`n` 建议开关。

子代理面板只记录插件加载之后派出的子代理；想看某个子代理的完整逐字过程，用 Claude Code 自带的入口：输入框为空时按 ←，在列表里选中它。

注意：会话中途换模型，换后的第一条消息要按新模型重新读一遍全部上下文（缓存按模型分开），长会话里会明显多花额度；上下文超过 20 万 token 时换到不支持 1M 的模型会报错。

## 维护

本目录是唯一源头（也是开源仓库的内容）；`~/.claude` 里的是安装出来的副本，改动请改这里再重装。

- 测试：`node --test tests/install.test.js`（安装器，含模拟 macOS）、`claude plugin test files/cc-copilot`（助手栏）。
- 打包：`node release/build.js` 在 `dist/` 生成 Windows、macOS 两个安装包；加 `--repo <目录>` 同步一份开源仓库内容。
- 发版：改 `install.js` 里的 `VERSION` 和 `CHANGELOG.md`。对外发布（推到 GitHub、发 Release）必须主人当次确认。

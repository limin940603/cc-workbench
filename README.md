# Claude Code 工作台 · cc-workbench

给 Claude Code 装上一块"仪表盘"和一个"副驾"：一眼看清额度和进度，发送前顺手把话说清楚，子代理在干什么也看得见。Windows、macOS 一键安装，可随时一键卸载。

```
Opus 5.5 · medium │ my-project │ 重构登录流程 │ abcd***@gmail.com · Claude Max │ 1h 30m
Claude Code  1 CLAUDE.md · 2 MCPs · 1 钩子
上下文 ██░░░░░░ 23% │ 5小时 █████░░░ 64% 08:10重置 │ 本周 █░░░░░░░ 3% 10/8 11:00重置
Bash 85 ✗3 · Write 12 · Edit 4 · Read 3
● Bash uv pip install -r requirements.txt 1m 20s
```

## 装了什么

| 组件 | 作用 |
| --- | --- |
| **状态栏** | 模型和推理强度、项目、会话、套餐、时长；上下文 / 5 小时 / 本周额度进度条（60% 变黄、80% 变红）；工具调用统计；正在跑的命令和子代理，以及已经等了多久 |
| **助手栏**（输入框正上方） | `✨ 增强`：把草稿改写成清楚的指令，会参考最近几轮对话，可撤销；每轮结束后给一句"下一步"建议，按 Tab 采用；发送前可临时切换模型和推理强度；子代理实时进度和「子代理」面板（派单原文、最近动作、回报） |
| **环境清单** | 每次开会话把本机已装的工具、版本和镜像告诉 Claude，让它先复用、少重复安装 |
| **执行方式规则** | 写进 `~/.claude/CLAUDE.md` 的一小节：长下载要报进度、卡住就换源、同一做法失败两次就换思路、互不依赖的事并行做 |

不按任何按钮时，助手栏不会改动你发出的内容，模型和推理强度也跟随会话设置。

## 安装

先装好 [Node.js](https://nodejs.org) 18 或更新版本和 Claude Code，然后到 [Releases](../../releases) 下载对应系统的安装包：

| 系统 | 下载 | 安装 |
| --- | --- | --- |
| Windows | `cc-workbench-<版本>-windows.zip` | 解压，双击 `install.cmd` |
| macOS | `cc-workbench-<版本>-macos.zip` | 解压，右键 `install.command` →「打开」（第一次需要这样绕过系统提示） |

装完重开 Claude Code，或在会话里输入 `/clear`。两个系统的详细说明和常见问题见 [Windows](docs/windows.md) / [macOS](docs/macos.md)。

也可以用命令行（两个系统通用）：

```bash
git clone https://github.com/limin940603/cc-workbench.git
cd cc-workbench
node install.js --title "我的工作台"   # --title 可省略，默认显示 "Claude Code"
```

安装器可以重复运行（就是更新），改 `settings.json` 和 `CLAUDE.md` 之前会先备份到 `~/.claude/backups/`，你原有的其他配置原样保留。安装后它也会出现在 Claude 的技能里，以后直接对 Claude 说"更新工作台"即可。

## 使用

**助手栏**：用鼠标点按钮；或按 `ctrl+x` 再按 `tab` 选中这一栏，然后按字母：

| 键 | 作用 | 键 | 作用 |
| --- | --- | --- | --- |
| `e` | 增强草稿 | `u` | 撤销增强 |
| `o` | 展开 / 收起设置行 | `a` | 打开子代理面板 |
| `m` | 切换发送用的模型 | `r` | 切换推理强度 |
| `s` | 增强风格：结构化 / 精简 / 技术 / 内容创作 | `x` | 专家模式：按任务所属领域的行家标准写 |
| `n` | 下一步建议 开 / 关 | | |

不想动鼠标时，在草稿末尾加 `++` 再回车：这条不会发出去，而是增强后放回输入框给你确认。也可以输入 `/subagents` 打开子代理面板。

**可调项**（写在 `~/.claude/settings.json` 的 `env` 里）：

| 变量 | 作用 |
| --- | --- |
| `CC_STATUS_TITLE` | 状态栏标题，安装时用 `--title` 设置最方便 |
| `CC_STATUS_HIDE_ACCOUNT=1` | 隐藏账号和套餐，录屏、截图分享时用 |

## 卸载

Windows 双击 `uninstall.cmd`，macOS 打开 `uninstall.command`，或运行 `node install.js --uninstall`。只移除本工具写入的文件和配置项，其余设置不动。

## 隐私与费用

- 状态栏只在本机读取 Claude Code 的会话记录和 `~/.claude.json`（套餐名称、打码后的邮箱），不联网、不上传。
- 「增强」调用一次 Sonnet，"下一步"建议每轮调用一次 Haiku，走的都是你自己的 Claude Code 登录，计入你的额度，内容都很短。不需要时在设置行里把建议关掉即可。
- 会话中途换模型，下一条消息要按新模型重新读一遍上下文，长会话里会多花额度；默认的"跟随会话"不会这样。

## 已知限制

- 助手栏依赖 Claude Code **2.1.287 或更新版本**的函数钩子插件接口。这个接口还在早期阶段，Claude Code 升级后可能需要跟着更新；版本不够时安装器会提示，状态栏等其他功能不受影响。
- macOS 的安装、更新、卸载流程已在自动测试里模拟验证，**作者还没在 Mac 真机上跑过**。遇到问题欢迎提 Issue，附上安装输出。
- 子代理面板只记录插件加载之后派出的子代理，看不到子代理的逐字思考。要看完整过程，在输入框为空时按 `←` 选中它（Claude Code 自带功能）。

## 开发

```bash
node --test tests/install.test.js        # 安装器：Windows / 模拟 macOS 的安装、升级、卸载
claude plugin test files/cc-copilot      # 助手栏插件
node release/build.js                    # 在 dist/ 生成两个安装包
```

项目零依赖，只需要 Node.js。

## 许可

[MIT](LICENSE)

---

**English summary** — cc-workbench adds a multi-line status line (context, 5-hour and weekly quota bars, running tools and subagents), an assistant bar above the prompt (prompt enhancement with undo, next-step suggestions, per-message model/effort switch, live subagent progress), a session-start inventory of installed tools, and a short set of execution rules to `CLAUDE.md`. One-click install and uninstall on Windows and macOS; requires Node.js 18+ and Claude Code 2.1.287+ for the assistant bar. UI text is in Chinese.

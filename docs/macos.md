# Claude Code 工作台 · macOS 使用说明

## 安装（3 步）

1. **确认有 Node.js 18 或更新版本**：打开"终端"，输入 `node -v`。没有的话运行 `brew install node`，或到 https://nodejs.org 下载安装包。
2. **解压** `cc-workbench-<版本>-macos.zip`（双击即可），进入解压出来的 `cc-workbench` 文件夹。
3. **右键 `install.command` →「打开」→ 再点「打开」**。从网上下载的脚本第一次运行会被系统拦一下，用右键打开就能放行，以后双击即可。看到"完成"后按任意键关闭窗口，然后重开 Claude Code（或在会话里输入 `/clear`）。

不想用右键的话，也可以在终端里运行：

```bash
cd ~/Downloads/cc-workbench
bash install.command                          # 或：node install.js
bash install.command --title "我的工作台"      # 自定义状态栏标题
```

## 卸载

右键 `uninstall.command` →「打开」，或运行 `node install.js --uninstall`。只移除本工具写入的内容；改动前的 `settings.json`、`CLAUDE.md` 都备份在 `~/.claude/backups/`。

## 显示效果

- 系统自带"终端"、iTerm2、Ghostty、Warp 都可以；进度条 `█░`、分隔线 `│` 和中文宽度在默认字体下能对齐。
- 状态栏没有用表情符号做图标（macOS 会把它们画成双倍宽的彩色图），只保留了助手栏里的 ✨。
- 窗口宽度建议 100 列以上，额度那一行不会折行。

## 常见问题

**提示"无法打开，因为无法验证开发者"**：这是系统对网上下载脚本的默认拦截。用右键 →「打开」，或在终端里用 `bash install.command` 运行。

**提示"没找到 Node.js"，但我明明装了**：从访达双击启动时读不到 `~/.zshrc`，nvm 等方式装的 node 可能找不到。安装脚本已经会去 Homebrew、nvm、Volta 的常见位置找；仍然找不到的话，在终端里进入这个文件夹运行 `node install.js`。

**换了 Node 版本后状态栏不见了**：macOS 上状态栏用的是安装时 node 的完整路径（因为从图形界面启动的 Claude 常常找不到 nvm 的 node）。换版本后重新运行一次安装即可。

**提示"Claude Code 版本低于 2.1.287"**：运行 `claude update` 升级。不升级也能用状态栏、环境清单和执行规则，只是没有助手栏。

**助手栏的按钮点不动**：按 `ctrl+x` 再按 `tab` 选中助手栏，用字母键操作；或在草稿末尾加 `++` 回车。

# Claude Code 工作台 · Windows 使用说明

## 安装（3 步）

1. **确认有 Node.js 18 或更新版本**：打开"终端"，输入 `node -v`。没有的话运行 `winget install OpenJS.NodeJS.LTS`，或到 https://nodejs.org 下载安装包，装完关掉终端重开一次。
2. **解压** `cc-workbench-<版本>-windows.zip`，进入解压出来的 `cc-workbench` 文件夹。
3. **双击 `install.cmd`**。看到"完成"后按任意键关闭窗口，然后重开 Claude Code（或在会话里输入 `/clear`）。

想自定义状态栏标题：在这个文件夹的地址栏输入 `cmd` 回车，然后运行 `install.cmd --title "我的工作台"`。

## 卸载

双击 `uninstall.cmd`。只移除本工具写入的内容；改动前的 `settings.json`、`CLAUDE.md` 都备份在 `%USERPROFILE%\.claude\backups\`。

## 显示效果

- 推荐用 **Windows 终端**（Windows 11 自带）和默认的 Cascadia 字体，进度条 `█░`、分隔线 `│` 和中文宽度都能对齐。
- 老式的"命令提示符"窗口可能把中文或方块字符显示成乱码或错位，换到 Windows 终端即可。
- 窗口宽度建议 100 列以上，额度那一行不会折行。

## 常见问题

**双击后窗口一闪就没了**：多半是 Node.js 没装好。按上面第 1 步检查 `node -v`。

**提示"Claude Code 版本低于 2.1.287"**：运行 `claude update` 升级。不升级也能用状态栏、环境清单和执行规则，只是没有助手栏。

**状态栏没出现**：Windows 版 Claude Code 通过 Git Bash 运行状态栏命令，需要装 Git for Windows（装 Claude Code 时一般已经装好）。另外确认重开过 Claude Code。

**助手栏的按钮点不动**：有些终端不把鼠标点击传给程序。按 `ctrl+x` 再按 `tab` 选中助手栏，用字母键操作；或在草稿末尾加 `++` 回车。

**被杀毒软件拦截**：安装器只是一个 Node.js 脚本（`install.js`，可以直接打开看），只写入 `%USERPROFILE%\.claude` 目录。

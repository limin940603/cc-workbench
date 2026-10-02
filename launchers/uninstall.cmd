@echo off
rem Claude Code 工作台：Windows 一键卸载，只移除本工具写入的内容
chcp 65001 >nul
cd /d "%~dp0"
node install.js --uninstall
set "RC=%ERRORLEVEL%"
if not defined CC_NO_PAUSE pause
exit /b %RC%

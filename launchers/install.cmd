@echo off
rem Claude Code 工作台：Windows 一键安装。双击运行；也可在命令行加参数，例如 install.cmd --title "我的台子"
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo 没找到 Node.js。请先安装 Node.js 18 或更新版本，再重新双击本文件：
  echo   winget install OpenJS.NodeJS.LTS
  echo   或到 https://nodejs.org 下载安装包
  if not defined CC_NO_PAUSE pause
  exit /b 1
)
node install.js %*
set "RC=%ERRORLEVEL%"
if not defined CC_NO_PAUSE pause
exit /b %RC%

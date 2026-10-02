#!/bin/bash
# Claude Code 工作台：macOS 一键安装。在访达里双击运行；也可在终端执行 bash install.command --title "我的台子"
cd "$(dirname "$0")" || exit 1

# 从访达双击启动的是非登录 shell，Homebrew / nvm / Volta 装的 node 可能不在 PATH 里，补找一遍
if ! command -v node >/dev/null 2>&1; then
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1); do
    if [ -x "$dir/node" ]; then PATH="$dir:$PATH"; break; fi
  done
fi

if ! command -v node >/dev/null 2>&1; then
  echo "没找到 Node.js。请先安装 Node.js 18 或更新版本，再重新双击本文件："
  echo "  brew install node"
  echo "  或到 https://nodejs.org 下载安装包"
  [ -z "$CC_NO_PAUSE" ] && read -n 1 -s -r -p "按任意键关闭窗口"
  exit 1
fi

node install.js "$@"
rc=$?
[ -z "$CC_NO_PAUSE" ] && { echo; read -n 1 -s -r -p "按任意键关闭窗口"; }
exit $rc

#!/bin/bash
# Claude Code 工作台：macOS 一键卸载，只移除本工具写入的内容
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  for dir in /opt/homebrew/bin /usr/local/bin "$HOME/.volta/bin" $(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1); do
    if [ -x "$dir/node" ]; then PATH="$dir:$PATH"; break; fi
  done
fi
node install.js --uninstall
rc=$?
[ -z "$CC_NO_PAUSE" ] && { echo; read -n 1 -s -r -p "按任意键关闭窗口"; }
exit $rc

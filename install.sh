#!/usr/bin/env sh
# herdr-neon-violet installer for macOS / Linux.
# Installs what applies to this machine: the terminal herdr config and plugin when `herdr`
# is installed, and the theme, layouts, mods and shortcuts when the Herdr desktop app is.
set -eu
here=$(cd "$(dirname "$0")" && pwd)

# 1. the nv binary (built with cargo when Rust is installed, otherwise downloaded)
sh "$here/plugin/fetch-bin.sh"
nv="$here/plugin/bin/nv"

# 2. terminal herdr
if command -v herdr >/dev/null 2>&1; then
  cfg_dir="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"
  mkdir -p "$cfg_dir"
  if [ -f "$cfg_dir/config.toml" ]; then
    backup="$cfg_dir/config.toml.bak-$(date +%Y%m%d-%H%M%S)"
    cp "$cfg_dir/config.toml" "$backup"
    echo "backed up existing config -> $backup"
  fi
  cp "$here/config/config.toml" "$cfg_dir/config.toml"
  echo "installed config -> $cfg_dir/config.toml"
  if herdr plugin link "$here/plugin" >/dev/null; then echo "linked plugin neon-violet"; else echo "warning: could not link the plugin - run: herdr plugin link \"$here/plugin\""; fi
  herdr server reload-config >/dev/null 2>&1 || true
fi

if [ -d "$HOME/.config/ghostty" ]; then
  mkdir -p "$HOME/.config/ghostty/themes"
  cp "$here/terminal/ghostty-neon-violet" "$HOME/.config/ghostty/themes/neon-violet"
  echo "installed Ghostty theme -> add 'theme = neon-violet' to ~/.config/ghostty/config"
fi

# 3. Herdr desktop app
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
if [ -d "$app" ]; then
  mkdir -p "$app/themes" "$app/layouts" "$app/mods" "$app/bin"
  cp "$nv" "$app/bin/nv"
  cp "$here/app/themes/neon-violet.json" "$app/themes/"
  cp "$here/app/layouts/all-agents.json" "$here/app/layouts/neon-violet.json" "$app/layouts/"
  cp -R "$here/app/mods/all-agents" "$here/app/mods/devices" "$here/app/mods/prs" "$here/app/mods/todos" "$here/app/mods/editor" "$here/app/mods/nv-tabs" "$here/app/mods/nv-new-menu" "$here/app/mods/nv-files" "$app/mods/"
  "$app/bin/nv" merge-keys "$app/keys.json" "$here/app/keys.json"
  echo "installed Herdr app pack -> $app"
  echo "  layout: herdr-app do layout.switch --name neon-violet   (dark, translucent, with the to-do list)"
  echo "  ALL agents ctrl+shift+a · Devices ctrl+shift+d · Pull requests ctrl+shift+g · Browser ctrl+shift+u"
  echo "  to-do hooks for Claude Code and Codex: see the README (\"To-do list\")"
fi
echo "done. iTerm2: import terminal/neon-violet.itermcolors (Settings > Profiles > Colors > Color Presets)."

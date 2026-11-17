#!/usr/bin/env sh
# herdr-neon-violet installer for macOS / Linux.
# Backs up your current herdr config, installs the theme config, links the plugin.
set -eu
here=$(cd "$(dirname "$0")" && pwd)
cfg_dir="${XDG_CONFIG_HOME:-$HOME/.config}/herdr"

command -v herdr >/dev/null 2>&1 || { echo "herdr is not installed: https://herdr.dev"; exit 1; }
command -v node >/dev/null 2>&1 || echo "warning: node (18+) not found — the plugin panes need it"

mkdir -p "$cfg_dir"
if [ -f "$cfg_dir/config.toml" ]; then
  backup="$cfg_dir/config.toml.bak-$(date +%Y%m%d-%H%M%S)"
  cp "$cfg_dir/config.toml" "$backup"
  echo "backed up existing config -> $backup"
fi
cp "$here/config/config.toml" "$cfg_dir/config.toml"
echo "installed config -> $cfg_dir/config.toml"

if herdr plugin link "$here/plugin" >/dev/null; then echo "linked plugin neon-violet"; else echo "warning: could not link the plugin - run: herdr plugin link \"$here/plugin\""; fi

if [ -d "$HOME/.config/ghostty" ]; then
  mkdir -p "$HOME/.config/ghostty/themes"
  cp "$here/terminal/ghostty-neon-violet" "$HOME/.config/ghostty/themes/neon-violet"
  echo "installed Ghostty theme -> add 'theme = neon-violet' to ~/.config/ghostty/config"
fi

herdr server reload-config >/dev/null 2>&1 || true
echo "done. iTerm2: import terminal/neon-violet.itermcolors (Settings > Profiles > Colors > Color Presets)."

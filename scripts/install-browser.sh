#!/usr/bin/env sh
set -eu
for tool in cargo git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "Browser setup requires $tool. Install it, then run ./scripts/install-browser.sh." >&2
    exit 1
  fi
done
# MIT upstream, pinned so a normal theme install never builds an unreviewed revision.
revision=b409c5f2625676964e21ad54ff6a6627abb05e3b
root="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-neon-violet/browser/$revision"
app="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
here=$(cd "$(dirname "$0")/.." && pwd)
if [ ! -d "$root/.git" ]; then
  mkdir -p "$root"
  git -C "$root" init -q
  git -C "$root" remote add origin https://github.com/MattJColes/herdr-web-browser.git
  git -C "$root" fetch -q --depth 1 origin "$revision"
  git -C "$root" checkout -q --detach FETCH_HEAD
fi
if ! git -C "$root" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "$root" fetch -q --depth 1 origin "$revision"
  git -C "$root" checkout -q --detach FETCH_HEAD
fi
test "$(git -C "$root" rev-parse HEAD)" = "$revision"
git -C "$root" diff --quiet
git -C "$root" diff --cached --quiet
cargo build --manifest-path "$root/Cargo.toml" --release --locked
binary="$root/target/release/herdr-web-browser"
mkdir -p "$app/bin" "$HOME/.local/bin"
if [ -e "$app/bin/herdr-web-browser" ] || [ -L "$app/bin/herdr-web-browser" ]; then
  mv "$app/bin/herdr-web-browser" "$app/bin/herdr-web-browser.bak-$(date +%Y%m%d-%H%M%S)"
fi
ln -s "$binary" "$app/bin/herdr-web-browser"
if [ ! -e "$HOME/.local/bin/herdr-web-browser" ] && [ ! -L "$HOME/.local/bin/herdr-web-browser" ]; then
  ln -s "$binary" "$HOME/.local/bin/herdr-web-browser"
fi
cp "$here/app/browser/nv-browser-view" "$app/bin/nv-browser-view"
cp "$here/app/browser/nv-preview.mjs" "$app/bin/nv-preview.mjs"
chmod +x "$app/bin/nv-browser-view"
# install-cli also edits global agent instructions; install only the desktop assets here.
"$binary" install-desktop
"$binary" install-browser
echo "installed herdr-web-browser 1.3.2 ($revision)"

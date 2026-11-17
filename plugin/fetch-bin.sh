#!/usr/bin/env sh
# Puts the nv binary at bin/nv: builds it when cargo is installed,
# otherwise downloads the build attached to the latest GitHub release.
set -eu
cd "$(dirname "$0")"
mkdir -p bin

if command -v cargo >/dev/null 2>&1; then
  cargo build --release
  cp target/release/nv bin/nv
  echo "built bin/nv with cargo"
  exit 0
fi

os=$(uname -s)
arch=$(uname -m)
case "$os-$arch" in
  Darwin-arm64) asset=nv-aarch64-apple-darwin ;;
  Darwin-x86_64) asset=nv-x86_64-apple-darwin ;;
  Linux-x86_64) asset=nv-x86_64-unknown-linux-gnu ;;
  Linux-aarch64) asset=nv-aarch64-unknown-linux-gnu ;;
  *)
    echo "no prebuilt nv for $os $arch. Install Rust (https://rustup.rs) and run this again."
    exit 1
    ;;
esac

curl -fsSL "https://github.com/torisKR/herdr-neon-violet/releases/latest/download/$asset" -o bin/nv
chmod +x bin/nv
echo "downloaded bin/nv ($asset)"

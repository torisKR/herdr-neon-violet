#!/usr/bin/env python3
"""Prepare a private, checksum-verified Node runtime without changing system tools."""
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

VERSION = "v24.22.3"


def install():
    system = {"Linux": "linux", "Darwin": "darwin"}.get(platform.system())
    arch = {"aarch64": "arm64", "arm64": "arm64", "x86_64": "x64"}.get(platform.machine())
    if not system or not arch:
        raise RuntimeError("Install Node.js and npm with the platform installer on this computer")
    base = Path(os.environ.get("XDG_DATA_HOME", str(Path.home() / ".local/share"))) / "herdr-neon-violet/usage-node"
    base.mkdir(parents=True, exist_ok=True, mode=0o700)
    name = f"node-{VERSION}-{system}-{arch}"
    target = base / name
    if not (target / "bin/node").is_file():
        if target.exists():
            raise RuntimeError("An incomplete private runtime already exists; left untouched")
        archive_name = name + ".tar.xz"
        origin = f"https://nodejs.org/dist/{VERSION}/"
        sums = urllib.request.urlopen(origin + "SHASUMS256.txt", timeout=30).read().decode()
        expected = next(line.split()[0] for line in sums.splitlines() if line.split()[-1] == archive_name)
        stage = Path(tempfile.mkdtemp(prefix="prepare-", dir=base))
        try:
            archive = stage / archive_name
            with urllib.request.urlopen(origin + archive_name, timeout=30) as response, archive.open("wb") as output:
                shutil.copyfileobj(response, output)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            if digest != expected:
                raise RuntimeError("Node checksum mismatch")
            if not hasattr(tarfile, "data_filter"):
                raise RuntimeError("This setup requires Python with safe tar extraction support")
            with tarfile.open(archive) as bundle:
                if any(not member.name.startswith(name + "/") and member.name != name for member in bundle.getmembers()):
                    raise RuntimeError("Unexpected archive layout")
                bundle.extractall(stage, filter="data")
            os.rename(stage / name, target)
        finally:
            shutil.rmtree(stage)
    version = subprocess.check_output([str(target / "bin/node"), "--version"], text=True).strip()
    if version != VERSION:
        raise RuntimeError("Private runtime version mismatch")
    current = base / "current"
    if current.exists() and not current.is_symlink():
        raise RuntimeError("An unrelated current path exists; left untouched")
    link = base / f".current-{os.getpid()}"
    link.symlink_to(target.name)
    os.replace(link, current)
    print(json.dumps({"version": version, "binary": str(current / "bin/node"), "verified": True}))


if __name__ == "__main__":
    install()

import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

for (const cargo of [false, true]) {
  test(`desktop migration completes when ${cargo ? 'browser setup fails' : 'Cargo is unavailable'}`, { skip: process.platform === 'win32' }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'nv-install-'));
    const repo = fileURLToPath(new URL('../../', import.meta.url));
    const home = path.join(root, 'home'), app = path.join(home, '.config/herdr-app'), tools = path.join(root, 'tools');
    try {
      await mkdir(app, { recursive: true }); await mkdir(tools);
      await cp(path.join(repo, 'install.sh'), path.join(root, 'install.sh'));
      await cp(path.join(repo, 'app'), path.join(root, 'app'), { recursive: true });
      await mkdir(path.join(root, 'plugin')); await mkdir(path.join(root, 'scripts'));
      await writeFile(path.join(root, 'plugin/fixture-nv'), '#!/bin/sh\n[ "$1" = merge-keys ] || exit 2\nprintf "migrated\\n" > "$2"\n', { mode: 0o755 });
      await writeFile(path.join(root, 'plugin/fetch-bin.sh'), '#!/bin/sh\nroot=$(dirname "$0")\nmkdir -p "$root/bin"\ncp "$root/fixture-nv" "$root/bin/nv"\n');
      await writeFile(path.join(root, 'scripts/install-browser.sh'), '#!/bin/sh\nprintf "attempted\\n" > "$HERDR_APP_HOME/browser-attempt"\nexit 9\n');
      for (const tool of ['sh', 'dirname', 'mkdir', 'cp', 'mv', 'date']) {
        await symlink(execFileSync('which', [tool], { encoding: 'utf8' }).trim(), path.join(tools, tool));
      }
      if (cargo) for (const tool of ['cargo', 'git']) await writeFile(path.join(tools, tool), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      const result = spawnSync(path.join(tools, 'sh'), [path.join(root, 'install.sh')], {
        env: { ...process.env, HOME: home, HERDR_APP_HOME: app, PATH: tools }, encoding: 'utf8',
      });
      assert.equal(result.status, 0, result.stderr);
      assert.equal(await readFile(path.join(app, 'keys.json'), 'utf8'), 'migrated\n');
      assert.ok((await readFile(path.join(app, 'bin/nv-preview.mjs'), 'utf8')).includes('reservePreview'));
      assert.match(result.stderr, cargo ? /Browser setup failed/ : /Browser setup needs/);
      if (cargo) assert.equal(await readFile(path.join(app, 'browser-attempt'), 'utf8'), 'attempted\n');
      else await assert.rejects(readFile(path.join(app, 'browser-attempt')), { code: 'ENOENT' });
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}

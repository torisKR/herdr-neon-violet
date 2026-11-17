import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, stat, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { htmlPreview } from '../browser/nv-preview.mjs';

test('HTML browser preview renders an unsaved snapshot with local assets and leaves the source untouched', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nv-preview-'));
  try {
    const file = path.join(root, 'source.html');
    await writeFile(file, '<h1>Saved</h1>');
    const html = '<!doctype html><html><head><link rel="stylesheet" href="style.css"></head><body><h1>Unsaved</h1><script>document.title="Live"</script></body></html>';
    const result = await htmlPreview(root, { file, html });
    const preview = await readFile(result.file, 'utf8');
    assert.equal(await readFile(file, 'utf8'), '<h1>Saved</h1>');
    assert.ok(preview.includes('<h1>Unsaved</h1>'));
    assert.ok(preview.includes('<script>document.title="Live"</script>'));
    assert.ok(preview.includes(`<base href="${pathToFileURL(root + path.sep).href}">`));
    assert.equal(result.url, pathToFileURL(result.file).href);
    if (process.platform !== 'win32') assert.equal((await stat(result.file)).mode & 0o777, 0o600);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('remote HTML previews never resolve assets against a different local project', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nv-preview-'));
  try {
    const html = '<h1>Remote draft</h1>';
    const result = await htmlPreview(root, { file: '/remote/repo/index.html', on: 'remote', html });
    assert.equal(await readFile(result.file, 'utf8'), html);
  } finally { await rm(root, { recursive: true, force: true }); }
});

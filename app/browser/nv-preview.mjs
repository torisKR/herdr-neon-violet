import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export async function htmlPreview(home, input) {
  if (!path.isAbsolute(home) || typeof input.html !== 'string' || input.html.length > 1000000) throw new Error('Invalid HTML preview');
  const folder = path.join(home, 'previews');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let html = input.html;
  if (!input.on && typeof input.file === 'string' && path.isAbsolute(input.file) && !/<base\b/i.test(html)) {
    const href = pathToFileURL(path.dirname(input.file) + path.sep).href.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
    const base = `<base href="${href}">`;
    html = /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, match => match + base)
      : /<!doctype[^>]*>/i.test(html) ? html.replace(/<!doctype[^>]*>/i, match => match + base) : base + html;
  }
  const file = path.join(folder, `html-${randomUUID()}.html`);
  await writeFile(file, html, { mode: 0o600, flag: 'wx' });
  return { file, url: pathToFileURL(file).href };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  htmlPreview(process.argv[2], JSON.parse(process.argv[3])).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const escapeAttribute = value => value.replaceAll('&', '&amp;').replaceAll('"', '&quot;');
const decodeAttribute = value => value.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[0-9a-f]+);/gi, entity => {
  const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' };
  if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
  const number = entity.slice(2, -1);
  const point = number[0].toLowerCase() === 'x' ? parseInt(number.slice(1), 16) : Number(number);
  return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : '\ufffd';
});

function localAssets(html, file) {
  const source = pathToFileURL(file).href;
  let hasHref = false;
  // Ignore comments and raw text: a sample <base> inside JavaScript is not a document base.
  html = html.replace(/<!--[\s\S]*?-->|<(script|style|textarea|title)\b[^>]*>[\s\S]*?<\/\1\s*>|<base\b(?:[^<>"']|"[^"]*"|'[^']*')*>/gi, tag => {
    if (!/^<base\b/i.test(tag)) return tag;
    const attributes = /([^\s=<>/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    for (const attr of tag.matchAll(attributes)) {
      if (attr[1].toLowerCase() !== 'href') continue;
      hasHref = true;
      const href = decodeAttribute(attr[2] ?? attr[3] ?? attr[4] ?? '');
      let absolute;
      try { absolute = new URL(href, source).href; }
      catch { absolute = source; }
      return tag.slice(0, attr.index) + `href="${escapeAttribute(absolute)}"` + tag.slice(attr.index + attr[0].length);
    }
    return tag;
  });
  if (hasHref) return html;
  const base = `<base href="${escapeAttribute(pathToFileURL(path.dirname(file) + path.sep).href)}">`;
  return /<head\b[^>]*>/i.test(html) ? html.replace(/<head\b[^>]*>/i, match => match + base)
    : /<!doctype[^>]*>/i.test(html) ? html.replace(/<!doctype[^>]*>/i, match => match + base) : base + html;
}

function previewFolder(home) {
  if (typeof home !== 'string' || !path.isAbsolute(home)) throw new Error('Invalid preview home');
  return path.join(home, 'previews');
}

function reservedInput(home, input) {
  const folder = previewFolder(home);
  if (typeof input !== 'string' || path.dirname(input) !== folder || !/^input-[0-9a-f-]{36}\.json$/.test(path.basename(input))) throw new Error('Invalid preview input');
  return input;
}

export async function reservePreview(home) {
  const folder = previewFolder(home);
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const input = path.join(folder, `input-${randomUUID()}.json`);
  await writeFile(input, '', { mode: 0o600, flag: 'wx' });
  return { input };
}

export async function discardPreview(home, input) {
  await rm(reservedInput(home, input), { force: true });
}

export async function renderPreview(home, input) {
  const file = reservedInput(home, input);
  try {
    if ((await stat(file)).size > 6000000) throw new Error('HTML preview is too large');
    return await htmlPreview(home, JSON.parse(await readFile(file, 'utf8')));
  } finally { await discardPreview(home, file); }
}

export async function htmlPreview(home, input) {
  const folder = previewFolder(home);
  if (typeof input?.html !== 'string' || input.html.length > 1000000) throw new Error('Invalid HTML preview');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  let html = input.html;
  if (!input.on && typeof input.file === 'string' && path.isAbsolute(input.file)) html = localAssets(html, input.file);
  const file = path.join(folder, `html-${randomUUID()}.html`);
  await writeFile(file, html, { mode: 0o600, flag: 'wx' });
  return { file, url: pathToFileURL(file).href };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, home, input] = process.argv.slice(2);
  Promise.resolve().then(() => {
    if (command === 'reserve') return reservePreview(home);
    if (command === 'render') return renderPreview(home, input);
    if (command === 'discard') return discardPreview(home, input).then(() => ({}));
    throw new Error('Expected reserve, render or discard');
  }).then(result => console.log(JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}

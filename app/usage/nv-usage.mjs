import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const CCUSAGE_VERSION = '20.0.51';
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').slice(0, 120);
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const unavailable = error => ({ available: false, error });
const isoSeconds = value => { const n = number(value), d = n === null ? null : new Date(n * 1000); return d && Number.isFinite(d.getTime()) ? d.toISOString() : null; };
const environment = () => ({ ...process.env, PATH: [path.dirname(process.execPath), path.join(homedir(), '.local/bin'), path.join(homedir(), '.cargo/bin'), process.env.PATH ?? ''].join(path.delimiter), npm_config_update_notifier: 'false' });

function run(command, args, timeout = 45000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: homedir(), env: environment(), stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '', settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('timeout')); }, timeout);
    child.stdout.on('data', data => { output += data; if (output.length > 8000000) { child.kill(); finish(new Error('output limit')); } });
    child.stderr.on('data', () => {}); // provider/tool diagnostics must never echo credentials
    child.on('error', () => finish(new Error('tool unavailable')));
    child.on('close', code => finish(code === 0 ? null : new Error('tool failed'), output));
  });
}

export function normalizeHistory(data) {
  if (!Array.isArray(data?.daily)) return unavailable('Invalid usage report');
  if (data.daily.some(day => !Array.isArray(day.agents) && (!day.agent || day.agent === 'all') && (number(day.totalTokens) ?? 0) > 0)) return unavailable('Per-agent usage missing');
  const providers = new Map();
  for (const day of data.daily) for (const entry of day.agents ?? (day.agent && day.agent !== 'all' ? [day] : [])) {
    const agent = clean(entry.agent || 'unknown');
    if (!providers.has(agent)) providers.set(agent, { agent, input: 0, output: 0, cache: 0, total: 0, models: new Map() });
    const p = providers.get(agent);
    p.input += number(entry.inputTokens) ?? 0; p.output += number(entry.outputTokens) ?? 0;
    p.cache += (number(entry.cacheReadTokens) ?? 0) + (number(entry.cacheCreationTokens) ?? 0);
    p.total += number(entry.totalTokens) ?? 0;
    for (const model of entry.modelBreakdowns ?? []) {
      const name = clean(model.modelName || 'unknown');
      if (!p.models.has(name)) p.models.set(name, { name, input: 0, output: 0, cache: 0, costUsd: 0, costKnown: true });
      const row = p.models.get(name);
      const input = number(model.inputTokens) ?? 0, output = number(model.outputTokens) ?? 0;
      const cache = (number(model.cacheReadTokens) ?? 0) + (number(model.cacheCreationTokens) ?? 0);
      row.input += input; row.output += output; row.cache += cache;
      const cost = number(model.cost);
      // An unpriced model must not look like free usage.
      if (model.missingPricing === true || cost === null || cost === 0 && input + output + cache > 0) row.costKnown = false;
      else row.costUsd += cost;
    }
  }
  const rows = [...providers.values()].map(p => {
    const models = [...p.models.values()].map(m => ({ ...m, costUsd: m.costKnown ? m.costUsd : null }));
    const costKnown = models.length > 0 && models.every(m => m.costKnown);
    return { ...p, models, costUsd: costKnown ? models.reduce((sum, m) => sum + m.costUsd, 0) : null };
  });
  return { available: true, noRecords: rows.length === 0, providers: rows, periods: data.daily.map(d => clean(d.period ?? d.date)), source: `ccusage ${CCUSAGE_VERSION}` };
}

export function normalizeCodex(data) {
  const windows = [];
  const buckets = data?.rateLimitsByLimitId;
  for (const [key, quota] of Object.entries(buckets && Object.keys(buckets).length ? buckets : { codex: data?.rateLimits })) {
    if (!quota) continue;
    for (const part of ['primary', 'secondary']) {
      const item = quota[part], used = number(item?.usedPercent);
      if (used === null) continue;
      windows.push({ label: clean(quota.limitName || key), minutes: number(item.windowDurationMins), used, remaining: Math.max(0, 100 - used), resetsAt: isoSeconds(item.resetsAt) });
    }
  }
  return windows.length ? { available: true, observedAt: new Date().toISOString(), windows, includedAllowed: data.ordinaryUsageAllowed ?? null } : unavailable('Quota not reported');
}

export function normalizeClaude(data) {
  const windows = Object.entries(data ?? {}).flatMap(([key, value]) => {
    const used = number(value?.utilization);
    return used === null ? [] : [{ label: clean(key), minutes: key === 'five_hour' ? 300 : key.startsWith('seven_day') ? 10080 : null, used, remaining: Math.max(0, 100 - used), resetsAt: typeof value.resets_at === 'string' && Number.isFinite(Date.parse(value.resets_at)) ? value.resets_at : null }];
  });
  return windows.length ? { available: true, observedAt: new Date().toISOString(), windows } : unavailable('Quota not reported');
}

export function codexQuota(command = 'codex', initialArgs = ['app-server', '--stdio']) {
  return new Promise(resolve => {
    const child = spawn(command, initialArgs, { cwd: homedir(), env: environment(), stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let buffer = '', done = false;
    const finish = value => {
      if (done) return; done = true; clearTimeout(timer); resolve(value);
      child.stdin.end(); setTimeout(() => child.kill(), 500).unref();
    };
    const timer = setTimeout(() => finish(unavailable('Quota read timed out')), 25000);
    const send = value => { if (!child.stdin.destroyed) child.stdin.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n'); };
    child.stdin.on('error', () => {}); child.stderr.on('data', () => {});
    child.on('error', () => finish(unavailable('Codex CLI unavailable')));
    child.on('close', () => finish(unavailable('Codex quota unavailable')));
    child.stdout.on('data', data => {
      buffer += data;
      if (buffer.length > 1000000) { finish(unavailable('Invalid quota response')); return; }
      let at;
      while ((at = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, at); buffer = buffer.slice(at + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) { finish(unavailable('Codex initialization failed')); return; }
          send({ method: 'initialized' });
          send({ id: 2, method: 'account/rateLimits/read', params: { excludeResetCreditDetails: true } });
        } else if (message.id === 2) finish(message.error ? unavailable('Codex sign-in or quota unavailable') : normalizeCodex(message.result));
      }
    });
    send({ id: 1, method: 'initialize', params: { clientInfo: { name: 'herdr-usage-read', version: '0.1.0' } } });
  });
}

function claudeToken() {
  if (process.env.CLAUDE_CODE_OAUTH_TOKEN) return process.env.CLAUDE_CODE_OAUTH_TOKEN;
  if (process.platform === 'darwin') {
    const suffix = process.env.CLAUDE_CONFIG_DIR ? '-' + createHash('sha256').update(process.env.CLAUDE_CONFIG_DIR.normalize('NFC')).digest('hex').slice(0, 8) : '';
    const r = spawnSync('security', ['find-generic-password', '-s', 'Claude Code-credentials' + suffix, '-w'], { encoding: 'utf8', timeout: 5000 });
    if (r.status === 0) try {
      const text = r.stdout.trim();
      const data = JSON.parse(/^(?:[0-9a-f]{2})+$/i.test(text) ? Buffer.from(text, 'hex').toString('utf8') : text);
      if (data.claudeAiOauth?.accessToken) return data.claudeAiOauth.accessToken;
    } catch {}
  }
  try { return JSON.parse(readFileSync(path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), '.credentials.json'), 'utf8')).claudeAiOauth?.accessToken; } catch { return null; }
}

export async function claudeQuota() {
  const token = claudeToken();
  if (!token) return unavailable('Claude CLI sign-in unavailable');
  try {
    const response = await fetch('https://api.anthropic.com/api/oauth/usage', { redirect: 'error', headers: { Authorization: 'Bearer ' + token.trim(), Accept: 'application/json', 'anthropic-beta': 'oauth-2025-04-20', 'User-Agent': 'herdr-usage/0.1' }, signal: AbortSignal.timeout(10000) });
    return response.ok ? normalizeClaude(await response.json()) : unavailable(response.status === 429 ? 'Quota service rate limited' : 'Claude sign-in or quota unavailable');
  } catch { return unavailable('Claude quota read failed'); }
}

async function reader() {
  const root = path.join(process.env.XDG_CACHE_HOME || process.env.LOCALAPPDATA || path.join(homedir(), '.cache'), 'herdr-neon-violet', 'usage', CCUSAGE_VERSION);
  const packageRoot = path.join(root, 'node_modules/ccusage');
  const entry = () => {
    try {
      const pkg = JSON.parse(readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
      const relative = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.ccusage;
      const file = path.resolve(packageRoot, relative ?? '');
      return pkg.version === CCUSAGE_VERSION && file.startsWith(packageRoot + path.sep) && existsSync(file) ? file : null;
    } catch { return null; }
  };
  const existing = entry();
  if (existing) return existing;
  await mkdir(root, { recursive: true, mode: 0o700 });
  let command = 'npm', args = ['install', '--prefix', root, '--ignore-scripts', '--no-audit', '--no-fund', '--save-exact', `ccusage@${CCUSAGE_VERSION}`];
  if (process.platform === 'win32') {
    const script = [path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), path.join(process.env.APPDATA || homedir(), 'npm/node_modules/npm/bin/npm-cli.js')].find(existsSync);
    if (!script) throw new Error('npm unavailable');
    command = process.execPath; args.unshift(script);
  }
  await run(command, args, 20000);
  const prepared = entry();
  if (!prepared) throw new Error('Usage reader unavailable');
  return prepared;
}

async function history(days, timezone) {
  try {
    const entry = await reader();
    return normalizeHistory(JSON.parse(await run(process.execPath, [entry, 'daily', '--last', String(days), '--by-agent', '--json', '--timezone', timezone], 30000)));
  }
  catch { return unavailable('Token/cost scan unavailable; Node.js and npm are required'); }
}

export async function collectUsage(options = {}) {
  const days = Number(options.days ?? 1);
  if (![1, 7, 30].includes(days)) throw new Error('Invalid usage period');
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat('en', { timeZone: timezone });
  const [tokens, codex, claude] = await Promise.all([history(days, timezone), options.skipQuotas ? null : codexQuota(), options.skipQuotas ? null : claudeQuota()]);
  return { version: 1, generatedAt: new Date().toISOString(), days, timezone, history: tokens, quotas: options.skipQuotas ? null : { codex, claude } };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  collectUsage(JSON.parse(process.argv[2] || '{}')).then(data => console.log(JSON.stringify(data)))
    .catch(() => { console.log(JSON.stringify({ version: 1, error: 'Usage collection failed' })); process.exitCode = 1; });
}

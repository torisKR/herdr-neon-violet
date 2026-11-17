import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeHistory, normalizeCodex, normalizeClaude, codexQuota, collectUsage } from '../usage/nv-usage.mjs';

test('history keeps device-local input/output/cache and per-model estimates separate', () => {
  const row = { agent: 'codex', inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, totalTokens: 130,
    modelBreakdowns: [{ modelName: 'model-a', inputTokens: 10, outputTokens: 20, cacheReadTokens: 100, cost: 0.5 }] };
  const data = normalizeHistory({ daily: [{ period: '2026-11-17', agents: [row] }, { period: '2026-11-18', agents: [row] }] });
  assert.equal(data.providers[0].input, 20);
  assert.equal(data.providers[0].cache, 200);
  assert.equal(data.providers[0].total, 260);
  assert.equal(data.providers[0].costUsd, 1);
  assert.equal(data.providers[0].models.length, 1);
});

test('unpriced usage remains counted and never appears as zero-cost usage', () => {
  const data = normalizeHistory({ daily: [{ agent: 'claude', totalTokens: 20, modelBreakdowns: [{ modelName: 'unknown', inputTokens: 20, cost: 0 }] }] });
  assert.equal(data.providers[0].total, 20);
  assert.equal(data.providers[0].costUsd, null);
  assert.equal(data.providers[0].models[0].costUsd, null);
  assert.equal(normalizeHistory({ daily: [] }).noRecords, true);
  assert.equal(normalizeHistory({ daily: [{ agent: 'all', totalTokens: 20 }] }).available, false);
});

test('quota snapshots preserve true window durations, unavailable data and backend restrictions', () => {
  const data = normalizeCodex({ ordinaryUsageAllowed: false, rateLimits: { primary: { usedPercent: 34, windowDurationMins: 10080, resetsAt: 1795514578 } } });
  assert.equal(data.windows[0].remaining, 66);
  assert.equal(data.windows[0].minutes, 10080);
  assert.equal(data.includedAllowed, false);
  assert.equal(normalizeCodex({ rateLimits: { primary: {} } }).available, false);
  assert.equal(normalizeCodex({ rateLimits: { primary: { usedPercent: 0, resetsAt: Number.MAX_VALUE } } }).windows[0].resetsAt, null);
  assert.equal(normalizeClaude({ seven_day: { utilization: 15, resets_at: '2026-11-23T08:00:00Z' } }).windows[0].remaining, 85);
});

test('only usage numbers and model labels leave provider responses', () => {
  const data = normalizeCodex({ accountId: 'private-account', accessToken: 'private-secret', rateLimits: { primary: { usedPercent: 20 } } });
  assert.ok(!JSON.stringify(data).includes('private-'));
  const claude = normalizeClaude({ accessToken: 'private-secret', five_hour: { utilization: 10 } });
  assert.ok(!JSON.stringify(claude).includes('private-'));
});

test('invalid collection options fail before starting authenticated reads', async () => {
  await assert.rejects(collectUsage({ days: 2 }), /Invalid usage period/);
  await assert.rejects(collectUsage({ timezone: 'not-a-timezone' }), RangeError);
});

test('Codex quota reader only initializes and reads limits without starting a model turn', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'nv-usage-rpc-'));
  try {
    const script = path.join(root, 'server.mjs'), log = path.join(root, 'methods.json');
    await writeFile(script, `import {writeFileSync} from 'node:fs';let b='',methods=[];process.stdin.on('data',d=>{b+=d;let at;while((at=b.indexOf('\\n'))>=0){let m=JSON.parse(b.slice(0,at));b=b.slice(at+1);methods.push(m.method);writeFileSync(${JSON.stringify(log)},JSON.stringify(methods));if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.id===1?{}:{rateLimits:{primary:{usedPercent:20,windowDurationMins:300}}}})+'\\n');}});process.stdin.on('end',()=>process.exit());`);
    const result = await codexQuota(process.execPath, [script]);
    assert.equal(result.windows[0].remaining, 80);
    assert.deepEqual(JSON.parse(await readFile(log, 'utf8')), ['initialize', 'initialized', 'account/rateLimits/read']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

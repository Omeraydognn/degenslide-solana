/**
 * READ-ONLY roster audit (dry run) — changes nothing, just reports.
 *
 * Unions every known address — the LIVE Render registry (/roster), the durable
 * local whale_registry, and the shipped curated JSON — then probes each on
 * chain to bucket them:
 *   - not a real wallet   (executable / non-System-owned)
 *   - inactive            (last tx older than the thresholds)
 *   - ok
 *
 * Usage: node analyzeRoster.js
 * Env: SOLANA_RPC, AUDIT_DELAY_MS(60)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));
const DELAY_MS = Number(process.env.AUDIT_DELAY_MS || 60);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');

const LIVE_URL = 'https://deepswap-solana-bot-h10w.onrender.com/roster';
const CURATED = path.join(__d, '..', 'src', 'data', 'curatedSolWhales.json');
const DAY = 86400000;

async function collect() {
  const norm = (a) => a; // base58 is case-sensitive
  const set = new Map(); // addr -> { source }
  let live = 0, local = 0, cur = 0;
  try {
    const r = await fetch(LIVE_URL, { signal: AbortSignal.timeout(30000) });
    const j = await r.json();
    for (const w of j.whales || []) if (w.address) { set.set(norm(w.address), w); live += 1; }
    console.log(`[audit] live roster: ${live} wallets`);
  } catch (e) { console.warn('[audit] live roster fetch failed:', e.message); }
  for (const r of db.loadWhaleRegistry()) if (r.address && !set.has(norm(r.address))) { set.set(norm(r.address), r); local += 1; }
  try { for (const w of (JSON.parse(fs.readFileSync(CURATED, 'utf8')).whales || [])) if (w.address && !set.has(norm(w.address))) { set.set(norm(w.address), w); cur += 1; } } catch {}
  console.log(`[audit] union = ${set.size} (live ${live} · +local-only ${local} · +curated-only ${cur})`);
  return [...set.keys()];
}

async function auditSolana(addrs) {
  const RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
  const SYS = '11111111111111111111111111111111';
  async function rpc(method, params) {
    const r = await fetch(RPC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000) });
    const j = await r.json(); if (j.error) throw new Error(j.error.message); return j.result;
  }
  const b = { program: [], pda: [], banned: [], noAccount: [], inactive30: [], inactive14: [], noSol: [], ok: 0 };
  let i = 0;
  for (const a of addrs) {
    i += 1;
    if (db.isBlacklisted(a)) { b.banned.push(a); continue; }
    let info;
    try { info = (await rpc('getAccountInfo', [a, { encoding: 'base64' }]))?.value; }
    catch { await sleep(DELAY_MS * 4); continue; }
    if (info == null) { b.noAccount.push(a); continue; }
    if (info.executable) { b.program.push(a); continue; }
    if (info.owner !== SYS) { b.pda.push(a); continue; }
    if ((Number(info.lamports) || 0) / 1e9 < 0.005) b.noSol.push(a);
    // true recency: newest signature blockTime
    try {
      const sigs = await rpc('getSignaturesForAddress', [a, { limit: 1 }]);
      const bt = sigs?.[0]?.blockTime ? sigs[0].blockTime * 1000 : null;
      if (bt) { const age = Date.now() - bt; if (age > 30 * DAY) b.inactive30.push(a); if (age > 14 * DAY) b.inactive14.push(a); else b.ok += 1; }
      else b.ok += 1;
    } catch { b.ok += 1; }
    if (i % 50 === 0) console.log(`  …probed ${i}/${addrs.length}`);
    await sleep(DELAY_MS);
  }
  return { b, hasRecency: true };
}

const pct = (n, t) => `${n} (${t ? Math.round((n / t) * 100) : 0}%)`;
async function main() {
  const addrs = await collect();
  console.log(`\n[audit] probing ${addrs.length} addresses on chain (read-only)…\n`);
  const { b } = await auditSolana(addrs);
  const t = addrs.length;
  console.log(`\n════════ SOLANA ROSTER AUDIT (${t} wallets) ════════`);
  console.log(`  ✗ programs (executable)      : ${pct(b.program.length, t)}`);
  console.log(`  ✗ PDA / non-System owner     : ${pct(b.pda.length, t)}`);
  console.log(`  ✗ already blacklisted        : ${pct(b.banned.length, t)}`);
  console.log(`  ⚠ no account on chain        : ${pct(b.noAccount.length, t)}`);
  console.log(`  ⚠ dust (<0.005 SOL)          : ${pct(b.noSol.length, t)}`);
  console.log(`  ⏰ inactive >30d (no tx)     : ${pct(b.inactive30.length, t)}`);
  console.log(`  ⏰ inactive >14d (no tx)     : ${pct(b.inactive14.length, t)}`);
  console.log(`\n  removable now (programs+pda + inactive>30d): ~${b.program.length + b.pda.length + b.inactive30.length}`);
  console.log(`════════════════════════════════════════════\n`);
  // dump lists for review
  const dump = { chain: 'solana', total: t, at: new Date().toISOString(), buckets: Object.fromEntries(Object.entries(b).map(([k, v]) => [k, Array.isArray(v) ? v : v])) };
  const outF = path.join('/tmp', 'roster-audit-solana.json');
  fs.writeFileSync(outF, JSON.stringify(dump, null, 2));
  console.log(`[audit] full address lists written to ${outF}`);
  process.exit(0);
}
main().catch((e) => { console.error('[audit] fatal', e.message || e); process.exit(1); });

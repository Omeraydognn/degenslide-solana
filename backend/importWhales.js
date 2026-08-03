/**
 * Import externally-sourced whale wallets (e.g. gmgn.ai top winners) into the
 * durable whale_registry — with REAL on-chain verification, never blindly.
 *
 *   node importWhales.js <addr> [addr…]     (or --file wallets.txt)
 *
 * Each address is verified against the chain before registering:
 *   valid base58 + getBalance succeeds (real account, balance recorded)
 *
 * Registered rows are permanent: the listener tracks every registry wallet forever.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __d = path.dirname(fileURLToPath(import.meta.url));

let addrs = process.argv.slice(2);
const fileIdx = addrs.indexOf('--file');
if (fileIdx >= 0) {
  const listPath = addrs[fileIdx + 1];
  addrs = fs.readFileSync(listPath, 'utf8').split(/[\s,;]+/).filter(Boolean);
}
if (!addrs.length) {
  console.error('usage: node importWhales.js <address…>  (or --file list.txt)');
  process.exit(1);
}

process.env.WHALE_DB = process.env.WHALE_DB || path.join(__d, 'solWhales.db');
const db = await import('./db.js');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const j = await res.json();
  if (j.error) throw new Error(j.error.message);
  return j.result;
}

const SOL_RPC = process.env.SOLANA_RPC || 'https://api.mainnet-beta.solana.com';
const B58 = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

let ok = 0, bad = 0;
for (const addr of addrs) {
  try {
    if (!B58.test(addr)) throw new Error('not base58');
    const bal = (await rpcCall(SOL_RPC, 'getBalance', [addr]))?.value / 1e9 || 0;
    db.registerWhale(addr, 'gmgn', { solBalance: bal });
    console.log(`[import] +${addr.slice(0, 10)}… · ${bal.toFixed(2)} SOL`);
    ok += 1;
  } catch (e) {
    bad += 1;
    console.warn(`[import] SKIP ${addr.slice(0, 12)}… — ${e.message}`);
  }
  await sleep(Number(process.env.IMPORT_DELAY_MS || 150));
}
console.log(`[import] done · ${ok} registered · ${bad} skipped · registry now ${db.loadWhaleRegistry().length} wallets`);

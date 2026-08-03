/**
 * DexScreener API Service — Solana.
 * Base: https://api.dexscreener.com
 */
import { ACTIVE, DEXSCREENER_CHAIN } from '../config/chain.js';

const DSX_BASE = 'https://api.dexscreener.com';
const CHAIN = DEXSCREENER_CHAIN; // 'solana'
// Native token whose USD price anchors the app (wSOL)
const NATIVE_TOKEN = ACTIVE.nativeToken;

async function dexFetch(path, timeout = 8000) {
  try {
    const res = await fetch(`${DSX_BASE}${path}`, {
      signal: AbortSignal.timeout(timeout),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  } catch {
    return null;
  }
}

/**
 * Fetch pair data for a specific token
 * Returns the best (highest volume) pair found
 * NOTE: /token-pairs/v1 returns a raw array (no wrapper object)
 */
export async function fetchTokenPairData(tokenAddress) {
  const data = await dexFetch(`/token-pairs/v1/${CHAIN}/${tokenAddress}`);
  const pairs = Array.isArray(data) ? data : data?.pairs ?? [];
  if (!pairs.length) return null;
  const best = [...pairs].sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];
  return normalizePair(best);
}

/**
 * Fetch multiple tokens by addresses at once
 */
export async function fetchTokensByAddresses(addresses) {
  if (!addresses?.length) return [];
  const data = await dexFetch(`/tokens/v1/${CHAIN}/${addresses.join(',')}`);
  const pairs = Array.isArray(data) ? data : data?.pairs ?? [];
  return pairs.map(normalizePair);
}

/**
 * Normalize a DexScreener pair response into a clean token info object
 */
export function normalizePair(pair) {
  return {
    pairAddress: pair.pairAddress,
    dexId: pair.dexId,
    url: pair.url,
    baseToken: {
      address: pair.baseToken?.address,
      symbol: pair.baseToken?.symbol,
      name: pair.baseToken?.name,
    },
    quoteToken: {
      address: pair.quoteToken?.address,
      symbol: pair.quoteToken?.symbol,
      name: pair.quoteToken?.name,
    },
    priceUsd: parseFloat(pair.priceUsd ?? 0),
    priceNative: parseFloat(pair.priceNative ?? 0),
    priceChange: {
      m5:  pair.priceChange?.m5  ?? 0,
      h1:  pair.priceChange?.h1  ?? 0,
      h6:  pair.priceChange?.h6  ?? 0,
      h24: pair.priceChange?.h24 ?? 0,
    },
    volume: {
      h24: pair.volume?.h24 ?? 0,
      h6:  pair.volume?.h6  ?? 0,
      h1:  pair.volume?.h1  ?? 0,
    },
    txns: {
      h24Buys:  pair.txns?.h24?.buys  ?? 0,
      h24Sells: pair.txns?.h24?.sells ?? 0,
      h1Buys:   pair.txns?.h1?.buys   ?? 0,
      h1Sells:  pair.txns?.h1?.sells  ?? 0,
    },
    liquidity:  pair.liquidity?.usd ?? 0,
    fdv:        pair.fdv        ?? 0,
    marketCap:  pair.marketCap  ?? 0,
    imageUrl:   pair.info?.imageUrl ?? null,
    dexUrl:     pair.url ?? null,
    createdAt:  pair.pairCreatedAt ?? null,
  };
}

/**
 * Native asset (SOL) price — highest-volume wSOL/USDC pair.
 * /token-pairs/v1 returns a raw array.
 */
export async function fetchNativePrice() {
  const data = await dexFetch(`/token-pairs/v1/${CHAIN}/${NATIVE_TOKEN}`);

  // API returns a plain array
  const pairs = (Array.isArray(data) ? data : data?.pairs ?? [])
    .filter((p) => p.chainId === CHAIN && p.baseToken?.address?.toLowerCase() === NATIVE_TOKEN.toLowerCase());
  if (!pairs.length) return null;

  // Prefer USDC quote, sort by 24h volume
  const usdcPairs = pairs
    .filter((p) => p.quoteToken?.symbol === 'USDC')
    .sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0));

  const best = usdcPairs[0] ?? pairs.sort((a, b) => (b.volume?.h24 ?? 0) - (a.volume?.h24 ?? 0))[0];
  return normalizePair(best);
}

/**
 * Calculate PnL for a portfolio position
 * entryPriceUsd: price at which user bought
 * currentPriceUsd: current price
 * amountNative: how much SOL was spent
 */
export function calcPnL(entryPriceUsd, currentPriceUsd, amountNative) {
  if (!entryPriceUsd || !currentPriceUsd) return null;
  const entryValue = amountNative * entryPriceUsd;
  const currentValue = amountNative * currentPriceUsd;
  const pnlUsd = currentValue - entryValue;
  const pnlPct = ((currentPriceUsd - entryPriceUsd) / entryPriceUsd) * 100;
  return { entryValue, currentValue, pnlUsd, pnlPct };
}

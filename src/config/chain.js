/**
 * Chain config — single source of truth. Solana mainnet only.
 * All values verified against official docs / live on-chain probes.
 * NO mock data: every address here is a real mainnet deployment.
 */

const env2 = typeof import.meta !== 'undefined' ? (import.meta.env ?? {}) : {};

export const CHAINS = {
  solana: {
    id: 'solana', label: 'Solana', kind: 'svm',
    nativeSymbol: 'SOL',
    nativeToken: 'So11111111111111111111111111111111111111112',
    dexSlug: 'solana',
    explorer: 'https://solscan.io', txPath: 'tx', addrPath: 'account',
    indexerHttp: env2.VITE_SOL_INDEXER_HTTP || 'https://deepswap-solana-bot-h10w.onrender.com',
    indexerWs: env2.VITE_SOL_INDEXER_WS || 'wss://deepswap-solana-bot-h10w.onrender.com',
    // Browser-facing RPC: the official api.mainnet-beta.solana.com returns 403
    // "Access forbidden" to browser origins for every method, which silently
    // breaks Turbo balance checks, sends and confirmations. PublicNode is
    // CORS-friendly and allows sendTransaction. Override with VITE_SOL_RPC for
    // a dedicated (Helius/QuickNode) endpoint in production.
    rpcUrl: env2.VITE_SOL_RPC || 'https://solana-rpc.publicnode.com',
    jupiterApi: 'https://lite-api.jup.ag/swap/v1', // live Jupiter aggregator (quote + swap tx)
    // Deck size tiers (USD) — EXCLUSIVE ranges (big < shark < whale); 'all' is
    // the hard floor and mirrors the indexer's TRACK_MIN_USD.
    // Calibrated to the REAL alpha-whale size distribution (bot/MM/stablecoin
    // flow is hard-filtered upstream): real entries cluster $150–3500.
    tiers: { all: 150, big: 400, shark: 1200, whale: 3500 },
    copySupported: true,                               // Phantom + Jupiter aggregator
    copyTiers: [{ label: '0.05', value: 0.05 }, { label: '0.25', value: 0.25 }, { label: '1', value: 1 }],
    gasBuffer: 0.01,
  },
};

export const ACTIVE = CHAINS.solana;

// Public explorer used for human-facing tx/address links
export const EXPLORER_URL = ACTIVE.explorer;
export const EXPLORER_TX_URL = (hash) => `${ACTIVE.explorer}/${ACTIVE.txPath}/${hash}`;
export const EXPLORER_ADDR_URL = (addr) => `${ACTIVE.explorer}/${ACTIVE.addrPath}/${addr}`;

// Default slippage tolerance for copy swaps (basis points). 1000 = 10%.
export const DEFAULT_SLIPPAGE_BPS = 1000; // 10% default for volatile meme coins

// ── Backend indexer endpoints (env-overridable: VITE_SOL_INDEXER_*) ──
export const INDEXER_WS = ACTIVE.indexerWs;
export const INDEXER_HTTP = ACTIVE.indexerHttp;

// DexScreener chain slug
export const DEXSCREENER_CHAIN = ACTIVE.dexSlug;

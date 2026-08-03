# DegenSlide — Solana Mainnet Whale Copy-Trade

Tinder-style copy trading on **Solana mainnet**. The app surfaces real whales
the moment they trade and lets you copy their buys with a swipe — **no mock,
fake, or static data anywhere**. Every card is a real on-chain swap; every copy
is a real Jupiter-routed transaction.

---

## How it works

1. **On-chain indexer** (`backend/solListener.js`) tracks a durable registry of
   proven Smart Money wallets (discovered via `gmgnSync.js` + the pluggable
   sources in `discoverySources.js`), polls each wallet's signatures, parses the
   real pre/post token-balance deltas of every swap, and streams whale-sized
   buys/sells live over WebSocket.
2. **Deck** — each card is a real whale trade (real wallet, token, SOL size),
   enriched with live **DexScreener** market data (price, liquidity, FDV, volume).
3. **Swipe right = copy** — buys the whale's token with SOL through the **Jupiter**
   aggregator, signed locally by the Turbo wallet (no popup per trade).
4. **Swipe up = save the whale**, swipe left = skip.
5. **Leaderboard** ranks wallets by real indexed performance; **Watchlist** tracks
   any wallet's trades; **Portfolio** tracks your copies + live PnL, with
   stop-loss / take-profit and "sell when the whale sells".

---

## Real mainnet endpoints used

| What | Value |
|------|-------|
| Chain | Solana mainnet-beta |
| wSOL | `So11111111111111111111111111111111111111112` |
| Swap routing | Jupiter — `https://lite-api.jup.ag/swap/v1` |
| Explorer | https://solscan.io |

---

## Run it

**1. Start the whale indexer** (the deck depends on it):

```bash
cd backend
npm install
npm start          # HTTP + WebSocket on :8084
```

Tune via env (see `backend/.env.example`), e.g. `TRACK_MIN_USD=150`.

**2. Start the frontend:**

```bash
npm install
cp .env.example .env   # points at the hosted indexer by default
npm run dev            # http://localhost:5173
```

Log in with Privy (email / social / Phantom) and start swiping.

> **Real money:** copies execute real swaps on mainnet with your own funds.
> Start with a small copy amount in the ⚙️ settings.

---

## Tech

React 18 · Vite · Tailwind · react-tinder-card · framer-motion ·
Privy · @solana/web3.js · Jupiter · ws · better-sqlite3 · DexScreener API.

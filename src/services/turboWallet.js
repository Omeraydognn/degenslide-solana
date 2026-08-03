/**
 * TURBO trading wallet — one-swipe execution with NO per-trade wallet popups.
 *
 * How it works (the same model GMGN / Photon / BullX use):
 *   1. The user connects their external wallet (Phantom) and signs ONE gasless
 *      message. The Turbo trading key is DERIVED from that signature — so the
 *      external wallet permanently "owns" it.
 *   2. Because the derivation is deterministic, signing the same message with
 *      the same wallet on ANY device / browser restores the exact same trading
 *      wallet and its funds. Clearing localStorage never loses the account.
 *   3. The user funds it with ONE normal wallet-approved transfer.
 *   4. Every subsequent swipe signs the swap locally with the Turbo key and
 *      broadcasts straight to the chain — zero confirmations, zero popups.
 *
 * All execution is 100% real on-chain: same routing/quoting as the interactive
 * path (solWallet.js builders), just a different signer. Withdraw sweeps funds
 * back to any address, signed locally.
 *
 * RECOVERY MODEL: the key is cached in localStorage for a popup-free session,
 * but it is never the source of truth — the external wallet's signature is.
 * Lose the device, connect the same wallet elsewhere, re-sign → same wallet.
 */
import { Keypair, VersionedTransaction, Transaction, SystemProgram, PublicKey } from '@solana/web3.js';
import { ACTIVE, DEFAULT_SLIPPAGE_BPS } from '../config/chain.js';
import {
  rpc as solRpc, jupQuote, jupSwapTx, confirmOnChain, actualTokenDelta,
  mintDecimals, dexLabel, getTokenInfo as solTokenInfo, sendRawTransaction, signMessage as solSignMessage,
} from './solWallet.js';

const AGREED_LS = 'turbo_agreed_v1';           // agreement is global (per device)
const KEY_LS = `${ACTIVE.id}_turbo_key_v1`;    // keypair
const LINKED_LS = `${ACTIVE.id}_turbo_linked_v1`; // external wallet the key is derived from
const WSOL = ACTIVE.nativeToken;
const SOL_FEE_LAMPORTS = 5000n;                // base tx fee
const SOL_TURBO_BUFFER = 0.01;                 // fee + ATA rent headroom per swap

/* ── agreement ── */
export function hasTurboAgreement() {
  try { return localStorage.getItem(AGREED_LS) === '1'; } catch { return false; }
}
export function acceptTurboAgreement() {
  try { localStorage.setItem(AGREED_LS, '1'); } catch {}
}

/* ── keypair lifecycle (local only — never leaves the device) ── */
function loadKey() {
  try { return localStorage.getItem(KEY_LS) || null; } catch { return null; }
}
export function turboWalletExists() { return !!loadKey(); }

export function ensureTurboWallet() {
  let secret = loadKey();
  if (!secret) {
    secret = btoa(String.fromCharCode(...Keypair.generate().secretKey));
    try { localStorage.setItem(KEY_LS, secret); } catch { throw new Error('STORAGE_UNAVAILABLE'); }
  }
  return getTurboAddress();
}

/* ── account linking: derive the Turbo key from an external-wallet signature ──
 *
 * This is the "save / recover your account" step. The message is FIXED (no
 * nonce, no timestamp) so the signature — and therefore the derived key — is
 * identical every time the same wallet signs it, on any device.
 */
function linkMessage() {
  return (
    'DegenSlide — Trading Wallet\n\n' +
    'Sign to create and recover your in-app trading wallet.\n' +
    'This signature IS your account key: signing this same message with this ' +
    'same wallet always restores the same trading wallet and its funds.\n\n' +
    'This request is free and gasless. It will NOT send a transaction, ' +
    'approve spending, or move any funds.\n\n' +
    `Network: ${ACTIVE.label}`
  );
}

/** The external wallet address the local Turbo key is derived from (or null). */
export function getLinkedAddress() {
  try { return localStorage.getItem(LINKED_LS) || null; } catch { return null; }
}
/** True once a derived key AND its external-wallet link are both present. */
export function isTurboLinked() { return !!getLinkedAddress() && turboWalletExists(); }

/**
 * Forget the Turbo wallet on THIS device (log out). Safe only for a LINKED
 * wallet — the key is deterministically recoverable by reconnecting and
 * re-signing, so nothing is lost. Refuses on an unlinked legacy key (that key
 * exists nowhere else — clearing it would strand its funds; export it first).
 */
export function unlinkTurbo(force = false) {
  if (!force && turboWalletExists() && !isTurboLinked()) throw new Error('UNLINKED_KEY_EXPORT_FIRST');
  try {
    localStorage.removeItem(KEY_LS);
    localStorage.removeItem(LINKED_LS);
  } catch { /* ignore */ }
}

/**
 * Link (or recover) the Turbo wallet from `externalAddress`.
 * Prompts ONE gasless signature via the external wallet, derives the trading
 * key deterministically from it, and caches both the key and the link locally.
 * Returns the Turbo address (same value every time for a given wallet).
 */
export async function linkTurboWallet(externalAddress) {
  if (!externalAddress) throw new Error('NO_WALLET');
  const sig = await solSignMessage(externalAddress, linkMessage()); // 64-byte Ed25519 signature
  if (!sig || sig.length < 32) throw new Error('SIGN_FAILED');
  // SHA-256 of the signature → the same 32-byte seed the previous ethers-based
  // derivation produced, so already-linked wallets keep their exact Turbo key.
  const seed = new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(sig)));
  const secret = btoa(String.fromCharCode(...Keypair.fromSeed(seed).secretKey));
  try {
    localStorage.setItem(KEY_LS, secret);
    localStorage.setItem(LINKED_LS, externalAddress);
    localStorage.setItem(AGREED_LS, '1');
  } catch { throw new Error('STORAGE_UNAVAILABLE'); }
  return getTurboAddress();
}

function solKeypair() {
  const secret = loadKey();
  if (!secret) throw new Error('NO_TURBO_WALLET');
  return Keypair.fromSecretKey(Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)));
}

export function getTurboAddress() {
  const secret = loadKey();
  if (!secret) return null;
  return solKeypair().publicKey.toString();
}

/** Private key export — shown once to the user for backup. */
export function exportTurboKey() {
  const secret = loadKey();
  if (!secret) throw new Error('NO_TURBO_WALLET');
  return JSON.stringify([...solKeypair().secretKey]); // standard Solana JSON keypair
}

/* ── balance ── */
export async function getTurboBalance() {
  const addr = getTurboAddress();
  if (!addr) return null;
  try { return ((await solRpc('getBalance', [addr]))?.value ?? 0) / 1e9; }
  catch { return null; }
}

/* ── deposit: ONE wallet-approved transfer from the user's main wallet ──
 * The signer is resolved STRICTLY from the Privy wallet that owns `fromMain`
 * (a linked external wallet, or the account's embedded wallet). There is
 * deliberately no `window.phantom` fallback: reaching for the raw extension
 * made a social-login user's deposit try to spend from an address they never
 * linked. No owner → NO_WALLET, and the UI asks them to link one.
 */
function ownerWalletFor(address) {
  return [window.activeExternalWallet, window.activePrivyWallet]
    .find((w) => w?.address && w.address === address) || null;
}

export async function depositToTurbo(fromMain, amountNative) {
  const to = ensureTurboWallet();
  if (!(amountNative > 0)) throw new Error('BAD_AMOUNT');
  const owner = ownerWalletFor(fromMain);
  if (!owner) throw new Error('NO_WALLET');
  const p = await owner.getSolanaProvider?.() ?? owner;
  if (!p?.signAndSendTransaction) throw new Error('NO_WALLET');
  const { value } = await solRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const tx = new Transaction({
    recentBlockhash: value.blockhash,
    feePayer: new PublicKey(fromMain),
  }).add(SystemProgram.transfer({
    fromPubkey: new PublicKey(fromMain),
    toPubkey: new PublicKey(to),
    lamports: Math.round(amountNative * 1e9),
  }));
  const { signature } = await p.signAndSendTransaction(tx);
  await confirmOnChain(signature);
  return { hash: signature };
}

/* ── withdraw: send Turbo funds back out, signed locally (no popup) ──
 * amountNative:
 *   • a positive number  → withdraw EXACTLY that much (the rest stays for fees)
 *   • omitted / falsy    → sweep the MAX withdrawable (balance minus the fee)
 */
export async function withdrawTurbo(toAddress, amountNative) {
  const wantExact = typeof amountNative === 'number' && amountNative > 0;

  if (!toAddress) throw new Error('BAD_ADDRESS');
  try { new PublicKey(toAddress); } catch { throw new Error('BAD_ADDRESS'); }
  const kp = solKeypair();
  const bal = BigInt((await solRpc('getBalance', [kp.publicKey.toString()]))?.value ?? 0);
  let lamports;
  if (wantExact) {
    lamports = BigInt(Math.round(amountNative * 1e9));
    if (lamports <= 0n) throw new Error('BAD_AMOUNT');
    if (lamports + SOL_FEE_LAMPORTS > bal) {
      throw Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: Number(lamports + SOL_FEE_LAMPORTS) / 1e9, haveMon: Number(bal) / 1e9 });
    }
  } else {
    lamports = bal - SOL_FEE_LAMPORTS;
    if (lamports <= 0n) throw new Error('NO_BALANCE');
  }
  const { value } = await solRpc('getLatestBlockhash', [{ commitment: 'confirmed' }]);
  const tx = new Transaction({ recentBlockhash: value.blockhash, feePayer: kp.publicKey })
    .add(SystemProgram.transfer({ fromPubkey: kp.publicKey, toPubkey: new PublicKey(toAddress), lamports: Number(lamports) }));
  tx.sign(kp);
  const sig = await solRpc('sendTransaction', [btoa(String.fromCharCode(...tx.serialize())), { encoding: 'base64', maxRetries: 3 }]);
  await confirmOnChain(sig);
  return { hash: sig, amount: Number(lamports) / 1e9 };
}

/* ── TURBO BUY: swipe → signed locally → broadcast. No popup, ever. ── */
export async function turboCopyBuy(tokenAddress, amountNative, opts = {}) {
  const kp = solKeypair();
  const from = kp.publicKey.toString();
  const bal = ((await solRpc('getBalance', [from]))?.value ?? 0) / 1e9;
  if (bal < amountNative + SOL_TURBO_BUFFER) {
    throw Object.assign(new Error('INSUFFICIENT_FUNDS'), { needMon: amountNative + SOL_TURBO_BUFFER, haveMon: bal, turbo: true });
  }
  const quote = await jupQuote(WSOL, tokenAddress, Math.round(amountNative * 1e9), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  if (!quote) throw new Error('NO_LIQUIDITY');
  const [{ swapTransaction, lastValidBlockHeight }, decimals] = await Promise.all([jupSwapTx(quote, from), mintDecimals(tokenAddress)]);
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0)));
  tx.sign([kp]);
  const hash = await sendRawTransaction(tx.serialize(), lastValidBlockHeight);
  const realOut = await actualTokenDelta(hash, from, tokenAddress);
  return { hash, dex: dexLabel(quote), fee: null, expectedOut: realOut ?? quote.outAmount, amountOutMin: quote.otherAmountThreshold, decimals, turbo: true, turboAddress: from };
}

/* ── TURBO SELL: close a Turbo position, signed locally ── */
export async function turboSellToken(tokenAddress, opts = {}) {
  const kp = solKeypair();
  const from = kp.publicKey.toString();
  const { raw: balance } = await solTokenInfo(from, tokenAddress);
  if (balance <= 0n) throw new Error('NO_BALANCE');
  let amountIn = balance;
  if (opts.amountRaw) { try { const want = BigInt(opts.amountRaw); if (want > 0n && want < balance) amountIn = want; } catch {} }
  const quote = await jupQuote(tokenAddress, WSOL, amountIn.toString(), opts.slippageBps ?? DEFAULT_SLIPPAGE_BPS);
  if (!quote) throw new Error('NO_LIQUIDITY');
  const { swapTransaction, lastValidBlockHeight } = await jupSwapTx(quote, from);
  const tx = VersionedTransaction.deserialize(Uint8Array.from(atob(swapTransaction), (c) => c.charCodeAt(0)));
  tx.sign([kp]);
  const hash = await sendRawTransaction(tx.serialize(), lastValidBlockHeight);
  return { hash, dex: dexLabel(quote), amountIn: amountIn.toString(), expectedOut: quote.outAmount, turbo: true };
}

/** Token balance held by the TURBO wallet (for sells of turbo positions). */
export async function turboTokenInfo(tokenAddress) {
  const addr = getTurboAddress();
  if (!addr) return { raw: 0n, decimals: null };
  return solTokenInfo(addr, tokenAddress);
}

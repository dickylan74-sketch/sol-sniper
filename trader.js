// trader.js — eksekusi swap via Jupiter API + Solana Web3.js
import {
  Connection, Keypair, VersionedTransaction,
  PublicKey, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import fetch from "node-fetch";
import { log } from "./logger.js";

const JUPITER_QUOTE  = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP   = "https://quote-api.jup.ag/v6/swap";
const WSOL_MINT      = "So11111111111111111111111111111111111111112";
const DEXSCREENER    = "https://api.dexscreener.com/latest/dex/tokens";

let _connection = null;
let _wallet = null;

function getConnection() {
  if (!_connection) {
    _connection = new Connection(
      process.env.RPC_URL ?? "https://api.mainnet-beta.solana.com",
      { commitment: "confirmed" }
    );
  }
  return _connection;
}

function getWallet() {
  if (!_wallet) {
    const key = process.env.WALLET_PRIVATE_KEY;
    if (!key) throw new Error("WALLET_PRIVATE_KEY tidak diset di .env");
    _wallet = Keypair.fromSecretKey(bs58.decode(key));
  }
  return _wallet;
}

// ── get current price dari DexScreener ───────────────────────────────
export async function getCurrentPrice(mint) {
  try {
    const res = await fetch(`${DEXSCREENER}/${mint}`, { timeout: 8000 });
    if (!res.ok) return 0;
    const data = await res.json();
    const pair = (data.pairs ?? [])
      .filter(p => p.chainId === "solana")
      .sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0))[0];
    return parseFloat(pair?.priceUsd ?? 0);
  } catch {
    return 0;
  }
}

// ── get SOL balance wallet ────────────────────────────────────────────
export async function getWalletBalance() {
  try {
    const conn = getConnection();
    const wallet = getWallet();
    const lamports = await conn.getBalance(wallet.publicKey);
    return lamports / LAMPORTS_PER_SOL;
  } catch (e) {
    log.warn("Gagal cek balance:", e.message);
    return 0;
  }
}

// ── Jupiter quote ─────────────────────────────────────────────────────
async function getQuote({ inputMint, outputMint, amountLamports, slippageBps }) {
  const url = new URL(JUPITER_QUOTE);
  url.searchParams.set("inputMint", inputMint);
  url.searchParams.set("outputMint", outputMint);
  url.searchParams.set("amount", amountLamports.toString());
  url.searchParams.set("slippageBps", slippageBps.toString());

  const res = await fetch(url.toString(), { timeout: 10000 });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jupiter quote gagal: ${err}`);
  }
  return res.json();
}

// ── Jupiter swap transaction ──────────────────────────────────────────
async function getSwapTransaction(quoteResponse, userPublicKey) {
  const res = await fetch(JUPITER_SWAP, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse,
      userPublicKey: userPublicKey.toString(),
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
    timeout: 15000,
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Jupiter swap tx gagal: ${err}`);
  }
  return res.json();
}

// ── send & confirm transaction ────────────────────────────────────────
async function sendTransaction(swapTransactionBuf, wallet, connection) {
  const transaction = VersionedTransaction.deserialize(
    Buffer.from(swapTransactionBuf, "base64")
  );
  transaction.sign([wallet]);

  const rawTx = transaction.serialize();
  const txHash = await connection.sendRawTransaction(rawTx, {
    skipPreflight: true,
    maxRetries: 3,
  });

  log.info(`Tx sent: ${txHash}`);

  // wait for confirmation
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  await connection.confirmTransaction(
    { signature: txHash, blockhash, lastValidBlockHeight },
    "confirmed"
  );

  return txHash;
}

// ── BUY token dengan SOL ──────────────────────────────────────────────
export async function executeBuy({ mint, symbol, amountSOL, slippageBps, dryRun }) {
  if (dryRun) {
    log.warn(`[DRY RUN] Simulasi BUY ${symbol} dengan ${amountSOL} SOL`);
    // simulate response
    return {
      txHash: null,
      tokensReceived: (amountSOL * 1000000) / 0.00001, // simulasi
      solSpent: amountSOL,
      dryRun: true,
    };
  }

  const conn = getConnection();
  const wallet = getWallet();
  const lamports = Math.floor(amountSOL * LAMPORTS_PER_SOL);

  log.trade(`BUY ${symbol}: ${amountSOL} SOL → ${mint.slice(0, 8)}...`);

  // check balance dulu
  const balance = await getWalletBalance();
  if (balance < amountSOL + 0.01) {
    throw new Error(`Balance tidak cukup: ${balance.toFixed(4)} SOL (butuh ${amountSOL + 0.01})`);
  }

  const quote = await getQuote({
    inputMint: WSOL_MINT,
    outputMint: mint,
    amountLamports: lamports,
    slippageBps,
  });

  const { swapTransaction } = await getSwapTransaction(quote, wallet.publicKey);
  const txHash = await sendTransaction(swapTransaction, wallet, conn);

  const tokensReceived = parseInt(quote.outAmount ?? "0");

  log.success(`BUY ${symbol} sukses! Tx: ${txHash}`);
  return { txHash, tokensReceived, solSpent: amountSOL, dryRun: false };
}

// ── SELL token kembali ke SOL ─────────────────────────────────────────
export async function executeSell({ mint, symbol, tokensAmount, slippageBps, dryRun }) {
  if (dryRun) {
    const currentPrice = await getCurrentPrice(mint);
    log.warn(`[DRY RUN] Simulasi SELL ${symbol} ${tokensAmount} tokens`);
    return {
      txHash: null,
      solReceived: 0.1 * (1 + (Math.random() - 0.5) * 0.4), // simulasi
      priceUSD: currentPrice,
      dryRun: true,
    };
  }

  const conn = getConnection();
  const wallet = getWallet();

  if (!tokensAmount || tokensAmount <= 0) {
    throw new Error(`Jumlah token tidak valid: ${tokensAmount}`);
  }

  log.trade(`SELL ${symbol}: ${tokensAmount} tokens → SOL`);

  const quote = await getQuote({
    inputMint: mint,
    outputMint: WSOL_MINT,
    amountLamports: Math.floor(tokensAmount),
    slippageBps,
  });

  const { swapTransaction } = await getSwapTransaction(quote, wallet.publicKey);
  const txHash = await sendTransaction(swapTransaction, wallet, conn);

  const solReceived = parseInt(quote.outAmount ?? "0") / LAMPORTS_PER_SOL;
  const currentPrice = await getCurrentPrice(mint);

  log.success(`SELL ${symbol} sukses! ${solReceived.toFixed(4)} SOL diterima. Tx: ${txHash}`);
  return { txHash, solReceived, priceUSD: currentPrice, dryRun: false };
}

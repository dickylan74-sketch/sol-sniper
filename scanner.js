// scanner.js — scan coin baru yang graduate dari pump.fun
import fetch from "node-fetch";
import { CONFIG } from "./config.js";
import { log } from "./logger.js";
import { state } from "./state.js";

const DEXSCREENER_BASE = "https://api.dexscreener.com";
const MORALIS_GRAD_URL = "https://solana-gateway.moralis.io/token/mainnet/exchange/pumpfun/graduated";

// ── fetch recently graduated tokens via Moralis ───────────────────────
async function fetchGraduatedTokens() {
  const apiKey = process.env.MORALIS_API_KEY;
  if (!apiKey) {
    log.warn("MORALIS_API_KEY tidak ada di .env");
    return [];
  }
  try {
    const res = await fetch(`${MORALIS_GRAD_URL}?limit=50`, {
      headers: {
        "X-API-Key": apiKey,
        Accept: "application/json",
      },
      timeout: 10000,
    });
    if (!res.ok) throw new Error(`Moralis API ${res.status}`);
    const data = await res.json();
    // Moralis returns { result: [...] }
    const list = Array.isArray(data) ? data : (data.result ?? []);
    // normalize ke format {mint} yang dipakai scanner
    return list.map(t => ({ mint: t.mint ?? t.tokenAddress ?? t.address })).filter(t => t.mint);
  } catch (e) {
    log.warn("Moralis API gagal, fallback ke DexScreener:", e.message);
    return [];
  }
}

// ── fetch token info dari DexScreener ────────────────────────────────
async function fetchDexScreener(mints) {
  if (!mints.length) return [];
  try {
    // DexScreener support batch max 30
    const chunk = mints.slice(0, 30).join(",");
    const res = await fetch(
      `${DEXSCREENER_BASE}/latest/dex/tokens/${chunk}`,
      { timeout: 10000 }
    );
    if (!res.ok) throw new Error(`DexScreener ${res.status}`);
    const data = await res.json();
    return data.pairs ?? [];
  } catch (e) {
    log.warn("DexScreener gagal:", e.message);
    return [];
  }
}

// ── scan new tokens dari DexScreener langsung (backup) ───────────────
async function fetchNewTokensDexScreener() {
  try {
    const res = await fetch(
      `${DEXSCREENER_BASE}/latest/dex/search?q=pump`,
      { timeout: 10000 }
    );
    if (!res.ok) return [];
    const data = await res.json();
    // filter hanya Solana, sort by age
    return (data.pairs ?? [])
      .filter(p => p.chainId === "solana")
      .sort((a, b) => (b.pairCreatedAt ?? 0) - (a.pairCreatedAt ?? 0))
      .slice(0, 50);
  } catch {
    return [];
  }
}

// ── hitung organic score sederhana ───────────────────────────────────
function calcOrganicScore(pair) {
  let score = 50;
  const txns = pair.txns?.h1 ?? {};
  const buys = txns.buys ?? 0;
  const sells = txns.sells ?? 0;
  const total = buys + sells;

  // buy/sell ratio (terlalu banyak buy bisa bot)
  if (total > 0) {
    const buyRatio = buys / total;
    if (buyRatio > 0.95) score -= 20; // suspiciously all buys
    else if (buyRatio > 0.7 && buyRatio < 0.9) score += 15;
    else if (buyRatio > 0.5) score += 5;
  }

  // volume vs liquidity ratio
  const vol1h = pair.volume?.h1 ?? 0;
  const liq = parseFloat(pair.liquidity?.usd ?? 0);
  if (liq > 0) {
    const ratio = vol1h / liq;
    if (ratio > 20) score -= 15; // wash trading suspect
    else if (ratio > 2) score += 10;
    else if (ratio > 0.5) score += 5;
  }

  // holder proxy: unique makers
  const makers = pair.makers?.h1 ?? pair.txns?.h24?.buys ?? 0;
  if (makers > 200) score += 20;
  else if (makers > 100) score += 10;
  else if (makers < 20) score -= 15;

  // price change sanity
  const change1h = Math.abs(pair.priceChange?.h1 ?? 0);
  if (change1h > 500) score -= 10; // too pump/dump
  else if (change1h > 50) score += 5;

  return Math.max(0, Math.min(100, score));
}

// ── normalize pair data ke format token kita ─────────────────────────
function normalizePair(pair) {
  const createdAt = pair.pairCreatedAt ?? Date.now();
  const ageMin = (Date.now() - createdAt) / 60000;
  const liqUSD = parseFloat(pair.liquidity?.usd ?? 0);
  const vol1hUSD = pair.volume?.h1 ?? 0;
  const vol24hUSD = pair.volume?.h24 ?? 0;
  const priceUSD = parseFloat(pair.priceUsd ?? 0);
  const priceChange1h = pair.priceChange?.h1 ?? 0;
  const priceChange5m = pair.priceChange?.m5 ?? 0;
  const organicScore = calcOrganicScore(pair);
  const holders = pair.makers?.h1 ?? pair.txns?.h24?.buys ?? 0;
  const fdv = parseFloat(pair.fdv ?? 0);

  return {
    mint: pair.baseToken?.address,
    symbol: pair.baseToken?.symbol ?? "???",
    name: pair.baseToken?.name ?? "",
    pairAddress: pair.pairAddress,
    dex: pair.dexId,
    priceUSD,
    liqUSD,
    vol1hUSD,
    vol24hUSD,
    priceChange1h,
    priceChange5m,
    organicScore,
    holders,
    fdv,
    ageMin,
    createdAt,
    url: pair.url,
    graduated: true, // kalau sudah di DEX = sudah graduated
  };
}

// ── filter token berdasarkan CONFIG ──────────────────────────────────
export function filterToken(token) {
  const reasons = [];

  if (token.liqUSD < CONFIG.minLiquidityUSD)
    reasons.push(`liq $${token.liqUSD.toFixed(0)} < min $${CONFIG.minLiquidityUSD}`);

  if (token.liqUSD > CONFIG.maxLiquidityUSD)
    reasons.push(`liq $${token.liqUSD.toFixed(0)} > max $${CONFIG.maxLiquidityUSD}`);

  if (token.vol1hUSD < CONFIG.minVolumeUSD)
    reasons.push(`vol1h $${token.vol1hUSD.toFixed(0)} < min $${CONFIG.minVolumeUSD}`);

  if (token.ageMin > CONFIG.maxAgeMinutes)
    reasons.push(`umur ${token.ageMin.toFixed(0)}m > max ${CONFIG.maxAgeMinutes}m`);

  if (token.organicScore < CONFIG.minOrganicScore)
    reasons.push(`organic ${token.organicScore} < min ${CONFIG.minOrganicScore}`);

  if (!token.priceUSD || token.priceUSD <= 0)
    reasons.push("harga tidak valid");

  return { pass: reasons.length === 0, reasons };
}

// ── main scan function ────────────────────────────────────────────────
export async function scanNewTokens() {
  log.scan("Scanning coin baru dari pump.fun + DexScreener...");

  // ambil dari dua sumber
  const [graduated, dexPairs] = await Promise.all([
    fetchGraduatedTokens(),
    fetchNewTokensDexScreener(),
  ]);

  // extract mints dari pump.fun graduates
  const gradMints = graduated
    .map(t => t.mint)
    .filter(Boolean)
    .slice(0, 30);

  // fetch detail dari DexScreener untuk grad tokens
  let gradPairs = [];
  if (gradMints.length) {
    gradPairs = await fetchDexScreener(gradMints);
  }

  // gabungkan, deduplicate by mint
  const allPairs = [...gradPairs, ...dexPairs];
  const seen = new Set();
  const unique = allPairs.filter(p => {
    const mint = p.baseToken?.address;
    if (!mint || seen.has(mint)) return false;
    seen.add(mint);
    return true;
  });

  // normalize
  const tokens = unique
    .map(normalizePair)
    .filter(t => t.mint && t.priceUSD > 0);

  // filter yang sudah pernah discreening dan belum expired
  const RESCAN_EXPIRY_MS = 30 * 60 * 1000; // re-evaluasi setelah 30 menit
  const now = Date.now();
  const fresh = tokens.filter(t => {
    const scannedAt = state.scannedTokens.get(t.mint);
    return !scannedAt || (now - scannedAt) > RESCAN_EXPIRY_MS;
  });

  log.scan(
    `Ditemukan ${tokens.length} token, ${fresh.length} baru/expired untuk dievaluasi`
  );

  // tandai sebagai sudah discreening dengan timestamp
  fresh.forEach(t => state.scannedTokens.set(t.mint, now));
  // bersihkan entry yang sudah sangat lama (>2 jam)
  const PURGE_MS = 2 * 60 * 60 * 1000;
  for (const [mint, ts] of state.scannedTokens) {
    if (now - ts > PURGE_MS) state.scannedTokens.delete(mint);
  }

  return fresh;
}

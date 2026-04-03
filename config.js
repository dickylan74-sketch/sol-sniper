// config.js — semua parameter bisa diubah tanpa restart
// Edit langsung file ini atau lewat Telegram /config

export const CONFIG = {
  // ── AGENT INTERVALS ─────────────────────────────────────────────────
  scanIntervalMin: 15,         // seberapa sering scan coin baru (menit)
  monitorIntervalMin: 3,       // seberapa sering monitor posisi open (menit)
  healthCheckIntervalMin: 30,  // laporan kesehatan portfolio (menit)

  // ── FILTER COIN BARU ─────────────────────────────────────────────────
  // Hanya beli kalau semua filter lolos
  minLiquidityUSD: 1000,       // minimum likuiditas pool ($)
  maxLiquidityUSD: 500000,     // maximum (hindari whale trap)
  minVolumeUSD: 500,          // minimum volume 1 jam terakhir ($)
  minHolders: 50,              // minimum jumlah holder
  maxAgeMinutes: 720,          // maksimal umur token sejak graduate (menit)
  minOrganicScore: 40,         // 0-100, filter bot activity
  requireGraduated: true,      // harus sudah graduate dari pump.fun

  // ── TRADING ──────────────────────────────────────────────────────────
  tradeAmountSOL: 0.1,         // SOL per trade
  maxOpenPositions: 5,         // maksimum posisi bersamaan
  slippageBps: 300,            // slippage tolerance (300 = 3%)

  // ── EXIT STRATEGY ────────────────────────────────────────────────────
  takeProfitPct: 50,           // take profit di +50%
  stopLossPct: 20,             // stop loss di -20%
  trailingStopPct: 15,         // trailing stop (aktif setelah TP pertama)
  maxHoldMinutes: 60,          // force close kalau >60 menit

  // ── AI MODEL ─────────────────────────────────────────────────────────
  model: "MiniMax-M2.7",    // model untuk analisis mendalam
  fastModel: "MiniMax-M2.7", // model cepat untuk filter awal

  // ── LESSONS ──────────────────────────────────────────────────────────
  lessonsFile: "./lessons.json",
  maxLessonsInContext: 10,      // berapa lesson yang dimasukkan ke context AI
};

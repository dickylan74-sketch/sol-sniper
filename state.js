// state.js — shared mutable state + persistence ke disk
import fs from "fs";

const STATE_FILE = "./state.json";

const defaultState = {
  positions: {},       // { mintAddress: { ...positionData } }
  trades: [],          // history semua trade
  totalPnlSOL: 0,
  totalPnlUSD: 0,
  wins: 0,
  losses: 0,
  scannedTokens: new Map(), // mint → timestamp kapan discreening
  startedAt: Date.now(),
};

function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
      // migrate dari format lama (array/Set) ke Map { mint: timestamp }
      const raw_st = raw.scannedTokens ?? [];
      if (Array.isArray(raw_st)) {
        raw.scannedTokens = new Map(raw_st.map(m =>
          Array.isArray(m) ? m : [m, Date.now()]
        ));
      } else {
        raw.scannedTokens = new Map();
      }
      return { ...defaultState, ...raw };
    }
  } catch (_) {}
  return { ...defaultState };
}

export const state = load();

export function saveState() {
  try {
    const toSave = {
      ...state,
      scannedTokens: [...state.scannedTokens.entries()],
    };
    fs.writeFileSync(STATE_FILE, JSON.stringify(toSave, null, 2));
  } catch (_) {}
}

export function addPosition(mint, data) {
  state.positions[mint] = { ...data, openedAt: Date.now() };
  saveState();
}

export function removePosition(mint) {
  delete state.positions[mint];
  saveState();
}

export function recordTrade(trade) {
  state.trades.unshift(trade);
  if (state.trades.length > 500) state.trades = state.trades.slice(0, 500);
  if (trade.pnlSOL !== undefined) {
    state.totalPnlSOL += trade.pnlSOL;
    state.totalPnlUSD += trade.pnlUSD ?? 0;
    trade.pnlSOL >= 0 ? state.wins++ : state.losses++;
  }
  saveState();
}

export function getWinRate() {
  const total = state.wins + state.losses;
  return total === 0 ? 0 : Math.round((state.wins / total) * 100);
}

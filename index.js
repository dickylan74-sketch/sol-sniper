// index.js — entry point: inisialisasi semua, jalankan agent loop + REPL
import "dotenv/config";
import readline from "readline";
import { log } from "./logger.js";
import { CONFIG } from "./config.js";
import { state } from "./state.js";
import { initTelegram, notify } from "./telegram.js";
import { scanNewTokens } from "./scanner.js";
import { runHunter, runHealer, runHealthCheck } from "./agent.js";
import { getWalletBalance } from "./trader.js";
import { getRecentLessons } from "./lessons.js";

const DRY_RUN = process.env.DRY_RUN !== "false";

// ── countdown timer display ───────────────────────────────────────────
let nextHuntSec  = CONFIG.scanIntervalMin * 60;
let nextHealSec  = CONFIG.monitorIntervalMin * 60;

function formatCountdown(secs) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}

function getPrompt() {
  return `[hunt: ${formatCountdown(nextHuntSec)} | heal: ${formatCountdown(nextHealSec)}] > `;
}

// ── REPL ─────────────────────────────────────────────────────────────
function startREPL() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  const prompt = () => {
    rl.question(getPrompt(), async (input) => {
      const cmd = input.trim();

      if (!cmd) { prompt(); return; }

      if (cmd === "/stop" || cmd === "exit" || cmd === "quit") {
        log.warn("Shutdown...");
        await notify("🔴 Bot dihentikan manual");
        process.exit(0);
      }

      if (cmd === "/status") {
        const { totalPnlSOL, wins, losses, positions } = state;
        const total = wins + losses;
        log.sep();
        log.info(`PnL: ${totalPnlSOL.toFixed(4)} SOL | Win: ${total ? Math.round(wins/total*100) : 0}% (${wins}W/${losses}L)`);
        log.info(`Posisi terbuka: ${Object.keys(positions).length}/${CONFIG.maxOpenPositions}`);
        log.sep();
      } else if (cmd === "/hunt") {
        log.info("Manual hunt...");
        const tokens = await scanNewTokens();
        await runHunter(tokens);
        nextHuntSec = CONFIG.scanIntervalMin * 60;
      } else if (cmd === "/heal") {
        log.info("Manual heal...");
        await runHealer();
        nextHealSec = CONFIG.monitorIntervalMin * 60;
      } else if (cmd === "/health") {
        await runHealthCheck();
      } else if (cmd === "/lessons") {
        const lessons = getRecentLessons(5);
        log.sep();
        if (!lessons.length) { log.info("Belum ada lesson"); }
        lessons.forEach((l, i) => {
          log.lesson(`${i+1}. [${l.result}] ${l.token}: ${l.lesson}`);
        });
        log.sep();
      } else if (cmd === "/config") {
        log.sep();
        Object.entries(CONFIG).forEach(([k, v]) => log.info(`${k}: ${v}`));
        log.sep();
      } else if (cmd.startsWith("/set ")) {
        const parts = cmd.replace("/set ", "").split(" ");
        if (parts.length === 2 && parts[0] in CONFIG) {
          const [key, val] = parts;
          CONFIG[key] = isNaN(val) ? val : parseFloat(val);
          log.success(`Config: ${key} = ${CONFIG[key]}`);
        } else {
          log.warn("Format: /set key value");
        }
      } else if (cmd === "/help") {
        log.sep();
        console.log(`
  /hunt        — scan & beli token baru sekarang
  /heal        — evaluasi & manage posisi terbuka  
  /health      — kirim health report ke Telegram
  /status      — status singkat di console
  /lessons     — tampilkan lesson terbaru
  /config      — lihat semua config
  /set k v     — ubah config (contoh: /set tradeAmountSOL 0.1)
  /stop        — shutdown bot
        `);
        log.sep();
      } else {
        log.warn(`Perintah tidak dikenal. Ketik /help`);
      }

      prompt();
    });
  };

  prompt();
}

// ── main agent loops ──────────────────────────────────────────────────
async function runHuntLoop() {
  while (true) {
    try {
      const tokens = await scanNewTokens();
      await runHunter(tokens);
    } catch (e) {
      log.error("Hunt loop error:", e.message);
    }
    // countdown
    nextHuntSec = CONFIG.scanIntervalMin * 60;
    await new Promise(resolve => {
      const id = setInterval(() => {
        nextHuntSec--;
        if (nextHuntSec <= 0) { clearInterval(id); resolve(); }
      }, 1000);
    });
  }
}

async function runHealLoop() {
  // offset 30 detik dari hunt supaya tidak bersamaan
  await new Promise(r => setTimeout(r, 30000));
  while (true) {
    try {
      await runHealer();
    } catch (e) {
      log.error("Heal loop error:", e.message);
    }
    nextHealSec = CONFIG.monitorIntervalMin * 60;
    await new Promise(resolve => {
      const id = setInterval(() => {
        nextHealSec--;
        if (nextHealSec <= 0) { clearInterval(id); resolve(); }
      }, 1000);
    });
  }
}

async function runHealthLoop() {
  while (true) {
    await new Promise(r => setTimeout(r, CONFIG.healthCheckIntervalMin * 60 * 1000));
    try { await runHealthCheck(); } catch (e) { log.error("Health check error:", e.message); }
  }
}

// ── startup ───────────────────────────────────────────────────────────
async function main() {
  console.clear();
  console.log(`
  ╔═══════════════════════════════════════╗
  ║        SOL SNIPER BOT v1.0            ║
  ║  Pump.fun → Raydium/PumpSwap          ║
  ║  Powered by Claude AI + Telegram      ║
  ╚═══════════════════════════════════════╝
  `);

  log.info(`Mode: ${DRY_RUN ? "🧪 DRY RUN (tidak ada transaksi nyata)" : "🔴 LIVE TRADING"}`);

  // check env
  if (!process.env.MINIMAX_API_KEY) {
    log.error("MINIMAX_API_KEY tidak diset di .env — exit");
    process.exit(1);
  }

  // check wallet
  if (!DRY_RUN) {
    if (!process.env.WALLET_PRIVATE_KEY) {
      log.error("WALLET_PRIVATE_KEY tidak diset — exit");
      process.exit(1);
    }
    const bal = await getWalletBalance().catch(() => 0);
    log.info(`Wallet balance: ${bal.toFixed(4)} SOL`);
    if (bal < CONFIG.tradeAmountSOL * 2) {
      log.warn(`Balance rendah! Minimal rekomendasikan ${(CONFIG.tradeAmountSOL * 5).toFixed(2)} SOL`);
    }
  }

  log.info(`Scan interval: ${CONFIG.scanIntervalMin}m | Monitor: ${CONFIG.monitorIntervalMin}m`);
  log.info(`Trade size: ${CONFIG.tradeAmountSOL} SOL | Max posisi: ${CONFIG.maxOpenPositions}`);
  log.info(`TP: +${CONFIG.takeProfitPct}% | SL: -${CONFIG.stopLossPct}% | Max hold: ${CONFIG.maxHoldMinutes}m`);
  log.sep();

  // init Telegram
  initTelegram();

  // startup notif
  await notify(
    `🚀 *Sol Sniper Bot Dimulai*\n\n` +
    `Mode: ${DRY_RUN ? "🧪 DRY RUN" : "🔴 LIVE"}\n` +
    `Trade: ${CONFIG.tradeAmountSOL} SOL | TP: +${CONFIG.takeProfitPct}% | SL: -${CONFIG.stopLossPct}%\n` +
    `Scan setiap ${CONFIG.scanIntervalMin} menit`
  );

  // jalankan semua loop paralel
  runHuntLoop();
  runHealLoop();
  runHealthLoop();

  // REPL
  startREPL();
}

main().catch(e => {
  log.error("Fatal error:", e.message);
  process.exit(1);
});

// telegram.js — Telegram bot: notif + kontrol + free-chat via MiniMax M2.7
import TelegramBot from "node-telegram-bot-api";
import { log } from "./logger.js";
import { state, getWinRate } from "./state.js";
import { CONFIG } from "./config.js";
import { getRecentLessons } from "./lessons.js";
import { getWalletBalance, getCurrentPrice } from "./trader.js";
import { runHunter, runHealer, runHealthCheck } from "./agent.js";
import { callMiniMax } from "./minimax.js";

let bot = null;
let chatId = null;
const chatHistory = [];

export function initTelegram() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    log.warn("TELEGRAM_BOT_TOKEN tidak diset — Telegram dinonaktifkan");
    return;
  }

  bot = new TelegramBot(token, { polling: true });
  if (process.env.TELEGRAM_CHAT_ID) {
    chatId = parseInt(process.env.TELEGRAM_CHAT_ID);
    log.tg(`Chat ID dari .env: ${chatId}`);
  } else {
    log.tg("Telegram bot aktif, menunggu pesan pertama...");
  }

  bot.on("message", async (msg) => {
    if (!chatId) {
      chatId = msg.chat.id;
      log.tg(`Chat ID terdaftar: ${chatId}`);
      await bot.sendMessage(chatId,
        `👋 *Sol Sniper Bot Aktif!*\n\n` +
        `Mode: ${process.env.DRY_RUN !== "false" ? "🧪 DRY RUN" : "🔴 LIVE"}\n` +
        `AI: MiniMax M2.7\n\n` +
        `Ketik /help untuk daftar perintah.`,
        { parse_mode: "Markdown" }
      );
      return;
    }

    const text = msg.text?.trim() ?? "";
    if (!text) return;
    log.tg(`Pesan: ${text}`);

    try {
      if      (text === "/start" || text === "/help") await sendHelp();
      else if (text === "/status")      await sendStatus();
      else if (text === "/positions")   await sendPositions();
      else if (text === "/lessons")     await sendLessons();
      else if (text === "/trades")      await sendRecentTrades();
      else if (text === "/balance")     await sendBalance();
      else if (text === "/health")      await runHealthCheck();
      else if (text === "/hunt") {
        await safeReply("🔍 Hunt manual...");
        const { scanNewTokens } = await import("./scanner.js");
        const tokens = await scanNewTokens();
        await runHunter(tokens);
      }
      else if (text === "/heal") {
        await safeReply("🩺 Heal manual...");
        await runHealer();
      }
      else if (text === "/closeall")    await closeAllPositions("MANUAL_TELEGRAM");
      else if (text === "/config")      await sendConfig();
      else if (text.startsWith("/set ")) await handleSetConfig(text);
      else if (text.startsWith("/close ")) {
        const sym = text.replace("/close ", "").trim().toUpperCase();
        await closeBySymbol(sym);
      }
      else await handleFreeChat(text);
    } catch (e) {
      log.error("Telegram error:", e.message);
      await safeReply(`❌ Error: ${e.message}`);
    }
  });

  bot.on("polling_error", e => log.warn("Telegram polling error:", e.message));
}

export async function notify(message) {
  if (!bot || !chatId) return;
  try {
    await bot.sendMessage(chatId, message, {
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });
  } catch {
    try {
      await bot.sendMessage(chatId, message, { disable_web_page_preview: true });
    } catch (e) { log.warn("Telegram send gagal:", e.message); }
  }
}

async function safeReply(msg) {
  if (!bot || !chatId) return;
  try { await bot.sendMessage(chatId, msg, { parse_mode: "Markdown" }); }
  catch { try { await bot.sendMessage(chatId, msg); } catch (_) {} }
}

async function sendHelp() {
  await safeReply(
    `🤖 *Sol Sniper Bot — Commands*\n\n` +
    `📊 *Info*\n` +
    `/status — ringkasan bot & PnL\n` +
    `/positions — posisi terbuka\n` +
    `/balance — saldo wallet\n` +
    `/trades — 10 trade terakhir\n` +
    `/lessons — lesson AI terbaru\n` +
    `/health — health check lengkap\n\n` +
    `⚡ *Aksi*\n` +
    `/hunt — scan & beli manual\n` +
    `/heal — evaluasi posisi manual\n` +
    `/close SYMBOL — tutup posisi\n` +
    `/closeall — tutup semua posisi\n\n` +
    `⚙️ *Config*\n` +
    `/config — lihat konfigurasi\n` +
    `/set key value — ubah config\n\n` +
    `💬 Ketik bebas untuk tanya ke AI`
  );
}

async function sendStatus() {
  const { totalPnlSOL, wins, losses, positions } = state;
  const total = wins + losses;
  const uptime = Math.round((Date.now() - state.startedAt) / 60000);
  await safeReply(
    `📊 *Status Bot*\n\n` +
    `Mode: ${process.env.DRY_RUN !== "false" ? "🧪 DRY RUN" : "🔴 LIVE"}\n` +
    `AI: MiniMax M2.7\n` +
    `⏱ Uptime: ${uptime} menit\n\n` +
    `💰 Total PnL: ${totalPnlSOL >= 0 ? "+" : ""}${totalPnlSOL.toFixed(4)} SOL\n` +
    `🏆 Win rate: ${getWinRate()}% (${wins}W/${losses}L)\n` +
    `📈 Total trades: ${total}\n` +
    `🔓 Posisi: ${Object.keys(positions).length}/${CONFIG.maxOpenPositions}`
  );
}

async function sendPositions() {
  const positions = Object.values(state.positions);
  if (!positions.length) { await safeReply("📭 Tidak ada posisi terbuka"); return; }

  const lines = await Promise.all(positions.map(async p => {
    const price = await getCurrentPrice(p.mint).catch(() => p.entryPrice);
    const pnlPct = ((price - p.entryPrice) / p.entryPrice * 100).toFixed(1);
    const holdMin = Math.round((Date.now() - p.openedAt) / 60000);
    return `${pnlPct >= 0 ? "🟢" : "🔴"} *${p.symbol}*\n` +
      `   Entry: $${p.entryPrice.toFixed(8)} | Now: $${price.toFixed(8)}\n` +
      `   PnL: ${pnlPct >= 0 ? "+" : ""}${pnlPct}% | Hold: ${holdMin}m`;
  }));

  await safeReply(`🔓 *Posisi Terbuka (${positions.length})*\n\n${lines.join("\n\n")}`);
}

async function sendLessons() {
  const lessons = getRecentLessons(5);
  if (!lessons.length) { await safeReply("📚 Belum ada lesson"); return; }
  const lines = lessons.map((l, i) =>
    `${i + 1}. ${l.result === "PROFIT" ? "🟢" : "🔴"} *${l.token}* (${l.pnlPct >= 0 ? "+" : ""}${l.pnlPct}%)\n` +
    `   💡 ${l.lesson}\n` +
    `   🎯 ${l.nextTime}`
  );
  await safeReply(`💡 *5 Lesson Terakhir*\n\n${lines.join("\n\n")}`);
}

async function sendRecentTrades() {
  const sells = state.trades.filter(t => t.type === "SELL").slice(0, 10);
  if (!sells.length) { await safeReply("📋 Belum ada trade selesai"); return; }
  const lines = sells.map(t =>
    `${(t.pnlPct ?? 0) >= 0 ? "🟢" : "🔴"} *${t.symbol}* — ${t.pnlPct >= 0 ? "+" : ""}${t.pnlPct?.toFixed(1)}%\n` +
    `   ${t.holdMinutes}m | ${t.exitReason}`
  );
  await safeReply(`📋 *10 Trade Terakhir*\n\n${lines.join("\n\n")}`);
}

async function sendBalance() {
  try {
    const bal = await getWalletBalance();
    await safeReply(`💳 *Saldo Wallet*\n\n${bal.toFixed(4)} SOL`);
  } catch (e) { await safeReply(`❌ Gagal cek balance: ${e.message}`); }
}

async function sendConfig() {
  const entries = Object.entries(CONFIG)
    .filter(([k]) => !["model", "fastModel", "lessonsFile"].includes(k))
    .map(([k, v]) => `${k}: ${v}`);
  await safeReply(`⚙️ *Config*\n\`\`\`\n${entries.join("\n")}\n\`\`\``);
}

async function handleSetConfig(text) {
  const parts = text.replace("/set ", "").trim().split(" ");
  if (parts.length !== 2) { await safeReply("Format: /set key value"); return; }
  const [key, val] = parts;
  if (!(key in CONFIG)) { await safeReply(`❌ Key '${key}' tidak ada`); return; }
  const old = CONFIG[key];
  CONFIG[key] = isNaN(val) ? val : parseFloat(val);
  await safeReply(`✅ ${key}: ${old} → ${CONFIG[key]}`);
}

async function closeBySymbol(symbol) {
  const pos = Object.values(state.positions).find(p => p.symbol.toUpperCase() === symbol);
  if (!pos) { await safeReply(`❌ Posisi ${symbol} tidak ditemukan`); return; }
  await safeReply(`⏳ Menutup ${symbol}...`);
  await notify(`🔴 Manual close ${symbol}`);
}

async function closeAllPositions(reason) {
  const positions = Object.values(state.positions);
  if (!positions.length) { await safeReply("📭 Tidak ada posisi"); return; }
  await safeReply(`⏳ Menutup ${positions.length} posisi...`);
  for (const pos of positions) await notify(`🔴 ${reason}: ${pos.symbol}`);
}

async function handleFreeChat(userMsg) {
  const { totalPnlSOL, positions } = state;
  const system =
    `Kamu adalah asisten bot trading Solana bernama Sol Sniper, powered by MiniMax M2.7.\n` +
    `Data bot saat ini:\n` +
    `- Mode: ${process.env.DRY_RUN !== "false" ? "DRY RUN" : "LIVE"}\n` +
    `- PnL: ${totalPnlSOL.toFixed(4)} SOL\n` +
    `- Win rate: ${getWinRate()}%\n` +
    `- Posisi terbuka: ${Object.keys(positions).length}/${CONFIG.maxOpenPositions}\n` +
    `- Trade size: ${CONFIG.tradeAmountSOL} SOL | TP: +${CONFIG.takeProfitPct}% | SL: -${CONFIG.stopLossPct}%\n\n` +
    `Jawab dalam Bahasa Indonesia, singkat dan praktis. Kalau tanya posisi/trades, arahkan ke /positions atau /trades.`;

  chatHistory.push({ role: "user", content: userMsg });
  if (chatHistory.length > 20) chatHistory.splice(0, 2);

  try {
    await bot.sendChatAction(chatId, "typing");
    const res = await callMiniMax({ system, messages: chatHistory, max_tokens: 500 });
    const reply = res.content.find(b => b.type === "text")?.text ?? "Maaf, tidak bisa menjawab.";
    chatHistory.push({ role: "assistant", content: reply });
    await safeReply(reply);
  } catch (e) {
    await safeReply(`❌ AI error: ${e.message}`);
  }
}

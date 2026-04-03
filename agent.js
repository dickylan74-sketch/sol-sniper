// agent.js — ReAct AI agent: screen tokens + manage positions (MiniMax M2.7)
import { callMiniMax, parseJSON } from "./minimax.js";
import { CONFIG } from "./config.js";
import { log } from "./logger.js";
import { state, addPosition, removePosition, recordTrade } from "./state.js";
import { formatLessonsForPrompt, generateLesson } from "./lessons.js";
import { filterToken } from "./scanner.js";
import { executeBuy, executeSell, getCurrentPrice } from "./trader.js";
import { notify } from "./telegram.js";

// ── AGENT 1: Hunter — screening token baru ────────────────────────────
export async function runHunter(candidates) {
  if (!candidates.length) {
    log.scan("Tidak ada kandidat untuk dianalisis Hunter");
    return;
  }

  const openCount = Object.keys(state.positions).length;
  if (openCount >= CONFIG.maxOpenPositions) {
    log.warn(`Max posisi (${CONFIG.maxOpenPositions}) tercapai, skip hunting`);
    return;
  }

  log.ai(`Hunter menganalisis ${candidates.length} kandidat...`);

  const passed = candidates.filter(t => {
    const { pass, reasons } = filterToken(t);
    if (!pass) log.scan(`✗ ${t.symbol}: ${reasons[0]}`);
    return pass;
  });

  if (!passed.length) {
    log.scan("Semua kandidat gagal filter dasar");
    return;
  }

  log.ai(`${passed.length} lolos filter, kirim ke MiniMax M2.7...`);

  const lessons = formatLessonsForPrompt();
  const tokenList = passed.slice(0, 10).map((t, i) =>
    `${i + 1}. ${t.symbol} | Liq: $${t.liqUSD.toFixed(0)} | Vol1h: $${t.vol1hUSD.toFixed(0)} | ` +
    `Organic: ${t.organicScore}/100 | Age: ${t.ageMin.toFixed(1)}m | ` +
    `Harga: $${t.priceUSD.toFixed(8)} | Change1h: ${t.priceChange1h > 0 ? "+" : ""}${t.priceChange1h.toFixed(1)}% | ` +
    `FDV: $${(t.fdv / 1000).toFixed(0)}k | DEX: ${t.dex}`
  ).join("\n");

  const prompt = `Kamu adalah AI hunter untuk new token sniper di Solana.
Budget per trade: ${CONFIG.tradeAmountSOL} SOL
Posisi terbuka: ${openCount}/${CONFIG.maxOpenPositions}
Slot tersisa: ${CONFIG.maxOpenPositions - openCount}

KANDIDAT TOKEN BARU (sudah graduate dari pump.fun):
${tokenList}

LESSON DARI TRADE SEBELUMNYA:
${lessons}

Analisis setiap token, pilih maksimal ${Math.min(2, CONFIG.maxOpenPositions - openCount)} terbaik.
Kalau tidak ada yang layak, jangan beli.

Faktor penilaian:
- Organic score tinggi = lebih aman (bukan bot activity)
- Volume/likuiditas 1-10x = sehat
- Age < 15 menit = early entry lebih bagus
- FDV terlalu besar = susah naik signifikan
- Pricechange1h negatif tapi organic tinggi bisa berarti dip to buy

Balas HANYA JSON valid tanpa markdown:
{
  "decisions": [
    {
      "index": <nomor 1-${passed.slice(0, 10).length}>,
      "action": "BUY" | "SKIP",
      "confidence": <0-100>,
      "signal": "<alasan singkat kenapa beli>",
      "riskNote": "<risiko utama>",
      "targetPctGain": <target profit pct>,
      "stopLossPct": <stop loss pct>
    }
  ],
  "summary": "<1-2 kalimat overview kondisi saat ini>"
}`;

  try {
    const res = await callMiniMax({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1000,
    });

    const text = res.content.find(b => b.type === "text")?.text ?? "{}";
    const ai = parseJSON(text);

    log.ai(`Hunter summary: ${ai.summary}`);
    await notify(`🔍 *Hunter Report*\n${ai.summary}`);

    for (const dec of ai.decisions ?? []) {
      if (dec.action !== "BUY") continue;
      const token = passed[dec.index - 1];
      if (!token) continue;
      log.trade(`BUY signal: ${token.symbol} (confidence ${dec.confidence}%) — ${dec.signal}`);
      await executeBuyOrder(token, dec);
    }
  } catch (e) {
    log.error("Hunter AI error:", e.message);
  }
}

// ── AGENT 2: Healer — monitor & manage posisi terbuka ─────────────────
export async function runHealer() {
  const positions = Object.values(state.positions);
  if (!positions.length) {
    log.info("Tidak ada posisi terbuka untuk dimonitor");
    return;
  }

  log.ai(`Healer memonitor ${positions.length} posisi...`);

  const updated = await Promise.all(
    positions.map(async pos => {
      try {
        const currentPrice = await getCurrentPrice(pos.mint);
        const pnlPct = ((currentPrice - pos.entryPrice) / pos.entryPrice) * 100;
        const holdMin = (Date.now() - pos.openedAt) / 60000;
        return { ...pos, currentPrice, pnlPct, holdMin };
      } catch {
        return { ...pos, currentPrice: pos.entryPrice, pnlPct: 0, holdMin: 0 };
      }
    })
  );

  const toAI = [];
  for (const pos of updated) {
    if (pos.holdMin >= CONFIG.maxHoldMinutes) {
      log.warn(`Force close ${pos.symbol}: max hold ${CONFIG.maxHoldMinutes}m`);
      await executeSellOrder(pos, "MAX_HOLD_TIME"); continue;
    }
    if (pos.pnlPct <= -CONFIG.stopLossPct) {
      log.warn(`Stop loss ${pos.symbol}: ${pos.pnlPct.toFixed(1)}%`);
      await executeSellOrder(pos, "STOP_LOSS"); continue;
    }
    if (pos.pnlPct >= CONFIG.takeProfitPct) {
      log.success(`Take profit ${pos.symbol}: +${pos.pnlPct.toFixed(1)}%`);
      await executeSellOrder(pos, "TAKE_PROFIT"); continue;
    }
    toAI.push(pos);
  }

  if (!toAI.length) return;

  const positionList = toAI.map((p, i) =>
    `${i + 1}. ${p.symbol} | Entry: $${p.entryPrice.toFixed(8)} | Now: $${p.currentPrice.toFixed(8)} | ` +
    `PnL: ${p.pnlPct > 0 ? "+" : ""}${p.pnlPct.toFixed(1)}% | Hold: ${p.holdMin.toFixed(0)}m`
  ).join("\n");

  const prompt = `Kamu adalah AI healer untuk posisi terbuka di Solana sniper bot.

POSISI TERBUKA:
${positionList}

CONFIG:
- Take profit: +${CONFIG.takeProfitPct}%
- Stop loss: -${CONFIG.stopLossPct}%
- Max hold: ${CONFIG.maxHoldMinutes} menit

LESSON SEBELUMNYA:
${formatLessonsForPrompt()}

Evaluasi setiap posisi, HOLD atau SELL?

Balas HANYA JSON valid tanpa markdown:
{
  "decisions": [
    {
      "index": <1-${toAI.length}>,
      "action": "HOLD" | "SELL",
      "reason": "<alasan singkat>",
      "urgency": "low" | "medium" | "high"
    }
  ]
}`;

  try {
    const res = await callMiniMax({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
    });

    const text = res.content.find(b => b.type === "text")?.text ?? "{}";
    const ai = parseJSON(text);

    for (const dec of ai.decisions ?? []) {
      if (dec.action !== "SELL") continue;
      const pos = toAI[dec.index - 1];
      if (!pos) continue;
      log.trade(`AI Healer SELL ${pos.symbol}: ${dec.reason}`);
      await executeSellOrder(pos, `AI_HEALER: ${dec.reason}`);
    }
  } catch (e) {
    log.error("Healer AI error:", e.message);
  }
}

// ── execute buy ───────────────────────────────────────────────────────
async function executeBuyOrder(token, aiDecision) {
  const dryRun = process.env.DRY_RUN !== "false";
  try {
    const result = await executeBuy({
      mint: token.mint, symbol: token.symbol,
      amountSOL: CONFIG.tradeAmountSOL,
      slippageBps: CONFIG.slippageBps, dryRun,
    });

    const position = {
      mint: token.mint, symbol: token.symbol,
      pairAddress: token.pairAddress, dex: token.dex,
      entryPrice: token.priceUSD, entrySOL: CONFIG.tradeAmountSOL,
      tokensReceived: result.tokensReceived, txHash: result.txHash,
      aiSignal: aiDecision.signal, aiConfidence: aiDecision.confidence,
      targetPct: aiDecision.targetPctGain ?? CONFIG.takeProfitPct,
      stopPct: aiDecision.stopLossPct ?? CONFIG.stopLossPct,
      liquidityUSD: token.liqUSD, volumeUSD: token.vol1hUSD,
      holders: token.holders, organicScore: token.organicScore,
      graduated: token.graduated, tokenUrl: token.url, dryRun,
    };

    addPosition(token.mint, position);
    recordTrade({ ...position, type: "BUY", timestamp: new Date().toISOString() });

    const msg =
      `${dryRun ? "🧪 DRY RUN " : ""}🟢 *BUY: ${token.symbol}*\n` +
      `💰 ${CONFIG.tradeAmountSOL} SOL @ $${token.priceUSD.toFixed(8)}\n` +
      `📊 Liq: $${token.liqUSD.toFixed(0)} | Vol1h: $${token.vol1hUSD.toFixed(0)}\n` +
      `🤖 Signal: ${aiDecision.signal}\n` +
      `🎯 Target: +${aiDecision.targetPctGain ?? CONFIG.takeProfitPct}% | SL: -${aiDecision.stopLossPct ?? CONFIG.stopLossPct}%\n` +
      (result.txHash ? `🔗 [Tx](https://solscan.io/tx/${result.txHash})` : "");

    await notify(msg);
    log.trade(`BUY ${token.symbol} ${dryRun ? "(DRY RUN)" : ""}`);
  } catch (e) {
    log.error(`Gagal buy ${token.symbol}:`, e.message);
    await notify(`❌ Gagal BUY ${token.symbol}: ${e.message}`);
  }
}

// ── execute sell + lesson ─────────────────────────────────────────────
async function executeSellOrder(position, exitReason) {
  const dryRun = process.env.DRY_RUN !== "false";
  try {
    const result = await executeSell({
      mint: position.mint, symbol: position.symbol,
      tokensAmount: position.tokensReceived,
      slippageBps: CONFIG.slippageBps, dryRun,
    });

    const exitPrice = result.priceUSD ?? position.currentPrice;
    const pnlSOL = result.solReceived - position.entrySOL;
    const pnlPct = ((exitPrice - position.entryPrice) / position.entryPrice) * 100;
    const holdMinutes = Math.round((Date.now() - position.openedAt) / 60000);

    const tradeRecord = {
      ...position, type: "SELL", exitPrice, exitReason,
      pnlSOL, pnlUSD: pnlSOL * (exitPrice / position.entryPrice),
      pnlPct, holdMinutes, txHash: result.txHash,
      timestamp: new Date().toISOString(),
    };

    removePosition(position.mint);
    recordTrade(tradeRecord);

    const pnlEmoji = pnlSOL >= 0 ? "🟢" : "🔴";
    const msg =
      `${dryRun ? "🧪 DRY RUN " : ""}${pnlEmoji} *SELL: ${position.symbol}*\n` +
      `💰 PnL: ${pnlSOL >= 0 ? "+" : ""}${pnlSOL.toFixed(4)} SOL (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)\n` +
      `⏱ Hold: ${holdMinutes} menit | 📌 ${exitReason}\n` +
      (result.txHash ? `🔗 [Tx](https://solscan.io/tx/${result.txHash})\n` : "") +
      `\n_Generating lesson..._`;

    await notify(msg);
    log.trade(`SELL ${position.symbol} | PnL ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}% | ${exitReason}`);

    // generate lesson di background
    generateLesson(tradeRecord).then(async lesson => {
      if (!lesson) return;
      const lessonMsg =
        `💡 *Lesson: ${position.symbol}*\n\n` +
        `📝 ${lesson.analysis}\n\n` +
        `✅ *Lesson:* ${lesson.lesson}\n` +
        `🎯 *Next time:* ${lesson.nextTime}\n` +
        (lesson.redFlag ? `🚩 *Red flag:* ${lesson.redFlag}\n` : "") +
        `\nKategori: ${lesson.category} | Tags: ${(lesson.tags ?? []).join(", ")}`;
      await notify(lessonMsg);
    });
  } catch (e) {
    log.error(`Gagal sell ${position.symbol}:`, e.message);
    await notify(`❌ Gagal SELL ${position.symbol}: ${e.message}`);
  }
}

// ── health check ──────────────────────────────────────────────────────
export async function runHealthCheck() {
  const { totalPnlSOL, wins, losses, positions } = state;
  const total = wins + losses;
  const winRate = total ? Math.round((wins / total) * 100) : 0;
  const openPos = Object.values(positions);

  let posStr = "Tidak ada posisi terbuka";
  if (openPos.length) {
    posStr = openPos.map(p => {
      const pnlPct = p.currentPrice
        ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100).toFixed(1) : "?";
      return `• ${p.symbol}: ${pnlPct > 0 ? "+" : ""}${pnlPct}%`;
    }).join("\n");
  }

  const msg =
    `📊 *Health Check*\n\n` +
    `💰 Total PnL: ${totalPnlSOL >= 0 ? "+" : ""}${totalPnlSOL.toFixed(4)} SOL\n` +
    `🏆 Win rate: ${winRate}% (${wins}W/${losses}L)\n` +
    `📈 Total trades: ${total}\n\n` +
    `🔓 Posisi terbuka (${openPos.length}):\n${posStr}`;

  await notify(msg);
  log.info(`Health: PnL ${totalPnlSOL.toFixed(4)} SOL | Win ${winRate}% | Trades ${total}`);
}

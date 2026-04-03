// lessons.js — generate & simpan lesson dari setiap trade (MiniMax M2.7)
import fs from "fs";
import { callMiniMax, parseJSON } from "./minimax.js";
import { CONFIG } from "./config.js";
import { log } from "./logger.js";

function loadLessons() {
  try {
    if (fs.existsSync(CONFIG.lessonsFile))
      return JSON.parse(fs.readFileSync(CONFIG.lessonsFile, "utf8"));
  } catch (_) {}
  return [];
}

function saveLessons(lessons) {
  fs.writeFileSync(CONFIG.lessonsFile, JSON.stringify(lessons, null, 2));
}

export function getRecentLessons(n = CONFIG.maxLessonsInContext) {
  return loadLessons().slice(0, n);
}

export function formatLessonsForPrompt() {
  const lessons = getRecentLessons();
  if (!lessons.length) return "Belum ada lesson. Ini trade pertama.";
  return lessons
    .map((l, i) => `${i + 1}. [${l.result}] ${l.token} (${l.pnlPct > 0 ? "+" : ""}${l.pnlPct}%) — ${l.lesson}`)
    .join("\n");
}

export async function generateLesson(trade) {
  const {
    symbol, mint, entryPrice, exitPrice,
    pnlSOL, pnlPct, holdMinutes,
    liquidityUSD, volumeUSD, holders, organicScore,
    aiSignal, aiConfidence, exitReason, graduated,
  } = trade;

  const result = (pnlPct ?? pnlSOL) >= 0 ? "PROFIT" : "LOSS";
  log.ai(`Generating lesson untuk ${symbol} (${result} ${pnlPct?.toFixed(1)}%)...`);

  const prompt = `Kamu adalah trading coach profesional yang menganalisis trade token baru di Solana.

DETAIL TRADE:
- Token: ${symbol} (${mint?.slice(0, 8)}...)
- Entry: $${entryPrice?.toFixed(8)} | Exit: $${exitPrice?.toFixed(8)}
- PnL: ${pnlSOL >= 0 ? "+" : ""}${pnlSOL?.toFixed(4)} SOL (${pnlPct >= 0 ? "+" : ""}${pnlPct?.toFixed(1)}%)
- Hold time: ${holdMinutes} menit
- Exit reason: ${exitReason}

KONDISI MARKET SAAT ENTRY:
- Likuiditas: $${liquidityUSD?.toFixed(0)}
- Volume 1 jam: $${volumeUSD?.toFixed(0)}
- Holders: ${holders}
- Organic score: ${organicScore}/100
- Sudah graduate pump.fun: ${graduated ? "Ya" : "Tidak"}
- AI Signal: ${aiSignal} (confidence: ${aiConfidence}%)

LESSON SEBELUMNYA (jangan ulangi hal yang sama):
${formatLessonsForPrompt()}

Buat lesson dalam Bahasa Indonesia. Analisis MENDALAM — jangan generik.
Balas HANYA dengan JSON valid tanpa markdown:
{
  "analysis": "<3-4 kalimat spesifik: angka mana yang jadi sinyal utama, kenapa profit/loss, apa yang terjadi di market>",
  "lesson": "<1 kalimat rule spesifik dengan angka threshold yang bisa langsung diterapkan>",
  "nextTime": "<1 kalimat konkret: kondisi X → action Y>",
  "redFlag": "<warning sign spesifik dengan angka yang harusnya terdeteksi, atau null>",
  "entryScore": <0-100, seberapa bagus setup entry ini sebenarnya>,
  "exitScore": <0-100, seberapa optimal timing exit>,
  "tags": ["<tag1>", "<tag2>", "<tag3>"],
  "confidence": <0-100>,
  "category": "entry_timing" | "exit_timing" | "token_selection" | "risk_management" | "position_size"
}`;

  try {
    const res = await callMiniMax({
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1500,
    });

    const text = res.content.find(b => b.type === "text")?.text ?? "{}";
    const parsed = parseJSON(text);

    const lesson = {
      id: Date.now(),
      timestamp: new Date().toISOString(),
      token: symbol,
      mint: mint?.slice(0, 8),
      result,
      pnlPct: pnlPct?.toFixed(1),
      holdMinutes,
      exitReason,
      ...parsed,
    };

    const all = loadLessons();
    all.unshift(lesson);
    saveLessons(all.slice(0, 200));

    log.lesson(`Lesson disimpan: ${lesson.lesson}`);
    return lesson;
  } catch (e) {
    log.error("Gagal generate lesson:", e.message);
    return null;
  }
}

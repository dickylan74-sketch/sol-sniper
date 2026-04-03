# Sol Sniper Bot 🎯

Autonomous Solana new token sniper — scan coin baru dari **Pump.fun → Raydium/PumpSwap**, powered by **Claude AI** + **Telegram**.

Terinspirasi arsitektur [Meridian](https://github.com/yunus-0x/meridian).

---

## Apa yang dilakukan

- **Scan coin baru** — monitor token yang baru graduate dari Pump.fun ke Raydium/PumpSwap setiap N menit
- **Filter cerdas** — filter by likuiditas, volume, umur token, organic score (anti-bot)
- **AI Hunter** — Claude menganalisis kandidat dan memilih mana yang layak dibeli
- **AI Healer** — Claude memonitor posisi terbuka, decide HOLD atau SELL
- **Auto exit** — take profit, stop loss, trailing stop, max hold time
- **Lesson learned** — setiap trade selesai, AI generate lesson terstruktur dan simpan ke `lessons.json`
- **Telegram bot** — notif real-time + kontrol penuh via chat (termasuk free-form tanya ke AI)
- **REPL** — command line interaktif dengan countdown timer

---

## Arsitektur

```
index.js          — entry point, agent loop, REPL
├── scanner.js    — scan pump.fun graduates + DexScreener
├── agent.js      — Hunter (beli) + Healer (jual) AI agents
├── trader.js     — eksekusi swap via Jupiter API
├── lessons.js    — generate & simpan lesson per trade
├── telegram.js   — Telegram bot, notif, free-chat
├── state.js      — state in-memory + persist ke state.json
├── config.js     — semua parameter (bisa ubah live via /set)
└── logger.js     — colored console + file logging
```

**Agent loop:**
- 🔍 **Hunter** — setiap `scanIntervalMin` menit, scan & beli token baru
- 🩺 **Healer** — setiap `monitorIntervalMin` menit, manage posisi terbuka
- 📊 **Health Check** — setiap 30 menit, kirim laporan ke Telegram

---

## Requirements

- Node.js 18+
- Anthropic API key
- Solana wallet (base58 private key) — *optional untuk DRY RUN*
- Telegram bot token — *optional tapi sangat disarankan*
- RPC URL (Helius/QuickNode untuk production, mainnet default untuk dev)

---

## Setup

```bash
# 1. Clone / download
git clone ...
cd sol-sniper

# 2. Install dependencies
npm install

# 3. Wizard setup interaktif
npm run setup

# 4. Jalankan
npm run dev    # DRY RUN — aman, tidak ada transaksi nyata
npm start      # LIVE trading
```

---

## Konfigurasi (`config.js`)

| Parameter | Default | Keterangan |
|---|---|---|
| `scanIntervalMin` | 2 | Seberapa sering scan coin baru |
| `monitorIntervalMin` | 1 | Seberapa sering cek posisi |
| `tradeAmountSOL` | 0.1 | SOL per trade |
| `maxOpenPositions` | 5 | Max posisi bersamaan |
| `minLiquidityUSD` | 5000 | Min likuiditas pool |
| `maxAgeMinutes` | 30 | Max umur token sejak graduate |
| `minOrganicScore` | 60 | Min organic score (0-100) |
| `takeProfitPct` | 50 | Take profit % |
| `stopLossPct` | 20 | Stop loss % |
| `maxHoldMinutes` | 60 | Force close setelah X menit |

Bisa diubah live via Telegram: `/set tradeAmountSOL 0.05`

---

## Telegram Commands

| Command | Fungsi |
|---|---|
| `/status` | Ringkasan PnL, win rate, posisi |
| `/positions` | Posisi terbuka dengan PnL real-time |
| `/balance` | Saldo wallet |
| `/trades` | 10 trade terakhir |
| `/lessons` | 5 lesson AI terbaru |
| `/hunt` | Scan & beli manual |
| `/heal` | Evaluasi posisi manual |
| `/health` | Health report lengkap |
| `/close SYMBOL` | Tutup posisi tertentu |
| `/closeall` | Tutup semua posisi |
| `/config` | Lihat semua config |
| `/set key value` | Ubah config live |
| *(apa saja)* | Free-form chat ke Claude AI |

---

## Lesson Learned

Setiap kali posisi ditutup, Claude menganalisis trade dan menyimpan lesson ke `lessons.json`:

```json
{
  "token": "PEPE2",
  "result": "PROFIT",
  "pnlPct": "+47.3",
  "lesson": "Token dengan organic score >80 dan usia <10 menit konsisten outperform",
  "nextTime": "Prioritaskan entry di <10 menit setelah graduate",
  "redFlag": null,
  "category": "entry_timing",
  "tags": ["early-entry", "high-organic", "pump-graduate"]
}
```

Lesson ini dimasukkan ke context AI di cycle berikutnya — bot belajar dari setiap trade.

---

## ⚠️ Disclaimer

Software ini disediakan as-is tanpa garansi apapun. Trading token baru di Solana sangat berisiko tinggi — bisa rugi seluruh modal. Selalu mulai dengan `npm run dev` (DRY RUN) untuk verifikasi behavior. Jangan deploy modal yang tidak sanggup kamu rugikan. Ini bukan financial advice.

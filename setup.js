// setup.js — wizard interaktif untuk setup pertama kali
import readline from "readline";
import fs from "fs";

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
  console.log(`
╔═══════════════════════════════════════╗
║     SOL SNIPER — Setup Wizard         ║
╚═══════════════════════════════════════╝
`);

  console.log("Setup .env file:\n");

  const minimaxKey = await ask("1. MiniMax API Key: ");
  const walletKey    = await ask("2. Wallet Private Key (base58, tekan Enter skip untuk DRY RUN): ");
  const rpcUrl       = await ask("3. Solana RPC URL (Enter = mainnet default): ");
  const tgToken      = await ask("4. Telegram Bot Token (Enter = skip): ");
  const dryRun       = await ask("5. DRY RUN mode? (y/n, default y): ");

  const env = [
    `MINIMAX_API_KEY=${minimaxKey.trim()}`,
    walletKey.trim() ? `WALLET_PRIVATE_KEY=${walletKey.trim()}` : `# WALLET_PRIVATE_KEY=your_key_here`,
    `RPC_URL=${rpcUrl.trim() || "https://api.mainnet-beta.solana.com"}`,
    tgToken.trim() ? `TELEGRAM_BOT_TOKEN=${tgToken.trim()}` : `# TELEGRAM_BOT_TOKEN=your_token`,
    `DRY_RUN=${dryRun.trim().toLowerCase() === "n" ? "false" : "true"}`,
  ].join("\n");

  fs.writeFileSync(".env", env);
  console.log("\n✓ .env tersimpan!\n");

  // buat lessons.json kosong
  if (!fs.existsSync("lessons.json")) {
    fs.writeFileSync("lessons.json", "[]");
    console.log("✓ lessons.json dibuat");
  }

  // buat folder logs
  if (!fs.existsSync("logs")) {
    fs.mkdirSync("logs");
    console.log("✓ folder logs dibuat");
  }

  console.log(`
Setup selesai! Cara menjalankan:

  npm run dev     → DRY RUN (aman, tidak ada transaksi nyata)
  npm start       → LIVE (hati-hati!)

Telegram:
  1. Buka bot kamu di Telegram
  2. Kirim pesan apa saja untuk register
  3. Bot langsung aktif!

Commands di Telegram:
  /status   /positions   /lessons
  /hunt     /heal        /closeall
  /config   /help
`);

  rl.close();
}

main();

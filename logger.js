// logger.js
import fs from "fs";
import path from "path";

const LOG_DIR = "./logs";
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR);

const logFile = path.join(LOG_DIR, `sol-sniper-${new Date().toISOString().split("T")[0]}.log`);

const COLORS = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
  gray: "\x1b[90m",
  blue: "\x1b[34m",
};

function ts() {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}

function write(level, color, symbol, ...args) {
  const msg = args.join(" ");
  const line = `[${ts()}] ${symbol} ${msg}`;
  const colored = `${COLORS.gray}[${ts()}]${COLORS.reset} ${color}${symbol} ${msg}${COLORS.reset}`;
  console.log(colored);
  fs.appendFileSync(logFile, line + "\n");
}

export const log = {
  info:    (...a) => write("INFO",  COLORS.cyan,    "ℹ", ...a),
  success: (...a) => write("OK",    COLORS.green,   "✓", ...a),
  warn:    (...a) => write("WARN",  COLORS.yellow,  "⚠", ...a),
  error:   (...a) => write("ERROR", COLORS.red,     "✗", ...a),
  trade:   (...a) => write("TRADE", COLORS.magenta, "◈", ...a),
  ai:      (...a) => write("AI",    COLORS.blue,    "⟳", ...a),
  lesson:  (...a) => write("LEARN", COLORS.green,   "💡", ...a),
  tg:      (...a) => write("TG",    COLORS.yellow,  "✈", ...a),
  scan:    (...a) => write("SCAN",  COLORS.cyan,    "⊙", ...a),
  sep:     ()     => console.log(COLORS.gray + "─".repeat(60) + COLORS.reset),
};

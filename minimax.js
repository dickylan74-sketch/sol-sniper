// minimax.js — MiniMax M2.7 API client
// Drop-in wrapper dengan interface mirip Anthropic SDK
import fetch from "node-fetch";

const BASE_URL = "https://api.minimaxi.chat/v1/text/chatcompletion_v2";
const MODEL    = "MiniMax-M2.7";

export async function callMiniMax({ system, messages, max_tokens = 1000 }) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error("MINIMAX_API_KEY tidak diset di .env");

  // susun messages: kalau ada system prompt, masukkan sebagai role "system"
  const fullMessages = [];
  if (system) {
    fullMessages.push({ role: "system", content: system });
  }
  // convert format Anthropic → MiniMax (sama persis, sudah compatible)
  for (const m of messages) {
    fullMessages.push({ role: m.role, content: m.content });
  }

  const body = {
    model: MODEL,
    messages: fullMessages,
    max_tokens,
    temperature: 0.3,
    top_p: 0.9,
    response_format: { type: "json_object" },  // paksa output JSON valid, skip <think>
  };

  const res = await fetch(BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
    timeout: 30000,
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`MiniMax API error ${res.status}: ${err}`);
  }

  const data = await res.json();

  // normalize response ke format yang sama dengan Anthropic
  // MiniMax: data.choices[0].message.content
  const text = data.choices?.[0]?.message?.content ?? "";
  return {
    content: [{ type: "text", text }],
    model: MODEL,
    usage: data.usage,
  };
}

// helper: parse JSON dari response AI (handle markdown fence, trailing comma, teks di luar JSON)
export function parseJSON(text) {
  // 1. strip <think>...</think> reasoning block (MiniMax M2.7 chain-of-thought)
  let clean = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  // strip markdown fences
  clean = clean.replace(/```json\s*|```\s*/g, "").trim();

  // 2. coba parse langsung
  try { return JSON.parse(clean); } catch {}

  // 3. ekstrak blok JSON pertama yang valid
  const starts = ["{", "["];
  for (const ch of starts) {
    const idx = clean.indexOf(ch);
    if (idx === -1) continue;
    const end = ch === "{" ? clean.lastIndexOf("}") : clean.lastIndexOf("]");
    if (end === -1) continue;
    const candidate = clean.slice(idx, end + 1);
    try { return JSON.parse(candidate); } catch {}

    // 4. coba perbaiki common issues
    const fixed = candidate
      .replace(/,\s*([}\]])/g, "$1")          // trailing comma
      .replace(/\/\/[^\n]*/g, "")             // strip komentar //
      .replace(/[\r\n]+(?=[^"]*":)/g, " ");   // newline di dalam string value
    try { return JSON.parse(fixed); } catch {}

    // 5. ganti literal newline di dalam string values
    const fixedNl = candidate.replace(
      /"([^"\\]|\\.)*"/gs,
      m => m.replace(/\n/g, "\\n").replace(/\r/g, "\\r")
    ).replace(/,\s*([}\]])/g, "$1");
    try { return JSON.parse(fixedNl); } catch {}
  }

  throw new Error(`Gagal parse JSON dari response AI: ${clean.slice(0, 100)}`);
}

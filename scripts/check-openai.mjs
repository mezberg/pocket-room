// Checks the OpenAI key and what it can reach. Never prints the key.
// Run: npm run check:openai
const key = process.env.OPENAI_API_KEY;
if (!key) { console.log("✗ OPENAI_API_KEY is not set. Copy .env.example to .env and paste your key."); process.exit(1); }

const api = (path, init = {}) => fetch(`https://api.openai.com/v1${path}`, {
  ...init, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...init.headers },
});
const line = (ok, what, note = "") => console.log(`${ok ? "✓" : "✗"} ${what}${note ? `  ${note}` : ""}`);

const res = await api("/models");
if (!res.ok) { line(false, "key", `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`); process.exit(1); }
const ids = (await res.json()).data.map((m) => m.id).sort();
line(true, "key", `${ids.length} models visible`);

const groups = {
  "text / vision": (id) => /^(gpt|o\d)/.test(id) && !/(image|realtime|audio|tts|transcribe|search|embedding)/.test(id),
  image: (id) => /image/.test(id),
  realtime: (id) => /realtime/.test(id),
  decisions: (id) => /luna|decision/.test(id),
};
for (const [g, f] of Object.entries(groups)) {
  const list = ids.filter(f);
  console.log(`  ${g}: ${list.length ? list.slice(-8).join(", ") : "none"}`);
}

const want = {
  OPENAI_MODEL_TEXT: process.env.OPENAI_MODEL_TEXT,
  OPENAI_MODEL_DECISIONS: process.env.OPENAI_MODEL_DECISIONS,
  OPENAI_MODEL_IMAGE: process.env.OPENAI_MODEL_IMAGE,
  OPENAI_MODEL_REALTIME: process.env.OPENAI_MODEL_REALTIME,
};
for (const [k, v] of Object.entries(want)) {
  if (!v) line(false, k, "not set in .env (pick one from the list above)");
  else line(ids.includes(v), `${k}=${v}`, ids.includes(v) ? "" : "not visible to this key");
}

if (want.OPENAI_MODEL_TEXT) {
  const r = await api("/responses", { method: "POST", body: JSON.stringify({ model: want.OPENAI_MODEL_TEXT, input: "Reply with: ok" }) });
  line(r.ok, "Responses API", r.ok ? "" : `HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

// The Decisions API is new; this only checks the endpoint exists. 404 = not available to this key.
const d = await api("/decisions", { method: "POST", body: JSON.stringify({ model: want.OPENAI_MODEL_DECISIONS ?? "gpt-6-luna" }) });
const body = (await d.text()).slice(0, 200);
line(d.status !== 404, "Decisions API endpoint", `HTTP ${d.status}${d.status === 404 ? " (not found)" : ""}: ${body}`);

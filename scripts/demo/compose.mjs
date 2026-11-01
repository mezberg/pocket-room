// Cuts a recording from record.mjs into the demo video: real frames at their real pace, live waits on
// the models sped up (with their real length on screen), captions at the bottom, the Photo view render
// shown full size, an end card.   node scripts/demo/compose.mjs <recDir> <out.mp4> [stillsPrefix]
import { chromium } from "playwright-core";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";

const rec = resolve(process.argv[2]);
const outFile = resolve(process.argv[3]);
const stillsPrefix = process.argv[4] ? resolve(process.argv[4]) : null;
const tl = JSON.parse(readFileSync(join(rec, "timeline.json"), "utf8"));
const work = join(rec, "cut");
mkdirSync(work, { recursive: true });
const W = tl.viewport.width * tl.dpr, H = tl.viewport.height * tl.dpr;
const phone = tl.mode === "phone";
const FPS = 30;

// ---- frame times on the same clock as the events (screencast timestamps + their median delivery lag)
const lags = tl.frames.map((f) => f.rx - f.t).sort((a, b) => a - b);
const lag = lags[lags.length >> 1];
const frames = tl.frames.map((f) => ({ ...f, at: f.t + lag }));
const ev = (type, from = 0) => tl.events.find((e, i) => i >= from && e.type === type);
const tStart = ev("start").t;
const tEnd = (ev("end") ?? tl.events.at(-1)).t;

// ---- live waits: sped up when long; short ones play as they are
const waits = [];
tl.events.forEach((e, i) => {
  if (e.type !== "wait-start") return;
  const end = tl.events.slice(i).find((x) => x.type === "wait-end" && x.label === e.label);
  const dur = end.t - e.t;
  const speed = dur < 5 ? 1 : Math.max(8, Math.round(dur / 4.5));
  waits.push({ from: e.t, to: end.t, dur, speed, label: e.label });
});
const speedAt = (t) => waits.find((w) => t >= w.from && t < w.to)?.speed ?? 1;
// wall time → output time
function outT(t) {
  let o = 0, cur = tStart;
  for (const w of waits) {
    if (w.to <= tStart || w.from >= t) continue;
    const a = Math.max(w.from, cur), b = Math.min(w.to, t);
    o += a - cur + (b - a) / w.speed;
    cur = b;
  }
  return o + (t - cur);
}

// ---- captions + "sped up" badges as intervals in output time
const capEvents = tl.events.filter((e) => e.type === "caption");
const cuts = new Set([tStart, tEnd, ...capEvents.map((e) => e.t), ...waits.flatMap((w) => [w.from, w.to])]);
const bounds = [...cuts].filter((t) => t >= tStart && t <= tEnd).sort((a, b) => a - b);
const overlays = [];
for (let i = 0; i < bounds.length - 1; i++) {
  const a = bounds[i], b = bounds[i + 1];
  if (b - a < 0.05) continue;
  const cap = [...capEvents].reverse().find((e) => e.t <= a + 1e-3)?.text ?? "";
  const w = waits.find((x) => a >= x.from - 1e-3 && b <= x.to + 1e-3 && x.speed > 1);
  const badge = w ? `${w.label}: ${Math.round(w.dur)} s live · sped up ${w.speed}×` : "";
  const prev = overlays.at(-1);
  if (prev && prev.cap === cap && prev.badge === badge) prev.to = outT(b);
  else overlays.push({ cap, badge, from: outT(a), to: outT(b) });
}
const mainLen = outT(tEnd);

// ---- the frame list for the concat demuxer
const list = [];
const inRange = frames.filter((f) => f.at >= tStart - 0.5 && f.at <= tEnd);
let firstIdx = inRange.findIndex((f) => f.at >= tStart);
if (firstIdx > 0) firstIdx--;   // the frame on screen at the start
const used = inRange.slice(Math.max(0, firstIdx));
let acc = 0;
used.forEach((f, i) => {
  const from = Math.max(f.at, tStart), to = i + 1 < used.length ? used[i + 1].at : tEnd;
  const d = outT(to) - outT(from);
  if (d <= 0) return;
  list.push(`file '${join(rec, "frames", f.name)}'\nduration ${d.toFixed(5)}`);
  acc += d;
});

// ---- the Photo view render full size, and the end card (rendered by Chrome, same size as the video)
const PHOTO_S = 4.5, END_S = 4;
const browser = await chromium.launch({ channel: "chrome", headless: true });
const pg = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
const font = `-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif`;
const k = phone ? 2 : 1;   // phone video is 2× pixels
async function shot(html, file, transparent = false) {
  await pg.setContent(`<!doctype html><html><body style="margin:0;width:${W}px;height:${H}px;overflow:hidden;font-family:${font};${transparent ? "background:transparent" : ""}">${html}</body></html>`);
  await pg.waitForTimeout(80);
  await pg.screenshot({ path: file, omitBackground: transparent, type: file.endsWith(".png") ? "png" : "jpeg", ...(file.endsWith(".jpg") ? { quality: 92 } : {}) });
}
const photoSrc = join(rec, "photo-view.img");
const hasPhoto = existsSync(photoSrc);
if (hasPhoto) {
  const buf = readFileSync(photoSrc);
  const [iw, ih] = buf[0] === 0x89 ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : jpegSize(buf);
  const f = Math.min((phone ? 0.94 : 0.8) * W / iw, (phone ? 0.7 : 0.8) * H / ih);
  const w = Math.round(iw * f), h = Math.round(ih * f), top = Math.round((H - h) / 2 - (phone ? 40 : 30) * k);
  await shot(`<div style="position:absolute;inset:0;background:#16130f"></div>
    <img src="data:image/${buf[0] === 0x89 ? "png" : "jpeg"};base64,${buf.toString("base64")}" style="position:absolute;left:${Math.round((W - w) / 2)}px;top:${top}px;width:${w}px;height:${h}px;border-radius:${8 * k}px;box-shadow:0 ${12 * k}px ${40 * k}px rgba(0,0,0,.5)">`, join(work, "photo.jpg"));
}
await shot(`<div style="width:100%;height:100%;background:#F1ECE4;color:#1d1a16;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:${18 * k}px;padding:0 ${24 * k}px;box-sizing:border-box">
  <svg viewBox="0 0 24 24" width="${(phone ? 64 : 72) * k}" height="${(phone ? 64 : 72) * k}"><path d="M3 10.5 12 4l9 6.5V20H3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><rect x="7.5" y="13" width="9" height="4" rx="1" fill="currentColor"/></svg>
  <div style="font-size:${(phone ? 34 : 64) * k}px;font-weight:700;letter-spacing:.06em">POCKET ROOM</div>
  <div style="font-size:${(phone ? 18 : 28) * k}px;color:#5c554c">your room in 3D</div>
  <div style="margin-top:${14 * k}px;font-size:${(phone ? 14 : 20) * k}px;color:#5c554c;max-width:${(phone ? 330 : 900) * k}px;line-height:1.45">built on OpenAI: vision, image → 3D, Decisions API, gpt-image</div>
</div>`, join(work, "end.jpg"));

// caption bars (white on dark, bottom), with a "sped up" badge above them during live waits
// (phone: at the top, under the header, so the sheet's text stays readable)
const capHtml = (cap, badge, bottom, top = null) => {
  const fs = (phone ? 15 : 22) * k, pad = (phone ? 12 : 16) * k;
  return `<div style="position:absolute;left:0;right:0;${top != null ? `top:${top}px` : `bottom:${bottom}px`};display:flex;flex-direction:column;align-items:center;gap:${8 * k}px;padding:0 ${16 * k}px">
    ${badge ? `<div style="background:#c8872a;color:#fff;font-size:${fs * 0.72}px;font-weight:600;padding:${4 * k}px ${12 * k}px;border-radius:${20 * k}px">⏩ ${badge}</div>` : ""}
    ${cap ? `<div style="background:rgba(20,18,15,.86);color:#fff;font-size:${fs}px;line-height:1.3;padding:${pad * 0.6}px ${pad}px;border-radius:${10 * k}px;max-width:${phone ? 90 : 70}%;text-align:center">${cap}</div>` : ""}
  </div>`;
};
const capFiles = [];
for (const [i, o] of overlays.entries()) {
  if (!o.cap && !o.badge) continue;
  const f = join(work, `cap-${i}.png`);
  await shot(capHtml(o.cap, o.badge, 28 * k, phone ? 64 * k : null), f, true);
  capFiles.push({ f, from: o.from, to: o.to });
}
if (hasPhoto) {
  const f = join(work, "cap-photo.png");
  await shot(capHtml("Photo view, full size: gpt-image's render of that exact view", "", (phone ? 60 : 28) * k), f, true);
  capFiles.push({ f, from: mainLen, to: mainLen + PHOTO_S });
  list.push(`file '${join(work, "photo.jpg")}'\nduration ${PHOTO_S}`);
}
await browser.close();
list.push(`file '${join(work, "end.jpg")}'\nduration ${END_S}`, `file '${join(work, "end.jpg")}'\nduration 0.04`);
writeFileSync(join(work, "list.txt"), "ffconcat version 1.0\n" + list.join("\n") + "\n");
const total = mainLen + (hasPhoto ? PHOTO_S : 0) + END_S;

// ---- encode
const inputs = ["-f", "concat", "-safe", "0", "-i", join(work, "list.txt")];
capFiles.forEach((c) => inputs.push("-i", c.f));
const chain = [`[0:v]fps=${FPS},scale=${W}:${H}:flags=lanczos,format=yuv420p,setsar=1[v0]`];
capFiles.forEach((c, i) => chain.push(`[v${i}][${i + 1}:v]overlay=0:0:enable='between(t,${c.from.toFixed(3)},${(c.to - 0.001).toFixed(3)})'[v${i + 1}]`));
chain.push(`[v${capFiles.length}]fade=t=in:st=0:d=0.4,fade=t=out:st=${(total - 0.5).toFixed(2)}:d=0.5,format=yuv420p[out]`);
mkdirSync(dirname(outFile), { recursive: true });
const crf = process.env.CRF ?? "22";
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", ...inputs, "-filter_complex", chain.join(";"), "-map", "[out]",
  "-c:v", "libx264", "-preset", "slow", "-crf", crf, "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-t", total.toFixed(2), outFile], { stdio: "inherit" });

console.log(`${outFile}: ${total.toFixed(1)} s (main ${mainLen.toFixed(1)} s), waits: ${waits.map((w) => `${w.label} ${w.dur.toFixed(1)} s ×${w.speed}`).join(", ")}`);

// ---- stills: the app's own frames at the end of each step
if (stillsPrefix) {
  const at = (t) => used.reduce((a, b) => (Math.abs(b.at - t) < Math.abs(a.at - t) ? b : a));
  const before = (prefix, d = 0.25) => { const e = capEvents.find((c) => c.text.startsWith(prefix)); return e ? e.t - d : null; };
  const picks = [
    ["room", before("Check my room")],
    ["findings", before("Add piece")],
    ["chesterfield", before("Find for me")],
    ["find", before("Tap one")],
    ["placed", before("Photo view")],
  ];
  for (const [name, t] of picks) if (t) copyFileSync(join(rec, "frames", at(t).name), `${stillsPrefix}-${name}.jpg`);
  if (hasPhoto) copyFileSync(join(work, "photo.jpg"), `${stillsPrefix}-photo-view.jpg`);
}

// width and height from a JPEG's SOF marker
function jpegSize(b) {
  for (let i = 2; i < b.length;) {
    const m = b[i + 1], len = b.readUInt16BE(i + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + len;
  }
  return [1024, 1024];
}

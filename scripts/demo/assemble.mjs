// The final cut: a slide with the problem, the desktop flow, then the phone scene (the IKEA aisle photo beside the phone recording,
// the camera's framing outlined), then two slides: the OpenAI APIs and what each does, and the board.
//   node scripts/demo/assemble.mjs <desktop.mp4> <phone.mp4> <out.mp4> [photos.mp4]
// desktop.mp4 and phone.mp4 come from compose.mjs with END=0 (no end card of their own).
import { chromium } from "playwright-core";
import { readFileSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const [desk, phone, out, photosClip] = process.argv.slice(2).map((p) => resolve(p));   // photosClip: optional, after the intro
const board = resolve("scripts/demo/board.jpg");           // Kate's screenshot of the Obsidian board, 940 × 1320
const aisle = resolve("scripts/demo/ikea-aisle.jpg");     // 1000 × 625, the photo taken in the aisle
const CROP = { x: 430, y: 160, w: 300, h: 380 };          // what the camera framed: ikea-side-table.jpg
const W = 1440, H = 900, INTRO_S = 6, API_S = 6, BOARD_S = 6;
const work = mkdtempSync(join(tmpdir(), "pr-assemble-"));
const dur = (f) => +execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", f]).toString();

// the phone scene's backdrop: the aisle photo with the framing outlined, and a phone frame
const ph = { h: 812 }; ph.w = Math.round((ph.h * 780) / 1688) & ~1; ph.x = 1000; ph.y = Math.round((H - ph.h) / 2);
const img = { w: 840 }; img.h = Math.round((img.w * 625) / 1000); img.x = 70; img.y = Math.round((H - img.h) / 2) - 10;
const k = img.w / 1000;
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-gpu"] });   // GPU raster splits tall boxes in screenshots
const pg = await b.newPage({ viewport: { width: W, height: H } });
await pg.setContent(`<!doctype html><body style="margin:0;width:${W}px;height:${H}px;background:#000;font-family:Arial,sans-serif;overflow:hidden">
  <div style="position:absolute;left:${img.x}px;top:${img.y}px;width:${img.w}px;height:${img.h}px;border-radius:10px;overflow:hidden">
  <img src="data:image/jpeg;base64,${readFileSync(aisle).toString("base64")}" style="display:block;width:100%;height:100%">
  <div style="position:absolute;left:${CROP.x * k - 3}px;top:${CROP.y * k - 3}px;width:${CROP.w * k}px;height:${CROP.h * k}px;border:3px solid #fff;border-radius:8px;box-shadow:0 0 0 2000px rgba(0,0,0,.4)"></div></div>
  <div style="position:absolute;left:${img.x}px;top:${img.y + img.h + 18}px;width:${img.w}px;color:#e9e3da;font-size:20px;text-align:center">In the IKEA aisle: the phone's camera framed on the side table</div>
  <div style="position:absolute;left:${ph.x - 9}px;top:${ph.y - 9}px;width:${ph.w + 18}px;height:${ph.h + 18}px;border-radius:30px;background:#000;box-shadow:0 0 0 1px #3a352e"></div>
</body>`);
await pg.screenshot({ path: join(work, "scene.png") });

// slide 1: the OpenAI pieces and what each one does in the app (models as set in .env on 1 Nov)
const API = [
  ["gpt-6-astra", "image → 3D", "a parts model of the piece from one shop photo, placed to scale"],
  ["Decisions API", "gpt-6-luna", "grades the room's issues and picks the fix to apply"],
  ["gpt-image", "gpt-image-2.5-flare", "turns your 3D view into a photoreal photo of your room"],
  ["Responses · vision", "gpt-6.1-terra", "reads the photo, tag or shop page: the piece, its size, its style"],
];
const font = "Arial,sans-serif";   // slides: Arial only, white on black, bullets
const BG = "#000", FG = "#fff", MUTED = "#9a9a9a", ACCENT = "#ff6a4d";
const bullets = (items, size, gap) => `<ul style="margin:0;padding:0 0 0 1.1em;font-size:${size}px;line-height:1.3">${items.map((t) => `<li style="margin-bottom:${gap}px">${t}</li>`).join("")}</ul>`;
await pg.setContent(`<!doctype html><body style="margin:0;width:${W}px;height:${H}px;background:${BG};color:${FG};font-family:${font};overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0 150px;box-sizing:border-box">
  <div style="font-size:22px;letter-spacing:.14em;color:${MUTED};font-weight:bold">POCKET ROOM · BUILT ON OPENAI</div>
  <div style="margin-top:40px">${bullets(API.map(([name, model, what]) => `<b>${name}</b> <span style="color:${MUTED};font-size:24px">(${model})</span><br><span style="font-size:30px;color:#d8d8d8">${what}</span>`), 38, 30)}</div>
</body>`);
await pg.screenshot({ path: join(work, "apis.jpg"), type: "jpeg", quality: 92 });

// slide 0, before the video: the problem
await pg.setContent(`<!doctype html><body style="margin:0;width:${W}px;height:${H}px;background:${BG};color:${FG};font-family:${font};overflow:hidden;display:flex;flex-direction:column;justify-content:center;padding:0 150px;box-sizing:border-box">
  <div style="font-size:22px;letter-spacing:.14em;color:${MUTED};font-weight:bold">THE PROBLEM</div>
  <div style="margin-top:34px;font-weight:bold">${bullets([
    "You walk into a furniture shop, a vintage market, your friend's place 🙂",
    "You like a piece of furniture",
    "No idea how it fits into the unfinished interior of your rented room",
  ], 44, 22)}</div>
  <div style="margin-top:40px;font-size:58px;font-weight:bold;color:${ACCENT}">Now you know…</div>
</body>`);
await pg.screenshot({ path: join(work, "intro.jpg"), type: "jpeg", quality: 92 });

// slide 2: the board, and how it was made (Kate's words, caption at twice the usual size)
const bh = 820, bw = Math.round((bh * 940) / 1320);
await pg.setContent(`<!doctype html><body style="margin:0;width:${W}px;height:${H}px;background:${BG};font-family:${font};overflow:hidden">
  <img src="data:image/jpeg;base64,${readFileSync(board).toString("base64")}" style="position:absolute;left:70px;top:${(H - bh) / 2}px;width:${bw}px;height:${bh}px;border-radius:10px">
  <div style="position:absolute;left:${70 + bw + 60}px;right:60px;top:0;bottom:0;display:flex;align-items:center;color:${FG};font-weight:bold">${bullets([
    "Codex helped me plan this on an Obsidian board",
    "Spun up subagents for parallel development and board status updates",
    "And obviously built &amp; tested it via computer use!!!",
  ], 44, 30)}</div>
</body>`);
await pg.screenshot({ path: join(work, "board.jpg"), type: "jpeg", quality: 92 });
await b.close();

const dDesk = dur(desk), dPhone = dur(phone);
const chain = [
  `[5:v]fps=30,scale=${W}:${H},fade=t=in:st=0:d=0.5,fade=t=out:st=${INTRO_S - 0.5}:d=0.5,format=yuv420p,setsar=1[i]`,
  `[0:v]fps=30,format=yuv420p,setsar=1[d]`,
  ...(photosClip ? [`[6:v]fps=30,format=yuv420p,setsar=1[r]`] : []),
  `[1:v]scale=${ph.w}:${ph.h}:flags=lanczos,fps=30[p]`,
  `[2:v]fps=30,format=yuv420p[bg]`,
  `[bg][p]overlay=${ph.x}:${ph.y}:shortest=1,fade=t=in:st=0:d=0.4,format=yuv420p,setsar=1[s]`,
  `[3:v]fps=30,scale=${W}:${H},fade=t=in:st=0:d=0.5,format=yuv420p,setsar=1[a]`,
  `[4:v]fps=30,scale=${W}:${H},fade=t=in:st=0:d=0.5,fade=t=out:st=${BOARD_S - 0.6}:d=0.6,format=yuv420p,setsar=1[b]`,
  photosClip ? `[i][r][d][s][a][b]concat=n=6:v=1:a=0[out]` : `[i][d][s][a][b]concat=n=5:v=1:a=0[out]`,
];
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error",
  "-i", desk, "-i", phone, "-loop", "1", "-t", dPhone.toFixed(2), "-i", join(work, "scene.png"), "-loop", "1", "-t", String(API_S), "-i", join(work, "apis.jpg"), "-loop", "1", "-t", String(BOARD_S), "-i", join(work, "board.jpg"), "-loop", "1", "-t", String(INTRO_S), "-i", join(work, "intro.jpg"), ...(photosClip ? ["-i", photosClip] : []),
  "-filter_complex", chain.join(";"), "-map", "[out]", "-c:v", "libx264", "-preset", "slow", "-crf", process.env.CRF ?? "22",
  "-profile:v", "high", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out], { stdio: "inherit" });
const dPhotos = photosClip ? dur(photosClip) : 0;
console.log(`${out}: ${(INTRO_S + dPhotos + dDesk + dPhone + API_S + BOARD_S).toFixed(1)} s (intro ${INTRO_S} + photos ${dPhotos.toFixed(1)} + desktop ${dDesk.toFixed(1)} + phone ${dPhone.toFixed(1)} + slides ${API_S} + ${BOARD_S})`);

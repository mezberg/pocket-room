// Pocket Room server: static app + /api. Each lane owns one file in routes/ (see contract/api.md).
import express from "express";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import rooms from "./routes/rooms.mjs";       // lane A
import pieces from "./routes/pieces.mjs";     // lane B
import agent from "./routes/agent.mjs";       // lane G
import place from "./routes/place.mjs";       // lanes D + E
import render from "./routes/render.mjs";     // lane F
import fixes from "./routes/fixes.mjs";       // tap an issue → fixes
import designer from "./routes/designer.mjs"; // the designer: advice (and plans for a piece)

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const app = express();
app.use(express.json({ limit: "25mb" }));     // images arrive as data URLs
// one line per API call: method, path, status, time (the run log)
app.use("/api", (req, res, next) => {
  const t0 = Date.now();
  res.on("finish", () => console.log(`[api] ${new Date().toISOString()} ${req.method} ${req.originalUrl.split("?")[0]} ${res.statusCode} ${Date.now() - t0} ms`));
  next();
});

app.use("/api/rooms", rooms);
app.use("/api/pieces", pieces);
app.use("/api/agent", agent);
app.use("/api", place);                       // /api/place, /api/analyse
app.use("/api/render", render);
app.use("/api/fixes", fixes);
app.use("/api", designer);                    // /api/plan, /api/advice

app.use("/room", express.static(join(root, "room")));
app.use("/contract", express.static(join(root, "contract")));
app.use(express.static(join(root, "app")));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT) || 8790;
app.listen(port, () => console.log(`Pocket Room on http://localhost:${port}`));

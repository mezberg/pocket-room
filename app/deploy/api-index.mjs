// Vercel function: the same route files as server/index.mjs, exported instead of listening.
import express from "express";
import rooms from "../server/routes/rooms.mjs";
import pieces from "../server/routes/pieces.mjs";
import agent from "../server/routes/agent.mjs";
import place from "../server/routes/place.mjs";
import render from "../server/routes/render.mjs";

const app = express();
app.use(express.json({ limit: "25mb" }));
app.use("/api/rooms", rooms);
app.use("/api/pieces", pieces);
app.use("/api/agent", agent);
app.use("/api", place);
app.use("/api/render", render);
app.use((err, req, res, next) => { console.error(err); res.status(500).json({ error: err.message }); });
export default app;

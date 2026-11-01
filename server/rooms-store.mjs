// One room store for every route: the prebuilt Hoskins Street rooms (lane A's export) and the rooms built
// from photos or plans this session. rooms.mjs serves it; place.mjs (lanes D + E) and agent.mjs (lane G)
// resolve a roomId through it. A `room` sent in a request body always wins (unsaved rooms).
import { readFileSync, readdirSync } from "node:fs";
import { room as livingFixture } from "./fixtures.mjs";
import * as samples from "../rules/sample-rooms.mjs";

const HOSKINS = new URL("../room/hoskins/rooms/", import.meta.url);
export const DEFAULT_ROOM = "hoskins-living";

let prebuiltCache = null;
function prebuilt() {
  if (prebuiltCache) return prebuiltCache;
  const out = { [DEFAULT_ROOM]: livingFixture() };
  let files = [];
  try { files = readdirSync(HOSKINS).filter((f) => f.endsWith(".room.json")); } catch {}
  for (const f of files) {
    const room = JSON.parse(readFileSync(new URL(f, HOSKINS)));
    out[room.id] ??= room;
  }
  return (prebuiltCache = out);
}

const built = new Map();   // rooms made from photos / plans this session

// A fresh copy, so a route can't change the stored room by accident.
const copy = (r) => (r ? structuredClone(r) : null);

export function getRoom(id) {
  if (!id) return null;
  return copy(built.get(id) ?? prebuilt()[id] ?? null);
}

export function saveRoom(room) {
  if (!room?.id) throw new Error("a room needs an id");
  built.set(room.id, structuredClone(room));
  return room;
}

export function listRooms() {
  const all = { ...prebuilt(), ...Object.fromEntries(built) };
  return Object.values(all).map(({ id, name, source }) => ({ id, name, source }));
}

/**
 * The room a request means: body.room (an unsaved room) → the store by body.roomId → lane D's sample
 * rooms (tiny / typical / crowded, for tests) → the default room when no id is given. An unknown id is null.
 */
export function resolveRoom({ room, roomId } = {}) {
  if (room && Array.isArray(room.walls)) return room;
  if (roomId) return getRoom(roomId) ?? samples[roomId]?.() ?? null;
  return getRoom(DEFAULT_ROOM);
}

// for tests
export function _reset() { built.clear(); prebuiltCache = null; }

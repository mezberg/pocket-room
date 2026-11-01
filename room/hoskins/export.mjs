// Writes the exact Hoskins Street export to the contract fixture and room/hoskins/*.room.json.
//   node room/hoskins/export.mjs
import { writeFileSync } from "node:fs";
import { livingRoom } from "./living.mjs";
import { checkRoom } from "../schema-check.mjs";

const out = (url, room) => {
  const errs = checkRoom(room);
  if (errs.length) throw new Error(`${room.id} breaks room.schema.json:\n  ${errs.join("\n  ")}`);
  writeFileSync(url, JSON.stringify(room, null, 2) + "\n");
  console.log("wrote", url.pathname.split("/").slice(-3).join("/"));
};

out(new URL("../../contract/fixtures/hoskins-living-room.room.json", import.meta.url), livingRoom());

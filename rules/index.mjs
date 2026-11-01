// Lane D · rules in code. Pure functions on room + piece JSON (contract/), no network.
export { place, verdictFor, WALK_OK, WALK_MIN } from "./place.mjs";
export { analyse } from "./check.mjs";
export { outline, footprint } from "./geom.mjs";
export { obstacles, buildGrid, routes, freeArea } from "./grid.mjs";

import { outline } from "./geom.mjs";
import { obstacles, buildGrid, freeArea as area } from "./grid.mjs";
// The free-floor grid of a room: clearance per cell (m, negative inside a piece), for drawing or reuse.
export function freeFloor(room) {
  const G = buildGrid(outline(room), obstacles(room));
  return { res: G.res, origin: [G.x0, G.y0], size: [G.nx, G.ny], clearance: G.clr, kind: G.kind, ...area(G) };
}

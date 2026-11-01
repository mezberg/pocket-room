// Living room (the plan's "Reception"), exported exactly from the 26 Sep build.
// Walls: inner faces of the build_ifc.py wall rectangles. Furniture: furniture.py positions, manifest boxes,
// facing read from how each piece is built (sofa back on the west wall, chairs face the table, ...).
import { X, Y, H, DOOR_H, GLZ_HEAD, GLZ_KERB } from "./plan.mjs";
import { walls, item, r3 } from "./build.mjs";

// Inner-face corners, CCW from above. py grows south. The glazing sits between two piers whose
// nibs (W_nib_w 107-129, W_nib_e 582-603, py 2761-2800) step the south corners in.
const CORNERS = [
  [129, 2800], // SW, inside the west nib
  [582, 2800], // SE, inside the east nib
  [582, 2761],
  [603, 2761],
  [603, 1885], // NE: kitchen wall (W_kit_south) face, behind the cupboard bank
  [288, 1885],
  [288, 1970], // partition (W_partition) end
  [258, 1970],
  [258, 1830], // hall wall (W_rec_door) face
  [107, 1830],
  [107, 2761], // west wall (W_west) face
  [129, 2761],
];
const IDS = [
  "south", "nib_e_side", "nib_e_end", "east", "north_cupboards", "partition_east", "partition_end",
  "partition_west", "north", "west", "nib_w_end", "nib_w_side",
];
const OPENINGS = {
  // Glazed screen: W panel (144-261) is the door, posts 261-277 and 432-447, fixed panels to 563.
  // Its swing is unknown (README: the plan's chevron sits on the middle panel, flagged ambiguous).
  south: [
    { id: "balcony_door", kind: "glazed_door", span: [144, 261], head: GLZ_HEAD, hingePx: null },
    { id: "glazing", kind: "window", span: [261, 563], sill: GLZ_KERB, head: GLZ_HEAD },
  ],
  // Reception door: span 130-235, hinge W (130), opens south into the room, shown open 85° (photo 22.11.59).
  north: [{ id: "hall_door", kind: "door", span: [130, 235], head: DOOR_H, hingePx: 130, into: true }],
};

// Dining chairs: furniture.py puts them 0.62 m from the table centre at 60/125/215/320°, back away
// from the table, so each faces the table: rot = angle - 90.
const dcx = X(398), dcy = Y(2098);
const chair = (n, deg) => item(`dining_chair_${n}`, `Dining chair ${n}`, "chair", (deg - 90 + 360) % 360, {
  size: [0.44, 0.455, 0.842],
  at: [dcx + 0.62 * Math.cos((deg * Math.PI) / 180), dcy + 0.62 * Math.sin((deg * Math.PI) / 180)],
});

export function livingRoom() {
  return {
    id: "hoskins-living",
    name: "Living room, Hoskins Street",
    source: "prebuilt",
    accuracy_m: 0.04,
    _note: "Exact export of the 26 Sep 2026 build (room/hoskins/export.mjs). Walls are inner faces; the plan's drawing tolerance is ~4 cm (6.74 x 3.44 drawn vs 6.70 x 3.40 printed).",
    height: H,
    glb: "/room/hoskins-flat.glb",
    walls: walls(CORNERS, IDS, OPENINGS),
    fixtures: [
      // heater_rec: px 107-118 x 2645-2760 on the west wall, z 0.15-0.60. Height given to its top.
      item("living_room_heater", "Living room heater", "radiator", 90, { size: [0.799, 0.076, 0.6], onFloor: false }),
      // Cupboard bank px 280-603 x 1885-1970, flush panels to the ceiling, doors face south. Clipped to the partition face (288).
      item("built-in_cupboards", "Built-in cupboards", "cupboard", 0, {
        size: [X(603) - X(288), Y(1885) - Y(1970), H], at: [(X(288) + X(603)) / 2, (Y(1885) + Y(1970)) / 2],
      }),
    ],
    furniture: [
      // Heights are the top of the piece itself (the manifest boxes include mugs, vases, a bottle on top).
      item("sofa", "Sofa", "sofa", 90),                       // back on the west wall, faces east
      item("ladder_bookshelf", "Ladder bookshelf", "shelf", 90), // leans on the west wall
      item("side_table", "Side table", "table", 90),
      item("floor_lamp", "Floor lamp", "lamp", 90),           // arc reaches east over the sofa end
      item("coffee_table", "Coffee table", "table", 270, { h: 0.45 }),     // long side to the sofa
      item("tv_bench", "TV bench", "tv", 270, { h: 0.44 }),                // on the east wall, faces west
      item("bamboo", "Bamboo", "plant", 270, { onFloor: false }),   // on the TV bench
      item("fern", "Fern", "plant", 270, { onFloor: false }),       // on the TV bench
      item("dining_table", "Dining table", "table", 0, { h: 0.747 }),
      chair(1, 60), chair(2, 125), chair(3, 215), chair(4, 320),
      item("clothes_airer", "Clothes airer", "other", 270),   // against the east wall
      item("desk", "Desk", "desk", 180, { h: 0.75 }),                      // in front of the glazing, you sit on its north side
      // Office chair: built facing north, then turned 195° about its centre -> faces 15° east of south (the desk).
      item("office_chair", "Office chair", "chair", 15, { size: [0.66, 0.66, 1.079], at: [X(440), Y(2640)] }),
      item("storage_box_and_cushion", "Storage box and cushion", "other", 180),
      item("leather_bag", "Leather bag", "other", 0),
      item("ficus", "Ficus", "plant", 0),
    ],
    lights: [
      { id: "dining_pendant", kind: "pendant", at: [r3(X(398)), r3(Y(2098))], h: 1.92 },
      { id: "living_pendant", kind: "pendant", at: [r3(X(350)), r3(Y(2470))], h: 1.92 },
      { id: "floor_lamp", kind: "floor_lamp", at: [r3(X(152) + 0.28), r3(Y(2590))], h: 1.35 },
      // architect lamps clamped to the desk: shade at (lx + 0.34, desk front + 0.21), 0.97 m up
      { id: "desk_lamp_1", kind: "table_lamp", at: [r3(X(365) + 0.25 + 0.34), r3(Y(2795) + 0.21)], h: 0.97 },
      { id: "desk_lamp_2", kind: "table_lamp", at: [r3(X(365) + 0.95 + 0.34), r3(Y(2795) + 0.21)], h: 0.97 },
    ],
    style: { tags: [], colors: [] },
  };
}

// The rest of the flat (bedroom, hall + lobby, kitchen, bathroom), from the same 26 Sep build.
// Wall corners are inner faces of the build_ifc.py rectangles; door spans, hinges and swings are build_ifc.py's door() calls.
// `into: false` = the door is in this room's wall but swings into the neighbouring room.
import { X, Y, H, DOOR_H, FRONT_DOOR_H, WIN_SILL, WIN_HEAD } from "./plan.mjs";
import { walls, item, pbox, r3 } from "./build.mjs";

const shell = (id, name, w, rest) => ({
  id, name, source: "prebuilt", accuracy_m: 0.04,
  _note: "Exact export of the 26 Sep 2026 build (room/hoskins/export.mjs).",
  height: H, glb: "/room/hoskins-flat.glb", walls: w, ...rest, style: { tags: [], colors: [] },
});
const ceiling = (id, px, py) => ({ id, kind: "ceiling", at: [r3(X(px)), r3(Y(py))], h: H - 0.12 });

export function bedroom() {
  // Wardrobe alcove behind the step wall (W_bed_step 288-302) runs down to W_bed_south (755).
  const w = walls(
    [[107, 755], [288, 755], [288, 690], [480, 690], [480, 59], [107, 59]],
    ["south", "alcove_east", "south_door", "east", "north", "west"],
    {
      // Bedroom door: span 363-465, hinge E (465), opens north into the bedroom, shown open (22.11.37)
      south_door: [{ id: "bedroom_door", kind: "door", span: [363, 465], head: DOOR_H, hingePx: 465, into: true }],
      north: [{ id: "bedroom_window", kind: "window", span: [137, 328], sill: WIN_SILL, head: WIN_HEAD }],
    },
  );
  return shell("hoskins-bedroom", "Bedroom, Hoskins Street", w, {
    fixtures: [
      item("bedroom_heater", "Bedroom heater", "radiator", 0, { size: [0.694, 0.09, 0.6], onFloor: false }),   // under the window, z 0.18-0.60
      item("open_wardrobe", "Open wardrobe", "cupboard", 180),     // rails in the alcove, open to the north
    ],
    furniture: [
      item("bed", "Bed", "bed", 90, { h: 0.89 }),                 // headboard on the west wall, foot to the east
      item("bedside_table_north", "Bedside table (north)", "table", 90, { h: 0.56 }),
      item("bedside_table_south", "Bedside table (south)", "table", 90, { h: 0.56 }),
      item("peace_lily", "Peace lily", "plant", 90, { onFloor: false }),
      item("chest_of_drawers", "Chest of drawers", "cupboard", 0, { h: 1.12 }),   // NE corner, drawers face south
      item("window_desk", "Window desk", "desk", 0, { h: 0.75 }),                 // under the window, you sit south of it
    ],
    lights: [{ id: "bedroom_pendant", kind: "pendant", at: [r3(X(293)), r3(Y(390))], h: 1.88 }],
  });
}

export function hall() {
  // Hall (x107-258) and entrance lobby (x302-480) as one space; the niche x258-278 sits in front of the hall cupboard.
  const w = walls(
    [[107, 1800], [258, 1800], [258, 1044], [278, 1044], [278, 918], [258, 918], [258, 905], [480, 905],
     [480, 714], [302, 714], [302, 785], [107, 785]],
    ["south", "partition", "niche_south", "cupboard_wall", "niche_north", "store_end", "lobby_south",
     "east", "lobby_north", "step", "north", "west"],
    {
      south: [{ id: "reception_door", kind: "door", span: [130, 235], head: DOOR_H, hingePx: 130, into: false }],
      partition: [
        { id: "kitchen_door", kind: "door", span: [1573, 1689], head: DOOR_H, hingePx: 1689, into: false },
        { id: "bathroom_door", kind: "door", span: [1095, 1205], head: DOOR_H, hingePx: 1205, into: true },   // opens out into the hall
      ],
      cupboard_wall: [{ id: "hall_cupboard_door", kind: "door", span: [940, 1020], head: DOOR_H, hingePx: 1020, into: true }],
      lobby_south: [{ id: "meter_cupboard_door", kind: "door", span: [390, 460], head: DOOR_H, hingePx: 460, into: true }],
      east: [{ id: "front_door", kind: "door", span: [765, 865], head: FRONT_DOOR_H, hingePx: 765, into: true }],
      lobby_north: [{ id: "bedroom_door", kind: "door", span: [363, 465], head: DOOR_H, hingePx: 465, into: false }],
    },
  );
  return shell("hoskins-hall", "Hall and lobby, Hoskins Street", w, {
    fixtures: [item("hall_heater", "Hall heater", "radiator", 90, { size: [0.764, 0.076, 0.6], onFloor: false })],
    furniture: [
      pbox("hall_cabinet", "Hall cabinet", "cupboard", 0, [110, 788, 178, 835], 0.92),   // walnut unit, doors face south
      pbox("storage_box", "Storage box", "other", 0, [190, 790, 250, 832], 0.36),
      pbox("doormat", "Doormat", "rug", 270, [418, 772, 478, 860], 0.012),
    ],
    lights: [ceiling("hall_light_1", 385, 830), ceiling("hall_light_2", 182, 1010), ceiling("hall_light_3", 182, 1400), ceiling("hall_light_4", 182, 1700)],
  });
}

export function kitchen() {
  const w = walls(
    [[288, 1855], [603, 1855], [603, 1407], [288, 1407]],
    ["south", "east", "north", "west"],
    // Kitchen door: span 1573-1689, hinge S (1689), opens into the kitchen, shown open (22.11.45)
    { west: [{ id: "kitchen_door", kind: "door", span: [1573, 1689], head: DOOR_H, hingePx: 1689, into: true }] },
  );
  return shell("hoskins-kitchen", "Kitchen, Hoskins Street", w, {
    fixtures: [
      // L-shaped run: north run (washer, sink, cabinets) under one worktop, east run with the hob and oven
      pbox("kitchen_run_north", "Kitchen units (north run)", "cupboard", 0, [288, 1407, 603, 1497], 0.91),
      pbox("kitchen_run_east", "Kitchen units (east run)", "cupboard", 270, [515, 1497, 603, 1745], 0.91),
      pbox("tall_unit", "Tall unit", "cupboard", 270, [519, 1745, 603, 1855], 2.12),
      pbox("wall_cabinets", "Wall cabinets", "cupboard", 270, [557, 1409, 603, 1745], 2.12, false),   // z 1.45-2.12
    ],
    furniture: [
      // freestanding, in the SW corner behind the door, facing north (22.11.45)
      pbox("fridge_freezer", "Fridge-freezer", "other", 180, [292, 1764, 376, 1855], 1.8),
    ],
    lights: [ceiling("kitchen_light", 445, 1630)],
  });
}

export function bathroom() {
  // The service riser (W_riser 555-603 x 1260-1377) is solid to the ceiling; the duct ledge in front of it is 1.05 high.
  const w = walls(
    [[288, 1377], [555, 1377], [555, 1260], [603, 1260], [603, 1059], [288, 1059]],
    ["south", "riser_west", "riser_north", "east", "north", "west"],
    // Bathroom door: span 1095-1205, hinge S (1205), opens out into the hall (22.11.53)
    { west: [{ id: "bathroom_door", kind: "door", span: [1095, 1205], head: DOOR_H, hingePx: 1205, into: false }] },
  );
  return shell("hoskins-bathroom", "Bathroom, Hoskins Street", w, {
    fixtures: [
      pbox("bath", "Bath", "other", 180, [290, 1266, 555, 1377], 0.56),          // along the south wall, panel faces north
      pbox("duct_ledge", "Duct ledge", "cupboard", 270, [565, 1059, 603, 1260], 1.05),
      item("wc", "WC", "other", 270),                                            // against the ledge, faces west
      item("basin", "Basin", "other", 270, { h: 0.86 }),
      item("towel_radiator", "Towel radiator", "radiator", 0, { size: [0.459, 0.028, 1.35], onFloor: false }),   // north wall, z 0.2-1.35
      item("mirror_cabinet", "Mirror cabinet", "cupboard", 270, { size: [1.278, 0.142, 1.86], onFloor: false }), // z 1.2-1.86
    ],
    furniture: [item("bath_mat", "Bath mat", "rug", 0)],
    lights: [ceiling("bathroom_light", 430, 1200)],
  });
}

export const flat = () => [bedroom(), hall(), kitchen(), bathroom()];

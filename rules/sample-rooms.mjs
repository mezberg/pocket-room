// Small hand-made rooms for the tests and demos: tiny (a box room), typical (a living room that works),
// crowded (a bedroom with every kind of problem). Walls counter-clockwise, metres.

const box = (W, D, openings = {}) => [
  { id: "south", a: [0, 0], b: [W, 0], openings: openings.south ?? [] },
  { id: "east", a: [W, 0], b: [W, D], openings: openings.east ?? [] },
  { id: "north", a: [W, D], b: [0, D], openings: openings.north ?? [] },
  { id: "west", a: [0, D], b: [0, 0], openings: openings.west ?? [] },
];
const item = (id, category, at, size, rot = 0, extra = {}) => ({ id, name: id.replace(/_/g, " "), category, at, size, rot, on_floor: true, ...extra });

export const tiny = () => ({
  id: "tiny", name: "Box room", height: 2.4,
  walls: box(1.6, 2.3, {
    south: [{ id: "door", kind: "door", from: 0.1, width: 0.75, swing: { hinge: "a", into: true } }],
    east: [{ id: "window", kind: "window", from: 0.8, width: 0.9, sill: 0.9, head: 2.1 }],
  }),
  fixtures: [], furniture: [],
});

export const typical = () => ({
  id: "typical", name: "Living room", height: 2.5,
  walls: box(4, 3.5, {
    south: [{ id: "door", kind: "door", from: 0.3, width: 0.85, swing: { hinge: "a", into: true } }],
    north: [{ id: "window", kind: "window", from: 1.0, width: 1.6, sill: 0.8, head: 2.2 }],
  }),
  fixtures: [item("radiator", "radiator", [2.2, 3.44], [1.2, 0.08, 0.6], 180, { on_floor: false })],
  furniture: [
    item("sofa", "sofa", [0.47, 1.9], [2.0, 0.9, 0.85], 90),
    item("coffee_table", "table", [1.45, 1.9], [1.0, 0.5, 0.45], 90),
    item("tv_bench", "tv", [3.78, 1.8], [1.4, 0.4, 0.5], 270),
    item("armchair", "armchair", [3.25, 2.95], [0.8, 0.8, 0.9], 270),
    item("rug", "rug", [1.8, 1.9], [2.0, 1.6, 0.01], 90),
  ],
});

// Bedroom, 3 × 3.2 m. The wardrobe sits in the door's swing, the bed squeezes the walkways, a bedside
// table overlaps the bed and a shelf pokes through the east wall.
export const crowded = () => ({
  id: "crowded", name: "Bedroom", height: 2.4,
  walls: box(3, 3.2, {
    south: [{ id: "door", kind: "door", from: 2.0, width: 0.8, swing: { hinge: "b", into: true } }],
    north: [{ id: "window", kind: "window", from: 0.9, width: 1.2, sill: 0.9, head: 2.1 }],
  }),
  fixtures: [],
  furniture: [
    item("bed", "bed", [0.9, 2.13], [1.6, 2.1, 1.0], 0),
    item("bedside_table", "table", [1.85, 2.95], [0.45, 0.4, 0.5], 0),
    item("wardrobe", "wardrobe", [2.68, 1.0], [1.0, 0.6, 2.0], 270),
    item("desk", "desk", [0.32, 0.75], [1.1, 0.6, 0.75], 90),
    item("desk_chair", "chair", [0.9, 0.75], [0.5, 0.5, 0.9], 270),
    item("shelf", "shelf", [2.95, 2.6], [0.8, 0.3, 1.2], 270),
  ],
});

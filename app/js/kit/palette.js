// Misplaced — the furniture palette and the Blender material map, shared by both 3D looks
// (real.js, the site's; drawn.js, the reference). Plain data, no three.js, so a page that
// only needs the colours doesn't load either renderer.
// Palette colours are furniture colours. Red/green stay reserved for the markers.

export const PALETTE = {
  linen:    { hex: "#E2D9C8", group: "Fabric", use: "Default sofa, bedding" },
  cream:    { hex: "#EEEAE1", group: "Fabric", use: "Pillows, duvets, shades" },
  stone:    { hex: "#B8B6B0", group: "Fabric", use: "Neutral upholstery, rugs" },
  slate:    { hex: "#66778A", group: "Fabric", use: "Cool accent" },
  clay:     { hex: "#B5714E", group: "Fabric", use: "Warm accent" },
  moss:     { hex: "#6B7556", group: "Fabric", use: "Green accent (greyer than the fix marker)" },
  charcoal: { hex: "#4B4B49", group: "Fabric", use: "Dark upholstery, tops" },
  oak:      { hex: "#C59C6E", group: "Wood",   use: "Default wood" },
  walnut:   { hex: "#7B5B42", group: "Wood",   use: "Dark wood" },
  black:    { hex: "#33332F", group: "Hard",   use: "Metal legs, frames, handles" },
  marble:   { hex: "#E8E6E1", group: "Hard",   use: "Stone tops" },
  concrete: { hex: "#A8A7A2", group: "Hard",   use: "Concrete, grey stone" },
  leaf:     { hex: "#66804F", group: "Plants", use: "Leaves" },
  leafDark: { hex: "#4F6A3F", group: "Plants", use: "Leaves, second tone" },
  pot:      { hex: "#DCD6CB", group: "Plants", use: "Ceramic pots" },
  floor:    { hex: "#D7D3CB", group: "Room",   use: "Floor" },
  wall:     { hex: "#F3F1EC", group: "Room",   use: "Walls" },
  cap:      { hex: "#FFFFFF", group: "Room",   use: "Cut wall tops, slab, skirting, frames" },
  glass:    { hex: "#CBD8DF", group: "Room",   use: "Glass" },
};

// Blender material name → palette name, for GLBs built before the kit existed.
export const GLB_MATERIALS = {
  sofa: "slate", sofa_cushion: "slate", armchair: "clay", chair: "clay", headboard: "moss",
  duvet: "linen", linen: "cream", throw: "slate", oak: "oak", wood_dark: "walnut", frame: "black",
  metal: "black", brass: "black", screen: "black", screen_face: "charcoal", canvas: "cream",
  art_a: "clay", art_b: "slate", book_a: "clay", book_b: "oak", shade: "cream", pot: "pot",
  leaf: "leaf", leaf_dark: "leafDark", floor_a: "floor", floor_b: "floor", slab: "cap",
  skirting: "cap", wall: "wall", wall_back: "wall", window: "cap", door: "cap", glass: "glass",
};

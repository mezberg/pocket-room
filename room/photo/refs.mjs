// Reference sizes the vision model may measure against. The model only says "the far wall is about
// 9 door widths"; the metres live here, in code.
export const REFS = {
  door_width: 0.82,            // UK internal door leaf + frame, 762-838 mm leaves
  door_height: 2.04,
  brick_course: 0.075,         // 65 mm brick + 10 mm mortar
  brick_length: 0.225,         // 215 mm brick + 10 mm joint
  concrete_block_course: 0.225,
  floor_tile: 0.6,
  ceiling_tile: 0.6,
  standing_adult_height: 1.7,
  seated_adult_head_height: 1.25,
  chair_width: 0.45,           // dining / folding chair seat
  chair_seat_height: 0.45,
  table_height: 0.74,
  folding_table_length: 1.83,  // 6 ft trestle
  desk_length: 1.4,
  sofa_seat_height: 0.45,
  three_seat_sofa_length: 2.0,
  two_seat_sofa_length: 1.5,
  armchair_width: 0.9,
  laptop_width: 0.32,
  pull_up_banner_width: 0.85,  // roller banner 850 x 2000 mm
  pull_up_banner_height: 2.0,
  radiator_height: 0.6,
  light_switch_height: 1.2,    // centre above floor
  socket_height: 0.45,
};
export const REF_KINDS = Object.keys(REFS);

// Default footprints [width, depth, height] by category. A length the model reads replaces the width.
// Columns run floor to ceiling (height null = the room height) and become fixtures.
export const DEFAULT_SIZE = {
  sofa: [2.0, 0.9, 0.8], armchair: [0.9, 0.85, 0.8], table: [1.2, 0.8, 0.74], chair: [0.45, 0.5, 0.85],
  desk: [1.4, 0.7, 0.74], bed: [1.5, 2.0, 0.5], rug: [2.0, 1.4, 0.01], shelf: [0.8, 0.35, 1.8],
  lamp: [0.4, 0.4, 1.6], plant: [0.5, 0.5, 1.2], radiator: [1.0, 0.1, 0.6], cupboard: [1.0, 0.6, 2.0],
  tv: [1.2, 0.4, 0.5], column: [0.4, 0.4, null], other: [0.6, 0.6, 0.8],
};

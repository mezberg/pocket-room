// Kate's flat, Hoskins Street SE10: the 26 Sep 2026 build, in plan pixels.
// Source: ~/Documents/Work/AIInteriorDesigner/hoskins-street-flat/from_scratch_2026-09-26/
//   fp3d/solved.json   px -> metres (scale, origin)
//   fp3d/build_ifc.py  walls, doors, glazing, cupboard bank (pixel rectangles)
//   fp3d/furniture.py  furniture positions, heater, pendants
//   viewer/manifest.json  assembly bounding boxes (world axes), used for footprints and heights
// Pixels are on the 3x plan crop (plan.png). Plan up = north, so y north = -py.

export const SCALE = 143.98883374689825;          // px per metre (solved.json)
export const OX = 92.0, OY = 44.5;                 // origin_px
export const YTOP = 12.672397332381093 - 8.364254717183647e-05;   // grid.h max - min
export const X = (px) => (px - OX) / SCALE;
export const Y = (py) => YTOP - (py - OY) / SCALE;
export const M = (px) => px / SCALE;

// Heights (conventions from the build README; the plan has none)
export const H = 2.40, DOOR_H = 2.04, FRONT_DOOR_H = 2.08, GLZ_HEAD = 2.30, GLZ_KERB = 0.04;
export const WIN_SILL = 0.95, WIN_HEAD = 2.15;

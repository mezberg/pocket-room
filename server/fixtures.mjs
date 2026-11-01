// The contract fixtures, for stubs and tests.
import { readFileSync } from "node:fs";
const read = (f) => JSON.parse(readFileSync(new URL(`../contract/fixtures/${f}`, import.meta.url)));
export const room = () => read("hoskins-living-room.room.json");
export const sofa = () => read("sofa-84.piece.json");

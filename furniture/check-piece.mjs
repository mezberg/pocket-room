// A small validator for contract/piece.schema.json (required fields, enums, types), so tests and the
// try script can check output without a JSON-schema dependency.
import { readFileSync } from "node:fs";

const schema = JSON.parse(readFileSync(new URL("../contract/piece.schema.json", import.meta.url), "utf8"));

function check(value, s, path, errors) {
  if (s.enum && !s.enum.includes(value)) errors.push(`${path}: ${JSON.stringify(value)} not in ${s.enum.join("|")}`);
  const types = [].concat(s.type ?? []);
  const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
  if (types.length && !types.some(t => t === typeOf(value) || (t === "number" && typeOf(value) === "integer"))) {
    errors.push(`${path}: ${typeOf(value)}, want ${types.join("|")}`); return;
  }
  if (s.type === "object" && value) {
    for (const k of s.required ?? []) if (value[k] === undefined) errors.push(`${path}.${k}: missing`);
    for (const [k, sub] of Object.entries(s.properties ?? {})) if (value[k] !== undefined) check(value[k], sub, `${path}.${k}`, errors);
  }
  if (s.type === "array" && value) {
    if (s.minItems && value.length < s.minItems) errors.push(`${path}: ${value.length} items < ${s.minItems}`);
    if (s.maxItems && value.length > s.maxItems) errors.push(`${path}: ${value.length} items > ${s.maxItems}`);
    if (s.items) value.forEach((v, i) => check(v, s.items, `${path}[${i}]`, errors));
  }
}

export function checkPiece(piece) {
  const errors = [];
  check(piece, schema, "piece", errors);
  if (piece?.size?.some(v => !(v > 0))) errors.push("piece.size: every value must be > 0");
  return errors;
}

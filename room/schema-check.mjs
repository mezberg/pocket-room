// A small JSON Schema checker for the contract (type, enum, required, properties, items, min/maxItems, $ref).
// Enough for room.schema.json without adding a dependency. Returns a list of "path: problem" strings.
import { readFileSync } from "node:fs";

const load = (f) => JSON.parse(readFileSync(new URL(`../contract/${f}`, import.meta.url)));
export const roomSchema = () => load("room.schema.json");

const typeOf = (v) => (v === null ? "null" : Array.isArray(v) ? "array" : Number.isInteger(v) ? "integer" : typeof v);
const isType = (v, t) => t === typeOf(v) || (t === "number" && typeOf(v) === "integer");

export function check(value, schema, root = schema, path = "$") {
  if (schema.$ref) return check(value, resolve(root, schema.$ref), root, path);
  const errs = [];
  if (schema.type) {
    const types = [].concat(schema.type);
    if (!types.some((t) => isType(value, t))) return [`${path}: expected ${types.join("|")}, got ${typeOf(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in ${schema.enum.join(", ")}`);
  if (typeOf(value) === "object") {
    for (const k of schema.required || []) if (!(k in value)) errs.push(`${path}: missing ${k}`);
    for (const [k, s] of Object.entries(schema.properties || {})) if (k in value) errs.push(...check(value[k], s, root, `${path}.${k}`));
  }
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errs.push(`${path}: fewer than ${schema.minItems} items`);
    if (schema.maxItems != null && value.length > schema.maxItems) errs.push(`${path}: more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((v, i) => errs.push(...check(v, schema.items, root, `${path}[${i}]`)));
  }
  return errs;
}

function resolve(root, ref) {
  if (!ref.startsWith("#/")) throw new Error(`only local $refs: ${ref}`);
  return ref.slice(2).split("/").reduce((o, k) => o[k], root);
}

export const checkRoom = (room) => check(room, roomSchema());

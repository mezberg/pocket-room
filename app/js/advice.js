// "What's wrong with my room": the order the findings are shown in. Pure, tested in node.
// Rules that stop the room working come first (pieces in each other, a blocked way or door, through a wall),
// then everything else in the Decisions API's order (designer/advice.mjs); the top three get rank 1–3 and the
// rest fold under "More (n)". A just-fixed finding (green) stays on top; passing ones go last.
export const BLOCKING = new Set(["overlap", "path_blocked", "door_blocked", "through_wall", "too_tall", "off_floor"]);
const SEV = { fail: 0, warn: 1, info: 2 };

export function rankFindings(findings, advice) {
  const p = new Map((advice?.ranked ?? []).map((r) => [r.index, r.p ?? 0]));
  const idx = findings.map((f, i) => i);
  const bad = idx.filter((i) => !findings[i].pass);
  const order = bad.sort((a, b) => {
    const fa = findings[a], fb = findings[b];
    return (BLOCKING.has(fb.id) && fb.kind === "model") - (BLOCKING.has(fa.id) && fa.kind === "model")   // blocking rules first
      || (p.get(b) ?? -1) - (p.get(a) ?? -1)                                                            // then the advice
      || SEV[fa.severity] - SEV[fb.severity] || a - b;                                                  // then severity
  });
  const fixed = idx.filter((i) => findings[i].pass && findings[i].fixed);
  const good = idx.filter((i) => findings[i].pass && !findings[i].fixed);
  return [...fixed, ...order, ...good].map((i) => {
    const f = { ...findings[i] };
    delete f.rank;
    const r = order.indexOf(i);
    if (r >= 0 && r < 3) f.rank = r + 1;
    return f;
  });
}

// What shows and what folds: the fixed ones and the top three, then "More (n)".
export function fold(findings) {
  const shown = [], more = [];
  for (const [i, f] of findings.entries()) (f.fixed || f.rank || (!findings.some((x) => x.rank) && i < 3) ? shown : more).push(i);
  return { shown, more };
}

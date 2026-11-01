// Misplaced — the labels pinned to the 3D scene (.dim in .labels; see wireframe.html, "3D stage").
// A label is { el, pos, on }: placeLabels() puts each one that is on at its 3D point (pos) in a
// w × h frame (the view's size) and hides it when the point leaves the frame; declutter() then
// hides any label that overlaps one already shown. Solid labels (measurements) win over .ghost
// ones (minimums, guides); otherwise the order they were created in decides.
// Call placeLabels() after each frame is drawn. It reads label sizes before it writes anything,
// and only for text that changed since it last looked, then writes only the styles that change,
// so a moving camera never forces a layout.
import { Vector3 } from "three";

let fonts = 0;                     // a web font that finishes loading changes every label's size
document.fonts?.addEventListener("loadingdone", () => fonts++);
const p = new Vector3();

export function placeLabels(labels, camera, w, h) {
  const list = Object.values(labels);
  // read: the size of each label whose text changed (one layout at most, before any write)
  for (const lb of list) {
    const text = lb.el.textContent;
    if (lb.box && lb.box.text === text && lb.box.fonts === fonts) continue;
    const r = lb.el.getBoundingClientRect();
    lb.box = { text, fonts, w: r.width, h: r.height };
  }
  // where each label lands
  for (const lb of list) {
    lb.show = false;
    if (!lb.on) continue;
    p.copy(lb.pos).project(camera);
    lb.x = (p.x * 0.5 + 0.5) * w;
    lb.y = (-p.y * 0.5 + 0.5) * h;
    lb.show = p.z < 1 && lb.x > 0 && lb.x < w && lb.y > 0 && lb.y < h;
  }
  declutter(list);
  // write: only what changed
  for (const lb of list) {
    const s = lb.el.style, o = lb.show ? "1" : "0";
    if (lb.on) {
      const x = lb.x + "px", y = lb.y + "px";
      if (lb.left !== x) s.left = lb.left = x;
      if (lb.top !== y) s.top = lb.top = y;
    }
    if (lb.opacity !== o) s.opacity = lb.opacity = o;
  }
}

// labels that placeLabels() shows: hide the ones that overlap one already shown. A label is
// centred on its point (.dim: translate(-50%, -50%)), so its box comes from the point and its size.
// (Opacity is written once per label per frame: written twice with a layout read in between, the
// .dim fade could leave a hidden label on screen.)
export function declutter(labels) {
  const list = Object.values(labels).filter(lb => lb.show)
    .sort((a, b) => a.el.classList.contains("ghost") - b.el.classList.contains("ghost"));
  const shown = [];
  for (const lb of list) {
    const { w, h } = lb.box;
    const r = { left: lb.x - w / 2, right: lb.x + w / 2, top: lb.y - h / 2, bottom: lb.y + h / 2 };
    if (shown.some(s => r.left < s.right + 4 && r.right > s.left - 4 && r.top < s.bottom + 2 && r.bottom > s.top - 2)) lb.show = false;
    else shown.push(r);
  }
}

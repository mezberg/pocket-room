// Misplaced — the rotate button for the 3D on touch screens ([data-rotate], top right of the view).
// A finger on the 3D scrolls the page like anywhere else, so a reader scrolling past never gets
// stuck in the scene. Pressed, one finger turns the camera and a pinch zooms; pressed again, or
// once the 3D has scrolled out of view, the page scrolls again. With a mouse the button is hidden
// and dragging turns the camera as always. Camera tweens (steps, views) run either way.
export const touchScreen = matchMedia("(pointer: coarse), (hover: none)");

// controls: the page's OrbitControls; view: the element holding the button; onHide: from onDemand()
export function rotatable(controls, view, onHide) {
  const canvas = controls.domElement, btn = view.querySelector("[data-rotate]");
  let on = false;
  function set(v) {
    on = v;
    btn?.setAttribute("aria-pressed", String(on));
    // OrbitControls sets touch-action: none; while off the browser keeps the gestures (scroll, page zoom)
    canvas.style.touchAction = on || !touchScreen.matches ? "none" : "manipulation";
  }
  // while off, a finger (or pen) never reaches OrbitControls: listeners on the canvas itself in the
  // capture phase run before the ones OrbitControls added
  const ignored = new Set();
  canvas.addEventListener("pointerdown", e => {
    if (on || e.pointerType === "mouse" || !touchScreen.matches) return;
    ignored.add(e.pointerId);
    e.stopImmediatePropagation();
  }, { capture: true });
  for (const type of ["pointermove", "pointerup", "pointercancel"]) canvas.addEventListener(type, e => {
    if (!ignored.has(e.pointerId)) return;
    if (type !== "pointermove") ignored.delete(e.pointerId);
    e.stopImmediatePropagation();
  }, { capture: true });

  btn?.addEventListener("click", () => set(!on));
  onHide?.(() => { if (on) set(false); });
  touchScreen.addEventListener("change", () => set(on && touchScreen.matches));
  set(false);
}

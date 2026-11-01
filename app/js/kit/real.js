// Misplaced — the low-poly realism look for 3D scenes (reference: style-3d-real.html).
// A sibling of drawn.js: same palette names, same kit parameters, but lit like a photo
// of a scale model. Faceted (flat-shaded) PBR materials, one sun plus sky light, soft
// cast shadows on the floor and ambient occlusion in the creases. No ink lines.
// Red/green stay reserved for the markers (mark() and contactShadow() from drawn.js).
// Pages draw on demand (onDemand() below): nothing runs while the scene is still, and the shadow
// map is redrawn only when something in it changed (Real.shadowsChanged), not while the camera moves.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { PALETTE, GLB_MATERIALS } from "./palette.js";

// ------------------------------------------------------------------ tokens
// Surface per palette name: roughness, metalness. Colours come from PALETTE (palette.js),
// so a piece is the same colour in both looks; only the light changes.
export const SURFACE = {
  Fabric: { roughness: 0.95, metalness: 0 },
  Wood:   { roughness: 0.62, metalness: 0 },
  Hard:   { roughness: 0.5,  metalness: 0 },
  Plants: { roughness: 0.8,  metalness: 0 },
  Room:   { roughness: 0.9,  metalness: 0 },
};
const OVERRIDE = {
  black:  { roughness: 0.38, metalness: 0.55 },      // powder-coated steel
  marble: { roughness: 0.22, metalness: 0 },
  pot:    { roughness: 0.45, metalness: 0 },         // glazed ceramic
  glass:  { roughness: 0.08, metalness: 0, transparent: true, opacity: 0.35 },
  floor:  { roughness: 0.7,  metalness: 0 },
};
export const SUN = new THREE.Vector3(0.5, 1, 0.8).normalize();       // from above, over the camera's left shoulder (as drawn.js LIGHT)
export const LIGHTS = { sun: 2.3, sunColor: "#FFF3E2", sky: 1.35, skyColor: "#F9F8F5", groundColor: "#D3CCC1" }; // soft, warm afternoon light
export const SHADOW = { opacity: 0.22, radius: 20, mapSize: 1024 };   // radius in map texels: ~10 cm of penumbra
export const AO = { radius: 0.35, intensity: 0.65 };
export const EXPOSURE = 1.12;

// ------------------------------------------------------------------ materials
const mats = new Map();

// flat-shaded PBR material for a palette name (or any CSS colour); double for open meshes
export function paint(name, opacity = 1, { double = false } = {}) {
  const key = (opacity < 1 ? `${name}@${opacity}` : name) + (double ? "|2" : "");
  if (mats.has(key)) return mats.get(key);
  const p = PALETTE[name];
  const s = { ...(SURFACE[p?.group] ?? SURFACE.Hard), ...OVERRIDE[name] };
  const m = new THREE.MeshStandardMaterial({
    name, color: new THREE.Color(p?.hex ?? name), flatShading: true,
    roughness: s.roughness, metalness: s.metalness,
    transparent: opacity < 1 || !!s.transparent, opacity: Math.min(opacity, s.opacity ?? 1),
    depthWrite: opacity === 1 && !s.transparent,
    side: double ? THREE.DoubleSide : THREE.FrontSide,
  });
  mats.set(key, m);
  return m;
}

// every visible mesh casts and receives; see-through ones (overlays, glass) only receive
export function shadows(root) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const see = o.material?.transparent || o.userData.noEdge;
    o.castShadow = !see;
    o.receiveShadow = !o.userData.noEdge;
  });
}

// repaint a loaded glTF scene with the real palette (same map as drawn.js)
export function restyle(root, map = GLB_MATERIALS) {
  root.traverse(o => {
    if (!o.isMesh) return;
    const name = (o.material.name || "").replace(/\.\d+$/, "");
    o.material = paint(map[name] ?? nearest(o.material.color ?? new THREE.Color(1, 1, 1)));
  });
  shadows(root);
}

function nearest(color) {
  const c = color.clone().convertLinearToSRGB();
  let best = "stone", bd = Infinity;
  for (const [k, v] of Object.entries(PALETTE)) {
    const p = new THREE.Color(v.hex).convertLinearToSRGB();
    const d = (p.r - c.r) ** 2 + (p.g - c.g) ** 2 + (p.b - c.b) ** 2;
    if (d < bd) { bd = d; best = k; }
  }
  return best;
}

// ------------------------------------------------------------------ light rig
// Sky + sun with a shadow camera fitted to obj, and an invisible floor that only
// shows the shadow (so the plate behind the scene stays the --scene colour).
// Returns the rig group; add it to the scene once. floor: false when obj has its own.
// If obj changes size later, call fitRig(rig, obj) again.
export function rig(obj, { floor = true, y = 0 } = {}) {
  const g = new THREE.Group();
  g.userData.rig = true;
  g.add(new THREE.HemisphereLight(LIGHTS.skyColor, LIGHTS.groundColor, LIGHTS.sky));

  const sun = new THREE.DirectionalLight(LIGHTS.sunColor, LIGHTS.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW.mapSize, SHADOW.mapSize);
  sun.shadow.radius = SHADOW.radius;
  sun.shadow.blurSamples = 24;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.01;
  g.add(sun, sun.target);
  g.userData.sun = sun;

  if (floor) {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: SHADOW.opacity, color: "#4A3A26" }));
    f.rotation.x = -Math.PI / 2;
    f.position.y = y;
    f.receiveShadow = true;
    f.userData.floor = true;
    f.raycast = () => {};
    g.add(f);
    g.userData.floor = f;
  }
  return fitRig(g, obj);
}

export function fitRig(g, obj) {
  obj.updateWorldMatrix(true, true);
  const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3());
  const r = box.getBoundingSphere(new THREE.Sphere()).radius;
  const sun = g.userData.sun;
  sun.position.copy(c).addScaledVector(SUN, r * 3);
  sun.target.position.copy(c);
  sun.target.updateMatrixWorld();
  const sc = sun.shadow.camera;
  Object.assign(sc, { left: -r * 1.1, right: r * 1.1, top: r * 1.1, bottom: -r * 1.1, near: r * 0.5, far: r * 6 });
  sc.updateProjectionMatrix();
  const f = g.userData.floor;
  if (f) { f.scale.set(r * 8, r * 8, 1); f.position.x = c.x; f.position.z = c.z; }
  return g;
}

// overlays (tape, zones, markers, x-ray copies) are see-through or drawn on top: they
// stay out of the occlusion pass, or they'd darken the floor under them.
const overlay = o => o.userData.noEdge || o.isSprite || o.material?.transparent || o.material?.depthTest === false;
class OverlayFreeGTAO extends GTAOPass {
  overrideVisibility() {
    super.overrideVisibility();
    this.scene.traverse(o => { if (o.isMesh && overlay(o) && !o.userData.floor) o.visible = false; });
  }
}

// ------------------------------------------------------------------ renderer
// Scene → (GTAO) → tone map. One instance per WebGLRenderer; scenes and cameras can
// change between calls as long as they are all orthographic (or all perspective).
export class Real {
  constructor(renderer, { perspective = false } = {}) {
    this.r = renderer;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    // the shadow map is drawn only when what it shows changed (shadowsChanged() below), not on
    // every frame: orbiting and camera tweens reuse it and skip its pass and the two blur passes
    renderer.shadowMap.autoUpdate = false;
    this.shadowKey = [];
    renderer.domElement.addEventListener("webglcontextrestored", () => { this.shadowKey.length = 0; });
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = EXPOSURE;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, rt);
    const cam = perspective ? new THREE.PerspectiveCamera() : new THREE.OrthographicCamera();
    const scene = new THREE.Scene();
    this.pass = new RenderPass(scene, cam);
    this.ao = new OverlayFreeGTAO(scene, cam, 1, 1);
    this.ao.blendIntensity = AO.intensity;
    this.ao.updateGtaoMaterial({ radius: AO.radius, distanceExponent: 1, thickness: 1, scale: 1, samples: 16 });
    this.composer.addPass(this.pass);
    this.composer.addPass(this.ao);
    this.composer.addPass(new OutputPass());
    this.size = new THREE.Vector2();
    this.ready = false;   // compile() has finished: the first frame won't stall
  }

  // Compile the scene's shaders without blocking the page (KHR_parallel_shader_compile) before
  // the first frame. Compiled for the composer's buffer, the target the scene is drawn into
  // (linear, tone mapped later by the OutputPass), or the first render would compile them again.
  compile(scene, camera) {
    const r = this.r, target = r.getRenderTarget();
    r.setRenderTarget(this.composer.readBuffer);
    const done = r.compileAsync(scene, camera);
    r.setRenderTarget(target);
    return done.then(() => { this.ready = true; });
  }

  // opts: light (sun + sky; off = flat albedo), shadows (cast shadows), ao
  render(scene, camera, { light = true, shadows = true, ao = true } = {}) {
    const r = this.r;
    r.getSize(this.size);
    if (this.composer._w !== this.size.x || this.composer._h !== this.size.y || this.composer._pr !== r.getPixelRatio()) {
      this.composer.setPixelRatio(r.getPixelRatio());
      this.composer.setSize(this.size.x, this.size.y);
      Object.assign(this.composer, { _w: this.size.x, _h: this.size.y, _pr: r.getPixelRatio() });
    }
    if (plateStale) { plate.set(sceneColor()); plateStale = false; }
    scene.background = plate;
    // lights and shadows switched on or off; pages always draw with both on, so once per scene
    const all = light && shadows;
    if (!all || this.lit !== scene) {
      scene.traverse(o => {
        if (o.isLight) o.visible = light || o.isAmbientLight;
        if (o.isDirectionalLight) o.castShadow = shadows;
        if (o.userData.floor) o.visible = shadows;
      });
      this.lit = all ? scene : null;
    }
    // without lights, show the albedo: a temporary ambient light at full strength
    let flat = null;
    if (!light) { flat = new THREE.AmbientLight(0xffffff, Math.PI); scene.add(flat); }
    this.pass.scene = this.ao.scene = scene;
    this.pass.camera = this.ao.camera = camera;
    this.ao.enabled = ao;
    // world matrices once, here (the shadow check reads them), instead of once per pass
    const auto = scene.matrixWorldAutoUpdate;
    if (auto) scene.updateMatrixWorld();
    if (this.shadowsChanged(scene, camera)) r.shadowMap.needsUpdate = true;
    scene.matrixWorldAutoUpdate = false;
    try { this.composer.render(); } finally { scene.matrixWorldAutoUpdate = auto; }
    if (flat) flat.removeFromParent();
  }

  // True when the shadow map would come out different from the last one drawn: everything
  // three.js draws into it is listed (the scene, every shadow-casting light with its shadow camera,
  // and every visible mesh that casts or receives: VSM draws receivers too, with its place, shape
  // and material) and compared with the list of the last frame. So pages never have to say that
  // something moved; only an edit three.js can't see would be missed (change vertices with
  // attribute.needsUpdate = true, materials with material.needsUpdate = true, as three.js wants).
  shadowsChanged(scene, camera) {
    const k = this.shadowKey;
    let i = 0, changed = false;
    const put = v => { if (k[i] !== v) { k[i] = v; changed = true; } i++; };
    const m16 = m => { for (const e of m.elements) put(e); };
    const mat = m => { put(m.id); put(m.version); put(m.visible ? 1 : 0); put(m.side); put(m.shadowSide ?? -1); };
    put(scene.id);
    put(camera.layers.mask);
    scene.traverseVisible(o => {
      if (o.isLight) {
        if (!o.castShadow || !o.shadow) return;
        const s = o.shadow;
        put(o.id); m16(o.matrixWorld);
        if (o.target) m16(o.target.matrixWorld);
        m16(s.camera.projectionMatrix);
        put(s.mapSize.x); put(s.mapSize.y); put(s.radius); put(s.blurSamples);
      } else if ((o.isMesh || o.isLine || o.isPoints) && (o.castShadow || o.receiveShadow)) {
        const g = o.geometry;
        put(o.id); put(o.castShadow ? 1 : 0); put(o.layers.mask); m16(o.matrixWorld);
        put(g.id); put(g.attributes.position?.version ?? -1); put(g.index?.version ?? -1);
        put(g.drawRange.start); put(g.drawRange.count);
        if (o.isInstancedMesh) { put(o.count); put(o.instanceMatrix.version); }
        if (Array.isArray(o.material)) o.material.forEach(mat); else mat(o.material);
      }
    });
    if (k.length !== i) { k.length = i; changed = true; }
    return changed;
  }
}

// the plate behind the scene, from the page token so it follows the theme
export function sceneColor() {
  return getComputedStyle(document.documentElement).getPropertyValue("--scene").trim() || "#ECEDEE";
}
// read once, and again after the theme changes (not every frame: getComputedStyle can force a style pass)
const plate = new THREE.Color();
let plateStale = true;
const onThemeChange = fn => {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", fn);
  new MutationObserver(fn).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
};
onThemeChange(() => { plateStale = true; });

// ------------------------------------------------------------------ render on demand
// The stage draws only when something changed. request() asks for a frame; frame(dt, time)
// moves the scene one step, draws it and returns true while anything is still moving (a camera
// tween, orbit damping, a size easing to its goal), which asks for the next one. Still, the page
// draws nothing. A theme change, a web font that loads (label sizes) or a restored WebGL context
// asks by itself; the page asks after anything else it changes (state, step, view, resize).
// While el is off screen frames wait, and run when it comes back.
// dt: seconds since the last frame while moving (at most 0.05, as the loops always had), one
// 60 Hz frame for the first frame after a still spell, and the whole time away when the stage
// scrolls back in mid-animation (a tween that would have ended off screen has ended).
// time: seconds on the page clock, for anything that pulses.
// onHide(fn) runs fn each time el scrolls out of view (the rotate button switches itself off).
export function onDemand(renderer, el, frame) {
  let raf = 0, last = 0, moving = false, away = false, waiting = false, visible = true;
  const hidden = [];
  const tick = now => {
    raf = 0;
    if (!visible) { waiting = true; return; }
    const dt = !moving ? 1 / 60 : away ? Math.max(0, now - last) / 1000 : Math.min(Math.max(0, now - last) / 1000, 0.05);
    away = false;
    last = now;
    moving = !!frame(dt, now / 1000);
    if (moving) request();
  };
  function request() {
    if (!visible) { waiting = true; return; }
    if (!raf) raf = requestAnimationFrame(tick);
  }
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (!visible) hidden.forEach(fn => fn());
    if (visible && waiting) { waiting = false; away = moving; request(); }
  }).observe(el);
  onThemeChange(request);
  document.fonts?.addEventListener("loadingdone", request);
  renderer.domElement.addEventListener("webglcontextrestored", request);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) request(); });
  return { request, onHide: fn => hidden.push(fn) };
}

// Page scripts start with `await firstPaint()`: the text and the poster paint before the 3D is
// built (the scripts load early now, so without it a warm cache would hold the first paint back by
// the whole setup). Already painted (a cold load, the scripts arrive after it), it goes on at once.
export function firstPaint() {
  if (performance.getEntriesByType?.("paint").length) return Promise.resolve();
  return new Promise(r => { requestAnimationFrame(() => setTimeout(r)); setTimeout(r, 100); });
}

// OrbitControls with damping: update() stops reporting a change below 1 mm a frame, but the
// camera still glides on; keep drawing until what's left of the turn can't be seen (0.1 mrad,
// a tenth of a pixel). _sphericalDelta is the turn still to come (three 0.169).
export const orbiting = c => c.enableDamping &&
  (Math.abs(c._sphericalDelta.theta) + Math.abs(c._sphericalDelta.phi) > 1e-4 || c._panOffset.lengthSq() > 1e-8);

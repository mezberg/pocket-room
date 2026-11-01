import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { chesterfieldLoveseat } from "./kit/chesterfield.js";

const stage = document.querySelector(".stage");
const scene = new THREE.Scene();
scene.background = new THREE.Color("#eee9e2");
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
camera.position.set(2.7, 1.85, 3.55);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
stage.prepend(renderer.domElement);

scene.add(new THREE.HemisphereLight("#fff3e5", "#776765", 2.0));
const key = new THREE.DirectionalLight("#fff2df", 3.4);
key.position.set(-3, 5, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -3;
key.shadow.camera.right = 3;
key.shadow.camera.top = 3;
key.shadow.camera.bottom = -3;
key.shadow.bias = -0.0003;
scene.add(key);
const fill = new THREE.DirectionalLight("#d8e2ff", 1.15);
fill.position.set(3, 2.4, -3);
scene.add(fill);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.MeshStandardMaterial({ color: "#e6ded4", roughness: 0.88 }));
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.008;
floor.receiveShadow = true;
scene.add(floor);

const sofa = chesterfieldLoveseat();
scene.add(sofa);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.43, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.075;
controls.minDistance = 1.8;
controls.maxDistance = 7;
controls.maxPolarAngle = Math.PI * 0.49;

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
new ResizeObserver(resize).observe(stage);
resize();

const views = {
  front: [0, 1.05, 3.4],
  side: [3.35, 1.1, 0.05],
  back: [0, 1.1, -3.5],
  home: [2.7, 1.85, 3.55],
};
document.querySelectorAll("[data-view]").forEach(button => button.addEventListener("click", () => {
  camera.position.set(...views[button.dataset.view]);
  controls.target.set(0, 0.43, 0);
  controls.update();
}));

document.querySelector("#download").addEventListener("click", () => {
  const status = document.querySelector("#status");
  status.textContent = "Preparing GLB…";
  new GLTFExporter().parse(sofa, result => {
    const blob = new Blob([result], { type: "model/gltf-binary" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "pocket-room-oxblood-chesterfield-proxy.glb";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status.textContent = "GLB downloaded. Dimensions remain visual estimates.";
  }, error => {
    console.error(error);
    status.textContent = "Could not export GLB in this browser.";
  }, { binary: true });
});

function frame() {
  controls.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
frame();


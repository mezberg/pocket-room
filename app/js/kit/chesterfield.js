import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

// A photo-led Chesterfield loveseat proxy. Dimensions are editable guesses until
// the user supplies a product measurement; front faces +Z and the base sits at Y=0.
const DEFAULTS = { width: 1.78, depth: 0.94, height: 0.82, seats: 2, leather: "#7d2027" };

function leatherMaterial(base) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, 256, 256);

  // Fine grain and a few worn hairline creases: enough to catch light in the viewer
  // without baking the reference photo onto an invented 3D surface.
  let seed = 23041;
  const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  for (let i = 0; i < 9000; i++) {
    const v = rand() > 0.52 ? 255 : 12;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.015 + rand() * 0.055})`;
    ctx.fillRect(rand() * 256, rand() * 256, 1 + rand() * 2, 1 + rand() * 2);
  }
  for (let i = 0; i < 80; i++) {
    const x = rand() * 256, y = rand() * 256, len = 4 + rand() * 26;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + (rand() - 0.5) * 7, y + len * 0.5, x + (rand() - 0.5) * 4, y + len);
    ctx.strokeStyle = `rgba(31,8,11,${0.035 + rand() * 0.08})`;
    ctx.lineWidth = 0.5 + rand() * 0.7;
    ctx.stroke();
  }
  const map = new THREE.CanvasTexture(canvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(3, 2);
  return new THREE.MeshPhysicalMaterial({ map, color: "white", roughness: 0.36, metalness: 0, clearcoat: 0.22, clearcoatRoughness: 0.32 });
}

function mesh(parent, geometry, material, pos, scale = [1, 1, 1]) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

function rounded(parent, material, size, pos, radius = 0.04) {
  const [w, h, d] = size;
  const r = Math.min(radius, w * 0.48, h * 0.48, d * 0.48);
  return mesh(parent, new RoundedBoxGeometry(w, h, d, 5, r), material, pos);
}

function seam(parent, material, points, radius = 0.003) {
  const curve = new THREE.CatmullRomCurve3(points.map(p => new THREE.Vector3(...p)));
  return mesh(parent, new THREE.TubeGeometry(curve, Math.max(8, points.length * 5), radius, 5, false), material, [0, 0, 0]);
}

function button(parent, material, pos, normal = [0, 0, 1], size = 0.018) {
  const m = mesh(parent, new THREE.SphereGeometry(1, 14, 10), material, pos, [size, size * 0.78, size * 0.48]);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...normal).normalize());
  return m;
}

function tuftedBack(parent, leather, dark, width, height, z) {
  const cols = 7, rows = 3;
  const dx = width / cols, dy = height / rows;
  const yBottom = 0.48;
  // z is the face plane: the padded foundation sits behind it and the tufts roll forward.
  rounded(parent, leather, [width + 0.025, height + 0.035, 0.145], [0, yBottom + height / 2, z - 0.072], 0.065);

  // Individually padded leather diamonds, offset by half a cell on alternating rows.
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 ? dx * 0.5 : 0;
    for (let col = 0; col < cols; col++) {
      const x = -width / 2 + dx * (col + 0.5) + offset;
      if (Math.abs(x) > width / 2 - dx * 0.24) continue;
      const y = yBottom + dy * (row + 0.5);
      mesh(parent, new THREE.SphereGeometry(1, 18, 14), leather, [x, y, z + 0.035], [dx * 0.57, dy * 0.61, 0.048]);
    }
  }

  // Recessed buttons and fine stitched folds make the deep tufting read at demo scale.
  for (let row = 0; row <= rows; row++) {
    const y = yBottom + dy * row;
    const offset = row % 2 ? dx * 0.5 : 0;
    for (let col = 0; col <= cols; col++) {
      const x = -width / 2 + dx * col + offset;
      if (Math.abs(x) > width / 2 - 0.025) continue;
      button(parent, dark, [x, y, z + 0.087], [0, 0, 1], 0.016);
      const diagonals = [[-1, -1], [1, -1], [-1, 1], [1, 1]];
      for (const [sx, sy] of diagonals) {
        const endX = x + sx * dx * 0.42, endY = y + sy * dy * 0.42;
        if (Math.abs(endX) > width / 2 || endY < yBottom || endY > yBottom + height) continue;
        seam(parent, dark, [[x, y, z + 0.087], [x + sx * dx * 0.14, y + sy * dy * 0.16, z + 0.078], [endX, endY, z + 0.055]], 0.0022);
      }
    }
  }
}

function rolledArm(parent, leather, dark, side, width, depth) {
  const x = side * (width / 2 - 0.205);
  const z = -0.015;
  rounded(parent, leather, [0.38, 0.43, depth * 0.82], [x, 0.34, z], 0.13);
  // Long padded roll running front to back, with a rounded, overhanging front cap.
  mesh(parent, new THREE.SphereGeometry(1, 28, 20), leather, [x, 0.595, z - 0.012], [0.205, 0.19, depth * 0.47]);
  mesh(parent, new THREE.SphereGeometry(1, 24, 18), leather, [x, 0.56, depth * 0.37], [0.205, 0.205, 0.14]);

  // A compact tufted face on each arm end.
  for (const ox of [-0.075, 0.075]) for (const oy of [-0.065, 0.065]) {
    button(parent, dark, [x + ox, 0.56 + oy, depth * 0.37 + 0.126], [0, 0, 1], 0.013);
  }
  // A small seam along the outside of each rolled arm.
  const outer = x + side * 0.197;
  seam(parent, dark, [[outer, 0.47, -depth * 0.32], [outer, 0.48, 0], [outer, 0.47, depth * 0.29]], 0.0025);
}

export function chesterfieldLoveseat(options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const { width, depth, height } = cfg;
  const group = new THREE.Group();
  group.name = "Photo-based Chesterfield loveseat proxy";
  const leather = leatherMaterial(cfg.leather);
  const piping = new THREE.MeshStandardMaterial({ color: "#a94b4a", roughness: 0.48 });
  const dark = new THREE.MeshStandardMaterial({ color: "#3d1118", roughness: 0.48, metalness: 0.06 });
  const wood = new THREE.MeshStandardMaterial({ color: "#30211e", roughness: 0.68 });

  const armX = width / 2 - 0.205;
  const innerW = width - 0.73;
  const backZ = -depth / 2 + 0.195;
  const seatY = 0.405;

  // Low plinth, upholstered apron, and dark, recessed feet.
  rounded(group, leather, [width - 0.16, 0.25, depth - 0.19], [0, 0.185, -0.015], 0.075);
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const foot = mesh(group, new THREE.CylinderGeometry(0.052, 0.043, 0.105, 10), wood,
      [x * (width / 2 - 0.22), 0.055, z * (depth / 2 - 0.19)]);
    foot.rotation.z = x * -0.1;
  }

  // Broad central back, tufted leather face, and piping at its top edge.
  rounded(group, leather, [innerW + 0.08, 0.49, 0.22], [0, 0.625, backZ], 0.085);
  tuftedBack(group, leather, dark, innerW - 0.015, 0.39, backZ + 0.11);
  seam(group, piping, [[-innerW / 2, 0.819, backZ + 0.105], [0, 0.835, backZ + 0.105], [innerW / 2, 0.819, backZ + 0.105]], 0.004);

  // Seat deck and two loose, rounded leather cushions with piped edges.
  rounded(group, leather, [innerW - 0.015, 0.15, depth * 0.64], [0, 0.355, 0.075], 0.055);
  const cushionW = (innerW - 0.045) / 2;
  for (const side of [-1, 1]) {
    const cx = side * (cushionW / 2 + 0.012);
    rounded(group, leather, [cushionW, 0.155, depth * 0.60], [cx, seatY, 0.12], 0.065);
    const frontZ = 0.12 + depth * 0.30;
    const xL = cx - cushionW * 0.43, xR = cx + cushionW * 0.43;
    seam(group, piping, [[xL, seatY + 0.064, frontZ], [cx, seatY + 0.071, frontZ + 0.004], [xR, seatY + 0.064, frontZ]], 0.003);
  }

  // Deep rolled, buttoned arms and padded front rail.
  rolledArm(group, leather, dark, -1, width, depth);
  rolledArm(group, leather, dark, 1, width, depth);
  rounded(group, leather, [width - 0.52, 0.205, 0.17], [0, 0.205, depth / 2 - 0.13], 0.065);
  const railW = width - 0.56;
  for (let i = 0; i < 7; i++) {
    const x = -railW / 2 + railW * i / 6;
    button(group, dark, [x, 0.205, depth / 2 - 0.038], [0, 0, 1], 0.014);
  }

  // Scale the visual silhouette to the requested height, preserving a floor at y=0.
  group.scale.y = height / 0.87;
  group.userData.dimensions = [width, depth, height];
  group.userData.scaleSource = options.scaleSource ?? "visual estimate";
  group.userData.photoMatch = "oxblood leather, rolled arms, deep button tufting, two seat cushions";
  return group;
}


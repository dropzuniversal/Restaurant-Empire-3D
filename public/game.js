"use strict";

/* ================================================================= state */

const S = {
  socket: null, me: null, name: "", pkey: null, gender: "male",
  room: null, isHost: false, snap: null, names: {}, profile: null, endPayload: null,
  chefs: new Map(), guests: new Map(), plates: new Map(),
  local: { x: 0, z: -6.4, slide: 0 },
  vel: { x: 0, z: 0 },
  lastSent: 0, wasRush: false,
};

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function screen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  $(id).classList.add("on");
}
function toast(m) {
  const t = $("toast");
  t.textContent = m; t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 1700);
}
function pop(text, kind, x, y) {
  const el = document.createElement("div");
  el.className = "pop" + (kind ? " " + kind : "");
  el.textContent = text;
  el.style.left = (x != null ? x : innerWidth / 2 - 20) + "px";
  el.style.top = (y != null ? y : innerHeight * 0.4) + "px";
  $("pops").appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/* ==================================================================== 3D */

let scene, camera, renderer, ray, ptr;
let guestLayer, chefLayer, plateLayer, tableLayer;
let TABLES = [], OFFSETS = {}, OBST = [];
let FLOOR = { minX: -8.4, maxX: 8.4, minZ: -8.2, maxZ: 12.6 };
let ROOM = { minX: -9.4, maxX: 9.4, minZ: -10.4, maxZ: 13.6 };
let KZ = -5.2, RANGE = 3.2, SINK = { x: 5.4, z: -7.0 }, BODY_R = 0.62;
let rangeRing, sinkGlow, sinkWater, plateRack, sinkPile;

const M = (c, o = {}) => new THREE.MeshStandardMaterial({
  color: c, roughness: o.rough != null ? o.rough : 0.85, metalness: o.metal || 0,
});
function box(w, h, d, c, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), M(c, o));
  m.position.set(x, y, z);
  m.castShadow = o.cast !== false; m.receiveShadow = true;
  return m;
}
function cyl(rt, rb, h, seg, c, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), M(c, o));
  m.position.set(x, y, z);
  m.castShadow = o.cast !== false; m.receiveShadow = true;
  return m;
}

/** Identical to the server's routine so the two never disagree. */
function resolveCollision(x, z) {
  const r = BODY_R;
  for (let pass = 0; pass < 2; pass++) {
    for (const o of OBST) {
      const nx = clamp(x, o.x - o.hw, o.x + o.hw);
      const nz = clamp(z, o.z - o.hd, o.z + o.hd);
      const dx = x - nx, dz = z - nz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-6) {
        const d = Math.sqrt(d2);
        x = nx + (dx / d) * r; z = nz + (dz / d) * r;
      } else {
        const ox = o.hw + r - Math.abs(x - o.x);
        const oz = o.hd + r - Math.abs(z - o.z);
        if (ox < oz) x += (x < o.x ? -ox : ox); else z += (z < o.z ? -oz : oz);
      }
    }
  }
  return { x: clamp(x, FLOOR.minX, FLOOR.maxX), z: clamp(z, FLOOR.minZ, FLOOR.maxZ) };
}

/**
 * Park the camera so the WHOLE restaurant is on screen, whatever the
 * device. Works out the distance needed to fit both the width and the
 * foreshortened depth, plus margin. Recomputed on resize.
 */
const TILT = 53 * Math.PI / 180;
function frameRoom() {
  camera.aspect = innerWidth / innerHeight;
  const cx = (ROOM.minX + ROOM.maxX) / 2;
  const cz = (ROOM.minZ + ROOM.maxZ) / 2;
  const halfW = (ROOM.maxX - ROOM.minX) / 2;
  const halfD = (ROOM.maxZ - ROOM.minZ) / 2;
  const vFov = camera.fov * Math.PI / 180;
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
  const dist = Math.max(halfW / Math.tan(hFov / 2),
    (halfD * Math.sin(TILT) + 3.4) / Math.tan(vFov / 2)) * 1.1;
  camera.position.set(cx, dist * Math.sin(TILT), cz + dist * Math.cos(TILT));
  camera.lookAt(cx, 1.2, cz - 0.4);
  camera.updateProjectionMatrix();
  camera.userData.home = { x: camera.position.x, z: camera.position.z, cx, cz };
}

function initStage() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1c1424);
  scene.fog = new THREE.Fog(0x1c1424, 44, 92);

  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);
  frameRoom();

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("stage").appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffe6c8, 0.58));
  const key = new THREE.DirectionalLight(0xfff0d8, 0.78);
  key.position.set(9, 26, 16);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  Object.assign(key.shadow.camera, { left: -22, right: 22, top: 26, bottom: -22 });
  scene.add(key);
  scene.add(new THREE.HemisphereLight(0xffd9a8, 0x4a2f22, 0.42));

  buildRoom();
  tableLayer = new THREE.Group(); scene.add(tableLayer);
  guestLayer = new THREE.Group(); scene.add(guestLayer);
  chefLayer = new THREE.Group(); scene.add(chefLayer);
  plateLayer = new THREE.Group(); scene.add(plateLayer);

  rangeRing = new THREE.Mesh(new THREE.RingGeometry(RANGE - 0.1, RANGE, 48),
    new THREE.MeshBasicMaterial({ color: 0x3fc39c, side: THREE.DoubleSide, transparent: true, opacity: 0.16 }));
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.05;
  rangeRing.visible = false;
  scene.add(rangeRing);

  ray = new THREE.Raycaster(); ptr = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", onTapWorld);
  addEventListener("resize", () => {
    renderer.setSize(innerWidth, innerHeight);
    frameRoom();
  });
  requestAnimationFrame(loop);
}

function labelSprite(text, bg, x, y, z, w) {
  const c = document.createElement("canvas");
  c.width = 168; c.height = 48;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, 168, 48);
  g.fillStyle = "#fff"; g.font = "bold 24px system-ui";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 84, 25);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  sp.scale.set(w, w * 0.286, 1);
  sp.position.set(x, y, z);
  return sp;
}

function buildRoom() {
  const r = new THREE.Group();

  // ---- dining floor: warm herringbone-ish boards
  const tones = [0x9c6540, 0x8b5735, 0xa87049, 0x94603c, 0xa16a45];
  let ti = 0;
  for (let rz = KZ; rz < ROOM.maxZ + 1; rz += 0.95) {
    let x = ROOM.minX - 1;
    while (x < ROOM.maxX + 1) {
      const w = 1.5 + ((ti * 41) % 13) / 10;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.96, 0.88), M(tones[ti % tones.length], { rough: 0.78 }));
      p.rotation.x = -Math.PI / 2;
      p.position.set(x + w / 2, 0.01, rz + 0.47);
      p.receiveShadow = true;
      r.add(p);
      x += w; ti++;
    }
    ti += 2;
  }

  // ---- kitchen floor: dark quarry tile
  for (let i = -8; i <= 8; i++) {
    for (let j = 0; j <= 6; j++) {
      const z = KZ - 0.55 - j * 1.1;
      if (z < ROOM.minZ - 1) continue;
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.04, 1.04),
        M((i + j) % 2 === 0 ? 0x4d4550 : 0x3b333f, { rough: 0.5, metal: 0.06 }));
      t.rotation.x = -Math.PI / 2;
      t.position.set(i * 1.1, 0.012, z);
      t.receiveShadow = true;
      r.add(t);
    }
  }
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.maxX - ROOM.minX + 2, 0.24),
    M(0xc79640, { metal: 0.85, rough: 0.28 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.03, KZ);
  r.add(strip);

  // ---- rug
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(15.6, 16.6), M(0x5e3244, { rough: 0.96 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.02, 5.2); rug.receiveShadow = true; r.add(rug);
  const rugIn = new THREE.Mesh(new THREE.PlaneGeometry(14.2, 15.2), M(0x77405a, { rough: 0.96 }));
  rugIn.rotation.x = -Math.PI / 2; rugIn.position.set(0, 0.025, 5.2); r.add(rugIn);
  const rugC = new THREE.Mesh(new THREE.PlaneGeometry(12.4, 13.4), M(0x8d4e68, { rough: 0.96 }));
  rugC.rotation.x = -Math.PI / 2; rugC.position.set(0, 0.03, 5.2); r.add(rugC);

  // ---- walls
  const WH = 13;
  const wall = (w, h, d, c, x, y, z) => r.add(box(w, h, d, c, x, y, z, { cast: false, rough: 0.92 }));
  wall(ROOM.maxX - ROOM.minX + 2, WH, 0.5, 0xe9d3b4, 0, WH / 2, ROOM.minZ - 0.6);
  wall(0.5, WH, ROOM.maxZ - ROOM.minZ + 2, 0xdfc7a6, ROOM.minX - 0.6, WH / 2, (ROOM.minZ + ROOM.maxZ) / 2);
  wall(0.5, WH, ROOM.maxZ - ROOM.minZ + 2, 0xdfc7a6, ROOM.maxX + 0.6, WH / 2, (ROOM.minZ + ROOM.maxZ) / 2);

  const panel = (x, z, w, rot) => {
    const g = new THREE.Group();
    g.add(box(w, 2.8, 0.18, 0x27554b, 0, 1.4, 0, { cast: false, rough: 0.72 }));
    const n = Math.max(1, Math.round(w / 1.7));
    for (let i = 0; i < n; i++) {
      g.add(box(w / n - 0.26, 1.85, 0.07, 0x2f6b5f, -w / 2 + (w / n) * (i + 0.5), 1.42, 0.11, { cast: false, rough: 0.6 }));
    }
    g.add(box(w, 0.2, 0.34, 0xf2e3c8, 0, 2.9, 0.03, { cast: false }));
    g.position.set(x, 0, z); g.rotation.y = rot || 0;
    r.add(g);
  };
  panel(ROOM.minX - 0.3, (KZ + ROOM.maxZ) / 2, ROOM.maxZ - KZ, Math.PI / 2);
  panel(ROOM.maxX + 0.3, (KZ + ROOM.maxZ) / 2, ROOM.maxZ - KZ, -Math.PI / 2);

  // splashback behind the range
  for (let i = -8; i <= 8; i++) {
    for (let j = 0; j < 4; j++) {
      r.add(box(1.02, 1.02, 0.1, (i + j) % 2 ? 0xd9ece5 : 0xf6f1e6,
        i * 1.1, 2.5 + j * 1.1, ROOM.minZ - 0.32, { cast: false, rough: 0.28, metal: 0.12 }));
    }
  }

  // framed art
  const art = (x, z, rot, col) => {
    const g = new THREE.Group();
    g.add(box(2.5, 1.9, 0.14, 0x5b3a20, 0, 0, 0, { cast: false }));
    g.add(box(2.1, 1.5, 0.06, col, 0, 0, 0.09, { cast: false, rough: 0.62 }));
    g.position.set(x, 5, z); g.rotation.y = rot; r.add(g);
  };
  art(ROOM.minX - 0.22, 2.0, Math.PI / 2, 0xd39a4a);
  art(ROOM.minX - 0.22, 9.4, Math.PI / 2, 0x5d87a8);
  art(ROOM.maxX + 0.22, 2.0, -Math.PI / 2, 0xb06a80);
  art(ROOM.maxX + 0.22, 9.4, -Math.PI / 2, 0x6d9c68);

  // ---- range line
  r.add(box(10.4, 1.95, 2.2, 0x7c4c30, -3.3, 0.98, -9.6, { rough: 0.8 }));
  r.add(box(10.8, 0.26, 2.6, 0xefe4d0, -3.3, 2.06, -9.6, { rough: 0.28, metal: 0.18 }));
  for (let i = 0; i < 2; i++) {
    const x = -6.4 + i * 6.2;
    r.add(box(4.2, 1.75, 2, 0x2c2731, x, 0.88, -9.9, { metal: 0.62, rough: 0.32 }));
    for (let b = 0; b < 2; b++) {
      const bx = x - 1.0 + b * 2.0;
      r.add(cyl(0.44, 0.44, 0.14, 20, 0x14111a, bx, 1.79, -9.9, { metal: 0.9, rough: 0.22 }));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.58, 12),
        new THREE.MeshBasicMaterial({ color: 0x62c0ff, transparent: true, opacity: 0.5 }));
      flame.position.set(bx, 2.1, -9.9);
      r.add(flame);
      r.add(cyl(0.5, 0.44, 0.16, 18, 0x33303a, bx, 1.93, -9.9, { metal: 0.78, rough: 0.35 }));
    }
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(2, 2.8, 1.5, 4), M(0xa9a4b2, { metal: 0.78, rough: 0.26 }));
    hood.rotation.y = Math.PI / 4;
    hood.position.set(x, 6.3, -9.9);
    hood.castShadow = true;
    r.add(hood);
    r.add(box(0.3, 3.2, 0.3, 0x938d9e, x, 8.6, -9.9, { metal: 0.68 }));
    const warm = new THREE.PointLight(0xffb066, 0.5, 12);
    warm.position.set(x, 4.4, -9.4);
    r.add(warm);
  }

  // spice shelf
  r.add(box(6.6, 0.22, 0.9, 0x6b4527, -3.3, 4.6, ROOM.minZ - 0.15));
  const jars = [0xd64550, 0xe8934a, 0x2f9e7e, 0xe8bd5e, 0x8d6ea8, 0x5d87a8, 0xd68fa8];
  for (let j = 0; j < 7; j++) {
    r.add(cyl(0.24, 0.24, 0.66, 12, jars[j], -6.1 + j * 0.95, 5.04, ROOM.minZ - 0.15, { rough: 0.42 }));
  }

  // ---- WASH-UP: the one and only plate station
  r.add(box(4.6, 1.75, 2, 0x6d7686, SINK.x, 0.88, -9.1, { metal: 0.4, rough: 0.42 }));
  r.add(box(3.6, 0.48, 1.35, 0xc3ccd6, SINK.x, 1.8, -9.1, { metal: 0.68, rough: 0.14 }));
  r.add(cyl(0.09, 0.09, 1.35, 10, 0xd0d7df, SINK.x, 2.56, -9.7, { metal: 0.94, rough: 0.1 }));
  r.add(box(0.5, 0.1, 0.55, 0xd0d7df, SINK.x, 3.18, -9.44, { metal: 0.94 }));
  sinkWater = new THREE.Mesh(new THREE.BoxGeometry(0.15, 1.15, 0.15),
    new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.6 }));
  sinkWater.position.set(SINK.x, 2.48, -9.44);
  sinkWater.visible = false;
  r.add(sinkWater);

  sinkGlow = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.75, 44),
    new THREE.MeshBasicMaterial({ color: 0x3fc39c, side: THREE.DoubleSide, transparent: true, opacity: 0.22 }));
  sinkGlow.rotation.x = -Math.PI / 2;
  sinkGlow.position.set(SINK.x, 0.05, SINK.z);
  r.add(sinkGlow);
  r.add(labelSprite("PLATES", "rgba(47,158,126,.94)", SINK.x, 4.0, -9.1, 2.4));

  // clean plates stack on the sink's drying board, dirty pile in the basin
  plateRack = new THREE.Group();
  plateRack.position.set(SINK.x - 1.55, 1.98, -8.6);
  r.add(plateRack);
  sinkPile = new THREE.Group();
  sinkPile.position.set(SINK.x + 0.6, 2.0, -9.1);
  r.add(sinkPile);

  // ---- pendants
  [[-5.1, 0.4], [5.1, 0.4], [-5.1, 5.4], [5.1, 5.4], [-5.1, 10.2], [5.1, 10.2]].forEach(([x, z], i) => {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.85, 0.92, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe8bd5e, side: THREE.DoubleSide, roughness: 0.38, metalness: 0.25 }));
    shade.position.set(x, 6.1, z);
    r.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 12), new THREE.MeshBasicMaterial({ color: 0xffeec6 }));
    bulb.position.set(x, 5.8, z);
    r.add(bulb);
    r.add(box(0.05, 2.8, 0.05, 0x3d2f22, x, 8, z, { cast: false }));
    if (i % 2 === 0) {
      const glow = new THREE.PointLight(0xffb877, 0.44, 14);
      glow.position.set(x, 5.3, z);
      r.add(glow);
    }
  });

  // ---- planters
  const plant = (x, z) => {
    r.add(cyl(0.6, 0.48, 1.05, 14, 0x9c5433, x, 0.52, z, { rough: 0.85 }));
    for (let i = 0; i < 8; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.6, 10, 8), M(i % 2 ? 0x357a42 : 0x2f6b3a, { rough: 0.92 }));
      leaf.position.set(x + Math.cos(i * 1.4) * 0.5, 1.5 + (i % 3) * 0.4, z + Math.sin(i * 1.4) * 0.5);
      leaf.scale.set(1, 0.7, 1);
      leaf.castShadow = true;
      r.add(leaf);
    }
  };
  plant(ROOM.minX + 1.2, ROOM.maxZ - 1.6);
  plant(ROOM.maxX - 1.2, ROOM.maxZ - 1.6);

  scene.add(r);
}

/** The plate stacks you can actually see. */
function updatePlateVisuals(k) {
  if (!plateRack || !sinkPile) return;
  const clean = Math.min(12, k.clean || 0);
  while (plateRack.children.length > clean) plateRack.remove(plateRack.children[plateRack.children.length - 1]);
  while (plateRack.children.length < clean) {
    const i = plateRack.children.length;
    plateRack.add(cyl(0.4, 0.38, 0.07, 18, 0xfdf8ef, (i % 3) * 0.85, Math.floor(i / 3) * 0.08, 0, { rough: 0.28 }));
  }
  const dirty = Math.min(10, k.washing || 0);
  while (sinkPile.children.length > dirty) sinkPile.remove(sinkPile.children[sinkPile.children.length - 1]);
  while (sinkPile.children.length < dirty) {
    const i = sinkPile.children.length;
    const p = cyl(0.38, 0.36, 0.07, 16, 0xcfc2ad, (i % 2) * 0.7 - 0.35, Math.floor(i / 2) * 0.085, 0, { rough: 0.7 });
    p.rotation.z = (i % 2 ? 1 : -1) * 0.09;
    sinkPile.add(p);
  }
  if (sinkWater) sinkWater.visible = dirty > 0;
  if (sinkGlow) sinkGlow.material.color.setHex(clean > 0 ? 0x3fc39c : dirty > 0 ? 0x5d9fd8 : 0xd64550);
}

function buildTables() {
  while (tableLayer.children.length) tableLayer.remove(tableLayer.children[0]);
  TABLES.forEach((t) => {
    if (t.kind === "booth") {
      // padded bench backs either side, long table between
      [-1, 1].forEach((s) => {
        tableLayer.add(box(3.5, 0.5, 1.0, 0x8a3f4c, t.x, 0.55, t.z + s * 1.75, { rough: 0.85 }));
        tableLayer.add(box(3.5, 1.7, 0.34, 0x9c4856, t.x, 1.3, t.z + s * 2.24, { rough: 0.85 }));
        for (let i = 0; i < 3; i++) {
          tableLayer.add(box(3.4, 0.14, 0.1, 0x7d3644, t.x, 1.0 + i * 0.42, t.z + s * 2.07, { cast: false }));
        }
      });
      tableLayer.add(box(3.1, 0.16, 2.1, 0x8a5a3b, t.x, 1.02, t.z, { rough: 0.5 }));
      tableLayer.add(box(3.15, 0.05, 2.15, 0xf6ead6, t.x, 1.12, t.z, { rough: 0.8 }));
      tableLayer.add(box(0.3, 1, 0.9, 0x6b4527, t.x, 0.5, t.z, { cast: false }));
      tableLayer.add(cyl(0.1, 0.14, 0.28, 10, 0x8fbcd4, t.x - 1.1, 1.28, t.z, { rough: 0.3 }));
      tableLayer.add(box(0.3, 0.34, 0.18, 0xe8bd5e, t.x + 1.15, 1.3, t.z, { rough: 0.5 }));
    } else if (t.kind === "stool") {
      tableLayer.add(cyl(0.2, 0.28, 1.0, 12, 0x6b4527, t.x, 0.5, t.z));
      tableLayer.add(cyl(0.78, 0.78, 0.13, 22, 0x8a5a3b, t.x, 1.05, t.z, { rough: 0.5 }));
      tableLayer.add(cyl(0.82, 0.82, 0.04, 22, 0xf6ead6, t.x, 1.13, t.z, { rough: 0.8 }));
      tableLayer.add(cyl(0.42, 0.42, 0.16, 16, 0x9c4856, t.x, 0.86, t.z - 1.45, { rough: 0.85 }));
      tableLayer.add(cyl(0.1, 0.1, 0.8, 10, 0x5b5560, t.x, 0.4, t.z - 1.45, { metal: 0.6, cast: false }));
    } else {
      tableLayer.add(cyl(0.22, 0.32, 1.0, 14, 0x6b4527, t.x, 0.5, t.z));
      tableLayer.add(cyl(0.9, 0.9, 0.12, 22, 0x5b3a20, t.x, 0.07, t.z, { cast: false }));
      tableLayer.add(cyl(1.25, 1.25, 0.15, 26, 0x8a5a3b, t.x, 1.03, t.z, { rough: 0.5 }));
      const cloth = new THREE.Mesh(new THREE.CylinderGeometry(1.32, 1.48, 0.4, 26, 1, true),
        new THREE.MeshStandardMaterial({ color: 0xf6ead6, side: THREE.DoubleSide, roughness: 0.9 }));
      cloth.position.set(t.x, 0.92, t.z); cloth.receiveShadow = true;
      tableLayer.add(cloth);
      tableLayer.add(cyl(1.32, 1.32, 0.05, 26, 0xfdf6e6, t.x, 1.12, t.z, { rough: 0.85 }));
      tableLayer.add(cyl(0.1, 0.14, 0.28, 10, 0x8fbcd4, t.x, 1.28, t.z, { rough: 0.3 }));
      const bud = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 10), M(0xd66a86, { rough: 0.8 }));
      bud.position.set(t.x, 1.5, t.z);
      tableLayer.add(bud);
      [-1, 1].forEach((s) => {
        const cz = t.z + s * 1.95;
        tableLayer.add(box(0.95, 0.14, 0.95, 0x8a5a3b, t.x, 0.78, cz));
        tableLayer.add(box(0.95, 1.05, 0.14, 0x9c4856, t.x, 1.32, cz + s * 0.44));
        [-0.38, 0.38].forEach((ox) => {
          tableLayer.add(cyl(0.06, 0.06, 0.78, 8, 0x6b4527, t.x + ox, 0.39, cz - s * 0.32, { cast: false }));
        });
      });
    }

    const c = document.createElement("canvas");
    c.width = c.height = 72;
    const g = c.getContext("2d");
    g.fillStyle = "#fffaf0"; g.fillRect(0, 0, 72, 72);
    g.strokeStyle = "#27554b"; g.lineWidth = 5; g.strokeRect(4, 4, 64, 64);
    g.fillStyle = "#171119"; g.font = "bold 42px system-ui";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(t.i + 1), 36, 39);
    const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    card.scale.set(0.58, 0.58, 1);
    card.position.set(t.x + (t.kind === "booth" ? 1.75 : 1.0), 1.46, t.z + 0.5);
    tableLayer.add(card);
  });
}

function seatPos(table, slot) {
  const t = TABLES[table] || { x: 0, z: 0, kind: "table" };
  const offs = OFFSETS[t.kind] || OFFSETS.table || [{ x: 0, z: -1.5 }];
  const o = offs[slot % offs.length];
  return { x: t.x + o.x, z: t.z + o.z };
}

function bubbleTex(emoji, badge) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.beginPath(); g.arc(64, 56, 48, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,253,247,.98)"; g.fill();
  g.beginPath(); g.moveTo(53, 96); g.lineTo(64, 120); g.lineTo(78, 96); g.fill();
  g.font = "58px system-ui,'Apple Color Emoji','Segoe UI Emoji'";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(emoji, 64, 58);
  if (badge) { g.font = "34px system-ui,'Apple Color Emoji','Segoe UI Emoji'"; g.fillText(badge, 26, 26); }
  return new THREE.CanvasTexture(c);
}

function makeGuest(c) {
  const g = new THREE.Group();
  const hue = ((c.id * 67) % 360) / 360;
  const shirt = new THREE.Color().setHSL(hue, 0.48, 0.5);
  const child = c.slot >= 2;                       // kids sit on the far side of a booth
  const sc = child ? 0.78 : 1;
  g.add(cyl(0.42 * sc, 0.55 * sc, 1.2 * sc, 18, shirt, 0, 1.4 * sc, 0, { rough: 0.82 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4 * sc, 22, 22), M(0xecc09a, { rough: 0.9 }));
  head.position.y = 2.32 * sc; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.42 * sc, 22, 16, 0, Math.PI * 2, 0, Math.PI * (c.id % 2 ? 0.55 : 0.78)),
    M([0x35251c, 0x6b4423, 0x1f1a18, 0xa9773f][c.id % 4], { rough: 1 })
  );
  hair.position.y = 2.36 * sc; g.add(hair);

  const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex(c.emoji, c.badge), transparent: true, depthTest: false }));
  b.scale.set(1.75, 1.75, 1);
  b.position.set(0, 3.7 * sc, 0);
  g.add(b); g.userData.bubble = b;

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.72, 0.98, 32),
    new THREE.MeshBasicMaterial({ color: 0x3fc39c, side: THREE.DoubleSide, transparent: true, opacity: 0.92 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07;
  g.add(ring); g.userData.ring = ring;

  const p = seatPos(c.table, c.slot);
  g.position.set(p.x, 0, p.z);
  const t = TABLES[c.table];
  if (t) g.rotation.y = Math.atan2(t.x - p.x, t.z - p.z);
  g.userData.cid = c.id;
  g.userData.home = p;
  return g;
}

function makeChef(isMe, gender, isHelper) {
  const g = new THREE.Group();
  const coat = isHelper ? 0xe8e2ee : (isMe ? 0xfffaf2 : 0xd6cfdd);
  const trim = isHelper ? 0x8d6ea8 : (isMe ? 0x2f9e7e : 0x7a6b84);
  g.add(cyl(0.43, 0.55, 1.3, 18, coat, 0, 1.5, 0, { rough: 0.72 }));
  g.add(cyl(0.46, 0.58, 0.72, 18, trim, 0, 1.1, 0, { rough: 0.8 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.39, 22, 22), M(0xf0c49c, { rough: 0.9 }));
  head.position.y = 2.4; head.castShadow = true; g.add(head);

  if (gender === "female") {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.25, 16, 16), M(0x4a2f1d, { rough: 1 }));
    bun.position.set(0, 2.48, -0.35); g.add(bun);
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62), M(0x4a2f1d, { rough: 1 }));
    hair.position.y = 2.44; g.add(hair);
    g.add(cyl(0.35, 0.29, 0.5, 16, 0xfffdf8, 0, 2.9, 0, { rough: 0.7 }));
  } else {
    const hair = new THREE.Mesh(new THREE.SphereGeometry(0.41, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.5), M(0x2b1d13, { rough: 1 }));
    hair.position.y = 2.44; g.add(hair);
    g.add(cyl(0.41, 0.33, 0.62, 18, 0xfffdf8, 0, 3.0, 0, { rough: 0.7 }));
  }

  const arms = new THREE.Group();
  [-1, 1].forEach((s) => arms.add(cyl(0.12, 0.12, 0.92, 10, coat, s * 0.54, 1.55, 0.1)));
  g.add(arms); g.userData.arms = arms;

  // what you're carrying: plated food out front, clean plates and dirties beside
  const held = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  held.scale.set(1.2, 0.68, 1); held.position.set(0, 2.06, 0.95); held.visible = false;
  g.add(held); g.userData.held = held;

  const stack = new THREE.Group();
  stack.position.set(-0.68, 1.72, 0.5);
  g.add(stack); g.userData.stack = stack;

  const dirty = new THREE.Group();
  dirty.position.set(0.68, 1.72, 0.5);
  g.add(dirty); g.userData.dirtyStack = dirty;

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.82, 28),
    new THREE.MeshBasicMaterial({ color: trim, side: THREE.DoubleSide, transparent: true, opacity: 0.82 }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
  g.add(ring);

  if (isHelper) g.add(labelSprite("SERVER", "rgba(141,110,168,.94)", 0, 3.6, 0, 1.5));
  return g;
}

const texCache = new Map();
function emojiStrip(list) {
  const k = list.join("");
  if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement("canvas");
  c.width = 128; c.height = 72;
  const g = c.getContext("2d");
  g.font = "40px system-ui,'Apple Color Emoji','Segoe UI Emoji'";
  g.textAlign = "center"; g.textBaseline = "middle";
  const n = Math.min(3, list.length);
  list.slice(0, 3).forEach((e, i) => g.fillText(e, 64 + (i - (n - 1) / 2) * 36, 38));
  const t = new THREE.CanvasTexture(c);
  texCache.set(k, t);
  return t;
}

function stackPlates(group, n, colour) {
  const want = Math.min(4, n);
  while (group.children.length > want) group.remove(group.children[group.children.length - 1]);
  while (group.children.length < want) {
    const i = group.children.length;
    group.add(cyl(0.26, 0.25, 0.06, 14, colour, 0, i * 0.075, 0, { rough: colour === 0xfdf8ef ? 0.3 : 0.72, cast: false }));
  }
}

function makeDirtyPlate(d) {
  const g = new THREE.Group();
  g.add(cyl(0.42, 0.38, 0.09, 20, 0xf1e7d6, 0, 0, 0, { rough: 0.42 }));
  g.add(cyl(0.28, 0.28, 0.03, 16, 0xa07a4c, 0, 0.06, 0, { rough: 0.92 }));
  const p = seatPos(d.table, d.slot);
  const t = TABLES[d.table] || { x: 0, z: 0 };
  g.position.set((p.x + t.x) / 2, 1.28, (p.z + t.z) / 2);
  g.userData.table = d.table;
  const halo = new THREE.Mesh(new THREE.RingGeometry(0.58, 0.8, 24),
    new THREE.MeshBasicMaterial({ color: 0x5d9fd8, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
  halo.rotation.x = -Math.PI / 2; halo.position.y = -0.11;
  g.add(halo); g.userData.halo = halo;
  return g;
}

/* --------------------------------------------------------------- syncing */

function syncWorld(snap) {
  const alive = new Set();
  snap.customers.forEach((c) => {
    alive.add(c.id);
    let g = S.guests.get(c.id);
    if (!g) { g = makeGuest(c); guestLayer.add(g); S.guests.set(c.id, g); }
    g.userData.state = c.state;
    g.userData.mood = c.mood;
    const ring = g.userData.ring;
    if (c.state === "waiting") {
      ring.visible = true;
      ring.material.color.setHex(c.mood > 0.5 ? 0x3fc39c : c.mood > 0.25 ? 0xe8bd5e : 0xd64550);
      ring.scale.setScalar(Math.max(0.1, c.mood));
      g.userData.bubble.visible = true;
    } else {
      ring.visible = false;
      g.userData.bubble.visible = false;
    }
  });
  S.guests.forEach((g, id) => { if (!alive.has(id)) { guestLayer.remove(g); S.guests.delete(id); } });

  const live = new Set();
  snap.dirty.forEach((d) => {
    live.add(d.id);
    if (!S.plates.has(d.id)) {
      const p = makeDirtyPlate(d);
      plateLayer.add(p); S.plates.set(d.id, p);
    }
  });
  S.plates.forEach((p, id) => { if (!live.has(id)) { plateLayer.remove(p); S.plates.delete(id); } });

  const liveChefs = new Set();
  Object.keys(snap.stations).forEach((sid) => {
    liveChefs.add(sid);
    const st = snap.stations[sid];
    let c = S.chefs.get(sid);
    if (!c) { c = makeChef(sid === S.me, st.gender, st.isHelper); chefLayer.add(c); S.chefs.set(sid, c); }
    if (sid === S.me) {
      const d = Math.hypot(S.local.x - st.x, S.local.z - st.z);
      if (d > 3.2) { S.local.x = st.x; S.local.z = st.z; }
    } else { c.userData.tx = st.x; c.userData.tz = st.z; }

    const held = c.userData.held;
    if (st.tray.length) {
      held.visible = true;
      held.material.map = emojiStrip(st.tray.map((d) => snap.dishes[d].emoji));
      held.material.needsUpdate = true;
    } else held.visible = false;
    stackPlates(c.userData.stack, st.plates, 0xfdf8ef);
    stackPlates(c.userData.dirtyStack, st.dirty, 0xcfc2ad);
  });
  S.chefs.forEach((c, sid) => { if (!liveChefs.has(sid)) { chefLayer.remove(c); S.chefs.delete(sid); } });

  updatePlateVisuals(myKitchen());
}

function clearWorld() {
  S.guests.forEach((g) => guestLayer.remove(g)); S.guests.clear();
  S.chefs.forEach((c) => chefLayer.remove(c)); S.chefs.clear();
  S.plates.forEach((p) => plateLayer.remove(p)); S.plates.clear();
}

function onTapWorld(e) {
  if (!S.snap || S.snap.over || S.snap.paused) return;
  if (e.clientY > innerHeight - 196) return;         // the control deck
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, camera);

  const pHit = ray.intersectObjects(plateLayer.children, true);
  if (pHit.length) {
    let o = pHit[0].object;
    while (o && o.userData.table === undefined) o = o.parent;
    if (o) { S.socket.emit("bus", { table: o.userData.table }); return; }
  }
  const gHit = ray.intersectObjects(guestLayer.children, true);
  if (gHit.length) {
    let o = gHit[0].object;
    while (o && o.userData.cid === undefined) o = o.parent;
    if (o && o.userData.state === "waiting") doServe(o.userData.cid, e.clientX, e.clientY);
  }
}

/* ------------------------------------------------------------------ loop */

let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  const playing = S.snap && !S.snap.over && $("match").classList.contains("on");
  const frozen = playing && S.snap.paused;

  if (playing && !frozen) {
    const st = S.snap.stations[S.me];
    const speed = 6.4 * (st ? st.moveScale || 1 : 1);
    if (Math.hypot(S.vel.x, S.vel.z) > 0.03) {
      const p = resolveCollision(S.local.x + S.vel.x * speed * dt, S.local.z + S.vel.z * speed * dt);
      S.local.x = p.x; S.local.z = p.z;
    }
    if (now - S.lastSent > 110) {
      S.socket.emit("move", { x: S.local.x, z: S.local.z, dt: (now - S.lastSent) / 1000 });
      S.lastSent = now;
    }
  }

  S.chefs.forEach((c, sid) => {
    let moving = false;
    if (sid === S.me) {
      c.position.x = S.local.x; c.position.z = S.local.z;
      moving = !frozen && Math.hypot(S.vel.x, S.vel.z) > 0.05;
      if (moving) c.rotation.y = Math.atan2(S.vel.x, S.vel.z);
    } else {
      const dx = (c.userData.tx || 0) - c.position.x;
      const dz = (c.userData.tz || 0) - c.position.z;
      moving = Math.hypot(dx, dz) > 0.08;
      if (moving) c.rotation.y = Math.atan2(dx, dz);
      c.position.x += dx * 0.2; c.position.z += dz * 0.2;
    }
    c.position.y = moving ? Math.abs(Math.sin(now * 0.015)) * 0.11 : 0;
    if (c.userData.arms) {
      c.userData.arms.rotation.x = moving ? Math.sin(now * 0.015) * 0.55 : 0;
      c.userData.arms.rotation.z = moving ? 0 : Math.sin(now * 0.002) * 0.05;
    }
  });

  rangeRing.visible = !!playing;
  if (playing) rangeRing.position.set(S.local.x, 0.05, S.local.z);

  S.guests.forEach((g) => {
    if (frozen) return;
    const s = g.userData.state, mood = g.userData.mood || 1;
    if (s === "waiting") {
      const urgency = 1 + (1 - mood) * 4;
      g.position.y = Math.sin(now * 0.004 * urgency + g.userData.cid) * 0.05;
      if (mood < 0.3) {                                   // drumming fingers
        g.position.x = g.userData.home.x + Math.sin(now * 0.03 + g.userData.cid) * 0.05;
      }
      if (g.userData.bubble) g.userData.bubble.position.y = (g.userData.bubble.position.y * 0.9) + (3.7 + Math.sin(now * 0.003) * 0.09) * 0.1;
    } else if (s === "eating") {
      g.position.y = Math.abs(Math.sin(now * 0.022)) * 0.05;
      g.rotation.z = Math.sin(now * 0.02) * 0.03;
    } else if (s === "done") {
      g.position.y = Math.abs(Math.sin(now * 0.011)) * 0.32;
      g.rotation.y += 0.02;
    } else {
      g.position.y -= 0.04;
      g.rotation.y += 0.09;
      g.position.z += 0.05;
    }
  });

  if (!frozen) {
    S.plates.forEach((p) => {
      p.position.y = 1.28 + Math.sin(now * 0.004 + p.userData.table) * 0.045;
      p.rotation.y += 0.011;
      if (p.userData.halo) p.userData.halo.material.opacity = 0.55 + Math.sin(now * 0.006) * 0.32;
    });
    if (sinkGlow) sinkGlow.material.opacity = 0.16 + Math.sin(now * 0.004) * 0.09;
    if (sinkWater) sinkWater.scale.y = 1 + Math.sin(now * 0.03) * 0.12;
  }

  // camera holds the whole room; only a hair of drift so it feels alive
  const home = camera.userData.home;
  if (home) {
    const lx = playing ? clamp(S.local.x * 0.06, -1.0, 1.0) : 0;
    const lz = playing ? clamp(S.local.z * 0.04, -0.8, 0.8) : 0;
    camera.position.x += (home.x + lx - camera.position.x) * 0.05;
    camera.position.z += (home.z + lz - camera.position.z) * 0.05;
    camera.lookAt(home.cx + lx * 0.5, 1.2, home.cz - 0.4 + lz * 0.5);
  }

  renderer.render(scene, camera);
}

/* ============================================================== joystick */

function initStick() {
  const pad = $("pad"), knob = $("knob");
  const R = 30;
  let id = null;

  const setFrom = (cx, cy) => {
    const r = pad.getBoundingClientRect();
    let dx = cx - (r.left + r.width / 2);
    let dy = cy - (r.top + r.height / 2);
    const d = Math.hypot(dx, dy);
    const max = r.width / 2 - 8;
    if (d > max) { dx = (dx / d) * max; dy = (dy / d) * max; }
    knob.style.transform = `translate(${dx}px,${dy}px)`;
    S.vel.x = clamp(dx / max, -1, 1);
    S.vel.z = clamp(dy / max, -1, 1);
  };
  const release = () => {
    id = null;
    knob.style.transform = "translate(0px,0px)";
    S.vel.x = 0; S.vel.z = 0;
  };

  pad.addEventListener("touchstart", (e) => {
    e.preventDefault();
    const t = e.changedTouches[0];
    id = t.identifier;
    setFrom(t.clientX, t.clientY);
  }, { passive: false });
  addEventListener("touchmove", (e) => {
    if (id === null) return;
    for (const t of e.changedTouches) if (t.identifier === id) { e.preventDefault(); setFrom(t.clientX, t.clientY); }
  }, { passive: false });
  const end = (e) => {
    if (id === null) return;
    for (const t of e.changedTouches) if (t.identifier === id) release();
  };
  addEventListener("touchend", end);
  addEventListener("touchcancel", end);

  // mouse for desktop
  let down = false;
  pad.addEventListener("mousedown", (e) => { down = true; setFrom(e.clientX, e.clientY); });
  addEventListener("mousemove", (e) => { if (down) setFrom(e.clientX, e.clientY); });
  addEventListener("mouseup", () => { if (down) { down = false; release(); } });

  const keys = {};
  const upd = () => {
    S.vel.x = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    S.vel.z = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  };
  addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; upd(); });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; upd(); });
}

/* ================================================================= match */

let lastAct = 0;
function doServe(cid, x, y) {
  const now = performance.now();
  if (now - lastAct < 110) return;
  lastAct = now;
  S._tap = { x, y };
  S.socket.emit("serve", { customer: cid });
}

const myStation = () => (S.snap && S.snap.stations[S.me]) ||
  { tray: [], cooking: [], trayCap: 3, plateCap: 3, cookSlots: 1, plates: 0, dirty: 0, x: 0, z: 0 };
const myKitchen = () => {
  if (!S.snap) return { clean: 0, max: 0, washing: 0 };
  if (S.snap.mode === "versus") return S.snap.kitchens[S.me] || { clean: 0, max: 0, washing: 0 };
  return S.snap.kitchens[Object.keys(S.snap.kitchens)[0]] || { clean: 0, max: 0, washing: 0 };
};
const nearTable = (i) => {
  const t = TABLES[i];
  return t && Math.hypot(S.local.x - t.x, S.local.z - t.z) <= RANGE;
};

function renderTickets() {
  const wrap = $("tickets"), snap = S.snap, st = myStation();
  const mine = snap.customers
    .filter((c) => c.state === "waiting" && (snap.mode !== "versus" || !c.owner || c.owner === S.me))
    .sort((a, b) => a.patience - b.patience);
  wrap.innerHTML = "";
  mine.forEach((c) => {
    const have = st.tray.includes(c.dish);
    const near = nearTable(c.table);
    const el = document.createElement("div");
    el.className = "tk" + (have && near ? " near" : have ? " have" : "");
    const col = c.mood > 0.5 ? "#2f9e7e" : c.mood > 0.25 ? "#e8bd5e" : "#d64550";
    el.innerHTML = (c.badge ? `<div class="bdg">${c.badge}</div>` : "") +
      `<div class="sn">T${c.table + 1}</div><div class="dg">${c.emoji}</div>` +
      `<div class="bar"><div class="fill" style="width:${Math.round(c.mood * 100)}%;background:${col}"></div></div>`;
    el.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const r = el.getBoundingClientRect();
      doServe(c.id, r.left, r.top);
    });
    wrap.appendChild(el);
  });
}

function renderBar() {
  const snap = S.snap, st = myStation(), k = myKitchen();

  const stoves = $("stoves");
  if (stoves.children.length !== st.cookSlots) {
    stoves.innerHTML = "";
    for (let i = 0; i < st.cookSlots; i++) {
      const d = document.createElement("div");
      d.className = "job idle";
      d.innerHTML = `<div class="jf"></div><div class="jt">–</div>`;
      stoves.appendChild(d);
    }
  }
  for (let i = 0; i < st.cookSlots; i++) {
    const el = stoves.children[i], job = st.cooking[i];
    if (job) {
      el.classList.remove("idle");
      el.querySelector(".jf").style.width = Math.round(job.progress * 100) + "%";
      el.querySelector(".jt").innerHTML = `<span style="font-size:16px">${job.emoji}</span>${job.remaining.toFixed(1)}`;
    } else {
      el.classList.add("idle");
      el.querySelector(".jf").style.width = "0%";
      el.querySelector(".jt").textContent = "–";
    }
  }

  const pass = $("pass");
  if (pass.children.length !== st.trayCap) {
    pass.innerHTML = "";
    for (let i = 0; i < st.trayCap; i++) {
      const d = document.createElement("div");
      d.className = "slot"; d.dataset.i = i;
      d.addEventListener("click", () => {
        const s = S.snap && S.snap.stations[S.me];
        if (s && s.tray[+d.dataset.i]) S.socket.emit("toss", { index: +d.dataset.i });
      });
      pass.appendChild(d);
    }
  }
  for (let i = 0; i < st.trayCap; i++) {
    const el = pass.children[i], dish = st.tray[i];
    el.classList.toggle("full", !!dish);
    el.textContent = dish ? snap.dishes[dish].emoji : "";
  }

  const menu = $("menu");
  const sig = snap.menu.join(",");
  if (menu.dataset.sig !== sig) {
    menu.dataset.sig = sig;
    menu.innerHTML = "";
    snap.menu.forEach((id) => {
      const d = snap.dishes[id];
      const b = document.createElement("button");
      b.className = "dish"; b.dataset.dish = id;
      b.innerHTML = `<div class="e">${d.emoji}</div><div class="n">${d.name}</div><div class="t">${d.cookTime}s</div>`;
      b.addEventListener("click", () => S.socket.emit("cook", { dish: id }));
      menu.appendChild(b);
    });
  }
  const wanted = new Set(snap.customers
    .filter((c) => c.state === "waiting" && (snap.mode !== "versus" || !c.owner || c.owner === S.me))
    .map((c) => c.dish));
  const blocked = st.plates <= 0 || st.cooking.length >= st.cookSlots ||
    st.tray.length + st.cooking.length >= st.trayCap || snap.over || snap.paused;
  menu.querySelectorAll(".dish").forEach((b) => {
    b.disabled = blocked;
    b.classList.toggle("want", wanted.has(b.dataset.dish) && !st.tray.includes(b.dataset.dish));
  });

  $("handCount").textContent = st.plates + (st.dirty ? " · " + st.dirty + "🫧" : "");
  $("hands").classList.toggle("empty", st.plates <= 0);
}

function renderHud() {
  const snap = S.snap;
  const clk = $("clock");
  clk.textContent = snap.timeRemaining;
  clk.classList.toggle("low", snap.timeRemaining <= 15);
  $("venue").querySelector(".nm").textContent = `${snap.venue.emoji} ${snap.venue.name}`;
  $("venue").querySelector(".st").textContent = `LVL ${snap.level} · ${snap.served}/${snap.totalCustomers}`;

  const pips = $("venue").querySelector(".pips");
  if (pips.children.length !== snap.maxWalkouts) {
    pips.innerHTML = "";
    for (let i = 0; i < snap.maxWalkouts; i++) {
      const d = document.createElement("div"); d.className = "pip"; pips.appendChild(d);
    }
  }
  for (let i = 0; i < snap.maxWalkouts; i++) pips.children[i].classList.toggle("gone", i < snap.walkouts);

  const mine = snap.scores[S.me] || 0;
  const shown = snap.mode === "versus" ? mine : Object.values(snap.scores).reduce((a, b) => a + b, 0);
  $("score").querySelector(".v").textContent = shown;
  $("score").querySelector(".l").textContent = snap.mode === "versus" ? "you" : "team";
  $("score").querySelector(".tp").textContent = "$" + (snap.tips[S.me] || 0);

  const col = $("leftcol");
  [...col.querySelectorAll(".sb")].forEach((n) => n.remove());
  const ids = Object.keys(snap.scores);
  if (ids.length > 1) {
    ids.sort((a, b) => snap.scores[b] - snap.scores[a]).forEach((id) => {
      const row = document.createElement("div");
      row.className = "sb glass" + (id === S.me ? " me" : "");
      const combo = snap.combos[id] > 1 ? ` 🔥${snap.combos[id]}` : "";
      row.innerHTML = `<span class="n">${esc(S.names[id] || "Cook")}</span><span>${snap.scores[id]}${combo}</span>`;
      col.appendChild(row);
    });
  }

  $("rushFlag").classList.toggle("on", !!snap.inRush);
  const ov = $("pausedOverlay");
  ov.classList.toggle("on", !!snap.paused);
  if (snap.paused) {
    $("pausedBy").textContent = snap.pausedBy === S.me
      ? "You paused the shift" : `${esc(S.names[snap.pausedBy] || "Someone")} paused the shift`;
  }
  $("pauseBtn").classList.toggle("hot", !!snap.paused);
}

function handleEvents(evts) {
  evts.forEach((e) => {
    if (e.type === "served") {
      if (e.playerId === S.me && !e.byHelper) {
        const t = S._tap;
        pop(`+${e.points}`, null, t && t.x, t && t.y);
        if (e.tip) pop(`$${e.tip}`, "tip", (t ? t.x : innerWidth / 2) + 44, (t ? t.y : innerHeight / 2) + 18);
        if (e.partyComplete) { pop("TABLE CLEAR!", "party", innerWidth / 2 - 60, innerHeight * 0.3); toast("🎉 Whole table served — bonus!"); }
        else if (e.combo > 1 && e.combo % 3 === 0) toast(`🔥 ${e.combo} in a row!`);
      } else if (e.byHelper && e.playerId === S.me) {
        pop(`+${e.points}`, null, innerWidth * 0.28, innerHeight * 0.32);
      } else pop(`+${e.points}`);
    } else if (e.type === "walked_out") {
      pop("walked out!", "bad");
      const left = e.limit - e.walkouts;
      if (left > 0) toast(`😠 ${left} more walkout${left > 1 ? "s" : ""} ends the shift`);
    } else if (e.type === "party_arrived" && e.size > 1) {
      toast(`👨‍👩‍👧 Party of ${e.size} at table ${e.table + 1}`);
    } else if (e.type === "took_plates") {
      if (e.playerId === S.me && !S.snap.stations[S.me].isHelper) pop(`+${e.count} 🍽️`, "tip", innerWidth * 0.5, innerHeight * 0.36);
    } else if (e.type === "burned" && e.playerId === S.me) {
      toast("Pass was full — that one's binned");
    } else if (e.type === "rush_start") {
      toast("🔥 RUSH HOUR — brace yourself");
    } else if (e.type === "rush_end") {
      toast("😮‍💨 Rush over");
    } else if (e.type === "paused") {
      toast(`⏸ ${e.playerId === S.me ? "You" : esc(e.name || "Someone")} paused`);
    } else if (e.type === "resumed") {
      toast("▶ Back to it");
    }
  });
}

/* ================================================================= menus */

function renderProfile(p) {
  S.profile = p;
  S.gender = p.gender || "male";
  $("gMale").classList.toggle("on", S.gender === "male");
  $("gFemale").classList.toggle("on", S.gender === "female");
  $("homeWallet").textContent = `💰 $${p.wallet}`;
  $("shopWallet").textContent = `💰 $${p.wallet}`;
  $("lvlCap").textContent = `(unlocked: 1–${p.best})`;
  $("lvl").max = p.best;

  const grid = $("shopGrid");
  grid.innerHTML = "";
  p.shop.forEach((u) => {
    const el = document.createElement("div");
    el.className = "up" + (u.hire ? " hire" : "") + (u.locked ? " locked" : "");
    const dots = Array.from({ length: u.max }, (_, i) => `<div class="dot${i < u.level ? " f" : ""}"></div>`).join("");
    let btn;
    if (u.cost === null) btn = `<button class="max">${u.hire ? "HIRED" : "MAX"}</button>`;
    else if (u.locked) btn = `<button class="no">LOCKED</button>`;
    else btn = `<button class="${p.wallet >= u.cost ? "" : "no"}" data-key="${u.key}">$${u.cost}</button>`;
    el.innerHTML = `<div class="ue">${u.emoji}</div><div class="ub"><div class="un">${u.name}</div>` +
      `<div class="ud">${esc(u.blurb)}</div><div class="dots">${dots}</div></div>` + btn;
    const b = el.querySelector("button[data-key]");
    if (b) b.addEventListener("click", () => S.socket.emit("buy", { key: u.key }));
    grid.appendChild(el);
  });
}

function renderLobby(d) {
  S.room = d.code; S.isHost = d.youAreHost;
  $("lobbyCode").textContent = d.code;
  $("lobbyMode").textContent = (d.mode === "versus" ? "⚔️ Versus" : "🤝 Co-op") + ` · Level ${d.level}`;
  $("crewCount").textContent = `(${d.players.length}/4)`;
  const crew = $("crew"); crew.innerHTML = "";
  d.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "row";
    const host = p.id === d.hostId;
    row.innerHTML = `<span style="font-size:20px">${host ? "👑" : "👤"}</span>` +
      `<span class="who">${esc(p.name)}${p.id === S.me ? " (you)" : ""}</span>` +
      `<span class="pill${host ? " gold" : ""}">💰${p.wallet}</span>`;
    crew.appendChild(row);
  });
  $("hostBox").style.display = d.youAreHost ? "block" : "none";
  $("waitNote").style.display = d.youAreHost ? "none" : "block";
}

function renderRooms(list) {
  const box = $("roomList");
  if (!list.length) { box.innerHTML = '<div class="empty">No open kitchens.<br>Open your own!</div>'; return; }
  box.innerHTML = "";
  list.forEach((r) => {
    const el = document.createElement("div");
    el.className = "roomcard";
    el.innerHTML = `<div style="flex:1"><div class="code">${r.code}</div>` +
      `<div class="meta">${r.mode === "versus" ? "⚔️" : "🤝"} Lv ${r.level} · ${r.players}/${r.maxPlayers} · ${esc(r.host)}</div></div><button>Join</button>`;
    el.querySelector("button").addEventListener("click", () => S.socket.emit("join_room", { code: r.code }));
    box.appendChild(el);
  });
}

function showResults(d) {
  S.endPayload = d;
  const r = d.results;
  $("overStars").textContent = "★".repeat(r.stars) + "☆".repeat(3 - r.stars);
  $("overServed").textContent = `${r.served}/${r.totalCustomers}`;
  $("overWalk").textContent = `${r.walkouts}/${r.maxWalkouts}`;
  $("overCombo").textContent = (r.bestCombo && r.bestCombo[S.me]) || 0;
  $("overTips").textContent = `💰 +$${r.tips[S.me] || 0} tips`;

  const fail = $("overFail");
  if (!r.passed) {
    fail.style.display = "block";
    fail.textContent = r.failReason === "walkouts"
      ? `${r.walkouts} customers walked out — that's the limit. Level ${r.level} stays locked.`
      : `You served ${r.accuracy}% — you need ${r.required}% to move on.`;
  } else fail.style.display = "none";

  if (r.mode === "versus") {
    $("overTitle").textContent = r.winner === S.me ? "🏆 You won!" : `${esc(d.names[r.winner] || "Rival")} wins`;
    $("overScore").textContent = r.scores[S.me] || 0;
  } else {
    $("overTitle").textContent = r.passed ? "Shift complete!" : "Shift failed";
    $("overScore").textContent = r.teamScore;
  }

  const ids = Object.keys(r.scores);
  if (ids.length > 1) {
    $("overBoard").style.display = "block";
    const rows = $("overRows"); rows.innerHTML = "";
    ids.sort((a, b) => r.scores[b] - r.scores[a]).forEach((id, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span style="font-size:16px">${["🥇", "🥈", "🥉", "4️⃣"][i] || "•"}</span>` +
        `<span class="who">${esc(d.names[id] || "Cook")}${id === S.me ? " (you)" : ""}</span>` +
        `<span class="pill">${r.scores[id]}</span>`;
      rows.appendChild(row);
    });
  } else $("overBoard").style.display = "none";

  $("nextBtn").textContent = d.repeat ? "↻ Retry Level " + d.nextLevel : "▶ Next Level " + d.nextLevel;
  $("overHost").style.display = S.isHost ? "block" : "none";
  $("overWait").style.display = S.isHost ? "none" : "block";
  screen("over");
}

/* ================================================================ socket */

function connect() {
  S.socket = io({ transports: ["websocket", "polling"] });

  S.socket.on("connect", () => {
    $("boot").classList.add("off");
    S.socket.emit("hello", { name: S.name, pkey: S.pkey, gender: S.gender });
  });
  S.socket.on("connect_error", () => { $("boot").classList.remove("off"); $("bootTxt").textContent = "Reconnecting…"; });
  S.socket.on("disconnect", () => { $("boot").classList.remove("off"); $("bootTxt").textContent = "Connection lost…"; });

  S.socket.on("welcome", (d) => { S.me = d.id; });
  S.socket.on("profile", renderProfile);
  S.socket.on("rooms", renderRooms);

  S.socket.on("lobby", (d) => {
    renderLobby(d);
    if (!$("match").classList.contains("on") && !$("over").classList.contains("on") && !$("shop").classList.contains("on")) {
      screen("lobby");
    }
  });

  S.socket.on("match_start", (d) => {
    S.names = d.names;
    S.snap = d.snapshot;
    TABLES = d.snapshot.tables;
    OFFSETS = d.snapshot.seatOffsets;
    OBST = d.snapshot.obstacles;
    FLOOR = d.snapshot.floor;
    ROOM = d.snapshot.room || ROOM;
    KZ = d.snapshot.kitchenZ;
    RANGE = d.snapshot.serveRange;
    SINK = d.snapshot.sink;
    BODY_R = d.snapshot.bodyRadius || 0.62;
    buildTables();
    clearWorld();
    S.local = { x: -1.6, z: KZ - 1.2, slide: 0 };
    S.vel = { x: 0, z: 0 };
    frameRoom();
    syncWorld(d.snapshot); renderHud(); renderTickets(); renderBar();
    screen("match");
  });

  S.socket.on("state", (d) => {
    S.snap = d.snapshot;
    syncWorld(d.snapshot); renderHud(); renderTickets(); renderBar();
    if (d.events && d.events.length) handleEvents(d.events);
  });

  S.socket.on("match_end", (d) => setTimeout(() => showResults(d), 650));
  S.socket.on("bought", () => toast("✅ Upgrade fitted"));

  S.socket.on("nope", (r) => {
    if (r.reason === "need_dish") {
      const d = S.snap && S.snap.dishes[r.need];
      toast(d ? `They want ${d.emoji} ${d.name}` : "You're not holding that");
    } else if (r.reason === "no_plate_in_hand") toast("🍽️ No clean plate — get some from the wash-up");
    else if (r.reason === "none_clean") toast("🫧 None washed yet — clear some tables");
    else if (r.reason === "too_far") toast("🚶 Walk over to that table");
    else if (r.reason === "too_far_from_stove") toast("🔥 Get back behind the pass");
    else if (r.reason === "not_at_sink") toast("🚰 That happens at the wash-up");
    else if (r.reason === "already_cooking") toast("Every burner is busy");
    else if (r.reason === "tray_full") toast("Pass is full — serve or bin something");
    else if (r.reason === "hands_full") toast("Your hands are full");
    else if (r.reason === "nothing_there") toast("Nothing to clear there");
    else if (r.reason === "tray_empty") toast("Nothing on the pass");
    else if (r.reason === "nothing_to_wash") toast("You're not carrying any plates");
    else if (r.reason === "not_your_table") toast("That's your rival's table");
    else if (r.reason === "gone") toast("Too late — they left");
    else if (r.reason === "broke") toast(`Need $${r.cost} for that`);
    else if (r.reason === "needs") toast("Hire a server first");
    else if (r.reason === "maxed") toast("Already fully upgraded");
  });

  S.socket.on("oops", (m) => toast(m));
}

/* ================================================================== boot */

const VENUES = [[1, "🍔 Family Diner"], [11, "🍟 Burger Joint"], [21, "🍕 Pizza Place"], [31, "🍣 Sushi Bar"],
  [41, "🌮 Taco Stand"], [51, "🐟 Fish & Chips"], [61, "🥩 Steakhouse"], [71, "🍝 Italian Kitchen"],
  [81, "🍽️ Luxury Buffet"], [91, "👨‍🍳 Five-Star"]];

function boot() {
  S.pkey = localStorage.getItem("re_pkey");
  if (!S.pkey) {
    S.pkey = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("re_pkey", S.pkey);
  }
  S.name = localStorage.getItem("re_name") || "";
  S.gender = localStorage.getItem("re_gender") || "male";
  $("name").value = S.name;
  $("gMale").classList.toggle("on", S.gender === "male");
  $("gFemale").classList.toggle("on", S.gender === "female");

  initStage(); initStick(); connect();

  const sayHello = () => {
    if (S.socket && S.socket.connected) S.socket.emit("hello", { name: S.name, pkey: S.pkey, gender: S.gender });
  };
  $("name").addEventListener("input", (e) => {
    S.name = e.target.value.trim();
    localStorage.setItem("re_name", S.name);
    sayHello();
  });
  const setGender = (g) => {
    S.gender = g;
    localStorage.setItem("re_gender", g);
    $("gMale").classList.toggle("on", g === "male");
    $("gFemale").classList.toggle("on", g === "female");
    sayHello();
  };
  $("gMale").addEventListener("click", () => setGender("male"));
  $("gFemale").addEventListener("click", () => setGender("female"));

  const needName = () => {
    if (!S.name) { toast("Enter a name first"); $("name").focus(); return false; }
    return true;
  };
  $("goHost").addEventListener("click", () => { if (needName()) screen("setup"); });
  $("goJoin").addEventListener("click", () => { if (needName()) { S.socket.emit("rooms"); screen("browse"); } });
  $("goShop").addEventListener("click", () => screen("shop"));
  $("shopBack").addEventListener("click", () => screen(S.room ? (S.endPayload ? "over" : "lobby") : "home"));
  $("setupBack").addEventListener("click", () => screen("home"));
  $("browseBack").addEventListener("click", () => screen("home"));
  $("lobbyShop").addEventListener("click", () => { S.endPayload = null; screen("shop"); });
  $("overShop").addEventListener("click", () => screen("shop"));

  let mode = "co-op";
  $("mCoop").addEventListener("click", () => { mode = "co-op"; $("mCoop").classList.add("on"); $("mVersus").classList.remove("on"); });
  $("mVersus").addEventListener("click", () => { mode = "versus"; $("mVersus").classList.add("on"); $("mCoop").classList.remove("on"); });

  const lvl = $("lvl");
  const prev = () => {
    const v = clamp(parseInt(lvl.value, 10) || 1, 1, 100);
    let nm = VENUES[0][1];
    VENUES.forEach(([f, n]) => { if (v >= f) nm = n; });
    $("venuePrev").textContent = "You'll be running: " + nm;
  };
  lvl.addEventListener("input", prev); prev();

  $("mkRoom").addEventListener("click", () =>
    S.socket.emit("create_room", { mode, level: clamp(parseInt(lvl.value, 10) || 1, 1, 100) }));
  $("codeGo").addEventListener("click", () => {
    const c = $("codeIn").value.toUpperCase().trim();
    if (c.length !== 4) return toast("Codes are 4 letters");
    S.socket.emit("join_room", { code: c });
  });

  $("startBtn").addEventListener("click", () => { S.endPayload = null; S.socket.emit("start_match"); });
  $("nextBtn").addEventListener("click", () => { S.endPayload = null; S.socket.emit("next_level"); });
  $("leaveBtn").addEventListener("click", () => { S.socket.emit("leave_room"); S.room = null; screen("home"); });
  $("overHome").addEventListener("click", () => { S.socket.emit("leave_room"); S.room = null; S.endPayload = null; screen("home"); });
  $("pauseBtn").addEventListener("click", () => { if (S.snap) S.socket.emit("pause", { on: !S.snap.paused }); });
  $("resumeBtn").addEventListener("click", () => S.socket.emit("pause", { on: false }));
  $("quitBtn").addEventListener("click", () => {
    if (confirm("Leave this shift?")) { S.socket.emit("leave_room"); S.room = null; screen("home"); }
  });
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();

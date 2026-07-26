"use strict";

/* ================================================================= state */

const S = {
  socket: null, me: null, name: "", pkey: null, gender: "male",
  room: null, isHost: false, snap: null, names: {}, profile: null,
  chefs: new Map(), guests: new Map(), plates: new Map(),
  local: { x: 0, z: -5.4, slide: 0 },
  vel: { x: 0, z: 0 },
  lastSent: 0, endPayload: null, hintFade: 0,
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
  el.style.top = (y != null ? y : innerHeight * 0.42) + "px";
  $("pops").appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/* ==================================================================== 3D */

let scene, camera, renderer, ray, ptr, guestLayer, chefLayer, plateLayer, tableLayer;
let SEATS = [], OBST = [], FLOOR = { minX: -13.5, maxX: 13.5, minZ: -7.2, maxZ: 9.8 };
let KZ = -5.2, RANGE = 3.2, SINK = { x: 6.4, z: -7.2 }, BODY_R = 0.62;
let ROOM = { minX: -9.4, maxX: 9.4, minZ: -10.4, maxZ: 13.2 };
let cleanRack = null, sinkPile = null, sinkWater = null;
let rangeRing, sinkGlow;

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

/** Same push-out routine the server runs, so client and server agree. */
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
 * Park the camera so the ENTIRE restaurant is on screen, on any device.
 * Works out how far back it has to sit to fit both the width and the
 * (foreshortened) depth of the room inside the frustum, then adds a
 * margin. Recomputed on every resize, so rotating the phone can't clip
 * the edges off.
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

  const needW = halfW / Math.tan(hFov / 2);
  const needD = (halfD * Math.sin(TILT) + 3.2) / Math.tan(vFov / 2);
  const dist = Math.max(needW, needD) * 1.1;

  camera.position.set(cx, dist * Math.sin(TILT), cz + dist * Math.cos(TILT));
  camera.lookAt(cx, 1.2, cz - 0.4);
  camera.updateProjectionMatrix();
  camera.userData.home = { x: camera.position.x, y: camera.position.y, z: camera.position.z, cx, cz };
}

function initStage() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x10203a);
  scene.fog = new THREE.Fog(0x10203a, 40, 78);

  camera = new THREE.PerspectiveCamera(58, innerWidth / innerHeight, 0.1, 400);
  frameRoom();

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("stage").appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xffeedd, 0.72));
  const key = new THREE.DirectionalLight(0xfff6e8, 0.92);
  key.position.set(12, 26, 14);
  key.castShadow = true;
  key.shadow.mapSize.set(1536, 1536);
  Object.assign(key.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26 });
  scene.add(key);
  const warm = new THREE.PointLight(0xffa94d, 0.7, 50);
  warm.position.set(0, 9, -4);
  scene.add(warm);
  const fill = new THREE.HemisphereLight(0xcfe4ff, 0x6b4b2a, 0.35);
  scene.add(fill);

  buildRoom();
  tableLayer = new THREE.Group(); scene.add(tableLayer);
  guestLayer = new THREE.Group(); scene.add(guestLayer);
  chefLayer = new THREE.Group(); scene.add(chefLayer);
  plateLayer = new THREE.Group(); scene.add(plateLayer);

  rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(RANGE - 0.1, RANGE, 48),
    new THREE.MeshBasicMaterial({ color: 0x2fa88f, side: THREE.DoubleSide, transparent: true, opacity: 0.18 })
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.05;
  rangeRing.visible = false;
  scene.add(rangeRing);

  ray = new THREE.Raycaster(); ptr = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", onTapWorld);
  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    renderer.setSize(innerWidth, innerHeight);
    frameRoom();
  });
  requestAnimationFrame(loop);
}

function buildRoom() {
  const r = new THREE.Group();

  // ---------------- dining floor: laid wooden boards
  const tones = [0xd8b184, 0xcea477, 0xe0bb90, 0xc79b6e, 0xd5ae80];
  let ti = 0;
  for (let rowZ = KZ; rowZ < ROOM.maxZ + 1; rowZ += 1) {
    let x = ROOM.minX - 1;
    while (x < ROOM.maxX + 1) {
      const w = 1.6 + ((ti * 37) % 11) / 10;
      const p = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.97, 0.92), M(tones[ti % tones.length], { rough: 0.72 }));
      p.rotation.x = -Math.PI / 2;
      p.position.set(x + w / 2, 0.01, rowZ + 0.5);
      p.receiveShadow = true;
      r.add(p);
      x += w; ti++;
    }
    ti += 3;
  }

  // ---------------- kitchen floor: quarry tiles
  for (let i = -8; i <= 8; i++) {
    for (let j = 0; j <= 6; j++) {
      const z = KZ - 0.55 - j * 1.1;
      if (z < ROOM.minZ - 1) continue;
      const t = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 1.05),
        M((i + j) % 2 === 0 ? 0xe9eef2 : 0xcfd8e0, { rough: 0.35, metal: 0.05 }));
      t.rotation.x = -Math.PI / 2;
      t.position.set(i * 1.1, 0.012, z);
      t.receiveShadow = true;
      r.add(t);
    }
  }
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(ROOM.maxX - ROOM.minX + 2, 0.22),
    M(0xd9a441, { metal: 0.8, rough: 0.3 }));
  strip.rotation.x = -Math.PI / 2;
  strip.position.set(0, 0.03, KZ);
  r.add(strip);

  // rug
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(15.5, 15), M(0x9c3f45, { rough: 0.95 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(0, 0.02, 5); rug.receiveShadow = true; r.add(rug);
  const rugIn = new THREE.Mesh(new THREE.PlaneGeometry(14.2, 13.7), M(0xb5545a, { rough: 0.95 }));
  rugIn.rotation.x = -Math.PI / 2; rugIn.position.set(0, 0.025, 5); r.add(rugIn);

  // ---------------- walls
  const WH = 12;
  const wall = (w, h, d, c, x, y, z) => r.add(box(w, h, d, c, x, y, z, { cast: false, rough: 0.9 }));
  wall(ROOM.maxX - ROOM.minX + 2, WH, 0.5, 0xf3e8d6, 0, WH / 2, ROOM.minZ - 0.6);
  wall(0.5, WH, ROOM.maxZ - ROOM.minZ + 2, 0xeadfc9, ROOM.minX - 0.6, WH / 2, (ROOM.minZ + ROOM.maxZ) / 2);
  wall(0.5, WH, ROOM.maxZ - ROOM.minZ + 2, 0xeadfc9, ROOM.maxX + 0.6, WH / 2, (ROOM.minZ + ROOM.maxZ) / 2);

  // wainscot panelling down the dining walls
  const panel = (x, z, w, rot) => {
    const g = new THREE.Group();
    g.add(box(w, 2.6, 0.16, 0x2f6b5f, 0, 1.3, 0, { cast: false, rough: 0.7 }));
    const n = Math.max(1, Math.round(w / 1.6));
    for (let i = 0; i < n; i++) {
      g.add(box(w / n - 0.24, 1.7, 0.06, 0x3a8072, -w / 2 + (w / n) * (i + 0.5), 1.32, 0.1, { cast: false, rough: 0.6 }));
    }
    g.add(box(w, 0.18, 0.3, 0xf7efe0, 0, 2.68, 0.02, { cast: false }));
    g.position.set(x, 0, z);
    g.rotation.y = rot || 0;
    r.add(g);
  };
  panel(ROOM.minX - 0.3, (KZ + ROOM.maxZ) / 2, ROOM.maxZ - KZ, Math.PI / 2);
  panel(ROOM.maxX + 0.3, (KZ + ROOM.maxZ) / 2, ROOM.maxZ - KZ, -Math.PI / 2);

  // tiled splashback behind the ranges
  for (let i = -8; i <= 8; i++) {
    for (let j = 0; j < 4; j++) {
      r.add(box(1.02, 1.02, 0.1, (i + j) % 2 ? 0xdff2ee : 0xfbfdfc,
        i * 1.1, 2.4 + j * 1.1, ROOM.minZ - 0.32, { cast: false, rough: 0.25, metal: 0.1 }));
    }
  }

  // framed art
  const art = (x, z, rot, col) => {
    const g = new THREE.Group();
    g.add(box(2.4, 1.8, 0.12, 0x6b4a2a, 0, 0, 0, { cast: false }));
    g.add(box(2.05, 1.45, 0.06, col, 0, 0, 0.08, { cast: false, rough: 0.6 }));
    g.position.set(x, 4.7, z); g.rotation.y = rot; r.add(g);
  };
  art(ROOM.minX - 0.22, 2.5, Math.PI / 2, 0xe8b04b);
  art(ROOM.minX - 0.22, 9.0, Math.PI / 2, 0x7ba7c9);
  art(ROOM.maxX + 0.22, 2.5, -Math.PI / 2, 0xc98a9b);
  art(ROOM.maxX + 0.22, 9.0, -Math.PI / 2, 0x8fbf8a);

  // ---------------- kitchen line
  r.add(box(11.6, 1.9, 2.2, 0xa9744c, -2.6, 0.95, -9.6, { rough: 0.75 }));
  r.add(box(12, 0.24, 2.6, 0xf8f3e8, -2.6, 2.0, -9.6, { rough: 0.22, metal: 0.2 }));
  for (let i = 0; i < 2; i++) {
    const x = -6.2 + i * 6.4;
    r.add(box(4.4, 1.7, 2, 0x333c48, x, 0.85, -9.9, { metal: 0.6, rough: 0.3 }));
    for (let b = 0; b < 2; b++) {
      const bx = x - 1.05 + b * 2.1;
      r.add(cyl(0.44, 0.44, 0.14, 20, 0x11151a, bx, 1.75, -9.9, { metal: 0.9, rough: 0.2 }));
      const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 12),
        new THREE.MeshBasicMaterial({ color: 0x5ab6ff, transparent: true, opacity: 0.45 }));
      flame.position.set(bx, 2.08, -9.9);
      r.add(flame);
      r.add(cyl(0.5, 0.44, 0.16, 18, 0x3a3f46, bx, 1.9, -9.9, { metal: 0.75, rough: 0.35 }));
    }
    const hood = new THREE.Mesh(new THREE.CylinderGeometry(2.1, 2.9, 1.5, 4), M(0xcbd3db, { metal: 0.75, rough: 0.25 }));
    hood.rotation.y = Math.PI / 4;
    hood.position.set(x, 6.3, -9.9);
    hood.castShadow = true;
    r.add(hood);
    r.add(box(0.3, 3.2, 0.3, 0xb4bcc6, x, 8.6, -9.9, { metal: 0.65 }));
  }

  // spice shelf
  r.add(box(7, 0.22, 0.9, 0x8a5a34, -2.6, 4.5, ROOM.minZ - 0.15));
  const jarCols = [0xe5484d, 0xf2a154, 0x2fa88f, 0xf0c869, 0x8b5cf6, 0x4a7fb5, 0xef8fb0];
  for (let j = 0; j < 7; j++) {
    r.add(cyl(0.24, 0.24, 0.66, 12, jarCols[j], -5.6 + j * 1.0, 4.94, ROOM.minZ - 0.15, { rough: 0.4 }));
  }

  // ---------------- sink / dish return
  r.add(box(4.4, 1.7, 1.9, 0x8a9cae, SINK.x, 0.85, -9.2, { metal: 0.35, rough: 0.45 }));
  r.add(box(3.5, 0.45, 1.3, 0xdde5ec, SINK.x, 1.75, -9.2, { metal: 0.65, rough: 0.15 }));
  r.add(cyl(0.09, 0.09, 1.3, 10, 0xe2e7ec, SINK.x, 2.5, -9.75, { metal: 0.92, rough: 0.1 }));
  r.add(box(0.5, 0.1, 0.5, 0xe2e7ec, SINK.x, 3.1, -9.5, { metal: 0.92 }));
  sinkWater = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.1, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x8fd4ff, transparent: true, opacity: 0.55 }));
  sinkWater.position.set(SINK.x, 2.45, -9.5);
  sinkWater.visible = false;
  r.add(sinkWater);

  sinkGlow = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.8, 40),
    new THREE.MeshBasicMaterial({ color: 0x4a9fd8, side: THREE.DoubleSide, transparent: true, opacity: 0.2 }));
  sinkGlow.rotation.x = -Math.PI / 2;
  sinkGlow.position.set(SINK.x, 0.05, SINK.z);
  r.add(sinkGlow);
  r.add(labelSprite("WASH UP", "rgba(74,159,216,.92)", SINK.x, 3.9, -9.2, 2.2));

  sinkPile = new THREE.Group();
  sinkPile.position.set(SINK.x, 1.95, -9.2);
  r.add(sinkPile);

  // ---------------- clean plate rack on the pass
  cleanRack = new THREE.Group();
  cleanRack.position.set(2.0, 2.14, -9.6);
  r.add(cleanRack);
  r.add(labelSprite("CLEAN", "rgba(47,168,143,.92)", 2.0, 3.5, -9.6, 1.9));

  // ---------------- pendants
  [[-4.9, 1.6], [4.9, 1.6], [-4.9, 8.0], [4.9, 8.0]].forEach(([x, z]) => {
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1, 20, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf0c869, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.2 }));
    shade.position.set(x, 6.4, z);
    r.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff3d0 }));
    bulb.position.set(x, 6.05, z);
    r.add(bulb);
    r.add(box(0.05, 2.6, 0.05, 0x4a3a2a, x, 8.2, z, { cast: false }));
    const glow = new THREE.PointLight(0xffcf85, 0.36, 13);
    glow.position.set(x, 5.6, z);
    r.add(glow);
  });

  // ---------------- planters
  const plant = (x, z) => {
    r.add(cyl(0.62, 0.5, 1.05, 14, 0xb4643c, x, 0.52, z, { rough: 0.8 }));
    for (let i = 0; i < 7; i++) {
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.62, 10, 8), M(0x3f8f4e, { rough: 0.9 }));
      leaf.position.set(x + Math.cos(i * 1.5) * 0.5, 1.5 + (i % 3) * 0.42, z + Math.sin(i * 1.5) * 0.5);
      leaf.scale.set(1, 0.72, 1);
      leaf.castShadow = true;
      r.add(leaf);
    }
  };
  plant(ROOM.minX + 1.2, ROOM.maxZ - 1.6);
  plant(ROOM.maxX - 1.2, ROOM.maxZ - 1.6);

  scene.add(r);
}

function labelSprite(text, bg, x, y, z, w) {
  const c = document.createElement("canvas");
  c.width = 160; c.height = 48;
  const g = c.getContext("2d");
  g.fillStyle = bg; g.fillRect(0, 0, 160, 48);
  g.fillStyle = "#fff"; g.font = "bold 24px system-ui";
  g.textAlign = "center"; g.textBaseline = "middle";
  g.fillText(text, 80, 25);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
  sp.scale.set(w, w * 0.3, 1);
  sp.position.set(x, y, z);
  return sp;
}

/** Physical plates you can see: the clean rack, and the pile in the sink. */
function updateKitchenVisuals(k) {
  if (!cleanRack || !sinkPile) return;
  const want = Math.min(12, k.clean || 0);
  while (cleanRack.children.length > want) cleanRack.remove(cleanRack.children[cleanRack.children.length - 1]);
  while (cleanRack.children.length < want) {
    const i = cleanRack.children.length;
    cleanRack.add(cyl(0.42, 0.4, 0.075, 18, 0xfbf6ec, (i % 4) * 0.95 - 1.42, Math.floor(i / 4) * 0.085, 0, { rough: 0.3 }));
  }
  const dirty = Math.min(10, k.washing || 0);
  while (sinkPile.children.length > dirty) sinkPile.remove(sinkPile.children[sinkPile.children.length - 1]);
  while (sinkPile.children.length < dirty) {
    const i = sinkPile.children.length;
    const p = cyl(0.4, 0.38, 0.07, 16, 0xe6dccb, (i % 3) * 0.8 - 0.8, Math.floor(i / 3) * 0.09, 0, { rough: 0.6 });
    p.rotation.z = (i % 2 ? 1 : -1) * 0.08;
    sinkPile.add(p);
  }
  if (sinkWater) sinkWater.visible = dirty > 0;
  if (sinkGlow) sinkGlow.material.color.setHex(dirty > 0 ? 0x4a9fd8 : 0x2fa88f);
}

function buildTables() {
  while (tableLayer.children.length) tableLayer.remove(tableLayer.children[0]);
  SEATS.forEach((p, i) => {
    tableLayer.add(cyl(0.22, 0.34, 1.02, 14, 0x6e4526, p.x, 0.51, p.z));
    tableLayer.add(cyl(0.95, 0.95, 0.13, 22, 0x5c3a20, p.x, 0.07, p.z, { cast: false }));
    tableLayer.add(cyl(1.38, 1.38, 0.16, 28, 0xd18b47, p.x, 1.04, p.z, { rough: 0.55 }));
    const cloth = new THREE.Mesh(new THREE.CylinderGeometry(1.46, 1.62, 0.42, 28, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xfaf4e8, side: THREE.DoubleSide, roughness: 0.9 }));
    cloth.position.set(p.x, 0.92, p.z);
    cloth.receiveShadow = true;
    tableLayer.add(cloth);
    tableLayer.add(cyl(1.46, 1.46, 0.05, 28, 0xfdf9f0, p.x, 1.14, p.z, { rough: 0.85 }));
    tableLayer.add(cyl(0.11, 0.15, 0.3, 10, 0x8fbcd4, p.x, 1.3, p.z, { rough: 0.3 }));
    const bud = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 10), M(0xe86a8a, { rough: 0.8 }));
    bud.position.set(p.x, 1.55, p.z);
    tableLayer.add(bud);

    [-1, 1].forEach((s) => {
      const cz = p.z + s * 2.1;
      tableLayer.add(box(1.05, 0.15, 1.05, 0x8c5a34, p.x, 0.76, cz));
      tableLayer.add(box(1.05, 1.15, 0.15, 0x8c5a34, p.x, 1.34, cz + s * 0.48));
      [-0.42, 0.42].forEach((ox) => {
        tableLayer.add(cyl(0.07, 0.07, 0.76, 8, 0x6e4526, p.x + ox, 0.38, cz - s * 0.35, { cast: false }));
      });
    });

    const c = document.createElement("canvas");
    c.width = c.height = 72;
    const g = c.getContext("2d");
    g.fillStyle = "#fffdf7"; g.fillRect(0, 0, 72, 72);
    g.strokeStyle = "#2f6b5f"; g.lineWidth = 5; g.strokeRect(4, 4, 64, 64);
    g.fillStyle = "#0d1a2e"; g.font = "bold 44px system-ui";
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillText(String(i + 1), 36, 39);
    const card = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    card.scale.set(0.62, 0.62, 1);
    card.position.set(p.x + 0.98, 1.5, p.z + 0.55);
    tableLayer.add(card);
  });
}

function bubbleTex(emoji, badge) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.beginPath(); g.arc(64, 56, 48, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,.97)"; g.fill();
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
  const shirt = new THREE.Color().setHSL(hue, 0.55, 0.55);
  g.add(cyl(0.46, 0.6, 1.25, 18, shirt, 0, 1.45, 0, { rough: 0.8 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 22, 22), M(0xf0c8a0, { rough: 0.9 }));
  head.position.y = 2.4; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.44, 22, 16, 0, Math.PI * 2, 0, Math.PI * (c.id % 2 ? 0.55 : 0.78)),
    M([0x35251c, 0x6b4423, 0x1a1a1a, 0xc98a3f][c.id % 4], { rough: 1 })
  );
  hair.position.y = 2.44; g.add(hair);

  const b = new THREE.Sprite(new THREE.SpriteMaterial({ map: bubbleTex(c.emoji, c.badge), transparent: true, depthTest: false }));
  b.scale.set(1.85, 1.85, 1);
  b.position.set(0, 3.85, 0);
  g.add(b); g.userData.bubble = b;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 1.04, 32),
    new THREE.MeshBasicMaterial({ color: 0x2fa88f, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07;
  g.add(ring); g.userData.ring = ring;

  const seat = SEATS[c.seat] || { x: 0, z: 0 };
  g.position.set(seat.x, 0, seat.z - 2.15);
  g.userData.cid = c.id;
  return g;
}

function makeChef(isMe, gender, isHelper) {
  const g = new THREE.Group();
  const coat = isHelper ? 0xe3ebf2 : (isMe ? 0xfffdf8 : 0xd5dee8);
  const trim = isHelper ? 0x8b5cf6 : (isMe ? 0x2fa88f : 0x64748b);

  g.add(cyl(0.44, 0.56, 1.3, 18, coat, 0, 1.5, 0, { rough: 0.72 }));
  g.add(cyl(0.47, 0.59, 0.72, 18, trim, 0, 1.1, 0, { rough: 0.8 }));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 22, 22), M(0xf2cba4, { rough: 0.9 }));
  head.position.y = 2.42; head.castShadow = true; g.add(head);

  if (gender === "female") {
    const bun = new THREE.Mesh(new THREE.SphereGeometry(0.26, 16, 16), M(0x4a2f1d, { rough: 1 }));
    bun.position.set(0, 2.5, -0.36); g.add(bun);
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.43, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.62),
      M(0x4a2f1d, { rough: 1 })
    );
    hair.position.y = 2.46; g.add(hair);
    g.add(cyl(0.36, 0.3, 0.5, 16, 0xffffff, 0, 2.92, 0, { rough: 0.7 }));
  } else {
    const hair = new THREE.Mesh(
      new THREE.SphereGeometry(0.42, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.5),
      M(0x2b1d13, { rough: 1 })
    );
    hair.position.y = 2.46; g.add(hair);
    g.add(cyl(0.42, 0.34, 0.64, 18, 0xffffff, 0, 3.02, 0, { rough: 0.7 }));
  }

  const arms = new THREE.Group();
  [-1, 1].forEach((s) => {
    const a = cyl(0.13, 0.13, 0.95, 10, coat, s * 0.55, 1.55, 0.1);
    arms.add(a);
  });
  g.add(arms); g.userData.arms = arms;

  const held = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  held.scale.set(1.2, 0.7, 1);
  held.position.set(0, 2.08, 0.95);
  held.visible = false;
  g.add(held); g.userData.held = held;

  const dirty = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  dirty.scale.set(0.85, 0.5, 1);
  dirty.position.set(0.75, 1.65, 0.6);
  dirty.visible = false;
  g.add(dirty); g.userData.dirtySprite = dirty;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.84, 28),
    new THREE.MeshBasicMaterial({ color: trim, side: THREE.DoubleSide, transparent: true, opacity: 0.8 })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.06;
  g.add(ring);

  if (isHelper) {
    const c = document.createElement("canvas");
    c.width = 128; c.height = 40;
    const gg = c.getContext("2d");
    gg.fillStyle = "rgba(139,92,246,.92)";
    gg.beginPath(); gg.roundRect ? gg.roundRect(4, 4, 120, 32, 10) : gg.rect(4, 4, 120, 32); gg.fill();
    gg.fillStyle = "#fff"; gg.font = "bold 19px system-ui"; gg.textAlign = "center"; gg.textBaseline = "middle";
    gg.fillText("SERVER", 64, 21);
    const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
    tag.scale.set(1.5, 0.47, 1);
    tag.position.set(0, 3.6, 0);
    g.add(tag);
  }
  return g;
}

const texCache = new Map();
function emojiStrip(list, w) {
  const k = list.join("");
  if (texCache.has(k)) return texCache.get(k);
  const c = document.createElement("canvas");
  c.width = 128; c.height = 72;
  const g = c.getContext("2d");
  g.font = "42px system-ui,'Apple Color Emoji','Segoe UI Emoji'";
  g.textAlign = "center"; g.textBaseline = "middle";
  const n = Math.min(3, list.length);
  list.slice(0, 3).forEach((e, i) => g.fillText(e, 64 + (i - (n - 1) / 2) * 38, 38));
  const t = new THREE.CanvasTexture(c);
  texCache.set(k, t);
  return t;
}

function makeDirtyPlate(seat) {
  const g = new THREE.Group();
  const p = cyl(0.44, 0.4, 0.09, 20, 0xf1e7d6, 0, 0, 0, { rough: 0.4 });
  g.add(p);
  g.add(cyl(0.3, 0.3, 0.03, 16, 0xb08850, 0, 0.06, 0, { rough: 0.9 }));
  const s = SEATS[seat] || { x: 0, z: 0 };
  g.position.set(s.x, 1.26, s.z);
  g.userData.seat = seat;
  const halo = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 24),
    new THREE.MeshBasicMaterial({ color: 0x4a9fd8, side: THREE.DoubleSide, transparent: true, opacity: 0.85 })
  );
  halo.rotation.x = -Math.PI / 2; halo.position.y = -0.1;
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
      ring.material.color.setHex(c.mood > 0.5 ? 0x2fa88f : c.mood > 0.25 ? 0xf0c869 : 0xe5484d);
      ring.scale.setScalar(Math.max(0.1, c.mood));
      g.userData.bubble.visible = true;
    } else {
      ring.visible = false;
      g.userData.bubble.visible = false;
    }
  });
  S.guests.forEach((g, id) => { if (!alive.has(id)) { guestLayer.remove(g); S.guests.delete(id); } });

  const livePlates = new Set();
  snap.dirty.forEach((d) => {
    livePlates.add(d.id);
    if (!S.plates.has(d.id)) {
      const p = makeDirtyPlate(d.seat);
      plateLayer.add(p); S.plates.set(d.id, p);
    }
  });
  S.plates.forEach((p, id) => { if (!livePlates.has(id)) { plateLayer.remove(p); S.plates.delete(id); } });

  const liveChefs = new Set();
  Object.keys(snap.stations).forEach((sid) => {
    liveChefs.add(sid);
    const st = snap.stations[sid];
    let c = S.chefs.get(sid);
    if (!c) {
      c = makeChef(sid === S.me, st.gender, st.isHelper);
      chefLayer.add(c); S.chefs.set(sid, c);
    }
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

    const ds = c.userData.dirtySprite;
    if (st.dirty > 0) {
      ds.visible = true;
      ds.material.map = emojiStrip(Array(Math.min(3, st.dirty)).fill("🍽️"));
      ds.material.needsUpdate = true;
    } else ds.visible = false;
  });
  S.chefs.forEach((c, sid) => { if (!liveChefs.has(sid)) { chefLayer.remove(c); S.chefs.delete(sid); } });

  const kk = snap.mode === "versus"
    ? (snap.kitchens[S.me] || { clean: 0, washing: 0 })
    : (snap.kitchens[Object.keys(snap.kitchens)[0]] || { clean: 0, washing: 0 });
  updateKitchenVisuals(kk);
}

function clearWorld() {
  S.guests.forEach((g) => guestLayer.remove(g)); S.guests.clear();
  S.chefs.forEach((c) => chefLayer.remove(c)); S.chefs.clear();
  S.plates.forEach((p) => plateLayer.remove(p)); S.plates.clear();
}

function onTapWorld(e) {
  if (!S.snap || S.snap.over || S.snap.paused) return;
  if (e.clientX < innerWidth * 0.5 && e.clientY > innerHeight * 0.3 && e.clientY < innerHeight - 140) return;
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, camera);

  const pHit = ray.intersectObjects(plateLayer.children, true);
  if (pHit.length) {
    let o = pHit[0].object;
    while (o && o.userData.seat === undefined) o = o.parent;
    if (o) { S.socket.emit("bus", { seat: o.userData.seat }); return; }
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
    if (sid === S.me) {
      c.position.x = S.local.x; c.position.z = S.local.z;
      const moving = !frozen && Math.hypot(S.vel.x, S.vel.z) > 0.05;
      if (moving) c.rotation.y = Math.atan2(S.vel.x, S.vel.z);
      c.position.y = moving ? Math.abs(Math.sin(now * 0.015)) * 0.11 : 0;
      if (c.userData.arms) c.userData.arms.rotation.x = moving ? Math.sin(now * 0.015) * 0.5 : 0;
    } else {
      const dx = (c.userData.tx || 0) - c.position.x;
      const dz = (c.userData.tz || 0) - c.position.z;
      if (Math.hypot(dx, dz) > 0.08) c.rotation.y = Math.atan2(dx, dz);
      c.position.x += dx * 0.2; c.position.z += dz * 0.2;
      c.position.y = Math.hypot(dx, dz) > 0.08 ? Math.abs(Math.sin(now * 0.013)) * 0.1 : 0;
    }
  });

  if (playing) {
    rangeRing.visible = true;
    rangeRing.position.set(S.local.x, 0.05, S.local.z);
  } else rangeRing.visible = false;

  S.guests.forEach((g) => {
    const s = g.userData.state;
    if (frozen) return;
    if (s === "waiting") {
      const urgency = 1 + (1 - (g.userData.mood || 1)) * 3.5;
      g.position.y = Math.sin(now * 0.004 * urgency + g.userData.cid) * 0.05;
    } else if (s === "eating") {
      g.position.y = Math.sin(now * 0.02) * 0.04;
    } else if (s === "done") {
      g.position.y = Math.abs(Math.sin(now * 0.012)) * 0.3;
      g.rotation.y = Math.sin(now * 0.008) * 0.3;
    } else {
      g.position.y -= 0.04; g.rotation.y += 0.08;
    }
  });

  if (!frozen) {
    S.plates.forEach((p) => {
      p.position.y = 1.26 + Math.sin(now * 0.004 + p.userData.seat) * 0.05;
      p.rotation.y += 0.012;
      if (p.userData.halo) p.userData.halo.material.opacity = 0.55 + Math.sin(now * 0.006) * 0.3;
    });
    if (sinkGlow) sinkGlow.material.opacity = 0.14 + Math.sin(now * 0.004) * 0.1;
  }

  // Camera stays put so the whole restaurant is always visible — it only
  // breathes a hair toward the chef, capped well inside the safe margin.
  const home = camera.userData.home;
  if (home) {
    const leanX = playing ? clamp(S.local.x * 0.06, -1.1, 1.1) : 0;
    const leanZ = playing ? clamp(S.local.z * 0.04, -0.9, 0.9) : 0;
    camera.position.x += (home.x + leanX - camera.position.x) * 0.05;
    camera.position.z += (home.z + leanZ - camera.position.z) * 0.05;
    camera.lookAt(home.cx + leanX * 0.5, 1.2, home.cz - 0.4 + leanZ * 0.5);
  }

  renderer.render(scene, camera);
}

/* ============================================================== joystick */

let stickId = null, origin = { x: 0, y: 0 };
function initStick() {
  const stick = $("stick"), knob = $("knob"), R = 46;

  addEventListener("touchstart", (e) => {
    if (!$("match").classList.contains("on")) return;
    for (const t of e.changedTouches) {
      if (stickId !== null) break;
      if (t.clientX > innerWidth * 0.55) continue;
      if (t.clientY < innerHeight * 0.28) continue;
      if (t.clientY > innerHeight - 132) continue;
      stickId = t.identifier;
      origin = { x: t.clientX, y: t.clientY };
      stick.style.left = (t.clientX - 59) + "px";
      stick.style.top = (t.clientY - 59) + "px";
      stick.classList.add("on");
      knob.style.left = "33px"; knob.style.top = "33px";
      $("hint").style.opacity = "0";
    }
  }, { passive: true });

  addEventListener("touchmove", (e) => {
    if (stickId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      let dx = t.clientX - origin.x, dy = t.clientY - origin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.left = (33 + dx) + "px";
      knob.style.top = (33 + dy) + "px";
      S.vel.x = dx / R; S.vel.z = dy / R;
    }
  }, { passive: true });

  const end = (e) => {
    if (stickId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      stickId = null; S.vel.x = 0; S.vel.z = 0;
      stick.classList.remove("on");
    }
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", end, { passive: true });

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
  { tray: [], cooking: [], trayCap: 3, cookSlots: 1, dirty: 0, x: 0, z: 0 };
const myKitchen = () => {
  if (!S.snap) return { clean: 0, max: 0, washing: 0 };
  if (S.snap.mode === "versus") return S.snap.kitchens[S.me] || { clean: 0, max: 0, washing: 0 };
  return S.snap.kitchens[Object.keys(S.snap.kitchens)[0]] || { clean: 0, max: 0, washing: 0 };
};
const nearSeat = (i) => {
  const s = SEATS[i];
  return s && Math.hypot(S.local.x - s.x, S.local.z - s.z) <= RANGE;
};

function renderTickets() {
  const wrap = $("tickets"), snap = S.snap, st = myStation();
  const mine = snap.customers
    .filter((c) => c.state === "waiting" && (snap.mode !== "versus" || !c.owner || c.owner === S.me))
    .sort((a, b) => a.patience - b.patience);
  wrap.innerHTML = "";
  mine.forEach((c) => {
    const have = st.tray.includes(c.dish);
    const near = nearSeat(c.seat);
    const el = document.createElement("div");
    el.className = "tk" + (have && near ? " near" : have ? " have" : "");
    const col = c.mood > 0.5 ? "#2fa88f" : c.mood > 0.25 ? "#f0c869" : "#e5484d";
    el.innerHTML = (c.badge ? `<div class="bdg">${c.badge}</div>` : "") +
      `<div class="sn">T${c.seat + 1}</div><div class="dg">${c.emoji}</div>` +
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
        if (S.snap && S.snap.stations[S.me] && S.snap.stations[S.me].tray[+d.dataset.i]) {
          S.socket.emit("toss", { index: +d.dataset.i });
        }
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
  const blocked = st.cooking.length >= st.cookSlots ||
    st.tray.length + st.cooking.length >= st.trayCap || k.clean <= 0 || snap.over || snap.paused;
  menu.querySelectorAll(".dish").forEach((b) => {
    b.disabled = blocked;
    b.classList.toggle("want", wanted.has(b.dataset.dish) && !st.tray.includes(b.dataset.dish));
  });

  const pl = $("plates");
  $("plateCount").textContent = `${k.clean}${k.washing ? " +" + k.washing + "🫧" : ""}`;
  pl.classList.toggle("low", k.clean <= 1);
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
  for (let i = 0; i < snap.maxWalkouts; i++) {
    pips.children[i].classList.toggle("gone", i < snap.walkouts);
  }

  const mine = snap.scores[S.me] || 0;
  const shown = snap.mode === "versus" ? mine : Object.values(snap.scores).reduce((a, b) => a + b, 0);
  $("score").querySelector(".v").textContent = shown;
  $("score").querySelector(".l").textContent = snap.mode === "versus" ? "you" : "team";
  $("score").querySelector(".tp").textContent = "$" + (snap.tips[S.me] || 0);

  const col = $("leftcol");
  const ids = Object.keys(snap.scores);
  [...col.querySelectorAll(".sb")].forEach((n) => n.remove());
  if (ids.length > 1) {
    ids.sort((a, b) => snap.scores[b] - snap.scores[a]).forEach((id) => {
      const row = document.createElement("div");
      row.className = "sb glass" + (id === S.me ? " me" : "");
      const combo = snap.combos[id] > 1 ? ` 🔥${snap.combos[id]}` : "";
      row.innerHTML = `<span class="n">${esc(S.names[id] || "Cook")}</span><span>${snap.scores[id]}${combo}</span>`;
      col.appendChild(row);
    });
  }

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
        if (e.combo > 1 && e.combo % 3 === 0) toast(`🔥 ${e.combo} in a row!`);
      } else if (e.byHelper && e.playerId === S.me) {
        pop(`+${e.points}`, null, innerWidth * 0.3, innerHeight * 0.35);
      } else pop(`+${e.points}`);
    } else if (e.type === "walked_out") {
      pop("walked out!", "bad");
      const left = e.limit - e.walkouts;
      if (left > 0) toast(`😠 Walked out — ${left} more ends the shift`);
    } else if (e.type === "burned" && e.playerId === S.me) {
      toast("Pass was full — dish binned");
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
    SEATS = d.snapshot.seats;
    OBST = d.snapshot.obstacles;
    FLOOR = d.snapshot.floor;
    ROOM = d.snapshot.room || ROOM;
    KZ = d.snapshot.kitchenZ;
    RANGE = d.snapshot.serveRange;
    SINK = d.snapshot.sink;
    BODY_R = d.snapshot.bodyRadius || 0.62;
    buildTables();
    clearWorld();
    S.local = { x: 0, z: KZ - 0.9, slide: 0 };
    S.vel = { x: 0, z: 0 };
    $("hint").style.opacity = "1";
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
    } else if (r.reason === "too_far") toast("🚶 Walk over to that table");
    else if (r.reason === "too_far_from_stove") toast("🔥 Get back behind the pass");
    else if (r.reason === "no_plates") toast("🍽️ No clean plates — clear some tables!");
    else if (r.reason === "already_cooking") toast("Every burner is busy");
    else if (r.reason === "tray_full") toast("Pass is full — serve or bin something");
    else if (r.reason === "hands_full") toast("Your hands are full of plates");
    else if (r.reason === "not_at_sink") toast("🚰 Take them to the sink");
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

  $("pauseBtn").addEventListener("click", () => {
    if (!S.snap) return;
    S.socket.emit("pause", { on: !S.snap.paused });
  });
  $("resumeBtn").addEventListener("click", () => S.socket.emit("pause", { on: false }));
  $("quitBtn").addEventListener("click", () => {
    if (confirm("Leave this shift?")) { S.socket.emit("leave_room"); S.room = null; screen("home"); }
  });
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();

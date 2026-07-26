"use strict";

/* ================================================================ state */

const S = {
  socket: null, me: null, name: "", pkey: null,
  room: null, isHost: false, snap: null, names: {}, profile: null,
  chefs: new Map(),      // playerId -> 3D group
  guests: new Map(),     // customerId -> 3D group
  local: { x: 0, z: -5.2 },
  vel: { x: 0, z: 0 },
  lastSent: 0,
  endPayload: null,
};

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function screen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  $(id).classList.add("on");
}
function toast(m) {
  const t = $("toast");
  t.textContent = m; t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 1800);
}
function pop(text, kind, x, y) {
  const el = document.createElement("div");
  el.className = "pop" + (kind ? " " + kind : "");
  el.textContent = text;
  el.style.left = (x != null ? x : innerWidth / 2 - 20) + "px";
  el.style.top = (y != null ? y : innerHeight * 0.45) + "px";
  $("pops").appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/* ================================================================== 3D */

let scene, camera, renderer, ray, ptr, guestLayer, chefLayer;
let SEATS = [], FLOOR = { minX: -14.5, maxX: 14.5, minZ: -6.5, maxZ: 9.5 }, KZ = -4.6, RANGE = 3.4;
let rangeRing;

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.rough != null ? o.rough : 0.85, metalness: o.metal || 0,
  });
}
function box(w, h, d, color, x, y, z, o = {}) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color, o));
  m.position.set(x, y, z);
  m.castShadow = o.cast !== false; m.receiveShadow = true;
  return m;
}

function initStage() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14263f);
  scene.fog = new THREE.Fog(0x14263f, 36, 70);

  camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 220);
  camera.position.set(0, 15, 18);
  camera.lookAt(0, 0.5, 1.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  $("stage").appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xfff0dc, 0.7));
  const key = new THREE.DirectionalLight(0xfff4e4, 0.9);
  key.position.set(10, 22, 13);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  Object.assign(key.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24 });
  scene.add(key);
  const warm = new THREE.PointLight(0xffab52, 0.75, 46);
  warm.position.set(0, 9, -3);
  scene.add(warm);

  buildRoom();

  guestLayer = new THREE.Group(); scene.add(guestLayer);
  chefLayer = new THREE.Group(); scene.add(chefLayer);

  rangeRing = new THREE.Mesh(
    new THREE.RingGeometry(RANGE - 0.12, RANGE, 44),
    new THREE.MeshBasicMaterial({ color: 0x2fa88f, side: THREE.DoubleSide, transparent: true, opacity: 0.16 })
  );
  rangeRing.rotation.x = -Math.PI / 2;
  rangeRing.position.y = 0.04;
  rangeRing.visible = false;
  scene.add(rangeRing);

  ray = new THREE.Raycaster(); ptr = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", onTapWorld);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
  requestAnimationFrame(loop);
}

function buildRoom() {
  const r = new THREE.Group();

  for (let i = -5; i <= 5; i++) {
    for (let j = -4; j <= 4; j++) {
      const t = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 3),
        mat((i + j) % 2 === 0 ? 0xf6e9d4 : 0xdcc4a4, { rough: 0.96 })
      );
      t.rotation.x = -Math.PI / 2;
      t.position.set(i * 3, 0, j * 3);
      t.receiveShadow = true;
      r.add(t);
    }
  }

  r.add(box(36, 10, 0.6, 0xecdcc0, 0, 5, -11.6, { cast: false }));
  r.add(box(0.6, 10, 28, 0xdfcdae, -17.5, 5, 0, { cast: false }));
  r.add(box(0.6, 10, 28, 0xdfcdae, 17.5, 5, 0, { cast: false }));
  r.add(box(36, 1.5, 0.2, 0x2fa88f, 0, 1.5, -11.25, { cast: false }));

  // kitchen line
  r.add(box(22, 1.7, 2.4, 0xa9744c, 0, 0.85, -8.6));
  r.add(box(22.6, 0.24, 2.9, 0xf7f1e6, 0, 1.8, -8.6, { rough: 0.32 }));
  for (let i = 0; i < 3; i++) {
    const x = -7 + i * 7;
    r.add(box(3.6, 1.5, 2, 0x3b4551, x, 0.75, -10.4, { metal: 0.5, rough: 0.4 }));
    for (let b = 0; b < 2; b++) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4, 0.4, 0.12, 18),
        mat(0x14181d, { metal: 0.9, rough: 0.3 })
      );
      ring.position.set(x - 0.85 + b * 1.7, 1.55, -10.4);
      ring.castShadow = true; r.add(ring);
    }
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.6, 1.3, 4),
      mat(0xc0c8d0, { metal: 0.7, rough: 0.35 })
    );
    hood.rotation.y = Math.PI / 4;
    hood.position.set(x, 5.8, -10.4);
    hood.castShadow = true; r.add(hood);
  }

  // the pass line marker on the floor
  const line = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x2fa88f, transparent: true, opacity: 0.35 })
  );
  line.rotation.x = -Math.PI / 2;
  line.position.set(0, 0.03, KZ);
  r.add(line);

  for (let i = -1; i <= 1; i++) {
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 0.9, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xf0c869, side: THREE.DoubleSide, roughness: 0.5 })
    );
    shade.position.set(i * 6.4, 6.4, 4);
    r.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 12), new THREE.MeshBasicMaterial({ color: 0xfff1c8 }));
    bulb.position.set(i * 6.4, 6.05, 4);
    r.add(bulb);
  }

  scene.add(r);
  window._tableLayer = new THREE.Group();
  scene.add(window._tableLayer);
}

function buildTables() {
  const L = window._tableLayer;
  while (L.children.length) L.remove(L.children[0]);
  SEATS.forEach((p) => {
    L.add(box(3, 0.22, 3, 0xcf8845, p.x, 1.02, p.z, { rough: 0.6 }));
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.24, 1, 12), mat(0x70482a));
    leg.position.set(p.x, 0.5, p.z); leg.castShadow = true; L.add(leg);
    L.add(box(2.2, 0.16, 2.2, 0x70482a, p.x, 0.1, p.z, { cast: false }));
    L.add(box(1.1, 0.16, 1.1, 0x91603a, p.x, 0.72, p.z - 2.1));
    L.add(box(1.1, 1.1, 0.16, 0x91603a, p.x, 1.3, p.z - 2.6));
  });
}

function bubble(emoji, badge) {
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
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthTest: false }));
  sp.scale.set(1.9, 1.9, 1);
  return sp;
}

function makeGuest(c) {
  const g = new THREE.Group();
  const shirt = new THREE.Color().setHSL(((c.id * 61) % 360) / 360, 0.58, 0.55);
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 1.25, 16), mat(shirt, { rough: 0.8 }));
  body.position.y = 1.45; body.castShadow = true; g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 20, 20), mat(0xf0c8a0, { rough: 0.9 }));
  head.position.y = 2.4; head.castShadow = true; g.add(head);
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.44, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    mat(0x35251c, { rough: 1 })
  );
  hair.position.y = 2.45; g.add(hair);

  const b = bubble(c.emoji, c.badge);
  b.position.set(0, 3.85, 0);
  g.add(b); g.userData.bubble = b;

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.76, 1.02, 30),
    new THREE.MeshBasicMaterial({ color: 0x2fa88f, side: THREE.DoubleSide, transparent: true, opacity: 0.92 })
  );
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.07;
  g.add(ring); g.userData.ring = ring;

  const seat = SEATS[c.seat] || { x: 0, z: 0 };
  g.position.set(seat.x, 0, seat.z - 2.1);
  g.userData.cid = c.id;
  return g;
}

function makeChef(isMe) {
  const g = new THREE.Group();
  const coat = isMe ? 0xfdfaf4 : 0xcfd8e3;
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.56, 1.3, 16), mat(coat, { rough: 0.75 }));
  body.position.y = 1.5; body.castShadow = true; g.add(body);
  const apron = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.58, 0.7, 16), mat(isMe ? 0x2fa88f : 0x7d8ea3));
  apron.position.y = 1.1; g.add(apron);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.4, 20, 20), mat(0xf0c8a0, { rough: 0.9 }));
  head.position.y = 2.42; head.castShadow = true; g.add(head);
  const hat = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.34, 0.62, 16), mat(0xffffff, { rough: 0.7 }));
  hat.position.y = 3.0; hat.castShadow = true; g.add(hat);
  const arms = new THREE.Group();
  [-1, 1].forEach((s) => {
    const a = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.95, 10), mat(coat));
    a.position.set(s * 0.55, 1.55, 0.1);
    a.castShadow = true; arms.add(a);
  });
  g.add(arms); g.userData.arms = arms;

  const plate = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthTest: false }));
  plate.scale.set(1.15, 1.15, 1);
  plate.position.set(0, 2.05, 1);
  plate.visible = false;
  g.add(plate); g.userData.plate = plate;

  const glow = new THREE.Mesh(
    new THREE.RingGeometry(0.62, 0.82, 26),
    new THREE.MeshBasicMaterial({ color: isMe ? 0x2fa88f : 0x64748b, side: THREE.DoubleSide, transparent: true, opacity: 0.75 })
  );
  glow.rotation.x = -Math.PI / 2; glow.position.y = 0.06;
  g.add(glow);
  return g;
}

const plateCache = new Map();
function plateTexture(emojis) {
  const k = emojis.join("");
  if (plateCache.has(k)) return plateCache.get(k);
  const c = document.createElement("canvas");
  c.width = 128; c.height = 64;
  const g = c.getContext("2d");
  g.font = "40px system-ui,'Apple Color Emoji','Segoe UI Emoji'";
  g.textAlign = "center"; g.textBaseline = "middle";
  emojis.slice(0, 3).forEach((e, i) => g.fillText(e, 24 + i * 40, 34));
  const t = new THREE.CanvasTexture(c);
  plateCache.set(k, t);
  return t;
}

/* ------------------------------------------------------------- syncing */

function syncWorld(snap) {
  const aliveGuests = new Set();
  snap.customers.forEach((c) => {
    aliveGuests.add(c.id);
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
  S.guests.forEach((g, id) => {
    if (!aliveGuests.has(id)) { guestLayer.remove(g); S.guests.delete(id); }
  });

  const aliveChefs = new Set();
  Object.keys(snap.stations).forEach((pid) => {
    aliveChefs.add(pid);
    let c = S.chefs.get(pid);
    if (!c) { c = makeChef(pid === S.me); chefLayer.add(c); S.chefs.set(pid, c); }
    const st = snap.stations[pid];
    if (pid === S.me) {
      // server correction: only snap back if we've drifted badly
      const d = Math.hypot(S.local.x - st.x, S.local.z - st.z);
      if (d > 3) { S.local.x = st.x; S.local.z = st.z; }
    } else {
      c.userData.tx = st.x; c.userData.tz = st.z;
    }
    const plate = c.userData.plate;
    if (st.tray.length) {
      plate.visible = true;
      plate.material.map = plateTexture(st.tray.map((d) => snap.dishes[d].emoji));
      plate.material.needsUpdate = true;
    } else plate.visible = false;
  });
  S.chefs.forEach((c, pid) => {
    if (!aliveChefs.has(pid)) { chefLayer.remove(c); S.chefs.delete(pid); }
  });
}

function onTapWorld(e) {
  if (!S.snap || S.snap.over) return;
  if (e.clientX < innerWidth * 0.5 && e.clientY > innerHeight * 0.35) return; // walking zone
  ptr.x = (e.clientX / innerWidth) * 2 - 1;
  ptr.y = -(e.clientY / innerHeight) * 2 + 1;
  ray.setFromCamera(ptr, camera);
  const hits = ray.intersectObjects(guestLayer.children, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && o.userData.cid === undefined) o = o.parent;
  if (o && o.userData.state === "waiting") doServe(o.userData.cid, e.clientX, e.clientY);
}

/* ---------------------------------------------------------------- loop */

let lastT = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - lastT) / 1000);
  lastT = now;

  const playing = S.snap && !S.snap.over && $("match").classList.contains("on");

  if (playing) {
    const st = S.snap.stations[S.me];
    const speed = 6.4 * (st ? st.moveScale || 1 : 1);
    S.local.x = clamp(S.local.x + S.vel.x * speed * dt, FLOOR.minX, FLOOR.maxX);
    S.local.z = clamp(S.local.z + S.vel.z * speed * dt, FLOOR.minZ, FLOOR.maxZ);
    if (now - S.lastSent > 120) {
      S.socket.emit("move", { x: S.local.x, z: S.local.z, dt: (now - S.lastSent) / 1000 });
      S.lastSent = now;
    }
  }

  S.chefs.forEach((c, pid) => {
    if (pid === S.me) {
      c.position.x = S.local.x; c.position.z = S.local.z;
      const moving = Math.hypot(S.vel.x, S.vel.z) > 0.05;
      if (moving) c.rotation.y = Math.atan2(S.vel.x, S.vel.z);
      c.position.y = moving ? Math.abs(Math.sin(now * 0.014)) * 0.12 : 0;
      if (c.userData.arms) c.userData.arms.rotation.x = moving ? Math.sin(now * 0.014) * 0.5 : 0;
    } else {
      c.position.x += ((c.userData.tx || 0) - c.position.x) * 0.18;
      c.position.z += ((c.userData.tz || 0) - c.position.z) * 0.18;
    }
  });

  if (playing) {
    rangeRing.visible = true;
    rangeRing.position.set(S.local.x, 0.04, S.local.z);
  } else rangeRing.visible = false;

  S.guests.forEach((g) => {
    const s = g.userData.state;
    if (s === "waiting") {
      const urgency = 1 + (1 - (g.userData.mood || 1)) * 3;
      g.position.y = Math.sin(now * 0.004 * urgency + g.userData.cid) * 0.05;
    } else if (s === "served") {
      g.position.y = Math.abs(Math.sin(now * 0.012)) * 0.32;
      g.rotation.y = Math.sin(now * 0.008) * 0.3;
    } else {
      g.position.y -= 0.035; g.rotation.y += 0.07;
    }
  });

  // camera gently follows the chef
  if (playing) {
    const tx = S.local.x * 0.35;
    camera.position.x += (tx - camera.position.x) * 0.05;
    camera.lookAt(camera.position.x * 0.6, 0.5, 1.5);
  } else {
    camera.position.x += (0 - camera.position.x) * 0.04;
    camera.lookAt(0, 0.5, 1.5);
  }

  renderer.render(scene, camera);
}

/* ============================================================ joystick */

let stickId = null, stickOrigin = { x: 0, y: 0 };
function initStick() {
  const stick = $("stick"), knob = $("knob");
  const R = 44;

  addEventListener("touchstart", (e) => {
    if (!$("match").classList.contains("on")) return;
    for (const t of e.changedTouches) {
      if (stickId !== null) break;
      if (t.clientX > innerWidth * 0.55) continue;                 // right side = buttons
      if (t.clientY < innerHeight * 0.22) continue;                // HUD
      if (t.clientY > innerHeight - 150) continue;                 // kitchen bar
      stickId = t.identifier;
      stickOrigin = { x: t.clientX, y: t.clientY };
      stick.style.left = (t.clientX - 56) + "px";
      stick.style.top = (t.clientY - 56) + "px";
      stick.classList.add("on");
      knob.style.left = "31px"; knob.style.top = "31px";
      $("padHint").style.opacity = "0";
    }
  }, { passive: true });

  addEventListener("touchmove", (e) => {
    if (stickId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      let dx = t.clientX - stickOrigin.x, dy = t.clientY - stickOrigin.y;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx = (dx / d) * R; dy = (dy / d) * R; }
      knob.style.left = (31 + dx) + "px";
      knob.style.top = (31 + dy) + "px";
      S.vel.x = dx / R;
      S.vel.z = dy / R;
    }
  }, { passive: true });

  const end = (e) => {
    if (stickId === null) return;
    for (const t of e.changedTouches) {
      if (t.identifier !== stickId) continue;
      stickId = null;
      S.vel.x = 0; S.vel.z = 0;
      stick.classList.remove("on");
    }
  };
  addEventListener("touchend", end, { passive: true });
  addEventListener("touchcancel", end, { passive: true });

  // keyboard for desktop testing
  const keys = {};
  addEventListener("keydown", (e) => { keys[e.key.toLowerCase()] = true; updateKeys(); });
  addEventListener("keyup", (e) => { keys[e.key.toLowerCase()] = false; updateKeys(); });
  function updateKeys() {
    S.vel.x = (keys.d || keys.arrowright ? 1 : 0) - (keys.a || keys.arrowleft ? 1 : 0);
    S.vel.z = (keys.s || keys.arrowdown ? 1 : 0) - (keys.w || keys.arrowup ? 1 : 0);
  }
}

/* =============================================================== match */

let lastServe = 0;
function doServe(cid, x, y) {
  const now = performance.now();
  if (now - lastServe < 110) return;
  lastServe = now;
  S._tap = { x, y };
  S.socket.emit("serve", { customer: cid });
}

const myStation = () => (S.snap && S.snap.stations[S.me]) || { tray: [], cooking: [], trayCap: 3, cookSlots: 1, x: 0, z: 0 };

function nearSeat(seatIdx) {
  const s = SEATS[seatIdx];
  if (!s) return false;
  return Math.hypot(S.local.x - s.x, S.local.z - s.z) <= RANGE;
}

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
    el.innerHTML =
      (c.badge ? `<div class="bdg">${c.badge}</div>` : "") +
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
  const snap = S.snap, st = myStation();

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
    const el = stoves.children[i];
    const job = st.cooking[i];
    if (job) {
      el.classList.remove("idle");
      el.querySelector(".jf").style.width = Math.round(job.progress * 100) + "%";
      el.querySelector(".jt").innerHTML = `<span style="font-size:17px">${job.emoji}</span>${job.remaining.toFixed(1)}`;
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
      d.className = "slot";
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
  const busy = st.cooking.length >= st.cookSlots;
  const full = st.tray.length + st.cooking.length >= st.trayCap;
  menu.querySelectorAll(".dish").forEach((b) => {
    b.disabled = busy || full || snap.over;
    b.classList.toggle("want", wanted.has(b.dataset.dish) && !st.tray.includes(b.dataset.dish));
  });
}

function renderHud() {
  const snap = S.snap;
  const clk = $("clock");
  clk.textContent = snap.timeRemaining;
  clk.classList.toggle("low", snap.timeRemaining <= 15);
  $("venue").querySelector(".nm").textContent = `${snap.venue.emoji} ${snap.venue.name}`;
  $("venue").querySelector(".st").textContent = `LVL ${snap.level} · ${snap.served}/${snap.totalCustomers}`;

  const mine = snap.scores[S.me] || 0;
  const shown = snap.mode === "versus" ? mine : Object.values(snap.scores).reduce((a, b) => a + b, 0);
  $("score").querySelector(".v").textContent = shown;
  $("score").querySelector(".l").textContent = snap.mode === "versus" ? "you" : "team";
  $("score").querySelector(".tp").textContent = "$" + (snap.tips[S.me] || 0);

  const ids = Object.keys(snap.scores);
  const board = $("board");
  if (ids.length > 1) {
    board.innerHTML = "";
    ids.sort((a, b) => snap.scores[b] - snap.scores[a]).forEach((id) => {
      const row = document.createElement("div");
      row.className = "sb glass" + (id === S.me ? " me" : "");
      const combo = snap.combos[id] > 1 ? ` 🔥${snap.combos[id]}` : "";
      row.innerHTML = `<span class="n">${esc(S.names[id] || "Cook")}</span><span>${snap.scores[id]}${combo}</span>`;
      board.appendChild(row);
    });
  } else board.innerHTML = "";
}

function handleEvents(evts) {
  evts.forEach((e) => {
    if (e.type === "served") {
      if (e.playerId === S.me) {
        const t = S._tap;
        pop(`+${e.points}`, null, t && t.x, t && t.y);
        if (e.tip) pop(`$${e.tip}`, "tip", (t ? t.x : innerWidth / 2) + 46, (t ? t.y : innerHeight / 2) + 18);
        if (e.combo > 1 && e.combo % 3 === 0) toast(`🔥 ${e.combo} in a row!`);
      } else pop(`+${e.points}`);
    } else if (e.type === "walked_out") {
      pop("walked out", "bad");
    } else if (e.type === "burned" && e.playerId === S.me) {
      toast("Pass was full — dish binned");
    }
  });
}

/* ================================================================ menus */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function renderProfile(p) {
  S.profile = p;
  $("homeWallet").textContent = `💰 $${p.wallet}`;
  $("shopWallet").textContent = `💰 $${p.wallet}`;
  $("lvlCap").textContent = `(unlocked: 1–${p.best})`;
  $("lvl").max = p.best;

  const grid = $("shopGrid");
  grid.innerHTML = "";
  p.shop.forEach((u) => {
    const el = document.createElement("div");
    el.className = "up";
    const dots = Array.from({ length: u.max }, (_, i) =>
      `<div class="dot${i < u.level ? " f" : ""}"></div>`).join("");
    const btn = u.cost === null
      ? `<button class="max">MAX</button>`
      : `<button class="${p.wallet >= u.cost ? "" : "no"}" data-key="${u.key}">$${u.cost}</button>`;
    el.innerHTML =
      `<div class="ue">${u.emoji}</div>` +
      `<div class="ub"><div class="un">${u.name}</div><div class="ud">${esc(u.blurb)}</div>` +
      `<div class="dots">${dots}</div></div>` + btn;
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
    row.innerHTML = `<span style="font-size:21px">${host ? "👑" : "👤"}</span>` +
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
      `<div class="meta">${r.mode === "versus" ? "⚔️" : "🤝"} Lv ${r.level} · ${r.players}/${r.maxPlayers} · ${esc(r.host)}</div></div>` +
      `<button>Join</button>`;
    el.querySelector("button").addEventListener("click", () => S.socket.emit("join_room", { code: r.code }));
    box.appendChild(el);
  });
}

function showResults(d) {
  S.endPayload = d;
  const r = d.results;
  const mine = r.scores[S.me] || 0;
  $("overStars").textContent = "★".repeat(r.stars) + "☆".repeat(3 - r.stars);
  $("overServed").textContent = `${r.served}/${r.totalCustomers}`;
  $("overMissed").textContent = r.missed;
  $("overCombo").textContent = (r.bestCombo && r.bestCombo[S.me]) || 0;
  $("overTips").textContent = `💰 +$${r.tips[S.me] || 0} tips`;

  if (r.mode === "versus") {
    $("overTitle").textContent = r.winner === S.me ? "🏆 You won!" : `${esc(d.names[r.winner] || "Rival")} wins`;
    $("overScore").textContent = mine;
  } else {
    $("overTitle").textContent = r.passed ? "Shift complete!" : "Too many walked out";
    $("overScore").textContent = r.teamScore;
  }

  const ids = Object.keys(r.scores);
  if (ids.length > 1) {
    $("overBoard").style.display = "block";
    const rows = $("overRows"); rows.innerHTML = "";
    ids.sort((a, b) => r.scores[b] - r.scores[a]).forEach((id, i) => {
      const row = document.createElement("div");
      row.className = "row";
      row.innerHTML = `<span style="font-size:17px">${["🥇", "🥈", "🥉", "4️⃣"][i] || "•"}</span>` +
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

/* =============================================================== socket */

function connect() {
  S.socket = io({ transports: ["websocket", "polling"] });

  S.socket.on("connect", () => {
    $("boot").classList.add("off");
    S.socket.emit("hello", { name: S.name, pkey: S.pkey });
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
    FLOOR = d.snapshot.floor;
    KZ = d.snapshot.kitchenZ;
    RANGE = d.snapshot.serveRange;
    buildTables();
    S.guests.forEach((g) => guestLayer.remove(g)); S.guests.clear();
    S.chefs.forEach((c) => chefLayer.remove(c)); S.chefs.clear();
    S.local = { x: 0, z: KZ - 0.8 };
    S.vel = { x: 0, z: 0 };
    $("padHint").style.opacity = "1";
    syncWorld(d.snapshot); renderHud(); renderTickets(); renderBar();
    screen("match");
  });

  S.socket.on("state", (d) => {
    S.snap = d.snapshot;
    syncWorld(d.snapshot); renderHud(); renderTickets(); renderBar();
    if (d.events && d.events.length) handleEvents(d.events);
  });

  S.socket.on("match_end", (d) => setTimeout(() => showResults(d), 650));
  S.socket.on("bought", (d) => toast(`✅ ${d.key} → level ${d.level}`));

  S.socket.on("nope", (r) => {
    if (r.reason === "need_dish") {
      const d = S.snap && S.snap.dishes[r.need];
      toast(d ? `They want ${d.emoji} ${d.name}` : "You're not holding that");
    } else if (r.reason === "too_far") toast("🚶 Walk over to their table");
    else if (r.reason === "too_far_from_stove") toast("🔥 Get back to the pass to cook");
    else if (r.reason === "already_cooking") toast("Every burner is busy");
    else if (r.reason === "tray_full") toast("Pass is full — go serve something");
    else if (r.reason === "not_your_table") toast("That's your rival's table");
    else if (r.reason === "gone") toast("Too late — they left");
    else if (r.reason === "broke") toast(`Need $${r.cost} for that`);
    else if (r.reason === "maxed") toast("Already fully upgraded");
  });

  S.socket.on("oops", (m) => toast(m));
}

/* ================================================================ boot */

const VENUE_NAMES = [[1,"🍔 Family Diner"],[11,"🍟 Burger Joint"],[21,"🍕 Pizza Place"],[31,"🍣 Sushi Bar"],
  [41,"🌮 Taco Stand"],[51,"🐟 Fish & Chips"],[61,"🥩 Steakhouse"],[71,"🍝 Italian Kitchen"],
  [81,"🍽️ Luxury Buffet"],[91,"👨‍🍳 Five-Star"]];

function boot() {
  S.pkey = localStorage.getItem("re_pkey");
  if (!S.pkey) {
    S.pkey = "p" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
    localStorage.setItem("re_pkey", S.pkey);
  }
  S.name = localStorage.getItem("re_name") || "";
  $("name").value = S.name;

  initStage();
  initStick();
  connect();

  $("name").addEventListener("input", (e) => {
    S.name = e.target.value.trim();
    localStorage.setItem("re_name", S.name);
    if (S.socket && S.socket.connected) S.socket.emit("hello", { name: S.name, pkey: S.pkey });
  });

  const needName = () => {
    if (!S.name) { toast("Enter a name first"); $("name").focus(); return false; }
    return true;
  };

  $("goHost").addEventListener("click", () => { if (needName()) screen("setup"); });
  $("goJoin").addEventListener("click", () => { if (needName()) { S.socket.emit("rooms"); screen("browse"); } });
  $("goShop").addEventListener("click", () => screen("shop"));
  $("shopBack").addEventListener("click", () => screen(S.room ? "lobby" : "home"));
  $("setupBack").addEventListener("click", () => screen("home"));
  $("browseBack").addEventListener("click", () => screen("home"));
  $("lobbyShop").addEventListener("click", () => screen("shop"));
  $("overShop").addEventListener("click", () => screen("shop"));

  let mode = "co-op";
  $("mCoop").addEventListener("click", () => { mode = "co-op"; $("mCoop").classList.add("on"); $("mVersus").classList.remove("on"); });
  $("mVersus").addEventListener("click", () => { mode = "versus"; $("mVersus").classList.add("on"); $("mCoop").classList.remove("on"); });

  const lvl = $("lvl");
  const prev = () => {
    const v = clamp(parseInt(lvl.value, 10) || 1, 1, 100);
    let nm = VENUE_NAMES[0][1];
    VENUE_NAMES.forEach(([f, n]) => { if (v >= f) nm = n; });
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

  $("startBtn").addEventListener("click", () => S.socket.emit("start_match"));
  $("nextBtn").addEventListener("click", () => S.socket.emit("next_level"));
  $("leaveBtn").addEventListener("click", () => { S.socket.emit("leave_room"); S.room = null; screen("home"); });
  $("overHome").addEventListener("click", () => { S.socket.emit("leave_room"); S.room = null; screen("home"); });
  $("quit").addEventListener("click", () => {
    if (confirm("Leave this shift?")) { S.socket.emit("leave_room"); S.room = null; screen("home"); }
  });
}

if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
else boot();

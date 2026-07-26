"use strict";

/* ============================================================ state ==== */

const S = {
  socket: null,
  me: null,
  name: "",
  room: null,
  isHost: false,
  mode: "co-op",
  level: 1,
  snap: null,
  names: {},
  seenCustomers: new Map(), // id -> 3D group
};

const $ = (id) => document.getElementById(id);

/* ============================================================ screens == */

function screen(id) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("on"));
  $(id).classList.add("on");
}

function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.add("on");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove("on"), 1900);
}

function pop(text, bad, x, y) {
  const el = document.createElement("div");
  el.className = "pop" + (bad ? " bad" : "");
  el.textContent = text;
  el.style.left = (x != null ? x : innerWidth / 2 + (Math.random() * 60 - 30)) + "px";
  el.style.top = (y != null ? y : innerHeight * 0.52) + "px";
  $("pops").appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

/* ============================================================ 3D ======= */

let scene, camera, renderer, raycaster, pointer;
let customerLayer;
const SEAT_POS = [
  { x: -6.2, z: 1.5 }, { x: 0, z: 1.5 }, { x: 6.2, z: 1.5 },
  { x: -6.2, z: 6.5 }, { x: 0, z: 6.5 }, { x: 6.2, z: 6.5 },
];

function initStage() {
  const host = $("stage");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1a3050);
  scene.fog = new THREE.Fog(0x1a3050, 34, 62);

  camera = new THREE.PerspectiveCamera(52, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 12.5, 17);
  camera.lookAt(0, 0.5, 2.5);

  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  host.appendChild(renderer.domElement);

  scene.add(new THREE.AmbientLight(0xfff2e0, 0.72));

  const key = new THREE.DirectionalLight(0xfff4e2, 0.95);
  key.position.set(9, 20, 12);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left = -22;
  key.shadow.camera.right = 22;
  key.shadow.camera.top = 22;
  key.shadow.camera.bottom = -22;
  scene.add(key);

  const warm = new THREE.PointLight(0xffb457, 0.9, 40);
  warm.position.set(0, 8, -4);
  scene.add(warm);

  buildRoom();

  customerLayer = new THREE.Group();
  scene.add(customerLayer);

  raycaster = new THREE.Raycaster();
  pointer = new THREE.Vector2();
  renderer.domElement.addEventListener("pointerdown", onStageTap);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  requestAnimationFrame(loop);
}

function box(w, h, d, color, x, y, z, opts = {}) {
  const m = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshStandardMaterial({
      color,
      roughness: opts.rough != null ? opts.rough : 0.85,
      metalness: opts.metal || 0,
    })
  );
  m.position.set(x, y, z);
  m.castShadow = opts.cast !== false;
  m.receiveShadow = true;
  return m;
}

function buildRoom() {
  const room = new THREE.Group();

  // floor — checkerboard tiles
  for (let i = -5; i <= 5; i++) {
    for (let j = -4; j <= 4; j++) {
      const light = (i + j) % 2 === 0;
      const t = new THREE.Mesh(
        new THREE.PlaneGeometry(3, 3),
        new THREE.MeshStandardMaterial({ color: light ? 0xf2e4cf : 0xd9c3a4, roughness: 0.95 })
      );
      t.rotation.x = -Math.PI / 2;
      t.position.set(i * 3, 0, j * 3);
      t.receiveShadow = true;
      room.add(t);
    }
  }

  // walls
  room.add(box(34, 9, 0.6, 0xe8d8bd, 0, 4.5, -11, { cast: false }));
  room.add(box(0.6, 9, 26, 0xdccbb0, -17, 4.5, 0, { cast: false }));
  room.add(box(0.6, 9, 26, 0xdccbb0, 17, 4.5, 0, { cast: false }));

  // wainscot stripe
  room.add(box(34, 1.6, 0.2, 0x2a9d8f, 0, 1.6, -10.65, { cast: false }));

  // ---- kitchen line
  room.add(box(20, 1.7, 2.4, 0xa9714b, 0, 0.85, -8.4));          // counter body
  room.add(box(20.6, 0.24, 2.9, 0xf6efe3, 0, 1.8, -8.4, { rough: 0.35 })); // pass top

  for (let i = 0; i < 3; i++) {
    const x = -6 + i * 6;
    room.add(box(3.4, 1.5, 2, 0x39424e, x, 0.75, -10, { metal: 0.55, rough: 0.4 })); // range
    for (let b = 0; b < 2; b++) {
      const ring = new THREE.Mesh(
        new THREE.CylinderGeometry(0.42, 0.42, 0.12, 20),
        new THREE.MeshStandardMaterial({ color: 0x14181d, metalness: 0.9, roughness: 0.3 })
      );
      ring.position.set(x - 0.8 + b * 1.6, 1.55, -10);
      ring.castShadow = true;
      room.add(ring);
    }
    // extractor hood
    const hood = new THREE.Mesh(
      new THREE.CylinderGeometry(1.9, 2.5, 1.3, 4),
      new THREE.MeshStandardMaterial({ color: 0xb9c1c9, metalness: 0.75, roughness: 0.35 })
    );
    hood.rotation.y = Math.PI / 4;
    hood.position.set(x, 5.6, -10);
    hood.castShadow = true;
    room.add(hood);
  }

  // ---- dining tables + chairs
  SEAT_POS.forEach((p) => {
    room.add(box(3, 0.22, 3, 0xc9803f, p.x, 1.02, p.z, { rough: 0.6 }));
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16, 0.22, 1, 12),
      new THREE.MeshStandardMaterial({ color: 0x6d4526 })
    );
    leg.position.set(p.x, 0.5, p.z);
    leg.castShadow = true;
    room.add(leg);
    room.add(box(2.2, 0.16, 2.2, 0x6d4526, p.x, 0.1, p.z, { cast: false }));

    // chair facing the kitchen
    room.add(box(1.1, 0.16, 1.1, 0x8c5a34, p.x, 0.72, p.z - 2.1));
    room.add(box(1.1, 1.1, 0.16, 0x8c5a34, p.x, 1.3, p.z - 2.6));
  });

  // hanging pendant lamps
  for (let i = -1; i <= 1; i++) {
    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(0.85, 0.9, 18, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xe9c46a, side: THREE.DoubleSide, roughness: 0.5 })
    );
    shade.position.set(i * 6.2, 6, 3.8);
    room.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xfff0c4 })
    );
    bulb.position.set(i * 6.2, 5.6, 3.8);
    room.add(bulb);
  }

  scene.add(room);
}

/* ---- customers ------------------------------------------------------- */

function bubbleSprite(emoji) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(64, 58, 50, 0, Math.PI * 2);
  g.fillStyle = "rgba(255,255,255,.97)";
  g.fill();
  g.moveTo(52, 100); g.lineTo(64, 122); g.lineTo(78, 100);
  g.fill();
  g.font = "62px system-ui, apple color emoji, segoe ui emoji";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 64, 60);

  const tex = new THREE.CanvasTexture(c);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sp.scale.set(1.9, 1.9, 1);
  return sp;
}

function makeCustomer(c) {
  const g = new THREE.Group();
  const hue = (c.id * 61) % 360;
  const shirt = new THREE.Color().setHSL(hue / 360, 0.6, 0.55);

  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.46, 0.58, 1.25, 16),
    new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.8 })
  );
  body.position.y = 1.45;
  body.castShadow = true;
  g.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.42, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xf0c8a0, roughness: 0.9 })
  );
  head.position.y = 2.4;
  head.castShadow = true;
  g.add(head);

  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.44, 20, 16, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color: 0x35251c, roughness: 1 })
  );
  hair.position.y = 2.45;
  g.add(hair);

  const bubble = bubbleSprite(c.emoji);
  bubble.position.set(0, 3.9, 0);
  g.add(bubble);
  g.userData.bubble = bubble;

  // patience ring on the floor
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 1.02, 32),
    new THREE.MeshBasicMaterial({ color: 0x2a9d8f, side: THREE.DoubleSide, transparent: true, opacity: 0.9 })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.06;
  g.add(ring);
  g.userData.ring = ring;

  const seat = SEAT_POS[c.seat] || SEAT_POS[0];
  g.position.set(seat.x, 0, seat.z - 2.1);
  g.userData.customerId = c.id;
  g.userData.born = performance.now();
  return g;
}

function syncCustomers(snap) {
  const alive = new Set();

  snap.customers.forEach((c) => {
    alive.add(c.id);
    let g = S.seenCustomers.get(c.id);
    if (!g) {
      g = makeCustomer(c);
      customerLayer.add(g);
      S.seenCustomers.set(c.id, g);
    }
    g.userData.state = c.state;
    g.userData.mood = c.mood;

    const ring = g.userData.ring;
    if (c.state === "waiting") {
      const col = c.mood > 0.5 ? 0x2a9d8f : c.mood > 0.25 ? 0xe9c46a : 0xe63946;
      ring.material.color.setHex(col);
      ring.visible = true;
      ring.scale.setScalar(Math.max(0.12, c.mood));
      g.userData.bubble.visible = true;
    } else if (c.state === "served") {
      ring.visible = false;
      g.userData.bubble.visible = false;
    } else {
      ring.visible = false;
      g.userData.bubble.visible = false;
    }
  });

  // remove anyone the server dropped
  S.seenCustomers.forEach((g, id) => {
    if (!alive.has(id)) {
      customerLayer.remove(g);
      S.seenCustomers.delete(id);
    }
  });
}

function clearCustomers() {
  S.seenCustomers.forEach((g) => customerLayer.remove(g));
  S.seenCustomers.clear();
}

function onStageTap(e) {
  if (!S.snap || S.snap.over) return;
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(customerLayer.children, true);
  if (!hits.length) return;
  let o = hits[0].object;
  while (o && o.userData.customerId === undefined) o = o.parent;
  if (o && o.userData.state === "waiting") tryServe(o.userData.customerId, e.clientX, e.clientY);
}

/* ---- render loop ----------------------------------------------------- */

function loop(t) {
  requestAnimationFrame(loop);

  S.seenCustomers.forEach((g) => {
    const st = g.userData.state;
    if (st === "waiting") {
      const urgency = 1 + (1 - (g.userData.mood || 1)) * 3;
      g.position.y = Math.sin(t * 0.004 * urgency + g.userData.customerId) * 0.06;
      if (g.userData.bubble) {
        g.userData.bubble.position.y = 3.9 + Math.sin(t * 0.003 + g.userData.customerId) * 0.1;
      }
    } else if (st === "served") {
      g.position.y = Math.abs(Math.sin(t * 0.012)) * 0.35; // happy hop
      g.rotation.y = Math.sin(t * 0.008) * 0.3;
    } else {
      g.position.y -= 0.03;
      g.rotation.y += 0.06;
    }
  });

  renderer.render(scene, camera);
}

/* ============================================================ match UI = */

let lastServeAt = 0;

function tryServe(customerId, x, y) {
  const now = performance.now();
  if (now - lastServeAt < 120) return;
  lastServeAt = now;
  S.socket.emit("serve", { customer: customerId });
  S._lastTapPos = { x, y };
}

function myStation() {
  return (S.snap && S.snap.stations && S.snap.stations[S.me]) || { cooking: null, tray: [] };
}

function renderTickets() {
  const wrap = $("tickets");
  const snap = S.snap;
  const st = myStation();

  const mine = snap.customers.filter(
    (c) => c.state === "waiting" && (snap.mode !== "versus" || !c.owner || c.owner === S.me)
  );

  wrap.innerHTML = "";
  mine
    .slice()
    .sort((a, b) => a.patience - b.patience)
    .forEach((c) => {
      const ready = st.tray.includes(c.dish);
      const el = document.createElement("div");
      el.className = "ticket" + (ready ? " ready" : "");
      const col = c.mood > 0.5 ? "#2a9d8f" : c.mood > 0.25 ? "#e9c46a" : "#e63946";
      el.innerHTML =
        `<div class="seat">TABLE ${c.seat + 1}</div>` +
        `<div class="dish">${c.emoji}</div>` +
        `<div class="bar"><div class="fill" style="width:${Math.round(c.mood * 100)}%;background:${col}"></div></div>`;
      el.addEventListener("click", (ev) => {
        const r = el.getBoundingClientRect();
        tryServe(c.id, r.left + r.width / 2, r.top);
        ev.stopPropagation();
      });
      wrap.appendChild(el);
    });

  if (!mine.length) {
    const el = document.createElement("div");
    el.style.cssText = "color:rgba(253,246,236,.55);font-size:12px;font-weight:700;padding:14px 6px";
    el.textContent = snap.over ? "Service closed" : "No one waiting — prep ahead!";
    wrap.appendChild(el);
  }
}

function renderKitchen() {
  const snap = S.snap;
  const st = myStation();

  // stove
  const fill = $("stoveFill");
  const txt = $("stoveTxt");
  if (st.cooking) {
    fill.style.width = Math.round(st.cooking.progress * 100) + "%";
    txt.innerHTML = `<span style="font-size:19px">${st.cooking.emoji}</span> ${st.cooking.remaining.toFixed(1)}s`;
  } else {
    fill.style.width = "0%";
    txt.textContent = st.tray.length >= snap.trayCapacity ? "Pass full!" : "Stove free";
  }

  // pass slots
  for (let i = 0; i < 3; i++) {
    const slot = document.querySelector(`.slot[data-slot="${i}"]`);
    const dish = st.tray[i];
    if (dish) {
      slot.classList.add("full");
      slot.textContent = snap.dishes[dish].emoji;
    } else {
      slot.classList.remove("full");
      slot.textContent = "";
    }
  }

  // menu buttons
  const menu = $("menu");
  const wanted = new Set(
    snap.customers
      .filter((c) => c.state === "waiting" && (snap.mode !== "versus" || !c.owner || c.owner === S.me))
      .map((c) => c.dish)
  );
  const held = new Set(st.tray);
  const blocked = !!st.cooking || st.tray.length >= snap.trayCapacity || snap.over;

  if (menu.dataset.built !== snap.menu.join(",")) {
    menu.dataset.built = snap.menu.join(",");
    menu.innerHTML = "";
    snap.menu.forEach((id) => {
      const d = snap.dishes[id];
      const b = document.createElement("button");
      b.className = "dish";
      b.dataset.dish = id;
      b.innerHTML = `<div class="e">${d.emoji}</div><div class="n">${d.name}</div><div class="t">${d.cookTime}s</div>`;
      b.addEventListener("click", () => {
        S.socket.emit("cook", { dish: id });
        b.style.transform = "scale(.9)";
        setTimeout(() => (b.style.transform = ""), 110);
      });
      menu.appendChild(b);
    });
  }
  menu.querySelectorAll(".dish").forEach((b) => {
    const id = b.dataset.dish;
    b.disabled = blocked;
    b.classList.toggle("wanted", wanted.has(id) && !held.has(id));
  });
}

function renderHud() {
  const snap = S.snap;
  const clock = $("clock");
  clock.textContent = snap.timeRemaining;
  clock.classList.toggle("low", snap.timeRemaining <= 15);

  $("venue").querySelector(".nm").textContent = `${snap.restaurant.emoji} ${snap.restaurant.name}`;
  $("venue").querySelector(".st").textContent =
    `LVL ${snap.level} · ${snap.served}/${snap.totalCustomers} SERVED`;

  const mine = snap.scores[S.me] || 0;
  const shown = snap.mode === "versus" ? mine : Object.values(snap.scores).reduce((a, b) => a + b, 0);
  $("score").querySelector(".v").textContent = shown;
  $("score").querySelector(".l").textContent = snap.mode === "versus" ? "you" : "team";

  const board = $("scoreboard");
  const ids = Object.keys(snap.scores);
  if (ids.length > 1) {
    board.innerHTML = "";
    ids
      .slice()
      .sort((a, b) => snap.scores[b] - snap.scores[a])
      .forEach((id) => {
        const row = document.createElement("div");
        row.className = "sb glass" + (id === S.me ? " me" : "");
        const combo = snap.combos && snap.combos[id] > 1 ? ` 🔥${snap.combos[id]}` : "";
        row.innerHTML = `<span class="n">${S.names[id] || "Cook"}</span><span class="s">${snap.scores[id]}${combo}</span>`;
        board.appendChild(row);
      });
  } else {
    board.innerHTML = "";
  }
}

function applyEvents(events) {
  events.forEach((e) => {
    if (e.type === "served" && e.playerId === S.me) {
      const p = S._lastTapPos;
      pop(`+${e.points}`, false, p && p.x, p && p.y);
      if (e.combo > 1) toast(`🔥 ${e.combo} in a row!`);
    } else if (e.type === "served") {
      pop(`+${e.points}`, false);
    } else if (e.type === "walked_out") {
      pop("walked out", true);
    } else if (e.type === "plated" && e.playerId === S.me) {
      // subtle: the pass slot lighting up is feedback enough
    } else if (e.type === "burned" && e.playerId === S.me) {
      toast("🔥 Pass was full — dish binned");
    }
  });
}

/* ============================================================ lobby UI = */

function renderLobby(d) {
  S.room = d.code;
  S.mode = d.mode;
  S.level = d.level;
  S.isHost = d.youAreHost;

  $("lobbyCode").textContent = d.code;
  $("lobbyMode").textContent =
    (d.mode === "versus" ? "⚔️ Versus" : "🤝 Co-op") + ` · Level ${d.level}`;
  $("lobbyVenue").textContent = "Kitchen ready";

  $("crewCount").textContent = `(${d.players.length}/4)`;
  const crew = $("crew");
  crew.innerHTML = "";
  d.players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "row";
    const isHost = p.id === d.hostId;
    row.innerHTML =
      `<span style="font-size:22px">${isHost ? "👑" : "👤"}</span>` +
      `<span class="who">${escapeHtml(p.name)}${p.id === S.me ? " (you)" : ""}</span>` +
      `<span class="pill${isHost ? " host" : ""}">Lv ${p.level}</span>`;
    crew.appendChild(row);
  });

  $("hostBox").style.display = d.youAreHost ? "block" : "none";
  $("waitNote").style.display = d.youAreHost ? "none" : "block";
}

function renderRooms(list) {
  const box = $("roomList");
  if (!list.length) {
    box.innerHTML = '<div class="empty">No open kitchens right now.<br>Open your own!</div>';
    return;
  }
  box.innerHTML = "";
  list.forEach((r) => {
    const el = document.createElement("div");
    el.className = "roomcard";
    el.innerHTML =
      `<div style="flex:1"><div class="code">${r.code}</div>` +
      `<div class="meta">${r.mode === "versus" ? "⚔️ Versus" : "🤝 Co-op"} · Lv ${r.level} · ${r.players}/${r.maxPlayers} · ${escapeHtml(r.host)}</div></div>` +
      `<button>Join</button>`;
    el.querySelector("button").addEventListener("click", () =>
      S.socket.emit("join_room", { code: r.code })
    );
    box.appendChild(el);
  });
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

function showResults(d) {
  const r = d.results;
  const mine = r.scores[S.me] || 0;

  $("overStars").textContent = "★".repeat(r.stars) + "☆".repeat(3 - r.stars);
  $("overServed").textContent = `${r.served}/${r.totalCustomers}`;
  $("overMissed").textContent = r.missed;

  if (r.mode === "versus") {
    const won = r.winner === S.me;
    $("overTitle").textContent = won ? "🏆 You won!" : `${escapeHtml(d.names[r.winner] || "Rival")} wins`;
    $("overScore").textContent = mine;
  } else {
    $("overTitle").textContent = r.stars >= 2 ? "Great shift!" : "Shift over";
    $("overScore").textContent = r.teamScore;
  }

  const ids = Object.keys(r.scores);
  if (ids.length > 1) {
    $("overBoard").style.display = "block";
    const rows = $("overRows");
    rows.innerHTML = "";
    ids
      .sort((a, b) => r.scores[b] - r.scores[a])
      .forEach((id, i) => {
        const row = document.createElement("div");
        row.className = "row";
        row.innerHTML =
          `<span style="font-size:18px">${["🥇", "🥈", "🥉", "4️⃣"][i] || "•"}</span>` +
          `<span class="who">${escapeHtml(d.names[id] || "Cook")}${id === S.me ? " (you)" : ""}</span>` +
          `<span class="pill">${r.scores[id]}</span>`;
        rows.appendChild(row);
      });
  } else {
    $("overBoard").style.display = "none";
  }

  screen("over");
}

/* ============================================================ socket === */

function connect() {
  S.socket = io({ transports: ["websocket", "polling"] });

  S.socket.on("connect", () => {
    $("boot").classList.add("off");
    S.socket.emit("hello", { name: S.name });
  });

  S.socket.on("connect_error", () => {
    $("boot").classList.remove("off");
    $("bootTxt").textContent = "Reconnecting…";
  });

  S.socket.on("disconnect", () => {
    $("boot").classList.remove("off");
    $("bootTxt").textContent = "Connection lost — reconnecting…";
  });

  S.socket.on("welcome", (d) => {
    S.me = d.id;
  });

  S.socket.on("rooms", renderRooms);

  S.socket.on("lobby", (d) => {
    renderLobby(d);
    if (!$("match").classList.contains("on") && !$("over").classList.contains("on")) {
      screen("lobby");
    }
  });

  S.socket.on("match_start", (d) => {
    S.names = d.names;
    S.snap = d.snapshot;
    clearCustomers();
    syncCustomers(d.snapshot);
    renderHud();
    renderTickets();
    renderKitchen();
    screen("match");
  });

  S.socket.on("state", (d) => {
    S.snap = d.snapshot;
    syncCustomers(d.snapshot);
    renderHud();
    renderTickets();
    renderKitchen();
    if (d.events && d.events.length) applyEvents(d.events);
  });

  S.socket.on("match_end", (d) => {
    setTimeout(() => showResults(d), 700);
  });

  S.socket.on("level_up", (d) => toast(`🎉 You reached level ${d.level}!`));

  S.socket.on("nope", (r) => {
    if (r.reason === "need_dish") {
      const d = S.snap && S.snap.dishes[r.need];
      toast(d ? `They want ${d.emoji} ${d.name} — cook it first` : "You don't have that dish yet");
    } else if (r.reason === "already_cooking") toast("Stove's busy");
    else if (r.reason === "tray_full") toast("Pass is full — serve something");
    else if (r.reason === "not_your_table") toast("That's your rival's table");
    else if (r.reason === "gone") toast("Too late — they left");
  });

  S.socket.on("oops", (m) => toast(m));
}

/* ============================================================ wiring === */

const VENUES = [
  [1, "🍔 Family Diner"], [11, "🍟 Burger Joint"], [21, "🍕 Pizza Place"],
  [31, "🍣 Sushi Bar"], [41, "🌮 Taco Stand"], [51, "🐟 Fish & Chips"],
  [61, "🥩 Steakhouse"], [71, "🍝 Italian Kitchen"], [81, "🍽️ Luxury Buffet"],
  [91, "👨‍🍳 Five-Star"],
];

function venueFor(level) {
  let out = VENUES[0][1];
  VENUES.forEach(([from, nm]) => { if (level >= from) out = nm; });
  return out;
}

function boot() {
  initStage();
  connect();

  const saved = localStorage.getItem("re_name");
  if (saved) { $("name").value = saved; S.name = saved; }

  $("name").addEventListener("input", (e) => {
    S.name = e.target.value.trim();
    localStorage.setItem("re_name", S.name);
    if (S.socket && S.socket.connected) S.socket.emit("hello", { name: S.name });
  });

  function requireName() {
    if (!S.name) { toast("Enter a name first"); $("name").focus(); return false; }
    return true;
  }

  $("goHost").addEventListener("click", () => { if (requireName()) screen("setup"); });
  $("goJoin").addEventListener("click", () => {
    if (!requireName()) return;
    S.socket.emit("rooms");
    screen("browse");
  });
  $("setupBack").addEventListener("click", () => screen("home"));
  $("browseBack").addEventListener("click", () => screen("home"));

  let mode = "co-op";
  $("mCoop").addEventListener("click", () => {
    mode = "co-op";
    $("mCoop").classList.add("on"); $("mVersus").classList.remove("on");
  });
  $("mVersus").addEventListener("click", () => {
    mode = "versus";
    $("mVersus").classList.add("on"); $("mCoop").classList.remove("on");
  });

  const lvlIn = $("lvl");
  function previewVenue() {
    const v = Math.min(100, Math.max(1, parseInt(lvlIn.value, 10) || 1));
    $("venuePreview").textContent = "You'll be running: " + venueFor(v);
  }
  lvlIn.addEventListener("input", previewVenue);
  previewVenue();

  $("mkRoom").addEventListener("click", () => {
    const level = Math.min(100, Math.max(1, parseInt(lvlIn.value, 10) || 1));
    S.socket.emit("create_room", { mode, level });
  });

  $("codeGo").addEventListener("click", () => {
    const code = $("codeIn").value.toUpperCase().trim();
    if (code.length !== 4) return toast("Codes are 4 letters");
    S.socket.emit("join_room", { code });
  });

  $("startBtn").addEventListener("click", () => S.socket.emit("start_match"));
  $("leaveBtn").addEventListener("click", () => {
    S.socket.emit("leave_room");
    screen("home");
  });

  $("againBtn").addEventListener("click", () => {
    clearCustomers();
    screen("lobby");
  });
  $("homeBtn").addEventListener("click", () => {
    S.socket.emit("leave_room");
    clearCustomers();
    screen("home");
  });
}

if (document.readyState === "loading") {
  addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

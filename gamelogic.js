"use strict";

const { DISHES, MODIFIERS, UPGRADES, venueForLevel, menuForLevel, rollModifier } = require("./dishes");

/* ------------------------------------------------------------------ world */

/**
 * Six tables of three kinds. Booths seat a family, tables seat a pair,
 * the stool seats a lone regular. Parties are matched to a table that
 * can actually hold them.
 */
const TABLES = [
  { i: 0, x: -5.1, z: 0.4,  cap: 4, kind: "booth" },
  { i: 1, x: 5.1,  z: 0.4,  cap: 4, kind: "booth" },
  { i: 2, x: -5.1, z: 5.4,  cap: 2, kind: "table" },
  { i: 3, x: 5.1,  z: 5.4,  cap: 2, kind: "table" },
  { i: 4, x: -5.1, z: 10.2, cap: 2, kind: "table" },
  { i: 5, x: 5.1,  z: 10.2, cap: 1, kind: "stool" },
];

/** Where each diner sits, relative to their table. Shipped to the client. */
const SEAT_OFFSETS = {
  booth: [{ x: -0.85, z: -1.5 }, { x: 0.85, z: -1.5 }, { x: -0.85, z: 1.5 }, { x: 0.85, z: 1.5 }],
  table: [{ x: 0, z: -1.55 }, { x: 0, z: 1.55 }],
  stool: [{ x: 0, z: -1.45 }],
};

const ROOM = { minX: -9.4, maxX: 9.4, minZ: -10.4, maxZ: 13.6 };
const FLOOR = { minX: -8.4, maxX: 8.4, minZ: -8.2, maxZ: 12.6 };
const KITCHEN_Z = -5.2;
const SINK = { x: 5.4, z: -7.0 };   // wash-up AND the clean plate rack
const SERVE_RANGE = 3.2;
const BUS_RANGE = 3.2;
const SINK_RANGE = 3.0;
const BODY_R = 0.62;
const MAX_SPEED = 18;
const MISS_PENALTY = 25;
const MAX_WALKOUTS = 3;
const DIRTY_CARRY = 4;
const PASS_ACCURACY = 0.7;

const OBSTACLES = TABLES.map((t) => ({
  x: t.x, z: t.z,
  hw: t.kind === "booth" ? 1.5 : t.kind === "stool" ? 1.0 : 1.35,
  hd: t.kind === "booth" ? 1.5 : t.kind === "stool" ? 1.0 : 1.35,
})).concat([
  { x: -3.3, z: -9.6, hw: 4.9, hd: 1.3 },  // the range line
  { x: 5.4,  z: -9.1, hw: 2.3, hd: 1.2 },  // wash-up unit
]);

function walkoutBudget(total) { return Math.max(MAX_WALKOUTS, Math.round(total * 0.2)); }

/* ---------------------------------------------------------------- helpers */

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const up = (st, k) => (st.upgrades && st.upgrades[k]) || 0;

function trayCap(st) { return st.isHelper ? 1 + up(st, "helperSkill") : 3 + up(st, "pass"); }
function plateCarry(st) { return trayCap(st); }
function cookSlots(st) { return st.isHelper ? 1 : 1 + up(st, "burner"); }
function cookScale(st) { return st.isHelper ? Math.pow(0.85, up(st, "helperSkill")) : Math.pow(0.88, up(st, "stove")); }
function tipScale(st) { return 1 + up(st, "charm") * 0.30; }
function moveScale(st) { return st.isHelper ? 0.72 + up(st, "helperSpeed") * 0.20 : 1 + up(st, "shoes") * 0.16; }
function plateStock(upg) { return 4 + ((upg && upg.crockery) || 0) * 2; }
function washTime(upg) { return 3.0 * Math.pow(0.75, (upg && upg.sink) || 0); }

function patienceForLevel(l) { return Math.max(16, 36 - Math.floor(l / 6) * 2); }
function seatsForLevel(l) { return Math.min(9, 3 + Math.floor(l / 9)); }
function maxPartyForLevel(l) { return clamp(1 + Math.floor(l / 22), 1, 4); }
function totalCustomersForLevel(l) { return 8 + Math.floor(l / 5); }
function shiftSecondsForLevel(l, fast) { return fast ? 30 : Math.min(215, 100 + Math.floor(l / 6) * 10); }

/** Rush windows, as fractions of the shift. Later levels get two. */
function rushesForLevel(level, maxTime) {
  if (level < 4) return [];
  const out = [{ from: 0.34, to: 0.56 }];
  if (level >= 30) out.push({ from: 0.70, to: 0.88 });
  return out.map((r) => ({ from: r.from * maxTime, to: r.to * maxTime }));
}

function resolveCollision(x, z, r) {
  r = r || BODY_R;
  for (let pass = 0; pass < 2; pass++) {
    for (const o of OBSTACLES) {
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

/** Walk one step, sliding around obstacles rather than pinning on corners. */
function stepToward(st, tx, tz, stepLen) {
  const d = dist(st.x, st.z, tx, tz);
  if (d < 0.06) return true;
  const ux = (tx - st.x) / d, uz = (tz - st.z) / d;
  const step = Math.min(stepLen, d);
  const moved = (p) => dist(p.x, p.z, st.x, st.z) > step * 0.5;

  const direct = resolveCollision(st.x + ux * step, st.z + uz * step);
  if (moved(direct) && dist(direct.x, direct.z, tx, tz) < d - step * 0.25) {
    st.x = direct.x; st.z = direct.z; st.slide = 0;
    return dist(st.x, st.z, tx, tz) < 0.06;
  }
  if (!st.slide) st.slide = Math.random() < 0.5 ? 1 : -1;
  for (const base of [1.15, 1.6, 0.65, 2.2]) {
    const a = base * st.slide;
    const cs = Math.cos(a), sn = Math.sin(a);
    const p = resolveCollision(st.x + (ux * cs - uz * sn) * step, st.z + (ux * sn + uz * cs) * step);
    if (moved(p)) { st.x = p.x; st.z = p.z; return false; }
  }
  st.slide = -st.slide;
  if (moved(direct)) { st.x = direct.x; st.z = direct.z; }
  return false;
}

/* -------------------------------------------------------------------- match */

function createMatch(opts) {
  const level = clamp(parseInt(opts.level, 10) || 1, 1, 100);
  const mode = opts.mode === "versus" ? "versus" : "co-op";
  const venue = venueForLevel(level);
  const menu = menuForLevel(level);
  const rng = opts.rng || Math.random;
  const maxTime = shiftSecondsForLevel(level, opts.fast);

  const match = {
    level, mode, rng,
    venue: { id: venue.id, name: venue.name, emoji: venue.emoji },
    menu,
    dishes: menu.reduce((a, id) => {
      a[id] = { id, name: DISHES[id].n, emoji: DISHES[id].e, cookTime: DISHES[id].t, points: DISHES[id].p };
      return a;
    }, {}),

    maxTime, timeRemaining: maxTime,
    basePatience: patienceForLevel(level),
    seatsAllowed: seatsForLevel(level),
    maxParty: maxPartyForLevel(level),
    totalCustomers: totalCustomersForLevel(level),
    maxWalkouts: walkoutBudget(totalCustomersForLevel(level)),
    rushes: rushesForLevel(level, maxTime),
    inRush: false,

    paused: false, pausedBy: null,
    spawned: 0, served: 0, missed: 0, walkouts: 0,
    customers: [], dirty: [],
    stations: {}, owners: {}, kitchens: {},
    scores: {}, tips: {}, combos: {}, bestCombo: {},
    events: [], over: false, failed: false,
    nextCustomerId: 1, nextPlateId: 1, nextPartyId: 1, spawnCooldown: 0,
  };

  (opts.playerIds || []).forEach((pid) => {
    addPlayer(match, pid, (opts.upgrades && opts.upgrades[pid]) || {},
      (opts.genders && opts.genders[pid]) || "male");
  });

  seatParty(match);
  return match;
}

function makeStation(match, id, owner, upgrades, gender, isHelper) {
  match.stations[id] = {
    id, owner, isHelper: !!isHelper, gender: gender === "female" ? "female" : "male",
    upgrades: Object.assign(
      { stove: 0, pass: 0, burner: 0, shoes: 0, charm: 0, chairs: 0, crockery: 0, sink: 0,
        helper: 0, helperSpeed: 0, helperSkill: 0 }, upgrades || {}),
    cooking: [], tray: [], dirty: [], plates: 0,
    x: isHelper ? 2.2 : -1.6, z: KITCHEN_Z - 1.2,
    ai: isHelper ? { cool: 0 } : null,
  };
  match.owners[id] = owner;
}

function addPlayer(match, pid, upgrades, gender) {
  if (match.stations[pid]) return;
  makeStation(match, pid, pid, upgrades, gender, false);
  match.kitchens[pid] = { clean: plateStock(upgrades), max: plateStock(upgrades), washing: [] };
  match.scores[pid] = 0; match.tips[pid] = 0;
  match.combos[pid] = 0; match.bestCombo[pid] = 0;
  if ((upgrades && upgrades.helper) > 0) {
    makeStation(match, pid + ":helper", pid, upgrades, gender === "female" ? "male" : "female", true);
  }
  // give everyone a starting handful so the first dish isn't a trek
  const st = match.stations[pid];
  const k = kitchenFor(match, pid);
  const take = Math.min(plateCarry(st), k.clean);
  st.plates = take; k.clean -= take;
  if (match.stations[pid + ":helper"]) {
    const h = match.stations[pid + ":helper"];
    const t2 = Math.min(plateCarry(h), k.clean);
    h.plates = t2; k.clean -= t2;
  }
}

function kitchenFor(match, stationId) {
  const owner = match.owners[stationId] || stationId;
  if (match.mode === "versus") return match.kitchens[owner];
  return match.kitchens[Object.keys(match.kitchens)[0]] || match.kitchens[owner];
}

const tableBusy = (match, ti) =>
  match.customers.some((c) => c.table === ti && c.state !== "gone") ||
  match.dirty.some((d) => d.table === ti);

function seatedCount(match) {
  return match.customers.filter((c) => c.state === "waiting" || c.state === "eating").length;
}

/** Seat a whole party at one table. Families sit together. */
function seatParty(match) {
  const remaining = match.totalCustomers - match.spawned;
  if (remaining <= 0) return null;

  const room = match.seatsAllowed - seatedCount(match);
  if (room <= 0) return null;

  let size = 1 + Math.floor(match.rng() * match.maxParty);
  if (match.inRush && match.maxParty > 1) size = Math.min(match.maxParty, size + 1);
  size = Math.min(size, remaining, room, 4);

  const free = TABLES.filter((t) => !tableBusy(match, t.i) && t.cap >= size);
  if (!free.length) {
    const any = TABLES.filter((t) => !tableBusy(match, t.i));
    if (!any.length) return null;
    const t = any[Math.floor(match.rng() * any.length)];
    size = Math.min(size, t.cap);
    return fillTable(match, t, size);
  }
  // prefer a table that fits snugly so families don't hog the big booths
  free.sort((a, b) => (a.cap - size) - (b.cap - size));
  const pool = free.filter((t) => t.cap - size === free[0].cap - size);
  return fillTable(match, pool[Math.floor(match.rng() * pool.length)], size);
}

function fillTable(match, table, size) {
  const partyId = match.nextPartyId++;
  let chairBoost = 0;
  Object.values(match.stations).forEach((s) => { chairBoost = Math.max(chairBoost, up(s, "chairs")); });

  let owner = null;
  if (match.mode === "versus") {
    const pids = Object.keys(match.kitchens);
    if (pids.length) owner = pids[(partyId - 1) % pids.length];
  }

  const made = [];
  for (let slot = 0; slot < size; slot++) {
    const dish = match.menu[Math.floor(match.rng() * match.menu.length)];
    const modKey = rollModifier(match.level, match.rng);
    const mod = MODIFIERS[modKey];
    const patience = match.basePatience * mod.wait * (1 + chairBoost * 0.10) * (match.inRush ? 0.9 : 1);
    const c = {
      id: match.nextCustomerId++, party: partyId, table: table.i, slot,
      dish, emoji: DISHES[dish].e, mod: modKey, badge: mod.badge,
      state: "waiting", patience, maxPatience: patience, owner, mood: 1,
    };
    match.customers.push(c);
    match.spawned++;
    made.push(c);
  }
  match.events.push({
    type: "party_arrived", party: partyId, table: table.i,
    size, kind: table.kind, ids: made.map((c) => c.id),
  });
  return made;
}

/* ----------------------------------------------------------------- actions */

function moveTo(match, sid, x, z, dt) {
  const st = match.stations[sid];
  if (!st || match.paused) return false;
  const allowed = MAX_SPEED * moveScale(st) * Math.max(0.05, dt || 0.2) + 1.6;
  let tx = Number(x) || 0, tz = Number(z) || 0;
  const d = dist(st.x, st.z, tx, tz);
  if (d > allowed) { tx = st.x + ((tx - st.x) / d) * allowed; tz = st.z + ((tz - st.z) / d) * allowed; }
  const p = resolveCollision(tx, tz);
  st.x = p.x; st.z = p.z;
  return d <= allowed;
}

const atStove = (st) => st.z <= KITCHEN_Z;
const atSink = (st) => dist(st.x, st.z, SINK.x, SINK.z) <= SINK_RANGE;

/** Grab clean plates off the wash-up rack. You cook onto these. */
function takePlates(match, sid) {
  if (match.over || match.paused) return { ok: false, reason: "paused" };
  const st = match.stations[sid];
  if (!st) return { ok: false, reason: "no_station" };
  if (!atSink(st)) return { ok: false, reason: "not_at_sink" };
  const k = kitchenFor(match, sid);
  const room = plateCarry(st) - st.plates;
  if (room <= 0) return { ok: false, reason: "hands_full" };
  if (k.clean <= 0) return { ok: false, reason: "none_clean" };
  const take = Math.min(room, k.clean);
  k.clean -= take; st.plates += take;
  match.events.push({ type: "took_plates", stationId: sid, playerId: match.owners[sid], count: take });
  return { ok: true, count: take };
}

function startCook(match, sid, dishId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  if (match.paused) return { ok: false, reason: "paused" };
  const st = match.stations[sid];
  if (!st) return { ok: false, reason: "no_station" };
  if (!atStove(st)) return { ok: false, reason: "too_far_from_stove" };
  if (st.plates <= 0) return { ok: false, reason: "no_plate_in_hand" };
  if (st.cooking.length >= cookSlots(st)) return { ok: false, reason: "already_cooking" };
  if (st.tray.length + st.cooking.length >= trayCap(st)) return { ok: false, reason: "tray_full" };
  if (!match.menu.includes(dishId)) return { ok: false, reason: "not_on_menu" };

  st.plates -= 1;                       // the dish is plated as it's cooked
  const time = DISHES[dishId].t * cookScale(st);
  st.cooking.push({ dish: dishId, emoji: DISHES[dishId].e, remaining: time, total: time });
  return { ok: true, dish: dishId };
}

function serve(match, sid, customerId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  if (match.paused) return { ok: false, reason: "paused" };
  const st = match.stations[sid];
  if (!st) return { ok: false, reason: "no_station" };
  const owner = match.owners[sid];

  const c = match.customers.find((x) => x.id === customerId);
  if (!c || c.state !== "waiting") return { ok: false, reason: "gone" };
  if (match.mode === "versus" && c.owner && c.owner !== owner) return { ok: false, reason: "not_your_table" };

  const t = TABLES[c.table];
  if (dist(st.x, st.z, t.x, t.z) > SERVE_RANGE) return { ok: false, reason: "too_far", table: c.table };

  const idx = st.tray.indexOf(c.dish);
  if (idx === -1) return { ok: false, reason: "need_dish", need: c.dish };

  st.tray.splice(idx, 1);
  c.state = "eating";
  c.eatFor = 2.2;

  const ratio = clamp(c.patience / c.maxPatience, 0, 1);
  const base = DISHES[c.dish].p * MODIFIERS[c.mod].pay;
  match.combos[owner] += 1;
  match.bestCombo[owner] = Math.max(match.bestCombo[owner], match.combos[owner]);
  const comboBonus = Math.min(80, (match.combos[owner] - 1) * 12);
  let points = Math.round(base * (0.55 + 0.45 * ratio)) + comboBonus;

  // serving a whole party earns a table bonus
  const party = match.customers.filter((x) => x.party === c.party);
  const allDone = party.every((x) => x.state !== "waiting");
  if (allDone && party.length > 1) points += 40 * party.length;

  const tip = Math.round(base * 0.16 * (0.4 + 0.6 * ratio) * tipScale(st));
  match.scores[owner] += points;
  match.tips[owner] += tip;
  match.served++;

  match.events.push({
    type: "served", stationId: sid, playerId: owner, byHelper: st.isHelper,
    customerId: c.id, table: c.table, dish: c.dish, mod: c.mod,
    points, tip, combo: match.combos[owner], partyComplete: allDone && party.length > 1,
  });
  return { ok: true, points, tip, combo: match.combos[owner] };
}

/** Clear every dirty plate off one table in a single stop. */
function busTable(match, sid, table) {
  if (match.over || match.paused) return { ok: false, reason: "paused" };
  const st = match.stations[sid];
  if (!st) return { ok: false, reason: "no_station" };
  const here = match.dirty.filter((d) => d.table === table);
  if (!here.length) return { ok: false, reason: "nothing_there" };
  const t = TABLES[table];
  if (dist(st.x, st.z, t.x, t.z) > BUS_RANGE) return { ok: false, reason: "too_far", table };
  const room = DIRTY_CARRY - st.dirty.length;
  if (room <= 0) return { ok: false, reason: "hands_full" };

  const take = here.slice(0, room);
  take.forEach((d) => {
    match.dirty.splice(match.dirty.indexOf(d), 1);
    st.dirty.push(d.id);
  });
  match.events.push({ type: "bussed", stationId: sid, playerId: match.owners[sid], table, count: take.length });
  return { ok: true, count: take.length };
}

function dropAtSink(match, sid) {
  const st = match.stations[sid];
  if (!st || !st.dirty.length) return { ok: false, reason: "nothing_to_wash" };
  if (!atSink(st)) return { ok: false, reason: "not_at_sink" };
  const k = kitchenFor(match, sid);
  const t = washTime(st.upgrades);
  const n = st.dirty.length;
  st.dirty.forEach(() => k.washing.push({ remaining: t, total: t }));
  st.dirty = [];
  match.events.push({ type: "washing", stationId: sid, playerId: match.owners[sid], count: n });
  return { ok: true, count: n };
}

/** Bin a cooked dish. The plate under it goes straight into the wash. */
function toss(match, sid, index) {
  const st = match.stations[sid];
  if (!st || !st.tray.length) return { ok: false, reason: "tray_empty" };
  const i = clamp(parseInt(index, 10) || 0, 0, st.tray.length - 1);
  const dish = st.tray.splice(i, 1)[0];
  const t = washTime(st.upgrades);
  kitchenFor(match, sid).washing.push({ remaining: t, total: t });
  match.events.push({ type: "tossed", stationId: sid, playerId: match.owners[sid], dish });
  return { ok: true, dish };
}

function setPause(match, playerId, on, name) {
  if (match.over) return { ok: false, reason: "shift_over" };
  match.paused = !!on;
  match.pausedBy = on ? playerId : null;
  match.events.push({ type: on ? "paused" : "resumed", playerId, name });
  return { ok: true, paused: match.paused };
}

/* --------------------------------------------------------------- AI server */

function helperThink(match, st, dt) {
  const owner = match.owners[st.id];
  st.ai.cool = Math.max(0, st.ai.cool - dt);
  const speed = 6.4 * moveScale(st) * dt;
  const walk = (tx, tz) => stepToward(st, tx, tz, speed);

  const mine = match.customers
    .filter((c) => c.state === "waiting" && (match.mode !== "versus" || !c.owner || c.owner === owner))
    .sort((a, b) => a.patience - b.patience);

  if (st.dirty.length >= DIRTY_CARRY) {
    if (walk(SINK.x, SINK.z + 1.5)) { dropAtSink(match, st.id); takePlates(match, st.id); }
    return;
  }
  const deliver = mine.find((c) => st.tray.includes(c.dish));
  if (deliver) {
    const t = TABLES[deliver.table];
    if (dist(st.x, st.z, t.x, t.z) <= SERVE_RANGE) serve(match, st.id, deliver.id);
    else walk(t.x, t.z - 2.4);
    return;
  }
  const plate = match.dirty[0];
  if (plate && !st.tray.length && st.dirty.length < DIRTY_CARRY) {
    const t = TABLES[plate.table];
    if (dist(st.x, st.z, t.x, t.z) <= BUS_RANGE) busTable(match, st.id, plate.table);
    else walk(t.x, t.z - 2.4);
    return;
  }
  // Out of plates AND the rack is empty? The plates are all dirty on the
  // tables — standing at the sink would deadlock. Go and collect them.
  const k = kitchenFor(match, st.id);
  if (st.plates <= 0 && k.clean <= 0 && !st.dirty.length && match.dirty.length) {
    const d = match.dirty[0];
    const t = TABLES[d.table];
    if (dist(st.x, st.z, t.x, t.z) <= BUS_RANGE) busTable(match, st.id, d.table);
    else walk(t.x, t.z - 2.4);
    return;
  }

  const busy = st.cooking.length >= cookSlots(st);
  const full = st.tray.length + st.cooking.length >= trayCap(st);
  if (!busy && !full && mine.length) {
    if (st.plates <= 0) {
      if (walk(SINK.x, SINK.z + 1.5)) { dropAtSink(match, st.id); takePlates(match, st.id); }
      return;
    }
    const want = mine.find((c) => !st.tray.includes(c.dish) && !st.cooking.some((j) => j.dish === c.dish));
    if (want) {
      if (atStove(st)) { if (!st.ai.cool) { startCook(match, st.id, want.dish); st.ai.cool = 0.25; } }
      else walk(clamp(st.x, -6, 6), KITCHEN_Z - 1);
      return;
    }
  }
  if (st.dirty.length) {
    if (walk(SINK.x, SINK.z + 1.5)) { dropAtSink(match, st.id); takePlates(match, st.id); }
    return;
  }
  if (st.plates < plateCarry(st)) {
    if (walk(SINK.x, SINK.z + 1.5)) takePlates(match, st.id);
    return;
  }
  if (st.z > KITCHEN_Z) walk(clamp(st.x, -6, 6), KITCHEN_Z - 1);
}

/* -------------------------------------------------------------------- tick */

function tick(match, dt) {
  if (match.over || match.paused) return;
  match.timeRemaining = Math.max(0, match.timeRemaining - dt);

  // rush windows
  const elapsed = match.maxTime - match.timeRemaining;
  const nowRush = match.rushes.some((r) => elapsed >= r.from && elapsed <= r.to);
  if (nowRush !== match.inRush) {
    match.inRush = nowRush;
    match.events.push({ type: nowRush ? "rush_start" : "rush_end" });
  }

  Object.values(match.kitchens).forEach((k) => {
    for (let i = k.washing.length - 1; i >= 0; i--) {
      k.washing[i].remaining -= dt;
      if (k.washing[i].remaining <= 0) { k.washing.splice(i, 1); k.clean = Math.min(k.max, k.clean + 1); }
    }
  });

  for (const sid of Object.keys(match.stations)) {
    const st = match.stations[sid];
    for (let i = st.cooking.length - 1; i >= 0; i--) {
      const job = st.cooking[i];
      job.remaining -= dt;
      if (job.remaining <= 0) {
        st.cooking.splice(i, 1);
        if (st.tray.length < trayCap(st)) {
          st.tray.push(job.dish);
          match.events.push({ type: "plated", stationId: sid, playerId: match.owners[sid], dish: job.dish });
        } else {
          const t = washTime(st.upgrades);
          kitchenFor(match, sid).washing.push({ remaining: t, total: t });
          match.events.push({ type: "burned", stationId: sid, playerId: match.owners[sid], dish: job.dish });
        }
      }
    }
    if (st.isHelper) helperThink(match, st, dt);
    else if (atSink(st)) {                       // walking to the sink does both jobs
      if (st.dirty.length) dropAtSink(match, sid);
      if (st.plates < plateCarry(st) && kitchenFor(match, sid).clean > 0) takePlates(match, sid);
    }
  }

  for (const c of match.customers) {
    if (c.state === "waiting") {
      c.patience = Math.max(0, c.patience - dt);
      c.mood = c.patience / c.maxPatience;
      if (c.patience <= 0) {
        c.state = "left"; c.departAt = 0.9;
        match.missed++; match.walkouts++;
        const targets = match.mode === "versus" && c.owner ? [c.owner] : Object.keys(match.scores);
        targets.forEach((pid) => {
          match.scores[pid] = Math.max(0, match.scores[pid] - MISS_PENALTY);
          match.combos[pid] = 0;
        });
        match.events.push({
          type: "walked_out", customerId: c.id, table: c.table, dish: c.dish,
          walkouts: match.walkouts, limit: match.maxWalkouts,
        });
      }
    } else if (c.state === "eating") {
      c.eatFor -= dt;
      if (c.eatFor <= 0) {
        c.state = "done"; c.departAt = 1.1;
        match.dirty.push({ id: match.nextPlateId++, table: c.table, slot: c.slot });
        match.events.push({ type: "left_plate", table: c.table, slot: c.slot });
      }
    } else {
      c.departAt -= dt;
      if (c.departAt <= 0) c.state = "gone";
    }
  }
  match.customers = match.customers.filter((c) => c.state !== "gone");

  match.spawnCooldown -= dt;
  if (match.spawnCooldown <= 0) {
    const seated = seatParty(match);
    const base = Math.max(1.4, 3.4 - match.level * 0.014);
    match.spawnCooldown = seated
      ? (match.inRush ? base * 0.45 : base) + match.rng() * (match.inRush ? 0.5 : 1.4)
      : 0.5;
  }

  if (match.walkouts >= match.maxWalkouts) {
    match.over = true; match.failed = true;
    match.events.push({ type: "shift_over", reason: "walkouts" });
    return;
  }
  const done = match.spawned >= match.totalCustomers &&
    match.customers.every((c) => c.state !== "waiting");
  if (match.timeRemaining <= 0 || done) {
    match.over = true;
    match.events.push({ type: "shift_over", reason: match.timeRemaining <= 0 ? "time" : "all_served" });
  }
}

function drainEvents(match) {
  const out = match.events;
  match.events = [];
  return out;
}

/* ---------------------------------------------------------------- snapshot */

function snapshot(match) {
  return {
    level: match.level, mode: match.mode, venue: match.venue,
    menu: match.menu, dishes: match.dishes, modifiers: MODIFIERS,
    tables: TABLES, seatOffsets: SEAT_OFFSETS,
    obstacles: OBSTACLES, floor: FLOOR, room: ROOM,
    serveRange: SERVE_RANGE, busRange: BUS_RANGE, sinkRange: SINK_RANGE,
    kitchenZ: KITCHEN_Z, sink: SINK, bodyRadius: BODY_R,
    timeRemaining: Math.ceil(match.timeRemaining), maxTime: match.maxTime,
    served: match.served, missed: match.missed,
    walkouts: match.walkouts, maxWalkouts: match.maxWalkouts,
    totalCustomers: match.totalCustomers,
    paused: match.paused, pausedBy: match.pausedBy, inRush: match.inRush,
    scores: match.scores, tips: match.tips, combos: match.combos,
    over: match.over, failed: match.failed,
    dirty: match.dirty.map((d) => ({ id: d.id, table: d.table, slot: d.slot })),
    kitchens: Object.keys(match.kitchens).reduce((a, pid) => {
      const k = match.kitchens[pid];
      a[pid] = { clean: k.clean, max: k.max, washing: k.washing.length };
      return a;
    }, {}),
    customers: match.customers.map((c) => ({
      id: c.id, party: c.party, table: c.table, slot: c.slot,
      dish: c.dish, emoji: c.emoji, mod: c.mod, badge: c.badge,
      state: c.state, owner: c.owner, mood: clamp(c.mood, 0, 1),
      patience: Math.max(0, Math.ceil(c.patience)),
    })),
    stations: Object.keys(match.stations).reduce((a, sid) => {
      const st = match.stations[sid];
      a[sid] = {
        id: sid, owner: st.owner, isHelper: st.isHelper, gender: st.gender,
        x: Math.round(st.x * 100) / 100, z: Math.round(st.z * 100) / 100,
        trayCap: trayCap(st), plateCap: plateCarry(st), cookSlots: cookSlots(st),
        moveScale: moveScale(st), plates: st.plates,
        tray: st.tray.slice(), dirty: st.dirty.length, dirtyCap: DIRTY_CARRY,
        cooking: st.cooking.map((j) => ({
          dish: j.dish, emoji: j.emoji,
          progress: clamp(1 - j.remaining / j.total, 0, 1),
          remaining: Math.max(0, j.remaining),
        })),
      };
      return a;
    }, {}),
  };
}

function results(match) {
  const ids = Object.keys(match.scores);
  const teamScore = ids.reduce((s, id) => s + match.scores[id], 0);
  const accuracy = match.totalCustomers ? match.served / match.totalCustomers : 0;
  const pct = Math.round(accuracy * 100);
  const passed = match.walkouts < match.maxWalkouts && accuracy >= PASS_ACCURACY;
  let stars = 0;
  if (passed) {
    stars = 1;
    if (match.walkouts <= 1 && accuracy >= 0.85) stars = 2;
    if (match.walkouts === 0 && accuracy >= 0.98) stars = 3;
  }
  let winner = null;
  if (match.mode === "versus" && ids.length) {
    winner = ids.reduce((a, b) => (match.scores[a] >= match.scores[b] ? a : b));
  }
  return {
    mode: match.mode, level: match.level, venue: match.venue,
    scores: match.scores, tips: match.tips, bestCombo: match.bestCombo,
    teamScore, served: match.served, missed: match.missed,
    walkouts: match.walkouts, maxWalkouts: match.maxWalkouts,
    totalCustomers: match.totalCustomers, accuracy: pct,
    required: Math.round(PASS_ACCURACY * 100),
    stars, winner, passed,
    failReason: passed ? null : (match.walkouts >= match.maxWalkouts ? "walkouts" : "quota"),
  };
}

/* ---------------------------------------------------------------- upgrades */

function upgradeCost(key, level) {
  const u = UPGRADES[key];
  if (!u || level >= u.max) return null;
  return u.cost(level);
}
function buyUpgrade(wallet, upgrades, key) {
  const u = UPGRADES[key];
  if (!u) return { ok: false, reason: "unknown" };
  if (u.needs && !(upgrades[u.needs] > 0)) return { ok: false, reason: "needs", needs: u.needs };
  const lvl = upgrades[key] || 0;
  if (lvl >= u.max) return { ok: false, reason: "maxed" };
  const cost = u.cost(lvl);
  if (wallet < cost) return { ok: false, reason: "broke", cost };
  upgrades[key] = lvl + 1;
  return { ok: true, spent: cost, key, level: lvl + 1 };
}
function shopFor(upgrades) {
  return Object.keys(UPGRADES).map((key) => {
    const u = UPGRADES[key];
    const lvl = (upgrades && upgrades[key]) || 0;
    const locked = u.needs && !((upgrades && upgrades[u.needs]) > 0);
    return {
      key, name: u.name, emoji: u.emoji, level: lvl, max: u.max,
      cost: lvl >= u.max ? null : u.cost(lvl),
      locked: !!locked, needs: u.needs || null, hire: !!u.hire,
      blurb: lvl >= u.max ? "Fully upgraded" : u.blurb(lvl),
    };
  });
}

module.exports = {
  DISHES, MODIFIERS, UPGRADES, TABLES, SEAT_OFFSETS, OBSTACLES, FLOOR, ROOM,
  KITCHEN_Z, SINK, SERVE_RANGE, BUS_RANGE, SINK_RANGE, BODY_R, DIRTY_CARRY,
  MAX_WALKOUTS, PASS_ACCURACY,
  createMatch, addPlayer, moveTo, startCook, serve, busTable, dropAtSink,
  takePlates, toss, setPause, tick, drainEvents, snapshot, results,
  resolveCollision, stepToward, buyUpgrade, upgradeCost, shopFor,
  trayCap, plateCarry, cookSlots, plateStock, kitchenFor,
};

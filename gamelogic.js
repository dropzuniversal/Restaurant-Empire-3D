"use strict";

const { DISHES, MODIFIERS, UPGRADES, venueForLevel, menuForLevel, rollModifier } = require("./dishes");

/* ------------------------------------------------------------------ world */

const SEATS = [
  { x: -8.2, z: 1.2 }, { x: 0, z: 1.2 }, { x: 8.2, z: 1.2 },
  { x: -8.2, z: 6.6 }, { x: 0, z: 6.6 }, { x: 8.2, z: 6.6 },
];

const FLOOR = { minX: -13.5, maxX: 13.5, minZ: -7.2, maxZ: 9.8 };
const KITCHEN_Z = -4.6;   // stand at or behind this to work the pass
const SINK = { x: 10.5, z: -6.2 };
const SERVE_RANGE = 3.2;
const BUS_RANGE = 3.2;
const BODY_R = 0.62;
const MAX_SPEED = 18;
const MISS_PENALTY = 25;
const MAX_WALKOUTS = 3;
function walkoutBudget(total) { return Math.max(MAX_WALKOUTS, Math.round(total * 0.2)); }
const PASS_ACCURACY = 0.7;
const DIRTY_CARRY = 4;

/** Solid things you can't walk through. Shipped to the client so both agree. */
const OBSTACLES = SEATS.map((s) => ({ x: s.x, z: s.z, hw: 1.5, hd: 1.5 }))
  .concat([
    { x: 0, z: -8.9, hw: 11.5, hd: 1.5 },   // kitchen counter
    { x: 10.5, z: -7.4, hw: 1.7, hd: 0.9 }, // sink unit
  ]);

/* ---------------------------------------------------------------- helpers */

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function up(st, key) { return (st.upgrades && st.upgrades[key]) || 0; }

function trayCap(st) {
  if (st.isHelper) return 1 + up(st, "helperSkill");
  return 3 + up(st, "pass");
}
function cookSlots(st) { return st.isHelper ? 1 : 1 + up(st, "burner"); }
function cookScale(st) {
  return st.isHelper ? Math.pow(0.85, up(st, "helperSkill")) : Math.pow(0.88, up(st, "stove"));
}
function tipScale(st) { return 1 + up(st, "charm") * 0.30; }
function moveScale(st) {
  return st.isHelper ? 0.72 + up(st, "helperSpeed") * 0.20 : 1 + up(st, "shoes") * 0.16;
}
function plateStock(upg) { return 8 + ((upg && upg.crockery) || 0) * 3; }
function washTime(upg) { return 2.4 * Math.pow(0.75, (upg && upg.sink) || 0); }

function patienceForLevel(l) { return Math.max(15, 34 - Math.floor(l / 6) * 2); }
function concurrentForLevel(l) { return Math.min(SEATS.length, 2 + Math.floor(l / 10)); }
function totalCustomersForLevel(l) { return 8 + Math.floor(l / 5); }
function shiftSecondsForLevel(l, fast) { return fast ? 30 : Math.min(210, 95 + Math.floor(l / 6) * 10); }

/** Push a circle out of every box it overlaps. Same routine runs client-side. */
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
        x = nx + (dx / d) * r;
        z = nz + (dz / d) * r;
      } else {
        // dead centre: eject along the shallowest axis
        const ox = o.hw + r - Math.abs(x - o.x);
        const oz = o.hd + r - Math.abs(z - o.z);
        if (ox < oz) x += (x < o.x ? -ox : ox);
        else z += (z < o.z ? -oz : oz);
      }
    }
  }
  return {
    x: clamp(x, FLOOR.minX, FLOOR.maxX),
    z: clamp(z, FLOOR.minZ, FLOOR.maxZ),
  };
}


/**
 * Walk one step toward a target, sliding around anything in the way.
 *
 * A greedy "only move if it shortens the distance" walk gets pinned on a
 * table edge forever, because stepping sideways around an obstacle makes
 * the distance briefly worse. So: try straight first; if that's blocked,
 * commit to a slide direction and follow the wall until the way opens.
 */
function stepToward(st, tx, tz, stepLen) {
  const d = dist(st.x, st.z, tx, tz);
  if (d < 0.06) return true;
  const ux = (tx - st.x) / d, uz = (tz - st.z) / d;
  const step = Math.min(stepLen, d);
  const moved = (p) => dist(p.x, p.z, st.x, st.z) > step * 0.5;

  // 1. straight at it
  const direct = resolveCollision(st.x + ux * step, st.z + uz * step);
  if (moved(direct) && dist(direct.x, direct.z, tx, tz) < d - step * 0.25) {
    st.x = direct.x; st.z = direct.z; st.slide = 0;
    return dist(st.x, st.z, tx, tz) < 0.06;
  }

  // 2. blocked — pick a side and stick with it so we don't jitter
  if (!st.slide) st.slide = Math.random() < 0.5 ? 1 : -1;
  for (const base of [1.15, 1.6, 0.65, 2.2]) {
    const a = base * st.slide;
    const cs = Math.cos(a), sn = Math.sin(a);
    const p = resolveCollision(st.x + (ux * cs - uz * sn) * step, st.z + (ux * sn + uz * cs) * step);
    if (moved(p)) { st.x = p.x; st.z = p.z; return false; }
  }

  // 3. walled in on that side — try the other one next tick
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

  const match = {
    level, mode, rng,
    venue: { id: venue.id, name: venue.name, emoji: venue.emoji },
    menu,
    dishes: menu.reduce((a, id) => {
      a[id] = { id, name: DISHES[id].n, emoji: DISHES[id].e, cookTime: DISHES[id].t, points: DISHES[id].p };
      return a;
    }, {}),

    maxTime: shiftSecondsForLevel(level, opts.fast),
    timeRemaining: shiftSecondsForLevel(level, opts.fast),
    basePatience: patienceForLevel(level),
    concurrent: concurrentForLevel(level),
    totalCustomers: totalCustomersForLevel(level),
    maxWalkouts: walkoutBudget(totalCustomersForLevel(level)),

    paused: false,
    pausedBy: null,

    spawned: 0, served: 0, missed: 0, walkouts: 0,
    customers: [],
    dirty: [],            // { id, seat } — plates left on tables
    stations: {},
    owners: {},           // stationId -> playerId
    kitchens: {},         // playerId -> { clean, max, washing[] }
    scores: {}, tips: {}, combos: {}, bestCombo: {},
    events: [], over: false, failed: false,
    nextCustomerId: 1, nextPlateId: 1, spawnCooldown: 0,
  };

  (opts.playerIds || []).forEach((pid) => {
    const upg = (opts.upgrades && opts.upgrades[pid]) || {};
    addPlayer(match, pid, upg, (opts.genders && opts.genders[pid]) || "male");
  });

  for (let i = 0; i < Math.min(match.concurrent, 2); i++) spawnCustomer(match);
  return match;
}

function makeStation(match, id, owner, upgrades, gender, isHelper) {
  match.stations[id] = {
    id, owner, isHelper: !!isHelper, gender: gender === "female" ? "female" : "male",
    upgrades: Object.assign(
      { stove: 0, pass: 0, burner: 0, shoes: 0, charm: 0, chairs: 0, crockery: 0, sink: 0,
        helper: 0, helperSpeed: 0, helperSkill: 0 },
      upgrades || {}
    ),
    cooking: [], tray: [], dirty: [],
    x: isHelper ? 3.2 : 0, z: KITCHEN_Z - 0.9,
    ai: isHelper ? { goal: null, cool: 0 } : null,
  };
  match.owners[id] = owner;
}

function addPlayer(match, pid, upgrades, gender) {
  if (match.stations[pid]) return;
  makeStation(match, pid, pid, upgrades, gender, false);
  match.kitchens[pid] = { clean: plateStock(upgrades), max: plateStock(upgrades), washing: [] };
  match.scores[pid] = 0;
  match.tips[pid] = 0;
  match.combos[pid] = 0;
  match.bestCombo[pid] = 0;
  if ((upgrades && upgrades.helper) > 0) {
    makeStation(match, pid + ":helper", pid, upgrades, gender === "female" ? "male" : "female", true);
  }
}

/** A shared kitchen in co-op: everyone draws from the host's plate pool. */
function kitchenFor(match, stationId) {
  const owner = match.owners[stationId];
  if (match.mode === "versus") return match.kitchens[owner];
  const first = Object.keys(match.kitchens)[0];
  return match.kitchens[first] || match.kitchens[owner];
}

function freeSeats(match) {
  const busy = new Set(match.customers.filter((c) => c.state === "waiting").map((c) => c.seat));
  match.dirty.forEach((d) => busy.add(d.seat));
  return SEATS.map((_, i) => i).filter((i) => !busy.has(i));
}

function spawnCustomer(match) {
  if (match.spawned >= match.totalCustomers) return null;
  const seats = freeSeats(match);
  const waiting = match.customers.filter((c) => c.state === "waiting").length;
  if (!seats.length || waiting >= match.concurrent) return null;

  const seat = seats[Math.floor(match.rng() * seats.length)];
  const dish = match.menu[Math.floor(match.rng() * match.menu.length)];
  const modKey = rollModifier(match.level, match.rng);
  const mod = MODIFIERS[modKey];

  let chairBoost = 0;
  Object.values(match.stations).forEach((s) => { chairBoost = Math.max(chairBoost, up(s, "chairs")); });
  const patience = match.basePatience * mod.wait * (1 + chairBoost * 0.10);

  let owner = null;
  if (match.mode === "versus") {
    const pids = Object.keys(match.kitchens);
    if (pids.length) owner = pids[match.spawned % pids.length];
  }

  const c = {
    id: match.nextCustomerId++, seat, dish, emoji: DISHES[dish].e,
    mod: modKey, badge: mod.badge, state: "waiting",
    patience, maxPatience: patience, owner, mood: 1,
  };
  match.customers.push(c);
  match.spawned++;
  return c;
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
const atSink = (st) => dist(st.x, st.z, SINK.x, SINK.z) <= 3.2;

function startCook(match, sid, dishId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  if (match.paused) return { ok: false, reason: "paused" };
  const st = match.stations[sid];
  if (!st) return { ok: false, reason: "no_station" };
  if (!atStove(st)) return { ok: false, reason: "too_far_from_stove" };
  if (st.cooking.length >= cookSlots(st)) return { ok: false, reason: "already_cooking" };
  if (st.tray.length + st.cooking.length >= trayCap(st)) return { ok: false, reason: "tray_full" };
  if (!match.menu.includes(dishId)) return { ok: false, reason: "not_on_menu" };

  const k = kitchenFor(match, sid);
  if (!k || k.clean <= 0) return { ok: false, reason: "no_plates" };

  k.clean -= 1;                                   // the plate is committed to this dish
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

  const seat = SEATS[c.seat];
  if (dist(st.x, st.z, seat.x, seat.z) > SERVE_RANGE) return { ok: false, reason: "too_far", seat: c.seat };

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
  const points = Math.round(base * (0.55 + 0.45 * ratio)) + comboBonus;
  const tip = Math.round(base * 0.16 * (0.4 + 0.6 * ratio) * tipScale(st));

  match.scores[owner] += points;
  match.tips[owner] += tip;
  match.served++;

  match.events.push({
    type: "served", stationId: sid, playerId: owner, byHelper: st.isHelper,
    customerId: c.id, seat: c.seat, dish: c.dish, mod: c.mod,
    points, tip, combo: match.combos[owner], perfect: ratio > 0.6,
  });
  return { ok: true, points, tip, combo: match.combos[owner] };
}

/** Collect the dirty plate left on a table. */
function busTable(match, sid, seat) {
  if (match.over || match.paused) return { ok: false, reason: "paused" };
  const st = match.stations[sid];
  if (!st) return { ok: false, reason: "no_station" };
  if (st.dirty.length >= DIRTY_CARRY) return { ok: false, reason: "hands_full" };

  const i = match.dirty.findIndex((d) => d.seat === seat);
  if (i === -1) return { ok: false, reason: "nothing_there" };
  const s = SEATS[seat];
  if (dist(st.x, st.z, s.x, s.z) > BUS_RANGE) return { ok: false, reason: "too_far", seat };

  const plate = match.dirty.splice(i, 1)[0];
  st.dirty.push(plate.id);
  match.events.push({ type: "bussed", stationId: sid, playerId: match.owners[sid], seat });
  return { ok: true };
}

/** Drop everything you're carrying into the sink. */
function dropAtSink(match, sid) {
  const st = match.stations[sid];
  if (!st || !st.dirty.length) return { ok: false, reason: "nothing_to_wash" };
  if (!atSink(st)) return { ok: false, reason: "not_at_sink" };
  const k = kitchenFor(match, sid);
  const t = washTime(st.upgrades);
  const n = st.dirty.length;
  st.dirty.forEach(() => k.washing.push({ remaining: t }));
  st.dirty = [];
  match.events.push({ type: "washing", stationId: sid, playerId: match.owners[sid], count: n });
  return { ok: true, count: n };
}

/** Bin a cooked dish nobody wants any more. The plate goes straight to the sink. */
function toss(match, sid, index) {
  const st = match.stations[sid];
  if (!st || !st.tray.length) return { ok: false, reason: "tray_empty" };
  const i = clamp(parseInt(index, 10) || 0, 0, st.tray.length - 1);
  const dish = st.tray.splice(i, 1)[0];
  const k = kitchenFor(match, sid);
  k.washing.push({ remaining: washTime(st.upgrades) });
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
  const ai = st.ai;
  ai.cool = Math.max(0, ai.cool - dt);

  const speed = 6.4 * moveScale(st) * dt;
  const walk = (tx, tz) => stepToward(st, tx, tz, speed);

  const mine = match.customers
    .filter((c) => c.state === "waiting" && (match.mode !== "versus" || !c.owner || c.owner === owner))
    .sort((a, b) => a.patience - b.patience);

  // 1. hands full of dirty plates → sink
  if (st.dirty.length >= DIRTY_CARRY) {
    if (walk(SINK.x, SINK.z + 1.6)) dropAtSink(match, st.id);
    return;
  }

  // 2. holding a dish someone ordered → deliver it
  const deliver = mine.find((c) => st.tray.includes(c.dish));
  if (deliver) {
    const s = SEATS[deliver.seat];
    if (dist(st.x, st.z, s.x, s.z) <= SERVE_RANGE) serve(match, st.id, deliver.id);
    else walk(s.x, s.z - 2.2);
    return;
  }

  // 3. a table needs clearing and we're free
  const plate = match.dirty[0];
  if (plate && !st.tray.length) {
    const s = SEATS[plate.seat];
    if (dist(st.x, st.z, s.x, s.z) <= BUS_RANGE) busTable(match, st.id, plate.seat);
    else walk(s.x, s.z - 2.2);
    return;
  }

  // 4. otherwise cook the most urgent thing we aren't already making
  const busy = st.cooking.length >= cookSlots(st);
  const full = st.tray.length + st.cooking.length >= trayCap(st);
  if (!busy && !full && mine.length) {
    const want = mine.find((c) => !st.tray.includes(c.dish) && !st.cooking.some((j) => j.dish === c.dish));
    if (want) {
      if (atStove(st)) { if (!ai.cool) { startCook(match, st.id, want.dish); ai.cool = 0.25; } }
      else walk(clamp(st.x, -8, 8), KITCHEN_Z - 1);
      return;
    }
  }

  // 5. carrying leftovers with nowhere to go → take them to the sink
  if (st.dirty.length && !mine.length) {
    if (walk(SINK.x, SINK.z + 1.6)) dropAtSink(match, st.id);
    return;
  }

  if (st.z > KITCHEN_Z) walk(clamp(st.x, -8, 8), KITCHEN_Z - 1);
}

/* -------------------------------------------------------------------- tick */

function tick(match, dt) {
  if (match.over || match.paused) return;

  match.timeRemaining = Math.max(0, match.timeRemaining - dt);

  // washing up
  Object.values(match.kitchens).forEach((k) => {
    for (let i = k.washing.length - 1; i >= 0; i--) {
      k.washing[i].remaining -= dt;
      if (k.washing[i].remaining <= 0) { k.washing.splice(i, 1); k.clean = Math.min(k.max, k.clean + 1); }
    }
  });

  // stoves
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
          kitchenFor(match, sid).washing.push({ remaining: washTime(st.upgrades) });
          match.events.push({ type: "burned", stationId: sid, playerId: match.owners[sid], dish: job.dish });
        }
      }
    }
    if (st.isHelper) helperThink(match, st, dt);
    if (st.dirty.length && atSink(st) && !st.isHelper) dropAtSink(match, sid); // auto drop-off
  }

  // customers
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
          type: "walked_out", customerId: c.id, seat: c.seat, dish: c.dish,
          walkouts: match.walkouts, limit: match.maxWalkouts,
        });
      }
    } else if (c.state === "eating") {
      c.eatFor -= dt;
      if (c.eatFor <= 0) {
        c.state = "done"; c.departAt = 1.0;
        match.dirty.push({ id: match.nextPlateId++, seat: c.seat });
        match.events.push({ type: "left_plate", seat: c.seat });
      }
    } else {
      c.departAt -= dt;
    }
  }
  match.customers = match.customers.filter(
    (c) => c.state === "waiting" || c.state === "eating" || c.departAt > 0
  );

  // seating
  match.spawnCooldown -= dt;
  if (match.spawnCooldown <= 0) {
    const waiting = match.customers.filter((c) => c.state === "waiting").length;
    if (waiting < match.concurrent && match.spawned < match.totalCustomers) {
      const s = spawnCustomer(match);
      if (s) match.events.push({ type: "arrived", customerId: s.id, seat: s.seat, dish: s.dish });
      match.spawnCooldown = Math.max(0.8, 2.4 - match.level * 0.012) + match.rng();
    } else match.spawnCooldown = 0.5;
  }

  // end of shift
  if (match.walkouts >= match.maxWalkouts) {
    match.over = true; match.failed = true;
    match.events.push({ type: "shift_over", reason: "walkouts" });
    return;
  }
  const allDone = match.spawned >= match.totalCustomers &&
    match.customers.every((c) => c.state !== "waiting");
  if (match.timeRemaining <= 0 || allDone) {
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
    seats: SEATS, obstacles: OBSTACLES, floor: FLOOR,
    serveRange: SERVE_RANGE, busRange: BUS_RANGE, kitchenZ: KITCHEN_Z,
    sink: SINK, bodyRadius: BODY_R,
    timeRemaining: Math.ceil(match.timeRemaining), maxTime: match.maxTime,
    served: match.served, missed: match.missed,
    walkouts: match.walkouts, maxWalkouts: match.maxWalkouts,
    totalCustomers: match.totalCustomers,
    paused: match.paused, pausedBy: match.pausedBy,
    scores: match.scores, tips: match.tips, combos: match.combos,
    over: match.over, failed: match.failed,
    dirty: match.dirty.map((d) => ({ id: d.id, seat: d.seat })),
    kitchens: Object.keys(match.kitchens).reduce((a, pid) => {
      const k = match.kitchens[pid];
      a[pid] = { clean: k.clean, max: k.max, washing: k.washing.length };
      return a;
    }, {}),
    customers: match.customers.map((c) => ({
      id: c.id, seat: c.seat, dish: c.dish, emoji: c.emoji, mod: c.mod, badge: c.badge,
      state: c.state, owner: c.owner, mood: clamp(c.mood, 0, 1),
      patience: Math.max(0, Math.ceil(c.patience)),
    })),
    stations: Object.keys(match.stations).reduce((a, sid) => {
      const st = match.stations[sid];
      a[sid] = {
        id: sid, owner: st.owner, isHelper: st.isHelper, gender: st.gender,
        x: Math.round(st.x * 100) / 100, z: Math.round(st.z * 100) / 100,
        trayCap: trayCap(st), cookSlots: cookSlots(st), moveScale: moveScale(st),
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
  DISHES, MODIFIERS, UPGRADES, SEATS, OBSTACLES, FLOOR, KITCHEN_Z, SINK,
  SERVE_RANGE, BUS_RANGE, BODY_R, DIRTY_CARRY, MAX_WALKOUTS, PASS_ACCURACY,
  createMatch, addPlayer, moveTo, startCook, serve, busTable, dropAtSink, toss,
  setPause, tick, drainEvents, snapshot, results, resolveCollision, stepToward,
  buyUpgrade, upgradeCost, shopFor, trayCap, cookSlots, plateStock,
};

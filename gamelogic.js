"use strict";

const { DISHES, MODIFIERS, UPGRADES, venueForLevel, menuForLevel, rollModifier } = require("./dishes");

/* ------------------------------------------------------------------ world */

/** Where the six tables sit. Shared by server (range checks) and client (3D). */
const SEATS = [
  { x: -6.2, z: 1.5 }, { x: 0, z: 1.5 }, { x: 6.2, z: 1.5 },
  { x: -6.2, z: 6.5 }, { x: 0, z: 6.5 }, { x: 6.2, z: 6.5 },
];

const FLOOR = { minX: -14.5, maxX: 14.5, minZ: -6.5, maxZ: 9.5 };
const KITCHEN_Z = -4.6;   // stand at or behind this line to work the stove
const SERVE_RANGE = 3.4;  // how close you must be to hand over a plate
const MAX_SPEED = 16;     // server-side sanity clamp (units/sec)
const MISS_PENALTY = 25;

/* ---------------------------------------------------------------- helpers */

const dist = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

function up(station, key) {
  return (station.upgrades && station.upgrades[key]) || 0;
}
function trayCap(station) { return 3 + up(station, "pass"); }
function cookSlots(station) { return 1 + up(station, "burner"); }
function cookScale(station) { return Math.pow(0.88, up(station, "stove")); }
function tipScale(station) { return 1 + up(station, "charm") * 0.30; }
function moveScale(station) { return 1 + up(station, "shoes") * 0.16; }

function patienceForLevel(level) { return Math.max(15, 34 - Math.floor(level / 6) * 2); }
function concurrentForLevel(level) { return Math.min(SEATS.length, 2 + Math.floor(level / 10)); }
function totalCustomersForLevel(level) { return 8 + Math.floor(level / 5); }
function shiftSecondsForLevel(level, fast) {
  if (fast) return 30;
  return Math.min(210, 95 + Math.floor(level / 6) * 10);
}

/* ------------------------------------------------------------------ match */

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

    spawned: 0, served: 0, missed: 0,
    customers: [],
    stations: {},
    scores: {},
    tips: {},
    combos: {},
    bestCombo: {},
    events: [],
    over: false,
    nextCustomerId: 1,
    spawnCooldown: 0,
  };

  (opts.playerIds || []).forEach((pid) => {
    addPlayer(match, pid, (opts.upgrades && opts.upgrades[pid]) || {});
  });

  for (let i = 0; i < Math.min(match.concurrent, 2); i++) spawnCustomer(match);
  return match;
}

function addPlayer(match, pid, upgrades) {
  if (match.stations[pid]) return;
  match.stations[pid] = {
    upgrades: Object.assign(
      { stove: 0, pass: 0, burner: 0, shoes: 0, charm: 0, chairs: 0 },
      upgrades || {}
    ),
    cooking: [],
    tray: [],
    x: 0,
    z: -5.2,
  };
  match.scores[pid] = 0;
  match.tips[pid] = 0;
  match.combos[pid] = 0;
  match.bestCombo[pid] = 0;
}

function freeSeats(match) {
  const taken = new Set(match.customers.filter((c) => c.state === "waiting").map((c) => c.seat));
  return SEATS.map((_, i) => i).filter((i) => !taken.has(i));
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

  // "Comfier chairs" is a team perk — take the best chair upgrade in the kitchen.
  let chairBoost = 0;
  Object.values(match.stations).forEach((s) => { chairBoost = Math.max(chairBoost, up(s, "chairs")); });
  const patience = match.basePatience * mod.wait * (1 + chairBoost * 0.10);

  let owner = null;
  if (match.mode === "versus") {
    const ids = Object.keys(match.stations);
    if (ids.length) owner = ids[match.spawned % ids.length];
  }

  const c = {
    id: match.nextCustomerId++,
    seat, dish,
    emoji: DISHES[dish].e,
    mod: modKey,
    badge: mod.badge,
    state: "waiting",
    patience, maxPatience: patience,
    owner, mood: 1,
  };
  match.customers.push(c);
  match.spawned++;
  return c;
}

/* ---------------------------------------------------------------- actions */

/** Client tells us where its chef is. We sanity-check rather than trust it. */
function moveTo(match, pid, x, z, dt) {
  const st = match.stations[pid];
  if (!st) return false;
  const nx = clamp(Number(x) || 0, FLOOR.minX, FLOOR.maxX);
  const nz = clamp(Number(z) || 0, FLOOR.minZ, FLOOR.maxZ);
  const allowed = MAX_SPEED * moveScale(st) * Math.max(0.05, dt || 0.2) + 1.5;
  const d = dist(st.x, st.z, nx, nz);
  if (d > allowed) {
    // Too far for the time elapsed — drag them toward the claim, don't teleport.
    st.x += ((nx - st.x) / d) * allowed;
    st.z += ((nz - st.z) / d) * allowed;
    return false;
  }
  st.x = nx; st.z = nz;
  return true;
}

function atStove(st) { return st.z <= KITCHEN_Z; }

function startCook(match, pid, dishId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  const st = match.stations[pid];
  if (!st) return { ok: false, reason: "no_station" };
  if (!atStove(st)) return { ok: false, reason: "too_far_from_stove" };
  if (st.cooking.length >= cookSlots(st)) return { ok: false, reason: "already_cooking" };
  if (st.tray.length + st.cooking.length >= trayCap(st)) return { ok: false, reason: "tray_full" };
  if (!match.menu.includes(dishId)) return { ok: false, reason: "not_on_menu" };

  const time = DISHES[dishId].t * cookScale(st);
  st.cooking.push({ dish: dishId, emoji: DISHES[dishId].e, remaining: time, total: time });
  return { ok: true, dish: dishId };
}

function serve(match, pid, customerId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  const st = match.stations[pid];
  if (!st) return { ok: false, reason: "no_station" };

  const c = match.customers.find((x) => x.id === customerId);
  if (!c || c.state !== "waiting") return { ok: false, reason: "gone" };
  if (match.mode === "versus" && c.owner && c.owner !== pid) return { ok: false, reason: "not_your_table" };

  const seat = SEATS[c.seat];
  if (dist(st.x, st.z, seat.x, seat.z) > SERVE_RANGE) {
    return { ok: false, reason: "too_far", seat: c.seat };
  }

  const idx = st.tray.indexOf(c.dish);
  if (idx === -1) return { ok: false, reason: "need_dish", need: c.dish };

  st.tray.splice(idx, 1);
  c.state = "served";
  c.departAt = 1.3;

  const ratio = clamp(c.patience / c.maxPatience, 0, 1);
  const mod = MODIFIERS[c.mod];
  const base = DISHES[c.dish].p * mod.pay;

  match.combos[pid] += 1;
  match.bestCombo[pid] = Math.max(match.bestCombo[pid], match.combos[pid]);
  const comboBonus = Math.min(80, (match.combos[pid] - 1) * 12);
  const points = Math.round(base * (0.55 + 0.45 * ratio)) + comboBonus;
  const tip = Math.round(base * 0.16 * (0.4 + 0.6 * ratio) * tipScale(st));

  match.scores[pid] += points;
  match.tips[pid] += tip;
  match.served++;

  match.events.push({
    type: "served", playerId: pid, customerId: c.id, seat: c.seat,
    dish: c.dish, mod: c.mod, points, tip, combo: match.combos[pid],
    perfect: ratio > 0.6,
  });
  return { ok: true, points, tip, combo: match.combos[pid] };
}

function discard(match, pid) {
  const st = match.stations[pid];
  if (!st || !st.tray.length) return { ok: false, reason: "tray_empty" };
  const dish = st.tray.shift();
  match.events.push({ type: "binned", playerId: pid, dish });
  return { ok: true, dish };
}

/* ------------------------------------------------------------------- tick */

function tick(match, dt) {
  if (match.over) return;

  match.timeRemaining = Math.max(0, match.timeRemaining - dt);

  for (const pid of Object.keys(match.stations)) {
    const st = match.stations[pid];
    for (let i = st.cooking.length - 1; i >= 0; i--) {
      const job = st.cooking[i];
      job.remaining -= dt;
      if (job.remaining <= 0) {
        st.cooking.splice(i, 1);
        if (st.tray.length < trayCap(st)) {
          st.tray.push(job.dish);
          match.events.push({ type: "plated", playerId: pid, dish: job.dish });
        } else {
          match.events.push({ type: "burned", playerId: pid, dish: job.dish });
        }
      }
    }
  }

  for (const c of match.customers) {
    if (c.state === "waiting") {
      c.patience = Math.max(0, c.patience - dt);
      c.mood = c.patience / c.maxPatience;
      if (c.patience <= 0) {
        c.state = "left";
        c.departAt = 0.9;
        match.missed++;
        const targets = match.mode === "versus" && c.owner ? [c.owner] : Object.keys(match.scores);
        targets.forEach((pid) => {
          match.scores[pid] = Math.max(0, match.scores[pid] - MISS_PENALTY);
          match.combos[pid] = 0;
        });
        match.events.push({ type: "walked_out", customerId: c.id, seat: c.seat, dish: c.dish });
      }
    } else {
      c.departAt -= dt;
    }
  }
  match.customers = match.customers.filter((c) => c.state === "waiting" || c.departAt > 0);

  match.spawnCooldown -= dt;
  if (match.spawnCooldown <= 0) {
    const waiting = match.customers.filter((c) => c.state === "waiting").length;
    if (waiting < match.concurrent && match.spawned < match.totalCustomers) {
      const s = spawnCustomer(match);
      if (s) match.events.push({ type: "arrived", customerId: s.id, seat: s.seat, dish: s.dish });
      match.spawnCooldown = Math.max(0.8, 2.4 - match.level * 0.012) + match.rng();
    } else {
      match.spawnCooldown = 0.5;
    }
  }

  const allDone = match.spawned >= match.totalCustomers &&
    match.customers.every((c) => c.state !== "waiting");
  if (match.timeRemaining <= 0 || allDone) {
    match.over = true;
    match.events.push({ type: "shift_over" });
  }
}

function drainEvents(match) {
  const out = match.events;
  match.events = [];
  return out;
}

/* --------------------------------------------------------------- snapshot */

function snapshot(match) {
  return {
    level: match.level,
    mode: match.mode,
    venue: match.venue,
    menu: match.menu,
    dishes: match.dishes,
    modifiers: MODIFIERS,
    seats: SEATS,
    serveRange: SERVE_RANGE,
    kitchenZ: KITCHEN_Z,
    floor: FLOOR,
    timeRemaining: Math.ceil(match.timeRemaining),
    maxTime: match.maxTime,
    served: match.served,
    missed: match.missed,
    totalCustomers: match.totalCustomers,
    scores: match.scores,
    tips: match.tips,
    combos: match.combos,
    over: match.over,
    customers: match.customers.map((c) => ({
      id: c.id, seat: c.seat, dish: c.dish, emoji: c.emoji,
      mod: c.mod, badge: c.badge, state: c.state, owner: c.owner,
      mood: clamp(c.mood, 0, 1), patience: Math.max(0, Math.ceil(c.patience)),
    })),
    stations: Object.keys(match.stations).reduce((a, pid) => {
      const st = match.stations[pid];
      a[pid] = {
        x: Math.round(st.x * 100) / 100,
        z: Math.round(st.z * 100) / 100,
        trayCap: trayCap(st),
        cookSlots: cookSlots(st),
        moveScale: moveScale(st),
        tray: st.tray.slice(),
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
  const accuracy = match.totalCustomers ? Math.round((match.served / match.totalCustomers) * 100) : 0;
  let stars = 0;
  if (accuracy >= 45) stars = 1;
  if (accuracy >= 70) stars = 2;
  if (accuracy >= 90) stars = 3;

  let winner = null;
  if (match.mode === "versus" && ids.length) {
    winner = ids.reduce((a, b) => (match.scores[a] >= match.scores[b] ? a : b));
  }

  return {
    mode: match.mode, level: match.level, venue: match.venue,
    scores: match.scores, tips: match.tips, bestCombo: match.bestCombo,
    teamScore, served: match.served, missed: match.missed,
    totalCustomers: match.totalCustomers, accuracy, stars, winner,
    passed: stars >= 1,
  };
}

/* --------------------------------------------------------------- upgrades */

function upgradeCost(key, level) {
  const u = UPGRADES[key];
  if (!u || level >= u.max) return null;
  return u.cost(level);
}

function buyUpgrade(wallet, upgrades, key) {
  const u = UPGRADES[key];
  if (!u) return { ok: false, reason: "unknown" };
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
    return {
      key, name: u.name, emoji: u.emoji, level: lvl, max: u.max,
      cost: lvl >= u.max ? null : u.cost(lvl),
      blurb: lvl >= u.max ? "Fully upgraded" : u.blurb(lvl),
    };
  });
}

module.exports = {
  DISHES, MODIFIERS, UPGRADES, SEATS, FLOOR, KITCHEN_Z, SERVE_RANGE,
  createMatch, addPlayer, moveTo, startCook, serve, discard,
  tick, drainEvents, snapshot, results,
  buyUpgrade, upgradeCost, shopFor,
  trayCap, cookSlots,
};

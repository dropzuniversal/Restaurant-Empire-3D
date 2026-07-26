"use strict";

/**
 * gamelogic.js
 * Pure game logic. No sockets, no express, no DOM.
 * This makes the whole game loop unit-testable (see test-simulate.js).
 */

// ---------------------------------------------------------------- dishes

const DISHES = {
  burger: { name: "Burger",  emoji: "🍔", cookTime: 3.5, points: 100 },
  fries:  { name: "Fries",   emoji: "🍟", cookTime: 2.0, points: 60  },
  salad:  { name: "Salad",   emoji: "🥗", cookTime: 1.5, points: 50  },
  pizza:  { name: "Pizza",   emoji: "🍕", cookTime: 5.0, points: 140 },
  pasta:  { name: "Pasta",   emoji: "🍝", cookTime: 4.0, points: 120 },
  sushi:  { name: "Sushi",   emoji: "🍣", cookTime: 4.5, points: 130 },
  ramen:  { name: "Ramen",   emoji: "🍜", cookTime: 5.5, points: 150 },
  taco:   { name: "Taco",    emoji: "🌮", cookTime: 2.5, points: 80  },
  fish:   { name: "Fish",    emoji: "🐟", cookTime: 4.0, points: 120 },
  steak:  { name: "Steak",   emoji: "🥩", cookTime: 6.0, points: 180 },
  coffee: { name: "Coffee",  emoji: "☕", cookTime: 1.5, points: 45  },
  cake:   { name: "Cake",    emoji: "🍰", cookTime: 3.0, points: 95  },
};

// ---------------------------------------------------------------- venues

// Each venue has its own menu. More dishes = harder (more to remember/juggle).
const RESTAURANTS = [
  { id: 0, name: "Family Diner",    emoji: "🍔", from: 1,  to: 10,  menu: ["burger", "fries", "coffee"] },
  { id: 1, name: "Burger Joint",    emoji: "🍟", from: 11, to: 20,  menu: ["burger", "fries", "salad", "coffee"] },
  { id: 2, name: "Pizza Place",     emoji: "🍕", from: 21, to: 30,  menu: ["pizza", "salad", "pasta", "coffee"] },
  { id: 3, name: "Sushi Bar",       emoji: "🍣", from: 31, to: 40,  menu: ["sushi", "ramen", "salad"] },
  { id: 4, name: "Taco Stand",      emoji: "🌮", from: 41, to: 50,  menu: ["taco", "fries", "salad", "coffee"] },
  { id: 5, name: "Fish & Chips",    emoji: "🐟", from: 51, to: 60,  menu: ["fish", "fries", "salad", "cake"] },
  { id: 6, name: "Steakhouse",      emoji: "🥩", from: 61, to: 70,  menu: ["steak", "salad", "cake", "coffee"] },
  { id: 7, name: "Italian Kitchen", emoji: "🍝", from: 71, to: 80,  menu: ["pasta", "pizza", "salad", "cake", "coffee"] },
  { id: 8, name: "Luxury Buffet",   emoji: "🍽️", from: 81, to: 90,  menu: ["steak", "sushi", "pasta", "cake", "salad"] },
  { id: 9, name: "Five-Star",       emoji: "👨‍🍳", from: 91, to: 100, menu: ["steak", "sushi", "ramen", "cake", "pizza", "coffee"] },
];

const SEATS = 6;          // physical tables in the 3D room
const TRAY_CAPACITY = 3;  // ready plates a cook can hold
const MISS_PENALTY = 25;

function restaurantForLevel(level) {
  return RESTAURANTS.find((r) => level >= r.from && level <= r.to) || RESTAURANTS[0];
}

/** Seconds a customer will wait before storming out. Shrinks as levels rise. */
function patienceForLevel(level) {
  return Math.max(14, 30 - Math.floor(level / 6) * 2);
}

/** How many customers can be seated at once. */
function concurrentForLevel(level) {
  return Math.min(SEATS, 2 + Math.floor(level / 12));
}

/** Total customers that will visit during the shift. */
function totalCustomersForLevel(level) {
  return 8 + Math.floor(level / 4);
}

/** Shift length in seconds. */
function shiftSecondsForLevel(level, fast) {
  if (fast) return 30;
  return Math.min(180, 90 + Math.floor(level / 8) * 10);
}

// ---------------------------------------------------------------- match

/**
 * Create a fresh match.
 * @param {object} opts
 * @param {number} opts.level
 * @param {"co-op"|"versus"} opts.mode
 * @param {string[]} opts.playerIds
 * @param {boolean} [opts.fast]
 * @param {() => number} [opts.rng] injectable RNG so tests are deterministic
 */
function createMatch(opts) {
  const level = Math.min(100, Math.max(1, opts.level | 0 || 1));
  const mode = opts.mode === "versus" ? "versus" : "co-op";
  const playerIds = opts.playerIds.slice();
  const restaurant = restaurantForLevel(level);
  const rng = opts.rng || Math.random;

  const match = {
    level,
    mode,
    rng,
    restaurant: {
      id: restaurant.id,
      name: restaurant.name,
      emoji: restaurant.emoji,
      menu: restaurant.menu.slice(),
    },
    menu: restaurant.menu.slice(),
    dishes: restaurant.menu.reduce((acc, id) => {
      acc[id] = { id, ...DISHES[id] };
      return acc;
    }, {}),

    maxTime: shiftSecondsForLevel(level, opts.fast),
    timeRemaining: shiftSecondsForLevel(level, opts.fast),

    patience: patienceForLevel(level),
    concurrent: concurrentForLevel(level),
    totalCustomers: totalCustomersForLevel(level),

    spawned: 0,
    served: 0,
    missed: 0,

    customers: [],          // active + recently-departed (departed pruned each tick)
    stations: {},           // playerId -> { cooking, tray }
    scores: {},             // playerId -> number
    combos: {},             // playerId -> consecutive on-time serves
    events: [],             // transient feed, drained each tick
    over: false,
    nextCustomerId: 1,
    spawnCooldown: 0,
  };

  playerIds.forEach((pid) => {
    match.stations[pid] = { cooking: null, tray: [] };
    match.scores[pid] = 0;
    match.combos[pid] = 0;
  });

  // Seat the opening rush immediately so the player has something to do at t=0.
  const opening = Math.min(match.concurrent, 2);
  for (let i = 0; i < opening; i++) spawnCustomer(match);

  return match;
}

function addPlayer(match, playerId) {
  if (!match.stations[playerId]) {
    match.stations[playerId] = { cooking: null, tray: [] };
    match.scores[playerId] = 0;
    match.combos[playerId] = 0;
  }
}

function freeSeats(match) {
  const taken = new Set(
    match.customers.filter((c) => c.state === "waiting").map((c) => c.seat)
  );
  const out = [];
  for (let s = 0; s < SEATS; s++) if (!taken.has(s)) out.push(s);
  return out;
}

function spawnCustomer(match) {
  if (match.spawned >= match.totalCustomers) return null;
  const seats = freeSeats(match);
  const waiting = match.customers.filter((c) => c.state === "waiting").length;
  if (!seats.length || waiting >= match.concurrent) return null;

  const seat = seats[Math.floor(match.rng() * seats.length)];
  const dish = match.menu[Math.floor(match.rng() * match.menu.length)];

  // In versus each cook gets their own ticket stream so scores are comparable.
  let owner = null;
  if (match.mode === "versus") {
    const ids = Object.keys(match.stations);
    if (ids.length) owner = ids[match.spawned % ids.length];
  }

  const customer = {
    id: match.nextCustomerId++,
    seat,
    dish,
    emoji: DISHES[dish].emoji,
    state: "waiting",
    patience: match.patience,
    maxPatience: match.patience,
    owner,
    mood: 1,
  };

  match.customers.push(customer);
  match.spawned++;
  return customer;
}

/** Start cooking a dish at this player's station. Returns {ok, reason}. */
function startCook(match, playerId, dishId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  const st = match.stations[playerId];
  if (!st) return { ok: false, reason: "no_station" };
  if (st.cooking) return { ok: false, reason: "already_cooking" };
  if (st.tray.length >= TRAY_CAPACITY) return { ok: false, reason: "tray_full" };
  if (!match.menu.includes(dishId)) return { ok: false, reason: "not_on_menu" };

  const d = DISHES[dishId];
  st.cooking = { dish: dishId, emoji: d.emoji, remaining: d.cookTime, total: d.cookTime };
  return { ok: true, dish: dishId };
}

/** Serve a plate from the tray to a specific customer. Returns {ok, reason, points}. */
function serve(match, playerId, customerId) {
  if (match.over) return { ok: false, reason: "shift_over" };
  const st = match.stations[playerId];
  if (!st) return { ok: false, reason: "no_station" };

  const c = match.customers.find((x) => x.id === customerId);
  if (!c) return { ok: false, reason: "gone" };
  if (c.state !== "waiting") return { ok: false, reason: "gone" };
  if (match.mode === "versus" && c.owner && c.owner !== playerId) {
    return { ok: false, reason: "not_your_table" };
  }

  const idx = st.tray.indexOf(c.dish);
  if (idx === -1) return { ok: false, reason: "need_dish", need: c.dish };

  st.tray.splice(idx, 1);
  c.state = "served";
  c.departAt = 1.2; // linger briefly so the player sees the happy customer

  const ratio = Math.max(0, c.patience / c.maxPatience);
  const base = DISHES[c.dish].points;
  match.combos[playerId] = (match.combos[playerId] || 0) + 1;
  const comboBonus = Math.min(50, (match.combos[playerId] - 1) * 10);
  const points = Math.round(base * (0.5 + 0.5 * ratio)) + comboBonus;

  match.scores[playerId] += points;
  match.served++;
  match.events.push({
    type: "served",
    playerId,
    customerId: c.id,
    dish: c.dish,
    points,
    combo: match.combos[playerId],
  });

  return { ok: true, points, combo: match.combos[playerId] };
}

/** Bin the oldest plate in the tray (lets a player unstick a full tray). */
function discard(match, playerId) {
  const st = match.stations[playerId];
  if (!st || !st.tray.length) return { ok: false, reason: "tray_empty" };
  const dish = st.tray.shift();
  return { ok: true, dish };
}

/**
 * Advance the match by dt seconds.
 * Returns the list of events that happened this tick.
 */
function tick(match, dt) {
  if (match.over) return [];

  // NOTE: events are intentionally NOT cleared here. Player actions (serve,
  // cook) happen between ticks and push events too; clearing here would
  // silently swallow them before the server ever broadcasts them.
  // The caller drains with drainEvents() after each broadcast.

  match.timeRemaining = Math.max(0, match.timeRemaining - dt);

  // --- cooking
  for (const pid of Object.keys(match.stations)) {
    const st = match.stations[pid];
    if (!st.cooking) continue;
    st.cooking.remaining -= dt;
    if (st.cooking.remaining <= 0) {
      const dish = st.cooking.dish;
      st.cooking = null;
      if (st.tray.length < TRAY_CAPACITY) {
        st.tray.push(dish);
        match.events.push({ type: "plated", playerId: pid, dish });
      } else {
        match.events.push({ type: "burned", playerId: pid, dish });
      }
    }
  }

  // --- customers
  for (const c of match.customers) {
    if (c.state === "waiting") {
      c.patience = Math.max(0, c.patience - dt);
      c.mood = c.patience / c.maxPatience;
      if (c.patience <= 0) {
        c.state = "left";
        c.departAt = 0.8;
        match.missed++;
        const target = match.mode === "versus" && c.owner ? c.owner : null;
        if (target) {
          match.scores[target] = Math.max(0, match.scores[target] - MISS_PENALTY);
          match.combos[target] = 0;
        } else {
          for (const pid of Object.keys(match.scores)) {
            match.scores[pid] = Math.max(0, match.scores[pid] - MISS_PENALTY);
            match.combos[pid] = 0;
          }
        }
        match.events.push({ type: "walked_out", customerId: c.id, dish: c.dish });
      }
    } else {
      c.departAt -= dt;
    }
  }

  // remove customers who have finished their departure animation
  match.customers = match.customers.filter(
    (c) => c.state === "waiting" || c.departAt > 0
  );

  // --- spawning
  match.spawnCooldown -= dt;
  if (match.spawnCooldown <= 0) {
    const waiting = match.customers.filter((c) => c.state === "waiting").length;
    if (waiting < match.concurrent && match.spawned < match.totalCustomers) {
      const spawned = spawnCustomer(match);
      if (spawned) match.events.push({ type: "arrived", customerId: spawned.id, dish: spawned.dish });
      match.spawnCooldown = 1.5 + match.rng() * 2;
    } else {
      match.spawnCooldown = 0.5;
    }
  }

  // --- end conditions
  const allGone =
    match.spawned >= match.totalCustomers &&
    match.customers.every((c) => c.state !== "waiting");
  if (match.timeRemaining <= 0 || allGone) {
    match.over = true;
    match.events.push({ type: "shift_over" });
  }

  return match.events;
}

/** Take everything queued since the last drain and clear the queue. */
function drainEvents(match) {
  const out = match.events;
  match.events = [];
  return out;
}

/** Small serialisable snapshot for the wire. */
function snapshot(match) {
  return {
    level: match.level,
    mode: match.mode,
    restaurant: match.restaurant,
    menu: match.menu,
    dishes: match.dishes,
    timeRemaining: Math.ceil(match.timeRemaining),
    maxTime: match.maxTime,
    served: match.served,
    missed: match.missed,
    totalCustomers: match.totalCustomers,
    scores: match.scores,
    combos: match.combos,
    over: match.over,
    trayCapacity: TRAY_CAPACITY,
    customers: match.customers.map((c) => ({
      id: c.id,
      seat: c.seat,
      dish: c.dish,
      emoji: c.emoji,
      state: c.state,
      owner: c.owner,
      mood: Math.max(0, Math.min(1, c.mood)),
      patience: Math.max(0, Math.ceil(c.patience)),
      maxPatience: c.maxPatience,
    })),
    stations: Object.keys(match.stations).reduce((acc, pid) => {
      const st = match.stations[pid];
      acc[pid] = {
        cooking: st.cooking
          ? {
              dish: st.cooking.dish,
              emoji: st.cooking.emoji,
              progress: 1 - st.cooking.remaining / st.cooking.total,
              remaining: Math.max(0, st.cooking.remaining),
            }
          : null,
        tray: st.tray.slice(),
      };
      return acc;
    }, {}),
  };
}

function results(match) {
  const scores = match.scores;
  const ids = Object.keys(scores);
  let winner = null;
  if (match.mode === "versus" && ids.length) {
    winner = ids.reduce((a, b) => (scores[a] >= scores[b] ? a : b));
  }
  const total = ids.reduce((sum, id) => sum + scores[id], 0);
  const accuracy = match.totalCustomers
    ? Math.round((match.served / match.totalCustomers) * 100)
    : 0;
  let stars = 0;
  if (accuracy >= 50) stars = 1;
  if (accuracy >= 70) stars = 2;
  if (accuracy >= 90) stars = 3;

  return {
    mode: match.mode,
    level: match.level,
    restaurant: match.restaurant,
    scores,
    teamScore: total,
    served: match.served,
    missed: match.missed,
    totalCustomers: match.totalCustomers,
    accuracy,
    stars,
    winner,
  };
}

module.exports = {
  DISHES,
  RESTAURANTS,
  SEATS,
  TRAY_CAPACITY,
  restaurantForLevel,
  createMatch,
  addPlayer,
  startCook,
  serve,
  discard,
  tick,
  drainEvents,
  snapshot,
  results,
};

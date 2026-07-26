"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const fs = require("fs");
const { Server } = require("socket.io");
const G = require("./gamelogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
  maxHttpBufferSize: 1e5,
});

const PORT = process.env.PORT || 3000;
const FAST_MODE = process.env.FAST_MODE === "1";
const SAVE_FILE = process.env.SAVE_FILE || "profiles.json";
const TICK_MS = 200;
const MAX_PLAYERS = 4;

/* ------------------------------------------------------------- profiles */

/**
 * Profiles are keyed by a random id the browser keeps in localStorage,
 * so your money and upgrades survive a refresh or a dropped connection.
 */
const profiles = new Map(); // pkey -> { name, wallet, best, upgrades }
const players = new Map();  // socketId -> { id, pkey, name, room }
const rooms = new Map();

function blankProfile(name) {
  return {
    name: name || "Cook",
    wallet: 0,
    lifetime: 0,
    best: 1,
    shifts: 0,
    gender: "male",
    upgrades: { stove: 0, pass: 0, burner: 0, shoes: 0, charm: 0, chairs: 0 },
  };
}

function loadProfiles() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE, "utf8"));
    Object.keys(raw).forEach((k) => profiles.set(k, Object.assign(blankProfile(), raw[k])));
    console.log(`loaded ${profiles.size} profiles`);
  } catch (e) {
    console.log("no profiles loaded:", e.message);
  }
}

let saveQueued = false;
function saveProfiles() {
  if (saveQueued) return;
  saveQueued = true;
  setTimeout(() => {
    saveQueued = false;
    try {
      const out = {};
      profiles.forEach((v, k) => { out[k] = v; });
      fs.writeFileSync(SAVE_FILE, JSON.stringify(out));
    } catch (e) {
      console.log("save failed:", e.message);
    }
  }, 1500);
}

const profileOf = (sid) => {
  const p = players.get(sid);
  return p ? profiles.get(p.pkey) : null;
};

function profilePayload(pkey) {
  const pr = profiles.get(pkey);
  if (!pr) return null;
  return {
    name: pr.name,
    wallet: pr.wallet,
    lifetime: pr.lifetime,
    best: pr.best,
    shifts: pr.shifts,
    upgrades: pr.upgrades,
    gender: pr.gender || "male",
    shop: G.shopFor(pr.upgrades),
  };
}

function pushProfile(sid) {
  const p = players.get(sid);
  if (p) io.to(sid).emit("profile", profilePayload(p.pkey));
}

/* ----------------------------------------------------------------- rooms */

function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c;
  do {
    c = "";
    for (let i = 0; i < 4; i++) c += chars[(Math.random() * chars.length) | 0];
  } while (rooms.has(c));
  return c;
}

function publicRooms() {
  return Array.from(rooms.values())
    .filter((r) => !r.match)
    .map((r) => ({
      code: r.code, mode: r.mode, level: r.level,
      players: r.players.length, maxPlayers: MAX_PLAYERS,
      host: players.get(r.host)?.name || "—",
    }));
}

function lobbyPayload(room) {
  return {
    code: room.code, mode: room.mode, level: room.level,
    hostId: room.host,
    players: room.players.map((id) => {
      const p = players.get(id);
      const pr = p && profiles.get(p.pkey);
      return { id, name: p ? p.name : "Cook", best: pr ? pr.best : 1, wallet: pr ? pr.wallet : 0 };
    }),
  };
}

function broadcastLobby(room) {
  const base = lobbyPayload(room);
  room.players.forEach((id) => io.to(id).emit("lobby", { ...base, youAreHost: id === room.host }));
  io.emit("rooms", publicRooms());
}

function leaveRoom(socket) {
  const p = players.get(socket.id);
  if (!p || !p.room) return;
  const room = rooms.get(p.room);
  p.room = null;
  if (!room) return;

  room.players = room.players.filter((id) => id !== socket.id);
  socket.leave("room:" + room.code);

  if (!room.players.length) {
    stopMatch(room);
    rooms.delete(room.code);
    io.emit("rooms", publicRooms());
    return;
  }
  if (room.host === socket.id) room.host = room.players[0];
  broadcastLobby(room);
}

/* ---------------------------------------------------------------- match */

function startMatch(room) {
  const upgrades = {};
  const names = {};
  const genders = {};
  room.players.forEach((id) => {
    const p = players.get(id);
    const pr = p && profiles.get(p.pkey);
    upgrades[id] = pr ? pr.upgrades : {};
    genders[id] = (pr && pr.gender) || "male";
    names[id] = p ? p.name : "Cook";
  });
  room.names = names;

  room.match = G.createMatch({
    level: room.level,
    mode: room.mode,
    playerIds: room.players.slice(),
    upgrades, genders,
    fast: FAST_MODE,
  });

  io.to("room:" + room.code).emit("match_start", {
    snapshot: G.snapshot(room.match),
    names,
  });

  const dt = TICK_MS / 1000;
  room.timer = setInterval(() => {
    const m = room.match;
    if (!m) return stopMatch(room);

    G.tick(m, dt);
    const events = G.drainEvents(m);
    io.to("room:" + room.code).emit("state", { snapshot: G.snapshot(m), events });

    if (!m.over) return;

    const res = G.results(m);

    room.players.forEach((id) => {
      const p = players.get(id);
      const pr = p && profiles.get(p.pkey);
      if (!pr) return;
      const earned = res.tips[id] || 0;
      pr.wallet += earned;
      pr.lifetime += earned;
      pr.shifts += 1;
      if (res.passed) pr.best = Math.max(pr.best, room.level + 1);
      io.to(id).emit("profile", profilePayload(p.pkey));
    });
    saveProfiles();

    const nextLevel = Math.min(100, room.level + (res.passed ? 1 : 0));
    io.to("room:" + room.code).emit("match_end", {
      results: res,
      names: room.names,
      nextLevel,
      repeat: !res.passed,
    });

    stopMatch(room);
    room.level = nextLevel;
    broadcastLobby(room);
  }, TICK_MS);
}

function stopMatch(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.match = null;
}

/* ------------------------------------------------------------------ http */

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) =>
  res.json({ ok: true, players: players.size, rooms: rooms.size, profiles: profiles.size, uptime: process.uptime() })
);

/* --------------------------------------------------------------- sockets */

io.on("connection", (socket) => {
  socket.on("hello", (d = {}) => {
    const name = String(d.name || "Cook").slice(0, 16).trim() || "Cook";
    const pkey = String(d.pkey || "").slice(0, 40) || "anon-" + socket.id;
    if (!profiles.has(pkey)) profiles.set(pkey, blankProfile(name));
    const pr = profiles.get(pkey);
    pr.name = name;
    if (d.gender === "male" || d.gender === "female") pr.gender = d.gender;

    players.set(socket.id, { id: socket.id, pkey, name, room: null });
    socket.emit("welcome", { id: socket.id, name });
    socket.emit("profile", profilePayload(pkey));
    socket.emit("rooms", publicRooms());
    saveProfiles();
  });

  socket.on("create_room", (d = {}) => {
    const p = players.get(socket.id);
    if (!p) return socket.emit("oops", "Still connecting — try again.");
    if (p.room) leaveRoom(socket);

    const pr = profiles.get(p.pkey);
    const wanted = Math.min(100, Math.max(1, parseInt(d.level, 10) || 1));
    const level = Math.min(wanted, Math.max(1, pr.best)); // can't skip ahead

    const code = newCode();
    rooms.set(code, {
      code, host: socket.id,
      mode: d.mode === "versus" ? "versus" : "co-op",
      level, players: [socket.id], match: null, timer: null,
    });
    p.room = code;
    socket.join("room:" + code);
    if (level !== wanted) socket.emit("oops", `You've unlocked up to level ${pr.best}`);
    broadcastLobby(rooms.get(code));
  });

  socket.on("join_room", (d = {}) => {
    const p = players.get(socket.id);
    if (!p) return socket.emit("oops", "Still connecting — try again.");
    const code = String(d.code || "").toUpperCase().trim();
    const room = rooms.get(code);
    if (!room) return socket.emit("oops", "No room with that code.");
    if (room.match) return socket.emit("oops", "That shift already started.");
    if (room.players.length >= MAX_PLAYERS) return socket.emit("oops", "That kitchen is full.");

    if (p.room) leaveRoom(socket);
    room.players.push(socket.id);
    p.room = code;
    socket.join("room:" + code);
    broadcastLobby(room);
  });

  socket.on("set_level", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || room.host !== socket.id || room.match) return;
    const pr = profiles.get(p.pkey);
    room.level = Math.min(Math.max(1, parseInt(d.level, 10) || 1), Math.max(1, pr.best));
    broadcastLobby(room);
  });

  socket.on("set_mode", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || room.host !== socket.id || room.match) return;
    room.mode = d.mode === "versus" ? "versus" : "co-op";
    broadcastLobby(room);
  });

  socket.on("start_match", () => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room) return socket.emit("oops", "You're not in a kitchen.");
    if (room.host !== socket.id) return socket.emit("oops", "Only the host can start.");
    if (room.match) return;
    startMatch(room);
  });

  /** Straight from the results screen into the next shift. */
  socket.on("next_level", () => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room) return socket.emit("oops", "You're not in a kitchen.");
    if (room.host !== socket.id) return socket.emit("oops", "Only the host can start.");
    if (room.match) return;
    startMatch(room);
  });

  socket.on("buy", (d = {}) => {
    const p = players.get(socket.id);
    const pr = p && profiles.get(p.pkey);
    if (!pr) return;
    const r = G.buyUpgrade(pr.wallet, pr.upgrades, String(d.key || ""));
    if (!r.ok) {
      socket.emit("nope", r);
      return;
    }
    pr.wallet -= r.spent;
    saveProfiles();
    socket.emit("bought", { key: r.key, level: r.level, spent: r.spent });
    socket.emit("profile", profilePayload(p.pkey));
  });

  socket.on("leave_room", () => leaveRoom(socket));
  socket.on("rooms", () => socket.emit("rooms", publicRooms()));

  /* ---- in-match ---- */

  socket.on("move", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    G.moveTo(room.match, socket.id, d.x, d.z, d.dt);
  });

  socket.on("cook", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.startCook(room.match, socket.id, String(d.dish || ""));
    if (!r.ok) socket.emit("nope", r);
  });

  socket.on("serve", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.serve(room.match, socket.id, parseInt(d.customer, 10));
    if (!r.ok) socket.emit("nope", r);
  });

  socket.on("toss", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.toss(room.match, socket.id, d.index);
    if (!r.ok) socket.emit("nope", r);
  });

  socket.on("bus", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.busTable(room.match, socket.id, parseInt(d.seat, 10));
    if (!r.ok) socket.emit("nope", r);
  });

  socket.on("wash", () => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.dropAtSink(room.match, socket.id);
    if (!r.ok) socket.emit("nope", r);
  });

  /** Anyone in the kitchen can freeze the shift for everyone. */
  socket.on("pause", (d = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    G.setPause(room.match, socket.id, !!d.on, p.name);
    io.to("room:" + room.code).emit("state", {
      snapshot: G.snapshot(room.match),
      events: G.drainEvents(room.match),
    });
  });

  socket.on("disconnect", () => {
    leaveRoom(socket);
    players.delete(socket.id);
  });
});

loadProfiles();
server.listen(PORT, () => console.log(`\n🍔 Restaurant Empire on ${PORT}\n`));

module.exports = { app, server, io };

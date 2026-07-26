"use strict";

const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const G = require("./gamelogic");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
});

const PORT = process.env.PORT || 3000;
const FAST_MODE = process.env.FAST_MODE === "1";
const TICK_MS = 200;
const MAX_PLAYERS = 4;

// ------------------------------------------------------------------ state

/** socketId -> { id, name, level, xp, money, room } */
const players = new Map();
/** roomCode -> room */
const rooms = new Map();

function roomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I/O/0/1
  let code;
  do {
    code = "";
    for (let i = 0; i < 4; i++) code += chars[(Math.random() * chars.length) | 0];
  } while (rooms.has(code));
  return code;
}

function publicRooms() {
  return Array.from(rooms.values())
    .filter((r) => !r.match)
    .map((r) => ({
      code: r.code,
      mode: r.mode,
      level: r.level,
      players: r.players.length,
      maxPlayers: MAX_PLAYERS,
      host: players.get(r.host)?.name || "—",
    }));
}

function lobbyPayload(room) {
  return {
    code: room.code,
    mode: room.mode,
    level: room.level,
    hostId: room.host,
    players: room.players
      .map((id) => players.get(id))
      .filter(Boolean)
      .map((p) => ({ id: p.id, name: p.name, level: p.level })),
  };
}

function broadcastLobby(room) {
  const payload = lobbyPayload(room);
  room.players.forEach((id) => {
    io.to(id).emit("lobby", { ...payload, youAreHost: id === room.host });
  });
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

  if (room.players.length === 0) {
    stopMatch(room);
    rooms.delete(room.code);
    io.emit("rooms", publicRooms());
    return;
  }
  if (room.host === socket.id) room.host = room.players[0];
  broadcastLobby(room);
}

// ------------------------------------------------------------------ match

function startMatch(room) {
  room.match = G.createMatch({
    level: room.level,
    mode: room.mode,
    playerIds: room.players.slice(),
    fast: FAST_MODE,
  });

  const names = {};
  room.players.forEach((id) => {
    names[id] = players.get(id)?.name || "Cook";
  });
  room.names = names;

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

    io.to("room:" + room.code).emit("state", {
      snapshot: G.snapshot(m),
      events,
    });

    if (m.over) {
      const res = G.results(m);
      // Award progression
      room.players.forEach((id) => {
        const p = players.get(id);
        if (!p) return;
        const earned = res.scores[id] || 0;
        p.money += Math.round(earned * 0.5);
        p.xp += Math.round(earned * 0.4);
        while (p.xp >= p.level * 400) {
          p.xp -= p.level * 400;
          p.level += 1;
          io.to(id).emit("level_up", { level: p.level });
        }
      });

      io.to("room:" + room.code).emit("match_end", {
        results: res,
        names: room.names,
        nextLevel: Math.min(100, room.level + 1),
      });

      stopMatch(room);
      room.level = Math.min(100, room.level + (res.stars >= 2 ? 1 : 0));
      broadcastLobby(room);
    }
  }, TICK_MS);
}

function stopMatch(room) {
  if (room.timer) clearInterval(room.timer);
  room.timer = null;
  room.match = null;
}

// ------------------------------------------------------------------ http

app.use(express.static(path.join(__dirname, "public")));
app.get("/health", (_req, res) =>
  res.json({ ok: true, players: players.size, rooms: rooms.size, uptime: process.uptime() })
);

// ---------------------------------------------------------------- sockets

io.on("connection", (socket) => {
  console.log(`+ ${socket.id} (${players.size + 1} online)`);

  socket.on("hello", (data = {}) => {
    const name = String(data.name || "Cook").slice(0, 16).trim() || "Cook";
    players.set(socket.id, {
      id: socket.id,
      name,
      level: 1,
      xp: 0,
      money: 0,
      room: null,
    });
    socket.emit("welcome", { id: socket.id, name });
    socket.emit("rooms", publicRooms());
  });

  socket.on("create_room", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return socket.emit("oops", "Not connected yet — reload the page.");
    if (p.room) leaveRoom(socket);

    const code = roomCode();
    const room = {
      code,
      host: socket.id,
      mode: data.mode === "versus" ? "versus" : "co-op",
      level: Math.min(100, Math.max(1, parseInt(data.level, 10) || 1)),
      players: [socket.id],
      match: null,
      timer: null,
    };
    rooms.set(code, room);
    p.room = code;
    socket.join("room:" + code);
    console.log(`  room ${code} created by ${p.name} (${room.mode}, lvl ${room.level})`);
    broadcastLobby(room);
  });

  socket.on("join_room", (data = {}) => {
    const p = players.get(socket.id);
    if (!p) return socket.emit("oops", "Not connected yet — reload the page.");
    const code = String(data.code || "").toUpperCase().trim();
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

  socket.on("set_level", (data = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || room.host !== socket.id || room.match) return;
    room.level = Math.min(100, Math.max(1, parseInt(data.level, 10) || 1));
    broadcastLobby(room);
  });

  socket.on("set_mode", (data = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || room.host !== socket.id || room.match) return;
    room.mode = data.mode === "versus" ? "versus" : "co-op";
    broadcastLobby(room);
  });

  socket.on("start_match", () => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room) return socket.emit("oops", "You're not in a room.");
    if (room.host !== socket.id) return socket.emit("oops", "Only the host can start.");
    if (room.match) return;
    console.log(`  match start ${room.code} lvl ${room.level} ${room.mode} x${room.players.length}`);
    startMatch(room);
  });

  socket.on("leave_room", () => leaveRoom(socket));

  socket.on("rooms", () => socket.emit("rooms", publicRooms()));

  // ---- in-match actions
  socket.on("cook", (data = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.startCook(room.match, socket.id, String(data.dish || ""));
    if (!r.ok) socket.emit("nope", r);
  });

  socket.on("serve", (data = {}) => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    const r = G.serve(room.match, socket.id, parseInt(data.customer, 10));
    if (!r.ok) socket.emit("nope", r);
  });

  socket.on("discard", () => {
    const p = players.get(socket.id);
    const room = p && rooms.get(p.room);
    if (!room || !room.match) return;
    G.discard(room.match, socket.id);
  });

  socket.on("disconnect", () => {
    const p = players.get(socket.id);
    console.log(`- ${p?.name || socket.id} (${players.size - 1} online)`);
    leaveRoom(socket);
    players.delete(socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`\n🍔 Restaurant Empire — listening on ${PORT}\n`);
});

module.exports = { app, server, io };

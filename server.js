const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: { origin: "*", methods: ["GET", "POST"] },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
});

// ===== CONFIGURATION =====
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "restaurant_empire.json";
const FAST_MODE = process.env.FAST_MODE === "1";

// ===== GAME CONSTANTS =====
const RESTAURANTS = [
  { id: 0, name: "Family Diner", emoji: "🍔", levelRange: [1, 10], customers: 6 },
  { id: 1, name: "Burger Joint", emoji: "🍟", levelRange: [11, 20], customers: 8 },
  { id: 2, name: "Pizza Place", emoji: "🍕", levelRange: [21, 30], customers: 7 },
  { id: 3, name: "Sushi Bar", emoji: "🍣", levelRange: [31, 40], customers: 6 },
  { id: 4, name: "Taco Stand", emoji: "🌮", levelRange: [41, 50], customers: 9 },
  { id: 5, name: "Fish & Chips", emoji: "🐟", levelRange: [51, 60], customers: 8 },
  { id: 6, name: "Steakhouse", emoji: "🥩", levelRange: [61, 70], customers: 5 },
  { id: 7, name: "Italian Kitchen", emoji: "🍝", levelRange: [71, 80], customers: 7 },
  { id: 8, name: "Luxury Buffet", emoji: "🍽️", levelRange: [81, 90], customers: 10 },
  { id: 9, name: "Five-Star", emoji: "👨‍🍳", levelRange: [91, 100], customers: 6 },
];

const RECIPES = {
  burger: { name: "Burger", emoji: "🍔", time: 8, ingredients: ["bread", "meat", "lettuce"], points: 100 },
  fries: { name: "Fries", emoji: "🍟", time: 6, ingredients: ["potato", "oil"], points: 80 },
  pizza: { name: "Pizza", emoji: "🍕", time: 12, ingredients: ["dough", "cheese", "sauce"], points: 120 },
  sushi: { name: "Sushi", emoji: "🍣", time: 10, ingredients: ["rice", "fish", "nori"], points: 110 },
  taco: { name: "Taco", emoji: "🌮", time: 7, ingredients: ["tortilla", "meat", "lettuce"], points: 90 },
  fish: { name: "Fish", emoji: "🐟", time: 11, ingredients: ["fish", "oil", "lemon"], points: 115 },
  steak: { name: "Steak", emoji: "🥩", time: 14, ingredients: ["beef", "butter", "salt"], points: 140 },
  pasta: { name: "Pasta", emoji: "🍝", time: 9, ingredients: ["pasta", "sauce", "cheese"], points: 105 },
  buffet: { name: "Buffet", emoji: "🍽️", time: 20, ingredients: ["rice", "meat", "veggies"], points: 150 },
  gourmet: { name: "Gourmet", emoji: "👨‍🍳", time: 25, ingredients: ["prime", "truffle", "gold"], points: 200 },
};

// ===== STATE MANAGEMENT =====
const rooms = new Map();
const players = new Map();
const database = { players: {} };

// ===== UTILITY FUNCTIONS =====
function saveDatabase() {
  fs.writeFileSync(DATABASE_URL, JSON.stringify(database, null, 2));
}

function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_URL)) {
      const data = JSON.parse(fs.readFileSync(DATABASE_URL, "utf8"));
      Object.assign(database, data);
    }
  } catch (e) {
    console.log("Database load failed, starting fresh");
  }
}

function getRestaurantForLevel(level) {
  const restaurant = RESTAURANTS.find((r) => level >= r.levelRange[0] && level <= r.levelRange[1]);
  return restaurant || RESTAURANTS[0];
}

function generateRoomCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

function gameSecondsForLevel(level) {
  if (FAST_MODE) return 30;
  const base = 60 + Math.floor(level / 5) * 5;
  return Math.min(200, base);
}

function customersForLevel(level) {
  const restaurant = getRestaurantForLevel(level);
  return restaurant.customers + Math.floor(level / 15);
}

function pointsForRecipe(recipe) {
  return RECIPES[recipe]?.points || 50;
}

// ===== EXPRESS MIDDLEWARE & ROUTES =====
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "Restaurant Empire 3D server is running", uptime: process.uptime() });
});

app.get("/api/restaurants", (req, res) => {
  res.json(RESTAURANTS);
});

app.get("/api/recipes", (req, res) => {
  res.json(RECIPES);
});

app.get("/api/player/:id", (req, res) => {
  const playerData = database.players[req.params.id] || {
    id: req.params.id,
    name: "Guest",
    level: 1,
    xp: 0,
    money: 0,
    restaurant: 0,
    achievements: [],
    createdAt: Date.now(),
  };
  res.json(playerData);
});

app.post("/api/player/:id/save", (req, res) => {
  database.players[req.params.id] = { ...req.body, id: req.params.id };
  saveDatabase();
  res.json({ success: true });
});

// ===== SOCKET.IO EVENTS =====
io.on("connection", (socket) => {
  console.log(`[Connection] Player connected: ${socket.id}`);

  // Player joined
  socket.on("join_game", (playerData) => {
    players.set(socket.id, {
      id: socket.id,
      name: playerData.name || "Guest",
      level: playerData.level || 1,
      xp: playerData.xp || 0,
      money: playerData.money || 0,
      restaurant: 0,
      socketId: socket.id,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
    });

    // Load persistent data
    if (database.players[socket.id]) {
      const saved = database.players[socket.id];
      players.get(socket.id).level = saved.level;
      players.get(socket.id).xp = saved.xp;
      players.get(socket.id).money = saved.money;
    }

    socket.emit("joined", { playerId: socket.id, restaurants: RESTAURANTS });
    io.emit("players_online", players.size);
    console.log(`[Joined] ${players.get(socket.id).name} (Total: ${players.size})`);
  });

  // Create room (lobby)
  socket.on("create_room", (options) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      mode: options.mode || "co-op",
      maxPlayers: options.maxPlayers || 4,
      players: [socket.id],
      started: false,
      level: options.level || 1,
      gameState: null,
      createdAt: Date.now(),
    };

    rooms.set(roomCode, room);
    socket.join(`room_${roomCode}`);
    socket.emit("room_created", { code: roomCode, room });
    io.emit("rooms_updated", Array.from(rooms.values()));

    console.log(`[Room] Created ${roomCode} by ${players.get(socket.id).name}`);
  });

  // Join room
  socket.on("join_room", (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room is full");
      return;
    }

    room.players.push(socket.id);
    socket.join(`room_${roomCode}`);
    socket.emit("room_joined", { code: roomCode, room });
    io.to(`room_${roomCode}`).emit("room_updated", room);
    io.emit("rooms_updated", Array.from(rooms.values()));

    console.log(`[Room] ${players.get(socket.id).name} joined ${roomCode}`);
  });

  // Start game
  socket.on("start_game", (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room || room.host !== socket.id) {
      socket.emit("error", "Only host can start");
      return;
    }

    room.started = true;
    const restaurant = getRestaurantForLevel(room.level);
    const gameSeconds = gameSecondsForLevel(room.level);
    const maxCustomers = customersForLevel(room.level);

    room.gameState = {
      level: room.level,
      restaurant,
      timeRemaining: gameSeconds,
      maxTime: gameSeconds,
      customersServed: 0,
      maxCustomers,
      teamScore: 0,
      orders: [],
      startedAt: Date.now(),
      endedAt: null,
    };

    io.to(`room_${roomCode}`).emit("game_started", {
      gameState: room.gameState,
      players: room.players.map((id) => players.get(id)),
    });

    console.log(`[Game] Started in ${roomCode}: Level ${room.level}, ${maxCustomers} customers`);

    // Game loop
    const gameInterval = setInterval(() => {
      if (!room.gameState) {
        clearInterval(gameInterval);
        return;
      }

      room.gameState.timeRemaining = Math.max(0, room.gameState.timeRemaining - 1);

      io.to(`room_${roomCode}`).emit("game_update", { gameState: room.gameState });

      if (room.gameState.timeRemaining === 0) {
        clearInterval(gameInterval);
        room.gameState.endedAt = Date.now();
        io.to(`room_${roomCode}`).emit("game_ended", { gameState: room.gameState });
        room.started = false;
      }
    }, 1000);
  });

  // Player position update (continuous sync)
  socket.on("player_position", (data) => {
    const player = players.get(socket.id);
    if (player) {
      player.position = data.position;
      player.rotation = data.rotation;
      socket.broadcast.emit("player_moved", { playerId: socket.id, position: data.position, rotation: data.rotation });
    }
  });

  // Player interaction (cooking, ordering, etc.)
  socket.on("player_action", (data) => {
    const room = rooms.get(data.roomCode);
    if (!room) return;

    const action = {
      playerId: socket.id,
      type: data.type,
      recipe: data.recipe,
      timestamp: Date.now(),
    };

    // Award points based on action type
    const player = players.get(socket.id);
    if (player && data.type === "complete_order") {
      const points = pointsForRecipe(data.recipe);
      player.money += Math.floor(points * 1.2);
      player.xp += Math.floor(points * 0.5);

      // Check level up
      if (player.xp >= player.level * 500) {
        player.level += 1;
        player.xp = 0;
        io.to(`room_${data.roomCode}`).emit("player_level_up", { playerId: socket.id, level: player.level });
      }

      room.gameState.teamScore += points;
      room.gameState.customersServed += 1;

      database.players[socket.id] = {
        id: socket.id,
        name: player.name,
        level: player.level,
        xp: player.xp,
        money: player.money,
        restaurant: 0,
      };
      saveDatabase();
    }

    io.to(`room_${data.roomCode}`).emit("room_action", action);
  });

  // Chat message
  socket.on("chat_message", (data) => {
    const player = players.get(socket.id);
    if (!player) return;

    io.emit("chat", {
      playerId: socket.id,
      playerName: player.name,
      message: data.message,
      timestamp: Date.now(),
    });
  });

  // Disconnect
  socket.on("disconnect", () => {
    players.delete(socket.id);

    // Clean up empty rooms
    for (const [code, room] of rooms.entries()) {
      room.players = room.players.filter((id) => id !== socket.id);
      if (room.players.length === 0) {
        rooms.delete(code);
      } else if (room.host === socket.id) {
        room.host = room.players[0]; // Reassign host
      }
    }

    io.emit("players_online", players.size);
    io.emit("rooms_updated", Array.from(rooms.values()));
    console.log(`[Disconnect] Player removed. Online: ${players.size}`);
  });
});

// ===== SERVER STARTUP =====
loadDatabase();

server.listen(PORT, () => {
  console.log(`\n🍔 Restaurant Empire 3D`);
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 WebSocket multiplayer enabled`);
  console.log(`🎮 Ready for multiplayer gaming!\n`);
});

module.exports = server;

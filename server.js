const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);

// ===== SOCKET.IO CONFIGURATION =====
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: false
  },
  transports: ["websocket", "polling"],
  pingInterval: 25000,
  pingTimeout: 60000,
  serveClient: true,
  path: "/socket.io/",
});

// ===== CONFIGURATION =====
const PORT = process.env.PORT || 3000;
const DATABASE_URL = process.env.DATABASE_URL || "restaurant_empire.json";
const FAST_MODE = process.env.FAST_MODE === "1";

// ===== GAME CONSTANTS =====
const RESTAURANTS = [
  { id: 0, name: "Family Diner", emoji: "🍔", levelRange: [1, 10], customers: 6, theme: "Casual" },
  { id: 1, name: "Burger Joint", emoji: "🍟", levelRange: [11, 20], customers: 8, theme: "Fast Food" },
  { id: 2, name: "Pizza Place", emoji: "🍕", levelRange: [21, 30], customers: 7, theme: "Italian" },
  { id: 3, name: "Sushi Bar", emoji: "🍣", levelRange: [31, 40], customers: 6, theme: "Japanese" },
  { id: 4, name: "Taco Stand", emoji: "🌮", levelRange: [41, 50], customers: 9, theme: "Mexican" },
  { id: 5, name: "Fish & Chips", emoji: "🐟", levelRange: [51, 60], customers: 8, theme: "Seafood" },
  { id: 6, name: "Steakhouse", emoji: "🥩", levelRange: [61, 70], customers: 5, theme: "Premium" },
  { id: 7, name: "Italian Kitchen", emoji: "🍝", levelRange: [71, 80], customers: 7, theme: "Gourmet" },
  { id: 8, name: "Luxury Buffet", emoji: "🍽️", levelRange: [81, 90], customers: 10, theme: "Fine Dining" },
  { id: 9, name: "Five-Star", emoji: "👨‍🍳", levelRange: [91, 100], customers: 6, theme: "Michelin" },
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
  salad: { name: "Salad", emoji: "🥗", time: 5, ingredients: ["lettuce", "tomato", "dressing"], points: 70 },
  ramen: { name: "Ramen", emoji: "🍜", time: 13, ingredients: ["noodles", "broth", "egg"], points: 125 },
};

// ===== STATE MANAGEMENT =====
const rooms = new Map();
const players = new Map();
const database = { players: {} };

// ===== UTILITY FUNCTIONS =====
function saveDatabase() {
  try {
    fs.writeFileSync(DATABASE_URL, JSON.stringify(database, null, 2));
  } catch (e) {
    console.error("❌ Database save error:", e.message);
  }
}

function loadDatabase() {
  try {
    if (fs.existsSync(DATABASE_URL)) {
      const data = JSON.parse(fs.readFileSync(DATABASE_URL, "utf8"));
      Object.assign(database, data);
      console.log(`✅ Loaded ${Object.keys(database.players).length} saved players`);
    }
  } catch (e) {
    console.log("ℹ️ Database load failed, starting fresh");
  }
}

function getRestaurantForLevel(level) {
  const restaurant = RESTAURANTS.find((r) => level >= r.levelRange[0] && level <= r.levelRange[1]);
  return restaurant || RESTAURANTS[0];
}

function generateRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

function gameSecondsForLevel(level) {
  if (FAST_MODE) return 30;
  const base = 60 + Math.floor(level / 5) * 5;
  return Math.min(200, base);
}

function customersForLevel(level, mode) {
  const restaurant = getRestaurantForLevel(level);
  const baseCustomers = restaurant.customers + Math.floor(level / 15);
  return mode === "versus" ? Math.ceil(baseCustomers * 0.8) : baseCustomers;
}

function pointsForRecipe(recipe) {
  return RECIPES[recipe]?.points || 50;
}

// ===== EXPRESS ROUTES =====
app.use(express.static(path.join(__dirname, "public")));
app.use(express.json());

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.get("/health", (req, res) => {
  res.json({ 
    status: "Restaurant Empire 3D running", 
    uptime: process.uptime(),
    players: players.size,
    rooms: rooms.size 
  });
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
  console.log(`\n✅ [NEW CONNECTION] ${socket.id}`);
  console.log(`   Transport: ${socket.conn.transport.name}`);
  console.log(`   Players online: ${players.size + 1}\n`);

  // Player joins the game
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
      score: 0,
      served: 0,
    });

    // Load saved player data if exists
    if (database.players[socket.id]) {
      const saved = database.players[socket.id];
      const player = players.get(socket.id);
      player.level = saved.level;
      player.xp = saved.xp;
      player.money = saved.money;
    }

    socket.emit("joined", { 
      playerId: socket.id, 
      restaurants: RESTAURANTS,
      player: players.get(socket.id)
    });
    
    io.emit("players_online", players.size);
    console.log(`✅ ${players.get(socket.id).name} joined game`);
  });

  // Host creates a room and selects game mode
  socket.on("create_room", (options) => {
    const roomCode = generateRoomCode();
    const room = {
      code: roomCode,
      host: socket.id,
      mode: options.mode, // "co-op" or "versus"
      maxPlayers: 4,
      players: [socket.id],
      playerDetails: [players.get(socket.id)],
      started: false,
      gameInProgress: false,
      level: options.level || 1,
      gameState: null,
      createdAt: Date.now(),
      modeSelected: true,
    };

    rooms.set(roomCode, room);
    socket.join(`room_${roomCode}`);
    
    console.log(`🎮 [ROOM CREATED] ${roomCode} (Mode: ${options.mode}, Host: ${players.get(socket.id).name})`);
    
    socket.emit("room_created", { 
      code: roomCode, 
      room,
      mode: options.mode 
    });
    
    io.emit("rooms_updated", Array.from(rooms.values()).map(r => ({
      code: r.code,
      mode: r.mode,
      players: r.players.length,
      host: players.get(r.host)?.name,
      level: r.level
    })));
  });

  // Another player joins the room
  socket.on("join_room", (roomCode) => {
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit("error", "Room not found");
      console.log(`❌ Failed to join ${roomCode}: Room not found`);
      return;
    }

    if (room.players.length >= room.maxPlayers) {
      socket.emit("error", "Room is full");
      console.log(`❌ ${players.get(socket.id).name} tried to join full room ${roomCode}`);
      return;
    }

    if (room.gameInProgress) {
      socket.emit("error", "Game already in progress");
      console.log(`❌ ${players.get(socket.id).name} tried to join active game ${roomCode}`);
      return;
    }

    room.players.push(socket.id);
    room.playerDetails.push(players.get(socket.id));
    socket.join(`room_${roomCode}`);
    
    console.log(`✅ ${players.get(socket.id).name} joined ${roomCode} (${room.players.length}/${room.maxPlayers})`);
    
    socket.emit("room_joined", { 
      code: roomCode, 
      room: {
        code: room.code,
        mode: room.mode,
        players: room.playerDetails,
        host: players.get(room.host),
        level: room.level
      }
    });
    
    // Notify all players in room
    io.to(`room_${roomCode}`).emit("room_updated", {
      code: room.code,
      mode: room.mode,
      players: room.playerDetails,
      host: players.get(room.host),
      level: room.level,
      playerCount: room.players.length
    });
    
    io.emit("rooms_updated", Array.from(rooms.values()).map(r => ({
      code: r.code,
      mode: r.mode,
      players: r.players.length,
      host: players.get(r.host)?.name,
      level: r.level
    })));
  });

  // Host starts the game
  socket.on("start_game", (data) => {
    const roomCode = data.roomCode;
    const room = rooms.get(roomCode);
    
    if (!room) {
      socket.emit("error", "Room not found");
      return;
    }

    if (room.host !== socket.id) {
      socket.emit("error", "Only host can start game");
      return;
    }

    if (room.gameInProgress) {
      socket.emit("error", "Game already started");
      return;
    }

    room.gameInProgress = true;
    room.started = true;
    const restaurant = getRestaurantForLevel(room.level);
    const gameSeconds = gameSecondsForLevel(room.level);
    const maxCustomers = customersForLevel(room.level, room.mode);

    // Initialize scores for each player
    room.playerScores = {};
    room.players.forEach(playerId => {
      room.playerScores[playerId] = 0;
    });

    room.gameState = {
      level: room.level,
      restaurant,
      mode: room.mode,
      timeRemaining: gameSeconds,
      maxTime: gameSeconds,
      customersServed: 0,
      maxCustomers,
      teamScore: 0,
      playerScores: room.playerScores,
      orders: [],
      startedAt: Date.now(),
      endedAt: null,
      started: true,
    };

    console.log(`🎮 [GAME STARTED] ${roomCode}`);
    console.log(`   Level: ${room.level}, Restaurant: ${restaurant.name}`);
    console.log(`   Mode: ${room.mode}, Players: ${room.players.length}, Time: ${gameSeconds}s, Customers: ${maxCustomers}`);

    io.to(`room_${roomCode}`).emit("game_started", {
      gameState: room.gameState,
      players: room.players.map((id) => players.get(id)),
      mode: room.mode
    });

    // Game loop
    const gameInterval = setInterval(() => {
      if (!room.gameState || !room.gameInProgress) {
        clearInterval(gameInterval);
        return;
      }

      room.gameState.timeRemaining = Math.max(0, room.gameState.timeRemaining - 1);
      
      io.to(`room_${roomCode}`).emit("game_update", { 
        gameState: room.gameState,
        timeRemaining: room.gameState.timeRemaining,
        teamScore: room.gameState.teamScore,
        customersServed: room.gameState.customersServed
      });

      if (room.gameState.timeRemaining === 0) {
        clearInterval(gameInterval);
        room.gameState.endedAt = Date.now();
        room.gameInProgress = false;

        let winner = null;
        if (room.mode === "versus") {
          let maxScore = 0;
          for (const playerId in room.playerScores) {
            if (room.playerScores[playerId] > maxScore) {
              maxScore = room.playerScores[playerId];
              winner = playerId;
            }
          }
        }

        // Award XP
        room.players.forEach(playerId => {
          const player = players.get(playerId);
          const playerScore = room.playerScores[playerId] || 0;
          
          if (player) {
            player.money += Math.floor(playerScore * 1.2);
            player.xp += Math.floor(playerScore * 0.5);
            
            while (player.xp >= player.level * 500) {
              player.level += 1;
              player.xp = 0;
              io.to(`room_${roomCode}`).emit("player_level_up", { 
                playerId: playerId, 
                level: player.level,
                name: player.name 
              });
            }
            
            database.players[playerId] = {
              id: playerId,
              name: player.name,
              level: player.level,
              xp: player.xp,
              money: player.money,
              lastUpdated: Date.now()
            };
          }
        });
        saveDatabase();

        console.log(`🏁 [GAME ENDED] ${roomCode} - Team Score: ${room.gameState.teamScore}`);

        io.to(`room_${roomCode}`).emit("game_ended", { 
          gameState: room.gameState,
          playerScores: room.playerScores,
          mode: room.mode,
          winner: winner ? players.get(winner)?.name : null,
          teamScore: room.gameState.teamScore,
          customersServed: room.gameState.customersServed
        });
      }
    }, 1000);
  });

  // Player performs action
  socket.on("player_action", (data) => {
    const room = rooms.get(data.roomCode);
    if (!room || !room.gameInProgress) return;

    const player = players.get(socket.id);
    if (!player) return;

    const points = pointsForRecipe(data.recipe);
    
    if (data.type === "complete_order") {
      if (!room.playerScores[socket.id]) {
        room.playerScores[socket.id] = 0;
      }
      room.playerScores[socket.id] += points;
      room.gameState.teamScore += points;
      room.gameState.customersServed += 1;
      
      io.to(`room_${data.roomCode}`).emit("room_action", { 
        playerId: socket.id,
        playerName: player.name,
        type: data.type, 
        recipe: data.recipe,
        points: points,
        totalScore: room.playerScores[socket.id]
      });
    }
  });

  // Leave room
  socket.on("leave_room", (roomCode) => {
    const room = rooms.get(roomCode);
    if (!room) return;

    room.players = room.players.filter((id) => id !== socket.id);
    room.playerDetails = room.playerDetails.filter((p) => p.id !== socket.id);
    
    if (room.players.length === 0) {
      rooms.delete(roomCode);
      console.log(`🗑️ [ROOM DELETED] ${roomCode} (no players)`);
    } else {
      if (room.host === socket.id) {
        room.host = room.players[0];
        console.log(`👑 [NEW HOST] ${players.get(room.host)?.name}`);
      }
      
      io.to(`room_${roomCode}`).emit("room_updated", {
        code: room.code,
        mode: room.mode,
        players: room.playerDetails,
        host: players.get(room.host),
        level: room.level,
        playerCount: room.players.length
      });
    }
    
    socket.leave(`room_${roomCode}`);
    io.emit("rooms_updated", Array.from(rooms.values()).map(r => ({
      code: r.code,
      mode: r.mode,
      players: r.players.length,
      host: players.get(r.host)?.name,
      level: r.level
    })));
  });

  // Disconnect
  socket.on("disconnect", () => {
    const playerName = players.get(socket.id)?.name || "Unknown";
    console.log(`\n👋 [DISCONNECT] ${playerName} (${socket.id})`);
    console.log(`   Players online: ${players.size - 1}\n`);
    
    players.delete(socket.id);

    for (const [code, room] of rooms.entries()) {
      room.players = room.players.filter((id) => id !== socket.id);
      room.playerDetails = room.playerDetails.filter((p) => p.id !== socket.id);
      
      if (room.players.length === 0) {
        rooms.delete(code);
      } else if (room.host === socket.id) {
        room.host = room.players[0];
      }
    }

    io.emit("players_online", players.size);
    io.emit("rooms_updated", Array.from(rooms.values()).map(r => ({
      code: r.code,
      mode: r.mode,
      players: r.players.length,
      host: players.get(r.host)?.name,
      level: r.level
    })));
  });
});

// ===== SERVER STARTUP =====
loadDatabase();

server.listen(PORT, () => {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`🍔 RESTAURANT EMPIRE 3D - SERVER STARTED`);
  console.log(`${"=".repeat(60)}`);
  console.log(`🚀 Port: ${PORT}`);
  console.log(`📡 WebSocket: Enabled`);
  console.log(`🎮 Ready for connections!\n`);
});

module.exports = server;

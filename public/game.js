// ===== GAME STATE =====
const gameState = {
  socket: null,
  playerId: null,
  playerName: "",
  playerLevel: 1,
  playerMoney: 0,
  playerXP: 0,
  currentRoom: null,
  currentMode: null,
  currentLevel: 1,
  gameActive: false,
  isPaused: false,
  isHost: false,
  players: new Map(),
  gameTime: 0,
  maxTime: 0,
  teamScore: 0,
  customersServed: 0,
  maxCustomers: 0,
  isMobile: /iPhone|iPad|Android|webOS|BlackBerry/i.test(navigator.userAgent),
};

let scene, camera, renderer, gameLight;
let playerModel, restaurantGroup;
let animationFrameId;

// ===== THREE.JS INITIALIZATION =====
function initThreeJS() {
  const container = document.getElementById("gameContainer");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 8);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  gameLight = new THREE.DirectionalLight(0xffffff, 1);
  gameLight.position.set(20, 30, 20);
  gameLight.castShadow = true;
  gameLight.shadow.mapSize.width = 2048;
  gameLight.shadow.mapSize.height = 2048;
  scene.add(gameLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90ee90 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  window.addEventListener("resize", onWindowResize);

  createPlayer();
  createRestaurant();

  animate();
}

function createPlayer() {
  if (playerModel) scene.remove(playerModel);

  playerModel = new THREE.Group();

  const bodyGeometry = new THREE.BoxGeometry(1, 2, 0.8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.position.y = 1;
  playerModel.add(body);

  const headGeometry = new THREE.SphereGeometry(0.4, 32, 32);
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf4a460 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.castShadow = true;
  head.position.y = 2.6;
  playerModel.add(head);

  playerModel.position.set(0, 0, 0);
  scene.add(playerModel);
}

function createRestaurant() {
  if (restaurantGroup) scene.remove(restaurantGroup);

  restaurantGroup = new THREE.Group();

  const wallGeometry = new THREE.BoxGeometry(30, 10, 25);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd4a574 });
  const walls = new THREE.Mesh(wallGeometry, wallMaterial);
  walls.castShadow = true;
  walls.position.y = 5;
  restaurantGroup.add(walls);

  const roofGeometry = new THREE.ConeGeometry(20, 6, 4);
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.castShadow = true;
  roof.position.y = 12;
  roof.rotation.y = Math.PI / 4;
  restaurantGroup.add(roof);

  const counterGeometry = new THREE.BoxGeometry(15, 1, 3);
  const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
  const counter = new THREE.Mesh(counterGeometry, counterMaterial);
  counter.castShadow = true;
  counter.position.set(0, 1, -8);
  restaurantGroup.add(counter);

  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const tableGeometry = new THREE.BoxGeometry(2, 0.8, 2);
      const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7355 });
      const table = new THREE.Mesh(tableGeometry, tableMaterial);
      table.castShadow = true;
      table.position.set(-8 + i * 5, 0.4, 3 + j * 4);
      restaurantGroup.add(table);
    }
  }

  for (let i = 0; i < 3; i++) {
    const stoveGeometry = new THREE.BoxGeometry(2, 1.5, 2);
    const stoveMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const stove = new THREE.Mesh(stoveGeometry, stoveMaterial);
    stove.castShadow = true;
    stove.position.set(-8 + i * 4, 0.75, -10);
    restaurantGroup.add(stove);
  }

  scene.add(restaurantGroup);
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  if (playerModel && gameState.gameActive) {
    playerModel.position.y = Math.sin(Date.now() * 0.005) * 0.1;
  }

  if (playerModel) {
    camera.position.x += (playerModel.position.x - camera.position.x) * 0.1;
    camera.position.y += (5 - camera.position.y) * 0.1;
    camera.position.z += (playerModel.position.z + 8 - camera.position.z) * 0.1;
    camera.lookAt(playerModel.position.x, playerModel.position.y + 1, playerModel.position.z);
  }

  renderer.render(scene, camera);
}

// ===== SOCKET.IO INITIALIZATION =====
function initSocket() {
  console.log("🔌 Initializing Socket.IO connection...");

  gameState.socket = io(window.location.origin, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ["websocket", "polling"],
    secure: window.location.protocol === "https:",
  });

  gameState.socket.on("connect", () => {
    console.log("✅ Connected to server:", gameState.socket.id);
    showLoading(false);
    showToast("✅ Connected to server!");
    joinGame();
  });

  gameState.socket.on("connect_error", (error) => {
    console.error("❌ Connection error:", error);
    showToast("❌ Connection failed: " + error.message);
  });

  gameState.socket.on("joined", (data) => {
    console.log("✅ Joined game:", data);
    gameState.playerId = data.playerId;
    gameState.playerLevel = data.player?.level || 1;
    gameState.playerMoney = data.player?.money || 0;
    gameState.playerXP = data.player?.xp || 0;
    showScreen("mainMenu");
  });

  gameState.socket.on("room_created", (data) => {
    console.log("✅ Room created:", data.code);
    gameState.currentRoom = data.code;
    gameState.currentMode = data.mode;
    gameState.isHost = showLoading(false); // Hide loading!
    updateWaitingRoom();
    showScreen("waitingRoom");
    showToast(`✅ Room created: ${data.code}`);
  });

  showLoading(false); // Hide loading!
  gameState.socket.on("room_joined", (data) => {
    console.log("✅ Joined room:", data.code);
    gameState.currentRoom = data.code;
    gameState.currentMode = data.room.mode;
    gameState.isHost = false;
    updateWaitingRoom();
    showScreen("waitingRoom");
    showToast(`✅ Joined room: ${data.code}`);
  });

  gameState.socket.on("room_updated", (room) => {
    console.log("📢 Room updated:", room);
    gameState.players.clear();
    room.players.forEach(player => {
      gameState.players.set(player.id, player);
    });
    updateWaitingRoom();
  });

  gameState.socket.on("rooms_updated", (rooms) => {
    updateRoomList(rooms);
  });

  showLoading(false); // Hide loading!
  gameState.socket.on("game_started", (data) => {
    console.log("🎮 Game started!");
    gameState.gameActive = true;
    gameState.maxTime = data.gameState.maxTime;
    gameState.gameTime = data.gameState.timeRemaining;
    gameState.maxCustomers = data.gameState.maxCustomers;
    gameState.teamScore = 0;
    gameState.customersServed = 0;
    showScreen("gameScreen");
    document.getElementById("hud").classList.add("active");
    document.getElementById("gameUI").classList.add("active");
    updateGameHUD();
  });

  gameState.socket.on("game_update", (data) => {
    gameState.gameTime = data.timeRemaining;
    gameState.teamScore = data.teamScore;
    gameState.customersServed = data.customersServed;
    updateGameHUD();
  });

  gameState.socket.on("game_ended", (data) => {
    console.log("🏁 Game ended!");
    gameState.gameActive = false;
    showGameOver(data);
  });

  gameState.socket.on("player_level_up", (data) => {
    if (data.playerId === gameState.playerId) {
      gameState.playerLevel = data.level;
      showToast(`🎉 Level ${data.level}!`);
    } else {
      showToast(`🎉 ${data.name} reached level ${data.level}!`);
    }
  });

  gameState.socket.on("room_action", (action) => {
    if (action.points) {
      showToast(`✅ ${action.playerName}: +${action.points} pts`);
    }
  });

  gameState.socket.on("error", (error) => {
    console.error("❌ Socket error:", error);
    showToast("❌ Error: " + error);
  });

  gameState.socket.on("disconnect", () => {
    console.log("👋 Disconnected from server");
    showToast("⚠️ Disconnected from server");
  });
}

function joinGame() {
  gameState.socket.emit("join_game", {
    name: gameState.playerName || "Guest",
    level: gameState.playerLevel,
    xp: gameState.playerXP,
    money: gameState.playerMoney,
  });
}

// ===== UI FUNCTIONS =====
function showScreen(screenName) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  const screen = document.getElementById(screenName);
  if (screen) screen.classList.add("active");
}

function showLoading(show, text = "Connecting...") {
  const loading = document.getElementById("loading");
  const loadingText = document.getElementById("loadingText");
  if (show) {
    loading.classList.add("active");
    loadingText.textContent = text;
  } else {
    loading.classList.remove("active");
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 3000);
}

function updateWaitingRoom() {
  document.getElementById("roomCodeDisplay").textContent = `Room: ${gameState.currentRoom}`;
  document.getElementById("modeDisplay").textContent = 
    gameState.currentMode === "co-op" ? "🤝 CO-OP" : "⚔️ VERSUS";

  const playerListDisplay = document.getElementById("playerListDisplay");
  playerListDisplay.innerHTML = gameState.players.size > 0 ? "" : "<p style='text-align: center; color: #999;'>Loading players...</p>";

  gameState.players.forEach(player => {
    const isHost = player.id === gameState.socket.id && gameState.isHost;
    const playerEl = document.createElement("div");
    playerEl.className = "player-item";
    playerEl.innerHTML = `
      <div class="player-icon">${isHost ? "👑" : "👤"}</div>
      <div class="player-name">${player.name}</div>
      <div class="player-level">Lvl ${player.level}</div>
    `;
    playerListDisplay.appendChild(playerEl);
  });

  const startBtn = document.getElementById("startGameBtn");
  startBtn.style.display = gameState.isHost ? "block" : "none";
}

function updateRoomList(rooms) {
  const roomList = document.getElementById("roomList");

  if (rooms.length === 0) {
    roomList.innerHTML = '<div class="card" style="text-align: center; color: #999;">No rooms available. Create one!</div>';
    return;
  }

  roomList.innerHTML = "";
  rooms.forEach(room => {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-info">
        <div class="room-code">${room.code}</div>
        <div class="room-details">
          ${room.mode === "co-op" ? "🤝 Co-op" : "⚔️ Versus"} • ${room.players}/4 players • Level ${room.level}
        </div>
      </div>
      <button class="room-action">JOIN</button>
    `;
    card.querySelector(".room-action").addEventListener("click", () => {
      joinRoom(room.code);
    });
    roomList.appendChild(card);
  });
}

function joinRoom(roomCode) {
  console.log("Joining room:", roomCode);
  gameState.socket.emit("join_room", roomCode);
}

function updateGameHUD() {
  document.getElementById("hudLevel").textContent = gameState.playerLevel;
  document.getElementById("hudScore").textContent = gameState.teamScore;
  document.getElementById("hudCustomers").textContent = `${gameState.customersServed}/${gameState.maxCustomers}`;
  document.getElementById("hudTime").textContent = gameState.gameTime;
  document.getElementById("gameTimer").textContent = gameState.gameTime;
}

function showGameOver(data) {
  document.getElementById("finalScore").textContent = data.teamScore;

  const resultsCard = document.getElementById("resultsCard");
  let html = `
    <div class="score-label">Game Results</div>
    <div style="margin-bottom: 16px;">
      <p style="font-size: 14px; font-weight: 600; margin-bottom: 8px;">Mode: ${data.mode === "co-op" ? "🤝 CO-OP" : "⚔️ VERSUS"}</p>
      <p style="font-size: 13px; color: #666;">Customers Served: ${data.customersServed}</p>
  `;

  if (data.mode === "versus" && data.winner) {
    html += `<p style="font-size: 13px; color: var(--primary); font-weight: 600; margin-top: 8px;">🏆 Winner: ${data.winner}</p>`;
  }

  html += `</div>`;
  resultsCard.innerHTML = html;

  document.getElementById("hud").classList.remove("active");
  document.getElementById("gameUI").classList.remove("active");
  showScreen("gameOverScreen");
}

// ===== EVENT LISTENERS =====
document.getElementById("playerName").addEventListener("keyup", (e) => {
  gameState.playerName = e.target.value || "Guest";
});

document.getElementById("hostBtn").addEventListener("click", () => {
  if (!gameState.playerName) {
    showToast("⚠️ Please enter your name");
    return;
  }
  showScreen("modeScreen");
});

document.getElementById("joinBtn").addEventListener("click", () => {
  if (!gameState.playerName) {
    showToast("⚠️ Please enter your name");
    return;
  }
  showScreen("browserScreen");
});

document.getElementById("backToMenuBtn").addEventListener("click", () => {
  showScreen("mainMenu");
});

document.getElementById("backFromBrowserBtn").addEventListener("click", () => {
  showScreen("mainMenu");
});

// Mode selection
let selectedMode = "co-op";
document.getElementById("coopMode").addEventListener("click", () => {
  selectedMode = "co-op";
  document.getElementById("coopMode").classList.add("selected");
  document.getElementById("versusMode").classList.remove("selected");
});

document.getElementById("versusMode").addEventListener("click", () => {
  selectedMode = "versus";
  document.getElementById("versusMode").classList.add("selected");
  document.getElementById("coopMode").classList.remove("selected");
});

document.getElementById("confirmModeBtn").addEventListener("click", () => {
  const level = parseInt(document.getElementById("levelInput").value) || 1;
  if (level < 1 || level > 100) {
    showToast("⚠️ Level must be between 1 and 100");
    return;
  }
  
  console.log("Creating room with mode:", selectedMode, "level:", level);
  gameState.socket.emit("create_room", {
    mode: selectedMode,
    level: level
  });
  showLoading(true, "Creating room...");
});

// Room buttons
document.getElementById("startGameBtn").addEventListener("click", () => {
  if (gameState.isHost && gameState.currentRoom) {
    console.log("Starting game...");
    gameState.socket.emit("start_game", { roomCode: gameState.currentRoom });
    showLoading(true, "Starting game...");
  }
});

document.getElementById("leaveRoomBtn").addEventListener("click", () => {
  if (gameState.currentRoom) {
    gameState.socket.emit("leave_room", gameState.currentRoom);
    gameState.currentRoom = null;
    gameState.isHost = false;
    showScreen("mainMenu");
  }
});

// Game buttons
document.getElementById("cookBtn").addEventListener("click", () => {
  if (gameState.gameActive && gameState.currentRoom) {
    gameState.socket.emit("player_action", {
      roomCode: gameState.currentRoom,
      type: "complete_order",
      recipe: "burger"
    });
    showToast("🍳 Cooking...");
  }
});

document.getElementById("serveBtn").addEventListener("click", () => {
  if (gameState.gameActive && gameState.currentRoom) {
    gameState.socket.emit("player_action", {
      roomCode: gameState.currentRoom,
      type: "complete_order",
      recipe: "fries"
    });
    showToast("🍽️ Served!");
  }
});

document.getElementById("pauseBtn").addEventListener("click", () => {
  gameState.isPaused = !gameState.isPaused;
  document.getElementById("pauseBtn").textContent = gameState.isPaused ? "▶ RESUME" : "⏸ PAUSE";
});

document.getElementById("leaveGameBtn").addEventListener("click", () => {
  if (confirm("Leave the game?")) {
    gameState.gameActive = false;
    gameState.socket.emit("leave_room", gameState.currentRoom);
    gameState.currentRoom = null;
    showScreen("mainMenu");
  }
});

// Game over buttons
document.getElementById("playAgainBtn").addEventListener("click", () => {
  showScreen("waitingRoom");
});

document.getElementById("mainMenuBtn").addEventListener("click", () => {
  gameState.currentRoom = null;
  gameState.isHost = false;
  showScreen("mainMenu");
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  // Rooms update automatically via socket
  showToast("🔄 Refreshing rooms...");
});

// ===== INITIALIZATION =====
window.addEventListener("load", () => {
  console.log("🎮 Restaurant Empire 3D - Initializing...");
  showLoading(true, "Loading game...");
  initThreeJS();
  initSocket();
});

window.addEventListener("beforeunload", () => {
  if (gameState.socket) {
    gameState.socket.disconnect();
  }
  cancelAnimationFrame(animationFrameId);
});

// Set initial mode selection
document.getElementById("coopMode").classList.add("selected");

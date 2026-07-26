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
  activeOrders: [],
  cookingProgress: 0,
  activeCooking: null,
};

let scene, camera, renderer, gameLight;
let playerModel, restaurantGroup;
let animationFrameId;
let customers = [];

// ===== THREE.JS INITIALIZATION =====
function initThreeJS() {
  const container = document.getElementById("gameContainer");

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf5f5dc);
  scene.fog = new THREE.Fog(0xf5f5dc, 100, 500);

  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 3, 10);
  camera.lookAt(0, 1, 0);

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowShadowMap;
  container.appendChild(renderer.domElement);

  gameLight = new THREE.DirectionalLight(0xffffff, 1);
  gameLight.position.set(30, 40, 30);
  gameLight.castShadow = true;
  gameLight.shadow.mapSize.width = 2048;
  gameLight.shadow.mapSize.height = 2048;
  gameLight.shadow.camera.near = 0.5;
  gameLight.shadow.camera.far = 500;
  scene.add(gameLight);

  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  scene.add(ambientLight);

  // Floor
  const groundGeometry = new THREE.PlaneGeometry(50, 50);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0xcccccc });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.position.y = 0;
  scene.add(ground);

  window.addEventListener("resize", onWindowResize);

  createRestaurant();
  createPlayer();

  animate();
}

function createPlayer() {
  if (playerModel) scene.remove(playerModel);

  playerModel = new THREE.Group();

  // Body
  const bodyGeometry = new THREE.BoxGeometry(0.6, 1.5, 0.4);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x3498db, roughness: 0.7 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.position.y = 0.75;
  playerModel.add(body);

  // Head
  const headGeometry = new THREE.SphereGeometry(0.3, 32, 32);
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf4a460, roughness: 0.8 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.castShadow = true;
  head.position.y = 1.8;
  playerModel.add(head);

  // Arms
  const armGeometry = new THREE.BoxGeometry(0.2, 1, 0.2);
  const armMaterial = new THREE.MeshStandardMaterial({ color: 0xf4a460 });
  const leftArm = new THREE.Mesh(armGeometry, armMaterial);
  leftArm.castShadow = true;
  leftArm.position.set(-0.4, 1.2, 0);
  playerModel.add(leftArm);

  const rightArm = new THREE.Mesh(armGeometry, armMaterial);
  rightArm.castShadow = true;
  rightArm.position.set(0.4, 1.2, 0);
  playerModel.add(rightArm);

  playerModel.position.set(0, 0, 5);
  scene.add(playerModel);
}

function createRestaurant() {
  if (restaurantGroup) scene.remove(restaurantGroup);

  restaurantGroup = new THREE.Group();

  // Walls
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xe8d4a8, roughness: 0.8 });

  // Back wall
  const backWallGeometry = new THREE.BoxGeometry(30, 8, 0.5);
  const backWall = new THREE.Mesh(backWallGeometry, wallMaterial);
  backWall.castShadow = true;
  backWall.position.set(0, 4, -10);
  restaurantGroup.add(backWall);

  // Left wall
  const leftWallGeometry = new THREE.BoxGeometry(0.5, 8, 20);
  const leftWall = new THREE.Mesh(leftWallGeometry, wallMaterial);
  leftWall.castShadow = true;
  leftWall.position.set(-15, 4, 0);
  restaurantGroup.add(leftWall);

  // Right wall
  const rightWallGeometry = new THREE.BoxGeometry(0.5, 8, 20);
  const rightWall = new THREE.Mesh(rightWallGeometry, wallMaterial);
  rightWall.castShadow = true;
  rightWall.position.set(15, 4, 0);
  restaurantGroup.add(rightWall);

  // KITCHEN COUNTER
  const counterGeometry = new THREE.BoxGeometry(12, 1, 2);
  const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513, roughness: 0.6 });
  const counter = new THREE.Mesh(counterGeometry, counterMaterial);
  counter.castShadow = true;
  counter.receiveShadow = true;
  counter.position.set(0, 0.5, -8);
  restaurantGroup.add(counter);

  // Stoves (cooktops)
  for (let i = 0; i < 3; i++) {
    const stoveGeometry = new THREE.BoxGeometry(2, 0.8, 1.5);
    const stoveMaterial = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const stove = new THREE.Mesh(stoveGeometry, stoveMaterial);
    stove.castShadow = true;
    stove.position.set(-4 + i * 4, 1, -8);
    restaurantGroup.add(stove);

    // Burners
    for (let j = 0; j < 2; j++) {
      const burnerGeometry = new THREE.CylinderGeometry(0.25, 0.25, 0.1, 32);
      const burnerMaterial = new THREE.MeshStandardMaterial({ color: 0x111111, metalness: 1 });
      const burner = new THREE.Mesh(burnerGeometry, burnerMaterial);
      burner.position.set(-3.5 + i * 4 + j * 0.7, 0.9, -8);
      restaurantGroup.add(burner);
    }
  }

  // Window above counter
  const windowGeometry = new THREE.BoxGeometry(10, 2, 0.2);
  const windowMaterial = new THREE.MeshStandardMaterial({ color: 0x87ceeb, metalness: 0.5, roughness: 0.1 });
  const window = new THREE.Mesh(windowGeometry, windowMaterial);
  window.position.set(0, 5, -9.8);
  restaurantGroup.add(window);

  // DINING TABLES
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 2; j++) {
      const tableTopGeometry = new THREE.BoxGeometry(2.5, 0.1, 2.5);
      const tableTopMaterial = new THREE.MeshStandardMaterial({ color: 0xd2691e, roughness: 0.7 });
      const tableTop = new THREE.Mesh(tableTopGeometry, tableTopMaterial);
      tableTop.castShadow = true;
      tableTop.receiveShadow = true;
      tableTop.position.set(-8 + i * 8, 0.8, 3 + j * 4);
      restaurantGroup.add(tableTop);

      // Table legs
      for (let k = 0; k < 4; k++) {
        const legGeometry = new THREE.BoxGeometry(0.2, 0.8, 0.2);
        const legMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
        const leg = new THREE.Mesh(legGeometry, legMaterial);
        leg.castShadow = true;
        const offset = 0.9;
        const xOffset = k % 2 === 0 ? -offset : offset;
        const zOffset = k < 2 ? -offset : offset;
        leg.position.set(-8 + i * 8 + xOffset, 0.4, 3 + j * 4 + zOffset);
        restaurantGroup.add(leg);
      }
    }
  }

  // SERVING STATION
  const servingGeometry = new THREE.BoxGeometry(4, 1.2, 1.5);
  const servingMaterial = new THREE.MeshStandardMaterial({ color: 0xcd853f, roughness: 0.6 });
  const servingStation = new THREE.Mesh(servingGeometry, servingMaterial);
  servingStation.castShadow = true;
  servingStation.receiveShadow = true;
  servingStation.position.set(8, 0.6, -8);
  restaurantGroup.add(servingStation);

  // Sign
  const signGeometry = new THREE.BoxGeometry(6, 1, 0.2);
  const signMaterial = new THREE.MeshStandardMaterial({ color: 0xff6347 });
  const sign = new THREE.Mesh(signGeometry, signMaterial);
  sign.castShadow = true;
  sign.position.set(0, 7, -9.8);
  restaurantGroup.add(sign);

  scene.add(restaurantGroup);
}

function createCustomers() {
  // Remove old customers
  customers.forEach(customer => {
    if (customer.group) scene.remove(customer.group);
  });
  customers = [];

  // Create new customers at tables
  const tablePositions = [
    { x: -8, z: 3 }, { x: 0, z: 3 }, { x: 8, z: 3 },
    { x: -8, z: 7 }, { x: 0, z: 7 }, { x: 8, z: 7 }
  ];

  const numCustomers = Math.min(gameState.maxCustomers, tablePositions.length);

  for (let i = 0; i < numCustomers; i++) {
    const pos = tablePositions[i];
    const customerGroup = new THREE.Group();

    // Customer body
    const bodyGeometry = new THREE.BoxGeometry(0.5, 1.2, 0.3);
    const bodyMaterial = new THREE.MeshStandardMaterial({ 
      color: new THREE.Color().setHSL(Math.random(), 0.7, 0.5),
      roughness: 0.7 
    });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.castShadow = true;
    body.position.y = 0.6;
    customerGroup.add(body);

    // Customer head
    const headGeometry = new THREE.SphereGeometry(0.25, 32, 32);
    const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf4a460 });
    const head = new THREE.Mesh(headGeometry, headMaterial);
    head.castShadow = true;
    head.position.y = 1.4;
    customerGroup.add(head);

    customerGroup.position.set(pos.x, 0, pos.z);
    scene.add(customerGroup);

    customers.push({
      group: customerGroup,
      position: pos,
      id: i,
      status: 'waiting', // waiting, eating, done
      served: false,
      progress: 0
    });
  }
}

function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  if (gameState.gameActive) {
    // Animate player
    if (playerModel) {
      playerModel.position.y = Math.sin(Date.now() * 0.008) * 0.15;
      playerModel.rotation.y += 0.003;
    }

    // Animate customers
    customers.forEach((customer, idx) => {
      if (customer.group) {
        customer.group.position.y = Math.sin(Date.now() * 0.005 + idx) * 0.1;
        customer.group.children[1].rotation.y += 0.01;
      }
    });

    // Update camera
    if (playerModel) {
      camera.position.x += (playerModel.position.x - camera.position.x) * 0.1;
      camera.position.y += (3 - camera.position.y) * 0.1;
      camera.position.z += (playerModel.position.z + 5 - camera.position.z) * 0.1;
      camera.lookAt(playerModel.position.x, playerModel.position.y + 1.5, playerModel.position.z);
    }
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
    showToast("✅ Connected!");
    joinGame();
  });

  gameState.socket.on("connect_error", (error) => {
    console.error("❌ Connection error:", error);
    showToast("❌ Connection failed");
  });

  gameState.socket.on("joined", (data) => {
    gameState.playerId = data.playerId;
    gameState.playerLevel = data.player?.level || 1;
    showScreen("mainMenu");
  });

  gameState.socket.on("room_created", (data) => {
    gameState.currentRoom = data.code;
    gameState.currentMode = data.mode;
    gameState.isHost = data.isHost;
    showLoading(false);
    updateWaitingRoom();
    showScreen("waitingRoom");
    showToast(`✅ Room: ${data.code}`);
  });

  gameState.socket.on("room_joined", (data) => {
    gameState.currentRoom = data.code;
    gameState.currentMode = data.room.mode;
    gameState.isHost = data.isHost;
    showLoading(false);
    updateWaitingRoom();
    showScreen("waitingRoom");
    showToast(`✅ Joined: ${data.code}`);
  });

  gameState.socket.on("room_updated", (room) => {
    gameState.players.clear();
    if (room.players && Array.isArray(room.players)) {
      room.players.forEach(player => {
        if (player && player.id) {
          gameState.players.set(player.id, player);
        }
      });
    }
    if (room.isHost !== undefined) {
      gameState.isHost = room.isHost;
    }
    updateWaitingRoom();
  });

  gameState.socket.on("game_started", (data) => {
    showLoading(false);
    gameState.gameActive = true;
    gameState.maxTime = data.gameState.maxTime;
    gameState.gameTime = data.gameState.timeRemaining;
    gameState.maxCustomers = data.gameState.maxCustomers;
    gameState.teamScore = 0;
    gameState.customersServed = 0;
    createCustomers();
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
    gameState.gameActive = false;
    customers.forEach(c => scene.remove(c.group));
    customers = [];
    showGameOver(data);
  });

  gameState.socket.on("player_level_up", (data) => {
    gameState.playerLevel = data.level;
    showToast(`🎉 Level ${data.level}!`);
  });

  gameState.socket.on("room_action", (action) => {
    if (action.points) {
      showToast(`✅ +${action.points} pts`);
    }
  });

  gameState.socket.on("error", (error) => {
    showToast("❌ Error");
  });

  gameState.socket.on("disconnect", () => {
    showToast("⚠️ Disconnected");
  });
}

function joinGame() {
  gameState.socket.emit("join_game", {
    name: gameState.playerName || "Guest",
    level: gameState.playerLevel,
    xp: 0,
    money: 0,
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
  if (show) {
    loading.classList.add("active");
    document.getElementById("loadingText").textContent = text;
  } else {
    loading.classList.remove("active");
  }
}

function showToast(message) {
  const toast = document.getElementById("toast");
  toast.textContent = message;
  toast.classList.add("show");
  setTimeout(() => toast.classList.remove("show"), 2000);
}

function updateWaitingRoom() {
  document.getElementById("roomCodeDisplay").textContent = `Room: ${gameState.currentRoom}`;
  document.getElementById("modeDisplay").textContent = gameState.currentMode === "co-op" ? "🤝 CO-OP" : "⚔️ VERSUS";

  const playerListDisplay = document.getElementById("playerListDisplay");
  playerListDisplay.innerHTML = "";

  gameState.players.forEach(player => {
    if (!player) return;
    const playerEl = document.createElement("div");
    playerEl.className = "player-item";
    const icon = gameState.isHost ? "👑" : "👤";
    playerEl.innerHTML = `
      <div class="player-icon">${icon}</div>
      <div class="player-name">${player.name || "Guest"}</div>
      <div class="player-level">Lvl ${player.level || 1}</div>
    `;
    playerListDisplay.appendChild(playerEl);
  });

  const startBtn = document.getElementById("startGameBtn");
  if (startBtn) {
    startBtn.style.display = gameState.isHost ? "block" : "none";
  }
}

function updateRoomList(rooms) {
  const roomList = document.getElementById("roomList");

  if (rooms.length === 0) {
    roomList.innerHTML = '<div class="card" style="text-align: center; color: #999;">No rooms available</div>';
    return;
  }

  roomList.innerHTML = "";
  rooms.forEach(room => {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-info">
        <div class="room-code">${room.code}</div>
        <div class="room-details">${room.mode === "co-op" ? "🤝" : "⚔️"} ${room.players}/4 • Lvl ${room.level}</div>
      </div>
      <button class="room-action">JOIN</button>
    `;
    card.querySelector(".room-action").addEventListener("click", () => {
      showLoading(true, "Joining...");
      gameState.socket.emit("join_room", room.code);
    });
    roomList.appendChild(card);
  });
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
  let html = `<div class="score-label">Final Results</div><div style="margin: 12px 0;"><p style="font-size: 14px; font-weight: 600;">Customers: ${data.customersServed}/${data.customersServed + (data.maxCustomers - data.customersServed)}</p>`;
  if (data.mode === "versus" && data.winner) {
    html += `<p style="color: var(--primary); font-weight: 600;">🏆 ${data.winner}</p>`;
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
    showToast("⚠️ Enter name");
    return;
  }
  showScreen("modeScreen");
});

document.getElementById("joinBtn").addEventListener("click", () => {
  if (!gameState.playerName) {
    showToast("⚠️ Enter name");
    return;
  }
  showScreen("browserScreen");
});

document.getElementById("backToMenuBtn").addEventListener("click", () => showScreen("mainMenu"));
document.getElementById("backFromBrowserBtn").addEventListener("click", () => showScreen("mainMenu"));

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
    showToast("⚠️ Level 1-100");
    return;
  }
  showLoading(true, "Creating...");
  gameState.socket.emit("create_room", { mode: selectedMode, level: level });
});

document.getElementById("startGameBtn").addEventListener("click", () => {
  if (gameState.isHost && gameState.currentRoom) {
    showLoading(true, "Starting...");
    gameState.socket.emit("start_game", { roomCode: gameState.currentRoom });
  }
});

document.getElementById("leaveRoomBtn").addEventListener("click", () => {
  if (gameState.currentRoom) {
    gameState.socket.emit("leave_room", gameState.currentRoom);
    gameState.currentRoom = null;
    showScreen("mainMenu");
  }
});

// GAME BUTTONS
document.getElementById("cookBtn").addEventListener("click", () => {
  if (!gameState.gameActive || gameState.isPaused) return;
  
  gameState.socket.emit("player_action", {
    roomCode: gameState.currentRoom,
    type: "complete_order",
    recipe: "burger"
  });
  
  // Visual feedback
  document.getElementById("cookBtn").style.transform = "scale(0.95)";
  setTimeout(() => document.getElementById("cookBtn").style.transform = "scale(1)", 100);
  showToast("🍳 Cooking!");
});

document.getElementById("serveBtn").addEventListener("click", () => {
  if (!gameState.gameActive || gameState.isPaused) return;
  
  gameState.socket.emit("player_action", {
    roomCode: gameState.currentRoom,
    type: "complete_order",
    recipe: "fries"
  });
  
  document.getElementById("serveBtn").style.transform = "scale(0.95)";
  setTimeout(() => document.getElementById("serveBtn").style.transform = "scale(1)", 100);
  showToast("🍽️ Served!");
});

document.getElementById("pauseBtn").addEventListener("click", () => {
  gameState.isPaused = !gameState.isPaused;
  const btn = document.getElementById("pauseBtn");
  btn.innerHTML = gameState.isPaused ? "▶ RESUME" : "⏸ PAUSE";
  btn.style.opacity = gameState.isPaused ? "0.6" : "1";
  showToast(gameState.isPaused ? "⏸ Paused" : "▶ Resumed");
});

document.getElementById("leaveGameBtn").addEventListener("click", () => {
  if (confirm("Leave game?")) {
    gameState.gameActive = false;
    gameState.socket.emit("leave_room", gameState.currentRoom);
    gameState.currentRoom = null;
    showScreen("mainMenu");
  }
});

document.getElementById("playAgainBtn").addEventListener("click", () => {
  showScreen("waitingRoom");
});

document.getElementById("mainMenuBtn").addEventListener("click", () => {
  gameState.currentRoom = null;
  gameState.isHost = false;
  showScreen("mainMenu");
});

document.getElementById("refreshBtn").addEventListener("click", () => {
  showToast("🔄 Refreshing...");
});

// ===== INIT =====
window.addEventListener("load", () => {
  showLoading(true, "Loading...");
  initThreeJS();
  initSocket();
});

window.addEventListener("beforeunload", () => {
  if (gameState.socket) gameState.socket.disconnect();
  cancelAnimationFrame(animationFrameId);
});

document.getElementById("coopMode").classList.add("selected");
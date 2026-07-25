// ===== GAME STATE =====
const gameState = {
  socket: null,
  playerId: null,
  playerName: "",
  playerLevel: 1,
  playerMoney: 0,
  playerXP: 0,
  currentRoom: null,
  currentRestaurant: null,
  gameActive: false,
  gameTime: 0,
  maxTime: 0,
  customersServed: 0,
  maxCustomers: 0,
  teamScore: 0,
  players: new Map(),
  isMobile: /iPhone|iPad|Android|webOS|BlackBerry/i.test(navigator.userAgent),
};

// ===== THREE.JS SCENE SETUP =====
let scene, camera, renderer, gameLight;
let playerModel, restaurantGroup;
let animationFrameId;

function initThreeJS() {
  const container = document.getElementById("gameContainer");

  // Scene
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.Fog(0x87ceeb, 100, 500);

  // Camera
  camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 5, 8);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowShadowMap;
  container.appendChild(renderer.domElement);

  // Lighting
  gameLight = new THREE.DirectionalLight(0xffffff, 1);
  gameLight.position.set(20, 30, 20);
  gameLight.castShadow = true;
  gameLight.shadow.mapSize.width = 2048;
  gameLight.shadow.mapSize.height = 2048;
  gameLight.shadow.camera.far = 200;
  gameLight.shadow.camera.left = -100;
  gameLight.shadow.camera.right = 100;
  gameLight.shadow.camera.top = 100;
  gameLight.shadow.camera.bottom = -100;
  scene.add(gameLight);

  // Ambient light
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
  scene.add(ambientLight);

  // Ground
  const groundGeometry = new THREE.PlaneGeometry(200, 200);
  const groundMaterial = new THREE.MeshLambertMaterial({ color: 0x90ee90 });
  const ground = new THREE.Mesh(groundGeometry, groundMaterial);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Handle window resize
  window.addEventListener("resize", onWindowResize);

  createPlayer();
  createRestaurant();

  // Start animation loop
  animate();
}

function createPlayer() {
  // Create a simple capsule-shaped player
  if (playerModel) scene.remove(playerModel);

  playerModel = new THREE.Group();

  // Body
  const bodyGeometry = new THREE.BoxGeometry(1, 2, 0.8);
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0x4a90e2 });
  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
  body.castShadow = true;
  body.receiveShadow = true;
  body.position.y = 1;
  playerModel.add(body);

  // Head
  const headGeometry = new THREE.SphereGeometry(0.4, 32, 32);
  const headMaterial = new THREE.MeshStandardMaterial({ color: 0xf4a460 });
  const head = new THREE.Mesh(headGeometry, headMaterial);
  head.castShadow = true;
  head.receiveShadow = true;
  head.position.y = 2.6;
  playerModel.add(head);

  playerModel.position.set(0, 0, 0);
  scene.add(playerModel);
}

function createRestaurant() {
  if (restaurantGroup) scene.remove(restaurantGroup);

  restaurantGroup = new THREE.Group();

  // Simple restaurant layout
  // Building
  const wallGeometry = new THREE.BoxGeometry(30, 10, 25);
  const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xd4a574 });
  const walls = new THREE.Mesh(wallGeometry, wallMaterial);
  walls.castShadow = true;
  walls.receiveShadow = true;
  walls.position.y = 5;
  restaurantGroup.add(walls);

  // Roof
  const roofGeometry = new THREE.ConeGeometry(20, 6, 4);
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x8b4513 });
  const roof = new THREE.Mesh(roofGeometry, roofMaterial);
  roof.castShadow = true;
  roof.receiveShadow = true;
  roof.position.y = 12;
  roof.rotation.y = Math.PI / 4;
  restaurantGroup.add(roof);

  // Counter (kitchen area)
  const counterGeometry = new THREE.BoxGeometry(15, 1, 3);
  const counterMaterial = new THREE.MeshStandardMaterial({ color: 0x654321 });
  const counter = new THREE.Mesh(counterGeometry, counterMaterial);
  counter.castShadow = true;
  counter.receiveShadow = true;
  counter.position.set(0, 1, -8);
  restaurantGroup.add(counter);

  // Tables
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 2; j++) {
      const tableGeometry = new THREE.BoxGeometry(2, 0.8, 2);
      const tableMaterial = new THREE.MeshStandardMaterial({ color: 0x8b7355 });
      const table = new THREE.Mesh(tableGeometry, tableMaterial);
      table.castShadow = true;
      table.receiveShadow = true;
      table.position.set(-8 + i * 5, 0.4, 3 + j * 4);
      restaurantGroup.add(table);
    }
  }

  // Cooking stations
  for (let i = 0; i < 3; i++) {
    const stoveGeometry = new THREE.BoxGeometry(2, 1.5, 2);
    const stoveMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const stove = new THREE.Mesh(stoveGeometry, stoveMaterial);
    stove.castShadow = true;
    stove.receiveShadow = true;
    stove.position.set(-8 + i * 4, 0.75, -10);
    restaurantGroup.add(stove);
  }

  scene.add(restaurantGroup);
}

function onWindowResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function animate() {
  animationFrameId = requestAnimationFrame(animate);

  // Update player animation (simple bobbing walk)
  if (playerModel && gameState.gameActive) {
    playerModel.position.y = Math.sin(Date.now() * 0.005) * 0.1;
  }

  // Update camera follow player
  if (playerModel) {
    camera.position.x += (playerModel.position.x - camera.position.x) * 0.1;
    camera.position.y += (5 - camera.position.y) * 0.1;
    camera.position.z += (playerModel.position.z + 8 - camera.position.z) * 0.1;
    camera.lookAt(playerModel.position.x, playerModel.position.y + 1, playerModel.position.z);
  }

  renderer.render(scene, camera);
}

// ===== SOCKET.IO SETUP =====
function initSocket() {
  const socketUrl = window.location.origin;

  gameState.socket = io(socketUrl, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: 5,
    transports: ["websocket", "polling"],
  });

  gameState.socket.on("connect", () => {
    console.log("Connected to server:", gameState.socket.id);
    gameState.playerId = gameState.socket.id;
    joinGame();
  });

  gameState.socket.on("joined", (data) => {
    console.log("Joined game:", data);
    gameState.playerId = data.playerId;
    showMenu();
  });

  gameState.socket.on("room_created", (data) => {
    gameState.currentRoom = data.code;
    hideMenuShowGame();
    updateUI();
  });

  gameState.socket.on("room_joined", (data) => {
    gameState.currentRoom = data.code;
    hideMenuShowGame();
    updateUI();
  });

  gameState.socket.on("rooms_updated", (rooms) => {
    updateRoomList(rooms);
  });

  gameState.socket.on("game_started", (data) => {
    gameState.gameActive = true;
    gameState.maxCustomers = data.gameState.maxCustomers;
    gameState.maxTime = data.gameState.timeRemaining;
    updateUI();
  });

  gameState.socket.on("game_update", (data) => {
    gameState.gameTime = data.gameState.timeRemaining;
    gameState.customersServed = data.gameState.customersServed;
    gameState.teamScore = data.gameState.teamScore;
    updateUI();
  });

  gameState.socket.on("game_ended", (data) => {
    gameState.gameActive = false;
    alert(`Game Over! Score: ${data.gameState.teamScore}`);
    showMenu();
  });

  gameState.socket.on("player_level_up", (data) => {
    if (data.playerId === gameState.playerId) {
      gameState.playerLevel = data.level;
      showToast(`🎉 Level ${data.level}!`);
      updateUI();
    }
  });

  gameState.socket.on("players_online", (count) => {
    console.log(`Players online: ${count}`);
  });

  gameState.socket.on("chat", (data) => {
    addChatMessage(data.playerName, data.message);
  });

  gameState.socket.on("disconnect", () => {
    console.log("Disconnected from server");
    showMenu();
  });

  gameState.socket.on("error", (error) => {
    console.error("Socket error:", error);
    showToast(`Error: ${error}`);
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
function showMenu() {
  document.getElementById("mainMenu").classList.remove("hidden");
  document.getElementById("gameUI").classList.remove("active");
  document.getElementById("joystickContainer").style.display = "none";
  document.getElementById("actionButtons").style.display = "none";
  gameState.gameActive = false;
}

function hideMenuShowGame() {
  document.getElementById("mainMenu").classList.add("hidden");
  document.getElementById("gameUI").classList.add("active");
  document.getElementById("joystickContainer").style.display = gameState.isMobile ? "flex" : "none";
  document.getElementById("actionButtons").style.display = gameState.isMobile ? "flex" : "none";
}

function updateUI() {
  document.getElementById("levelDisplay").textContent = gameState.playerLevel;
  document.getElementById("moneyDisplay").textContent = `$${gameState.playerMoney}`;
  const xpPercent = Math.floor((gameState.playerXP / (gameState.playerLevel * 500)) * 100);
  document.getElementById("xpDisplay").textContent = `${xpPercent}%`;
  document.getElementById("customersDisplay").textContent = `${gameState.customersServed}/${gameState.maxCustomers}`;
}

function updateRoomList(rooms) {
  const roomList = document.getElementById("roomList");
  roomList.innerHTML = "";

  rooms.forEach((room) => {
    const card = document.createElement("div");
    card.className = "room-card";
    card.innerHTML = `
      <div class="room-code">${room.code}</div>
      <div class="room-info">
        <div>Mode: ${room.mode}</div>
        <div>Players: ${room.players}/${room.maxPlayers || 4}</div>
      </div>
    `;
    card.addEventListener("click", () => {
      gameState.socket.emit("join_room", room.code);
      document.getElementById("roomListContainer").style.display = "none";
      document.getElementById("menuButtons").style.display = "block";
    });
    roomList.appendChild(card);
  });
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.style.cssText = `
    position: fixed;
    top: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: rgba(0, 0, 0, 0.9);
    color: #fff;
    padding: 12px 24px;
    border-radius: 8px;
    border: 2px solid #667eea;
    z-index: 9999;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => toast.remove(), 2000);
}

function addChatMessage(playerName, message) {
  const chatBox = document.getElementById("chatBox");
  if (chatBox.style.display === "none") chatBox.style.display = "block";

  const messageEl = document.createElement("div");
  messageEl.className = "chat-message";
  messageEl.innerHTML = `<span class="player-name">${playerName}:</span> ${message}`;
  chatBox.appendChild(messageEl);

  // Auto-scroll to bottom
  chatBox.scrollTop = chatBox.scrollHeight;

  // Limit messages shown
  if (chatBox.children.length > 20) {
    chatBox.children[0].remove();
  }
}

// ===== EVENT LISTENERS =====
document.getElementById("hostBtn").addEventListener("click", () => {
  gameState.playerName = document.getElementById("inputName").value || "Player";
  gameState.socket.emit("create_room", { mode: "co-op", maxPlayers: 4, level: 1 });
  document.getElementById("mainMenu").classList.add("hidden");
  document.getElementById("loading").classList.remove("hidden");
});

document.getElementById("joinBtn").addEventListener("click", () => {
  gameState.playerName = document.getElementById("inputName").value || "Player";
  document.getElementById("roomListContainer").style.display = "block";
  document.getElementById("menuButtons").style.display = "none";
  gameState.socket.emit("get_rooms");
});

document.getElementById("backBtn").addEventListener("click", () => {
  document.getElementById("roomListContainer").style.display = "none";
  document.getElementById("menuButtons").style.display = "block";
});

document.getElementById("pauseBtn").addEventListener("click", () => {
  gameState.gameActive = !gameState.gameActive;
  document.getElementById("pauseBtn").textContent = gameState.gameActive ? "⏸ Pause" : "▶ Resume";
});

document.getElementById("leaveBtn").addEventListener("click", () => {
  if (confirm("Leave the game?")) {
    gameState.gameActive = false;
    gameState.socket.emit("leave_room");
    showMenu();
  }
});

// Action buttons
document.getElementById("cookBtn").addEventListener("click", () => {
  gameState.socket.emit("player_action", {
    roomCode: gameState.currentRoom,
    type: "cook",
    recipe: "burger",
  });
  showToast("🍳 Cooking...");
});

document.getElementById("serveBtn").addEventListener("click", () => {
  gameState.socket.emit("player_action", {
    roomCode: gameState.currentRoom,
    type: "complete_order",
    recipe: "burger",
  });
  showToast("🍽️ Served!");
});

document.getElementById("cleanBtn").addEventListener("click", () => {
  gameState.socket.emit("player_action", {
    roomCode: gameState.currentRoom,
    type: "clean",
  });
  showToast("🧹 Cleaned!");
});

// Mobile joystick (simple implementation)
if (gameState.isMobile) {
  let touchStartX = 0;
  let touchStartY = 0;

  document.addEventListener("touchstart", (e) => {
    if (e.target.closest(".joystick-container")) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
    }
  });

  document.addEventListener("touchmove", (e) => {
    if (gameState.gameActive) {
      const deltaX = e.touches[0].clientX - touchStartX;
      const deltaY = e.touches[0].clientY - touchStartY;

      if (playerModel) {
        playerModel.position.x += deltaX * 0.01;
        playerModel.position.z += deltaY * 0.01;

        gameState.socket.emit("player_position", {
          position: playerModel.position,
          rotation: playerModel.rotation,
        });
      }
    }
  });
}

// ===== INITIALIZATION =====
window.addEventListener("load", () => {
  document.getElementById("loading").classList.remove("hidden");
  initThreeJS();
  initSocket();
  showMenu();
  document.getElementById("loading").classList.add("hidden");
});

window.addEventListener("beforeunload", () => {
  if (gameState.socket) {
    gameState.socket.disconnect();
  }
  cancelAnimationFrame(animationFrameId);
});

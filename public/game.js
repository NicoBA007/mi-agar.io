const socket = io();

// ==========================================
// 1. REFERENCIAS AL DOM Y VARIABLES DE ESTADO
// ==========================================

// Pantallas Principales
const loginScreen = document.getElementById('login-screen');
const lobbyScreen = document.getElementById('lobby-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const victoryScreen = document.getElementById('victory-screen');
const leaderboardDiv = document.getElementById('leaderboard');
const spectatorControls = document.getElementById('spectator-controls');

// Elementos del Login y Lobby
const nicknameInput = document.getElementById('nickname');
const colorInput = document.getElementById('color-picker');
const skinSelector = document.getElementById('skin-selector');
const customSkinInput = document.getElementById('custom-skin-input');
const previewContainer = document.getElementById('preview-container');
const skinPreview = document.getElementById('skin-preview');
const playerCountDiv = document.getElementById('player-count');
const lobbyPlayerList = document.getElementById('lobby-player-list');
const countdownOverlay = document.getElementById('countdown-overlay');
const countdownNumber = document.getElementById('countdown-number');

// Elementos de Información (HUD y Game Over)
const myIdSpan = document.getElementById('my-id');
const leaderboardList = document.getElementById('leaderboard-list');
const killerName = document.getElementById('killer-name');
const deathMessage = document.getElementById('death-message');
const killerSkinImg = document.getElementById('killer-skin-img');
const killerColorCircle = document.getElementById('killer-color-circle');
const statFinalMass = document.getElementById('stat-final-mass');
const statRank = document.getElementById('stat-rank');
const statFood = document.getElementById('stat-food');
const statTime = document.getElementById('stat-time');
const winnerNameText = document.getElementById('winner-name');
const finalLeaderboardList = document.getElementById('final-leaderboard-list');
const restartCountdownSpan = document.getElementById('restart-countdown');

// Botones
const playBtn = document.getElementById('play-btn');
const restartBtn = document.getElementById('restart-btn');
const goMenuBtn = document.getElementById('go-menu-btn');
const goSpectateBtn = document.getElementById('go-spectate-btn');
const specDetailsBtn = document.getElementById('spec-details-btn');
const specRestartBtn = document.getElementById('spec-restart-btn');
const specMenuBtn = document.getElementById('spec-menu-btn');

// Canvas y Contexto de Dibujo
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// Configuración de Colores Neón
const neonColors = [
    "#FF0055", "#00FF55", "#5500FF", "#FFFF00", "#00FFFF",
    "#FF00FF", "#FF5500", "#AA00FF", "#00FF00", "#0080FF"
];

// Variables Globales del Juego (Estado Local)
let myId = null;            // Mi ID único de socket
let players = {};           // Datos de todos los jugadores visibles
let food = [];              // Lista de comida
let ejectedMass = [];       // Masa disparada
let viruses = [];           // Lista de virus
let mouseX = 0, mouseY = 0; // Posición del mouse
let viewZoom = 1;           // Zoom de la cámara

// Estado de Skins y Espectador
let myCustomSkinData = null;
const loadedSkins = {
    earth: new Image(), moon: new Image(), mars: new Image(), virus: new Image()
};
// Carga de imágenes por defecto
loadedSkins.earth.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/9/97/The_Earth_seen_from_Apollo_17.jpg/1024px-The_Earth_seen_from_Apollo_17.jpg';
loadedSkins.moon.src = 'https://upload.wikimedia.org/wikipedia/commons/e/e1/FullMoon2010.jpg';
loadedSkins.mars.src = 'https://upload.wikimedia.org/wikipedia/commons/0/02/OSIRIS_Mars_true_color.jpg';
loadedSkins.virus.src = 'https://upload.wikimedia.org/wikipedia/commons/thumb/8/82/SARS-CoV-2_without_background.png/1009px-SARS-CoV-2_without_background.png';
const customSkinCache = {}; // Caché para no recargar skins custom ajenas

// Variables para control de lógica
let isSpectating = false;
let spectateTargetId = null;
let lastLobbyNamesJSON = "";
let inputInterval = null;

// ==========================================
// 2. CONFIGURACIÓN INICIAL Y EVENTOS DE INPUT
// ==========================================

// FUNCIÓN: Configuración de Canvas
// Ajusta el tamaño del lienzo al tamaño de la ventana.
canvas.width = window.innerWidth;
canvas.height = window.innerHeight;
window.addEventListener('resize', () => {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
});

// EVENTO: Movimiento del Mouse
// Guarda la posición X e Y del mouse para enviarla al servidor.
canvas.addEventListener('mousemove', (e) => {
    mouseX = e.clientX;
    mouseY = e.clientY;
});

// EVENTO: Teclado
// Detecta Espacio (Dividirse), W (Disparar) y ESC (Salir de espectador).
window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') socket.emit('split');
    if (e.code === 'KeyW') socket.emit('eject');
    if (e.code === 'Escape' && isSpectating) goToMenu();
});

// FUNCIÓN: Color Aleatorio
// Asigna un color neón al azar al cargar la página.
function setRandomNeonColor() {
    const randomColor = neonColors[Math.floor(Math.random() * neonColors.length)];
    colorInput.value = randomColor;
}
setRandomNeonColor();

// LÓGICA: Carga de Skin Personalizada
// Convierte la imagen subida a Base64 y muestra previsualización.
customSkinInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
        const img = new Image();
        img.src = event.target.result;
        img.onload = () => {
            const tempCanvas = document.createElement('canvas');
            const tempCtx = tempCanvas.getContext('2d');
            tempCanvas.width = 100; tempCanvas.height = 100;
            tempCtx.drawImage(img, 0, 0, 100, 100);
            myCustomSkinData = tempCanvas.toDataURL('image/jpeg', 0.8);
            skinPreview.src = myCustomSkinData;
            previewContainer.classList.remove('hidden');
            skinSelector.value = ""; // Reset selector normal
        }
    };
    reader.readAsDataURL(file);
});

// Resetear skin custom si elige una normal
skinSelector.addEventListener('change', () => {
    if (skinSelector.value !== "") {
        customSkinInput.value = "";
        myCustomSkinData = null;
        previewContainer.classList.add('hidden');
    }
});

// ==========================================
// 3. COMUNICACIÓN CON SERVIDOR (SOCKET.IO)
// ==========================================

// EVENTO: Información Inicial
socket.on('playerInfo', (id) => {
    myId = id;
    myIdSpan.innerText = id;
});

// EVENTO: Error de Conexión / Lleno
socket.on('serverFull', (msg) => {
    alert(msg);
    location.reload();
});

// EVENTO: Entrar a la Sala (Privado)
// Oculta login y muestra la sala de espera.
socket.on('joinedLobby', () => {
    loginScreen.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    spectatorControls.classList.add('hidden');
    lobbyScreen.classList.remove('hidden');
});

// EVENTO: Actualización de Sala (Público)
// Recibe lista de nombres y tiempo restante para actualizar la UI.
socket.on('lobbyUpdate', (data) => {
    // 1. Actualizar texto del reloj/estado
    if (!data.timerActive) {
        playerCountDiv.innerText = `${data.count} / ${data.required} para iniciar`;
        playerCountDiv.style.color = "#4CAF50";
        const infoText = document.querySelector('.lobby-info p');
        if (infoText) infoText.innerText = "Esperando jugadores...";
    } else {
        playerCountDiv.innerText = `INICIO EN: ${data.timeLeft}s`;
        playerCountDiv.style.color = "#FF5722";
        const infoText = document.querySelector('.lobby-info p');
        if (infoText) infoText.innerText = "¡La partida va a comenzar!";
    }

    // 2. Renderizar lista de nombres (solo si cambió)
    const currentNamesJSON = JSON.stringify(data.names);
    if (currentNamesJSON !== lastLobbyNamesJSON) {
        lobbyPlayerList.innerHTML = '';
        data.names.forEach((name, index) => {
            const li = document.createElement('li');
            li.innerText = `${index + 1}. ${name}`;
            lobbyPlayerList.appendChild(li);
        });
        lastLobbyNamesJSON = currentNamesJSON;
    }
});

// EVENTO: Cuenta Regresiva Final
// Muestra los números grandes (3, 2, 1) antes de jugar.
socket.on('startCountdown', (seconds) => {
    lobbyScreen.classList.add('hidden');
    countdownOverlay.classList.remove('hidden');
    let counter = seconds;
    countdownNumber.innerText = counter;

    const interval = setInterval(() => {
        counter--;
        if (counter > 0) {
            countdownNumber.innerText = counter;
        } else {
            clearInterval(interval);
        }
    }, 1000);
});

// EVENTO: Inicio de Juego
// Oculta menús y activa el envío de datos del mouse.
socket.on('gameStarted', () => {
    lobbyScreen.classList.add('hidden');
    loginScreen.classList.add('hidden');
    countdownOverlay.classList.add('hidden');
    leaderboardDiv.classList.remove('hidden');
    if (!inputInterval) startInputLoop();
});

// EVENTO: Actualización de Estado (TICK)
// Recibe posiciones de comida, virus y jugadores para dibujar.
socket.on('stateUpdate', (data) => {
    food = data.food;
    ejectedMass = data.ejectedMass || [];
    viruses = data.viruses || [];
    updateLeaderboard(data.leaderboard);

    // Si espectamos a alguien que desaparece, cambiamos al #1 del ranking
    if (isSpectating && spectateTargetId && !data.players[spectateTargetId]) {
        if (data.leaderboard && data.leaderboard.length > 0) {
            spectateTargetId = data.leaderboard[0].id;
        }
    }

    // Sincronización inteligente de jugadores (Interpolación)
    const backendPlayers = data.players;
    for (const id in backendPlayers) {
        const bPlayer = backendPlayers[id];
        if (!players[id]) {
            players[id] = bPlayer; // Jugador nuevo
        } else {
            // Actualizar datos existentes
            players[id].nickname = bPlayer.nickname;
            players[id].color = bPlayer.color;
            players[id].skin = bPlayer.skin;
            players[id].customSkin = bPlayer.customSkin;

            // Mapeo de células para interpolación suave
            const currentCellsMap = {};
            players[id].cells.forEach(c => currentCellsMap[c.id] = c);

            players[id].cells = bPlayer.cells.map(bCell => {
                const existingCell = currentCellsMap[bCell.id];
                if (existingCell) {
                    // Si existe, actualizamos su OBJETIVO (para animar hacia allí)
                    existingCell.targetX = bCell.x;
                    existingCell.targetY = bCell.y;
                    existingCell.targetRadius = bCell.radius;
                    return existingCell;
                } else {
                    // Si es nueva célula (división), la creamos
                    return {
                        id: bCell.id, x: bCell.x, y: bCell.y, radius: bCell.radius,
                        targetX: bCell.x, targetY: bCell.y, targetRadius: bCell.radius
                    };
                }
            });
        }
    }
    // Eliminar jugadores que ya no envía el servidor
    for (const id in players) {
        if (!backendPlayers[id]) delete players[id];
    }
});

// EVENTO: Game Over (Muerte)
// Muestra pantalla de muerte con estadísticas y opciones.
socket.on('gameOver', (data) => {
    killerName.innerText = data.killerName;
    deathMessage.innerText = data.message;

    // Mostrar skin o color del asesino
    if (data.killerCustomSkin) {
        killerSkinImg.src = data.killerCustomSkin;
        killerSkinImg.classList.remove('hidden');
        killerColorCircle.classList.add('hidden');
    } else if (data.killerSkin && loadedSkins[data.killerSkin]) {
        killerSkinImg.src = loadedSkins[data.killerSkin].src;
        killerSkinImg.classList.remove('hidden');
        killerColorCircle.classList.add('hidden');
    } else {
        killerSkinImg.classList.add('hidden');
        killerColorCircle.classList.remove('hidden');
        killerColorCircle.style.backgroundColor = data.killerColor;
    }

    // Estadísticas
    statFinalMass.innerText = data.stats.finalMass;
    statRank.innerText = data.stats.bestRank === 999 ? "-" : "#" + data.stats.bestRank;
    statFood.innerText = data.stats.cellsEaten;
    const secondsAlive = Math.floor(data.stats.timeAlive / 1000);
    statTime.innerText = `${Math.floor(secondsAlive / 60)}m ${secondsAlive % 60}s`;

    // Cambiar a modo espectador del asesino automáticamente
    spectateTargetId = data.killerId;

    gameOverScreen.classList.remove('hidden');
    leaderboardDiv.classList.add('hidden');
    spectatorControls.classList.add('hidden');
});

// EVENTO: Victoria de Ronda
// Muestra la tabla final de clasificación y el ganador.
socket.on('roundWon', (data) => {
    leaderboardDiv.classList.add('hidden');
    spectatorControls.classList.add('hidden');
    winnerNameText.innerText = data.winnerName;

    finalLeaderboardList.innerHTML = '';
    data.leaderboard.forEach((player, index) => {
        const li = document.createElement('li');
        if (player.id === myId) li.classList.add('highlight-self');
        li.innerHTML = `
            <span style="color: ${player.id === myId ? '#fff' : player.color}; text-shadow: 0 0 2px black;">
                #${index + 1} ${player.name}
            </span> 
            <span>${player.score}</span>
        `;
        finalLeaderboardList.appendChild(li);
    });

    victoryScreen.classList.remove('hidden');

    // Cuenta regresiva para reiniciar
    let timeLeft = 10;
    restartCountdownSpan.innerText = timeLeft;
    const timer = setInterval(() => {
        timeLeft--;
        if (timeLeft >= 0) restartCountdownSpan.innerText = timeLeft;
        else clearInterval(timer);
    }, 1000);
});

// EVENTO: Reinicio del Servidor
socket.on('serverReset', () => {
    location.reload(); // Recarga la página completa
});

// ==========================================
// 4. LÓGICA DE INTERFAZ (UI & BOTONES)
// ==========================================

// FUNCIÓN: Unirse al Juego
// Valida el nombre y envía la señal al servidor.
function joinGame() {
    const name = nicknameInput.value.trim();
    if (name.length === 0) {
        alert("¡Debes ponerte un nombre para jugar!");
        return;
    }
    const color = colorInput.value;
    const skin = skinSelector.value;
    // Emitir evento para iniciar
    socket.emit('startGame', {
        nickname: name, color: color, skin: skin, customSkin: myCustomSkinData
    });
}

// FUNCIÓN: Ir al Menú Principal
// Resetea las pantallas visibles.
function goToMenu() {
    gameOverScreen.classList.add('hidden');
    spectatorControls.classList.add('hidden');
    leaderboardDiv.classList.add('hidden');
    loginScreen.classList.remove('hidden');
    isSpectating = false;
    spectateTargetId = null;
}

// Botones de Pantalla Inicial
playBtn.addEventListener('click', joinGame);

// Botones de Game Over
restartBtn.addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    spectatorControls.classList.add('hidden');
    isSpectating = false;
    joinGame();
});
goMenuBtn.addEventListener('click', goToMenu);
goSpectateBtn.addEventListener('click', () => {
    gameOverScreen.classList.add('hidden');
    leaderboardDiv.classList.remove('hidden');
    spectatorControls.classList.remove('hidden');
    isSpectating = true;
});

// Botones de Modo Espectador
specDetailsBtn.addEventListener('click', () => {
    spectatorControls.classList.add('hidden');
    leaderboardDiv.classList.add('hidden');
    gameOverScreen.classList.remove('hidden');
});
specRestartBtn.addEventListener('click', () => {
    spectatorControls.classList.add('hidden');
    gameOverScreen.classList.add('hidden');
    isSpectating = false;
    joinGame();
});
specMenuBtn.addEventListener('click', goToMenu);

// FUNCIÓN: Actualizar Leaderboard (HUD)
function updateLeaderboard(topPlayers) {
    leaderboardList.innerHTML = '';
    if (!topPlayers) return;
    topPlayers.forEach((player, index) => {
        const li = document.createElement('li');
        li.innerHTML = `
            <span style="color: ${player.color}; text-shadow: 0 0 2px black; font-weight: bold;">
                #${index + 1} ${player.name}
            </span> 
            <span>${player.score}</span>
        `;
        leaderboardList.appendChild(li);
    });
}

// FUNCIÓN: Bucle de Input (60fps)
// Envía constantemente la posición del mouse si estamos jugando.
function startInputLoop() {
    if (inputInterval) clearInterval(inputInterval);
    inputInterval = setInterval(() => {
        if (!isSpectating && myId && players[myId] && players[myId].cells.length > 0) {
            // Calcular centro del jugador
            let centerX = 0, centerY = 0;
            players[myId].cells.forEach(c => { centerX += c.x; centerY += c.y; });
            centerX /= players[myId].cells.length;
            centerY /= players[myId].cells.length;

            // Vector relativo al centro de la pantalla
            const vectorX = mouseX - canvas.width / 2;
            const vectorY = mouseY - canvas.height / 2;
            socket.emit('input', { x: centerX + vectorX, y: centerY + vectorY });
        }
    }, 1000 / 60);
}

// ==========================================
// 5. MOTOR GRÁFICO (CANVAS RENDER)
// ==========================================

// Función auxiliar de Interpolación Lineal (Suavizado)
function lerp(start, end, t) { return start + (end - start) * t; }

// FUNCIÓN: Dibujar Virus
// Dibuja el círculo verde con picos.
function drawVirus(ctx, x, y, radius) {
    ctx.fillStyle = '#33FF33'; ctx.strokeStyle = '#22AA22'; ctx.lineWidth = 5;
    const numSpikes = 20; const spikeHeight = 5;
    ctx.beginPath();
    for (let i = 0; i < numSpikes * 2; i++) {
        const angle = (Math.PI * 2 * i) / (numSpikes * 2);
        const r = (i % 2 === 0) ? radius + spikeHeight : radius - spikeHeight;
        const vx = x + Math.cos(angle) * r;
        const vy = y + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(vx, vy); else ctx.lineTo(vx, vy);
    }
    ctx.closePath(); ctx.fill(); ctx.stroke();
}

// FUNCIÓN: Efecto Gelatina
// Calcula el borde oscilante de las células.
function traceJellyPath(ctx, radius) {
    const resolution = Math.max(20, Math.min(120, Math.floor(radius * 1.5)));
    const time = Date.now() / 200;
    ctx.beginPath();
    for (let i = 0; i <= resolution; i++) {
        const angle = (Math.PI * 2 * i) / resolution;
        const offset = Math.sin(angle * 5 + time) * Math.cos(angle * 3 - time);
        const wobbleAmount = radius * 0.03; // Intensidad del temblor
        const r = radius + (offset * wobbleAmount);
        const x = Math.cos(angle) * r;
        const y = Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
}

// FUNCIÓN: Dibujar Cuadrícula de Fondo
function drawGrid() {
    ctx.beginPath(); ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'; ctx.lineWidth = 1;
    for (let x = 0; x <= 3000; x += 50) { ctx.moveTo(x, 0); ctx.lineTo(x, 3000); }
    for (let y = 0; y <= 3000; y += 50) { ctx.moveTo(0, y); ctx.lineTo(3000, y); }
    ctx.stroke(); ctx.closePath();
}

// FUNCIÓN PRINCIPAL: Draw (Render Loop)
// Se ejecuta frame a frame para dibujar todo el juego.
function draw() {
    requestAnimationFrame(draw);

    // 1. Limpiar pantalla
    ctx.fillStyle = '#0b0b0b';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 2. Calcular Cámara (Posición y Zoom)
    let camX = 0, camY = 0;
    let totalMassForZoom = 0;
    let targetFound = false;

    // Decidir a quién sigue la cámara (A mí o al objetivo espectado)
    if (!isSpectating && myId && players[myId] && players[myId].cells.length > 0) {
        const p = players[myId];
        p.cells.forEach(c => { camX += c.x; camY += c.y; totalMassForZoom += c.mass; });
        camX /= p.cells.length; camY /= p.cells.length;
        targetFound = true;
    }
    else if (isSpectating && spectateTargetId && players[spectateTargetId]) {
        const p = players[spectateTargetId];
        if (p.cells.length > 0) {
            p.cells.forEach(c => { camX += c.x; camY += c.y; totalMassForZoom += c.mass; });
            camX /= p.cells.length; camY /= p.cells.length;
            targetFound = true;
        }
    }

    if (!targetFound) { camX = 1500; camY = 1500; totalMassForZoom = 100; }

    // Calcular zoom dinámico basado en la masa
    let massZoom = 50 / (Math.sqrt(totalMassForZoom) + 40);
    const baseWidth = 1920; const baseHeight = 1080;
    let screenFactor = Math.max(canvas.width / baseWidth, canvas.height / baseHeight);
    let targetZoom = massZoom * screenFactor;
    targetZoom = Math.max(0.1 * screenFactor, Math.min(1.5 * screenFactor, targetZoom));
    viewZoom = lerp(viewZoom, targetZoom, 0.05); // Suavizar cambio de zoom

    // 3. Interpolar posiciones de TODOS los jugadores (Suavizar movimiento)
    for (const id in players) {
        const p = players[id];
        p.cells.forEach(cell => {
            if (cell.targetX !== undefined) {
                cell.x = lerp(cell.x, cell.targetX, 0.1);
                cell.y = lerp(cell.y, cell.targetY, 0.1);
                cell.radius = lerp(cell.radius, cell.targetRadius, 0.1);
            }
        });
    }

    // 4. Aplicar transformaciones de cámara
    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.scale(viewZoom, viewZoom);
    ctx.translate(-camX, -camY);

    // 5. Dibujar Fondo y Bordes
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, 3000, 3000); ctx.clip();
    drawGrid();
    ctx.strokeStyle = '#333'; ctx.lineWidth = 5; ctx.strokeRect(0, 0, 3000, 3000);

    // 6. Dibujar Comida
    food.forEach(f => {
        ctx.beginPath(); ctx.arc(f.x, f.y, 5, 0, Math.PI * 2);
        ctx.fillStyle = f.color; ctx.fill();
    });

    // 7. Dibujar Masa Eyectada
    ejectedMass.forEach(em => {
        ctx.beginPath(); ctx.arc(em.x, em.y, em.radius, 0, Math.PI * 2);
        ctx.fillStyle = em.color; ctx.fill();
        ctx.strokeStyle = 'black'; ctx.lineWidth = 1; ctx.stroke();
    });

    // 8. Dibujar Células de Jugadores
    let allCellsToDraw = [];
    for (const id in players) {
        const p = players[id];
        p.cells.forEach(c => {
            allCellsToDraw.push({ ...c, nickname: p.nickname, color: p.color, skin: p.skin, customSkin: p.customSkin, parentId: p.id });
        });
    }
    // Ordenar por tamaño para que las grandes no tapen a las pequeñas
    allCellsToDraw.sort((a, b) => a.radius - b.radius);

    allCellsToDraw.forEach(cell => {
        ctx.save(); ctx.translate(cell.x, cell.y);
        traceJellyPath(ctx, cell.radius); // Efecto visual

        // Decidir si dibujar Skin o Color
        let imageToDraw = null;
        if (cell.customSkin) {
            if (!customSkinCache[cell.parentId]) {
                const img = new Image(); img.src = cell.customSkin;
                customSkinCache[cell.parentId] = img;
            }
            if (customSkinCache[cell.parentId].complete) imageToDraw = customSkinCache[cell.parentId];
        } else if (cell.skin && loadedSkins[cell.skin] && loadedSkins[cell.skin].complete) {
            imageToDraw = loadedSkins[cell.skin];
        }

        if (imageToDraw) {
            ctx.save(); ctx.clip();
            ctx.drawImage(imageToDraw, -cell.radius, -cell.radius, cell.radius * 2, cell.radius * 2);
            ctx.restore();
        } else {
            ctx.fillStyle = cell.color; ctx.fill();
        }

        // Borde blanco
        const borderWidth = Math.max(2, cell.radius * 0.05);
        ctx.strokeStyle = '#fff'; ctx.lineWidth = borderWidth; ctx.stroke();

        // 9. Dibujar Nombres
        if (cell.radius > 5) {
            ctx.fillStyle = 'white';
            ctx.font = `bold ${Math.max(16, cell.radius * 0.5)}px Arial`;
            ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.strokeStyle = 'black'; ctx.lineWidth = 2;
            ctx.strokeText(cell.nickname, 0, 0);
            ctx.fillText(cell.nickname, 0, 0);
        }
        ctx.restore();
    });
    ctx.restore(); // Restaurar clip del mapa

    // 10. Dibujar Virus (encima de todo)
    ctx.save();
    viruses.forEach(v => drawVirus(ctx, v.x, v.y, v.radius));
    ctx.restore();

    ctx.restore(); // Finalizar frame
}

// Iniciar renderizado
draw();
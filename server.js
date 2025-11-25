const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);

const PORT = process.env.PORT || 3000; // Puerto de conexión

// ==========================================
// CONFIGURACIÓN Y CONSTANTES DEL JUEGO
// ==========================================

// Parámetros de Victoria y Mapa
const WINNING_SCORE = 500;    // Puntos necesarios para ganar la ronda
const MAX_PLAYERS = 10;       // Límite de jugadores simultáneos
const MAP_WIDTH = 3000;       // Ancho del mapa
const MAP_HEIGHT = 3000;      // Alto del mapa

// Configuración de Física y Rendimiento
const TICK_RATE = 60;         // Tasa de actualización (60 veces por segundo)
const BASE_SPEED = 8;         // Velocidad base de movimiento
const MAX_CELLS = 16;         // Máximo de divisiones por jugador
const MERGE_TIMER = 45000;    // Tiempo para volver a unirse (ms)

// Configuración de Entidades (Comida y Virus)
const MAX_FOOD = 250;         // Cantidad de comida en el mapa
const EJECT_MASS_GAIN = 15;   // Masa que gana quien come masa eyectada
const EJECT_MASS_LOSS = 18;   // Masa que pierde el jugador al disparar
const EJECT_SPEED = 28;       // Velocidad del disparo
const MAX_VIRUSES = 15;       // Cantidad de virus
const VIRUS_MASS = 60;        // Masa del virus
const VIRUS_RADIUS = 60;      // Tamaño del virus

// Frases para mostrar cuando alguien muere
const DEATH_PHRASES = [
  "ha cenado contigo", "te ha aplastado sin piedad", "te ha borrado del mapa",
  "usó tu masa para crecer", "te ha absorbido", "te pasó por encima", "te convirtió en su merienda"
];

// Estados posibles de la partida
const GAME_STATE = {
  WAITING: 0,   // En sala de espera
  PLAYING: 1,   // Jugando activamente
  ENDED: 2      // Ronda terminada (mostrando ganador)
};

// ==========================================
// VARIABLES DE ESTADO (MEMORIA DEL JUEGO)
// ==========================================

// Configuración de la Sala de Espera (Lobby)
const MIN_PLAYERS_TO_START = 3; // Jugadores mínimos para iniciar contador
const INITIAL_WAIT_TIME = 30;   // Tiempo de espera inicial
const EXTENSION_TIME = 5;       // Tiempo extra si entra alguien nuevo

// Variables del Temporizador
let lobbyTimer = null;    // Guarda la referencia al intervalo del reloj
let lobbyTimeLeft = 0;    // Guarda los segundos restantes para iniciar
let isTimerRunning = false; // Indica si el reloj está activo

// Listas de Entidades en el juego
let food = [];            // Array de comida disponible
let players = {};         // Objeto con datos de todos los jugadores conectados
let ejectedMass = [];     // Array de masa disparada (w)
let viruses = [];         // Array de virus
let waitingPlayers = [];  // Lista de IDs de sockets esperando en el lobby

let currentGameState = GAME_STATE.WAITING; // Estado actual del servidor

// Generador de IDs únicos para las células
let uniqueCellIdCounter = 0;
function getCellId() {
  return uniqueCellIdCounter++;
}

// ==========================================
// FUNCIONES GENERADORAS (HELPERS)
// ==========================================

// FUNCIÓN: Crear Comida
// Sirve para: Generar un punto de comida con posición y color aleatorio.
function createFood() {
  return {
    x: Math.random() * MAP_WIDTH,
    y: Math.random() * MAP_HEIGHT,
    color: `hsl(${Math.random() * 360}, 100%, 50%)`
  };
}

// FUNCIÓN: Crear Virus
// Sirve para: Generar un virus (obstáculo verde) en posición aleatoria.
function createVirus() {
  return {
    id: getCellId(),
    x: Math.random() * MAP_WIDTH,
    y: Math.random() * MAP_HEIGHT,
    radius: VIRUS_RADIUS,
    mass: VIRUS_MASS
  };
}

// Inicializamos el mapa con comida y virus al arrancar
for (let i = 0; i < MAX_FOOD; i++) food.push(createFood());
for (let i = 0; i < MAX_VIRUSES; i++) viruses.push(createVirus());

app.use(express.static('public')); // Servir archivos estáticos (frontend)

// ==========================================
// LÓGICA DE CONEXIÓN Y EVENTOS (SOCKET.IO)
// ==========================================

io.on('connection', (socket) => {
  // Verificación de servidor lleno
  if (Object.keys(players).length >= MAX_PLAYERS) {
    socket.emit('serverFull', 'Servidor lleno.');
    socket.disconnect(true);
    return;
  }

  console.log('🟢 Conectado:', socket.id);

  // Inicialización del Jugador: Crea el objeto base del jugador en memoria
  players[socket.id] = {
    id: socket.id,
    nickname: 'Guest',
    color: '#FFFFFF',
    skin: '',
    customSkin: null,
    playing: false,      // No juega hasta que pulse "Jugar"
    canRejoin: false,    // Controla si puede revivir en la misma ronda
    targetX: 0, targetY: 0, // Dirección del mouse
    cells: [],           // Sus células (círculos)
    startTime: 0,        // Para calcular tiempo de vida
    maxMass: 0,          // Estadística: Masa máxima
    cellsEaten: 0,       // Estadística: Células comidas
    bestRank: 999        // Estadística: Mejor posición
  };

  socket.emit('playerInfo', socket.id); // Enviar su ID al cliente

  // EVENTO: startGame
  // Sirve para: Manejar la entrada del jugador a la partida o al lobby.
  socket.on('startGame', (data) => {
    const name = data.nickname.trim().substring(0, 15);
    if (!name) return;
    const p = players[socket.id];
    if (!p) return;

    // Actualizar datos del jugador (Nombre, Skin, Color)
    p.nickname = name;
    p.color = data.color;
    p.skin = data.skin;
    p.customSkin = data.customSkin;

    // Lógica según el estado del juego:

    // 1. Si terminó la partida: Nadie entra.
    if (currentGameState === GAME_STATE.ENDED) {
      socket.emit('serverFull', 'La ronda terminó. Esperando reinicio...');
      return;
    }

    // 2. Si ya están jugando (PLAYING)
    if (currentGameState === GAME_STATE.PLAYING) {
      if (p.canRejoin) {
        // Si ya estaba en la partida, le dejamos revivir (Respawn)
        p.playing = true;
        p.startTime = Date.now();
        p.cellsEaten = 0;
        p.maxMass = 20;
        // Crear su primera célula
        p.cells = [{
          id: getCellId(),
          x: Math.random() * MAP_WIDTH,
          y: Math.random() * MAP_HEIGHT,
          radius: 20, mass: 20,
          speedX: 0, speedY: 0,
          mergeTime: 0
        }];
        socket.emit('gameStarted');
        return;
      } else {
        // Si es nuevo y llegó tarde
        socket.emit('serverFull', 'Partida en curso. Espera a la siguiente ronda.');
        return;
      }
    }

    // 3. Si estamos en LOBBY (WAITING)
    if (currentGameState === GAME_STATE.WAITING) {
      p.playing = false;
      p.isReady = true;

      // Añadir a lista de espera si no estaba
      if (!waitingPlayers.includes(socket.id)) {
        waitingPlayers.push(socket.id);
        if (isTimerRunning) {
          lobbyTimeLeft += EXTENSION_TIME; // Dar tiempo extra
          io.emit('timerExtended', EXTENSION_TIME);
        }
      }

      socket.emit('joinedLobby');
      manageLobbyTimer();    // Verificar si arranca el reloj
      broadcastLobbyUpdate(); // Actualizar interfaz de todos
    }
  });

  // EVENTO: input
  // Sirve para: Recibir coordenadas del mouse para mover al jugador.
  socket.on('input', (data) => {
    if (players[socket.id] && players[socket.id].playing) {
      players[socket.id].targetX = data.x;
      players[socket.id].targetY = data.y;
    }
  });

  // EVENTO: split (Barra Espaciadora)
  // Sirve para: Dividir las células del jugador en dos para lanzar un ataque.
  socket.on('split', () => {
    const p = players[socket.id];
    if (!p || !p.playing) return;
    let newCells = [];
    p.cells.forEach(cell => {
      // Solo divide si es suficientemente grande y no excede el límite
      if (cell.mass >= 35 && p.cells.length + newCells.length < MAX_CELLS) {
        const splitMass = cell.mass / 2;
        cell.mass = splitMass;
        cell.radius = cell.mass;
        // Calcular dirección del lanzamiento
        const dx = p.targetX - cell.x;
        const dy = p.targetY - cell.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        newCells.push({
          id: getCellId(),
          x: cell.x + (dx / dist) * cell.radius,
          y: cell.y + (dy / dist) * cell.radius,
          radius: splitMass, mass: splitMass,
          speedX: (dx / dist) * 25, // Impulso
          speedY: (dy / dist) * 25,
          mergeTime: Date.now() + MERGE_TIMER // Tiempo de espera para unirse
        });
        cell.mergeTime = Date.now() + MERGE_TIMER;
      }
    });
    p.cells = p.cells.concat(newCells);
  });

  // EVENTO: eject (Tecla W)
  // Sirve para: Disparar pequeña masa para alimentar virus o compañeros.
  socket.on('eject', () => {
    const p = players[socket.id];
    if (!p || !p.playing) return;
    p.cells.forEach(cell => {
      if (cell.mass >= 35) {
        cell.mass -= EJECT_MASS_LOSS; // El jugador pierde masa
        cell.radius = cell.mass;
        const dx = p.targetX - cell.x;
        const dy = p.targetY - cell.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        // Crear la bolita de masa eyectada
        ejectedMass.push({
          id: getCellId(),
          x: cell.x + (dx / dist) * cell.radius,
          y: cell.y + (dy / dist) * cell.radius,
          radius: EJECT_MASS_GAIN, mass: EJECT_MASS_GAIN,
          color: p.color,
          speedX: (dx / dist) * EJECT_SPEED,
          speedY: (dy / dist) * EJECT_SPEED,
          creationTime: Date.now()
        });
      }
    });
  });

  // EVENTO: disconnect
  // Sirve para: Limpiar datos cuando un jugador cierra la pestaña.
  socket.on('disconnect', () => {
    delete players[socket.id];
    const index = waitingPlayers.indexOf(socket.id);

    if (index !== -1) {
      waitingPlayers.splice(index, 1);
      // Si se va gente y quedamos por debajo del mínimo, cancelar inicio
      if (isTimerRunning && waitingPlayers.length < MIN_PLAYERS_TO_START) {
        console.log("🛑 Cancelando cuenta regresiva: Faltan jugadores.");
        clearInterval(lobbyTimer);
        isTimerRunning = false;
        lobbyTimer = null;
        lobbyTimeLeft = 0;
      }
      if (currentGameState === GAME_STATE.WAITING) {
        broadcastLobbyUpdate();
      }
    }
  });
});

// ==========================================
// FUNCIONES DE CONTROL DE JUEGO
// ==========================================

// FUNCIÓN: broadcastLobbyUpdate
// Sirve para: Avisar a todos en el lobby quién está conectado y cuánto falta.
function broadcastLobbyUpdate() {
  const namesList = waitingPlayers.map(id => {
    return players[id] ? players[id].nickname : 'Desconocido';
  });

  io.emit('lobbyUpdate', {
    count: waitingPlayers.length,
    required: MIN_PLAYERS_TO_START,
    names: namesList,
    timerActive: isTimerRunning,
    timeLeft: lobbyTimeLeft
  });
}

// FUNCIÓN: startGameRound
// Sirve para: Iniciar la partida real moviendo a los jugadores de "Espera" a "Jugando".
function startGameRound() {
  console.log('🚀 INICIANDO RONDA');
  currentGameState = GAME_STATE.PLAYING;

  waitingPlayers.forEach(socketId => {
    const p = players[socketId];
    if (p) {
      p.playing = true;
      p.canRejoin = true;
      p.startTime = Date.now();
      p.maxMass = 20;
      p.cellsEaten = 0;
      // Generar célula inicial
      p.cells = [{
        id: getCellId(),
        x: Math.random() * MAP_WIDTH,
        y: Math.random() * MAP_HEIGHT,
        radius: 20, mass: 20,
        speedX: 0, speedY: 0,
        mergeTime: 0
      }];
    }
  });
  io.emit('gameStarted');
}

// FUNCIÓN: resetServer
// Sirve para: Limpiar todo el mapa y variables para una nueva ronda.
function resetServer() {
  console.log('🔄 REINICIANDO SERVIDOR...');
  currentGameState = GAME_STATE.WAITING;
  waitingPlayers = [];

  // Limpieza de entidades
  food = []; ejectedMass = []; viruses = [];
  for (let i = 0; i < MAX_FOOD; i++) food.push(createFood());
  for (let i = 0; i < MAX_VIRUSES; i++) viruses.push(createVirus());

  // Resetear jugadores (sin desconectarlos)
  for (const id in players) {
    const p = players[id];
    if (!p.playing || currentGameState === GAME_STATE.ENDED) continue;
    p.playing = false;
    p.cells = [];
    p.nickname = 'Guest';
  }
  io.emit('serverReset');
}

// FUNCIÓN: manageLobbyTimer
// Sirve para: Controlar la cuenta regresiva antes de empezar la partida.
function manageLobbyTimer() {
  // Caso 1: Iniciar reloj si hay suficientes jugadores
  if (!isTimerRunning && waitingPlayers.length >= MIN_PLAYERS_TO_START) {
    console.log("⏳ Iniciando cuenta regresiva...");
    isTimerRunning = true;
    lobbyTimeLeft = INITIAL_WAIT_TIME;

    lobbyTimer = setInterval(() => {
      lobbyTimeLeft--;
      broadcastLobbyUpdate();

      if (lobbyTimeLeft <= 0) {
        clearInterval(lobbyTimer);
        isTimerRunning = false;
        lobbyTimer = null;
        startGameRound(); // ¡INICIAR JUEGO!
      }
    }, 1000);
  }
  // Caso 2: Extender tiempo si entra gente nueva
  else if (isTimerRunning && waitingPlayers.length > MIN_PLAYERS_TO_START) {
    lobbyTimeLeft += EXTENSION_TIME;
    if (lobbyTimeLeft > 60) lobbyTimeLeft = 60; // Tope máximo de espera
    broadcastLobbyUpdate();
  }
}

// ==========================================
// BUCLE PRINCIPAL DEL JUEGO (GAME LOOP)
// ==========================================
// Se ejecuta 60 veces por segundo para calcular física y colisiones.

setInterval(() => {
  const now = Date.now();

  // 1. FÍSICA DE MASA EYECTADA
  // Mueve las bolitas disparadas por el mapa
  for (let i = ejectedMass.length - 1; i >= 0; i--) {
    const em = ejectedMass[i];
    em.x += em.speedX; em.y += em.speedY;
    em.speedX *= 0.9; em.speedY *= 0.9; // Fricción
    // Eliminar si sale del mapa
    if (em.x < 0 || em.x > MAP_WIDTH || em.y < 0 || em.y > MAP_HEIGHT) {
      ejectedMass.splice(i, 1);

    }
  }

  // 2. CALCULAR LEADERBOARD
  const leaderboard = Object.values(players)
    .filter(p => p.playing)
    .map(p => ({
      id: p.id, name: p.nickname,
      score: Math.floor(p.cells.reduce((acc, c) => acc + c.mass, 0)),
      color: p.color
    }))
    .sort((a, b) => b.score - a.score);

  // 3. LÓGICA DE JUGADORES (Movimiento y Colisiones)
  for (const id in players) {
    const p = players[id];
    if (!p.playing) continue;

    // Actualizar estadística de masa máxima
    const currentTotalMass = Math.floor(p.cells.reduce((acc, c) => acc + c.mass, 0));
    if (currentTotalMass > p.maxMass) p.maxMass = currentTotalMass;

    // --- VERIFICAR CONDICIÓN DE VICTORIA ---
    if (currentGameState === GAME_STATE.PLAYING && currentTotalMass >= WINNING_SCORE) {
      currentGameState = GAME_STATE.ENDED;
      console.log(`🏆 GANADOR: ${p.nickname}`);

      // Crear tabla final incluyendo a vivos y muertos
      const finalLeaderboard = Object.values(players)
        .filter(player => player.playing || player.canRejoin)
        .map(player => ({
          id: player.id, name: player.nickname,
          score: Math.floor(player.cells.reduce((acc, c) => acc + c.mass, 0)),
          color: player.color
        }))
        .sort((a, b) => b.score - a.score);

      io.emit('roundWon', {
        winnerName: p.nickname,
        leaderboard: finalLeaderboard.slice(0, 10)
      });
      setTimeout(() => resetServer(), 10000); // Reiniciar en 10s
    }

    // Actualizar mejor ranking personal
    const myRank = leaderboard.findIndex(l => l.id === p.id) + 1;
    if (myRank > 0 && myRank < p.bestRank) p.bestRank = myRank;

    let virusExplosionCells = [];

    // PROCESAR CADA CÉLULA DEL JUGADOR
    p.cells.forEach(cell => {
      // Movimiento básico hacia el mouse
      const dx = p.targetX - cell.x;
      const dy = p.targetY - cell.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const speed = Math.max(BASE_SPEED - (cell.radius / 20), 2); // Más grande = más lento

      if (dist > 5) {
        const angle = Math.atan2(dy, dx);
        cell.x += Math.cos(angle) * speed;
        cell.y += Math.sin(angle) * speed;
      }
      // Sumar inercia (por explosiones o splits)
      cell.x += cell.speedX; cell.y += cell.speedY;
      cell.speedX *= 0.9; cell.speedY *= 0.9;

      // Colisión con bordes del mapa
      const wallForce = 0.8;
      if (cell.x < cell.radius) cell.speedX += wallForce;
      if (cell.x > MAP_WIDTH - cell.radius) cell.speedX -= wallForce;
      if (cell.y < cell.radius) cell.speedY += wallForce;
      if (cell.y > MAP_HEIGHT - cell.radius) cell.speedY -= wallForce;
      cell.x = Math.max(0, Math.min(MAP_WIDTH, cell.x));
      cell.y = Math.max(0, Math.min(MAP_HEIGHT, cell.y));

      // INTERACCIÓN: Comer Comida
      for (let i = food.length - 1; i >= 0; i--) {
        const f = food[i];
        if (Math.sqrt((cell.x - f.x) ** 2 + (cell.y - f.y) ** 2) < cell.radius) {
          cell.mass += 0.5;
          cell.radius = cell.mass;
          p.cellsEaten++;
          food.splice(i, 1);
        }
      }

      // INTERACCIÓN: Comer Masa Eyectada
      for (let i = ejectedMass.length - 1; i >= 0; i--) {
        const em = ejectedMass[i];
        if (Math.sqrt((cell.x - em.x) ** 2 + (cell.y - em.y) ** 2) < cell.radius) {
          cell.mass += em.mass;
          cell.radius = cell.mass;
          ejectedMass.splice(i, 1);
        }
      }

      // INTERACCIÓN: Chocar con Virus
      for (let vIndex = viruses.length - 1; vIndex >= 0; vIndex--) {
        const v = viruses[vIndex];
        const distV = Math.sqrt((cell.x - v.x) ** 2 + (cell.y - v.y) ** 2);
        if (distV < cell.radius + v.radius) {
          // Si soy más grande que el virus, exploto
          if (cell.mass >= VIRUS_MASS) {
            viruses.splice(vIndex, 1);
            viruses.push(createVirus()); // Reponer virus
            // Calcular explosión (división forzada)
            const maxSplits = MAX_CELLS - (p.cells.length + virusExplosionCells.length);
            if (maxSplits > 0) {
              const pieces = Math.min(maxSplits, 8);
              const massPerPiece = cell.mass / (pieces + 1);
              cell.mass = massPerPiece;
              cell.radius = massPerPiece;
              cell.mergeTime = Date.now() + MERGE_TIMER;
              for (let k = 0; k < pieces; k++) {
                const angle = (k / pieces) * Math.PI * 2;
                virusExplosionCells.push({
                  id: getCellId(),
                  x: cell.x, y: cell.y,
                  radius: massPerPiece, mass: massPerPiece,
                  speedX: Math.cos(angle) * 20,
                  speedY: Math.sin(angle) * 20,
                  mergeTime: Date.now() + MERGE_TIMER
                });
              }
            }
          }
        }
      }
    });
    
    p.cells = p.cells.concat(virusExplosionCells);

    // FÍSICA INTERNA (Choque entre mis propias células)
    for (let i = 0; i < p.cells.length; i++) {
      for (let j = i + 1; j < p.cells.length; j++) {
        const c1 = p.cells[i];
        const c2 = p.cells[j];
        const dx = c1.x - c2.x;
        const dy = c1.y - c2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = c1.radius + c2.radius;
        if (dist < minDist) {
          // Unirse si pasó el tiempo
          if (now > c1.mergeTime && now > c2.mergeTime) {
            c1.mass += c2.mass;
            c1.radius = c1.mass;
            c2.mass = 0; // Marcar para borrar
            continue;
          }
          // Empujarse si no se pueden unir
          const penetration = minDist - dist;
          if (penetration > 0 && dist > 0) {
            const nx = dx / dist;
            const ny = dy / dist;
            c1.x += nx * penetration * 0.5; c1.y += ny * penetration * 0.5;
            c2.x -= nx * penetration * 0.5; c2.y -= ny * penetration * 0.5;
          }
        }
      }
    }
    p.cells = p.cells.filter(c => c.mass > 0);
  }

  // Reponer comida y virus si faltan
  while (food.length < MAX_FOOD) food.push(createFood());
  while (viruses.length < MAX_VIRUSES) viruses.push(createVirus());

  // 4. LÓGICA PvP (JUGADOR VS JUGADOR)
  const allPlayers = Object.values(players).filter(p => p.playing);
  for (const pA of allPlayers) {
    for (const pB of allPlayers) {
      if (pA.id === pB.id) continue;
      for (const cA of pA.cells) {
        for (const cB of pB.cells) {
          const dist = Math.sqrt((cA.x - cB.x) ** 2 + (cA.y - cB.y) ** 2);
          // Regla: Debes ser 20% más grande para comer a otro
          if (dist < cA.radius && cA.radius > cB.radius * 1.2) {
            const massAtDeath = cB.mass;
            cA.mass += cB.mass;
            cA.radius = cA.mass;
            pA.cellsEaten++;

            // Matar célula de B
            cB.mass = 0;
            cB.radius = 0;

            // Verificar si B murió completamente
            const livingCells = pB.cells.filter(c => c.mass > 0).length;
            if (livingCells === 0) {
              const timeAlive = Date.now() - pB.startTime;
              const randomPhrase = DEATH_PHRASES[Math.floor(Math.random() * DEATH_PHRASES.length)];

              const deathData = {
                killerName: pA.nickname,
                killerSkin: pA.skin, killerCustomSkin: pA.customSkin,
                killerColor: pA.color, killerId: pA.id,
                message: randomPhrase,
                stats: {
                  finalMass: Math.floor(massAtDeath),
                  maxMass: pB.maxMass,
                  timeAlive: timeAlive,
                  cellsEaten: pB.cellsEaten,
                  bestRank: pB.bestRank
                }
              };
              io.to(pB.id).emit('gameOver', deathData);
              pB.playing = false;
            }
          }
        }
        pB.cells = pB.cells.filter(c => c.mass > 0);
      }
    }
  }

  // 5. VIEW CULLING (OPTIMIZACIÓN DE VISTA)
  // Prepara los datos comprimidos para enviar a cada cliente
  const reducedPlayers = {};
  for (let id in players) {
    const p = players[id];
    if (p.playing) {
      reducedPlayers[id] = {
        id: p.id, nickname: p.nickname, color: p.color,
        skin: p.skin, customSkin: p.customSkin,
        cells: p.cells.map(c => ({
          id: c.id, x: Math.round(c.x), y: Math.round(c.y), radius: Math.round(c.radius)
        }))
      };
    }
  }

  // Enviar a cada socket solo lo que puede ver (Culling)
  const connectedSockets = io.sockets.sockets;
  for (const [socketId, socket] of connectedSockets) {
    const p = players[socketId];
    let viewX = MAP_WIDTH / 2, viewY = MAP_HEIGHT / 2, viewDist = 1500;

    // Calcular centro de cámara del jugador
    if (p && p.playing && p.cells.length > 0) {
      let totalX = 0, totalY = 0, totalMass = 0;
      p.cells.forEach(c => { totalX += c.x; totalY += c.y; totalMass += c.mass; });
      viewX = totalX / p.cells.length;
      viewY = totalY / p.cells.length;
      viewDist += Math.sqrt(totalMass) * 2; // Aumentar visión al crecer
    }

    // Filtrar entidades visibles
    const visibleFood = food.filter(f =>
      Math.abs(f.x - viewX) < viewDist && Math.abs(f.y - viewY) < viewDist
    ).map(f => ({ x: Math.round(f.x), y: Math.round(f.y), color: f.color }));

    const visibleViruses = viruses.filter(v =>
      Math.abs(v.x - viewX) < viewDist && Math.abs(v.y - viewY) < viewDist
    ).map(v => ({ id: v.id, x: Math.round(v.x), y: Math.round(v.y), radius: Math.round(v.radius) }));

    const visibleEjected = ejectedMass.filter(em =>
      Math.abs(em.x - viewX) < viewDist && Math.abs(em.y - viewY) < viewDist
    ).map(em => ({ id: em.id, x: Math.round(em.x), y: Math.round(em.y), radius: Math.round(em.radius), color: em.color }));

    const visiblePlayers = {};
    for (let pid in reducedPlayers) {
      const rp = reducedPlayers[pid];
      if (rp.cells.some(c => Math.abs(c.x - viewX) < viewDist + 500 && Math.abs(c.y - viewY) < viewDist + 500)) {
        visiblePlayers[pid] = rp;
      }
    }

    // ENVIAR PAQUETE FINAL AL CLIENTE
    socket.emit('stateUpdate', {
      players: visiblePlayers,
      food: visibleFood,
      ejectedMass: visibleEjected,
      viruses: visibleViruses,
      leaderboard: leaderboard.slice(0, 10)
    });
  }

}, 1000 / TICK_RATE);

server.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
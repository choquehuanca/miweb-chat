const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const messagesFile = path.join(__dirname, 'messages.json');
const statsFile = path.join(__dirname, 'stats.json');
const usersFile = path.join(__dirname, 'users.json');
const privateMessagesFile = path.join(__dirname, 'private_messages.json');

// Estado del juego
let players = [];
let onlineUsers = {}; // socket.id -> userData
let activeGameType = 'tictactoe';
let board = Array(9).fill(null);
let xIsNext = true;
let gameActive = true;
let winnerInfo = null;

// Estado Minigolf
let golfState = { 
  ballX: 50, ballY: 200, holeX: 450, holeY: 200, 
  scores: { X: 0, O: 0, winner: null },
  obstacles: [{x: 200, y: 100, w: 20, h: 200}] 
};

// Cargar mensajes del archivo
let messages = [];
if (fs.existsSync(messagesFile)) {
  try {
    messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
  } catch (err) {
    console.error('Error al cargar mensajes:', err);
  }
}

// Cargar estadísticas
let stats = {};
if (fs.existsSync(statsFile)) {
  try {
    stats = JSON.parse(fs.readFileSync(statsFile, 'utf8'));
  } catch (err) { console.error('Error al cargar estadísticas:', err); }
}

// Cargar Usuarios Persistentes
let persistentUsers = {};
if (fs.existsSync(usersFile)) {
  try { persistentUsers = JSON.parse(fs.readFileSync(usersFile, 'utf8')); } catch (e) {}
}

// Cargar Mensajes Privados
let privateMessages = {};
if (fs.existsSync(privateMessagesFile)) {
  try { privateMessages = JSON.parse(fs.readFileSync(privateMessagesFile, 'utf8')); } catch (e) {}
}

const checkWinner = (b) => {
  const lines = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  for (let i = 0; i < lines.length; i++) {
    const [a, b1, c] = lines[i];
    if (b[a] && b[a] === b[b1] && b[a] === b[c]) return { winner: b[a], line: [a, b1, c] };
  }
  return b.includes(null) ? null : { winner: 'Draw', line: [] };
};

const saveStats = async () => {
  try {
    await fs.promises.writeFile(statsFile, JSON.stringify(stats, null, 2));
  } catch (err) { console.error('Error al guardar estadísticas:', err); }
};

const saveUsers = async () => {
  try { await fs.promises.writeFile(usersFile, JSON.stringify(persistentUsers, null, 2)); } catch (e) {}
};

const savePrivateMessages = async () => {
  try { await fs.promises.writeFile(privateMessagesFile, JSON.stringify(privateMessages, null, 2)); } catch (e) {}
};

// Salas de duelo (invitación → sala privada; persistencia en disco)
const roomsFile = path.join(__dirname, 'rooms.json');
let duelRooms = {};
if (fs.existsSync(roomsFile)) {
  try {
    duelRooms = JSON.parse(fs.readFileSync(roomsFile, 'utf8'));
    Object.values(duelRooms).forEach((r) => {
      if (!r.messages) r.messages = [];
      if (!r.golfState || !r.golfState.scores) {
        r.golfState = {
          ballX: 50,
          ballY: 200,
          holeX: 450,
          holeY: 200,
          scores: { X: 0, O: 0, winner: null },
          obstacles: [{ x: 200, y: 100, w: 20, h: 200 }]
        };
      }
    });
  } catch (e) {
    console.error('Error al cargar rooms.json:', e);
  }
}
const saveDuelRooms = async () => {
  try {
    await fs.promises.writeFile(roomsFile, JSON.stringify(duelRooms, null, 2));
  } catch (e) {
    console.error('Error al guardar rooms.json:', e);
  }
};

const socketDuelById = {}; // socket.id -> { code, username }

function generateRoomCode() {
  const chars = 'abcdefghijklmnopqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function newRoomState(code, host, gameType) {
  return {
    code,
    createdAt: Date.now(),
    host: { username: host.username, avatar: host.avatar || '🐱' },
    guest: null,
    activeGameType: gameType === 'minigolf' ? 'minigolf' : 'tictactoe',
    board: Array(9).fill(null),
    xIsNext: true,
    gameActive: true,
    winnerInfo: null,
    golfState: {
      ballX: 50,
      ballY: 200,
      holeX: 450,
      holeY: 200,
      scores: { X: 0, O: 0, winner: null },
      obstacles: [{ x: 200, y: 100, w: 20, h: 200 }]
    },
    messages: []
  };
}

function duelRoomPayload(r) {
  if (!r) return null;
  return {
    code: r.code,
    host: r.host,
    guest: r.guest,
    activeGameType: r.activeGameType,
    board: r.board,
    xIsNext: r.xIsNext,
    gameActive: r.gameActive,
    winnerInfo: r.winnerInfo,
    golfState: r.golfState,
    messages: (r.messages || []).slice(-150)
  };
}

function duelSymbolForUser(room, username) {
  if (room.host.username === username) return 'X';
  if (room.guest && room.guest.username === username) return 'O';
  return null;
}

function emitDuelRoomState(code) {
  const r = duelRooms[code];
  if (!r) return;
  io.to(code).emit('duel:state', duelRoomPayload(r));
}

app.use(express.static(__dirname)); // Servir archivos estáticos desde la raíz del proyecto

// Asegurar que al entrar a la raíz se cargue index.html
app.get('/', (req, res) => {
  const indexPath = path.join(__dirname, 'index.html');
  res.sendFile(indexPath, (err) => {
    if (err) {
      console.error('ERROR: No se pudo enviar index.html:', err.message);
      res.status(500).send('Error interno: El servidor no encuentra el archivo index.html');
    } else {
      console.log('Archivo index.html enviado correctamente');
    }
  });
});

app.get('/sala', (req, res) => {
  const c = (req.query.c || req.query.room || '').toString().trim();
  if (c) res.redirect(302, `/sala.html?c=${encodeURIComponent(c.toLowerCase())}`);
  else res.redirect(302, '/sala.html');
});

io.on('connection', (socket) => {
  console.log('Un usuario se conectó');

  socket.on('join game', (userData) => {
    const userId = userData.username;
    if (!persistentUsers[userId]) {
      persistentUsers[userId] = { username: userId, avatar: userData.avatar, friends: [] };
      saveUsers();
    }
    
    onlineUsers[socket.id] = { ...persistentUsers[userId], id: socket.id };
    io.emit('update user list', Object.values(onlineUsers));
    socket.emit('friends data', { friends: persistentUsers[userId].friends || [] });

    if (players.length < 2) {
      const symbol = players.length === 0 ? 'X' : 'O';
      players.push({ id: socket.id, username: userData.username, avatar: userData.avatar, symbol });
      socket.emit('player assigned', players[players.length - 1].symbol);
    }
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  socket.on('add friend', (friendName) => {
    const raw = String(friendName || '').trim();
    const currentUser = onlineUsers[socket.id];
    if (!currentUser || !raw || raw === currentUser.username) {
      socket.emit('friend add result', { ok: false, error: 'invalid' });
      return;
    }
    if (!persistentUsers[raw]) {
      socket.emit('friend add result', { ok: false, error: 'not_found', friendName: raw });
      return;
    }
    if (!persistentUsers[currentUser.username].friends.includes(raw)) {
      persistentUsers[currentUser.username].friends.push(raw);
      saveUsers();
    }
    socket.emit('friend add result', { ok: true, friendName: raw });
    socket.emit('friends data', { friends: persistentUsers[currentUser.username].friends || [] });
  });

  socket.on('private message', ({ to, message }) => {
    const from = onlineUsers[socket.id]?.username;
    if (!from) return;
    const chatId = [from, to].sort().join(':');
    if (!privateMessages[chatId]) privateMessages[chatId] = [];
    const msgData = { from, message, time: Date.now() };
    privateMessages[chatId].push(msgData);
    savePrivateMessages();
    
    // Enviar a ambos si están conectados
    const targetSocket = Object.values(onlineUsers).find(u => u.username === to);
    if (targetSocket) io.to(targetSocket.id).emit('private message', msgData);
    socket.emit('private message', msgData);
  });

  socket.on('get private history', (otherUser) => {
    const from = onlineUsers[socket.id]?.username;
    if (!from) return;
    const chatId = [from, otherUser].sort().join(':');
    socket.emit('load private history', privateMessages[chatId] || []);
  });

  // --- Salas privadas (sala.html): invitación, nombres persistentes en rooms.json ---
  socket.on('duel:create', (data, ack) => {
    const reply = (payload) => {
      if (typeof ack === 'function') ack(payload);
    };
    const hostUsername = (data && data.hostUsername && String(data.hostUsername).trim()) || '';
    if (!hostUsername) return reply({ ok: false, error: 'no_host' });
    let code = generateRoomCode();
    while (duelRooms[code]) code = generateRoomCode();
    const host = { username: hostUsername, avatar: (data && data.hostAvatar) || '🐱' };
    const gameType = data && data.gameType === 'minigolf' ? 'minigolf' : 'tictactoe';
    duelRooms[code] = newRoomState(code, host, gameType);
    saveDuelRooms();
    if (data && data.inviteeSocketId) {
      io.to(data.inviteeSocketId).emit('duel:invite', {
        code,
        hostUsername: host.username,
        hostAvatar: host.avatar,
        gameType: duelRooms[code].activeGameType
      });
    }
    reply({ ok: true, code });
  });

  socket.on('duel:join', (data, ack) => {
    const reply = (payload) => {
      if (typeof ack === 'function') ack(payload);
    };
    const rawCode = (data && data.code && String(data.code).trim().toLowerCase()) || '';
    const username = (data && data.username && String(data.username).trim()) || '';
    const avatar = (data && data.avatar) || '🐱';
    if (!rawCode || !username) return reply({ ok: false, error: 'bad_request' });
    const room = duelRooms[rawCode];
    if (!room) return reply({ ok: false, error: 'no_room' });

    if (room.host.username === username) {
      room.host.avatar = avatar;
    } else if (!room.guest) {
      room.guest = { username, avatar };
    } else if (room.guest.username !== username) {
      return reply({ ok: false, error: 'room_full' });
    } else {
      room.guest.avatar = avatar;
    }

    socket.join(rawCode);
    socketDuelById[socket.id] = { code: rawCode, username };
    saveDuelRooms();
    emitDuelRoomState(rawCode);
    const role = room.host.username === username ? 'host' : 'guest';
    reply({ ok: true, role, state: duelRoomPayload(room) });
  });

  socket.on('duel:chat', (payload) => {
    const meta = socketDuelById[socket.id];
    if (!meta || !payload || !payload.text) return;
    const room = duelRooms[meta.code];
    if (!room) return;
    const text = String(payload.text).trim().slice(0, 2000);
    if (!text) return;
    if (!room.messages) room.messages = [];
    room.messages.push({ from: meta.username, text, time: Date.now() });
    if (room.messages.length > 300) room.messages.splice(0, room.messages.length - 300);
    saveDuelRooms();
    emitDuelRoomState(meta.code);
  });

  socket.on('duel:change_game', (type) => {
    const meta = socketDuelById[socket.id];
    if (!meta) return;
    const room = duelRooms[meta.code];
    if (!room || room.host.username !== meta.username) return;
    room.activeGameType = type === 'minigolf' ? 'minigolf' : 'tictactoe';
    saveDuelRooms();
    emitDuelRoomState(meta.code);
  });

  socket.on('duel:move', (index) => {
    const meta = socketDuelById[socket.id];
    if (!meta) return;
    const room = duelRooms[meta.code];
    if (!room || !room.gameActive || room.activeGameType !== 'tictactoe') return;
    const sym = duelSymbolForUser(room, meta.username);
    if (!sym) return;
    const isTurn = (sym === 'X' && room.xIsNext) || (sym === 'O' && !room.xIsNext);
    if (!isTurn || room.board[index]) return;
    room.board[index] = sym;
    room.xIsNext = !room.xIsNext;
    room.winnerInfo = checkWinner(room.board);
    if (room.winnerInfo) {
      room.gameActive = false;
      if (room.winnerInfo.winner !== 'Draw') {
        const winnerName =
          room.winnerInfo.winner === 'X' ? room.host.username : room.guest && room.guest.username;
        if (winnerName) {
          stats[winnerName] = (stats[winnerName] || 0) + 1;
          saveStats();
        }
      }
    }
    saveDuelRooms();
    emitDuelRoomState(meta.code);
  });

  socket.on('duel:golf_move', (data) => {
    const meta = socketDuelById[socket.id];
    if (!meta || !data) return;
    const room = duelRooms[meta.code];
    if (!room || room.activeGameType !== 'minigolf') return;
    const sym = duelSymbolForUser(room, meta.username);
    if (!sym || !room.guest || room.golfState.scores.winner) return;
    const isTurn = (sym === 'X' && room.xIsNext) || (sym === 'O' && !room.xIsNext);
    if (!isTurn) return;
    room.golfState.ballX = data.ballX;
    room.golfState.ballY = data.ballY;
    room.xIsNext = !room.xIsNext;
    const dist = Math.hypot(room.golfState.ballX - room.golfState.holeX, room.golfState.ballY - room.golfState.holeY);
    if (dist < 20) {
      room.golfState.scores[sym]++;
      room.golfState.ballX = 50;
      room.golfState.ballY = 200;
      if (room.golfState.scores[sym] >= 5) {
        room.golfState.scores.winner = meta.username;
      }
    }
    saveDuelRooms();
    emitDuelRoomState(meta.code);
  });

  socket.on('duel:reset', () => {
    const meta = socketDuelById[socket.id];
    if (!meta) return;
    const room = duelRooms[meta.code];
    if (!room) return;
    room.board = Array(9).fill(null);
    room.golfState = {
      ballX: 50,
      ballY: 200,
      holeX: 450,
      holeY: 200,
      scores: { X: 0, O: 0, winner: null },
      obstacles: [{ x: 200, y: 100, w: 20, h: 200 }]
    };
    room.xIsNext = true;
    room.gameActive = true;
    room.winnerInfo = null;
    saveDuelRooms();
    emitDuelRoomState(meta.code);
  });

  socket.on('duel:sticker', (emoji) => {
    const meta = socketDuelById[socket.id];
    if (!meta || !emoji) return;
    io.to(meta.code).emit('duel:sticker', { emoji, from: meta.username });
  });

  // Gestión de Invitaciones y Menú
  socket.on('change game', (type) => {
    activeGameType = type;
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  socket.on('invite player', ({ toId, gameType }) => {
    io.to(toId).emit('receive invite', { from: onlineUsers[socket.id], gameType });
  });

  socket.on('accept invite', ({ hostId, gameType }) => {
    activeGameType = gameType;
    // Resetear jugadores para la nueva partida
    players = [onlineUsers[hostId], onlineUsers[socket.id]].map((u, i) => ({ ...u, symbol: i === 0 ? 'X' : 'O' }));
    io.to(hostId).emit('player assigned', 'X');
    socket.emit('player assigned', 'O');
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  // Lógica Minigolf
  socket.on('golf move', (data) => {
    const player = players.find(p => p.id === socket.id);
    const isTurn = (player?.symbol === 'X' && xIsNext) || (player?.symbol === 'O' && !xIsNext);
    if (!player || !isTurn || golfState.scores.winner) return;

    golfState.ballX = data.ballX;
    golfState.ballY = data.ballY;
    xIsNext = !xIsNext; // Cambiar turno

    // Detectar si entró al hoyo (distancia pequeña)
    const dist = Math.hypot(golfState.ballX - golfState.holeX, golfState.ballY - golfState.holeY);
    if (dist < 20) {
      golfState.scores[player.symbol]++;
      golfState.ballX = 50; golfState.ballY = 200; // Reset posición bola
      if (golfState.scores[player.symbol] >= 5) {
        golfState.scores.winner = player.username;
      }
    }
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  socket.on('make move', (index) => {
    if (!gameActive) return;
    const player = players.find(p => p.id === socket.id);
    if (!player) return;
    
    const isPlayerTurn = (player.symbol === 'X' && xIsNext) || (player.symbol === 'O' && !xIsNext);
    
    if (isPlayerTurn && !board[index]) {
      board[index] = player.symbol;
      xIsNext = !xIsNext;
      
      winnerInfo = checkWinner(board);
      if (winnerInfo) {
        gameActive = false;
        if (winnerInfo.winner !== 'Draw') {
          const winnerPlayer = players.find(p => p.symbol === winnerInfo.winner);
          const loserPlayer = players.find(p => p.symbol !== winnerInfo.winner);
          if (winnerPlayer) {
            stats[winnerPlayer.username] = (stats[winnerPlayer.username] || 0) + 1;
            saveStats();
          }
        }
      }
      io.emit('game update', { board, xIsNext, players, winnerInfo, stats });
    }
  });

  socket.on('reset game', () => {
    board = Array(9).fill(null);
    golfState = { ballX: 50, ballY: 200, holeX: 450, holeY: 200, scores: { X: 0, O: 0, winner: null }, obstacles: [{x: 200, y: 100, w: 20, h: 200}] };
    xIsNext = true;
    gameActive = true;
    winnerInfo = null;
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  socket.on('send sticker', (emoji) => {
    const player = players.find(p => p.id === socket.id);
    socket.broadcast.emit('show sticker', { emoji, from: player?.username });
  });

  socket.on('disconnect', () => {
    console.log('Un usuario se desconectó');
    if (socketDuelById[socket.id]) {
      const d = socketDuelById[socket.id];
      delete socketDuelById[socket.id];
      io.to(d.code).emit('duel:peer_left', { username: d.username });
    }
    delete onlineUsers[socket.id];
    players = players.filter(p => p.id !== socket.id);
    io.emit('update user list', Object.values(onlineUsers));
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  // Enviar mensajes históricos al nuevo usuario
  socket.emit('load messages', messages);

  socket.on('chat message', async (data) => {
    messages.push(data); // Agregar al array
    try {
      // Guardar al archivo de forma asíncrona para no bloquear el servidor
      await fs.promises.writeFile(messagesFile, JSON.stringify(messages, null, 2));
      io.emit('chat message', data); // Enviar a todos los conectados
    } catch (err) {
      console.error('Error al guardar el mensaje:', err);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT} y http://0.0.0.0:${PORT}`);
});
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
  scores: { X: 0, O: 0 },
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
    
    if (players.length < 2) {
      const symbol = players.length === 0 ? 'X' : 'O';
      players.push({ id: socket.id, username: userData.username, avatar: userData.avatar, symbol });
      socket.emit('player assigned', players[players.length - 1].symbol);
    }
    io.emit('game update', { board, xIsNext, players, winnerInfo, stats, activeGameType, golfState });
  });

  socket.on('add friend', (friendName) => {
    const currentUser = onlineUsers[socket.id];
    if (currentUser && persistentUsers[friendName] && friendName !== currentUser.username) {
      if (!persistentUsers[currentUser.username].friends.includes(friendName)) {
        persistentUsers[currentUser.username].friends.push(friendName);
        saveUsers();
        socket.emit('update user list', Object.values(onlineUsers));
      }
    }
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
    if (!player) return;
    golfState = { ...golfState, ...data };
    golfState.strokes[player.symbol]++;
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
    golfState = { ballX: 50, ballY: 250, holeX: 450, holeY: 250, strokes: { X: 0, O: 0 } };
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
    delete onlineUsers[socket.id];
    players = players.filter(p => p.id !== socket.id);
    io.emit('update user list', Object.values(onlineUsers));
    io.emit('game update', { board, xIsNext, players });
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
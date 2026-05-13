const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const messagesFile = path.join(__dirname, 'messages.json');

// Estado del juego
let players = [];
let board = Array(9).fill(null);
let xIsNext = true;

// Cargar mensajes del archivo
let messages = [];
if (fs.existsSync(messagesFile)) {
  try {
    messages = JSON.parse(fs.readFileSync(messagesFile, 'utf8'));
  } catch (err) {
    console.error('Error al cargar mensajes:', err);
  }
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

io.on('connection', (socket) => {
  console.log('Un usuario se conectó');

  // Lógica del Juego
  socket.on('join game', (username) => {
    if (players.length < 2) {
      players.push({ id: socket.id, username, symbol: players.length === 0 ? 'X' : 'O' });
      socket.emit('player assigned', players[players.length - 1].symbol);
    }
    io.emit('game update', { board, xIsNext, players });
  });

  socket.on('make move', (index) => {
    const player = players.find(p => p.id === socket.id);
    if (!player) return;
    
    const isPlayerTurn = (player.symbol === 'X' && xIsNext) || (player.symbol === 'O' && !xIsNext);
    
    if (isPlayerTurn && !board[index]) {
      board[index] = player.symbol;
      xIsNext = !xIsNext;
      io.emit('game update', { board, xIsNext, players });
    }
  });

  socket.on('reset game', () => {
    board = Array(9).fill(null);
    xIsNext = true;
    io.emit('game update', { board, xIsNext, players });
  });

  socket.on('disconnect', () => {
    console.log('Un usuario se desconectó');
    players = players.filter(p => p.id !== socket.id);
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
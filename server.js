const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const fs = require('fs');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

const messagesFile = path.join(__dirname, 'messages.json');

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
  res.sendFile(path.join(__dirname, 'index.html'));
});

io.on('connection', (socket) => {
  console.log('Un usuario se conectó');

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

  socket.on('disconnect', () => {
    console.log('Un usuario se desconectó');
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Servidor corriendo en http://localhost:${PORT} y http://0.0.0.0:${PORT}`);
});
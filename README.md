# Chat Global como WhatsApp

Esta es una aplicación de chat en tiempo real donde todos los usuarios conectados pueden comentar globalmente.

## Requisitos
- Node.js instalado (descárgalo de https://nodejs.org/)

## Instalación y Ejecución
1. Instala Node.js si no lo tienes.
2. Abre una terminal en la carpeta del proyecto (`c:\Users\lenos\OneDrive\Escritorio\miweb`).
3. Ejecuta `npm install` para instalar las dependencias.
4. Ejecuta `npm start` para iniciar el servidor.
5. Abre `http://localhost:3000/chat.html` en varios navegadores para probar el chat global.

## Funcionalidades
- Ingresa tu nombre en el campo superior.
- Escribe mensajes y envíalos.
- Todos los mensajes se comparten en tiempo real con todos los usuarios conectados.

## Archivos
- `chat.html`: La interfaz del chat.
- `server.js`: El servidor backend con Socket.io.
- `package.json`: Configuración del proyecto.
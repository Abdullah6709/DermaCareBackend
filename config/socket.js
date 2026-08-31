const { Server } = require('socket.io');

let io = null;

function initSocket(server) {
  io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE']
    }
  });

  io.on('connection', (socket) => {
    console.log(`⚡ [Socket.io] Client connected: ${socket.id}`);

    // Join room for teleconsultation or user notifications
    socket.on('join_room', (roomId) => {
      socket.join(roomId);
      console.log(`📌 [Socket.io] Socket ${socket.id} joined room: ${roomId}`);
      io.to(roomId).emit('user_joined_room', { socketId: socket.id, timestamp: new Date().toISOString() });
    });

    // Send teleconsultation live chat message
    socket.on('send_message', (data) => {
      const { roomId, senderName, senderRole, message, timestamp } = data;
      console.log(`💬 [Socket.io Room ${roomId}] ${senderName}: ${message}`);
      io.to(roomId).emit('receive_message', {
        id: `msg-${Date.now()}`,
        senderName,
        senderRole,
        message,
        timestamp: timestamp || new Date().toISOString()
      });
    });

    // Toggle camera/mic signal for room WebRTC state sync
    socket.on('signal_media_state', (data) => {
      const { roomId, videoEnabled, audioEnabled } = data;
      socket.to(roomId).emit('partner_media_state', { videoEnabled, audioEnabled });
    });

    socket.on('disconnect', () => {
      console.log(`❌ [Socket.io] Client disconnected: ${socket.id}`);
    });
  });

  return io;
}

function getIO() {
  return io;
}

// Helper to broadcast event to all clients or specific room
function broadcastEvent(eventName, payload, roomId = null) {
  if (!io) return;
  if (roomId) {
    io.to(roomId).emit(eventName, payload);
  } else {
    io.emit(eventName, payload);
  }
}

module.exports = {
  initSocket,
  getIO,
  broadcastEvent
};

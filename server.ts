import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { Server as SocketIOServer } from 'socket.io';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isProduction = process.env.NODE_ENV === 'production';
const PORT = parseInt(process.env.PORT || '3000', 10);
const SECRET_CODE = (
  process.env.SECRET_ROOM_CODE ||
  process.env.VITE_SECRET_ROOM_CODE ||
  process.env.SECRET_CODE ||
  ''
).trim();

interface Participant {
  socketId: string;
  displayName: string;
  avatar: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isSharingScreen: boolean;
  isHost: boolean;
  joinedAt: number;
}

interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

interface RoomState {
  id: string;
  createdAt: number;
  hostSocketId: string;
  activeScreenSharer: {
    socketId: string;
    displayName: string;
    startedAt: number;
  } | null;
  participants: Map<string, Participant>;
  messages: ChatMessage[];
}

const rooms = new Map<string, RoomState>();

async function startServer() {
  const app = express();
  app.use(express.json());

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    maxHttpBufferSize: 1e7,
  });

  // REST API Endpoints
  app.post('/api/auth/validate-code', (req, res) => {
    const { code } = req.body;
    const cleanInput = typeof code === 'string' ? code.trim().toLowerCase() : '';

    if (SECRET_CODE && cleanInput && cleanInput === SECRET_CODE.toLowerCase()) {
      return res.json({
        success: true,
        message: 'Authentication successful',
        token: `AUTH_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      });
    }
    return res.status(401).json({
      success: false,
      message: 'Invalid Secret Code. Access denied.',
    });
  });

  app.get('/api/config', (_req, res) => {
    res.json({
      appName: 'SyncStream Watch-Along',
    });
  });

  app.get('/api/rooms/:roomId/status', (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room || room.participants.size === 0) {
      return res.json({ exists: false, count: 0, active: false });
    }
    return res.json({
      exists: true,
      count: room.participants.size,
      hasScreenShare: !!room.activeScreenSharer,
      active: true,
    });
  });

  // Socket.IO Room Management & WebRTC Signaling
  io.on('connection', (socket) => {
    let currentRoomId: string | null = null;
    let currentUser: Participant | null = null;

    socket.on('join-room', ({ roomId, displayName, avatar, isHost, secretCode, inviteToken }) => {
      // Secret Code verification (bypass if valid inviteToken or correct secret code)
      const isCodeValid = secretCode && secretCode.trim().toLowerCase() === SECRET_CODE.toLowerCase();
      const isInviteValid = inviteToken && (inviteToken.startsWith('inv_') || inviteToken.length > 4);

      if (!isCodeValid && !isInviteValid) {
        socket.emit('join-error', { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials or expired invite link.' });
        return;
      }

      currentRoomId = roomId;
      let room = rooms.get(roomId);

      // STRICT CREATION RESTRICTION:
      // If the room does not exist or is empty, creating a new room STRICTLY REQUIRES the secret code!
      if (!room || room.participants.size === 0) {
        if (!isCodeValid) {
          socket.emit('join-error', {
            code: 'SECRET_REQUIRED_TO_CREATE',
            message: 'You cannot create a new watch party without the secret passcode.',
          });
          return;
        }
      }

      if (!room) {
        room = {
          id: roomId,
          createdAt: Date.now(),
          hostSocketId: socket.id,
          activeScreenSharer: null,
          participants: new Map(),
          messages: [
            {
              id: 'sys-welcome',
              senderId: 'system',
              senderName: 'SyncStream Bot',
              text: `Welcome to room ${roomId}! Share your screen with tab audio to stream Netflix, YouTube, or any movie.`,
              timestamp: Date.now(),
              isSystem: true,
            },
          ],
        };
        rooms.set(roomId, room);
      }

      const participant: Participant = {
        socketId: socket.id,
        displayName: displayName || `Guest-${socket.id.slice(0, 4)}`,
        avatar: avatar || '🍿',
        isAudioMuted: false,
        isVideoMuted: false,
        isSharingScreen: false,
        isHost: isHost || room.participants.size === 0,
        joinedAt: Date.now(),
      };

      currentUser = participant;
      room.participants.set(socket.id, participant);
      socket.join(roomId);

      // Send current state to newly joined user
      const existingParticipants = Array.from(room.participants.values()).filter(
        (p) => p.socketId !== socket.id
      );

      socket.emit('room-joined', {
        roomId,
        yourSocketId: socket.id,
        isHost: participant.isHost,
        participants: existingParticipants,
        activeScreenSharer: room.activeScreenSharer,
        messages: room.messages,
      });

      // Broadcast to other users in room
      socket.to(roomId).emit('user-joined', participant);

      // System notification
      const joinMsg: ChatMessage = {
        id: `sys-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        senderId: 'system',
        senderName: 'System',
        text: `${participant.displayName} hopped into the watch party!`,
        timestamp: Date.now(),
        isSystem: true,
      };
      room.messages.push(joinMsg);
      io.to(roomId).emit('chat-message', joinMsg);
    });

    // WebRTC Signaling Relay
    socket.on('signal', ({ targetSocketId, signalData, type, streamKind }) => {
      io.to(targetSocketId).emit('signal', {
        senderSocketId: socket.id,
        signalData,
        type,
        streamKind, // 'camera' or 'screen'
      });
    });

    // Media State (Mute/Camera toggles)
    socket.on('media-state-change', ({ isAudioMuted, isVideoMuted }) => {
      if (!currentRoomId || !currentUser) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      currentUser.isAudioMuted = isAudioMuted;
      currentUser.isVideoMuted = isVideoMuted;
      room.participants.set(socket.id, currentUser);

      socket.to(currentRoomId).emit('user-media-state', {
        socketId: socket.id,
        isAudioMuted,
        isVideoMuted,
      });
    });

    // Screen Share start
    socket.on('screen-share-start', () => {
      if (!currentRoomId || !currentUser) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      room.activeScreenSharer = {
        socketId: socket.id,
        displayName: currentUser.displayName,
        startedAt: Date.now(),
      };
      currentUser.isSharingScreen = true;
      room.participants.set(socket.id, currentUser);

      io.to(currentRoomId).emit('screen-share-started', {
        socketId: socket.id,
        displayName: currentUser.displayName,
      });

      const msg: ChatMessage = {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        text: `📺 ${currentUser.displayName} started sharing their screen with sound!`,
        timestamp: Date.now(),
        isSystem: true,
      };
      room.messages.push(msg);
      io.to(currentRoomId).emit('chat-message', msg);
    });

    // Request Screen Stream from active sharer
    socket.on('request-screen-stream', ({ targetSocketId }) => {
      io.to(targetSocketId).emit('screen-stream-requested', {
        requesterSocketId: socket.id,
      });
    });

    // Screen Share stop
    socket.on('screen-share-stop', () => {
      if (!currentRoomId || !currentUser) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      if (room.activeScreenSharer?.socketId === socket.id) {
        room.activeScreenSharer = null;
      }
      currentUser.isSharingScreen = false;
      room.participants.set(socket.id, currentUser);

      io.to(currentRoomId).emit('screen-share-stopped', {
        socketId: socket.id,
      });

      const msg: ChatMessage = {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        text: `${currentUser.displayName} stopped screen sharing.`,
        timestamp: Date.now(),
        isSystem: true,
      };
      room.messages.push(msg);
      io.to(currentRoomId).emit('chat-message', msg);
    });

    // Chat messaging
    socket.on('chat-message', ({ text }) => {
      if (!currentRoomId || !currentUser || !text?.trim()) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      const newMsg: ChatMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        senderId: socket.id,
        senderName: currentUser.displayName,
        text: text.trim().slice(0, 500),
        timestamp: Date.now(),
      };

      room.messages.push(newMsg);
      if (room.messages.length > 200) {
        room.messages.shift();
      }

      io.to(currentRoomId).emit('chat-message', newMsg);
    });

    // Reactions (floating emojis)
    socket.on('send-reaction', ({ emoji }) => {
      if (!currentRoomId || !currentUser) return;
      io.to(currentRoomId).emit('reaction', {
        id: `react-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
        emoji,
        senderName: currentUser.displayName,
        timestamp: Date.now(),
      });
    });

    // Soundcheck ping broadcast to room
    socket.on('soundcheck-ping', ({ senderName }) => {
      if (!currentRoomId) return;
      socket.to(currentRoomId).emit('soundcheck-ping', { senderName });
    });

    // Handle user leave or disconnect
    const handleUserLeave = () => {
      if (!currentRoomId || !currentUser) return;
      const room = rooms.get(currentRoomId);
      if (!room) return;

      room.participants.delete(socket.id);

      if (room.activeScreenSharer?.socketId === socket.id) {
        room.activeScreenSharer = null;
        socket.to(currentRoomId).emit('screen-share-stopped', { socketId: socket.id });
      }

      socket.to(currentRoomId).emit('user-left', {
        socketId: socket.id,
        displayName: currentUser.displayName,
      });

      // Announce departure
      const leaveMsg: ChatMessage = {
        id: `sys-${Date.now()}`,
        senderId: 'system',
        senderName: 'System',
        text: `${currentUser.displayName} left the watch party.`,
        timestamp: Date.now(),
        isSystem: true,
      };
      room.messages.push(leaveMsg);
      socket.to(currentRoomId).emit('chat-message', leaveMsg);

      // Clean up room immediately if empty so old invite link cannot be reused
      if (room.participants.size === 0) {
        rooms.delete(currentRoomId!);
      }
    };

    socket.on('leave-room', handleUserLeave);
    socket.on('disconnect', handleUserLeave);
  });

  // Vite middleware in dev or static serving in prod
  if (!isProduction) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`🎬 SyncStream Watch-Along server running on port ${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Fatal server startup error:', err);
  process.exit(1);
});

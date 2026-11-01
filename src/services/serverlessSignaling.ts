/**
 * Serverless Signaling Engine for 100% GitHub Pages Deployment
 * 
 * Replaces the need for a dedicated Node.js signaling server by using public,
 * encrypted WebSockets (WSS) over MQTT. Media (screen share, audio, video)
 * continues to flow 100% Peer-to-Peer directly via WebRTC at full resolution.
 */
import mqtt, { MqttClient } from 'mqtt';
import { validateSecretCode } from '../config';

const PUBLIC_BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];

export interface SignalingSocket {
  id: string;
  emit(event: string, data?: any): void;
  on(event: string, callback: (...args: any[]) => void): void;
  off(event: string, callback?: (...args: any[]) => void): void;
  disconnect(): void;
  connect(): void;
}

type EventCallback = (...args: any[]) => void;

export class ServerlessSignalingSocket implements SignalingSocket {
  public id: string;
  private client: MqttClient | null = null;
  private listeners: Map<string, Set<EventCallback>> = new Map();
  private roomId: string | null = null;
  private currentUser: any = null;
  private peers: Map<string, any> = new Map();
  private peerLastSeen: Map<string, number> = new Map();
  private activeScreenSharer: any = null;
  private isConnected: boolean = false;
  private brokerIndex: number = 0;
  private hasJoinedRoom: boolean = false;
  private heartbeatInterval: number | null = null;
  private staleCheckInterval: number | null = null;
  private unloadHandler: (() => void) | null = null;
  private pendingJoinCallback: (() => void) | null = null;
  private lastSoundcheckTime: number = 0;

  constructor() {
    this.id = `peer_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36).slice(-4)}`;
    this.setupUnloadHandler();
  }

  private setupUnloadHandler() {
    this.unloadHandler = () => {
      this.broadcastLeave();
    };
    if (typeof window !== 'undefined') {
      window.addEventListener('beforeunload', this.unloadHandler);
      window.addEventListener('pagehide', this.unloadHandler);
    }
  }

  public on(event: string, callback: EventCallback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(callback);
  }

  public off(event: string, callback?: EventCallback) {
    if (!callback) {
      this.listeners.delete(event);
    } else {
      this.listeners.get(event)?.delete(callback);
    }
  }

  private trigger(event: string, ...args: any[]) {
    const handlers = this.listeners.get(event);
    if (handlers) {
      handlers.forEach((fn) => {
        try {
          fn(...args);
        } catch (e) {
          console.error(`Error in event handler '${event}':`, e);
        }
      });
    }
  }

  public connect() {
    if (this.client) return;

    const brokerUrl = PUBLIC_BROKERS[this.brokerIndex % PUBLIC_BROKERS.length];
    console.log(`[P2P Signaling] Connecting to broker: ${brokerUrl}`);

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId: `sync_${this.id}`,
        clean: true,
        connectTimeout: 6000,
        keepalive: 30,
        reconnectPeriod: 2500,
        will: this.roomId
          ? {
              topic: `syncstream/v2/${this.roomId}/all`,
              payload: JSON.stringify({
                type: 'user-left',
                senderSocketId: this.id,
                socketId: this.id,
                displayName: this.currentUser?.displayName || 'Friend',
              }),
              qos: 0,
              retain: false,
            }
          : undefined,
      });

      this.client.on('connect', () => {
        console.log(`[P2P Signaling] Connected to broker with ID: ${this.id}`);
        this.isConnected = true;
        this.trigger('connect');

        if (this.roomId) {
          this.subscribeToRoom(this.roomId);
        }
      });

      this.client.on('message', (topic, payload) => {
        try {
          const msg = JSON.parse(payload.toString());
          this.handleIncomingMessage(topic, msg);
        } catch (err) {
          console.warn('[P2P Signaling] Failed to parse message:', err);
        }
      });

      this.client.on('error', (err) => {
        console.warn(`[P2P Signaling] Broker error on ${brokerUrl}:`, err.message);
        this.brokerIndex++;
      });

      this.client.on('close', () => {
        this.isConnected = false;
        this.trigger('disconnect', 'transport close');
      });
    } catch (err) {
      console.error('[P2P Signaling] Setup exception:', err);
    }
  }

  private subscribeToRoom(roomId: string) {
    if (!this.client || !this.isConnected) return;

    const broadcastTopic = `syncstream/v2/${roomId}/all`;
    const directTopic = `syncstream/v2/${roomId}/peer/${this.id}`;

    this.client.subscribe([broadcastTopic, directTopic], { qos: 0 }, (err) => {
      if (err) {
        console.error('[P2P Signaling] Subscription error:', err);
      } else {
        console.log(`[P2P Signaling] Subscribed to room ${roomId}`);
      }
    });

    this.startHeartbeat(roomId);
  }

  private startHeartbeat(roomId: string) {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.staleCheckInterval) clearInterval(this.staleCheckInterval);

    // Ping every 5 seconds to keep room presence alive
    this.heartbeatInterval = window.setInterval(() => {
      if (this.isConnected && this.hasJoinedRoom) {
        this.publish(`syncstream/v2/${roomId}/all`, {
          type: 'presence-ping',
          senderSocketId: this.id,
          peer: this.currentUser,
        });
      }
    }, 5000);

    // Check for stale peers every 5 seconds
    this.staleCheckInterval = window.setInterval(() => {
      const now = Date.now();
      this.peers.forEach((peer, peerId) => {
        const lastSeen = this.peerLastSeen.get(peerId) || 0;
        // If no heartbeat for > 15 seconds, participant has disconnected
        if (now - lastSeen > 15000) {
          console.log(`[P2P Signaling] Peer ${peerId} timed out. Removing from party.`);
          this.peers.delete(peerId);
          this.peerLastSeen.delete(peerId);
          if (this.activeScreenSharer?.socketId === peerId) {
            this.activeScreenSharer = null;
          }
          this.trigger('user-left', {
            socketId: peerId,
            displayName: peer.displayName || 'Friend',
          });
        }
      });
    }, 5000);
  }

  private publish(topic: string, data: any) {
    if (!this.client || !this.isConnected) {
      setTimeout(() => this.publish(topic, data), 200);
      return;
    }
    try {
      this.client.publish(topic, JSON.stringify(data), { qos: 0 });
    } catch (e) {
      console.warn('[P2P Signaling] Publish error:', e);
    }
  }

  private handleIncomingMessage(_topic: string, msg: any) {
    // Ignore messages sent by ourselves
    if (msg.senderSocketId === this.id || msg.senderId === this.id) {
      return;
    }

    // Record last seen for presence
    if (msg.senderSocketId) {
      this.peerLastSeen.set(msg.senderSocketId, Date.now());
    }

    switch (msg.type) {
      case 'presence-ping': {
        const peer = msg.peer;
        if (peer && peer.socketId && peer.socketId !== this.id) {
          this.peerLastSeen.set(peer.socketId, Date.now());
          if (!this.peers.has(peer.socketId)) {
            this.peers.set(peer.socketId, peer);
            if (this.hasJoinedRoom) {
              this.trigger('user-joined', peer);
            } else if (this.pendingJoinCallback) {
              const cb = this.pendingJoinCallback;
              this.pendingJoinCallback = null;
              cb();
            }
          }
        }
        break;
      }

      case 'peer-announce': {
        const incomingPeer = msg.peer;
        if (!incomingPeer || !incomingPeer.socketId || incomingPeer.socketId === this.id) {
          break;
        }

        const isNew = !this.peers.has(incomingPeer.socketId);
        this.peers.set(incomingPeer.socketId, incomingPeer);
        this.peerLastSeen.set(incomingPeer.socketId, Date.now());

        // Welcome them back with our info & active screen sharer
        this.publish(`syncstream/v2/${this.roomId}/peer/${incomingPeer.socketId}`, {
          type: 'peer-welcome',
          senderSocketId: this.id,
          peer: this.currentUser,
          activeScreenSharer: this.activeScreenSharer,
        });

        if (isNew) {
          this.trigger('user-joined', incomingPeer);
        }
        break;
      }

      case 'peer-welcome': {
        const peer = msg.peer;
        if (peer && peer.socketId && peer.socketId !== this.id) {
          const isNew = !this.peers.has(peer.socketId);
          this.peers.set(peer.socketId, peer);
          this.peerLastSeen.set(peer.socketId, Date.now());
          if (msg.activeScreenSharer) {
            this.activeScreenSharer = msg.activeScreenSharer;
          }
          if (this.hasJoinedRoom && isNew) {
            this.trigger('user-joined', peer);
          } else if (!this.hasJoinedRoom && this.pendingJoinCallback) {
            const cb = this.pendingJoinCallback;
            this.pendingJoinCallback = null;
            cb();
          }
        }
        break;
      }

      case 'signal': {
        this.trigger('signal', {
          senderSocketId: msg.senderSocketId,
          signalData: msg.signalData,
          type: msg.signalType || msg.type,
          streamKind: msg.streamKind,
        });
        break;
      }

      case 'screen-stream-requested': {
        if (msg.requesterSocketId && msg.requesterSocketId !== this.id) {
          this.trigger('screen-stream-requested', {
            requesterSocketId: msg.requesterSocketId,
          });
        }
        break;
      }

      case 'media-state-changed': {
        if (msg.socketId === this.id) break;
        const peer = this.peers.get(msg.socketId);
        if (peer) {
          peer.isAudioMuted = msg.isAudioMuted;
          peer.isVideoMuted = msg.isVideoMuted;
        }
        this.trigger('user-media-state', {
          socketId: msg.socketId,
          isAudioMuted: msg.isAudioMuted,
          isVideoMuted: msg.isVideoMuted,
        });
        break;
      }

      case 'screen-share-started': {
        this.activeScreenSharer = msg.sharer;
        this.trigger('screen-share-started', msg.sharer);
        break;
      }

      case 'screen-share-stopped': {
        if (this.activeScreenSharer?.socketId === msg.socketId) {
          this.activeScreenSharer = null;
        }
        this.trigger('screen-share-stopped', { socketId: msg.socketId });
        break;
      }

      case 'chat-message': {
        const chatMsg = msg.message || msg;
        this.trigger('chat-message', chatMsg);
        break;
      }

      case 'reaction': {
        this.trigger('reaction', msg.reaction);
        break;
      }

      case 'soundcheck-ping': {
        if (msg.senderSocketId !== this.id) {
          const now = Date.now();
          if (now - this.lastSoundcheckTime > 1000) {
            this.lastSoundcheckTime = now;
            this.trigger('soundcheck-ping', { senderName: msg.senderName });
          }
        }
        break;
      }

      case 'user-left': {
        const leftSocketId = msg.socketId || msg.senderSocketId;
        console.log(`[P2P Signaling] Received user-left for:`, leftSocketId);
        this.peers.delete(leftSocketId);
        this.peerLastSeen.delete(leftSocketId);
        if (this.activeScreenSharer?.socketId === leftSocketId) {
          this.activeScreenSharer = null;
        }
        this.trigger('user-left', {
          socketId: leftSocketId,
          displayName: msg.displayName || 'Friend',
        });
        break;
      }
    }
  }

  public emit(event: string, data?: any) {
    if (!this.client && event !== 'join-room') {
      this.connect();
    }

    switch (event) {
      case 'join-room': {
        const { roomId, displayName, avatar, isHost, secretCode, inviteToken } = data;
        this.roomId = roomId;

        // Passcode validation
        const isCodeValid = validateSecretCode(secretCode);
        const isInviteValid = inviteToken && (inviteToken.startsWith('inv_') || inviteToken.length > 3);

        if (!isCodeValid && !isInviteValid) {
          this.trigger('join-error', { message: 'Invalid credentials or expired invite link.' });
          return;
        }

        this.currentUser = {
          socketId: this.id,
          displayName: displayName || `Guest-${this.id.slice(0, 4)}`,
          avatar: avatar || '🍿',
          isHost: !!isHost,
          isAudioMuted: false,
          isVideoMuted: false,
        };

        this.peers.clear();
        this.peerLastSeen.clear();

        if (!this.isConnected) {
          this.connect();
        }

        const getRemoteParticipants = () => {
          return Array.from(this.peers.values()).filter(
            (p) => p && p.socketId && p.socketId !== this.id
          );
        };

        let joinedFired = false;
        const fireRoomJoined = () => {
          if (joinedFired) return;
          joinedFired = true;
          this.hasJoinedRoom = true;
          this.trigger('room-joined', {
            roomId,
            yourSocketId: this.id,
            isHost: this.currentUser?.isHost,
            participants: getRemoteParticipants(),
            activeScreenSharer: this.activeScreenSharer,
            messages: [
              {
                id: 'sys-welcome',
                senderId: 'system',
                senderName: 'SyncStream Bot',
                text: `Welcome to room ${roomId}! Watch party live.`,
                timestamp: Date.now(),
                isSystem: true,
              },
            ],
          });
        };

        this.pendingJoinCallback = fireRoomJoined;

        const announceTimer = setInterval(() => {
          if (this.isConnected && this.client) {
            clearInterval(announceTimer);
            this.subscribeToRoom(roomId);

            this.publish(`syncstream/v2/${roomId}/all`, {
              type: 'peer-announce',
              senderSocketId: this.id,
              peer: this.currentUser,
            });

            if (isCodeValid) {
              // Authorized host with secret code: fire room join after small settle delay
              setTimeout(() => {
                if (this.pendingJoinCallback) {
                  const cb = this.pendingJoinCallback;
                  this.pendingJoinCallback = null;
                  cb();
                }
              }, 300);
            } else {
              // Invited guest without secret code: wait up to 2.5s for existing peers to reply
              const timeoutId = window.setTimeout(() => {
                if (!this.hasJoinedRoom) {
                  this.pendingJoinCallback = null;
                  const remote = getRemoteParticipants();
                  if (remote.length === 0) {
                    console.warn(`[P2P Signaling] Room ${roomId} has no active participants. Secret code required.`);
                    this.trigger('join-error', {
                      code: 'INVITE_EXPIRED_EMPTY_ROOM',
                      message: 'This invite link has expired because everyone has left the watch party. Enter the secret code to start a new party.',
                    });
                    this.disconnect();
                    return;
                  }
                  fireRoomJoined();
                }
              }, 2500);

              // If a peer responded before timeout, cancel the timeout
              const origCb = this.pendingJoinCallback;
              this.pendingJoinCallback = () => {
                clearTimeout(timeoutId);
                if (origCb) origCb();
              };
            }
          }
        }, 50);

        break;
      }

      case 'request-screen-stream': {
        const { targetSocketId } = data || {};
        if (!this.roomId || !targetSocketId || targetSocketId === this.id) return;
        this.publish(`syncstream/v2/${this.roomId}/peer/${targetSocketId}`, {
          type: 'screen-stream-requested',
          senderSocketId: this.id,
          requesterSocketId: this.id,
        });
        break;
      }

      case 'signal': {
        const { targetSocketId, signalData, type, streamKind } = data;
        if (!this.roomId || !targetSocketId) return;
        this.publish(`syncstream/v2/${this.roomId}/peer/${targetSocketId}`, {
          type: 'signal',
          senderSocketId: this.id,
          signalData,
          signalType: type,
          streamKind,
        });
        break;
      }

      // Support both screen-share-start and start-screen-share
      case 'screen-share-start':
      case 'start-screen-share': {
        if (!this.roomId) return;
        const sharer = {
          socketId: this.id,
          displayName: this.currentUser?.displayName || 'Streamer',
          avatar: this.currentUser?.avatar || '🍿',
        };
        this.activeScreenSharer = sharer;
        this.publish(`syncstream/v2/${this.roomId}/all`, {
          type: 'screen-share-started',
          senderSocketId: this.id,
          sharer,
        });
        this.trigger('screen-share-started', sharer);
        break;
      }

      // Support both screen-share-stop and stop-screen-share
      case 'screen-share-stop':
      case 'stop-screen-share': {
        if (!this.roomId) return;
        this.activeScreenSharer = null;
        this.publish(`syncstream/v2/${this.roomId}/all`, {
          type: 'screen-share-stopped',
          senderSocketId: this.id,
          socketId: this.id,
        });
        this.trigger('screen-share-stopped', { socketId: this.id });
        break;
      }

      // Support both media-state-change and update-media-state
      case 'media-state-change':
      case 'update-media-state': {
        if (!this.roomId) return;
        const { isAudioMuted, isVideoMuted } = data || {};
        if (this.currentUser) {
          this.currentUser.isAudioMuted = isAudioMuted;
          this.currentUser.isVideoMuted = isVideoMuted;
        }
        this.publish(`syncstream/v2/${this.roomId}/all`, {
          type: 'media-state-changed',
          senderSocketId: this.id,
          socketId: this.id,
          isAudioMuted,
          isVideoMuted,
        });
        this.trigger('user-media-state', {
          socketId: this.id,
          isAudioMuted,
          isVideoMuted,
        });
        break;
      }

      // Support both chat-message and send-chat
      case 'chat-message':
      case 'send-chat': {
        if (!this.roomId) return;
        const textContent = typeof data === 'string' ? data : (data?.text || '');
        if (!textContent.trim()) return;

        const chatMsg = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          senderId: this.id,
          senderName: this.currentUser?.displayName || 'Friend',
          senderAvatar: this.currentUser?.avatar || '🍿',
          text: textContent.trim(),
          timestamp: Date.now(),
        };

        this.publish(`syncstream/v2/${this.roomId}/all`, {
          type: 'chat-message',
          senderSocketId: this.id,
          message: chatMsg,
        });
        // Optimistically trigger locally
        this.trigger('chat-message', chatMsg);
        break;
      }

      case 'send-reaction': {
        if (!this.roomId) return;
        const reactionData = {
          id: `react_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          senderName: this.currentUser?.displayName || 'Friend',
          emoji: data.emoji,
          timestamp: Date.now(),
        };
        this.publish(`syncstream/v2/${this.roomId}/all`, {
          type: 'reaction',
          senderSocketId: this.id,
          reaction: reactionData,
        });
        this.trigger('reaction', reactionData);
        break;
      }

      case 'soundcheck-ping': {
        if (!this.roomId) return;
        const pingPayload = {
          type: 'soundcheck-ping',
          senderSocketId: this.id,
          senderName: data?.senderName || this.currentUser?.displayName || 'Friend',
          timestamp: Date.now(),
        };
        this.publish(`syncstream/v2/${this.roomId}/all`, pingPayload);
        this.peers.forEach((_peer, peerId) => {
          this.publish(`syncstream/v2/${this.roomId}/peer/${peerId}`, pingPayload);
        });
        break;
      }

      case 'leave-room':
      case 'leave': {
        this.broadcastLeave();
        break;
      }
    }
  }

  private broadcastLeave() {
    if (this.roomId && this.isConnected) {
      console.log(`[P2P Signaling] Broadcasting user-left for:`, this.id);
      this.publish(`syncstream/v2/${this.roomId}/all`, {
        type: 'user-left',
        senderSocketId: this.id,
        socketId: this.id,
        displayName: this.currentUser?.displayName || 'Friend',
      });
    }
  }

  public disconnect() {
    this.broadcastLeave();

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    if (this.staleCheckInterval) {
      clearInterval(this.staleCheckInterval);
      this.staleCheckInterval = null;
    }
    if (this.unloadHandler && typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.unloadHandler);
      window.removeEventListener('pagehide', this.unloadHandler);
      this.unloadHandler = null;
    }

    if (this.client) {
      // Small delay to allow final MQTT publish to exit the socket buffer
      setTimeout(() => {
        try {
          this.client?.end(false);
        } catch (e) {
          console.warn('Error ending client:', e);
        }
        this.client = null;
      }, 150);
    }

    this.isConnected = false;
    this.hasJoinedRoom = false;
    this.peers.clear();
    this.peerLastSeen.clear();
    this.activeScreenSharer = null;
  }
}

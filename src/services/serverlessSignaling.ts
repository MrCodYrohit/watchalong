/**
 * Serverless Signaling Engine for 100% GitHub Pages Deployment
 * 
 * Replaces the need for a dedicated Node.js signaling server by using public,
 * encrypted WebSockets (WSS) over MQTT. Media (screen share, audio, video)
 * continues to flow 100% Peer-to-Peer directly via WebRTC at full 25 Mbps resolution.
 */
import mqtt, { MqttClient } from 'mqtt';

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
  private activeScreenSharer: any = null;
  private isConnected: boolean = false;
  private brokerIndex: number = 0;
  private hasJoinedRoom: boolean = false;

  constructor() {
    this.id = `peer_${Math.random().toString(36).substring(2, 9)}_${Date.now().toString(36).slice(-4)}`;
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
    console.log(`[P2P Signaling] Connecting to public broker: ${brokerUrl}`);

    try {
      this.client = mqtt.connect(brokerUrl, {
        clientId: `sync_${this.id}`,
        clean: true,
        connectTimeout: 5000,
        keepalive: 30,
        reconnectPeriod: 2000,
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
        // Try fallback broker on error
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
        console.log(`[P2P Signaling] Subscribed to room topics for ${roomId}`);
      }
    });
  }

  private publish(topic: string, data: any) {
    if (!this.client || !this.isConnected) {
      // If not yet connected, retry shortly
      setTimeout(() => this.publish(topic, data), 200);
      return;
    }
    this.client.publish(topic, JSON.stringify(data), { qos: 0 });
  }

  private handleIncomingMessage(_topic: string, msg: any) {
    // Ignore messages sent by ourselves
    if (msg.senderSocketId === this.id || msg.senderId === this.id) {
      return;
    }

    switch (msg.type) {
      case 'peer-announce': {
        // Another peer joined the room
        const incomingPeer = msg.peer;
        if (!incomingPeer || !incomingPeer.socketId || incomingPeer.socketId === this.id) {
          break;
        }

        const isNew = !this.peers.has(incomingPeer.socketId);
        this.peers.set(incomingPeer.socketId, incomingPeer);

        // Tell them about our existence and current screen share state
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
        // Existing peer greeted us
        const peer = msg.peer;
        if (peer && peer.socketId && peer.socketId !== this.id) {
          const isNew = !this.peers.has(peer.socketId);
          this.peers.set(peer.socketId, peer);
          if (msg.activeScreenSharer) {
            this.activeScreenSharer = msg.activeScreenSharer;
          }
          if (this.hasJoinedRoom && isNew) {
            this.trigger('user-joined', peer);
          }
        }
        break;
      }

      case 'signal': {
        // WebRTC SDP Offer / Answer or ICE Candidate
        this.trigger('signal', {
          senderSocketId: msg.senderSocketId,
          signalData: msg.signalData,
          type: msg.signalType,
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
        this.trigger('media-state-changed', {
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
        this.trigger('chat-message', msg.message);
        break;
      }

      case 'reaction': {
        this.trigger('reaction', msg.reaction);
        break;
      }

      case 'user-left': {
        this.peers.delete(msg.socketId);
        if (this.activeScreenSharer?.socketId === msg.socketId) {
          this.activeScreenSharer = null;
        }
        this.trigger('user-left', {
          socketId: msg.socketId,
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
        const validCode = 'rohit ko baap bol 15';
        const isCodeValid = secretCode && secretCode.trim().toLowerCase() === validCode;
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

        // Note: this.peers ONLY tracks remote peers (never self)
        this.peers.clear();

        // Ensure connected to broker
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
                text: `Welcome to room ${roomId}! P2P Watch Party ready.`,
                timestamp: Date.now(),
                isSystem: true,
              },
            ],
          });
        };

        // Wait brief moment for initial MQTT subscriptions, then announce
        const announceTimer = setInterval(() => {
          if (this.isConnected && this.client) {
            clearInterval(announceTimer);
            this.subscribeToRoom(roomId);

            // Announce to all peers in the room
            this.publish(`syncstream/v2/${roomId}/all`, {
              type: 'peer-announce',
              senderSocketId: this.id,
              peer: this.currentUser,
            });

            // After 350ms, collect whatever peers have responded and trigger room-joined
            setTimeout(() => {
              fireRoomJoined();
            }, 350);
          }
        }, 50);

        // Safety timeout for room-joined if broker is slow
        setTimeout(() => {
          clearInterval(announceTimer);
          fireRoomJoined();
        }, 1500);

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
        // Direct P2P signaling to target peer
        const { targetSocketId, signalData, type, streamKind } = data;
        if (!this.roomId) return;
        this.publish(`syncstream/v2/${this.roomId}/peer/${targetSocketId}`, {
          type: 'signal',
          senderSocketId: this.id,
          signalData,
          signalType: type,
          streamKind,
        });
        break;
      }

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
        // Also trigger locally
        this.trigger('screen-share-started', { sharer });
        break;
      }

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

      case 'update-media-state': {
        if (!this.roomId) return;
        const { isAudioMuted, isVideoMuted } = data;
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
        break;
      }

      case 'send-chat': {
        if (!this.roomId) return;
        const chatMsg = {
          id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          senderId: this.id,
          senderName: this.currentUser?.displayName || 'Friend',
          senderAvatar: this.currentUser?.avatar || '🍿',
          text: data.text,
          timestamp: Date.now(),
        };
        this.publish(`syncstream/v2/${this.roomId}/all`, {
          type: 'chat-message',
          senderSocketId: this.id,
          message: chatMsg,
        });
        // Trigger locally as well
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
    }
  }

  public disconnect() {
    if (this.roomId && this.isConnected) {
      this.publish(`syncstream/v2/${this.roomId}/all`, {
        type: 'user-left',
        senderSocketId: this.id,
        socketId: this.id,
        displayName: this.currentUser?.displayName,
      });
    }

    if (this.client) {
      try {
        this.client.end(true);
      } catch (e) {
        console.warn('Error ending client:', e);
      }
      this.client = null;
    }
    this.isConnected = false;
    this.hasJoinedRoom = false;
    this.peers.clear();
    this.activeScreenSharer = null;
  }
}

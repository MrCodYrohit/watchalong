import { Socket } from 'socket.io-client';
import { SignalingSocket } from './serverlessSignaling';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
  ],
};

export type StreamKind = 'cam' | 'screen';

export interface WebRTCEvents {
  onRemoteCamStream?: (socketId: string, stream: MediaStream) => void;
  onRemoteScreenStream?: (socketId: string, stream: MediaStream) => void;
  onRemoteCamRemoved?: (socketId: string) => void;
  onRemoteScreenRemoved?: (socketId: string) => void;
  onScreenConnectionState?: (socketId: string, state: RTCPeerConnectionState) => void;
}

/**
 * Modifies WebRTC SDP to allocate high bandwidth for screen sharing.
 * Prevents video compression artifacts, fuzzy text, and resolution downscaling.
 */
function boostSdpBitrate(sdp: string, bitrateKbps: number = 25000): string {
  const lines = sdp.split('\r\n');
  const modified: string[] = [];
  let inVideoSection = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('m=video')) {
      inVideoSection = true;
      modified.push(line);
      modified.push(`b=AS:${bitrateKbps}`);
      modified.push(`b=TIAS:${bitrateKbps * 1000}`);
      continue;
    } else if (line.startsWith('m=') && inVideoSection) {
      inVideoSection = false;
    }
    // Remove existing lower b=AS lines
    if (inVideoSection && (line.startsWith('b=AS:') || line.startsWith('b=TIAS:'))) {
      continue;
    }
    modified.push(line);
  }
  return modified.join('\r\n');
}

export class WebRTCManager {
  private socket: SignalingSocket | Socket;
  private localSocketId: string = '';
  private camPeers: Map<string, RTCPeerConnection> = new Map();
  private screenPeers: Map<string, RTCPeerConnection> = new Map();

  // Candidate queues to eliminate ICE race conditions
  private pendingCamCandidates: Map<string, RTCIceCandidateInit[]> = new Map();
  private pendingScreenCandidates: Map<string, RTCIceCandidateInit[]> = new Map();

  public localCamStream: MediaStream | null = null;
  public localScreenStream: MediaStream | null = null;

  public events: WebRTCEvents = {};

  constructor(socket: SignalingSocket | Socket) {
    this.socket = socket;
    this.setupSocketListeners();
  }

  setLocalSocketId(id: string) {
    this.localSocketId = id;
  }

  private setupSocketListeners() {
    this.socket.on('signal', async ({ senderSocketId, signalData, type, streamKind }: {
      senderSocketId: string;
      signalData: RTCSessionDescriptionInit | RTCIceCandidateInit;
      type: 'offer' | 'answer' | 'candidate';
      streamKind: StreamKind;
    }) => {
      try {
        if (streamKind === 'cam') {
          await this.handleCamSignal(senderSocketId, signalData, type);
        } else if (streamKind === 'screen') {
          await this.handleScreenSignal(senderSocketId, signalData, type);
        }
      } catch (err) {
        console.error(`[WebRTC] Error handling ${streamKind} signal from ${senderSocketId}:`, err);
      }
    });

    this.socket.on('screen-share-stopped', ({ socketId }: { socketId: string }) => {
      this.closeScreenPeer(socketId);
      this.events.onRemoteScreenRemoved?.(socketId);
    });

    this.socket.on('user-left', ({ socketId }: { socketId: string }) => {
      this.closeCamPeer(socketId);
      this.closeScreenPeer(socketId);
      this.events.onRemoteCamRemoved?.(socketId);
      this.events.onRemoteScreenRemoved?.(socketId);
    });
  }

  // Camera WebRTC Pipeline
  async initiateCamConnection(targetSocketId: string) {
    if (!targetSocketId || targetSocketId === this.localSocketId || targetSocketId === 'self') {
      return;
    }
    const existingPc = this.camPeers.get(targetSocketId);
    if (existingPc && (existingPc.connectionState === 'connected' || existingPc.signalingState === 'have-local-offer')) {
      return;
    }
    if (existingPc) {
      this.closeCamPeer(targetSocketId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.camPeers.set(targetSocketId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          targetSocketId,
          signalData: event.candidate.toJSON(),
          type: 'candidate',
          streamKind: 'cam',
        });
      }
    };

    pc.ontrack = (event) => {
      const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
      this.events.onRemoteCamStream?.(targetSocketId, stream);
    };

    if (this.localCamStream) {
      this.localCamStream.getTracks().forEach((track) => {
        pc.addTrack(track, this.localCamStream!);
      });
    }

    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true,
    });
    await pc.setLocalDescription(offer);

    this.socket.emit('signal', {
      targetSocketId,
      signalData: offer,
      type: 'offer',
      streamKind: 'cam',
    });
  }

  private async handleCamSignal(senderSocketId: string, signalData: RTCSessionDescriptionInit | RTCIceCandidateInit, type: string) {
    let pc = this.camPeers.get(senderSocketId);

    if (type === 'offer') {
      if (pc) this.closeCamPeer(senderSocketId);
      pc = new RTCPeerConnection(ICE_SERVERS);
      this.camPeers.set(senderSocketId, pc);

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('signal', {
            targetSocketId: senderSocketId,
            signalData: event.candidate.toJSON(),
            type: 'candidate',
            streamKind: 'cam',
          });
        }
      };

      pc.ontrack = (event) => {
        const stream = (event.streams && event.streams[0]) ? event.streams[0] : new MediaStream([event.track]);
        this.events.onRemoteCamStream?.(senderSocketId, stream);
      };

      if (this.localCamStream) {
        this.localCamStream.getTracks().forEach((track) => {
          pc!.addTrack(track, this.localCamStream!);
        });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(signalData as RTCSessionDescriptionInit));

      const queued = this.pendingCamCandidates.get(senderSocketId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Failed adding queued cam candidate:', e);
        }
      }
      this.pendingCamCandidates.delete(senderSocketId);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      this.socket.emit('signal', {
        targetSocketId: senderSocketId,
        signalData: answer,
        type: 'answer',
        streamKind: 'cam',
      });
    } else if (type === 'answer') {
      if (pc && pc.signalingState !== 'stable') {
        await pc.setRemoteDescription(new RTCSessionDescription(signalData as RTCSessionDescriptionInit));
        const queued = this.pendingCamCandidates.get(senderSocketId) || [];
        for (const cand of queued) {
          try {
            await pc.addIceCandidate(new RTCIceCandidate(cand));
          } catch (e) {
            console.warn('Failed adding queued cam candidate:', e);
          }
        }
        this.pendingCamCandidates.delete(senderSocketId);
      }
    } else if (type === 'candidate') {
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signalData as RTCIceCandidateInit));
        } catch (e) {
          console.warn('Failed adding cam candidate:', e);
        }
      } else {
        const queue = this.pendingCamCandidates.get(senderSocketId) || [];
        queue.push(signalData as RTCIceCandidateInit);
        this.pendingCamCandidates.set(senderSocketId, queue);
      }
    }
  }

  // Screen Share WebRTC Pipeline
  async broadcastScreenShare(screenStream: MediaStream, participantSocketIds: string[]) {
    this.localScreenStream = screenStream;

    // Hint browser engine to preserve razor-sharp text and high-frequency details
    const vTrack = screenStream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.contentHint = 'detail'; // 'detail' prioritizes sharp text & high resolution over frame drops
    }
    const aTrack = screenStream.getAudioTracks()[0];
    if (aTrack) {
      aTrack.contentHint = 'music';
    }

    for (const targetSocketId of participantSocketIds) {
      if (targetSocketId === this.localSocketId) continue;
      await this.sendScreenStreamTo(targetSocketId, screenStream);
    }
  }

  // Public method to send screen stream to any new or requesting participant
  async sendScreenStreamTo(targetSocketId: string, screenStream?: MediaStream) {
    if (!targetSocketId || targetSocketId === this.localSocketId || targetSocketId === 'self') {
      return;
    }
    const stream = screenStream || this.localScreenStream;
    if (!stream) {
      console.warn('[WebRTC] Cannot send screen stream: no local stream active');
      return;
    }

    const existingPc = this.screenPeers.get(targetSocketId);
    if (existingPc) {
      // Prevent glare: do NOT abort if negotiation is already actively underway or connected!
      if (
        existingPc.connectionState === 'connected' ||
        existingPc.signalingState === 'have-local-offer'
      ) {
        console.log(`[WebRTC] Screen peer ${targetSocketId} is already in state: ${existingPc.signalingState} / ${existingPc.connectionState}. Skipping duplicate offer.`);
        return;
      }
      this.closeScreenPeer(targetSocketId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.screenPeers.set(targetSocketId, pc);

    pc.onconnectionstatechange = () => {
      console.log(`🔌 [Screen Sender PC] State with ${targetSocketId}:`, pc.connectionState);
      this.events.onScreenConnectionState?.(targetSocketId, pc.connectionState);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.socket.emit('signal', {
          targetSocketId,
          signalData: event.candidate.toJSON(),
          type: 'candidate',
          streamKind: 'screen',
        });
      }
    };

    // Add screen tracks (video and system/tab audio)
    stream.getTracks().forEach((track) => {
      if (track.kind === 'video') {
        track.contentHint = 'detail';
      } else if (track.kind === 'audio') {
        track.contentHint = 'music';
      }
      console.log(`🎬 Adding track to screen peer (${targetSocketId}):`, track.kind, track.label);
      pc.addTrack(track, stream);
    });

    // Enforce ultra-high bitrate & maintain-resolution to keep text razor sharp
    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (videoSender) {
      try {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 25000000; // 25 Mbps bandwidth limit
        params.encodings[0].maxFramerate = 60;
        params.degradationPreference = 'maintain-resolution'; // NEVER downscale resolution or blur text!
        await videoSender.setParameters(params);
        console.log('🚀 Applied 25Mbps bitrate and maintain-resolution for crystal-clear text');
      } catch (err) {
        console.warn('Could not set video sender parameters:', err);
      }
    }

    const offer = await pc.createOffer();
    if (offer.sdp) {
      offer.sdp = boostSdpBitrate(offer.sdp, 25000);
    }
    await pc.setLocalDescription(offer);

    console.log(`📡 Sending screen offer to: ${targetSocketId}`);
    this.socket.emit('signal', {
      targetSocketId,
      signalData: offer,
      type: 'offer',
      streamKind: 'screen',
    });
  }

  private async handleScreenSignal(senderSocketId: string, signalData: RTCSessionDescriptionInit | RTCIceCandidateInit, type: string) {
    let pc = this.screenPeers.get(senderSocketId);

    if (type === 'offer') {
      console.log(`📥 Received screen offer from ${senderSocketId}`);
      if (pc) {
        if (pc.connectionState === 'connected') {
          console.log(`[WebRTC] Already connected to ${senderSocketId}, ignoring duplicate offer.`);
          return;
        }
        this.closeScreenPeer(senderSocketId);
      }

      pc = new RTCPeerConnection(ICE_SERVERS);
      this.screenPeers.set(senderSocketId, pc);

      pc.onconnectionstatechange = () => {
        console.log(`🔌 [Screen Receiver PC] State with ${senderSocketId}:`, pc!.connectionState);
        this.events.onScreenConnectionState?.(senderSocketId, pc!.connectionState);
      };

      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.socket.emit('signal', {
            targetSocketId: senderSocketId,
            signalData: event.candidate.toJSON(),
            type: 'candidate',
            streamKind: 'screen',
          });
        }
      };

      pc.ontrack = (event) => {
        console.log('🎥 [Screen Receiver] Track received:', event.track.kind, event.streams);
        let stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(event.track);
        }
        this.events.onRemoteScreenStream?.(senderSocketId, stream);
      };

      await pc.setRemoteDescription(new RTCSessionDescription(signalData as RTCSessionDescriptionInit));

      // Flush queued candidates
      const queued = this.pendingScreenCandidates.get(senderSocketId) || [];
      for (const cand of queued) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch (e) {
          console.warn('Failed adding queued screen candidate:', e);
        }
      }
      this.pendingScreenCandidates.delete(senderSocketId);

      const answer = await pc.createAnswer();
      if (answer.sdp) {
        answer.sdp = boostSdpBitrate(answer.sdp, 25000);
      }
      await pc.setLocalDescription(answer);

      console.log(`📡 Sending screen answer to: ${senderSocketId}`);
      this.socket.emit('signal', {
        targetSocketId: senderSocketId,
        signalData: answer,
        type: 'answer',
        streamKind: 'screen',
      });
    } else if (type === 'answer') {
      console.log(`📥 Received screen answer from ${senderSocketId}`);
      if (pc) {
        if (pc.signalingState === 'have-local-offer') {
          await pc.setRemoteDescription(new RTCSessionDescription(signalData as RTCSessionDescriptionInit));
          const queued = this.pendingScreenCandidates.get(senderSocketId) || [];
          for (const cand of queued) {
            try {
              await pc.addIceCandidate(new RTCIceCandidate(cand));
            } catch (e) {
              console.warn('Failed adding queued screen candidate:', e);
            }
          }
          this.pendingScreenCandidates.delete(senderSocketId);
          console.log(`✅ WebRTC Screen negotiation completed with ${senderSocketId}`);
        }
      }
    } else if (type === 'candidate') {
      if (pc && pc.remoteDescription) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(signalData as RTCIceCandidateInit));
        } catch (e) {
          console.warn('Failed adding screen candidate:', e);
        }
      } else {
        const queue = this.pendingScreenCandidates.get(senderSocketId) || [];
        queue.push(signalData as RTCIceCandidateInit);
        this.pendingScreenCandidates.set(senderSocketId, queue);
      }
    }
  }

  // Update local cam stream tracks
  updateLocalCamStream(stream: MediaStream | null) {
    this.localCamStream = stream;
    if (!stream) return;

    this.camPeers.forEach((pc) => {
      const senders = pc.getSenders();
      stream.getTracks().forEach((newTrack) => {
        const sender = senders.find((s) => s.track?.kind === newTrack.kind);
        if (sender) {
          sender.replaceTrack(newTrack);
        } else {
          pc.addTrack(newTrack, stream);
        }
      });
    });
  }

  closeCamPeer(socketId: string) {
    const pc = this.camPeers.get(socketId);
    if (pc) {
      pc.close();
      this.camPeers.delete(socketId);
    }
    this.pendingCamCandidates.delete(socketId);
  }

  closeScreenPeer(socketId: string) {
    const pc = this.screenPeers.get(socketId);
    if (pc) {
      pc.close();
      this.screenPeers.delete(socketId);
    }
    this.pendingScreenCandidates.delete(socketId);
  }

  stopAllScreenShares() {
    if (this.localScreenStream) {
      this.localScreenStream.getTracks().forEach((t) => t.stop());
      this.localScreenStream = null;
    }
    this.screenPeers.forEach((pc) => pc.close());
    this.screenPeers.clear();
    this.pendingScreenCandidates.clear();
  }

  destroy() {
    this.stopAllScreenShares();
    if (this.localCamStream) {
      this.localCamStream.getTracks().forEach((t) => t.stop());
      this.localCamStream = null;
    }
    this.camPeers.forEach((pc) => pc.close());
    this.camPeers.clear();
    this.pendingCamCandidates.clear();
  }
}

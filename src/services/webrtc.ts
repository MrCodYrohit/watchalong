import { Socket } from 'socket.io-client';
import { SignalingSocket } from './serverlessSignaling';

const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    { urls: 'stun:stun4.l.google.com:19302' },
    { urls: 'stun:global.stun.twilio.com:3478' },
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
  private remoteCamMediaStreams: Map<string, MediaStream> = new Map();

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

  getCamPeer(id: string): RTCPeerConnection | undefined {
    return this.camPeers.get(id);
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
      console.log(`[WebRTC] Cam connection with ${targetSocketId} already active or pending offer.`);
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
      let stream = this.remoteCamMediaStreams.get(targetSocketId);
      if (!stream) {
        stream = new MediaStream();
      }
      if (!stream.getTracks().some((t) => t.id === event.track.id)) {
        stream.addTrack(event.track);
      }
      const clonedStream = new MediaStream(stream.getTracks());
      this.remoteCamMediaStreams.set(targetSocketId, clonedStream);
      console.log(`[WebRTC] Received remote ${event.track.kind} track from ${targetSocketId}, total tracks: ${clonedStream.getTracks().length}`);
      this.events.onRemoteCamStream?.(targetSocketId, clonedStream);
    };

    // Add audio and video transceivers upfront so SDP negotiation is fully bidirectional
    const audioTransceiver = pc.addTransceiver('audio', { direction: 'sendrecv' });
    const videoTransceiver = pc.addTransceiver('video', { direction: 'sendrecv' });

    // If local cam/mic tracks are already active, attach them immediately
    if (this.localCamStream) {
      const aTrack = this.localCamStream.getAudioTracks()[0];
      if (aTrack && audioTransceiver.sender) {
        audioTransceiver.sender.replaceTrack(aTrack).catch(() => {});
      }
      const vTrack = this.localCamStream.getVideoTracks()[0];
      if (vTrack && videoTransceiver.sender) {
        videoTransceiver.sender.replaceTrack(vTrack).catch(() => {});
      }
    }

    const offer = await pc.createOffer();
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
      const isOfferCollision = pc && pc.signalingState !== 'stable';
      if (isOfferCollision) {
        // Perfect negotiation tie-breaker: polite peer yields if local id is lower
        const isPolite = this.localSocketId < senderSocketId;
        if (!isPolite) {
          console.log(`[WebRTC] Glare detected with ${senderSocketId}: ignoring impolite offer.`);
          return;
        }
        console.log(`[WebRTC] Glare detected with ${senderSocketId}: polite peer accepting offer.`);
        this.closeCamPeer(senderSocketId);
        pc = undefined;
      }

      if (!pc) {
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
          let stream = this.remoteCamMediaStreams.get(senderSocketId);
          if (!stream) {
            stream = new MediaStream();
          }
          if (!stream.getTracks().some((t) => t.id === event.track.id)) {
            stream.addTrack(event.track);
          }
          const clonedStream = new MediaStream(stream.getTracks());
          this.remoteCamMediaStreams.set(senderSocketId, clonedStream);
          console.log(`[WebRTC] Received remote ${event.track.kind} track from ${senderSocketId}, total tracks: ${clonedStream.getTracks().length}`);
          this.events.onRemoteCamStream?.(senderSocketId, clonedStream);
        };
      }

      // Step 1: Set remote description FIRST before adjusting transceivers!
      await pc.setRemoteDescription(new RTCSessionDescription(signalData as RTCSessionDescriptionInit));

      // Step 2: Bind local tracks to the incoming transceivers
      const transceivers = pc.getTransceivers();
      const audioTransceiver = transceivers.find(
        (t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
      );
      const videoTransceiver = transceivers.find(
        (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
      );

      if (audioTransceiver) {
        audioTransceiver.direction = 'sendrecv';
        const aTrack = this.localCamStream?.getAudioTracks()[0];
        if (aTrack && audioTransceiver.sender) {
          await audioTransceiver.sender.replaceTrack(aTrack).catch((err) => {
            console.warn('[WebRTC] Error attaching audio track to answerer transceiver:', err);
          });
        }
      } else {
        const aTrack = this.localCamStream?.getAudioTracks()[0];
        if (aTrack) {
          try { pc.addTrack(aTrack, this.localCamStream!); } catch (_) {}
        }
      }

      if (videoTransceiver) {
        videoTransceiver.direction = 'sendrecv';
        const vTrack = this.localCamStream?.getVideoTracks()[0];
        if (vTrack && videoTransceiver.sender) {
          await videoTransceiver.sender.replaceTrack(vTrack).catch((err) => {
            console.warn('[WebRTC] Error attaching video track to answerer transceiver:', err);
          });
        }
      } else {
        const vTrack = this.localCamStream?.getVideoTracks()[0];
        if (vTrack) {
          try { pc.addTrack(vTrack, this.localCamStream!); } catch (_) {}
        }
      }

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
      if (pc && pc.signalingState === 'have-local-offer') {
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
        console.log(`[WebRTC] Camera peer connection established with ${senderSocketId}`);
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

    const vTrack = screenStream.getVideoTracks()[0];
    if (vTrack) {
      vTrack.contentHint = 'detail';
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
      if (
        existingPc.connectionState === 'connected' ||
        existingPc.signalingState === 'have-local-offer'
      ) {
        console.log(`[WebRTC] Screen peer ${targetSocketId} already connected/pending.`);
        return;
      }
      this.closeScreenPeer(targetSocketId);
    }

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.screenPeers.set(targetSocketId, pc);

    pc.onconnectionstatechange = () => {
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

    stream.getTracks().forEach((track) => {
      if (track.kind === 'video') {
        track.contentHint = 'detail';
      } else if (track.kind === 'audio') {
        track.contentHint = 'music';
      }
      pc.addTrack(track, stream);
    });

    const videoSender = pc.getSenders().find((s) => s.track?.kind === 'video');
    if (videoSender) {
      try {
        const params = videoSender.getParameters();
        if (!params.encodings || params.encodings.length === 0) {
          params.encodings = [{}];
        }
        params.encodings[0].maxBitrate = 25000000; // 25 Mbps
        params.encodings[0].maxFramerate = 60;
        params.degradationPreference = 'maintain-resolution';
        await videoSender.setParameters(params);
      } catch (err) {
        console.warn('Could not set video sender parameters:', err);
      }
    }

    const offer = await pc.createOffer();
    if (offer.sdp) {
      offer.sdp = boostSdpBitrate(offer.sdp, 25000);
    }
    await pc.setLocalDescription(offer);

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
      if (pc) {
        if (pc.connectionState === 'connected') {
          return;
        }
        this.closeScreenPeer(senderSocketId);
      }

      pc = new RTCPeerConnection(ICE_SERVERS);
      this.screenPeers.set(senderSocketId, pc);

      pc.onconnectionstatechange = () => {
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
        let stream = (event.streams && event.streams[0]) ? event.streams[0] : null;
        if (!stream) {
          stream = new MediaStream();
          stream.addTrack(event.track);
        }
        this.events.onRemoteScreenStream?.(senderSocketId, stream);
      };

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

      const answer = await pc.createAnswer();
      if (answer.sdp) {
        answer.sdp = boostSdpBitrate(answer.sdp, 25000);
      }
      await pc.setLocalDescription(answer);

      this.socket.emit('signal', {
        targetSocketId: senderSocketId,
        signalData: answer,
        type: 'answer',
        streamKind: 'screen',
      });
    } else if (type === 'answer') {
      if (pc && pc.signalingState === 'have-local-offer') {
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

  // Update local cam stream tracks across all active cam peers
  updateLocalCamStream(stream: MediaStream | null) {
    this.localCamStream = stream;
    if (!stream) return;

    const audioTrack = stream.getAudioTracks()[0];
    const videoTrack = stream.getVideoTracks()[0];

    this.camPeers.forEach((pc) => {
      const transceivers = typeof pc.getTransceivers === 'function' ? pc.getTransceivers() : [];
      const audioTransceiver = transceivers.find(
        (t) => t.receiver?.track?.kind === 'audio' || t.sender?.track?.kind === 'audio'
      );
      const videoTransceiver = transceivers.find(
        (t) => t.receiver?.track?.kind === 'video' || t.sender?.track?.kind === 'video'
      );

      if (audioTrack) {
        if (audioTransceiver?.sender) {
          audioTransceiver.sender.replaceTrack(audioTrack).catch((err) => {
            console.warn('[WebRTC] replaceTrack audio error:', err);
          });
        } else {
          const aSender = pc.getSenders().find((s) => s.track?.kind === 'audio');
          if (aSender) {
            aSender.replaceTrack(audioTrack).catch((err) => console.warn('[WebRTC] replaceTrack audio err:', err));
          } else {
            try { pc.addTrack(audioTrack, stream); } catch (_) {}
          }
        }
      }

      if (videoTrack) {
        if (videoTransceiver?.sender) {
          videoTransceiver.sender.replaceTrack(videoTrack).catch((err) => {
            console.warn('[WebRTC] replaceTrack video error:', err);
          });
        } else {
          const vSender = pc.getSenders().find((s) => s.track?.kind === 'video');
          if (vSender) {
            vSender.replaceTrack(videoTrack).catch((err) => console.warn('[WebRTC] replaceTrack video err:', err));
          } else {
            try { pc.addTrack(videoTrack, stream); } catch (_) {}
          }
        }
      }
    });
  }

  closeCamPeer(socketId: string) {
    const pc = this.camPeers.get(socketId);
    if (pc) {
      pc.close();
      this.camPeers.delete(socketId);
    }
    this.remoteCamMediaStreams.delete(socketId);
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
    this.remoteCamMediaStreams.clear();
    this.pendingCamCandidates.clear();
  }
}

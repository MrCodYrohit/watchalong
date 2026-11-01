import React, { useState, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { SignalingSocket } from '../services/serverlessSignaling';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Monitor,
  MonitorOff,
  MessageSquare,
  Users,
  Copy,
  Check,
  Maximize2,
  Minimize2,
  Volume2,
  VolumeX,
  PhoneOff,
  Sparkles,
  HelpCircle,
  PictureInPicture,
  Tv,
  Film,
  Send,
  Radio,
  Sliders,
} from 'lucide-react';
import {
  Participant,
  ChatMessage,
  ReactionEvent,
  ScreenSharerInfo,
} from '../types';
import { WebRTCManager } from '../services/webrtc';
import { sound } from '../services/sound';
import { createVirtualCameraTrack } from '../services/virtualCam';
import { ParticipantTile } from './ParticipantTile';
import { ReactionFloatingLayer } from './ReactionFloatingLayer';
import { ScreenShareGuideModal } from './ScreenShareGuideModal';

interface WatchPartyRoomProps {
  roomId: string;
  displayName: string;
  avatar: string;
  isHost: boolean;
  initialAudioMuted: boolean;
  initialVideoMuted: boolean;
  socket: SignalingSocket | Socket;
  onLeaveRoom: () => void;
  onJoinError?: (errorMessage: string) => void;
}

export const WatchPartyRoom: React.FC<WatchPartyRoomProps> = ({
  roomId,
  displayName,
  avatar,
  isHost,
  initialAudioMuted,
  initialVideoMuted,
  socket,
  onLeaveRoom,
  onJoinError,
}) => {
  const onJoinErrorRef = useRef(onJoinError);
  onJoinErrorRef.current = onJoinError;
  const onLeaveRoomRef = useRef(onLeaveRoom);
  onLeaveRoomRef.current = onLeaveRoom;

  // Room state
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [activeScreenSharer, setActiveScreenSharer] = useState<ScreenSharerInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [reactions, setReactions] = useState<ReactionEvent[]>([]);

  // Local media controls
  const [isAudioMuted, setIsAudioMuted] = useState(initialAudioMuted);
  const [isVideoMuted, setIsVideoMuted] = useState(initialVideoMuted);
  const [isSharingScreen, setIsSharingScreen] = useState(false);

  // UI controls
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [sidebarTab, setSidebarTab] = useState<'chat' | 'peers' | 'guide'>('chat');
  const [isGuideOpen, setIsGuideOpen] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Audio boost & stream volume
  const [streamVolume, setStreamVolume] = useState<number>(100); // 0 to 200%
  const [isStreamMuted, setIsStreamMuted] = useState(false);
  const [hasScreenAudio, setHasScreenAudio] = useState(false);
  const [soundcheckToast, setSoundcheckToast] = useState<string | null>(null);

  // WebRTC streams
  const [localCamStream, setLocalCamStream] = useState<MediaStream | null>(null);
  const [remoteCamStreams, setRemoteCamStreams] = useState<Map<string, MediaStream>>(new Map());
  const [remoteScreenStream, setRemoteScreenStream] = useState<MediaStream | null>(null);

  // Demo Reel Video Mode (for instant testing without needing active Netflix tab)
  const [isPlayingDemoReel, setIsPlayingDemoReel] = useState(false);

  // Refs
  const webrtcRef = useRef<WebRTCManager | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement>(null);
  const screenAudioRef = useRef<HTMLAudioElement>(null);
  const demoIntervalRef = useRef<number | null>(null);
  const demoSynthTimerRef = useRef<number | null>(null);
  const demoAudioCtxRef = useRef<AudioContext | null>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const stageContainerRef = useRef<HTMLDivElement>(null);

  // Initialize WebRTC and Socket listeners
  useEffect(() => {
    const webrtc = new WebRTCManager(socket);
    webrtcRef.current = webrtc;

    webrtc.events.onRemoteCamStream = (senderId, stream) => {
      setRemoteCamStreams((prev) => {
        const next = new Map(prev);
        next.set(senderId, stream);
        return next;
      });
    };

    webrtc.events.onRemoteCamRemoved = (senderId) => {
      setRemoteCamStreams((prev) => {
        const next = new Map(prev);
        next.delete(senderId);
        return next;
      });
    };

    webrtc.events.onRemoteScreenStream = (_senderId, stream) => {
      setRemoteScreenStream(stream);
      const audioTracks = stream.getAudioTracks();
      setHasScreenAudio(audioTracks.length > 0);
      sound.playStreamStart();
    };

    webrtc.events.onRemoteScreenRemoved = () => {
      setRemoteScreenStream(null);
      setHasScreenAudio(false);
    };

    // Socket Room events
    socket.on('room-joined', (data) => {
      webrtc.setLocalSocketId(data.yourSocketId);
      // Strictly filter out self to guarantee no duplicate self tile
      const cleanParticipants = (data.participants || []).filter(
        (p: Participant) => p && p.socketId && p.socketId !== data.yourSocketId && p.socketId !== socket.id
      );
      setParticipants(cleanParticipants);
      setActiveScreenSharer(data.activeScreenSharer);
      setMessages(data.messages || []);
      sound.playJoin();

      // Connect to existing remote participants for webcam
      cleanParticipants.forEach((p: Participant) => {
        webrtc.initiateCamConnection(p.socketId);
      });

      // If someone is already streaming, request the stream from them!
      if (data.activeScreenSharer && data.activeScreenSharer.socketId !== data.yourSocketId) {
        console.log('📡 Requesting screen stream on room join from:', data.activeScreenSharer.socketId);
        socket.emit('request-screen-stream', {
          targetSocketId: data.activeScreenSharer.socketId,
        });
      }
    });

    socket.on('user-joined', (participant: any) => {
      const actualPeer: Participant = participant?.user || participant;
      if (!actualPeer || !actualPeer.socketId || actualPeer.socketId === socket.id || actualPeer.socketId === 'self') {
        return;
      }

      setParticipants((prev) => {
        if (prev.some((p) => p.socketId === actualPeer.socketId)) return prev;
        return [...prev, actualPeer];
      });
      sound.playJoin();
      // If we are currently sharing screen, send the stream to this new participant!
      const activeStream = webrtcRef.current?.localScreenStream || webrtc.localScreenStream;
      if (activeStream) {
        console.log('📡 Sending active screen stream to new participant:', actualPeer.socketId);
        webrtc.sendScreenStreamTo(actualPeer.socketId, activeStream);
      }

      // Ensure webcam/mic connection is bidirectional and active
      setTimeout(() => {
        const peer = webrtc.getCamPeer(actualPeer.socketId);
        if (!peer || (peer.connectionState !== 'connected' && peer.iceConnectionState !== 'connected')) {
          console.log('📡 Settle check: initiating cam connection to:', actualPeer.socketId);
          webrtc.initiateCamConnection(actualPeer.socketId);
        }
      }, 700);
    });

    // Screen stream requested by a peer (e.g. joined late or retried)
    socket.on('screen-stream-requested', ({ requesterSocketId }: { requesterSocketId: string }) => {
      const activeStream = webrtcRef.current?.localScreenStream || webrtc.localScreenStream;
      console.log('📡 Screen stream requested by:', requesterSocketId, 'hasStream:', !!activeStream);
      if (activeStream) {
        webrtc.sendScreenStreamTo(requesterSocketId, activeStream);
      }
    });

    socket.on('user-left', ({ socketId }: { socketId: string }) => {
      setParticipants((prev) => prev.filter((p) => p.socketId !== socketId));
      setRemoteCamStreams((prev) => {
        const next = new Map(prev);
        next.delete(socketId);
        return next;
      });
      if (activeScreenSharer?.socketId === socketId) {
        setActiveScreenSharer(null);
        setRemoteScreenStream(null);
        setHasScreenAudio(false);
      }
      webrtcRef.current?.closeCamPeer(socketId);
      webrtcRef.current?.closeScreenPeer(socketId);
      sound.playLeave();
    });

    socket.on('user-media-state', ({ socketId, isAudioMuted, isVideoMuted }) => {
      setParticipants((prev) =>
        prev.map((p) => (p.socketId === socketId ? { ...p, isAudioMuted, isVideoMuted } : p))
      );
    });

    socket.on('screen-share-started', (sharerInfo: ScreenSharerInfo) => {
      setActiveScreenSharer(sharerInfo);
      sound.playStreamStart();
      // Host already broadcasts to room; only request if not received after 1.5s grace period
      if (sharerInfo.socketId !== socket.id) {
        setTimeout(() => {
          socket.emit('request-screen-stream', {
            targetSocketId: sharerInfo.socketId,
          });
        }, 1500);
      }
    });

    socket.on('screen-share-stopped', () => {
      setActiveScreenSharer(null);
      setRemoteScreenStream(null);
      setHasScreenAudio(false);
    });

    socket.on('chat-message', (message: ChatMessage) => {
      setMessages((prev) => {
        if (prev.some((m) => m.id === message.id)) return prev;
        return [...prev, message];
      });
      if (message.senderId !== socket.id) {
        sound.playChirp();
        if (!isSidebarOpen || sidebarTab !== 'chat') {
          setUnreadMessages((count) => count + 1);
        }
      }
    });

    socket.on('reaction', (reaction: ReactionEvent) => {
      setReactions((prev) => [...prev, reaction]);
      sound.playPop();
    });

    socket.on('soundcheck-ping', ({ senderName }: { senderName: string }) => {
      sound.playTestChime();
      setSoundcheckToast(`🔔 ${senderName || 'A peer'} played an audio soundcheck chime!`);
      setTimeout(() => setSoundcheckToast(null), 3500);
    });

    socket.on('join-error', (err: any) => {
      console.warn('Socket join-error in room:', err);
      if (onJoinErrorRef.current) {
        onJoinErrorRef.current(err?.message || 'This invite link has expired because everyone has left the watch party.');
      }
    });

    // Start local camera & microphone with automatic fallback for single-device multi-tab testing
    const initLocalMedia = async () => {
      let audioStream: MediaStream | null = null;
      let videoTrack: MediaStreamTrack | null = null;

      try {
        const fullStream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        audioStream = fullStream;
        videoTrack = fullStream.getVideoTracks()[0] || null;
      } catch (err: any) {
        console.warn('[WatchPartyRoom] getUserMedia full error, trying fallback:', err?.name, err?.message);
        // Step 1: try acquiring audio separately (mics can be shared or accessed when camera is locked)
        try {
          audioStream = await navigator.mediaDevices.getUserMedia({
            audio: true,
          });
        } catch (audioErr) {
          console.warn('[WatchPartyRoom] Audio acquire error:', audioErr);
        }

        // Step 2: if camera hardware is locked by another tab on this PC (NotReadableError)
        // or user denied camera, generate animated virtual test camera feed
        videoTrack = createVirtualCameraTrack(displayName, avatar);
      }

      const activeTracks: MediaStreamTrack[] = [];
      if (audioStream) {
        audioStream.getAudioTracks().forEach((track) => {
          track.enabled = !initialAudioMuted;
          activeTracks.push(track);
        });
      }
      if (videoTrack) {
        videoTrack.enabled = !initialVideoMuted;
        activeTracks.push(videoTrack);
      }

      if (activeTracks.length > 0) {
        const compositeStream = new MediaStream(activeTracks);
        setLocalCamStream(compositeStream);
        webrtc.updateLocalCamStream(compositeStream);
      }
    };

    initLocalMedia();

    return () => {
      webrtc.destroy();
      socket.off('room-joined');
      socket.off('user-joined');
      socket.off('screen-stream-requested');
      socket.off('user-left');
      socket.off('user-media-state');
      socket.off('screen-share-started');
      socket.off('screen-share-stopped');
      socket.off('chat-message');
      socket.off('reaction');
      socket.off('soundcheck-ping');
      socket.off('join-error');
    };
  }, [socket, roomId]);

  // Attach screen stream to video player
  useEffect(() => {
    const video = screenVideoRef.current;
    if (!video) return;

    const streamToDisplay = isSharingScreen ? webrtcRef.current?.localScreenStream : remoteScreenStream;

    if (streamToDisplay) {
      video.srcObject = streamToDisplay;
      video.muted = true; // Always muted so browser autoplay NEVER blocks video frames
      video.play().catch((err) => {
        console.warn('Screen video play error:', err);
      });

      // Remote audio playback via screenAudioRef
      if (!isSharingScreen) {
        const audioTracks = streamToDisplay.getAudioTracks();
        const hasAudio = audioTracks.length > 0;
        setHasScreenAudio(hasAudio);

        if (screenAudioRef.current && hasAudio) {
          screenAudioRef.current.srcObject = streamToDisplay;
          screenAudioRef.current.volume = Math.min(1, streamVolume / 100);
          screenAudioRef.current.muted = isStreamMuted;
          screenAudioRef.current.play().catch((err) => {
            console.warn('Screen audio auto-play policy restriction:', err);
          });
        }
      }
    } else {
      video.srcObject = null;
      if (screenAudioRef.current) {
        screenAudioRef.current.srcObject = null;
      }
    }
  }, [isSharingScreen, remoteScreenStream, isStreamMuted, streamVolume]);

  // Adjust volume / boost when slider changes
  useEffect(() => {
    if (screenAudioRef.current) {
      screenAudioRef.current.volume = Math.min(1, streamVolume / 100);
      screenAudioRef.current.muted = isStreamMuted;
    }
  }, [streamVolume, isStreamMuted]);

  // Scroll chat to bottom
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Keyboard shortcuts (M: Mute, V: Video, S: Screen, Esc: Fullscreen)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const activeTag = (document.activeElement?.tagName || '').toLowerCase();
      if (activeTag === 'input' || activeTag === 'textarea') return;

      if (e.key === 'm' || e.key === 'M') {
        toggleMic();
      } else if (e.key === 'v' || e.key === 'V') {
        toggleCam();
      } else if (e.key === 's' || e.key === 'S') {
        if (!isSharingScreen) {
          setIsGuideOpen(true);
        } else {
          stopScreenShare();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSharingScreen, isAudioMuted, isVideoMuted]);

  // Media Controls: Mic
  const toggleMic = () => {
    if (localCamStream) {
      const tracks = localCamStream.getAudioTracks();
      const nextState = !isAudioMuted;
      tracks.forEach((t) => {
        t.enabled = !nextState;
      });
      setIsAudioMuted(nextState);
      socket.emit('media-state-change', {
        isAudioMuted: nextState,
        isVideoMuted,
      });
    }
  };

  // Media Controls: Cam
  const toggleCam = () => {
    if (localCamStream) {
      const tracks = localCamStream.getVideoTracks();
      const nextState = !isVideoMuted;
      tracks.forEach((t) => {
        t.enabled = !nextState;
      });
      setIsVideoMuted(nextState);
      socket.emit('media-state-change', {
        isAudioMuted,
        isVideoMuted: nextState,
      });
    }
  };

  // Screen Sharing Start
  const startScreenShare = async () => {
    try {
      // Prompt with full resolution constraints for crystal clear text and stereo tab audio
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          displaySurface: 'browser',
          width: { ideal: 3840, max: 3840 },
          height: { ideal: 2160, max: 2160 },
          frameRate: { ideal: 60, max: 60 },
        },
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
          channelCount: 2,
        },
      });

      const audioTracks = stream.getAudioTracks();
      setHasScreenAudio(audioTracks.length > 0);

      // Listen for when user clicks native "Stop Sharing" button
      stream.getVideoTracks()[0].onended = () => {
        stopScreenShare();
      };

      setIsSharingScreen(true);
      setIsPlayingDemoReel(false);

      if (webrtcRef.current) {
        webrtcRef.current.localScreenStream = stream;
      }

      // Broadcast to room
      const participantIds = participants.map((p) => p.socketId);
      webrtcRef.current?.broadcastScreenShare(stream, participantIds);
      socket.emit('screen-share-start');
    } catch (err) {
      console.warn('Screen share canceled or failed:', err);
    }
  };

  // Stop screen sharing
  const stopScreenShare = () => {
    if (demoIntervalRef.current) {
      clearInterval(demoIntervalRef.current);
      demoIntervalRef.current = null;
    }
    if (demoSynthTimerRef.current) {
      clearInterval(demoSynthTimerRef.current);
      demoSynthTimerRef.current = null;
    }
    if (demoAudioCtxRef.current) {
      demoAudioCtxRef.current.close().catch(() => {});
      demoAudioCtxRef.current = null;
    }
    setIsPlayingDemoReel(false);

    webrtcRef.current?.stopAllScreenShares();
    setIsSharingScreen(false);
    setHasScreenAudio(false);
    socket.emit('screen-share-stop');
  };

  // Test Demo Reel Player Mode (guaranteed self-contained canvas & synth audio)
  const toggleDemoReel = () => {
    if (isPlayingDemoReel) {
      stopScreenShare();
    } else {
      setIsPlayingDemoReel(true);

      // Create high-res 1280x720 canvas
      const canvas = document.createElement('canvas');
      canvas.width = 1280;
      canvas.height = 720;
      const ctx = canvas.getContext('2d')!;

      // Setup audio synthesizer stream
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      demoAudioCtxRef.current = audioCtx;
      const dest = audioCtx.createMediaStreamDestination();

      const freqs = [261.63, 329.63, 392.00, 523.25]; // C-major chord arpeggios
      let noteIndex = 0;
      demoSynthTimerRef.current = window.setInterval(() => {
        try {
          if (audioCtx.state === 'suspended') audioCtx.resume();
          const osc = audioCtx.createOscillator();
          const gain = audioCtx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.value = freqs[noteIndex % freqs.length];
          noteIndex++;

          gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.35);

          osc.connect(gain);
          gain.connect(dest);
          gain.connect(audioCtx.destination);
          osc.start();
          osc.stop(audioCtx.currentTime + 0.36);
        } catch {
          // ignore
        }
      }, 400);

      // Animation loop
      let frame = 0;
      demoIntervalRef.current = window.setInterval(() => {
        frame++;
        const timeStr = new Date().toLocaleTimeString();

        // Background
        const grad = ctx.createLinearGradient(0, 0, 1280, 720);
        grad.addColorStop(0, '#09090b');
        grad.addColorStop(1, '#18181b');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 1280, 720);

        // Cinema Grid
        ctx.strokeStyle = 'rgba(244, 63, 94, 0.15)';
        ctx.lineWidth = 1;
        for (let x = 0; x < 1280; x += 64) {
          ctx.beginPath();
          ctx.moveTo(x, 0);
          ctx.lineTo(x, 720);
          ctx.stroke();
        }
        for (let y = 0; y < 720; y += 64) {
          ctx.beginPath();
          ctx.moveTo(0, y);
          ctx.lineTo(1280, y);
          ctx.stroke();
        }

        // Animated neon circles & equalizer
        ctx.save();
        ctx.translate(640, 360);
        const radius = 180 + Math.sin(frame * 0.08) * 30;
        ctx.strokeStyle = '#f43f5e';
        ctx.lineWidth = 6;
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 30;
        ctx.beginPath();
        ctx.arc(0, 0, radius, 0, Math.PI * 2);
        ctx.stroke();

        // Pulsing equalizer bars
        const numBars = 32;
        for (let i = 0; i < numBars; i++) {
          const angle = (i / numBars) * Math.PI * 2 + frame * 0.02;
          const barHeight = 40 + Math.sin(frame * 0.15 + i) * 35;
          const x1 = Math.cos(angle) * (radius + 15);
          const y1 = Math.sin(angle) * (radius + 15);
          const x2 = Math.cos(angle) * (radius + 15 + barHeight);
          const y2 = Math.sin(angle) * (radius + 15 + barHeight);

          ctx.strokeStyle = i % 2 === 0 ? '#fbbf24' : '#f43f5e';
          ctx.lineWidth = 4;
          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
        ctx.restore();

        // Titles
        ctx.font = 'bold 44px sans-serif';
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('🎬 SYNSTREAM CINEMA DEMO', 640, 330);

        ctx.font = '600 24px monospace';
        ctx.fillStyle = '#f43f5e';
        ctx.fillText('LIVE PEER-TO-PEER VIDEO & AUDIO SYNC', 640, 380);

        ctx.font = '18px monospace';
        ctx.fillStyle = '#a1a1aa';
        ctx.fillText(`FRAME #${frame} • TIME: ${timeStr} • STEREO AUDIO 44.1kHz`, 640, 440);
      }, 1000 / 30);

      const stream = canvas.captureStream(30);
      dest.stream.getAudioTracks().forEach((track) => stream.addTrack(track));

      setIsSharingScreen(true);
      if (webrtcRef.current) {
        webrtcRef.current.localScreenStream = stream;
      }

      const participantIds = participants.map((p) => p.socketId);
      webrtcRef.current?.broadcastScreenShare(stream, participantIds);
      socket.emit('screen-share-start');
    }
  };

  // Send Chat message
  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    socket.emit('chat-message', { text: chatInput.trim() });
    setChatInput('');
  };

  // Send Floating Reaction
  const handleSendReaction = (emoji: string) => {
    socket.emit('send-reaction', { emoji });
    sound.playPop();
  };

  // Copy Invite Link
  const handleCopyInviteLink = () => {
    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const inviteUrl = `${baseUrl}?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2500);
  };

  // Toggle Picture-in-Picture
  const handleTogglePiP = async () => {
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (screenVideoRef.current) {
        await screenVideoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP not supported or disallowed:', err);
    }
  };

  // Toggle Fullscreen
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      stageContainerRef.current?.requestFullscreen?.().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Leave Watch Party cleanly
  const handleLeaveParty = () => {
    if (localCamStream) {
      localCamStream.getTracks().forEach((t) => t.stop());
    }
    if (isSharingScreen) {
      stopScreenShare();
    }
    socket.emit('leave-room');
    webrtcRef.current?.destroy();
    onLeaveRoom();
  };

  // Trigger Soundcheck Tone across party
  const handleTriggerSoundcheck = () => {
    sound.playTestChime();
    socket.emit('soundcheck-ping', { senderName: displayName });
    setSoundcheckToast('🔔 Playing audio soundcheck chime across the room...');
    setTimeout(() => setSoundcheckToast(null), 3000);
  };

  const selfParticipant: Participant = {
    socketId: socket.id || 'self',
    displayName,
    avatar,
    isAudioMuted,
    isVideoMuted,
    isSharingScreen,
    isHost,
    joinedAt: Date.now(),
  };

  // Strictly filter out self and deduplicate remote peers by socketId
  const uniqueRemotePeers = participants.filter(
    (p, index, self) =>
      p &&
      p.socketId &&
      p.socketId !== selfParticipant.socketId &&
      p.socketId !== socket.id &&
      self.findIndex((other) => other.socketId === p.socketId) === index
  );
  const allPeers = [selfParticipant, ...uniqueRemotePeers];
  const hasActiveStream = isSharingScreen || !!remoteScreenStream || !!activeScreenSharer;

  return (
    <div className="min-h-screen h-screen flex flex-col bg-zinc-950 text-zinc-100 overflow-hidden select-none font-['Plus_Jakarta_Sans']">
      {/* Floating Reaction Layer */}
      <ReactionFloatingLayer reactions={reactions} />

      {/* Soundcheck Notification Toast */}
      {soundcheckToast && (
        <div className="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2 rounded-xl bg-amber-400 text-black font-bold text-xs shadow-xl backdrop-blur-md flex items-center gap-2 animate-bounce">
          <span>{soundcheckToast}</span>
        </div>
      )}

      {/* Screen Share Audio Guide Modal */}
      <ScreenShareGuideModal
        isOpen={isGuideOpen}
        onClose={() => setIsGuideOpen(false)}
        onStartShare={startScreenShare}
      />

      {/* Top Navigation Bar */}
      <header className="h-14 px-4 bg-zinc-950/90 border-b border-zinc-800/80 flex items-center justify-between shrink-0 z-20 backdrop-blur-md">
        {/* Brand & Room Info */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-500/20">
              <Film className="w-4 h-4" />
            </div>
            <span className="font-extrabold text-base tracking-tight hidden sm:inline">
              Sync<span className="text-rose-400">Stream</span>
            </span>
          </div>

          <div className="h-4 w-px bg-zinc-800 mx-1" />

          {/* Room ID Badge & Copy Invite Link */}
          <div className="flex items-center gap-1.5 bg-zinc-900 border border-zinc-800 rounded-xl px-2.5 py-1">
            <span className="text-xs text-zinc-400">Room:</span>
            <span className="text-xs font-mono font-bold text-rose-400">{roomId}</span>
            <button
              onClick={handleCopyInviteLink}
              title="Copy shareable invite link (friends bypass secret passcode)"
              className="flex items-center gap-1 ml-1 px-1.5 py-0.5 rounded-md bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-[11px] font-medium transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <>
                  <Check className="w-3 h-3 text-emerald-400" />
                  <span className="text-emerald-400">Copied!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3" />
                  <span className="hidden sm:inline">Invite Link</span>
                </>
              )}
            </button>
            <a
              href={`${window.location.href.split('?')[0].split('#')[0]}?room=${encodeURIComponent(roomId)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/20 hover:bg-rose-500/30 text-rose-300 border border-rose-500/30 text-[11px] font-semibold transition-colors"
              title="Open a 2nd user tab to test watch party peer-to-peer"
            >
              <span>+ Test 2nd User</span>
            </a>
            <button
              onClick={handleTriggerSoundcheck}
              className="hidden sm:flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-[11px] font-semibold transition-colors cursor-pointer"
              title="Test audio chime across all participants to verify speakers"
            >
              <Volume2 className="w-3 h-3 text-amber-400" />
              <span>Soundcheck</span>
            </button>
          </div>

          {/* Live Indicator */}
          <div className="hidden lg:flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            <span>{allPeers.length} in Party</span>
          </div>
        </div>

        {/* Center / Right Stream Controls */}
        <div className="flex items-center gap-2 sm:gap-3">
          {/* Master Stream Volume Booster (Up to 200%) */}
          {hasActiveStream && (
            <div className="hidden md:flex items-center gap-2 bg-zinc-900 border border-zinc-800 rounded-xl px-3 py-1 text-xs">
              <button
                onClick={() => setIsStreamMuted(!isStreamMuted)}
                className="text-zinc-400 hover:text-white transition-colors cursor-pointer"
                title={isStreamMuted ? 'Unmute stream audio' : 'Mute stream audio'}
              >
                {isStreamMuted ? (
                  <VolumeX className="w-3.5 h-3.5 text-rose-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-zinc-300" />
                )}
              </button>
              <input
                type="range"
                min="0"
                max="200"
                value={isStreamMuted ? 0 : streamVolume}
                onChange={(e) => {
                  setStreamVolume(parseInt(e.target.value, 10));
                  if (isStreamMuted) setIsStreamMuted(false);
                }}
                className="w-16 accent-rose-500 cursor-pointer"
                title={`Stream Volume: ${streamVolume}%`}
              />
              <span className="text-[11px] font-mono text-zinc-400 min-w-[36px]">
                {streamVolume}%
              </span>
              {streamVolume > 100 && (
                <span className="text-[10px] font-bold text-amber-400 px-1 rounded bg-amber-400/10">
                  BOOST
                </span>
              )}
            </div>
          )}


          {/* Audio Setup Guide Helper */}
          <button
            onClick={() => setIsGuideOpen(true)}
            className="p-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Tab Audio & DRM Streaming Guide"
          >
            <HelpCircle className="w-4 h-4 text-amber-400" />
          </button>

          {/* Toggle Sidebar (Chat / Participants) */}
          <button
            onClick={() => {
              setIsSidebarOpen(!isSidebarOpen);
              if (!isSidebarOpen) setUnreadMessages(0);
            }}
            className={`relative p-2 rounded-xl border transition-all cursor-pointer ${
              isSidebarOpen
                ? 'bg-rose-500/10 border-rose-500/30 text-rose-400'
                : 'bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-white'
            }`}
            title="Toggle Chat & Participants"
          >
            <MessageSquare className="w-4 h-4" />
            {unreadMessages > 0 && !isSidebarOpen && (
              <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-rose-500 text-white text-[10px] font-bold flex items-center justify-center animate-bounce">
                {unreadMessages}
              </span>
            )}
          </button>

          {/* Leave Room Button */}
          <button
            onClick={handleLeaveParty}
            className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/30 text-xs font-semibold transition-colors cursor-pointer"
          >
            <PhoneOff className="w-3.5 h-3.5" />
            <span className="hidden md:inline">Leave</span>
          </button>
        </div>
      </header>

      {/* Main Body: Stage Area + Collapsible Sidebar */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* Stage Area */}
        <div
          ref={stageContainerRef}
          className="flex-1 flex flex-col bg-zinc-950 overflow-hidden relative"
        >
          {/* Main Video Stage */}
          <div className="flex-1 flex items-center justify-center p-3 md:p-6 overflow-hidden relative">
            {hasActiveStream ? (
              <div className="relative w-full h-full max-w-7xl max-h-[82vh] flex items-center justify-center group rounded-3xl overflow-hidden bg-black border border-zinc-800/80 shadow-2xl">
                {/* Ambient glow behind screen */}
                <div className="absolute inset-0 bg-rose-500/10 filter blur-3xl -z-10 pointer-events-none" />

                {/* Remote stream audio element */}
                <audio ref={screenAudioRef} autoPlay playsInline />

                {/* Video element - muted is critical so browser Autoplay Policy never blocks video rendering */}
                <video
                  ref={screenVideoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-contain bg-black [image-rendering:-webkit-optimize-contrast]"
                />

                {/* Connecting state when sharer is active but WebRTC stream is handshake-syncing */}
                {!isSharingScreen && !remoteScreenStream && activeScreenSharer && (
                  <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 text-zinc-300 p-6 z-10">
                    <div className="w-12 h-12 border-3 border-rose-500/30 border-t-rose-500 rounded-full animate-spin mb-4" />
                    <h4 className="text-base font-bold text-white mb-1">
                      Connecting to {activeScreenSharer.displayName}&apos;s Screen Stream...
                    </h4>
                    <p className="text-xs text-zinc-400 mb-4 text-center max-w-sm">
                      Establishing direct WebRTC peer connection with audio.
                    </p>
                    <button
                      onClick={() => {
                        socket.emit('request-screen-stream', { targetSocketId: activeScreenSharer.socketId });
                      }}
                      className="px-4 py-2 rounded-xl bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white text-xs font-bold shadow-lg shadow-rose-500/20 transition-all cursor-pointer"
                    >
                      Sync Stream Now
                    </button>
                  </div>
                )}

                {/* Top overlay badges on hover */}
                <div className="absolute top-4 inset-x-4 flex items-center justify-between opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20 pointer-events-none">
                  <div className="flex items-center gap-2 pointer-events-auto">
                    <span className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-xs font-semibold text-rose-400 border border-rose-500/30 flex items-center gap-1.5">
                      <Radio className="w-3 h-3 text-rose-500 animate-pulse" />
                      <span>
                        {isSharingScreen
                          ? 'You are sharing'
                          : `${activeScreenSharer?.displayName || 'Peer'} is streaming`}
                      </span>
                    </span>

                    {hasScreenAudio && (
                      <span className="px-2.5 py-1 rounded-full bg-black/70 backdrop-blur-md text-xs font-semibold text-emerald-400 border border-emerald-500/30 flex items-center gap-1.5">
                        <Volume2 className="w-3 h-3" />
                        <span>Tab Audio Active</span>
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2 pointer-events-auto">
                    {/* Picture in Picture */}
                    <button
                      onClick={handleTogglePiP}
                      className="p-2 rounded-xl bg-black/70 backdrop-blur-md text-zinc-300 hover:text-white border border-white/10 hover:border-white/20 transition-all cursor-pointer"
                      title="Picture-in-Picture"
                    >
                      <PictureInPicture className="w-4 h-4" />
                    </button>

                    {/* Fullscreen Video */}
                    <button
                      onClick={handleToggleFullscreen}
                      className="p-2 rounded-xl bg-black/70 backdrop-blur-md text-zinc-300 hover:text-white border border-white/10 hover:border-white/20 transition-all cursor-pointer"
                      title="Toggle Fullscreen"
                    >
                      {isFullscreen ? (
                        <Minimize2 className="w-4 h-4" />
                      ) : (
                        <Maximize2 className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                </div>

                {/* Bottom floating stop share button for current host/sharer */}
                {isSharingScreen && (
                  <div className="absolute bottom-4 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-20">
                    <button
                      onClick={stopScreenShare}
                      className="px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-lg shadow-rose-600/30 flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
                    >
                      <MonitorOff className="w-4 h-4" />
                      <span>Stop Screen Sharing</span>
                    </button>
                  </div>
                )}
              </div>
            ) : (
              /* No Screen Active - Theater Lounge Stage */
              <div className="w-full max-w-2xl text-center p-8 rounded-3xl bg-zinc-900/40 border border-zinc-800/80 backdrop-blur-sm relative overflow-hidden">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-80 h-80 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

                <div className="relative z-10">
                  <div className="w-16 h-16 rounded-3xl bg-zinc-800/90 border border-zinc-700/60 flex items-center justify-center mx-auto mb-4 text-rose-400 shadow-xl">
                    <Tv className="w-8 h-8" />
                  </div>

                  <h2 className="text-2xl font-bold text-white mb-2">Ready for Showtime</h2>
                  <p className="text-xs text-zinc-400 max-w-md mx-auto mb-6 leading-relaxed">
                    Start sharing your browser tab with Netflix, YouTube, or Prime Video. Don&rsquo;t forget to tick <strong>&ldquo;Also share tab audio&rdquo;</strong> in the browser prompt!
                  </p>

                  {/* Primary & Demo Action Buttons */}
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <button
                      onClick={() => setIsGuideOpen(true)}
                      className="px-5 py-3 rounded-xl font-bold text-xs bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white shadow-lg shadow-rose-500/25 flex items-center gap-2 transition-all active:scale-95 cursor-pointer"
                    >
                      <Monitor className="w-4 h-4" />
                      <span>Share Screen with Sound</span>
                    </button>

                    <button
                      onClick={toggleDemoReel}
                      className="px-4 py-3 rounded-xl font-semibold text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700/60 flex items-center gap-2 transition-colors cursor-pointer"
                    >
                      <Film className="w-4 h-4 text-amber-400" />
                      <span>{isPlayingDemoReel ? 'Stop Test Cinema' : 'Stream Test Reel (Trailer)'}</span>
                    </button>
                  </div>

                  {/* Quick Tips */}
                  <div className="mt-8 pt-6 border-t border-zinc-800/60 grid grid-cols-3 gap-2 text-left">
                    <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                      <div className="text-[11px] font-semibold text-zinc-300">1. Select Tab</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Pick the Netflix or YouTube tab</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                      <div className="text-[11px] font-semibold text-zinc-300">2. Share Audio</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Check the tab audio toggle</div>
                    </div>
                    <div className="p-2.5 rounded-xl bg-zinc-950/60 border border-zinc-800/60">
                      <div className="text-[11px] font-semibold text-zinc-300">3. Sync & Enjoy</div>
                      <div className="text-[10px] text-zinc-500 mt-0.5">Laugh, react, and watch together</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Docked Participant Cameras Strip */}
          <div className="px-4 pb-3 flex items-center gap-3 overflow-x-auto scrollbar-none shrink-0 z-10">
            {allPeers.map((peer) => {
              const stream =
                peer.socketId === selfParticipant.socketId
                  ? localCamStream
                  : remoteCamStreams.get(peer.socketId) || null;

              return (
                <ParticipantTile
                  key={peer.socketId}
                  participant={peer}
                  isSelf={peer.socketId === selfParticipant.socketId}
                  stream={stream}
                  compact
                />
              );
            })}
          </div>
        </div>

        {/* Collapsible Sidebar: Live Chat, Participants, Audio Guide */}
        {isSidebarOpen && (
          <aside className="w-80 md:w-88 bg-zinc-900 border-l border-zinc-800 flex flex-col shrink-0 z-20 shadow-xl">
            {/* Sidebar Tabs */}
            <div className="flex border-b border-zinc-800 bg-zinc-950/60 p-1.5 gap-1 text-xs">
              <button
                onClick={() => {
                  setSidebarTab('chat');
                  setUnreadMessages(0);
                }}
                className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sidebarTab === 'chat'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5" />
                <span>Chat</span>
              </button>

              <button
                onClick={() => setSidebarTab('peers')}
                className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sidebarTab === 'peers'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <Users className="w-3.5 h-3.5" />
                <span>Party ({allPeers.length})</span>
              </button>

              <button
                onClick={() => setSidebarTab('guide')}
                className={`flex-1 py-1.5 rounded-lg font-semibold flex items-center justify-center gap-1.5 transition-all cursor-pointer ${
                  sidebarTab === 'guide'
                    ? 'bg-zinc-800 text-white shadow-sm'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                <HelpCircle className="w-3.5 h-3.5" />
                <span>Guide</span>
              </button>
            </div>

            {/* Tab 1: Live Chat */}
            {sidebarTab === 'chat' && (
              <div className="flex-1 flex flex-col overflow-hidden">
                {/* Messages Feed */}
                <div className="flex-1 p-3 overflow-y-auto space-y-3">
                  {messages.map((msg) => {
                    if (msg.isSystem) {
                      return (
                        <div
                          key={msg.id}
                          className="text-center my-1 px-3 py-1 rounded-full bg-zinc-950/60 border border-zinc-800 text-[11px] text-zinc-400 font-medium"
                        >
                          {msg.text}
                        </div>
                      );
                    }

                    const isMe = msg.senderId === socket.id;
                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex items-center gap-1.5 mb-0.5 text-[10px] text-zinc-500 font-medium">
                          <span>{msg.senderName}</span>
                          <span>•</span>
                          <span>
                            {new Date(msg.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </div>
                        <div
                          className={`px-3 py-2 rounded-2xl text-xs max-w-[85%] break-words leading-relaxed ${
                            isMe
                              ? 'bg-rose-500 text-white rounded-tr-none'
                              : 'bg-zinc-800 text-zinc-100 rounded-tl-none border border-zinc-700/50'
                          }`}
                        >
                          {msg.text}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={chatBottomRef} />
                </div>

                {/* Quick Emoji Reaction Pill Bar inside Chat */}
                <div className="px-3 py-1.5 border-t border-zinc-800/80 bg-zinc-950/40 flex items-center justify-around">
                  {['🍿', '🔥', '❤️', '😂', '👏', '🎉', '😱'].map((emoji) => (
                    <button
                      key={emoji}
                      onClick={() => handleSendReaction(emoji)}
                      className="hover:scale-125 transition-transform p-1 text-base cursor-pointer"
                      title={`Send ${emoji} reaction`}
                    >
                      {emoji}
                    </button>
                  ))}
                </div>

                {/* Chat Input */}
                <form
                  onSubmit={handleSendMessage}
                  className="p-3 border-t border-zinc-800 bg-zinc-950 flex items-center gap-2"
                >
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="Type a message to the party..."
                    className="flex-1 px-3 py-2 rounded-xl bg-zinc-900 border border-zinc-800 text-xs text-white placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                  />
                  <button
                    type="submit"
                    className="p-2 rounded-xl bg-rose-500 hover:bg-rose-600 text-white transition-colors cursor-pointer"
                    title="Send message"
                  >
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            )}

            {/* Tab 2: Party Participants */}
            {sidebarTab === 'peers' && (
              <div className="flex-1 p-3 overflow-y-auto space-y-2">
                <div className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider mb-2">
                  Connected Friends ({allPeers.length})
                </div>

                {allPeers.map((peer) => (
                  <div
                    key={peer.socketId}
                    className="p-2.5 rounded-xl bg-zinc-950/80 border border-zinc-800/80 flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-full bg-zinc-900 border border-zinc-700/60 flex items-center justify-center text-sm shadow-inner">
                        {peer.avatar || '🍿'}
                      </div>
                      <div>
                        <div className="text-xs font-semibold text-zinc-200 flex items-center gap-1.5">
                          <span>{peer.displayName}</span>
                          {peer.socketId === selfParticipant.socketId && (
                            <span className="text-[10px] text-zinc-400">(You)</span>
                          )}
                          {peer.isHost && (
                            <span className="text-[10px] text-amber-400 font-bold">★ Host</span>
                          )}
                        </div>
                        <div className="text-[10px] text-zinc-500">
                          {peer.isSharingScreen ? 'Streaming Screen' : 'Watching'}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 text-zinc-400">
                      {peer.isAudioMuted ? (
                        <MicOff className="w-3.5 h-3.5 text-rose-400" />
                      ) : (
                        <Mic className="w-3.5 h-3.5 text-emerald-400" />
                      )}
                      {peer.isVideoMuted ? (
                        <VideoOff className="w-3.5 h-3.5 text-zinc-500" />
                      ) : (
                        <Video className="w-3.5 h-3.5 text-zinc-300" />
                      )}
                    </div>
                  </div>
                ))}

                {/* Invite Link Card */}
                <div className="mt-4 p-3 rounded-2xl bg-zinc-950 border border-zinc-800 space-y-2">
                  <div className="text-xs font-semibold text-zinc-300 flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-rose-400" />
                    <span>Invite More Friends</span>
                  </div>
                  <p className="text-[11px] text-zinc-400">
                    Friends who join with this link skip the secret code automatically.
                  </p>
                  <button
                    onClick={handleCopyInviteLink}
                    className="w-full py-2 px-3 rounded-xl bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-zinc-200 border border-zinc-700 flex items-center justify-center gap-2 transition-colors cursor-pointer"
                  >
                    {copiedLink ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-emerald-400">Invite Link Copied!</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Shareable Link</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Tab 3: Streaming Guide */}
            {sidebarTab === 'guide' && (
              <div className="flex-1 p-4 overflow-y-auto space-y-4 text-xs text-zinc-300">
                <div className="font-bold text-white text-sm">Streaming Guide</div>

                <div className="space-y-1.5 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="font-semibold text-rose-300 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Netflix & YouTube Audio</span>
                  </div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Always select the <strong>&ldquo;Chrome Tab&rdquo;</strong> option in the share prompt and check <strong>&ldquo;Also share tab audio&rdquo;</strong>.
                  </p>
                </div>

                <div className="space-y-1.5 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="font-semibold text-amber-300">DRM Black Screen Fix</div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    If Netflix, Prime Video, or Disney+ streams a black screen with audio, go to:
                    <br />
                    <code className="text-[10px] text-zinc-300 font-mono">Chrome Settings &gt; System &gt; Turn OFF &quot;Use graphics acceleration&quot;</code>.
                  </p>
                </div>

                <div className="space-y-1.5 p-3 rounded-xl bg-zinc-950 border border-zinc-800">
                  <div className="font-semibold text-sky-300">Audio Boost Feature</div>
                  <p className="text-[11px] text-zinc-400 leading-relaxed">
                    Quiet movie? Use the master volume slider in the top bar to amplify audio up to <strong>200%</strong> with our built-in Web Audio gain booster!
                  </p>
                </div>
              </div>
            )}
          </aside>
        )}
      </div>

      {/* Bottom Media Control Dock */}
      <footer className="h-16 bg-zinc-950 border-t border-zinc-800/80 px-4 flex items-center justify-between shrink-0 z-20">
        {/* Left: Quick shortcuts / Status */}
        <div className="hidden lg:flex items-center gap-3 text-xs text-zinc-500">
          <span>Shortcuts:</span>
          <span className="bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 font-mono text-[10px]">
            M (Mute)
          </span>
          <span className="bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 font-mono text-[10px]">
            V (Video)
          </span>
          <span className="bg-zinc-900 border border-zinc-800 px-1.5 py-0.5 rounded text-zinc-400 font-mono text-[10px]">
            S (Screen)
          </span>
        </div>

        {/* Center: Main Media Buttons */}
        <div className="flex items-center gap-3 mx-auto lg:mx-0">
          {/* Mic Toggle */}
          <button
            onClick={toggleMic}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
              !isAudioMuted
                ? 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            }`}
            title={isAudioMuted ? 'Unmute microphone (M)' : 'Mute microphone (M)'}
          >
            {!isAudioMuted ? <Mic className="w-4 h-4 text-emerald-400" /> : <MicOff className="w-4 h-4" />}
            <span className="hidden sm:inline">{!isAudioMuted ? 'Mute' : 'Unmuted'}</span>
          </button>

          {/* Cam Toggle */}
          <button
            onClick={toggleCam}
            className={`flex items-center gap-2 px-3.5 py-2.5 rounded-2xl text-xs font-semibold transition-all cursor-pointer ${
              !isVideoMuted
                ? 'bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700'
                : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
            }`}
            title={isVideoMuted ? 'Turn on camera (V)' : 'Turn off camera (V)'}
          >
            {!isVideoMuted ? <Video className="w-4 h-4 text-zinc-200" /> : <VideoOff className="w-4 h-4" />}
            <span className="hidden sm:inline">{!isVideoMuted ? 'Stop Cam' : 'Start Cam'}</span>
          </button>

          {/* Soundcheck / Test Audio Button */}
          <button
            onClick={handleTriggerSoundcheck}
            className="flex items-center gap-2 px-3.5 py-2.5 rounded-2xl bg-zinc-800 hover:bg-zinc-700 text-amber-300 border border-amber-500/30 text-xs font-semibold transition-all cursor-pointer shadow-sm active:scale-95"
            title="Play soundcheck chime on all devices to verify room audio and speakers"
          >
            <Volume2 className="w-4 h-4 text-amber-400" />
            <span className="hidden sm:inline">Soundcheck</span>
          </button>

          {/* Screen Share Toggle */}
          <button
            onClick={() => {
              if (isSharingScreen) {
                stopScreenShare();
              } else {
                setIsGuideOpen(true);
              }
            }}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
              isSharingScreen
                ? 'bg-rose-600 hover:bg-rose-700 text-white shadow-rose-600/30'
                : 'bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 text-white shadow-rose-500/20'
            }`}
            title={isSharingScreen ? 'Stop screen sharing (S)' : 'Share screen with tab audio (S)'}
          >
            {isSharingScreen ? <MonitorOff className="w-4 h-4" /> : <Monitor className="w-4 h-4" />}
            <span>{isSharingScreen ? 'Stop Screen' : 'Share Screen'}</span>
          </button>

          {/* Quick Reaction soundboard trigger buttons */}
          <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-2xl p-1">
            {['🍿', '🔥', '❤️', '😂', '👏'].map((emoji) => (
              <button
                key={emoji}
                onClick={() => handleSendReaction(emoji)}
                className="w-8 h-8 rounded-xl hover:bg-zinc-800 flex items-center justify-center text-sm transition-transform active:scale-125 cursor-pointer"
                title={`React with ${emoji}`}
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>

        {/* Right: Quick Invite & Layout */}
        <div className="hidden lg:flex items-center gap-2">
          <button
            onClick={handleCopyInviteLink}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 transition-colors cursor-pointer"
          >
            {copiedLink ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5 text-zinc-400" />
            )}
            <span>{copiedLink ? 'Link Copied!' : 'Copy Invite'}</span>
          </button>
        </div>
      </footer>
    </div>
  );
};

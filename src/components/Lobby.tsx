import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Film,
  Sparkles,
  ArrowRight,
  Tv,
  Users,
  Copy,
  Check,
  Share2,
  Info,
  Lock,
} from 'lucide-react';

interface LobbyProps {
  initialRoomId?: string;
  isInviteLink?: boolean;
  hasPasscode?: boolean;
  onJoinRoom: (params: {
    roomId: string;
    displayName: string;
    avatar: string;
    isAudioMuted: boolean;
    isVideoMuted: boolean;
    isHost: boolean;
  }) => void;
  onBackToGate?: () => void;
}

const AVATAR_OPTIONS = ['🍿', '🎬', '🍕', '🚀', '🕶️', '🐱', '🎧', '⚡', '🦊', '🥤', '👾', '🔥'];

const DEFAULT_NAMES = [
  'PopcornLover',
  'Cinephile',
  'MoviePilot',
  'NightOwl',
  'StreamChamp',
  'ScreenWatcher',
];

export const Lobby: React.FC<LobbyProps> = ({
  initialRoomId = '',
  isInviteLink = false,
  hasPasscode = false,
  onJoinRoom,
  onBackToGate,
}) => {
  const [roomId, setRoomId] = useState(
    initialRoomId || (hasPasscode ? `party-${Math.random().toString(36).substring(2, 6)}` : '')
  );
  const [isCreatingNew, setIsCreatingNew] = useState(hasPasscode && !initialRoomId);
  const [displayName, setDisplayName] = useState(() => {
    return (
      localStorage.getItem('syncstream_name') ||
      DEFAULT_NAMES[Math.floor(Math.random() * DEFAULT_NAMES.length)]
    );
  });
  const [avatar, setAvatar] = useState(() => {
    return localStorage.getItem('syncstream_avatar') || '🍿';
  });

  const [isMicEnabled, setIsMicEnabled] = useState(true);
  const [isCamEnabled, setIsCamEnabled] = useState(true);
  const [audioLevel, setAudioLevel] = useState(0);
  const [hasMediaPermission, setHasMediaPermission] = useState<boolean | null>(null);
  const [copiedLink, setCopiedLink] = useState(false);

  const videoPreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  // Setup media preview
  useEffect(() => {
    let isMounted = true;

    async function initMedia() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });

        if (!isMounted) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }

        streamRef.current = stream;
        setHasMediaPermission(true);

        if (videoPreviewRef.current) {
          videoPreviewRef.current.srcObject = stream;
        }

        // Setup audio level meter
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          audioContextRef.current = ctx;
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 64;
          analyserRef.current = analyser;

          const source = ctx.createMediaStreamSource(stream);
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioLevel = () => {
            if (!analyserRef.current) return;
            analyserRef.current.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            setAudioLevel(Math.min(100, Math.round((average / 128) * 100)));
            animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
          };
          updateAudioLevel();
        }
      } catch (err) {
        console.warn('Could not access cam/mic for preview:', err);
        setHasMediaPermission(false);
      }
    }

    initMedia();

    return () => {
      isMounted = false;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (audioContextRef.current) {
        audioContextRef.current.close().catch(() => {});
      }
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, []);

  const toggleMic = () => {
    if (streamRef.current) {
      const audioTracks = streamRef.current.getAudioTracks();
      audioTracks.forEach((track) => {
        track.enabled = !isMicEnabled;
      });
    }
    setIsMicEnabled(!isMicEnabled);
  };

  const toggleCam = () => {
    if (streamRef.current) {
      const videoTracks = streamRef.current.getVideoTracks();
      videoTracks.forEach((track) => {
        track.enabled = !isCamEnabled;
      });
    }
    setIsCamEnabled(!isCamEnabled);
  };

  const handleJoin = (e: React.FormEvent) => {
    e.preventDefault();
    const finalRoomId = roomId.trim() || `room-${Date.now()}`;
    const finalName = displayName.trim() || 'WatchParty Guest';

    localStorage.setItem('syncstream_name', finalName);
    localStorage.setItem('syncstream_avatar', avatar);

    // Stop lobby preview tracks so the room can take over cleanly
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
    }

    onJoinRoom({
      roomId: finalRoomId,
      displayName: finalName,
      avatar,
      isAudioMuted: !isMicEnabled,
      isVideoMuted: !isCamEnabled,
      isHost: isCreatingNew,
    });
  };

  const handleCopyInvite = () => {
    const baseUrl = window.location.href.split('?')[0].split('#')[0];
    const inviteUrl = `${baseUrl}?room=${encodeURIComponent(roomId)}`;
    navigator.clipboard.writeText(inviteUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-zinc-950 relative overflow-hidden">
      {/* Ambient background glows */}
      <div className="absolute top-10 left-1/3 w-[600px] h-[500px] bg-rose-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-10 right-1/4 w-[500px] h-[400px] bg-sky-600/10 rounded-full blur-[140px] pointer-events-none" />

      <div className="relative z-10 w-full max-w-4xl bg-zinc-900/90 border border-zinc-800/80 rounded-3xl shadow-2xl backdrop-blur-xl overflow-hidden p-6 md:p-8">
        {/* Top Header */}
        <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b border-zinc-800/60 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-rose-600 to-amber-500 flex items-center justify-center text-white shadow-md shadow-rose-500/20">
              <Film className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-white tracking-tight font-['Plus_Jakarta_Sans'] flex items-center gap-2">
                <span>Room Lobby</span>
                {isInviteLink && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                    Invite Unlocked
                  </span>
                )}
              </h1>
              <p className="text-xs text-zinc-400">
                Setup your camera, mic, and join your friends
              </p>
            </div>
          </div>

          {/* Room ID pill & copy button */}
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 rounded-xl px-3 py-1.5">
            <span className="text-xs text-zinc-400">Room:</span>
            <span className="text-xs font-mono font-semibold text-rose-400">{roomId}</span>
            <button
              onClick={handleCopyInvite}
              type="button"
              title="Copy shareable invite link"
              className="p-1 rounded-md hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors cursor-pointer"
            >
              {copiedLink ? (
                <Check className="w-3.5 h-3.5 text-emerald-400" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
            </button>
          </div>
        </div>

        {/* Main Content: Left (Camera Preview), Right (Setup form) */}
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 items-start">
          {/* Left: Video Preview Mirror */}
          <div className="md:col-span-6 flex flex-col items-center">
            <div className="relative w-full aspect-video rounded-2xl bg-zinc-950 border border-zinc-800/80 overflow-hidden shadow-inner flex items-center justify-center group">
              <video
                ref={videoPreviewRef}
                autoPlay
                playsInline
                muted
                className={`w-full h-full object-cover scale-x-[-1] transition-opacity duration-300 ${
                  isCamEnabled && hasMediaPermission ? 'opacity-100' : 'opacity-0'
                }`}
              />

              {/* Disabled camera avatar fallback */}
              {(!isCamEnabled || !hasMediaPermission) && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/90 text-zinc-400">
                  <div className="w-20 h-20 rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center text-4xl shadow-lg mb-2">
                    {avatar}
                  </div>
                  <span className="text-xs font-medium text-zinc-400">
                    {hasMediaPermission === false ? 'Camera access not available' : 'Camera is muted'}
                  </span>
                </div>
              )}

              {/* Bottom floating controls over video */}
              <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-zinc-900/80 backdrop-blur-md px-3 py-1.5 rounded-full border border-zinc-800/80 shadow-lg">
                <button
                  type="button"
                  onClick={toggleMic}
                  className={`p-2 rounded-full transition-all cursor-pointer ${
                    isMicEnabled
                      ? 'bg-zinc-800 text-white hover:bg-zinc-700'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                  title={isMicEnabled ? 'Mute microphone' : 'Unmute microphone'}
                >
                  {isMicEnabled ? <Mic className="w-4 h-4" /> : <MicOff className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={toggleCam}
                  className={`p-2 rounded-full transition-all cursor-pointer ${
                    isCamEnabled
                      ? 'bg-zinc-800 text-white hover:bg-zinc-700'
                      : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                  }`}
                  title={isCamEnabled ? 'Turn off camera' : 'Turn on camera'}
                >
                  {isCamEnabled ? <Video className="w-4 h-4" /> : <VideoOff className="w-4 h-4" />}
                </button>
              </div>

              {/* Live Mic volume bar on top left */}
              {isMicEnabled && (
                <div className="absolute top-3 left-3 flex items-center gap-1.5 bg-zinc-900/70 backdrop-blur-md px-2.5 py-1 rounded-md border border-zinc-800/60">
                  <Mic className="w-3 h-3 text-emerald-400" />
                  <div className="w-16 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400 transition-all duration-75"
                      style={{ width: `${audioLevel}%` }}
                    />
                  </div>
                </div>
              )}
            </div>

            <p className="text-[11px] text-zinc-500 mt-2.5 text-center">
              You can toggle your microphone, webcam, and screen share anytime inside the room.
            </p>
          </div>

          {/* Right: Room & Profile Settings */}
          <div className="md:col-span-6 space-y-5">
            {/* Tab switch: Only users who authenticated with passcode can create rooms */}
            {hasPasscode ? (
              <div className="flex rounded-xl bg-zinc-950 p-1 border border-zinc-800">
                <button
                  type="button"
                  onClick={() => {
                    setIsCreatingNew(true);
                    if (!initialRoomId) {
                      setRoomId(`party-${Math.random().toString(36).substring(2, 6)}`);
                    }
                  }}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    isCreatingNew
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Create New Room
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingNew(false)}
                  className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                    !isCreatingNew
                      ? 'bg-zinc-800 text-white shadow-sm'
                      : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Join Existing Room
                </button>
              </div>
            ) : (
              <div className="p-3 rounded-xl bg-zinc-950/80 border border-zinc-800 flex items-center justify-between text-xs">
                <div className="flex items-center gap-2 text-zinc-300">
                  <Lock className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Joining party as invited guest</span>
                </div>
                {onBackToGate && (
                  <button
                    type="button"
                    onClick={onBackToGate}
                    className="text-[11px] font-semibold text-rose-400 hover:text-rose-300 hover:underline cursor-pointer"
                  >
                    Enter secret to host
                  </button>
                )}
              </div>
            )}

            <form onSubmit={handleJoin} className="space-y-4">
              {/* Room ID Input */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5 flex items-center justify-between">
                  <span>{isCreatingNew ? 'Room Code' : 'Watch Party Room Code'}</span>
                  {!hasPasscode && (
                    <span className="text-[10px] text-amber-400 flex items-center gap-1 font-mono">
                      <Lock className="w-3 h-3" />
                      Locked to invited room
                    </span>
                  )}
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={roomId}
                    readOnly={!hasPasscode}
                    onChange={(e) => hasPasscode && setRoomId(e.target.value.toLowerCase().replace(/\s+/g, '-'))}
                    placeholder="e.g. friday-movie-night"
                    className={`flex-1 px-3.5 py-2.5 rounded-xl border font-mono text-sm placeholder-zinc-500 focus:outline-none ${
                      !hasPasscode
                        ? 'bg-zinc-950/50 border-zinc-800/60 text-zinc-400 cursor-not-allowed select-none'
                        : 'bg-zinc-950 border-zinc-800 text-white focus:border-rose-500'
                    }`}
                    required
                  />
                  {hasPasscode && isCreatingNew && (
                    <button
                      type="button"
                      onClick={() =>
                        setRoomId(`party-${Math.random().toString(36).substring(2, 6)}`)
                      }
                      className="px-3 py-2 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-xl cursor-pointer transition-colors"
                      title="Randomize Room ID"
                    >
                      Random
                    </button>
                  )}
                </div>
              </div>

              {/* Display Name */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Your Display Name
                </label>
                <input
                  type="text"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  maxLength={24}
                  placeholder="e.g. Alex"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-zinc-950 border border-zinc-800 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-rose-500"
                  required
                />
              </div>

              {/* Avatar Selector */}
              <div>
                <label className="block text-xs font-medium text-zinc-300 mb-1.5">
                  Choose Your Watch Avatar
                </label>
                <div className="grid grid-cols-6 gap-2">
                  {AVATAR_OPTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      onClick={() => setAvatar(item)}
                      className={`h-10 text-xl rounded-xl border flex items-center justify-center transition-all cursor-pointer ${
                        avatar === item
                          ? 'border-rose-500 bg-rose-500/20 scale-105 shadow-sm'
                          : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-800/60'
                      }`}
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>

              {/* Screen audio tip */}
              <div className="p-3 rounded-xl bg-zinc-950/70 border border-zinc-800 text-xs text-zinc-400 space-y-1">
                <div className="flex items-center gap-1.5 text-zinc-200 font-medium">
                  <Tv className="w-3.5 h-3.5 text-rose-400" />
                  <span>Streaming Netflix or YouTube?</span>
                </div>
                <p className="text-[11px] text-zinc-400">
                  When you click <strong>Share Screen</strong>, pick &ldquo;Chrome Tab&rdquo; and check &ldquo;Also share tab audio&rdquo; so friends hear the movie sound!
                </p>
              </div>

              {isInviteLink && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-300 text-xs">
                  <Sparkles className="w-3.5 h-3.5 shrink-0 text-amber-300" />
                  <span>Joining via invite link. Active while friends are in the room.</span>
                </div>
              )}

              {/* Join / Start Button */}
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-2 px-5 py-3.5 rounded-xl font-bold text-sm bg-gradient-to-r from-rose-500 to-amber-500 hover:from-rose-600 hover:to-amber-600 active:scale-[0.99] text-white shadow-lg shadow-rose-500/20 transition-all cursor-pointer"
              >
                <span>{isCreatingNew ? 'Start Watch Party' : 'Join Watch Party'}</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};

import React, { useEffect, useRef, useState } from 'react';
import { MicOff, VideoOff, Crown, Tv, Volume2 } from 'lucide-react';
import { Participant } from '../types';

interface ParticipantTileProps {
  participant: Participant;
  isSelf: boolean;
  stream: MediaStream | null;
  compact?: boolean;
}

export const ParticipantTile: React.FC<ParticipantTileProps> = ({
  participant,
  isSelf,
  stream,
  compact = false,
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioLevel, setAudioLevel] = useState<number>(0);

  useEffect(() => {
    if (videoRef.current) {
      if (stream) {
        videoRef.current.srcObject = stream;
        videoRef.current.play().catch(() => {});
      } else {
        videoRef.current.srcObject = null;
      }
    }
  }, [stream]);

  // Handle remote audio playback via dedicated audio element
  useEffect(() => {
    if (!isSelf && audioRef.current && stream) {
      audioRef.current.srcObject = stream;
      audioRef.current.volume = 1.0;
      audioRef.current.play().catch((err) => {
        console.warn('[ParticipantTile] Audio autoplay policy prevented initial playback:', err);
      });
    }
  }, [stream, isSelf]);

  // Global user-gesture unlock for audio playback
  useEffect(() => {
    if (isSelf) return;

    const unlockAudio = () => {
      if (audioRef.current && audioRef.current.srcObject) {
        audioRef.current.play().catch(() => {});
      }
    };

    window.addEventListener('click', unlockAudio, { once: true });
    window.addEventListener('touchstart', unlockAudio, { once: true });
    return () => {
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('touchstart', unlockAudio);
    };
  }, [isSelf]);

  // Real-time Audio Level Analyser for Visual Verification
  useEffect(() => {
    if (!stream || participant.isAudioMuted) {
      setAudioLevel(0);
      return;
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0 || !audioTracks[0].enabled) {
      setAudioLevel(0);
      return;
    }

    let animationFrameId: number;
    let audioCtx: AudioContext | null = null;

    try {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        audioCtx = new AudioCtx();
        const source = audioCtx.createMediaStreamSource(stream);
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.4;
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);

        const checkAudio = () => {
          analyser.getByteFrequencyData(dataArray);
          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Scale to 0-100 range
          const level = Math.min(100, Math.round((avg / 120) * 100));
          setAudioLevel(level);
          animationFrameId = requestAnimationFrame(checkAudio);
        };

        checkAudio();
      }
    } catch {
      // AudioContext policy catch
    }

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (audioCtx && audioCtx.state !== 'closed') {
        audioCtx.close().catch(() => {});
      }
    };
  }, [stream, participant.isAudioMuted]);

  const hasVideoTrack =
    stream &&
    stream.getVideoTracks().length > 0 &&
    stream.getVideoTracks()[0].enabled &&
    !participant.isVideoMuted;

  const hasAudioTrack =
    stream &&
    stream.getAudioTracks().length > 0 &&
    stream.getAudioTracks()[0].enabled;

  const isSpeaking = audioLevel > 12 && !participant.isAudioMuted;

  return (
    <div
      className={`relative rounded-2xl bg-zinc-900 border overflow-hidden shadow-lg transition-all duration-200 group flex items-center justify-center ${
        isSpeaking
          ? 'border-emerald-500/80 ring-2 ring-emerald-500/40 shadow-[0_0_16px_rgba(16,185,129,0.3)]'
          : 'border-zinc-800/80'
      } ${compact ? 'w-36 h-24 md:w-48 md:h-32' : 'w-full h-full min-h-[140px]'}`}
    >
      {/* Dedicated Remote Audio Tag (muted=false) */}
      {!isSelf && <audio ref={audioRef} autoPlay playsInline />}

      {/* Video feed: Always muted={true} to guarantee autoplay never freezes frames */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={true}
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isSelf ? 'scale-x-[-1]' : ''
        } ${hasVideoTrack ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Fallback avatar if video is muted or absent */}
      {!hasVideoTrack && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/95 p-2 text-center">
          <div
            className={`rounded-full bg-zinc-900 border flex items-center justify-center shadow-inner transition-transform duration-200 ${
              isSpeaking ? 'scale-110 border-emerald-500/60 ring-2 ring-emerald-500/30' : 'border-zinc-800'
            } ${compact ? 'w-10 h-10 text-xl' : 'w-16 h-16 text-3xl'}`}
          >
            {participant.avatar || '🍿'}
          </div>
          <span className="text-[11px] text-zinc-400 mt-1.5 font-medium truncate max-w-full">
            {participant.isVideoMuted ? 'Camera off' : 'Live Avatar'}
          </span>
          {hasAudioTrack && !participant.isAudioMuted && (
            <span className="text-[9px] text-emerald-400/90 font-semibold flex items-center gap-1 mt-0.5">
              <Volume2 className="w-2.5 h-2.5" />
              <span>Mic Connected</span>
            </span>
          )}
        </div>
      )}

      {/* Badges Overlay */}
      {/* Top Left: Host or Screen Sharer badge */}
      <div className="absolute top-2 left-2 flex items-center gap-1.5 z-10">
        {participant.isHost && (
          <span
            className="p-1 rounded-md bg-amber-500/20 text-amber-400 border border-amber-500/30 backdrop-blur-sm"
            title="Room Host"
          >
            <Crown className="w-3 h-3" />
          </span>
        )}
        {participant.isSharingScreen && (
          <span
            className="px-1.5 py-0.5 rounded-md bg-rose-500/20 text-rose-400 border border-rose-500/30 text-[10px] font-semibold flex items-center gap-1 backdrop-blur-sm animate-pulse"
            title="Screen Sharing"
          >
            <Tv className="w-3 h-3" />
            <span>LIVE</span>
          </span>
        )}
      </div>

      {/* Bottom Bar: Name & Mic status */}
      <div className="absolute bottom-2 inset-x-2 flex items-center justify-between z-10">
        <div className="px-2 py-0.5 rounded-md bg-black/70 backdrop-blur-md text-[11px] font-medium text-zinc-200 border border-white/10 truncate max-w-[65%]">
          {participant.displayName} {isSelf && '(You)'}
        </div>

        <div className="flex items-center gap-1.5">
          {participant.isAudioMuted ? (
            <div
              className="p-1 rounded-md bg-rose-500/30 text-rose-400 border border-rose-500/40 backdrop-blur-md"
              title="Muted"
            >
              <MicOff className="w-3.5 h-3.5" />
            </div>
          ) : (
            <div
              className="flex items-end gap-[2px] px-1.5 py-1 rounded-md bg-black/60 backdrop-blur-md border border-white/10 h-5"
              title={isSpeaking ? `Speaking (Level: ${audioLevel}%)` : 'Microphone Active'}
            >
              {/* Dancing Waveform Equalizer Bars */}
              <div
                className={`w-[2.5px] rounded-full transition-all duration-75 ${
                  isSpeaking ? 'bg-emerald-400' : 'bg-emerald-600/50'
                }`}
                style={{
                  height: `${Math.max(3, Math.min(13, 3 + (audioLevel / 100) * 10))}px`,
                }}
              />
              <div
                className={`w-[2.5px] rounded-full transition-all duration-75 ${
                  isSpeaking ? 'bg-emerald-400' : 'bg-emerald-600/50'
                }`}
                style={{
                  height: `${Math.max(4, Math.min(15, 4 + (audioLevel / 100) * 12))}px`,
                }}
              />
              <div
                className={`w-[2.5px] rounded-full transition-all duration-75 ${
                  isSpeaking ? 'bg-emerald-400' : 'bg-emerald-600/50'
                }`}
                style={{
                  height: `${Math.max(3, Math.min(13, 3 + (audioLevel / 100) * 9))}px`,
                }}
              />
            </div>
          )}

          {participant.isVideoMuted && (
            <div
              className="p-1 rounded-md bg-zinc-800/80 text-zinc-400 backdrop-blur-md"
              title="Camera Off"
            >
              <VideoOff className="w-3.5 h-3.5" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};


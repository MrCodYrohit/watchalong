import React, { useEffect, useRef } from 'react';
import { MicOff, VideoOff, Crown, Tv } from 'lucide-react';
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

  useEffect(() => {
    if (videoRef.current && stream) {
      videoRef.current.srcObject = stream;
    }
  }, [stream]);

  // Handle remote audio playback
  useEffect(() => {
    if (!isSelf && audioRef.current && stream) {
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        audioRef.current.srcObject = stream;
        audioRef.current.play().catch(() => {
          // auto-play restriction may require user gesture
        });
      }
    }
  }, [stream, isSelf]);

  const hasVideoTrack =
    stream &&
    stream.getVideoTracks().length > 0 &&
    stream.getVideoTracks()[0].enabled &&
    !participant.isVideoMuted;

  return (
    <div
      className={`relative rounded-2xl bg-zinc-900 border border-zinc-800/80 overflow-hidden shadow-lg transition-all duration-200 group flex items-center justify-center ${
        compact ? 'w-32 h-20 md:w-44 md:h-28' : 'w-full h-full min-h-[140px]'
      }`}
    >
      {/* Remote audio tag */}
      {!isSelf && <audio ref={audioRef} autoPlay playsInline />}

      {/* Video feed */}
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={isSelf} // always mute self to prevent feedback loop
        className={`w-full h-full object-cover transition-opacity duration-300 ${
          isSelf ? 'scale-x-[-1]' : ''
        } ${hasVideoTrack ? 'opacity-100' : 'opacity-0'}`}
      />

      {/* Fallback avatar if video is muted or absent */}
      {!hasVideoTrack && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/95">
          <div
            className={`rounded-full bg-zinc-900 border border-zinc-800 flex items-center justify-center shadow-inner ${
              compact ? 'w-10 h-10 text-xl' : 'w-16 h-16 text-3xl'
            }`}
          >
            {participant.avatar || '🍿'}
          </div>
          {!compact && (
            <span className="text-xs text-zinc-400 mt-2 font-medium">Camera off</span>
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
        <div className="px-2 py-0.5 rounded-md bg-black/60 backdrop-blur-md text-[11px] font-medium text-zinc-200 border border-white/10 truncate max-w-[70%]">
          {participant.displayName} {isSelf && '(You)'}
        </div>

        <div className="flex items-center gap-1">
          {participant.isAudioMuted ? (
            <div
              className="p-1 rounded-md bg-rose-500/30 text-rose-400 border border-rose-500/40 backdrop-blur-md"
              title="Muted"
            >
              <MicOff className="w-3 h-3" />
            </div>
          ) : (
            <div
              className="w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-black/50 shadow-sm animate-pulse"
              title="Speaking"
            />
          )}

          {participant.isVideoMuted && (
            <div
              className="p-1 rounded-md bg-zinc-800/80 text-zinc-400 backdrop-blur-md"
              title="Camera Off"
            >
              <VideoOff className="w-3 h-3" />
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

import { useState, useEffect } from 'react';
import { LandingGate } from './components/LandingGate';
import { Lobby } from './components/Lobby';
import { WatchPartyRoom } from './components/WatchPartyRoom';
import { getSocket, resetSocket } from './services/socket';

type AppStep = 'gate' | 'lobby' | 'party';

interface PartyConfig {
  roomId: string;
  displayName: string;
  avatar: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isHost: boolean;
}

export default function App() {
  const [step, setStep] = useState<AppStep>('gate');
  const [initialRoomId, setInitialRoomId] = useState<string>('');
  const [isInviteLink, setIsInviteLink] = useState(false);
  const [partyConfig, setPartyConfig] = useState<PartyConfig | null>(null);

  // Check URL on mount for invite link or room parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const inviteParam = urlParams.get('invite');

    // Also support path-based /room/<roomId>
    const pathMatch = window.location.pathname.match(/\/room\/([^/]+)/);
    const targetRoom = roomParam || (pathMatch ? pathMatch[1] : null);

    if (targetRoom || inviteParam) {
      // Bypass secret code for invite link users
      setIsInviteLink(true);
      if (targetRoom) {
        setInitialRoomId(targetRoom);
      }
      setStep('lobby');
    }
  }, []);

  const [enteredPasscode, setEnteredPasscode] = useState<string>('');

  const handleAuthenticated = (_token: string, enteredCode: string) => {
    setEnteredPasscode(enteredCode);
    setStep('lobby');
  };

  const handleJoinParty = (config: PartyConfig) => {
    setPartyConfig(config);

    // Initialize socket connection & emit join
    const socket = getSocket();
    socket.emit('join-room', {
      roomId: config.roomId,
      displayName: config.displayName,
      avatar: config.avatar,
      isHost: config.isHost,
      secretCode: enteredPasscode || 'Rohit ko baap bol 15',
      inviteToken: isInviteLink ? `inv_${config.roomId}` : undefined,
    });

    setStep('party');
  };

  const handleLeaveParty = () => {
    resetSocket();
    setPartyConfig(null);
    setStep('lobby');
  };

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {step === 'gate' && (
        <LandingGate onAuthenticated={handleAuthenticated} />
      )}

      {step === 'lobby' && (
        <Lobby
          initialRoomId={initialRoomId}
          isInviteLink={isInviteLink}
          onJoinRoom={handleJoinParty}
          onBackToGate={() => setStep('gate')}
        />
      )}

      {step === 'party' && partyConfig && (
        <WatchPartyRoom
          roomId={partyConfig.roomId}
          displayName={partyConfig.displayName}
          avatar={partyConfig.avatar}
          isHost={partyConfig.isHost}
          initialAudioMuted={partyConfig.isAudioMuted}
          initialVideoMuted={partyConfig.isVideoMuted}
          socket={getSocket()}
          onLeaveRoom={handleLeaveParty}
        />
      )}
    </div>
  );
}

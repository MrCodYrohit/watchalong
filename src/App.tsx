import { useState, useEffect, useCallback } from 'react';
import { LandingGate } from './components/LandingGate';
import { Lobby } from './components/Lobby';
import { WatchPartyRoom } from './components/WatchPartyRoom';
import { getSocket, resetSocket } from './services/socket';
import { validateSecretCode } from './config';

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
  const [enteredPasscode, setEnteredPasscode] = useState<string>('');
  const [gateMessage, setGateMessage] = useState<string | null>(null);

  // Check URL on mount for invite link or room parameter
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    const inviteParam = urlParams.get('invite');

    // Also support path-based /room/<roomId>
    const pathMatch = window.location.pathname.match(/\/room\/([^/]+)/);
    const targetRoom = roomParam || (pathMatch ? pathMatch[1] : null);

    if (targetRoom || inviteParam) {
      const roomToCheck = targetRoom || '';
      setIsInviteLink(true);
      if (roomToCheck) {
        setInitialRoomId(roomToCheck);
      }
      setGateMessage(null);
      setStep('lobby');
    }
  }, []);

  const handleAuthenticated = (_token: string, enteredCode: string) => {
    setEnteredPasscode(enteredCode);
    setGateMessage(null);
    setStep('lobby');
  };

  const handleJoinParty = (config: PartyConfig) => {
    setPartyConfig(config);

    // Initialize socket connection & emit join
    const socket = getSocket();

    const onJoinError = (err: any) => {
      console.warn('Join error received:', err);
      resetSocket();
      setPartyConfig(null);
      setIsInviteLink(false);
      setInitialRoomId('');
      window.history.replaceState({}, '', window.location.pathname);
      setGateMessage(
        err?.message ||
          'This invite link has expired because everyone has left the watch party. Enter the secret code to start a new party.'
      );
      setStep('gate');
    };

    socket.off('join-error');
    socket.on('join-error', onJoinError);

    socket.emit('join-room', {
      roomId: config.roomId,
      displayName: config.displayName,
      avatar: config.avatar,
      isHost: config.isHost,
      secretCode: enteredPasscode || '',
      inviteToken: isInviteLink ? `inv_${config.roomId}` : undefined,
    });

    setStep('party');
  };

  const handleLeaveParty = useCallback(() => {
    resetSocket();
    setPartyConfig(null);
    setStep('lobby');
  }, []);

  const handleJoinError = useCallback((msg: string) => {
    resetSocket();
    setPartyConfig(null);
    setIsInviteLink(false);
    setInitialRoomId('');
    window.history.replaceState({}, '', window.location.pathname);
    setGateMessage(msg);
    setStep('gate');
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {step === 'gate' && (
        <LandingGate onAuthenticated={handleAuthenticated} infoMessage={gateMessage} />
      )}

      {step === 'lobby' && (
        <Lobby
          initialRoomId={initialRoomId}
          isInviteLink={isInviteLink}
          hasPasscode={validateSecretCode(enteredPasscode)}
          onJoinRoom={handleJoinParty}
          onBackToGate={() => {
            setGateMessage(null);
            setStep('gate');
          }}
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
          onJoinError={handleJoinError}
        />
      )}
    </div>
  );
}

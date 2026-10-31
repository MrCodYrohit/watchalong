export interface Participant {
  socketId: string;
  displayName: string;
  avatar: string;
  isAudioMuted: boolean;
  isVideoMuted: boolean;
  isSharingScreen: boolean;
  isHost: boolean;
  joinedAt: number;
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  text: string;
  timestamp: number;
  isSystem?: boolean;
}

export interface ReactionEvent {
  id: string;
  emoji: string;
  senderName: string;
  timestamp: number;
}

export interface ScreenSharerInfo {
  socketId: string;
  displayName: string;
  startedAt: number;
}

export interface RoomDetails {
  roomId: string;
  yourSocketId: string;
  isHost: boolean;
  participants: Participant[];
  activeScreenSharer: ScreenSharerInfo | null;
  messages: ChatMessage[];
}

export type ViewLayout = 'theater' | 'cinema' | 'grid';

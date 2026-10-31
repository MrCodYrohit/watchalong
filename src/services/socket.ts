import { SignalingSocket, ServerlessSignalingSocket } from './serverlessSignaling';

let socketInstance: SignalingSocket | null = null;

export function getSocket(): SignalingSocket {
  if (!socketInstance) {
    socketInstance = new ServerlessSignalingSocket();
    socketInstance.connect();
  }

  return socketInstance;
}

export function resetSocket() {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
}

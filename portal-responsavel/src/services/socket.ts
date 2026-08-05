import { io } from 'socket.io-client';

const SOCKET_URL = import.meta.env.DEV
  ? (import.meta.env.VITE_API_URL || 'http://localhost:3001').replace(/\/api$/, '')
  : window.location.origin;

export const socket = io(SOCKET_URL, {
  withCredentials: true,
  autoConnect: true,
  reconnection: true,
});

socket.on('connect', () => {
  console.log('Connected to real-time server');
});

socket.on('disconnect', () => {
  console.log('Disconnected from real-time server');
});

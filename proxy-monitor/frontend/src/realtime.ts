import { appUrl } from './api';
import type { StatsData } from './types';

interface Handlers {
  onStats: (stats: StatsData) => void;
  onConnection: (connected: boolean) => void;
  onUnauthorized: () => void;
}

export function connectStats(token: string, handlers: Handlers): () => void {
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let keepaliveTimer: number | undefined;
  let lastMessageAt = 0;
  let stopped = false;
  let delay = 1000;

  const clearTimers = () => {
    window.clearTimeout(reconnectTimer);
    window.clearInterval(keepaliveTimer);
  };

  const connect = () => {
    if (stopped) return;
    const url = appUrl('ws');
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(url);
    socket.onopen = () => {
      lastMessageAt = Date.now();
      socket?.send(JSON.stringify({ type: 'auth', token }));
      keepaliveTimer = window.setInterval(() => {
        if (Date.now() - lastMessageAt > 45000) { socket?.close(); return; }
        if (socket?.readyState === WebSocket.OPEN) socket.send('ping');
      }, 20000);
    };
    socket.onmessage = (event) => {
      lastMessageAt = Date.now();
      try {
        const message = JSON.parse(event.data as string) as { type: string; data?: StatsData };
        if (message.type === 'stats' && message.data) {
          delay = 1000;
          handlers.onConnection(true);
          handlers.onStats(message.data);
        }
      } catch { /* Ignore malformed frames. */ }
    };
    socket.onclose = (event) => {
      clearTimers();
      if (stopped) return;
      handlers.onConnection(false);
      if (event.code === 4401) {
        handlers.onUnauthorized();
        return;
      }
      reconnectTimer = window.setTimeout(connect, delay);
      delay = Math.min(delay * 2, 30000);
    };
  };

  connect();
  return () => {
    stopped = true;
    clearTimers();
    socket?.close();
  };
}

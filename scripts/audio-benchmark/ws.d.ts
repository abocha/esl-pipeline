declare module 'ws' {
  type Listener = (...args: unknown[]) => void;

  class WebSocket {
    constructor(url: string, options: { headers: Record<string, string> });
    readyState: number;
    on(event: string, listener: Listener): this;
    send(data: string, callback?: (error?: Error) => void): void;
    close(): void;
  }

  export class WebSocketServer {
    constructor(options: { port: number; host?: string });
    on(event: string, listener: Listener): this;
    address(): { port: number; address: string; family: string } | string | null;
    close(callback?: (error?: Error) => void): void;
  }

  export default WebSocket;
}

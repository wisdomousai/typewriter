import { type ClientMessage, CLOSED, type ServerMessage } from './protocol';

/**
 * A room's WebSocket that says hello whenever it opens, and comes back by itself when it
 * drops (sooner at first, then less often), unless the room let it go for good (the chat is
 * full, it sat idle, its pass ran out: `ended` says which).
 */
export class Link {
  onMessage: (m: ServerMessage) => void = () => {};
  onState: (state: 'connecting' | 'open' | 'closed') => void = () => {};
  private ws: WebSocket | null = null;
  private wait = 500;
  private timer = 0;
  private closed = false;
  /** Why the room let it go for good, if it did. */
  ended: keyof typeof CLOSED | null = null;

  constructor(
    private url: string,
    private hello: () => ClientMessage,
  ) {
    this.open();
  }

  private open() {
    if (this.closed) return;
    this.onState('connecting');
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => {
      this.wait = 500;
      this.onState('open');
      ws.send(JSON.stringify(this.hello()));
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch (error) {
        console.warn('chat:', error);
      }
    };
    ws.onclose = (e) => {
      if (this.ws !== ws) return;
      this.ws = null;
      const ended = (Object.keys(CLOSED) as (keyof typeof CLOSED)[]).find((k) => CLOSED[k] === e.code);
      if (ended) {
        this.ended = ended;
        this.closed = true;
      }
      this.onState('closed');
      if (this.closed) return;
      this.timer = window.setTimeout(() => this.open(), this.wait);
      this.wait = Math.min(this.wait * 2, 10000);
    };
  }

  send(m: ClientMessage) {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  /** Say hello again (a new name). */
  rehello() {
    this.send(this.hello());
  }

  close() {
    this.closed = true;
    clearTimeout(this.timer);
    this.ws?.close();
  }
}

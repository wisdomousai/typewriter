import { DurableObject } from 'cloudflare:workers';
import {
  type ClientMessage,
  INKS,
  LIMITS,
  type Line,
  type Person,
  ROOM,
  type ServerMessage,
  type Turn,
} from '../../src/chat/protocol';

/**
 * The typewriter chat's rooms: one Durable Object per room, named in the address
 * (/room/NAME). Each person's machine keeps a WebSocket open to it. The room hands out the
 * line (one person types at a time, the rest wait in line), passes every character on as it
 * is typed, and keeps the last turns for whoever comes in later.
 *
 * The sockets are hibernatable: an idle room leaves memory, and what it must remember (the
 * line, the turn being typed, the history) is in its storage; who each socket is rides on
 * the socket itself.
 */

interface Env {
  ROOM: DurableObjectNamespace<Room>;
}

/** Pages that may open a room. */
const ORIGINS = [
  /^https:\/\/wisdomousai\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const name = /^\/room\/([^/]+)$/.exec(url.pathname)?.[1];
    if (!name || !ROOM.test(name)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 });
    const origin = request.headers.get('Origin') ?? '';
    if (!ORIGINS.some((o) => o.test(origin))) return new Response('Forbidden', { status: 403 });
    return env.ROOM.getByName(name).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** Who a socket is: an id at once, a name and an ink once they've said hello. */
type Who = { id: string } & Partial<Person>;

interface Held {
  line: Line;
  current: Turn | null;
  /** The holder has typed something this turn. */
  typed: boolean;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export class Room extends DurableObject<Env> {
  private held: Held = { line: { floor: null, queue: [], until: null }, current: null, typed: false };
  private history: Turn[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.held = (await ctx.storage.get<Held>('held')) ?? this.held;
      this.history = (await ctx.storage.get<Turn[]>('history')) ?? [];
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (this.ctx.getWebSockets().length >= LIMITS.people)
      return new Response('This room is full', { status: 503 });
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ id: crypto.randomUUID().slice(0, 8) } satisfies Who);
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(typeof raw === 'string' ? raw : new TextDecoder().decode(raw));
    } catch {
      return;
    }
    const who = ws.deserializeAttachment() as Who;
    if (msg.t === 'hello') return this.hello(ws, who, msg.name, msg.ink);
    if (!who.name) return;
    const { line } = this.held;
    const mine = line.floor === who.id;
    switch (msg.t) {
      case 'hold':
        if (mine || line.queue.includes(who.id)) return;
        line.queue.push(who.id);
        this.advance();
        return this.save();
      case 'leave':
        if (!line.queue.includes(who.id)) return;
        line.queue = line.queue.filter((id) => id !== who.id);
        return this.save();
      case 'over':
        if (!mine) return;
        this.end();
        this.advance();
        return this.save();
      case 'type': {
        const turn = this.held.current;
        if (!mine || !turn || typeof msg.s !== 'string') return;
        // Printable characters and line breaks only, a little at a time.
        const s = msg.s.replace(/\r\n?/g, '\n').replace(/[^\P{C}\n]/gu, '').slice(0, LIMITS.chunk);
        if (!s || turn.text.length + s.length > LIMITS.turn) return;
        turn.text += s;
        this.held.typed = true;
        line.until = Date.now() + LIMITS.idle;
        this.send({ t: 'type', id: who.id, s }, ws);
        await this.ctx.storage.setAlarm(line.until);
        return this.save(false);
      }
      case 'back': {
        const turn = this.held.current;
        if (!mine || !turn?.text) return;
        const parts = [...graphemes.segment(turn.text)];
        turn.text = turn.text.slice(0, parts[parts.length - 1].index);
        line.until = Date.now() + LIMITS.idle;
        this.send({ t: 'back', id: who.id }, ws);
        await this.ctx.storage.setAlarm(line.until);
        return this.save(false);
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    this.gone(ws);
  }

  async webSocketError(ws: WebSocket) {
    this.gone(ws);
  }

  /** The holder's time is up: the line goes on to whoever is next. */
  async alarm() {
    const { line } = this.held;
    if (!line.floor || !line.until) return;
    if (Date.now() < line.until - 50) {
      await this.ctx.storage.setAlarm(line.until);
      return;
    }
    this.end();
    this.advance();
    await this.save();
  }

  private async hello(ws: WebSocket, who: Who, name: unknown, ink: unknown) {
    const clean =
      typeof name === 'string'
        ? name.replace(/[^\P{C}]/gu, '').replace(/\s+/g, ' ').trim().slice(0, LIMITS.name)
        : '';
    if (!clean) return this.send({ t: 'error', message: 'A name, please.' }, null, ws);
    const taken = new Set(this.people().filter((p) => p.id !== who.id).map((p) => p.ink));
    const wanted = typeof ink === 'string' && INKS.includes(ink) && !taken.has(ink) ? ink : null;
    const me: Person = {
      id: who.id,
      name: clean,
      ink: wanted ?? who.ink ?? INKS.find((i) => !taken.has(i)) ?? INKS[taken.size % INKS.length],
    };
    ws.serializeAttachment(me satisfies Who);
    this.send(
      {
        t: 'welcome',
        you: me,
        people: this.people(),
        line: this.held.line,
        history: this.history,
        current: this.held.current,
      },
      null,
      ws,
    );
    this.send({ t: 'people', people: this.people() }, ws);
  }

  /** A socket went: its person leaves the line (and gives it up, if they held it). */
  private async gone(ws: WebSocket) {
    const who = ws.deserializeAttachment() as Who;
    try {
      ws.close(1000, 'bye');
    } catch {}
    const { line } = this.held;
    line.queue = line.queue.filter((id) => id !== who.id);
    if (line.floor === who.id) {
      this.end();
      this.advance(ws);
    }
    this.send({ t: 'people', people: this.people(ws) }, ws);
    await this.save(true, ws);
  }

  /** Nobody holds the line and someone waits: it's theirs (`skip` is a socket on its way
   * out). */
  private advance(skip?: WebSocket) {
    const { line } = this.held;
    if (line.floor) return;
    const here = new Map(this.people(skip).map((p) => [p.id, p]));
    while (line.queue.length) {
      const next = here.get(line.queue.shift()!);
      if (!next) continue;
      line.floor = next.id;
      line.until = Date.now() + LIMITS.first;
      this.held.typed = false;
      this.held.current = { id: next.id, name: next.name, ink: next.ink, text: '', at: Date.now() };
      this.send({ t: 'turn', turn: this.held.current }, skip ?? null);
      void this.ctx.storage.setAlarm(line.until);
      return;
    }
  }

  /** The turn is over: it goes into the history, if anything was typed. */
  private end() {
    const { line } = this.held;
    const turn = this.held.current;
    if (turn?.text.trim()) {
      this.history.push(turn);
      if (this.history.length > LIMITS.history) this.history.splice(0, this.history.length - LIMITS.history);
    }
    if (line.floor) this.send({ t: 'end', id: line.floor });
    line.floor = null;
    line.until = null;
    this.held.current = null;
    this.held.typed = false;
  }

  private people(except?: WebSocket): Person[] {
    const seen = new Map<string, Person>();
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === except) continue;
      const who = ws.deserializeAttachment() as Who;
      if (who.name && who.ink) seen.set(who.id, { id: who.id, name: who.name, ink: who.ink });
    }
    return [...seen.values()];
  }

  /** To everyone (but `skip`), or to one socket. */
  private send(msg: ServerMessage, skip: WebSocket | null = null, only?: WebSocket) {
    const text = JSON.stringify(msg);
    for (const ws of only ? [only] : this.ctx.getWebSockets()) {
      if (ws === skip) continue;
      if (!only && !(ws.deserializeAttachment() as Who).name) continue;
      try {
        ws.send(text);
      } catch {}
    }
  }

  /** Remember the room, and (unless only the turn's text changed) tell everyone where the
   * line stands. */
  private async save(tell = true, skip?: WebSocket) {
    if (tell) this.send({ t: 'line', line: this.held.line }, skip ?? null);
    await this.ctx.storage.put({ held: this.held, history: this.history });
  }
}

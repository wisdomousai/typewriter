import { DurableObject } from 'cloudflare:workers';
import {
  CLOSED,
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
 * is typed, and keeps the last turns for whoever comes in later, for as long as anyone is in
 * the room: when the last one leaves, the room forgets everything.
 *
 * It's a demo on someone's account, so it is kept small:
 * - A machine needs a pass to come in: POST /pass with a Turnstile token (the captcha) gets
 *   one, signed and good for a couple of hours.
 * - The Gate (one Durable Object for the whole chat) lets at most MAX_SESSIONS machines in at
 *   once, across every room. A machine's seat is a lease the room renews while it's there, so
 *   a room that goes away without saying so can't keep seats for ever.
 * - A machine that sits idle, or stays too long, is let go.
 *
 * The sockets are hibernatable: an idle room leaves memory, and what it must remember (the
 * line, the turn being typed, the history) is in its storage; who each socket is rides on
 * the socket itself.
 */

interface Env {
  ROOM: DurableObjectNamespace<Room>;
  GATE: DurableObjectNamespace<Gate>;
  /** Machines in the chat at once, across all rooms. */
  MAX_SESSIONS?: string;
  /** Turnstile's secret for the widget the page shows, and the key passes are signed with. */
  TURNSTILE_SECRET: string;
  PASS_KEY: string;
}

/** Pages that may open a room. */
const ORIGINS = [
  /^https:\/\/wisdomousai\.github\.io$/,
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
];

/** How long a pass is good for, a seat's lease, how often a room renews its seats, and how
 * long a machine may sit idle or stay at all (ms). */
const PASS_FOR = 2 * 60 * 60 * 1000;
const LEASE = 10 * 60 * 1000;
const RENEW = 4 * 60 * 1000;
const IDLE = 15 * 60 * 1000;
const STAY = 60 * 60 * 1000;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') ?? '';
    const allowed = ORIGINS.some((o) => o.test(origin));
    if (url.pathname === '/pass') {
      const cors: Record<string, string> = allowed ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
      if (request.method === 'OPTIONS')
        return new Response(null, {
          status: 204,
          headers: { ...cors, 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' },
        });
      if (request.method !== 'POST' || !allowed) return new Response('Forbidden', { status: 403 });
      return pass(request, env, cors);
    }
    const name = /^\/room\/([^/]+)$/.exec(url.pathname)?.[1];
    if (!name || !ROOM.test(name)) return new Response('Not found', { status: 404 });
    if (request.headers.get('Upgrade') !== 'websocket')
      return new Response('Expected a WebSocket', { status: 426 });
    if (!allowed) return new Response('Forbidden', { status: 403 });
    if (!(await valid(url.searchParams.get('pass') ?? '', env)))
      return refuse(CLOSED.pass, 'Your pass has run out: do the check again.');
    return env.ROOM.getByName(name).fetch(request);
  },
} satisfies ExportedHandler<Env>;

/** A Turnstile token in, a pass out. */
async function pass(request: Request, env: Env, cors: Record<string, string>) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
  let token = '';
  try {
    token = String(((await request.json()) as { token?: unknown }).token ?? '');
  } catch {}
  if (!token || !env.TURNSTILE_SECRET || !env.PASS_KEY) return json({ error: 'No check to go on.' }, 400);
  const form = new FormData();
  form.append('secret', env.TURNSTILE_SECRET);
  form.append('response', token);
  const ip = request.headers.get('CF-Connecting-IP');
  if (ip) form.append('remoteip', ip);
  const check = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form });
  const outcome = (await check.json()) as { success?: boolean };
  if (!outcome.success) return json({ error: 'The check failed: try it again.' }, 403);
  const until = Date.now() + PASS_FOR;
  return json({ pass: `${until}.${await sign(String(until), env.PASS_KEY)}`, until });
}

async function sign(text: string, secret: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
    'sign',
  ]);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)));
  return btoa(String.fromCharCode(...mac)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function valid(pass: string, env: Env) {
  const [until, mac] = pass.split('.');
  if (!until || !mac || !env.PASS_KEY || !(Number(until) > Date.now())) return false;
  const want = await sign(until, env.PASS_KEY);
  // Same length, compared without stopping at the first difference.
  if (want.length !== mac.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ mac.charCodeAt(i);
  return diff === 0;
}

/** A socket opened only to say why it's closing (a refused handshake tells the page nothing). */
function refuse(code: number, message: string) {
  const [client, server] = Object.values(new WebSocketPair());
  server.accept();
  server.send(JSON.stringify({ t: 'error', message } satisfies ServerMessage));
  server.close(code, message.slice(0, 120));
  return new Response(null, { status: 101, webSocket: client });
}

// ---------------------------------------------------------------------------------- the gate

/** The seats in the whole chat: a lease for each machine in a room, renewed by its room. */
export class Gate extends DurableObject<Env> {
  private leases = new Map<string, number>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.leases = new Map(Object.entries((await ctx.storage.get<Record<string, number>>('leases')) ?? {}));
    });
  }

  /** A seat for a machine, if there's one free. */
  async enter(id: string): Promise<boolean> {
    this.prune();
    const max = Number(this.env.MAX_SESSIONS ?? 10);
    if (!this.leases.has(id) && this.leases.size >= max) return false;
    this.leases.set(id, Date.now() + LEASE);
    await this.save();
    return true;
  }

  /** Machines still there: their leases run on. */
  async stay(ids: string[]) {
    this.prune();
    for (const id of ids) if (this.leases.has(id)) this.leases.set(id, Date.now() + LEASE);
    await this.save();
  }

  async leave(id: string) {
    this.leases.delete(id);
    this.prune();
    await this.save();
  }

  private prune() {
    const now = Date.now();
    for (const [id, until] of this.leases) if (until < now) this.leases.delete(id);
  }

  private save() {
    return this.ctx.storage.put('leases', Object.fromEntries(this.leases));
  }
}

// ---------------------------------------------------------------------------------- a room

/** Who a socket is: an id at once, a name and an ink once they've said hello, when it came
 * and when it last said anything (ms). */
type Who = { id: string; since: number; seen: number } & Partial<Person>;

interface Held {
  line: Line;
  current: Turn | null;
  /** The holder has typed something this turn. */
  typed: boolean;
  /** When the room next renews its machines' seats at the gate (ms). */
  renew: number;
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

export class Room extends DurableObject<Env> {
  private held: Held = { line: { floor: null, queue: [], until: null }, current: null, typed: false, renew: 0 };
  private history: Turn[] = [];

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.held = { ...this.held, ...(await ctx.storage.get<Held>('held')) };
      this.history = (await ctx.storage.get<Turn[]>('history')) ?? [];
    });
  }

  private get gate() {
    return this.env.GATE.getByName('gate');
  }

  async fetch(): Promise<Response> {
    if (this.ctx.getWebSockets().length >= LIMITS.people)
      return refuse(CLOSED.full, 'This room is full.');
    const id = crypto.randomUUID().slice(0, 8);
    if (!(await this.gate.enter(id)))
      return refuse(CLOSED.full, 'The chat is full just now: try again in a few minutes.');
    const [client, server] = Object.values(new WebSocketPair());
    this.ctx.acceptWebSocket(server);
    const now = Date.now();
    server.serializeAttachment({ id, since: now, seen: now } satisfies Who);
    if (!this.held.renew) this.held.renew = now + RENEW;
    await this.schedule();
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
    who.seen = Date.now();
    ws.serializeAttachment(who);
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
        return this.save(false);
      }
      case 'back': {
        const turn = this.held.current;
        if (!mine || !turn?.text) return;
        const parts = [...graphemes.segment(turn.text)];
        turn.text = turn.text.slice(0, parts[parts.length - 1].index);
        line.until = Date.now() + LIMITS.idle;
        this.send({ t: 'back', id: who.id }, ws);
        return this.save(false);
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    await this.gone(ws);
  }

  async webSocketError(ws: WebSocket) {
    await this.gone(ws);
  }

  /** The holder's time is up (the line goes on to whoever is next), or it's time to renew the
   * seats and let go of machines that sat idle or stayed too long. */
  async alarm() {
    const now = Date.now();
    const { line } = this.held;
    if (line.floor && line.until && now >= line.until - 50) {
      this.end();
      this.advance();
      await this.save();
    }
    if (this.held.renew && now >= this.held.renew - 50) {
      const stay: string[] = [];
      for (const ws of this.ctx.getWebSockets()) {
        const who = ws.deserializeAttachment() as Who;
        if (now - who.seen > IDLE || now - who.since > STAY) {
          try {
            ws.send(JSON.stringify({ t: 'error', message: 'You were away a while, so the line let you go.' }));
            ws.close(CLOSED.idle, 'idle');
          } catch {}
          await this.gone(ws);
        } else stay.push(who.id);
      }
      if (stay.length) {
        await this.gate.stay(stay);
        this.held.renew = now + RENEW;
        await this.save(false);
      }
    }
    await this.schedule();
  }

  /** The next alarm: the holder's deadline or the next renewal, whichever comes first. */
  private async schedule() {
    if (!this.ctx.getWebSockets().length) return;
    const times = [this.held.line.until, this.held.renew].filter((t): t is number => !!t);
    if (times.length) await this.ctx.storage.setAlarm(Math.min(...times));
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
    ws.serializeAttachment({ ...who, ...me } satisfies Who);
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

  /** A socket went: its person leaves the line (and gives it up, if they held it) and their
   * seat; the last one out takes the room's memory with them. */
  private async gone(ws: WebSocket) {
    const who = ws.deserializeAttachment() as Who;
    try {
      ws.close(1000, 'bye');
    } catch {}
    await this.gate.leave(who.id);
    const left = this.ctx.getWebSockets().filter((w) => w !== ws && w.readyState === WebSocket.OPEN);
    if (!left.length) {
      this.held = { line: { floor: null, queue: [], until: null }, current: null, typed: false, renew: 0 };
      this.history = [];
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return;
    }
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

  /** Remember the room, set the next alarm, and (unless only the turn's text changed) tell
   * everyone where the line stands. */
  private async save(tell = true, skip?: WebSocket) {
    if (tell) this.send({ t: 'line', line: this.held.line }, skip ?? null);
    await this.ctx.storage.put({ held: this.held, history: this.history });
    await this.schedule();
  }
}

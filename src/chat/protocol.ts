/**
 * What the chat's machines and its room (chat/src/index.ts, a Durable Object) say to each
 * other over a WebSocket, as JSON.
 *
 * One person types at a time: they hold the line. Everyone else who wants to type asks to
 * hold it and waits in line, in order. Whoever holds the line types live: every character
 * goes out as it is typed and lands on everyone's paper in that person's ink.
 */

export interface Person {
  id: string;
  name: string;
  /** Their ribbon's colour. */
  ink: string;
}

/** One person's go at the line: what they typed, in their ink. */
export interface Turn {
  id: string;
  name: string;
  ink: string;
  text: string;
  /** When it began (ms since 1970). */
  at: number;
}

/** Who holds the line now (or nobody), and who waits for it, first in line first. */
export interface Line {
  floor: string | null;
  queue: string[];
  /** When the holder loses the line if they don't type (ms since 1970). */
  until: number | null;
}

export type ClientMessage =
  | { t: 'hello'; name: string; ink?: string }
  /** Get in line (or hold the line at once, if nobody does). */
  | { t: 'hold' }
  /** Step out of line. */
  | { t: 'leave' }
  /** Done typing: the line goes to whoever is next. */
  | { t: 'over' }
  /** Typed while holding the line: characters (a line break is '\n'). */
  | { t: 'type'; s: string }
  /** The last character taken back. */
  | { t: 'back' };

export type ServerMessage =
  | {
      t: 'welcome';
      you: Person;
      people: Person[];
      line: Line;
      /** The room's last turns, oldest first, and the one being typed now. */
      history: Turn[];
      current: Turn | null;
    }
  | { t: 'people'; people: Person[] }
  | { t: 'line'; line: Line }
  /** Someone has the line: their turn begins. */
  | { t: 'turn'; turn: Turn }
  | { t: 'type'; id: string; s: string }
  | { t: 'back'; id: string }
  /** Their turn is over. */
  | { t: 'end'; id: string }
  | { t: 'error'; message: string };

/** The ribbons people get, in order (each room hands out the first one nobody has). */
export const INKS = [
  '#1f4fa8',
  '#b8322a',
  '#2f7d4a',
  '#7a3fa8',
  '#c0641a',
  '#0f7c86',
  '#a8326e',
  '#6b5a2a',
  '#3a3a8c',
  '#5c7a1f',
];

export const LIMITS = {
  /** A name's length. */
  name: 20,
  /** A turn's length, and how much one message may carry. */
  turn: 4000,
  chunk: 64,
  /** Turns a room keeps. */
  history: 60,
  /** People in a room. */
  people: 8,
  /** How long the line waits for its holder to start typing, and for them to go on (ms). */
  first: 15000,
  idle: 10000,
};

/** Why a room closed a machine's socket for good (WebSocket close codes): the chat is full,
 * the machine sat idle or stayed too long, or its pass (the captcha's) is missing or out of
 * date. A machine doesn't come back by itself after one of these. */
export const CLOSED = {
  full: 4001,
  idle: 4002,
  pass: 4003,
} as const;

/** A room's name: lower-case letters, digits and dashes. */
export const ROOM = /^[a-z0-9-]{1,40}$/;
